// GET /api/play/papers/:id/pdf — redirects to a short-lived signed URL for the paper's PDF,
// so the reading panel can show any saved paper (the user's own, or a public demo).
import { readablePaper } from "@/lib/db";
import { json } from "@/lib/playServer";
import { currentUser } from "@/lib/auth";
import { PaperUnavailable, ensurePdf } from "@/lib/paperSource";
import { signedPdfUrl } from "@/lib/pdfStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const paper = await readablePaper((await currentUser())?.id ?? null, id);
    if (!paper) return json(404, "That paper isn’t available.");
    const url = await signedPdfUrl(await ensurePdf(paper), 10 * 60);
    return Response.redirect(url, 302);
  } catch (err) {
    if (err instanceof PaperUnavailable) return json(err.status, err.message);
    console.error("[play:pdf] failed", err);
    return json(502, "Couldn’t load the PDF.");
  }
}
