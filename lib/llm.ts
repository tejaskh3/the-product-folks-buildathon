// Server-only: Curio's one way of calling a model. Every call goes to the Anthropic Messages API as a
// streamed, JSON-schema-constrained request with the paper attached as a PDF
// (or, with PAPER_SENDING=digest, as its digest plus a PDF of a few cited pages: lib/paperSending.ts).
//
//   structuredCall ──► POST openrouter /chat/completions (stream)
//        │               system prompt · [PDF file part (+cache marker)] · prompt
//        │      digest:  system prompt · [digest text (+cache marker)] · [page-slice PDF · which pages] · prompt
//        │               response_format json_schema · reasoning effort
//        ├─ 429 / 5xx / network → retry with backoff (honours retry-after)
//        ├─ 401 → KeyInvalid · 402 → OutOfCredit · 403 key limit → AtCapacity
//        ├─ finish "length" → Truncated · refusal / content filter → Refused
//        └─ text that isn't the schema's JSON → BadOutput
//
// Keep the system prompt, the PDF part and its marker first and byte-identical across a paper's calls:
// that shared prefix is what the provider caches. In digest mode the digest text is that prefix,
// and the per-call page slice comes after the marker.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Diagram, Explorable } from "./types";
import { DIAGRAM_SCHEMA, SYSTEM_PROMPT } from "./prompts";
import { DEFAULT_MODEL, modelSpec } from "./models";

const MAX_ATTEMPTS = 4;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The paper as OpenRouter takes it: a URL (preferred) or a base64 data URL. */
export interface PaperRef {
  filename: string;
  data: string;
}

/** Digest mode: the paper's digest as text, plus (usually) a PDF of only the pages this call cites. */
export interface DigestPaper {
  /** The rendered digest (digestText in lib/digest.ts); identical across a paper's calls. */
  digest: string;
  /** Every page the digest names, for checking what the model cites. */
  digestPages: number[];
  /** A PDF of `pages` (original numbering) of the paper; absent → the digest alone. */
  slice?: PaperRef & { pages: number[] };
}

/** What one call sends about the paper: the whole PDF, or a digest (+ cited pages). */
export type PaperInput = PaperRef | DigestPaper;

export const isDigestPaper = (p: PaperInput): p is DigestPaper => "digest" in p;

/** The pages a call may cite: those it was sent, plus any the digest names. Null for the whole PDF. */
export function citablePages(p: PaperInput): Set<number> | null {
  return isDigestPaper(p) ? new Set([...p.digestPages, ...(p.slice?.pages ?? [])]) : null;
}

/** "page 4" · "pages 4, 5 and 6" */
const pagesPhrase = (pages: number[]) =>
  pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;

/** Tells the model which original pages a slice holds, so its citations stay in the paper's own numbering. */
export function sliceNote(pages: number[]): string {
  return `The PDF attached above is NOT the whole paper: it holds only ${pagesPhrase(pages)} of the paper, in that order (its first page is the paper's page ${pages[0]}). Always cite pages by the paper's own numbers (${pages.join(", ")} here, or any page the digest names), never by position in this excerpt. Copy verbatim quotes from these pages or from the digest's verbatim lines.`;
}

export const DIGEST_ONLY_NOTE =
  "You have the paper's digest only, no PDF pages. Cite pages as the digest gives them, and copy any verbatim quote from the digest's verbatim lines or figure captions.";

/** A PaperRef as an Anthropic PDF source: a URL, or base64 (with or without a data: prefix). */
function pdfSource(ref: PaperRef): Record<string, unknown> {
  if (/^https?:\/\//i.test(ref.data)) return { type: "url", url: ref.data };
  const data = ref.data.replace(/^data:[^;,]+;base64,/, "");
  return { type: "base64", media_type: "application/pdf", data };
}

/** The user-message blocks that carry the paper. Everything up to the cache marker is cached. */
function partsFor(paper: PaperInput, marker: boolean): Record<string, unknown>[] {
  const cache = marker ? { cache_control: { type: "ephemeral" } } : {};
  if (!isDigestPaper(paper)) {
    return [
      { type: "document", source: pdfSource(paper), title: paper.filename, ...cache },
      { type: "text", text: "The paper is attached above." },
    ];
  }
  const digest = {
    type: "text",
    text: `PAPER DIGEST: a structured summary of the whole paper, made from its full text. Page numbers are the paper's own 1-indexed PDF pages.\n\n${paper.digest}`,
    ...cache,
  };
  if (!paper.slice) return [digest, { type: "text", text: DIGEST_ONLY_NOTE }];
  return [
    digest,
    { type: "document", source: pdfSource(paper.slice), title: paper.slice.filename },
    { type: "text", text: sliceNote(paper.slice.pages) },
  ];
}

/** What one call cost, from the API's usage numbers and list prices. */
export interface Usage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  /** Request start to last byte, for this attempt. */
  latency_ms: number;
}

export type LlmErrorKind = "KeyInvalid" | "OutOfCredit" | "AtCapacity" | "RateLimited" | "Refused" | "Truncated" | "BadOutput" | "Upstream";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    /** From the provider's retry-after header, when it sent one. */
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** The sentence a user sees for a failed call. `what` names the thing that failed. */
export function userMessage(err: unknown, what = "this diagram"): string {
  const kind = err instanceof LlmError ? err.kind : "Upstream";
  switch (kind) {
    case "KeyInvalid":
      return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
    case "OutOfCredit":
      return "The Anthropic API account is out of credit. Top it up, then try again.";
    case "AtCapacity":
      return "Curio is at capacity right now. Try again in a few hours. This wasn’t counted.";
    case "RateLimited":
      return "The model is busy right now. Please try again in a minute.";
    case "Refused":
      return `The model declined to draw ${what}.`;
    default:
      return `Curio couldn’t draw ${what}. Please try again.`;
  }
}

/** $ per million tokens: [input, output, cache read, cache write]. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

let _client: Anthropic | null = null;
let _clientKey = "";
function client(apiKey: string): Anthropic {
  if (!_client || _clientKey !== apiKey) {
    // Retries are ours (below), so the SDK doesn't stack its own on top.
    _client = new Anthropic({ apiKey, maxRetries: 0 });
    _clientKey = apiKey;
  }
  return _client;
}

function errorFor(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const detail = String(err.message).slice(0, 300);
    const retryAfterMs = Number(err.headers?.get?.("retry-after")) * 1000 || 0;
    if (status === 401) return new LlmError("KeyInvalid", `Anthropic rejected the key: ${detail}`, status);
    if (status === 402 || /credit balance/i.test(detail)) return new LlmError("OutOfCredit", `Anthropic account has no credit: ${detail}`, status);
    if (status === 403) return new LlmError("AtCapacity", `Anthropic refused access: ${detail}`, status);
    if (status === 429) return new LlmError("RateLimited", `Anthropic rate limit: ${detail}`, status, retryAfterMs);
    return new LlmError("Upstream", `Anthropic ${status}: ${detail}`, status);
  }
  return new LlmError("Upstream", err instanceof Error ? err.message : String(err));
}

const retryable = (e: LlmError) => e.kind === "RateLimited" || e.kind === "Upstream";

/**
 * Streams one structured-output call and returns the parsed JSON.
 * `onText` fires once, when the answer (not the thinking) starts arriving.
 * `apiKey` defaults to ANTHROPIC_API_KEY.
 */
export async function structuredCall<T>(opts: {
  paper: PaperInput;
  prompt: string;
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens?: number;
  onText?: () => void;
  model?: string;
  apiKey?: string;
}): Promise<{ data: T; usage: Usage }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmError("KeyInvalid", "ANTHROPIC_API_KEY is not set");
  const paperParts = partsFor(opts.paper, modelSpec(model).cacheMarker);

  const params = {
    model,
    max_tokens: opts.maxTokens ?? 64000,
    system: SYSTEM_PROMPT,
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
    // If a request is declined, the API retries it on another model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: [...paperParts, { type: "text", text: opts.prompt }] }],
  };

  let lastError: LlmError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs(attempt, lastError)));
    try {
      return await streamOnce<T>(apiKey, params, model, opts.onText);
    } catch (err) {
      const e = errorFor(err);
      if (!retryable(e)) throw e;
      lastError = e;
    }
  }
  throw lastError!;
}

function backoffMs(attempt: number, e?: LlmError): number {
  const base = e?.retryAfterMs || 1000 * 2 ** (attempt - 1);
  return Math.min(base, 20_000) + Math.random() * 500;
}

async function streamOnce<T>(apiKey: string, params: Record<string, unknown>, model: string, onText?: () => void): Promise<{ data: T; usage: Usage }> {
  const started = Date.now();
  // Params are built as plain JSON (schema, fallbacks), so they go through untyped.
  const stream = client(apiKey).beta.messages.stream(params as unknown as BetaMessageStreamParams);
  let began = false;
  stream.on("text", () => {
    if (!began) {
      began = true;
      onText?.();
    }
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new LlmError("Refused", `Model refused (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new LlmError("Truncated", "Output was cut off (max_tokens)");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  const u = msg.usage;
  const [pin, pout, pread, pwrite] = PRICES[msg.model] ?? PRICES[model] ?? [0, 0, 0, 0];
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const usage: Usage = {
    model: msg.model,
    input_tokens: u.input_tokens + cacheRead + cacheWrite,
    output_tokens: u.output_tokens,
    cached_tokens: cacheRead,
    reasoning_tokens: 0,
    cost_usd: (u.input_tokens * pin + u.output_tokens * pout + cacheRead * pread + cacheWrite * pwrite) / 1e6,
    latency_ms: Date.now() - started,
  };
  try {
    return { data: JSON.parse(text) as T, usage };
  } catch {
    throw new LlmError("BadOutput", `Model output wasn't valid JSON (${text.length} chars)`);
  }
}

export interface RawDiagram {
  title: string;
  caption: string;
  tryHint: string;
  html: string;
  explorables: Explorable[];
}

const FORBIDDEN = [/https?:\/\//i, /\bfetch\s*\(/, /XMLHttpRequest/, /\bimport\s*\(/, /^\s*import\s/m, /<script[^>]*\bsrc=/i, /<link\b/i, /<iframe\b/i, /\beval\s*\(/, /document\.cookie/, /localStorage|sessionStorage/];

/** Returns a list of problems; empty means the diagram passes. */
export function checkDiagram(d: RawDiagram): string[] {
  const problems: string[] = [];
  const html = d.html ?? "";
  if (html.length > 60_000) problems.push(`HTML is ${html.length} bytes; must be under 45 KB`);
  if (!/<svg[\s>]/i.test(html)) problems.push("No <svg> element found");
  for (const re of FORBIDDEN) {
    // Allow the SVG namespace URL, which is harmless.
    const cleaned = html.replace(/http:\/\/www\.w3\.org\/[0-9]+\/(svg|xlink)/g, "");
    if (re.test(cleaned)) problems.push(`Forbidden pattern ${re} found`);
  }
  const inHtml = exploreIds(html);
  const listed = new Set((d.explorables ?? []).map((e) => e.id));
  if (listed.size < 3) problems.push(`Only ${listed.size} explorables; need 3–5`);
  for (const id of listed) if (!inHtml.has(id)) problems.push(`Explorable "${id}" has no data-explore element`);
  for (const id of inHtml) if (!listed.has(id)) problems.push(`data-explore="${id}" is not in the explorables list`);
  return problems;
}

/** One diagram call with a single retry that feeds the problems back. */
export async function generateDiagram(opts: {
  paper: PaperRef;
  prompt: string;
  id: string;
  parentId?: string;
  effort?: Effort;
  onStage?: (stage: "drawing" | "checking") => void;
}): Promise<{ diagram: Diagram; usage: Usage[] }> {
  const usages: Usage[] = [];
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, usage } = await structuredCall<RawDiagram>({
      paper: opts.paper,
      prompt,
      schema: DIAGRAM_SCHEMA,
      effort: opts.effort ?? "medium",
      onText: () => opts.onStage?.("drawing"),
    });
    usages.push(usage);
    opts.onStage?.("checking");
    const problems = checkDiagram(data);
    if (problems.length === 0) {
      return { diagram: { id: opts.id, parentId: opts.parentId, ...data }, usage: usages };
    }
    if (attempt === 1) throw new Error(`Diagram ${opts.id} failed checks: ${problems.join("; ")}`);
    prompt = `${opts.prompt}\n\nYOUR PREVIOUS ATTEMPT FAILED THESE CHECKS, fix them:\n- ${problems.join("\n- ")}`;
  }
  throw new Error("unreachable");
}

/**
 * Every data-explore id a diagram declares: literal attributes, plus ids set from JS
 * via setAttribute("data-explore", …) or dataset.explore = … (models sometimes do that).
 */
export function exploreIds(html: string): Set<string> {
  const patterns = [
    /data-explore\s*=\s*["']([^"']+)["']/g,
    /setAttribute\(\s*["']data-explore["']\s*,\s*["']([^"']+)["']\s*\)/g,
    /dataset\.explore\s*=\s*["']([^"']+)["']/g,
  ];
  return new Set(patterns.flatMap((re) => [...html.matchAll(re)].map((m) => m[1])));
}
