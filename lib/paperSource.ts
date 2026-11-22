// Server-only: turns a saved paper row into something the model can read.
//
//   paperId ──► owned row ──► pdf_sha256? ──yes──► signed URL (PaperRef)
//                                  │ no (saved before PDFs were stored)
//                                  ├─ arXiv paper   → download, store, remember the hash
//                                  ├─ bundled demo  → store the bundled PDF
//                                  └─ old upload    → ReadOnlyPaper (the reader must re-upload it)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, readablePaper, type PaperRow } from "./db";
import type { PaperDigest } from "./digest";
import type { PaperRef } from "./llm";
import { PaperSender, sendingMode } from "./paperSending";
import { MAX_PAGES, pageCount, paperRef, storePdf, storedSlicer } from "./pdfStore";
import { MAX_PDF_BYTES } from "./uploadLimits";

export { MAX_UPLOAD_BYTES } from "./uploadLimits";
export const MAX_ARXIV_BYTES = MAX_PDF_BYTES;

/** Old saved papers whose only copy was an Anthropic file: the PDFs that ship with the site. */
const LEGACY_DEMO_PDFS: Record<string, string> = {
  file_01SRrsTjokEKGokJzJkFRqf3: "attention.pdf",
  file_01NZ22YY3uL3nLTsw36jn5po: "google.pdf",
};

export class PaperUnavailable extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Throws PaperUnavailable when the bytes aren't a PDF Curio can use. */
export function checkPdf(pdf: Buffer, maxBytes: number) {
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PaperUnavailable("That file isn’t a PDF.", 415);
  if (pdf.length > maxBytes) throw new PaperUnavailable(`That PDF is over ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  const pages = pageCount(pdf);
  if (pages > MAX_PAGES) throw new PaperUnavailable(`That paper has ${pages} pages; Curio handles up to ${MAX_PAGES} for now.`, 413);
}

export async function fetchArxivPdf(id: string): Promise<Buffer> {
  const res = await fetch(`https://arxiv.org/pdf/${id}`, { headers: { "user-agent": "Curio/1.0" }, redirect: "follow" });
  if (!res.ok) throw new PaperUnavailable(`arXiv returned ${res.status} for ${id}.`, 502);
  return Buffer.from(await res.arrayBuffer());
}

/** Makes sure the row has a stored PDF, recovering old rows where possible. Returns the sha256. */
export async function ensurePdf(row: PaperRow): Promise<string> {
  if (row.pdf_sha256) return row.pdf_sha256;
  let pdf: Buffer | null = null;
  const bundled = row.file_id ? LEGACY_DEMO_PDFS[row.file_id] : undefined;
  if (bundled) pdf = await readFile(path.join(process.cwd(), "public", "demo", bundled));
  else if (row.arxiv_id) pdf = await fetchArxivPdf(row.arxiv_id);
  if (!pdf) throw new PaperUnavailable("This paper was saved before Curio stored PDFs. Upload the PDF again to keep exploring it.", 409);
  checkPdf(pdf, MAX_ARXIV_BYTES);
  const sha = await storePdf(pdf);
  const { error } = await db().from("papers").update({ pdf_sha256: sha }).eq("id", row.id);
  if (error) throw new Error(error.message);
  return sha;
}

/**
 * A paper the signed-in user may ask about (their own, or a library paper), a reference to the whole PDF,
 * and the sender that picks what each call gets (the whole PDF, unless PAPER_SENDING=digest).
 */
export async function paperForGeneration(userId: string, paperId: string): Promise<{ row: PaperRow; paper: PaperRef; sender: PaperSender }> {
  const row = await readablePaper(userId, paperId);
  if (!row) throw new PaperUnavailable("That paper isn’t one of yours. Upload it first.", 404);
  const sha = await ensurePdf(row);
  const filename = row.name ?? "paper.pdf";
  const paper = await paperRef(sha, filename);
  return { row, paper, sender: new PaperSender({ full: paper, mode: sendingMode(), digest: row.digest, slicer: storedSlicer(sha, filename) }) };
}

/**
 * Saves a paper's digest once; a library paper's is shared by every reader. The first one saved wins,
 * so two readers making one at the same moment can't leave calls with different (uncacheable) prefixes.
 */
export async function saveDigest(paperId: string, digest: PaperDigest) {
  const { error } = await db().from("papers").update({ digest }).eq("id", paperId).is("digest", null);
  if (error) throw new Error(`Couldn’t save the digest: ${error.message}`);
}
