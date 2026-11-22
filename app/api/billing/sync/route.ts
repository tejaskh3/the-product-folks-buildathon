// POST /api/billing/sync {subscriptionId} — the return page's "Activating your plan…" check.
// Asks Dodo for the subscription and saves it (the same code the webhook runs), so the plan
// is live the moment they land back, even if the webhook hasn't arrived yet.
import { BillingUnavailable, dodo, syncSubscription } from "@/lib/billing";
import { currentProfile } from "@/lib/auth";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { subscriptionId } = ((await req.json().catch(() => ({}))) ?? {}) as { subscriptionId?: unknown };
  if (typeof subscriptionId !== "string" || !/^[\w-]{4,80}$/.test(subscriptionId)) return json(400, "Missing subscription.");
  try {
    const sub = await dodo().subscriptions.retrieve(subscriptionId);
    if (sub.status === "pending") return Response.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
    const saved = await syncSubscription(sub, { owner: user.id, email: (await currentProfile()).email });
    if (!saved) return json(403, "That subscription belongs to a different account.");
    return Response.json({ status: saved.status, plan: saved.plan }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BillingUnavailable) return json(503, err.message);
    console.error("[billing:sync] failed", err);
    return json(502, "Couldn’t reach the payment provider.");
  }
}
