// POST /api/play/upload/start — {size} → {path, signedUrl}, for PDFs over 4 MB (signed in only).
// The browser PUTs the file to signedUrl, straight to Storage, then calls ./finish with the path.
// The path is a staging one the server picks (incoming/<owner>/<uuid>.pdf), never a final one.
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { startStagedUpload } from "@/lib/pdfStore";
import { MAX_PDF_BYTES } from "@/lib/uploadLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { size } = ((await req.json().catch(() => ({}))) ?? {}) as { size?: unknown };
  // The bucket enforces the real limit; this just saves a doomed upload.
  if (typeof size === "number" && size > MAX_PDF_BYTES) return json(413, "That PDF is over 15 MB.");

  try {
    const staged = await startStagedUpload(user.id);
    return Response.json(staged, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[play:upload:start] couldn’t start the upload", err);
    return json(502, "Couldn’t start the upload. Please try again.");
  }
}
