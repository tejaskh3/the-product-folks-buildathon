// Server-only: may this user generate on this paper, and whose OpenRouter key pays?
//
//   authorize(owner, paper, kind, ctx) ─► SQL authorize_generation (one round trip, one lock per user;
//                                          two for a new free paper, to check the email)
//        └─► { allowed, reason, plan, keySource, apiKey }
//   apiKey: the user's own key (BYOK), else the platform key for their tier. Each tier's key has
//   its own spending limit set in OpenRouter, so a runaway free tier can't eat paid users' budget.
//
// BILLING_ENABLED=false (the default until checkout exists): nobody is denied, but papers
// are still counted, so the numbers are real when billing switches on.
//
// A new free paper on our key also passes the abuse checks (lib/abuse.ts): a disposable email
// is refused, and so is an IP that already opened FREE_PAPERS_PER_IP_DAY free papers today.
import { freePapersPerIpDay, ipHash, isDisposableEmail } from "./abuse";
import { db } from "./db";
import { userKey } from "./keys";
import { LlmError } from "./llm";
import type { KeySource } from "./usage";

export type Plan = "free" | "byok" | "starter" | "pro";
export type GenerationKind = "paper" | "question";

export const billingEnabled = () => process.env.BILLING_ENABLED === "true";
const DAILY_QUESTION_CAP = Number(process.env.DAILY_QUESTION_CAP ?? 100);

export interface Decision {
  allowed: boolean;
  reason: "already_counted" | "reserved" | "quota" | "daily_cap" | "ip_limit" | "disposable_email";
  plan: Plan;
  keySource: KeySource;
  reservedNow: boolean;
  used?: number;
  allowance?: number | null;
}

const MESSAGES: Partial<Record<Decision["reason"], string>> = {
  daily_cap: "You’ve explored a lot today. Come back tomorrow for more questions, or add your own OpenRouter key in Settings.",
  ip_limit: "Too many free papers from this network today. Try again tomorrow, or pick a plan.",
  disposable_email: "Free papers need a permanent email address. Sign in with one, or pick a plan.",
};

export class NotAllowed extends Error {
  constructor(readonly decision: Decision) {
    super(MESSAGES[decision.reason] ?? `You’ve used all ${decision.allowance ?? ""} papers on your plan. Upgrade to keep going.`);
  }
}

/** Who's asking, for the abuse checks. Without it (scripts, tests) neither check runs. */
export interface RequestContext {
  ip?: string | null;
  /** The user's primary email. Only called when a new free paper is about to be counted. */
  email?: () => Promise<string | null>;
}

type Row = {
  allowed: boolean;
  reason: Decision["reason"] | "check_email";
  plan: Plan;
  key_source: KeySource;
  reserved_now?: boolean;
  used?: number;
  allowance?: number | null;
};

export async function authorize(owner: string, paperId: string, kind: GenerationKind, ctx: RequestContext = {}): Promise<Decision> {
  const call = async (disposable: boolean | null) => {
    const { data, error } = await db().rpc("authorize_generation", {
      p_owner: owner,
      p_paper: paperId,
      p_kind: kind,
      p_billing: billingEnabled(),
      p_daily_cap: DAILY_QUESTION_CAP,
      p_ip_hash: ipHash(ctx.ip ?? null),
      p_ip_limit: freePapersPerIpDay(),
      p_email_disposable: disposable,
    });
    if (error) throw new Error(`Couldn’t check your plan: ${error.message}`);
    return data as Row;
  };
  // null: SQL stops at "check_email" only if a new free paper would be counted. Then the email
  // is looked up (one Clerk call) and the whole decision is taken again under the same locks.
  let d = await call(ctx.email ? null : false);
  if (d.reason === "check_email") d = await call(isDisposableEmail(await ctx.email!().catch(() => null)));
  if (d.reason === "check_email") throw new Error("Couldn’t check your plan: the email check didn’t settle");
  return { allowed: d.allowed, reason: d.reason, plan: d.plan, keySource: d.key_source, reservedNow: !!d.reserved_now, used: d.used, allowance: d.allowance };
}

/** The Anthropic API key that pays for this decision. Curio calls Claude directly, so it's always the platform key. */
export async function keyFor(owner: string, d: Decision): Promise<string> {
  void owner;
  void d;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LlmError("AtCapacity", "ANTHROPIC_API_KEY is not configured");
  return key;
}

export async function markUsed(owner: string, paperId: string) {
  const { error } = await db().rpc("mark_paper_used", { p_owner: owner, p_paper: paperId });
  if (error) console.error(`[entitlements] couldn’t mark ${paperId} used for ${owner}`, error.message);
}

export async function refund(owner: string, paperId: string) {
  const { error } = await db().rpc("refund_paper", { p_owner: owner, p_paper: paperId });
  if (error) console.error(`[entitlements] couldn’t refund ${paperId} for ${owner}`, error.message);
}

/** Our own key running dry is our capacity problem, not the user's key: say so. */
export function forUser(err: unknown, d: Decision | null): unknown {
  if (d?.keySource === "platform" && err instanceof LlmError && (err.kind === "OutOfCredit" || err.kind === "KeyInvalid"))
    return new LlmError("AtCapacity", err.message, err.status);
  return err;
}

/**
 * 402 with a reason the client can act on: the paywall ("quota"), "come back tomorrow" ("daily_cap"),
 * or the abuse checks ("ip_limit", "disposable_email"), shown as the plans with their own heading.
 */
export function notAllowedResponse(d: Decision): Response {
  return Response.json(
    { error: new NotAllowed(d).message, reason: d.reason, plan: d.plan, used: d.used, allowance: d.allowance },
    { status: 402, headers: { "cache-control": "no-store" } },
  );
}
