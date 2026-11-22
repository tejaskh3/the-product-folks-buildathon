// The plans, as the pricing page and the paywall show them. Allowances must match
// plan_allowance() in SQL and ALLOWANCE in lib/account.ts.
import type { Plan } from "./accountClient";

export interface PlanCard {
  plan: Plan;
  name: string;
  price: string;
  papers: string;
  points: string[];
}

export const PLANS: PlanCard[] = [
  {
    plan: "free",
    name: "Free",
    price: "$0",
    papers: "2 papers",
    points: ["Full walkthrough and questions on 2 papers", "The whole library to read"],
  },
  {
    plan: "starter",
    name: "Starter",
    price: "$5/mo",
    papers: "10 papers a month",
    points: ["Ask and click deeper as much as you like", "Everything saved to your account"],
  },
  {
    plan: "pro",
    name: "Pro",
    price: "$10/mo",
    papers: "30 papers a month",
    points: ["For reading groups and literature reviews", "Ask and click deeper as much as you like"],
  },
  {
    plan: "byok",
    name: "Your own key",
    price: "$2/mo",
    papers: "Unlimited papers",
    points: ["Bring your own OpenRouter key; model costs go to it", "No limits from us"],
  },
];

/** Opens Dodo checkout for a plan, then comes back to `next` once it's active. */
export async function startCheckout(plan: Exclude<Plan, "free">, next: string): Promise<void> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan, next }),
  });
  const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !body?.url) throw new Error(body?.error ?? "Couldn’t open checkout.");
  window.location.assign(body.url);
}

export async function openBillingPortal(): Promise<void> {
  const res = await fetch("/api/billing/portal", { method: "POST" });
  const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !body?.url) throw new Error(body?.error ?? "Couldn’t open billing.");
  window.location.assign(body.url);
}
