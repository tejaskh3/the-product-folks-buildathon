// POST /api/play/upload — takes a PDF (multipart, ≤ 4 MB) or {arxiv}, stores the PDF and
// creates (or reopens) the signed-in user's saved paper. Returns the paper id every later call uses.
// Bigger PDFs (≤ 15 MB) go straight to Storage instead: see ./start and ./finish.
//
//   bytes ──► checks ──► openUploadedPaper (lib/paperUpload: library copy, demo, or the user's row)
import { libraryPaper } from "@/lib/db";
import { signInRequired } from "@/lib/playAuth";
import { arxivId, json } from "@/lib/playServer";
import { currentUser } from "@/lib/auth";
import { findDemo } from "@/lib/walkthroughServer";
import { MAX_ARXIV_BYTES, MAX_UPLOAD_BYTES, PaperUnavailable, checkPdf, fetchArxivPdf } from "@/lib/paperSource";
import { openUploadedPaper } from "@/lib/paperUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();

  let pdf: Buffer;
  let name = "paper.pdf";
  let arxiv: string | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json(400, "No PDF attached.");
      if (file.size > MAX_UPLOAD_BYTES) return json(413, "That PDF is over 4 MB.");
      pdf = Buffer.from(await file.arrayBuffer());
      name = file.name || name;
      checkPdf(pdf, MAX_UPLOAD_BYTES);
    } else {
      const { arxiv: input } = ((await req.json().catch(() => ({}))) ?? {}) as { arxiv?: unknown };
      const id = typeof input === "string" ? arxivId(input) : null;
      if (!id) return json(400, "That doesn’t look like an arXiv link or ID.");
      arxiv = id.replace(/v\d+$/, "");
      // Signed-out visitors may only open the demo papers, so don't download anything else for them.
      if (!user && !(await libraryPaper({ key: `arxiv:${arxiv}` })) && !(await findDemo({ arxiv }))) return signInRequired();
      pdf = await fetchArxivPdf(id);
      name = `${id.replace(/\//g, "_")}.pdf`;
      checkPdf(pdf, MAX_ARXIV_BYTES);
    }
  } catch (err) {
    if (err instanceof PaperUnavailable) return json(err.status, err.message);
    console.error("[play:upload] couldn’t read the upload", err);
    return json(400, "Couldn’t read that upload.");
  }

  return openUploadedPaper({ user, pdf, name, arxiv });
}
