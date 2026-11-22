// GET /api/account — the signed-in user's plan, papers used, and whether they've added a key.
import { accountSummary } from "@/lib/account";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    return Response.json(await accountSummary(user.id), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[account] summary failed", err);
    return json(500, "Couldn’t load your account.");
  }
}
