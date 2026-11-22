// GET /api/cron/spend — daily spend check on Curio's own OpenRouter keys (Vercel Cron, see vercel.json).
// Sums the last 24 h of platform-key usage; over SPEND_ALERT_USD it logs an error and, if
// SPEND_ALERT_WEBHOOK is set (a Slack-style incoming webhook), posts the total and the top spenders.
// The hard stop is the spending limit on each OpenRouter key; this is the early warning.
import { db } from "@/lib/db";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THRESHOLD = Number(process.env.SPEND_ALERT_USD ?? 5);

export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anyone else is turned away.
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, "Unauthorized");

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // Supabase returns at most 1000 rows per request, so read the day in pages.
  const PAGE = 1000;
  const data: { owner: string; cost_usd: number | string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await db()
      .from("usage_events")
      .select("owner, cost_usd")
      .eq("key_source", "platform")
      .gte("created_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[cron:spend] query failed", error.message);
      return json(500, "Query failed");
    }
    data.push(...rows);
    if (rows.length < PAGE) break;
  }

  const byOwner = new Map<string, number>();
  for (const r of data) byOwner.set(r.owner, (byOwner.get(r.owner) ?? 0) + Number(r.cost_usd));
  const total = [...byOwner.values()].reduce((a, b) => a + b, 0);
  const top = [...byOwner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const summary = { total: Number(total.toFixed(4)), calls: data.length, users: byOwner.size, top, threshold: THRESHOLD };

  if (total > THRESHOLD) {
    console.error(`[cron:spend] platform spend $${total.toFixed(2)} in 24 h is over $${THRESHOLD}`, summary);
    const hook = process.env.SPEND_ALERT_WEBHOOK;
    if (hook) {
      const lines = top.map(([o, c]) => `• ${o}: $${c.toFixed(2)}`).join("\n");
      await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `Curio spent $${total.toFixed(2)} on its OpenRouter keys in the last 24 h (alert at $${THRESHOLD}).\nTop users:\n${lines}` }),
      }).catch((e: unknown) => console.error("[cron:spend] webhook failed", e));
    }
  } else {
    console.log(`[cron:spend] platform spend $${total.toFixed(2)} in 24 h`, summary);
  }
  return Response.json(summary);
}
