// POST /api/play/upload/finish — {path, name} after the browser PUT a big PDF to ./start's URL.
// Claims the staged upload (the caller's own, once, before it expires), reads and removes the
// staged object, checks it like any upload, then answers exactly as POST /api/play/upload does.
//
//   path ──► claim (owner, unfinished, fresh) ──► download ──► remove staged ──► checks ──► openUploadedPaper
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { PaperUnavailable, checkPdf } from "@/lib/paperSource";
import { isStagedPath, takeStagedUpload } from "@/lib/pdfStore";
import { openUploadedPaper } from "@/lib/paperUpload";
import { MAX_PDF_BYTES } from "@/lib/uploadLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { path, name } = ((await req.json().catch(() => ({}))) ?? {}) as { path?: unknown; name?: unknown };
  if (!isStagedPath(path)) return json(400, "That upload isn’t one Curio started.");

  let pdf: Buffer;
  try {
    const staged = await takeStagedUpload(user.id, path);
    // Someone else's path, one already finished, or one that expired all look the same.
    if (!staged.pdf) {
      return staged.reason === "missing"
        ? json(409, "The upload was interrupted. Please try again.")
        : json(404, "That upload has expired or was already used. Please try again.");
    }
    pdf = staged.pdf;
    checkPdf(pdf, MAX_PDF_BYTES);
  } catch (err) {
    if (err instanceof PaperUnavailable) return json(err.status, err.message);
    console.error("[play:upload:finish] couldn’t read the upload", err);
    return json(502, "Couldn’t read that upload. Please try again.");
  }

  const fileName = typeof name === "string" && name.trim() ? name.trim() : "paper.pdf";
  return openUploadedPaper({ user, pdf, name: fileName, arxiv: null });
}
