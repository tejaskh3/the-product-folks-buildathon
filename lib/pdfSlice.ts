// Cutting a paper down to the pages one call needs (PAPER_SENDING=digest). Pure: bytes in, bytes out.
import { PDFDocument } from "pdf-lib";

/**
 * No call is sent more than this many pages of PDF; the digest covers the rest. Kept small on purpose:
 * a slice sits after the cache marker, so each of its pages is paid in full, while the whole PDF read
 * from cache costs a tenth per page. Three uncached pages ≈ a cached 30-page paper.
 */
export const MAX_SLICE_PAGES = 3;

/**
 * The pages to send for a call citing `cited`: the cited pages (in order, up to the cap), then the page
 * after each (a passage or figure caption often runs on) until the cap. Original numbering.
 */
export function slicePages(cited: number[], total: number, cap = MAX_SLICE_PAGES): number[] {
  const valid = (p: number) => Number.isInteger(p) && p >= 1 && p <= total;
  const picked = [...new Set(cited.filter(valid))].sort((a, b) => a - b).slice(0, cap);
  const out = new Set(picked);
  for (const p of picked) {
    if (out.size >= cap) break;
    if (valid(p + 1)) out.add(p + 1);
  }
  return [...out].sort((a, b) => a - b);
}

export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}

/** A new PDF holding just `pages` (1-indexed, original numbering) of `pdf`, in that order. */
export async function slicePdf(pdf: Uint8Array, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();
  const bad = pages.filter((p) => !Number.isInteger(p) || p < 1 || p > total);
  if (!pages.length || bad.length) throw new Error(`Can’t slice pages ${pages.join(",")} from a ${total}-page PDF`);
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, pages.map((p) => p - 1))) out.addPage(page);
  return Buffer.from(await out.save());
}

/** The label used in storage paths and filenames, e.g. "p4-5-6". */
export const pagesLabel = (pages: number[]) => `p${pages.join("-")}`;
