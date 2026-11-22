// GET /api/account/usage — every model call made for the signed-in user, newest first,
// with the paper it was for and which key paid. Powers the usage page.
import { db } from "@/lib/db";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 200;

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { data, error } = await db()
      .from("usage_events")
      .select("id, created_at, step, model, key_source, input_tokens, output_tokens, cached_tokens, cost_usd, paper_id, papers(title, name)")
      .eq("owner", user.id)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    return Response.json({ events: data }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[account:usage] failed", err);
    return json(500, "Couldn’t load your usage.");
  }
}
