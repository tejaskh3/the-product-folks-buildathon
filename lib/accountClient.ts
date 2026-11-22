// Browser helpers for the account API (/api/account). The session cookie identifies the user.
export type Plan = "free" | "byok" | "starter" | "pro";

export interface Account {
  plan: Plan;
  status: string;
  billing: boolean;
  used: number;
  allowance: number | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManageBilling: boolean;
  key: { last4: string; updatedAt: string } | null;
}

export interface UsageEvent {
  id: number;
  created_at: string;
  step: string;
  model: string;
  key_source: "platform" | "byok";
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  paper_id: string | null;
  papers: { title: string | null; name: string | null } | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const getAccount = () => call<Account>("/api/account");
export const getUsage = () => call<{ events: UsageEvent[] }>("/api/account/usage").then((r) => r.events);

export const saveKey = (key: string) =>
  call<{ last4: string; creditLeft: number | null }>("/api/account/key", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });

export const removeKey = () => call<null>("/api/account/key", { method: "DELETE" });

export const PLAN_LABEL: Record<Plan, string> = { free: "Free", byok: "Your own key", starter: "Starter", pro: "Pro" };

/** "1 of 2 free papers left", or null when there's no limit to show. */
export function papersLeft(a: Account): string | null {
  if (a.key && (a.plan === "byok" || !a.billing)) return null; // their own key pays
  if (a.allowance === null) return null;
  const left = Math.max(0, a.allowance - a.used);
  return a.plan === "free" ? `${left} of ${a.allowance} free papers left` : `${left} of ${a.allowance} papers left this month`;
}
