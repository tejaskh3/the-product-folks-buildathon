// Dodo billing against real Postgres: signed webhooks (dedupe, re-fetch), the return-page sync,
// checkout vs. plan change, the portal, and the quota rules PR3 changed. Dodo's API is faked;
// webhook signatures are real (Standard Webhooks). Skipped without local Supabase.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER = "";
let EMAIL: string | null = null;
vi.mock("@/lib/auth", () => ({
  currentUser: async () => (USER ? { id: USER } : null),
  currentEmail: async () => EMAIL,
  currentProfile: async () => ({ email: EMAIL, name: "Test Reader" }),
}));

// Dodo's side: the subscriptions it knows about, and every call we made.
const dodo = vi.hoisted(() => ({
  subs: new Map<string, Record<string, unknown>>(),
  retrieved: [] as string[],
  sessions: [] as Record<string, unknown>[],
  changes: [] as { id: string; body: Record<string, unknown> }[],
}));
vi.mock("dodopayments", () => ({
  default: class {
    subscriptions = {
      retrieve: async (id: string) => {
        dodo.retrieved.push(id);
        const s = dodo.subs.get(id);
        if (!s) throw new Error(`no subscription ${id}`);
        return s;
      },
      changePlan: async (id: string, body: Record<string, unknown>) => {
        dodo.changes.push({ id, body });
        const s = dodo.subs.get(id)!;
        if (body.effective_at === "immediately") dodo.subs.set(id, { ...s, product_id: body.product_id });
        return {};
      },
    };
    checkoutSessions = {
      create: async (body: Record<string, unknown>) => {
        dodo.sessions.push(body);
        return { session_id: "cks_1", checkout_url: "https://test.checkout.dodopayments.com/cks_1" };
      },
    };
    customers = { customerPortal: { create: async (id: string) => ({ link: `https://portal.test/${id}` }) } };
  },
}));

const SECRET_BYTES = randomBytes(24);
const day = 86_400_000;

/** Dodo's own test fixture shape (from @dodopayments/core), for one of our products. */
function subscription(over: Record<string, unknown> = {}) {
  return {
    payload_type: "Subscription",
    addons: [],
    billing: { city: null, country: "US", state: null, street: null, zipcode: null },
    brand_id: "brand_1",
    cancel_at_next_billing_date: false,
    created_at: new Date().toISOString(),
    credit_entitlement_cart: [],
    currency: "USD",
    customer: { customer_id: `cus_${randomUUID().slice(0, 8)}`, email: "reader@example.com", name: "Reader" },
    metadata: { owner: USER },
    meter_credit_entitlement_cart: [],
    meters: [],
    next_billing_date: new Date(Date.now() + 29 * day).toISOString(),
    on_demand: false,
    payment_frequency_count: 1,
    payment_frequency_interval: "Month",
    previous_billing_date: new Date(Date.now() - day).toISOString(),
    product_id: "prod_pro",
    quantity: 1,
    recurring_pre_tax_amount: 1000,
    status: "active",
    subscription_id: `sub_${randomUUID().slice(0, 8)}`,
    subscription_period_count: 1,
    subscription_period_interval: "Month",
    tax_inclusive: false,
    trial_period_days: 0,
    ...over,
  };
}

/** A webhook request signed the way Dodo signs them. */
function signed(type: string, data: Record<string, unknown>, opts: { id?: string; secret?: Buffer } = {}) {
  const id = opts.id ?? `msg_${randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ business_id: "biz_1", type, timestamp: new Date().toISOString(), data });
  const sig = createHmac("sha256", opts.secret ?? SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://x/api/billing/webhook", {
    method: "POST",
    body,
    headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` },
  });
}

describe.skipIf(!localSupabase)("billing (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;
  let authorize: typeof import("@/lib/entitlements").authorize;
  let webhook: typeof import("@/app/api/billing/webhook/route").POST;

  beforeAll(async () => {
    useLocalSupabase();
    Object.assign(process.env, {
      KEY_ENCRYPTION_SECRET: randomBytes(32).toString("base64"),
      DODO_PAYMENTS_API_KEY: "test_key",
      DODO_PAYMENTS_WEBHOOK_SECRET: `whsec_${SECRET_BYTES.toString("base64")}`,
      DODO_PRODUCT_BYOK: "prod_byok",
      DODO_PRODUCT_STARTER: "prod_starter",
      DODO_PRODUCT_PRO: "prod_pro",
    });
    ({ db } = await import("@/lib/db"));
    ({ authorize } = await import("@/lib/entitlements"));
    ({ POST: webhook } = await import("@/app/api/billing/webhook/route"));
  });

  beforeEach(() => {
    USER = `user_b_${randomUUID().slice(0, 8)}`;
    EMAIL = "reader@example.com";
    process.env.BILLING_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BILLING_ENABLED;
    dodo.subs.clear();
    dodo.retrieved.length = 0;
    dodo.sessions.length = 0;
    dodo.changes.length = 0;
  });

  const row = async () => (await db().from("subscriptions").select("*").eq("owner", USER).maybeSingle()).data;
  async function newPaper() {
    const { storePdf } = await import("@/lib/pdfStore");
    const sha = await storePdf(Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n2 0 obj << /Type /Page >> endobj\n`));
    const { data, error } = await db().from("papers").insert({ owner: USER, paper_key: `sha:${sha}`, pdf_sha256: sha }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  describe("webhook", () => {
    it("refuses a bad signature", async () => {
      const res = await webhook(signed("subscription.active", subscription(), { secret: randomBytes(24) }));
      expect(res.status).toBe(401);
      expect(await row()).toBeNull();
    });

    it("activates the plan from Dodo's current copy, and the quota follows it", async () => {
      const sub = subscription();
      dodo.subs.set(sub.subscription_id, sub);
      const res = await webhook(signed("subscription.active", sub));
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ plan: "pro", status: "active", dodo_subscription_id: sub.subscription_id, dodo_customer_id: sub.customer.customer_id });
      expect((await authorize(USER, await newPaper(), "paper")).plan).toBe("pro");
    });

    it("skips a delivery it has already handled", async () => {
      const sub = subscription();
      dodo.subs.set(sub.subscription_id, sub);
      const id = `msg_${randomUUID()}`;
      await webhook(signed("subscription.active", sub, { id }));
      const again = await webhook(signed("subscription.active", sub, { id }));
      expect(await again.json()).toMatchObject({ duplicate: true });
      expect(dodo.retrieved).toHaveLength(1);
    });

    it("an old event arriving late can't undo a newer state: Dodo's copy wins", async () => {
      const sub = subscription();
      dodo.subs.set(sub.subscription_id, { ...sub, status: "cancelled" }); // already cancelled at Dodo
      await webhook(signed("subscription.active", sub)); // the stale "active" event
      expect((await row())?.status).toBe("canceled");
      expect((await authorize(USER, await newPaper(), "paper")).plan).toBe("free");
    });

    it("a renewal payment re-syncs the subscription's new period", async () => {
      const sub = subscription();
      dodo.subs.set(sub.subscription_id, sub);
      await webhook(signed("subscription.active", sub));
      const renewed = { ...sub, previous_billing_date: new Date().toISOString(), next_billing_date: new Date(Date.now() + 30 * day).toISOString() };
      dodo.subs.set(sub.subscription_id, renewed);
      // Not a full Payment payload: the route still re-fetches by the subscription id it carries.
      await webhook(signed("subscription.renewed", renewed));
      expect(Date.parse((await row())!.period_start)).toBe(Date.parse(renewed.previous_billing_date));
    });

    it("a subscription that names no user is acknowledged but not saved", async () => {
      const sub = subscription({ metadata: {} });
      dodo.subs.set(sub.subscription_id, sub);
      expect((await webhook(signed("subscription.active", sub))).status).toBe(200);
      expect(await row()).toBeNull();
    });
  });

  describe("return page sync", () => {
    const sync = async (subscriptionId: string) => {
      const { POST } = await import("@/app/api/billing/sync/route");
      return POST(new Request("http://x", { method: "POST", body: JSON.stringify({ subscriptionId }) }));
    };

    it("activates the plan without waiting for the webhook", async () => {
      const sub = subscription({ product_id: "prod_starter" });
      dodo.subs.set(sub.subscription_id, sub);
      const res = await sync(sub.subscription_id);
      expect(await res.json()).toMatchObject({ status: "active", plan: "starter" });
      expect((await row())?.plan).toBe("starter");
    });

    it("refuses someone else's subscription", async () => {
      const sub = subscription({ metadata: { owner: "user_someone_else" } });
      dodo.subs.set(sub.subscription_id, sub);
      expect((await sync(sub.subscription_id)).status).toBe(403);
      expect(await row()).toBeNull();
    });

    it("no owner in metadata: theirs only if Dodo's customer email is theirs", async () => {
      const sub = subscription({ metadata: {} });
      dodo.subs.set(sub.subscription_id, sub);
      EMAIL = "other@example.com";
      expect((await sync(sub.subscription_id)).status).toBe(403);
      EMAIL = "Reader@Example.com";
      expect((await sync(sub.subscription_id)).status).toBe(200);
    });

    it("pending is reported as pending, and nothing is saved", async () => {
      const sub = subscription({ status: "pending" });
      dodo.subs.set(sub.subscription_id, sub);
      expect(await (await sync(sub.subscription_id)).json()).toEqual({ status: "pending" });
      expect(await row()).toBeNull();
    });
  });

  describe("checkout", () => {
    const checkout = async (plan: string, next = "/play") => {
      const { POST } = await import("@/app/api/billing/checkout/route");
      return POST(new Request("http://x/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan, next }) }));
    };

    it("a new subscriber gets a hosted checkout tied to their account", async () => {
      const res = await checkout("starter", "/play/abc");
      expect(await res.json()).toEqual({ url: "https://test.checkout.dodopayments.com/cks_1" });
      expect(dodo.sessions[0]).toMatchObject({ product_cart: [{ product_id: "prod_starter", quantity: 1 }], metadata: { owner: USER, plan: "starter" } });
      const back = new URL(dodo.sessions[0].return_url as string);
      expect(back.pathname).toBe("/billing/return");
      expect(back.searchParams.get("next")).toBe("/play/abc");
    });

    it("never returns to another site", async () => {
      await checkout("pro", "//evil.example/steal");
      expect(new URL(dodo.sessions[0].return_url as string).searchParams.get("next")).toBe("/play");
    });

    it("subscribers change plan instead of buying a second subscription: upgrades now, downgrades at renewal", async () => {
      const sub = subscription({ product_id: "prod_starter" });
      dodo.subs.set(sub.subscription_id, sub);
      await webhook(signed("subscription.active", sub));

      const up = await (await checkout("pro")).json();
      expect(new URL(up.url).searchParams.get("subscription_id")).toBe(sub.subscription_id);
      expect(dodo.sessions).toHaveLength(0);
      expect(dodo.changes[0].body).toMatchObject({ product_id: "prod_pro", effective_at: "immediately", proration_billing_mode: "prorated_immediately" });
      expect((await row())?.plan).toBe("pro");

      await checkout("starter");
      expect(dodo.changes[1].body).toMatchObject({ product_id: "prod_starter", effective_at: "next_billing_date" });
      expect((await row())?.plan).toBe("pro"); // still pro until the renewal
    });

    it("rejects an unknown plan, and answers 503 while Dodo isn't configured", async () => {
      expect((await checkout("free")).status).toBe(400);
      const saved = process.env.DODO_PRODUCT_PRO;
      delete process.env.DODO_PRODUCT_PRO;
      expect((await checkout("pro")).status).toBe(503);
      process.env.DODO_PRODUCT_PRO = saved;
    });
  });

  it("portal: only for the user's own customer record", async () => {
    const { POST } = await import("@/app/api/billing/portal/route");
    expect((await POST()).status).toBe(404);
    const sub = subscription();
    dodo.subs.set(sub.subscription_id, sub);
    await webhook(signed("subscription.active", sub));
    expect(await (await POST()).json()).toEqual({ url: `https://portal.test/${sub.customer.customer_id}` });
  });

  describe("quota rules", () => {
    const subscribe = (plan: string, over: Record<string, unknown> = {}) =>
      db()
        .from("subscriptions")
        .upsert({ owner: USER, plan, status: "active", period_start: new Date(Date.now() - day).toISOString(), period_end: new Date(Date.now() + 29 * day).toISOString(), ...over });

    it("upgrading mid-month: the new allowance minus papers already used this period", async () => {
      await subscribe("starter");
      for (let i = 0; i < 10; i++) expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
      expect((await authorize(USER, await newPaper(), "paper")).reason).toBe("quota");
      await db().from("subscriptions").update({ plan: "pro" }).eq("owner", USER);
      const results = [];
      for (let i = 0; i < 21; i++) results.push(await authorize(USER, await newPaper(), "paper"));
      expect(results.filter((r) => r.allowed)).toHaveLength(20);
      expect(results[20]).toMatchObject({ reason: "quota", used: 30, allowance: 30 });
    });

    it("BYOK without a key isn't unlimited on our key: it's the free allowance", async () => {
      await subscribe("byok", { period_start: null, period_end: null });
      expect((await authorize(USER, await newPaper(), "paper")).keySource).toBe("platform");
      expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
      expect(await authorize(USER, await newPaper(), "paper")).toMatchObject({ allowed: false, reason: "quota", allowance: 2 });
      const { accountSummary } = await import("@/lib/account");
      expect(await accountSummary(USER)).toMatchObject({ plan: "byok", used: 2, allowance: 2 });
    });

    it("a renewal that lands a few hours late keeps the paid plan", async () => {
      await subscribe("pro", { period_end: new Date(Date.now() - 3 * 3_600_000).toISOString() });
      expect((await authorize(USER, await newPaper(), "paper")).plan).toBe("pro");
      const { accountSummary } = await import("@/lib/account");
      expect((await accountSummary(USER)).plan).toBe("pro");
    });

    it("account summary matches what authorize counts", async () => {
      await subscribe("starter");
      for (let i = 0; i < 3; i++) await authorize(USER, await newPaper(), "paper");
      const { accountSummary } = await import("@/lib/account");
      expect(await accountSummary(USER)).toMatchObject({ plan: "starter", used: 3, allowance: 10, cancelAtPeriodEnd: false });
    });
  });
});
