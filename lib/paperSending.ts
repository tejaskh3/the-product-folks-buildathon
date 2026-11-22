// What each model call sends about the paper, chosen by PAPER_SENDING.
//
//   full (default)  every call   ──► the whole PDF, exactly as before
//   digest          plan         ──► the whole PDF; the plan also returns the digest (saved on papers.digest)
//                   scene        ──► digest + a PDF of the scene's pages (plus the page after, at most 3)
//                   go deeper    ──► digest + the clicked part's pages
//                   question     ──► digest + the pages of the scene it was asked on
//                   suggestions  ──► digest only
//   no digest yet · no pages to send · slicing failed ──► the whole PDF for that call (logged)
//
// The digest is the cached prefix in digest mode, so one sender renders it once and every call reuses those bytes.
import { DIGEST_PROMPT, DIGEST_SCHEMA, digestPages, digestText, isUsableDigest, type PaperDigest } from "./digest";
import { structuredCall, type DigestPaper, type PaperInput, type PaperRef, type Usage } from "./llm";
import { pagesLabel, pdfPageCount, slicePages, slicePdf } from "./pdfSlice";

export type SendingMode = "full" | "digest";

export function sendingMode(): SendingMode {
  return process.env.PAPER_SENDING?.trim().toLowerCase() === "digest" ? "digest" : "full";
}

/** Builds a PDF of (roughly) the cited pages; returns it with the original page numbers it really holds. */
export type Slicer = (cited: number[]) => Promise<PaperRef & { pages: number[] }>;

export class PaperSender {
  readonly mode: SendingMode;
  readonly full: PaperRef;
  private readonly slicer?: Slicer;
  private base: Omit<DigestPaper, "slice"> | null = null;
  private saved: PaperDigest | null = null;
  /** Calls that wanted less than the whole PDF but got it anyway, and why (for logs and the eval). */
  readonly fallbacks: { step: string; why: string }[] = [];

  constructor(opts: { full: PaperRef; mode?: SendingMode; digest?: unknown; slicer?: Slicer }) {
    this.full = opts.full;
    this.mode = opts.mode ?? "full";
    this.slicer = opts.slicer;
    this.setDigest(opts.digest);
  }

  get digest(): PaperDigest | null {
    return this.saved;
  }

  /** Digest mode with no digest saved yet: the plan should make one. */
  get wantsDigest(): boolean {
    return this.mode === "digest" && !this.base;
  }

  setDigest(d: unknown) {
    if (!isUsableDigest(d)) return;
    this.saved = d;
    this.base = { digest: digestText(d), digestPages: digestPages(d) };
  }

  /** For a call grounded in `cited` pages (a scene, a clicked part). */
  async forPages(cited: number[], step: string): Promise<PaperInput> {
    if (this.mode === "full") return this.full;
    if (!this.base) return this.fallback(step, "no digest yet");
    if (!cited.length) return this.fallback(step, "no pages to send");
    if (!this.slicer) return this.fallback(step, "no way to slice this PDF");
    try {
      return { ...this.base, slice: await this.slicer(cited) };
    } catch (err) {
      return this.fallback(step, `slicing pages ${cited.join(",")} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** For a call that only needs the paper's outline (suggested questions). */
  digestOnly(step: string): PaperInput {
    if (this.mode === "full") return this.full;
    return this.base ? { ...this.base } : this.fallback(step, "no digest yet");
  }

  private fallback(step: string, why: string): PaperRef {
    console.warn(`[sending] ${step}: ${why}; sending the whole PDF`);
    this.fallbacks.push({ step, why });
    return this.full;
  }
}

/** Today's behaviour: every call gets the whole PDF. */
export const fullSender = (paper: PaperRef) => new PaperSender({ full: paper, mode: "full" });

/** Slices from PDF bytes already in memory, sent inline as base64 (scripts, tests, local dev). */
export function bytesSlicer(pdf: Uint8Array, filename: string): Slicer {
  let total: Promise<number> | null = null;
  return async (cited) => {
    const pages = slicePages(cited, await (total ??= pdfPageCount(pdf)));
    if (!pages.length) throw new Error("none of the cited pages are in the paper");
    const bytes = await slicePdf(pdf, pages);
    return { filename: sliceName(filename, pages), data: `data:application/pdf;base64,${bytes.toString("base64")}`, pages };
  };
}

export const sliceName = (filename: string, pages: number[]) => `${filename.replace(/\.pdf$/i, "")}-${pagesLabel(pages)}.pdf`;

/**
 * One dedicated call that makes the digest from the whole PDF, for papers that will never be planned
 * (library papers, imported finished). Made once and saved; every reader's questions reuse it.
 */
export async function makeDigest(opts: { paper: PaperRef; apiKey?: string; model?: string }): Promise<{ digest: PaperDigest | null; usage: Usage }> {
  const { data, usage } = await structuredCall<{ digest: PaperDigest }>({
    paper: opts.paper,
    prompt: DIGEST_PROMPT,
    schema: { type: "object", additionalProperties: false, required: ["digest"], properties: { digest: DIGEST_SCHEMA } },
    effort: "low",
    maxTokens: 24000,
    apiKey: opts.apiKey,
    model: opts.model,
  });
  return { digest: isUsableDigest(data.digest) ? data.digest : null, usage };
}
