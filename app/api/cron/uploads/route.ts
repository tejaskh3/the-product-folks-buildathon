// GET /api/cron/uploads — daily cleanup of big uploads staged in Storage (Vercel Cron, see vercel.json).
// A staged PDF is removed when it's finished; this catches the rest: uploads the browser started
// but never finished (tab closed, network dropped), older than a day. Rows go with their objects.
import { cleanupStaged } from "@/lib/pdfStore";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anyone else is turned away.
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, "Unauthorized");

  try {
    const removed = await cleanupStaged();
    console.log(`[cron:uploads] removed ${removed} staged upload(s)`);
    return Response.json({ removed });
  } catch (err) {
    console.error("[cron:uploads] cleanup failed", err);
    return json(500, "Cleanup failed");
  }
}
