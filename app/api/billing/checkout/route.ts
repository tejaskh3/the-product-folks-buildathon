// POST /api/billing/checkout {plan, next?} → { url }: a Dodo hosted checkout for the signed-in user.
// After paying, Dodo sends them to /billing/return, which activates the plan and goes back to `next`.
// Already subscribed: the subscription is moved to the new plan instead (no second subscription),
// and the url is the return page directly.
import { BillingUnavailable, PAID_PLANS, changePlan, createCheckout, safeNext, type PaidPlan } from "@/lib/billing";
import { currentProfile } from "@/lib/auth";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { plan?: unknown; next?: unknown };
  if (!PAID_PLANS.includes(body.plan as PaidPlan)) return json(400, "Pick a plan.");
  const returnUrl = new URL("/billing/return", req.url);
  returnUrl.searchParams.set("next", safeNext(body.next));
  try {
    const changed = await changePlan(user.id, body.plan as PaidPlan);
    if (changed) {
      returnUrl.searchParams.set("subscription_id", changed);
      return Response.json({ url: returnUrl.toString() }, { headers: { "cache-control": "no-store" } });
    }
    const { email, name } = await currentProfile();
    const url = await createCheckout({ owner: user.id, email, name, plan: body.plan as PaidPlan, returnUrl: returnUrl.toString() });
    return Response.json({ url }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BillingUnavailable) return json(503, err.message);
    console.error("[billing:checkout] failed", err);
    return json(502, "Couldn’t open checkout. Please try again.");
  }
}
