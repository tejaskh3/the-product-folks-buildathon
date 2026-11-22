// Server-only: what the account page and the quota badge show. Mirrors authorize_generation's rules.
import { db } from "./db";
import { billingEnabled, type Plan } from "./entitlements";
import { userKeyInfo, type KeyInfo } from "./keys";

const ALLOWANCE: Record<Plan, number | null> = { free: 2, byok: null, starter: 10, pro: 30 };
const GRACE_MS = 86_400_000; // a late renewal webhook doesn't drop a paying user to free

export interface AccountSummary {
  plan: Plan;
  status: string;
  billing: boolean;
  /** Papers counted against the current allowance (free: ever; paid: this period). */
  used: number;
  allowance: number | null;
  periodEnd: string | null;
  /** The plan ends at periodEnd instead of renewing. */
  cancelAtPeriodEnd: boolean;
  /** Has a Dodo customer, so "Manage billing" can open their portal. */
  canManageBilling: boolean;
  key: KeyInfo | null;
}

export async function accountSummary(owner: string): Promise<AccountSummary> {
  const { data: sub, error } = await db().from("subscriptions").select("*").eq("owner", owner).maybeSingle();
  if (error) throw new Error(error.message);
  const active = !!sub && sub.status === "active" && (!sub.period_end || Date.parse(sub.period_end) + GRACE_MS > Date.now());
  const plan: Plan = active ? sub.plan : "free";
  const key = await userKeyInfo(owner);
  // BYOK without a key counts against the free allowance, like authorize_generation.
  const countAs: Plan = plan === "byok" && !key ? "free" : plan;

  let q = db().from("paper_uses").select("paper_id", { count: "exact", head: true }).eq("owner", owner).in("status", ["reserved", "used"]);
  if (countAs === "free") q = q.eq("plan", "free");
  else {
    q = q.in("plan", ["starter", "pro"]);
    q = sub?.period_start ? q.eq("period_start", sub.period_start) : q.is("period_start", null);
  }
  const { count, error: cErr } = await q;
  if (cErr) throw new Error(cErr.message);

  return {
    plan,
    status: sub?.status ?? "active",
    billing: billingEnabled(),
    used: count ?? 0,
    allowance: ALLOWANCE[countAs],
    periodEnd: active ? sub.period_end : null,
    cancelAtPeriodEnd: active && !!sub.cancel_at_period_end,
    canManageBilling: !!sub?.dodo_customer_id,
    key,
  };
}
