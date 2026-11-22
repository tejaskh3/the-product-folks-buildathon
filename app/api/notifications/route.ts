// POST /api/notifications — marks all of the reader's notifications read.
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { markAllRead } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    await markAllRead(user.id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[notifications] mark read failed", err);
    return json(500, "Couldn’t update notifications.");
  }
}
