// GET /api/play/shelf → the signed-in reader's shelf: their papers, favorites, bookmarks, history.
// The Library tab reads /library's list, which is public; this is everything private.
import { currentUser } from "@/lib/auth";
import { json } from "@/lib/playServer";
import { shelf } from "@/lib/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return json(401, "Sign in to see your shelf.");
  try {
    return Response.json(await shelf(user.id), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[shelf] failed", err);
    return json(500, "Couldn’t load your shelf.");
  }
}
