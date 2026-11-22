// GET /api/admin/feedback?kind=feedback|feature|paper — the inbox, newest first. Admins only;
// everyone else gets a 404, so the route doesn't advertise itself.
import { currentAdmin } from "@/lib/admin";
import { isKind, listFeedback } from "@/lib/feedback";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await currentAdmin())) return json(404, "Not found.");
  const kind = new URL(req.url).searchParams.get("kind");
  try {
    return Response.json({ feedback: await listFeedback({ kind: isKind(kind) ? kind : null }) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[admin:feedback] couldn’t list", err);
    return json(503, "Couldn’t load feedback.");
  }
}
