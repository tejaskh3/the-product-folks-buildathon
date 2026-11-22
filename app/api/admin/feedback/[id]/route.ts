// PATCH /api/admin/feedback/:id {done} — ticks a submission off on /admin. Admins only (404 otherwise).
import { currentAdmin } from "@/lib/admin";
import { setFeedbackDone } from "@/lib/feedback";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentAdmin())) return json(404, "Not found.");
  const { id } = await params;
  const { done } = ((await req.json().catch(() => ({}))) ?? {}) as { done?: unknown };
  if (typeof done !== "boolean") return json(400, "Missing done.");
  try {
    if (!(await setFeedbackDone(id, done))) return json(404, "Not found.");
    return Response.json({ id, done }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[admin:feedback] couldn’t update", err);
    return json(503, "Couldn’t save that.");
  }
}
