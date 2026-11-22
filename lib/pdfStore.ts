// Server-only: paper PDFs in the private "papers" Storage bucket, named by their sha256.
// The model reads them through a short-lived signed URL. Only local Supabase (unreachable from
// OpenRouter) falls back to base64, so a 15 MB paper never rides inside a model request in production.
// Big uploads arrive under incoming/ first (staged uploads, at the end of this file).
// With PAPER_SENDING=digest, page slices of a paper are cached beside it as slices/<sha>/p4-5-6.pdf.
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import type { PaperRef } from "./llm";
import { sliceName, type Slicer } from "./paperSending";
import { pagesLabel, pdfPageCount, slicePages, slicePdf } from "./pdfSlice";

const BUCKET = "papers";
export const MAX_PAGES = 60;
/** Long enough for a full walkthrough plus a resume; one URL is reused per run so the prompt prefix stays cacheable. */
const SIGNED_URL_SECONDS = 60 * 60;

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const pathFor = (sha: string) => `${sha}.pdf`;
const slicePath = (sha: string, pages: number[]) => `slices/${sha}/${pagesLabel(pages)}.pdf`;
// Local Supabase (dev, tests) isn't reachable from OpenRouter, so those PDFs are sent as bytes instead.
const isLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
const asDataUrl = (pdf: Buffer) => `data:application/pdf;base64,${pdf.toString("base64")}`;

/** Counts pages without a PDF library: each page object carries "/Type /Page" (the page tree is "/Pages"). */
export function pageCount(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

async function upload(path: string, pdf: Buffer) {
  const { error } = await db().storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: false });
  // "already exists" means another upload of the same bytes got there first: fine.
  if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`Storing the PDF failed: ${error.message}`);
}

async function download(path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn’t read the stored PDF: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function sign(path: string, seconds: number): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`Couldn’t sign the PDF URL: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

/** Stores the PDF once (same bytes → same object) and returns its sha256. */
export async function storePdf(pdf: Buffer): Promise<string> {
  const sha = sha256(pdf);
  await upload(pathFor(sha), pdf);
  return sha;
}

/** A signed URL the model (and the reader's browser) can fetch the PDF from. */
export async function signedPdfUrl(sha: string, seconds = SIGNED_URL_SECONDS): Promise<string> {
  return sign(pathFor(sha), seconds);
}

export async function paperRef(sha: string, filename: string): Promise<PaperRef> {
  const url = await signedPdfUrl(sha);
  if (isLocal(url)) return paperRefBase64(sha, filename);
  return { filename, data: url };
}

/** The same paper inlined as base64, for providers that won't fetch a URL. */
export async function paperRefBase64(sha: string, filename: string): Promise<PaperRef> {
  return { filename, data: asDataUrl(await download(pathFor(sha))) };
}

/** Page counts of stored papers, so a cached slice never needs the original downloaded again. */
const pageCounts = new Map<string, number>();

/**
 * Page slices of a stored paper, each cut once and cached in storage by sha + pages.
 * The original is downloaded at most once per slicer (one walkthrough run, one question).
 */
export function storedSlicer(sha: string, filename: string): Slicer {
  let original: Promise<Buffer> | null = null;
  const load = () => (original ??= download(pathFor(sha)));
  return async (cited) => {
    let total = pageCounts.get(sha);
    if (total === undefined) {
      total = await pdfPageCount(await load());
      pageCounts.set(sha, total);
    }
    const pages = slicePages(cited, total);
    if (!pages.length) throw new Error(`none of pages ${cited.join(",")} are in this ${total}-page paper`);
    const name = sliceName(filename, pages);
    const path = slicePath(sha, pages);

    let bytes: Buffer | null = null;
    let url = await sign(path, SIGNED_URL_SECONDS).catch(() => null);
    if (!url) {
      bytes = await slicePdf(await load(), pages);
      try {
        await upload(path, bytes);
        url = await sign(path, SIGNED_URL_SECONDS);
      } catch (err) {
        // Caching is an optimisation: the slice still goes out, inline.
        console.warn(`[sending] couldn’t cache slice ${path}:`, err instanceof Error ? err.message : err);
      }
    }
    if (url && !isLocal(url)) return { filename: name, data: url, pages };
    return { filename: name, data: asDataUrl(bytes ?? (await download(path))), pages };
  };
}

// ---- Staged uploads (PDFs over 4 MB) -----------------------------------------
//
// The browser PUTs a big PDF to a signed URL under incoming/<owner>/, never to a final <sha>.pdf
// path; the server then reads the staged object, checks and hashes it, and stores it like any
// other. staged_uploads binds each path to the user who started it and lets it be finished once.

/** Storage signs upload URLs for 2 hours; a staged upload can be finished a little after that. */
const STAGED_FINISH_MS = 3 * 3600 * 1000;
/** Staged uploads older than this are abandoned: the cleanup cron removes them. */
export const STAGED_MAX_AGE_MS = 24 * 3600 * 1000;

const ownerFolder = (owner: string) => owner.replace(/[^A-Za-z0-9_-]/g, "_");
export const isStagedPath = (p: unknown): p is string => typeof p === "string" && /^incoming\/[A-Za-z0-9_-]{1,200}\/[0-9a-f-]{36}\.pdf$/.test(p);

/** Records a staged upload for `owner` and returns where the browser should PUT the file. */
export async function startStagedUpload(owner: string): Promise<{ path: string; signedUrl: string }> {
  const path = `incoming/${ownerFolder(owner)}/${randomUUID()}.pdf`;
  const { error: rowErr } = await db().from("staged_uploads").insert({ path, owner });
  if (rowErr) throw new Error(`Recording the upload failed: ${rowErr.message}`);
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Couldn’t sign the upload URL: ${error?.message ?? "no data"}`);
  return { path, signedUrl: data.signedUrl };
}

/**
 * Claims `owner`'s staged upload (theirs, not finished, not expired) and returns its bytes.
 * The claim is atomic and one-shot, so a second finish of the same path is refused ("unknown").
 * The staged object is removed as soon as it's read.
 */
export async function takeStagedUpload(owner: string, path: string): Promise<{ pdf: Buffer } | { pdf: null; reason: "unknown" | "missing" }> {
  const { data: claimed, error } = await db()
    .from("staged_uploads")
    .update({ finished_at: new Date().toISOString() })
    .eq("path", path)
    .eq("owner", owner)
    .is("finished_at", null)
    .gte("created_at", new Date(Date.now() - STAGED_FINISH_MS).toISOString())
    .select("path")
    .maybeSingle();
  if (error) throw new Error(`Claiming the upload failed: ${error.message}`);
  if (!claimed) return { pdf: null, reason: "unknown" };

  const { data, error: dlErr } = await db().storage.from(BUCKET).download(path);
  await removeStaged([path]);
  if (dlErr || !data) return { pdf: null, reason: "missing" };
  return { pdf: Buffer.from(await data.arrayBuffer()) };
}

/** Removes staged objects; ones already gone are fine. */
async function removeStaged(paths: string[]) {
  const { error } = await db().storage.from(BUCKET).remove(paths);
  if (error) console.error("[pdfStore] removing staged uploads failed", error.message);
}

/** Removes staged uploads started before `before` (abandoned or finished): objects, then rows. Returns how many. */
export async function cleanupStaged(before = new Date(Date.now() - STAGED_MAX_AGE_MS)): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data: rows, error } = await db().from("staged_uploads").select("path").lt("created_at", before.toISOString()).limit(500);
    if (error) throw new Error(`Listing staged uploads failed: ${error.message}`);
    if (!rows.length) return removed;
    const paths = rows.map((r) => r.path as string);
    const { error: rmErr } = await db().storage.from(BUCKET).remove(paths);
    if (rmErr) throw new Error(`Removing staged uploads failed: ${rmErr.message}`);
    const { error: delErr } = await db().from("staged_uploads").delete().in("path", paths);
    if (delErr) throw new Error(`Forgetting staged uploads failed: ${delErr.message}`);
    removed += paths.length;
  }
}
