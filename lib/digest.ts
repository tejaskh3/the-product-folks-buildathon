// The paper digest: a compact, structured text version of the whole paper, made once per paper
// (by the plan call, or one dedicated call) and saved on papers.digest. With PAPER_SENDING=digest,
// later calls send this text plus only the PDF pages they cite, instead of the whole PDF.
//
// The text the model sees is rendered field by field (never JSON.stringify): jsonb reorders keys,
// and the rendered digest is the cached prompt prefix, so it must come out byte-identical every time.

export interface PaperDigest {
  title: string;
  /** The paper's page count as the model read it; a hint only. */
  pageCount: number;
  sections: { heading: string; pages: number[]; summary: string; quote: string }[];
  definitions: { term: string; meaning: string; page: number }[];
  equations: { label: string; text: string; meaning: string; page: number }[];
  figures: { label: string; caption: string; page: number }[];
  results: { claim: string; page: number }[];
}

const pageList = { type: "array", items: { type: "integer" } } as const;
const obj = (props: Record<string, unknown>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props }) as const;

export const DIGEST_SCHEMA = obj({
  title: { type: "string" },
  pageCount: { type: "integer" },
  sections: { type: "array", items: obj({ heading: { type: "string" }, pages: pageList, summary: { type: "string" }, quote: { type: "string" } }) },
  definitions: { type: "array", items: obj({ term: { type: "string" }, meaning: { type: "string" }, page: { type: "integer" } }) },
  equations: { type: "array", items: obj({ label: { type: "string" }, text: { type: "string" }, meaning: { type: "string" }, page: { type: "integer" } }) },
  figures: { type: "array", items: obj({ label: { type: "string" }, caption: { type: "string" }, page: { type: "integer" } }) },
  results: { type: "array", items: obj({ claim: { type: "string" }, page: { type: "integer" } }) },
});

/** What the model is asked for. Later calls see only this and a few pages, so it must stand in for the paper. */
export const DIGEST_INSTRUCTIONS = `digest: a compact study guide to the WHOLE paper (about 2,000–4,000 words in all) that later steps will read INSTEAD of the PDF, alongside a few cited pages. Every page number is the 1-indexed PDF page. Fields:
  - title; pageCount (pages in the PDF)
  - sections: every section and subsection in order: heading (with its number, e.g. "3.2 Attention"), pages it spans, summary (2–4 plain sentences: what it says, with its real numbers), quote (one VERBATIM 12–40 word sentence from that section, copied exactly, no LaTeX, no ellipses)
  - definitions: the key terms and symbols a reader needs (term, meaning in one sentence, page)
  - equations: the important numbered or displayed equations: label (e.g. "Eq. 1"), text (the equation written out in plain text or simple LaTeX), meaning (one sentence on each symbol's role), page
  - figures: every figure and table: label (e.g. "Figure 1", "Table 2"), caption copied verbatim, page
  - results: the headline numbers and claims (claim with its number, page)`;

/** The dedicated digest call, for papers that already have a walkthrough (see makeDigest in lib/paperSending.ts). */
export const DIGEST_PROMPT = `Read the WHOLE attached paper and return its digest.

- ${DIGEST_INSTRUCTIONS}`;

const pagesText =(pages: number[]) => (pages.length > 1 ? `pp. ${pages[0]}–${pages[pages.length - 1]}` : `p. ${pages[0] ?? "?"}`);
const line = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The digest as the text a model reads. Same digest in, same bytes out. */
export function digestText(d: PaperDigest): string {
  const out: string[] = [`TITLE: ${line(d.title)}`, `PAGES: ${d.pageCount}`, "", "SECTIONS"];
  for (const s of d.sections ?? []) {
    out.push(`- ${line(s.heading)} (${pagesText(s.pages ?? [])}): ${line(s.summary)}`);
    if (line(s.quote)) out.push(`  Verbatim: "${line(s.quote)}"`);
  }
  const block = <T>(name: string, items: T[] | undefined, fmt: (x: T) => string) => {
    if (!items?.length) return;
    out.push("", name, ...items.map((x) => `- ${fmt(x)}`));
  };
  block("DEFINITIONS", d.definitions, (x) => `${line(x.term)} (p. ${x.page}): ${line(x.meaning)}`);
  block("EQUATIONS", d.equations, (x) => `${line(x.label)} (p. ${x.page}): ${line(x.text)} | ${line(x.meaning)}`);
  block("FIGURES AND TABLES", d.figures, (x) => `${line(x.label)} (p. ${x.page}): "${line(x.caption)}"`);
  block("KEY RESULTS", d.results, (x) => `(p. ${x.page}) ${line(x.claim)}`);
  return out.join("\n");
}

/** Every page the digest names: a model may cite these even when it was sent no PDF of them. */
export function digestPages(d: PaperDigest): number[] {
  const all = [
    ...(d.sections ?? []).flatMap((s) => s.pages ?? []),
    ...[...(d.definitions ?? []), ...(d.equations ?? []), ...(d.figures ?? []), ...(d.results ?? [])].map((x) => x.page),
  ];
  return [...new Set(all.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
}

/** A digest worth sending: has an outline. Anything less and the call gets the whole PDF instead. */
export function isUsableDigest(d: unknown): d is PaperDigest {
  const x = d as PaperDigest | null;
  return !!x && Array.isArray(x.sections) && x.sections.length > 0 && typeof x.title === "string";
}
