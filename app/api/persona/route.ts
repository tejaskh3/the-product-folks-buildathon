// GET /api/persona — {persona, notifications, unread} for the reader.
// POST /api/persona — {name, role, topics[]} → saves the persona (new topics get a starter feed).
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { getPersona, listNotifications, savePersona } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

async function state(owner: string) {
  const [persona, notifications] = await Promise.all([getPersona(owner), listNotifications(owner)]);
  return { persona, notifications, unread: notifications.filter((n) => !n.read).length };
}

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    return Response.json(await state(user.id), { headers: noStore });
  } catch (err) {
    console.error("[persona] load failed", err);
    return json(500, "Couldn’t load your persona.");
  }
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { name?: unknown; role?: unknown; topics?: unknown };
  const topics = Array.isArray(body.topics) ? body.topics.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
  if (typeof body.name !== "string" || !body.name.trim()) return json(400, "Tell us your name.");
  if (!topics.length) return json(400, "Pick at least one topic.");
  try {
    await savePersona(user.id, { name: body.name, role: typeof body.role === "string" ? body.role : "", topics });
    return Response.json(await state(user.id), { headers: noStore });
  } catch (err) {
    console.error("[persona] save failed", err);
    return json(500, "Couldn’t save your persona.");
  }
}
