// The paper quota (authorize_generation and friends) against real Postgres, plus the routes that use it.
// Skipped without local Supabase.
//
//   free: 2 papers ever ─ pro: 30 per billing period ─ byok: unlimited on the user's key
//   same paper again → not counted twice · refund only a reservation · two tabs can't share the last paper
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER = "";
vi.mock("@/lib/auth", () => ({ currentUser: async () => ({ id: USER }), currentEmail: async () => null }));

const modelCalls: { apiKey?: string }[] = [];
let failPlan = false;
vi.mock("@/lib/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/llm")>();
  const usage = { model: "test/model", input_tokens: 1, output_tokens: 1, cached_tokens: 0, reasoning_tokens: 0, cost_usd: 0.001, latency_ms: 1 };
  return {
    ...real,
    structuredCall: vi.fn(async (opts: { prompt: string; apiKey?: string }) => {
      modelCalls.push({ apiKey: opts.apiKey });
      if (opts.prompt.includes("Plan a guided walkthrough")) {
        if (failPlan) throw new real.LlmError("Upstream", "provider down");
        const scene = (n: number) => ({ stage: "method", kind: "diagram", title: `Scene ${n}`, narration: "n", pages: [1], quote: "q" });
        return { data: { title: "T", authors: "A", year: 2026, motif: "m", scenes: [1, 2, 3].map(scene) }, usage };
      }
      const html = `<svg>${["a", "b", "c"].map((id) => `<g data-explore="${id}"/>`).join("")}</svg>`;
      return { data: { title: "D", caption: "c", tryHint: "t", html, explorables: ["a", "b", "c"].map((id) => ({ id, label: id, blurb: "b", pages: [1], quote: "q" })) }, usage };
    }),
  };
});

describe.skipIf(!localSupabase)("paper quota (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;
  let authorize: typeof import("@/lib/entitlements").authorize;
  let refund: typeof import("@/lib/entitlements").refund;
  let markUsed: typeof import("@/lib/entitlements").markUsed;

  beforeAll(async () => {
    useLocalSupabase();
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
    ({ db } = await import("@/lib/db"));
    ({ authorize, refund, markUsed } = await import("@/lib/entitlements"));
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
    failPlan = false;
    modelCalls.length = 0;
  });

  const newUser = () => (USER = `user_q_${randomUUID().slice(0, 8)}`);
  async function newPaper(owner = USER) {
    const { storePdf } = await import("@/lib/pdfStore");
    const sha = await storePdf(Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n2 0 obj << /Type /Page >> endobj\n`));
    const { data, error } = await db()
      .from("papers")
      .insert({ owner, paper_key: `sha:${sha}`, pdf_sha256: sha })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const billingOn = () => (process.env.BILLING_ENABLED = "true");

  it("free plan: 2 papers, the 3rd is denied when billing is on", async () => {
    newUser();
    billingOn();
    expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
    expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
    const third = await authorize(USER, await newPaper(), "paper");
    expect(third).toMatchObject({ allowed: false, reason: "quota", used: 2, allowance: 2 });
  });

  it("billing off: never denied, but still counted", async () => {
    newUser();
    for (let i = 0; i < 3; i++) expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
    const { count } = await db().from("paper_uses").select("*", { count: "exact", head: true }).eq("owner", USER);
    expect(count).toBe(3);
  });

  it("the same paper is counted once, whether walked through or asked about", async () => {
    newUser();
    billingOn();
    const paper = await newPaper();
    expect((await authorize(USER, paper, "paper")).reservedNow).toBe(true);
    const again = await authorize(USER, paper, "question");
    expect(again).toMatchObject({ allowed: true, reason: "already_counted", reservedNow: false });
  });

  it("refund returns a reserved paper; a used paper can't be refunded", async () => {
    newUser();
    billingOn();
    const a = await newPaper();
    const b = await newPaper();
    await authorize(USER, a, "paper");
    await authorize(USER, b, "paper");
    await refund(USER, a);
    await markUsed(USER, b);
    await refund(USER, b);
    expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true); // a's slot came back
    const { data } = await db().from("paper_uses").select("paper_id, status").eq("owner", USER).eq("paper_id", b).single();
    expect(data!.status).toBe("used");
  });

  it("two tabs racing for the last paper: exactly one wins", async () => {
    newUser();
    billingOn();
    await authorize(USER, await newPaper(), "paper");
    const papers = await Promise.all([1, 2, 3, 4, 5].map(() => newPaper()));
    const results = await Promise.all(papers.map((p) => authorize(USER, p, "paper")));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });

  it("pro: 30 per period, a new period starts fresh, and free papers don't count against it", async () => {
    newUser();
    billingOn();
    await authorize(USER, await newPaper(), "paper"); // a free paper first
    const start = new Date(Date.now() - 86_400_000).toISOString();
    await db().from("subscriptions").insert({ owner: USER, plan: "pro", status: "active", period_start: start, period_end: new Date(Date.now() + 86_400_000 * 29).toISOString() });
    for (let i = 0; i < 30; i++) expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
    expect((await authorize(USER, await newPaper(), "paper")).reason).toBe("quota");
    // Renewal: a new period.
    await db().from("subscriptions").update({ period_start: new Date().toISOString() }).eq("owner", USER);
    expect((await authorize(USER, await newPaper(), "paper")).allowed).toBe(true);
  });

  it("an expired subscription falls back to the free plan", async () => {
    newUser();
    billingOn();
    await db().from("subscriptions").insert({ owner: USER, plan: "pro", status: "active", period_start: new Date(Date.now() - 40 * 86_400_000).toISOString(), period_end: new Date(Date.now() - 86_400_000).toISOString() });
    expect((await authorize(USER, await newPaper(), "paper")).plan).toBe("free");
  });

  it("byok: unlimited on the user's own key; without a key it's the platform key", async () => {
    newUser();
    billingOn();
    await db().from("subscriptions").insert({ owner: USER, plan: "byok", status: "active" });
    expect((await authorize(USER, await newPaper(), "paper")).keySource).toBe("platform");
    const { saveUserKey } = await import("@/lib/keys");
    await saveUserKey(USER, "sk-or-v1-" + "b".repeat(64));
    for (let i = 0; i < 5; i++) expect(await authorize(USER, await newPaper(), "paper")).toMatchObject({ allowed: true, keySource: "byok" });
  });

  it("daily cap on questions run on our key", async () => {
    newUser();
    billingOn();
    const paper = await newPaper();
    await authorize(USER, paper, "paper");
    await db()
      .from("usage_events")
      .insert(Array.from({ length: 100 }, () => ({ owner: USER, paper_id: paper, step: "deeper", model: "m", key_source: "platform" })));
    expect(await authorize(USER, paper, "question")).toMatchObject({ allowed: false, reason: "daily_cap" });
  });

  it("walkthrough route: denied → 402 with the reason, before any model call", async () => {
    newUser();
    billingOn();
    await authorize(USER, await newPaper(), "paper");
    await authorize(USER, await newPaper(), "paper");
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: await newPaper() }) }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "quota", allowance: 2 });
    expect(modelCalls).toHaveLength(0);
  });

  it("walkthrough route: a delivered paper stays counted; a failed one is refunded", async () => {
    newUser();
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const run = async (paperId: string) =>
      (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId }) }))).text();
    const status = async (paperId: string) =>
      (await db().from("paper_uses").select("status").eq("owner", USER).eq("paper_id", paperId).single()).data!.status;

    const ok = await newPaper();
    await run(ok);
    expect(await status(ok)).toBe("used");

    failPlan = true;
    const bad = await newPaper();
    await run(bad);
    expect(await status(bad)).toBe("refunded");
  });

  it("generations on a BYOK key are paid with that key and logged as byok", async () => {
    newUser();
    const { saveUserKey } = await import("@/lib/keys");
    const userKey = "sk-or-v1-" + "c".repeat(64);
    await saveUserKey(USER, userKey);
    // Billing off: anyone with a key uses it. The key check is stubbed to "has credit".
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("openrouter.ai/api/v1/key") ? Response.json({ data: { limit_remaining: 5 } }) : realFetch(input, init),
    );
    try {
      const paper = await newPaper();
      const { POST } = await import("@/app/api/play/walkthrough/route");
      await (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: paper }) }))).text();
      expect(modelCalls.length).toBeGreaterThan(1);
      expect(modelCalls.every((c) => c.apiKey === userKey)).toBe(true);
      const { data } = await db().from("usage_events").select("key_source").eq("paper_id", paper);
      expect(data!.length).toBe(modelCalls.length);
      expect(data!.every((u) => u.key_source === "byok")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("spend cron: refuses callers without the secret, and sums the last day's platform spend", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const { GET } = await import("@/app/api/cron/spend/route");
    expect((await GET(new Request("http://x"))).status).toBe(401);
    newUser();
    const paper = await newPaper();
    // Measured as the change, so rows left by earlier runs don't matter.
    const spend = async () => (await (await GET(new Request("http://x", { headers: { authorization: "Bearer test-cron-secret" } }))).json()) as { total: number; calls: number };
    const before = await spend();
    // More rows than one Supabase response holds (1000), so a missed page would show.
    const row = { owner: USER, paper_id: paper, step: "diagram", model: "m", key_source: "platform", cost_usd: 0.001 };
    await db().from("usage_events").insert(Array.from({ length: 1500 }, () => row));
    await db().from("usage_events").insert({ ...row, step: "plan", key_source: "byok", cost_usd: 9 });
    const after = await spend();
    expect(after.calls - before.calls).toBe(1500);
    expect(after.total - before.total).toBeCloseTo(1.5, 2); // BYOK spend isn't ours
  });
});
