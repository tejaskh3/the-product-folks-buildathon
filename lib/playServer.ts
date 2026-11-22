// Server-only helpers for /play: a per-instance rate cap,
// and the NDJSON stream that wraps one diagram generation.
import { checkDiagram, citablePages, isDigestPaper, structuredCall, userMessage, type PaperInput, type RawDiagram, type Usage, exploreIds } from "./llm";
import { ndjsonResponse } from "./ndjson";
import { DIAGRAM_SCHEMA } from "./prompts";
import type { DeeperEvent, Diagram } from "./types";
import type { OnUsage } from "./usage";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const recent: number[] = [];

export const ID_RE = /^[A-Za-z0-9_/-]{1,160}$/;

export function json(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

/** Reserves one model call in this instance's rolling hour, or returns a 429 response. A backstop only: real limits are per user. */
export function takePlaySlot(now = Date.now()): Response | null {
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return json(429, "Curio is busy right now. Try again in a little while.");
  recent.push(now);
  return null;
}

export function isPaperId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}

const RETRY_BUDGET_MS = 140_000; // only retry if a second attempt still fits in the 300 s function limit

/**
 * Fixes the problems that don't need a new drawing: explorables with no matching
 * element are dropped, and stray data-explore attributes are removed.
 */
export function repair(d: RawDiagram): RawDiagram {
  const html = d.html ?? "";
  const inHtml = exploreIds(html);
  const explorables = (d.explorables ?? []).filter((e) => inHtml.has(e.id));
  const listed = new Set(explorables.map((e) => e.id));
  const cleaned = html.replace(/\sdata-explore\s*=\s*["']([^"']+)["']/g, (m, id: string) => (listed.has(id) ? m : ""));
  return { ...d, html: cleaned, explorables };
}

/** Problems worth a retry: too few clickable parts on the first attempt, or anything repair() can't fix. */
export function hardProblems(d: RawDiagram, lastAttempt: boolean): string[] {
  // A bare URL in text or a namespace is harmless: the iframe's CSP blocks every request.
  const urlLoads = /(src|href)\s*=\s*["']?\s*https?:/i.test(d.html ?? "");
  const count = d.explorables?.length ?? 0;
  return checkDiagram(d).filter(
    (p) =>
      // Clickable-part problems never fail a diagram outright: 2+ is fine, and on the
      // last attempt a scene with none still beats an error.
      !(/explorable|data-explore/.test(p) && (count >= 2 || lastAttempt)) &&
      !(p.startsWith("Forbidden pattern /https?") && !urlLoads),
  );
}

/** Digest mode: explorables citing a page the call was neither sent nor told about by the digest. */
export function citedPageProblems(d: RawDiagram, paper: PaperInput): string[] {
  const ok = citablePages(paper);
  if (!ok) return [];
  return (d.explorables ?? []).flatMap((e) => {
    const bad = (e.pages ?? []).filter((p) => !ok.has(p));
    return bad.length ? [`Explorable "${e.id}" cites page ${bad.join(", ")}, which it wasn't sent`] : [];
  });
}

/**
 * Digest mode: puts every explorable's pages back inside what the call could see. A page that is a
 * position in the excerpt ("page 2" of pages 4–6) maps back to the paper's page; any other unknown page
 * is dropped, and an explorable left with none cites the excerpt's pages. Not worth a redraw.
 */
export function fixCitedPages(d: RawDiagram, paper: PaperInput): { diagram: RawDiagram; fixed: number } {
  const ok = citablePages(paper);
  if (!ok || !isDigestPaper(paper)) return { diagram: d, fixed: 0 };
  const sent = paper.slice?.pages ?? [];
  let fixed = 0;
  const explorables = (d.explorables ?? []).map((e) => {
    const pages = e.pages ?? [];
    if (pages.every((p) => ok.has(p))) return e;
    fixed++;
    const mapped = pages.map((p) => (ok.has(p) ? p : sent[p - 1])).filter((p): p is number => p !== undefined);
    return { ...e, pages: mapped.length ? [...new Set(mapped)] : sent };
  });
  return { diagram: { ...d, explorables }, fixed };
}

export async function generatePlayDiagram(opts: {
  paper: PaperInput;
  prompt: string;
  id: string;
  parentId?: string;
  onStage: (s: "drawing" | "checking") => void;
  onUsage?: OnUsage;
  apiKey?: string;
  model?: string;
}): Promise<{ diagram: Diagram; usage: Usage[] }> {
  const started = Date.now();
  const usage: Usage[] = [];
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await structuredCall<RawDiagram>({
      paper: opts.paper,
      prompt,
      schema: DIAGRAM_SCHEMA,
      effort: "medium",
      onText: () => opts.onStage("drawing"),
      apiKey: opts.apiKey,
      model: opts.model,
    });
    usage.push(res.usage);
    await opts.onUsage?.(res.usage);
    opts.onStage("checking");
    const pageCheck = citedPageProblems(res.data, opts.paper);
    if (pageCheck.length) console.warn(`[sending] ${opts.id}: fixing cited pages: ${pageCheck.join("; ")}`);
    const fixed = repair(fixCitedPages(res.data, opts.paper).diagram);
    const problems = hardProblems(fixed, attempt === 1 || Date.now() - started > RETRY_BUDGET_MS);
    if (!problems.length) return { diagram: { id: opts.id, parentId: opts.parentId, ...fixed }, usage };
    console.warn(`[play] ${opts.id} attempt ${attempt + 1} failed checks: ${problems.join("; ")}`);
    if (Date.now() - started > RETRY_BUDGET_MS) break;
    prompt = `${opts.prompt}\n\nYOUR PREVIOUS ATTEMPT FAILED THESE CHECKS, fix them:\n- ${problems.join("\n- ")}`;
  }
  throw new Error(`Diagram ${opts.id} failed checks`);
}

/** Streams status lines while a diagram is generated, then the diagram (or an error). */
export function diagramStream(opts: {
  /** Or a function that works out what to send (slicing, a first digest), run once the stream is open. */
  paper: PaperInput | (() => Promise<PaperInput>);
  prompt: string;
  id: string;
  parentId?: string;
  tag: string;
  onUsage?: OnUsage;
  /** Saves the result; runs before the client is told, so a closed tab never loses it. */
  onDone?: (d: Diagram) => Promise<void>;
  onError?: () => Promise<void>;
  apiKey?: string;
  /** Rewrites an error before it becomes the user's message (e.g. our key's limit → "at capacity"). */
  mapError?: (err: unknown) => unknown;
}) {
  let stage: "reading" | "drawing" | "checking" = "reading";
  return ndjsonResponse<DeeperEvent>(
    async (send) => {
      send({ type: "status", stage });
      try {
        const paper = typeof opts.paper === "function" ? await opts.paper() : opts.paper;
        const { diagram, usage } = await generatePlayDiagram({
          paper,
          prompt: opts.prompt,
          id: opts.id,
          parentId: opts.parentId,
          onUsage: opts.onUsage,
          apiKey: opts.apiKey,
          onStage: (s) => {
            stage = s;
            send({ type: "status", stage: s });
          },
        });
        const cost = usage.reduce((n, u) => n + u.cost_usd, 0);
        console.log(`[play:${opts.tag}] ${opts.id} ok, $${cost.toFixed(4)}`);
        // A failed save is logged, not shown: the reader still gets the diagram they paid for.
        await opts.onDone?.(diagram).catch((e: unknown) => console.error(`[play:${opts.tag}] ${opts.id} couldn’t be saved`, e));
        send({ type: "done", diagram });
      } catch (err) {
        console.error(`[play:${opts.tag}] ${opts.id} failed`, err);
        await opts.onError?.().catch((e: unknown) => console.error(`[play:${opts.tag}] couldn’t save the error`, e));
        send({ type: "error", message: userMessage(opts.mapError ? opts.mapError(err) : err, "this one") });
      }
    },
    () => ({ type: "status", stage }),
  );
}

/** Accepts "1706.03762", "arxiv.org/abs/1706.03762v7", "arxiv.org/pdf/1706.03762", old-style ids. */
export function arxivId(ref: string): string | null {
  const m = ref.trim().match(/(\d{4}\.\d{4,5}(v\d+)?)|([a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)/i);
  return m ? m[0] : null;
}
