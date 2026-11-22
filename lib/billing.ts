// Server-only: Dodo Payments subscriptions.
//
//   /pricing ─► POST /api/billing/checkout ─► Dodo hosted checkout (metadata.owner = Clerk id)
//        ┌──────────────────────────────────────────────┘
//        ├─► webhook ─► verify ─► dedupe ─► re-fetch subscription ─► syncSubscription ─► subscriptions
//        └─► /billing/return ─► POST /api/billing/sync ─► re-fetch ─► syncSubscription (same code)
//
// Webhooks and the return page never trust the event's own copy: both ask Dodo for the
// subscription and save that, so out-of-order or replayed events can't set a stale state.
import DodoPayments from "dodopayments";
import type { Subscription } from "dodopayments/resources/subscriptions";
import { db } from "./db";
import type { Plan } from "./entitlements";

export type PaidPlan = Exclude<Plan, "free">;
export const PAID_PLANS: PaidPlan[] = ["byok", "starter", "pro"];

const PRODUCT_ENV: Record<PaidPlan, string> = { byok: "DODO_PRODUCT_BYOK", starter: "DODO_PRODUCT_STARTER", pro: "DODO_PRODUCT_PRO" };

/** Only same-site paths, so the return page can't be turned into an open redirect. */
export const safeNext = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&%.]*$/.test(v) ? v : "/play");

export class BillingUnavailable extends Error {}

let client: DodoPayments | null = null;

export function dodo(): DodoPayments {
  if (client) return client;
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) throw new BillingUnavailable("Payments aren’t set up yet.");
  client = new DodoPayments({ bearerToken, environment: process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode" });
  return client;
}

export function productFor(plan: PaidPlan): string {
  const id = process.env[PRODUCT_ENV[plan]];
  if (!id) throw new BillingUnavailable("Payments aren’t set up yet.");
  return id;
}

export function planForProduct(productId: string): PaidPlan | null {
  return PAID_PLANS.find((p) => process.env[PRODUCT_ENV[p]] === productId) ?? null;
}

/** Dodo's status → ours. Pending isn't paid yet; on hold / past due lose the plan until paid. */
export function statusFor(s: Subscription["status"]): "active" | "past_due" | "canceled" | "expired" | null {
  switch (s) {
    case "active":
      return "active";
    case "on_hold":
    case "past_due":
    case "paused":
      return "past_due";
    case "cancelled":
      return "canceled";
    case "failed":
    case "expired":
      return "expired";
    default:
      return null; // pending: nothing to save yet
  }
}

/**
 * Saves Dodo's current view of a subscription. Returns the owner it was saved for, or null
 * when it can't be tied to a user (no owner in metadata and no row with this subscription).
 * `claim`: the signed-in user on the return page. A subscription that names someone else is
 * refused; one that names nobody is theirs only if Dodo's customer email is their email.
 */
export async function syncSubscription(
  sub: Subscription,
  claim?: { owner: string; email: string | null },
): Promise<{ owner: string; plan: PaidPlan; status: string } | null> {
  let owner = typeof sub.metadata?.owner === "string" ? sub.metadata.owner : null;
  if (!owner) {
    const { data } = await db().from("subscriptions").select("owner").eq("dodo_subscription_id", sub.subscription_id).maybeSingle();
    owner = (data?.owner as string | undefined) ?? null;
  }
  if (!owner && claim?.email && sub.customer.email?.toLowerCase() === claim.email.toLowerCase()) owner = claim.owner;
  if (!owner || (claim && owner !== claim.owner)) return null;

  const plan = planForProduct(sub.product_id);
  const status = statusFor(sub.status);
  if (!plan || !status) return null;

  // A different subscription already on the row (e.g. resubscribed): only the newest active one wins.
  const { data: existing } = await db().from("subscriptions").select("dodo_subscription_id, status").eq("owner", owner).maybeSingle();
  if (existing?.dodo_subscription_id && existing.dodo_subscription_id !== sub.subscription_id && existing.status === "active" && status !== "active")
    return { owner, plan, status: existing.status as string };

  const { error } = await db()
    .from("subscriptions")
    .upsert(
      {
        owner,
        plan,
        status,
        period_start: sub.previous_billing_date,
        period_end: sub.next_billing_date,
        cancel_at_period_end: sub.cancel_at_next_billing_date,
        dodo_customer_id: sub.customer.customer_id,
        dodo_subscription_id: sub.subscription_id,
        dodo_product_id: sub.product_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner" },
    );
  if (error) throw new Error(`Couldn’t save the subscription: ${error.message}`);
  return { owner, plan, status };
}

const PRICE_RANK: Record<PaidPlan, number> = { byok: 1, starter: 2, pro: 3 };

/** The user's subscription that Dodo is still billing, if any: a new plan changes it instead of adding a second one. */
async function liveSubscription(owner: string): Promise<{ id: string; plan: PaidPlan } | null> {
  const { data } = await db().from("subscriptions").select("plan, status, dodo_subscription_id").eq("owner", owner).maybeSingle();
  if (!data?.dodo_subscription_id || data.status === "expired" || data.status === "canceled") return null;
  return { id: data.dodo_subscription_id as string, plan: data.plan as PaidPlan };
}

/**
 * Moves an existing subscription to another plan. Upgrades apply now (prorated, and only if the
 * charge succeeds); downgrades apply at the next renewal, so nobody loses papers they paid for.
 * Returns the subscription id, or null when there's no live subscription to change.
 */
export async function changePlan(owner: string, plan: PaidPlan): Promise<string | null> {
  const live = await liveSubscription(owner);
  if (!live) return null;
  if (live.plan === plan) return live.id;
  const upgrade = PRICE_RANK[plan] > PRICE_RANK[live.plan];
  await dodo().subscriptions.changePlan(live.id, {
    product_id: productFor(plan),
    quantity: 1,
    ...(upgrade
      ? { proration_billing_mode: "prorated_immediately", effective_at: "immediately", on_payment_failure: "prevent_change" }
      : { proration_billing_mode: "do_not_bill", effective_at: "next_billing_date", cancel_scheduled_change_plan: true }),
  });
  await syncSubscription(await dodo().subscriptions.retrieve(live.id));
  return live.id;
}

/** A hosted checkout for this plan, tied to the signed-in user. Returns Dodo's checkout URL. */
export async function createCheckout(opts: { owner: string; email: string | null; name: string | null; plan: PaidPlan; returnUrl: string }): Promise<string> {
  const { data: sub } = await db().from("subscriptions").select("dodo_customer_id").eq("owner", opts.owner).maybeSingle();
  const customer = sub?.dodo_customer_id
    ? { customer_id: sub.dodo_customer_id as string }
    : opts.email
      ? { email: opts.email, name: opts.name || opts.email.split("@")[0] }
      : undefined;
  const session = await dodo().checkoutSessions.create({
    product_cart: [{ product_id: productFor(opts.plan), quantity: 1 }],
    ...(customer ? { customer } : {}),
    return_url: opts.returnUrl,
    metadata: { owner: opts.owner, plan: opts.plan },
  });
  if (!session.checkout_url) throw new Error("Dodo didn’t return a checkout link.");
  return session.checkout_url;
}

/** Dodo's customer portal for this user (cancel, change card, invoices). */
export async function portalUrl(owner: string): Promise<string | null> {
  const { data: sub } = await db().from("subscriptions").select("dodo_customer_id").eq("owner", owner).maybeSingle();
  if (!sub?.dodo_customer_id) return null;
  const portal = await dodo().customers.customerPortal.create(sub.dodo_customer_id as string);
  return portal.link;
}
