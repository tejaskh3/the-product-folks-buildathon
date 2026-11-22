// Browser helpers for /play. Requests are same-origin, so the Supabase session cookie
// identifies the user; routes that spend credits answer 401 when signed out.
import type { Suggestions } from "./playPrompts";
import type { DeeperEvent, Diagram } from "./types";
import { MAX_PDF_BYTES, MAX_UPLOAD_BYTES } from "./uploadLimits";

export type Stage = "reading" | "drawing" | "checking";

/** The server needs a signed-in user for this (401). */
export class SignInError extends Error {}

export type PaywallReason = "quota" | "daily_cap" | "ip_limit" | "disposable_email";
const PAYWALL_REASONS = new Set<unknown>(["quota", "daily_cap", "ip_limit", "disposable_email"] satisfies PaywallReason[]);

/**
 * A 402: out of papers ("quota"), or free papers refused for this network today ("ip_limit") or this
 * email ("disposable_email") — all three show the plans — or out of questions for today ("daily_cap").
 */
export class PaywallError extends Error {
  constructor(
    message: string,
    readonly reason: PaywallReason,
    readonly allowance: number | null,
    readonly plan: "free" | "byok" | "starter" | "pro" | null,
  ) {
    super(message);
  }
}

export async function fail(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  type Body = { error?: unknown; reason?: unknown; allowance?: unknown; plan?: unknown };
  let data: Body | null = null;
  try {
    data = (await res.json()) as Body;
    if (typeof data?.error === "string" && data.error) message = data.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) throw new SignInError(message);
  if (res.status === 402 && data && PAYWALL_REASONS.has(data.reason))
    throw new PaywallError(
      message,
      data.reason as PaywallReason,
      typeof data.allowance === "number" ? data.allowance : null,
      data.plan === "free" || data.plan === "byok" || data.plan === "starter" || data.plan === "pro" ? data.plan : null,
    );
  throw new Error(message);
}

/** PUTs the file to a signed Storage upload URL, reporting progress (0–1). Resolves on 2xx. */
function putToStorage(url: string, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/pdf");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // Storage answers 400 with the real status inside: 413 too big, 415 not a PDF.
      const body = xhr.responseText;
      if (/EntityTooLarge|"413"/.test(body)) reject(new Error("That PDF is over 15 MB."));
      else if (/InvalidMimeType|"415"/.test(body)) reject(new Error("That file isn’t a PDF."));
      else reject(new Error("The upload was interrupted. Please try again."));
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => reject(new Error("The upload was interrupted. Please try again."));
    xhr.send(file);
  });
}

/**
 * Up to 4 MB: one request. Up to 15 MB: the file goes straight to Storage (Vercel caps request
 * bodies at ~4.5 MB): start → PUT to the signed URL → finish. Both answer the same way.
 */
async function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<Response> {
  if (file.size <= MAX_UPLOAD_BYTES) {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/play/upload", { method: "POST", body: form });
  }
  if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is over 15 MB. Paste its arXiv link instead, if it has one.");
  const start = await fetch("/api/play/upload/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ size: file.size }),
  });
  if (!start.ok) await fail(start, "Couldn’t start the upload.");
  const { path, signedUrl } = (await start.json()) as { path: string; signedUrl: string };
  onProgress?.(0);
  await putToStorage(signedUrl, file, onProgress);
  onProgress?.(1);
  return fetch("/api/play/upload/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, name: file.name }),
  });
}

export async function uploadPaper(
  input: { file: File } | { arxiv: string },
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<{ paperId: string | null; key: string; pdfUrl: string; name: string; demo?: boolean; suggestions?: Suggestions | null }> {
  let res: Response;
  if ("file" in input) {
    res = await uploadFile(input.file, opts.onProgress);
  } else {
    res = await fetch("/api/play/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ arxiv: input.arxiv }),
    });
  }
  if (!res.ok) await fail(res, "Upload failed.");
  const { paperId, key, name, demo, suggestions } = (await res.json()) as {
    paperId: string | null;
    key: string;
    name: string;
    demo?: boolean;
    suggestions?: Suggestions | null;
  };

  let pdfUrl: string;
  if ("file" in input) pdfUrl = URL.createObjectURL(input.file);
  else {
    const pdf = await fetch(`/api/play/pdf?arxiv=${encodeURIComponent(input.arxiv)}`);
    if (!pdf.ok) await fail(pdf, "Couldn’t load the PDF for reading.");
    pdfUrl = URL.createObjectURL(await pdf.blob());
  }
  return { paperId, key, pdfUrl, name, demo, suggestions };
}

export async function fetchSuggestions(paperId: string, signal?: AbortSignal): Promise<Suggestions> {
  const res = await fetch("/api/play/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paperId }),
    signal,
  });
  if (!res.ok) await fail(res, "Couldn’t suggest questions.");
  return (await res.json()) as Suggestions;
}

/** POSTs to a streaming diagram route and resolves with the finished diagram. */
export async function streamDiagram(
  url: string,
  body: unknown,
  onStage: (s: Stage) => void,
  signal?: AbortSignal,
): Promise<Diagram> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) await fail(res, `Request failed (${res.status})`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const handle = (line: string): Diagram | undefined => {
    const t = line.trim();
    if (!t) return;
    let ev: DeeperEvent;
    try {
      ev = JSON.parse(t) as DeeperEvent;
    } catch {
      return;
    }
    if (ev.type === "status") onStage(ev.stage);
    else if (ev.type === "done") return ev.diagram;
    else if (ev.type === "error") throw new Error(ev.message || "Generation failed");
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      if (done) buf += decoder.decode();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const d = handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (d) return d;
      }
      if (done) {
        const d = handle(buf);
        if (d) return d;
        throw new Error("The connection closed before the diagram was ready. Please try again.");
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
