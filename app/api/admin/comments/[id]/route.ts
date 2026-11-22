// PATCH /api/admin/comments/:id {action: "restore" | "delete"} — moderation on /admin. Admins only (404 otherwise).
import { currentAdmin } from "@/lib/admin";
import { moderate } from "@/lib/comments";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentAdmin())) return json(404, "Not found.");
  const { id } = await params;
  const { action } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: unknown };
  if (action !== "restore" && action !== "delete") return json(400, "Restore or delete?");
  try {
    if (!(await moderate(id, action))) return json(404, "Not found.");
    return Response.json({ id, action }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[admin:comments] couldn’t update", err);
    return json(503, "Couldn’t save that.");
  }
}
