// Defenses against farming free papers: the per-IP daily limit and disposable emails.
// The pure helpers always run; the authorize_generation checks need local Supabase.
//
//   5th free paper from one IP in a day → "ip_limit" (paid, BYOK, already counted: never)
//   disposable email (or a subdomain of one) → "disposable_email" · the raw IP is never stored
import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clientIp, ipHash, isDisposableEmail } from "@/lib/abuse";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER = "";
let EMAIL: string | null = "someone@gmail.com";
const emailLookups = vi.fn(async () => EMAIL);
vi.mock("@/lib/auth", () => ({ currentUser: async () => ({ id: USER }), currentEmail: () => emailLookups() }));

describe("abuse helpers", () => {
  it("disposable domains match, including subdomains; normal providers don't", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("A@Sub.Mailinator.COM")).toBe(true);
    expect(isDisposableEmail("a@x.y.guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("a@yopmail.fr")).toBe(true);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@notmailinator.co")).toBe(false);
    expect(isDisposableEmail("someone@mailinator.com.evil.org")).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
    expect(isDisposableEmail("no-at-sign")).toBe(false);
  });

  it("client IP: first x-forwarded-for entry, then x-real-ip; junk is ignored", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(clientIp(req({}))).toBeNull();
  });

  it("IP hash: keyed HMAC, never the IP; IPv6 shares a hash per /64", () => {
    process.env.IP_HASH_SECRET = "test-ip-secret";
    try {
      const h = ipHash("203.0.113.7")!;
      expect(h).toBe(createHmac("sha256", "test-ip-secret").update("203.0.113.7").digest("hex"));
      expect(h).not.toContain("203");
      expect(ipHash("::ffff:203.0.113.7")).toBe(h);
      expect(ipHash("2001:db8:1:2::1")).toBe(ipHash("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"));
      expect(ipHash("2001:db8:1:2::1")).not.toBe(ipHash("2001:db8:1:3::1"));
      expect(ipHash(null)).toBeNull();
    } finally {
      delete process.env.IP_HASH_SECRET;
    }
  });
});

describe.skipIf(!localSupabase)("free-tier abuse checks (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;
  let authorize: typeof import("@/lib/entitlements").authorize;
  let refund: typeof import("@/lib/entitlements").refund;

  beforeAll(async () => {
    useLocalSupabase();
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
    ({ db } = await import("@/lib/db"));
    ({ authorize, refund } = await import("@/lib/entitlements"));
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
    EMAIL = "someone@gmail.com";
    emailLookups.mockClear();
  });

  const newUser = () => (USER = `user_ab_${randomUUID().slice(0, 8)}`);
  // A fresh IP per test, so runs (and other suites on the same database) don't share a count.
  const newIp = () => `198.18.${randomInt(256)}.${randomInt(256)}`;
  const ctx = (ip: string) => ({ ip, email: async () => emailLookups() });
  async function newPaper(owner = USER) {
    const { storePdf } = await import("@/lib/pdfStore");
    const sha = await storePdf(Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n2 0 obj << /Type /Page >> endobj\n`));
    const { data, error } = await db().from("papers").insert({ owner, paper_key: `sha:${sha}`, pdf_sha256: sha }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const billingOn = () => (process.env.BILLING_ENABLED = "true");

  it("the 5th free paper from one IP in a day is refused, across different users, and isn't counted", async () => {
    billingOn();
    const ip = newIp();
    for (let i = 0; i < 4; i++) {
      newUser();
      expect(await authorize(USER, await newPaper(), "paper", ctx(ip))).toMatchObject({ allowed: true, reason: "reserved" });
    }
    newUser();
    const paper = await newPaper();
    expect(await authorize(USER, paper, "paper", ctx(ip))).toMatchObject({ allowed: false, reason: "ip_limit", plan: "free" });
    const { count } = await db().from("paper_uses").select("*", { count: "exact", head: true }).eq("owner", USER);
    expect(count).toBe(0);
    // Another network is fine.
    expect((await authorize(USER, paper, "paper", ctx(newIp()))).allowed).toBe(true);
  });

  it("paid plans, BYOK with a key, already-counted papers and billing off aren't limited", async () => {
    billingOn();
    const ip = newIp();
    for (let i = 0; i < 4; i++) {
      newUser();
      await authorize(USER, await newPaper(), "paper", ctx(ip));
    }
    // USER already counted a paper from this IP: asking about it again is fine.
    const { data: mine } = await db().from("paper_uses").select("paper_id").eq("owner", USER).single();
    expect(await authorize(USER, mine!.paper_id, "question", ctx(ip))).toMatchObject({ allowed: true, reason: "already_counted" });

    newUser();
    await db().from("subscriptions").insert({ owner: USER, plan: "pro", status: "active", period_start: new Date().toISOString(), period_end: new Date(Date.now() + 86_400_000 * 30).toISOString() });
    expect(await authorize(USER, await newPaper(), "paper", ctx(ip))).toMatchObject({ allowed: true, plan: "pro" });

    newUser();
    await db().from("subscriptions").insert({ owner: USER, plan: "byok", status: "active" });
    const { saveUserKey } = await import("@/lib/keys");
    await saveUserKey(USER, "sk-or-v1-" + "d".repeat(64));
    expect(await authorize(USER, await newPaper(), "paper", ctx(ip))).toMatchObject({ allowed: true, keySource: "byok" });

    // BYOK without a key counts as free, so it is limited.
    newUser();
    await db().from("subscriptions").insert({ owner: USER, plan: "byok", status: "active" });
    expect(await authorize(USER, await newPaper(), "paper", ctx(ip))).toMatchObject({ allowed: false, reason: "ip_limit" });

    delete process.env.BILLING_ENABLED;
    newUser();
    expect((await authorize(USER, await newPaper(), "paper", ctx(ip))).allowed).toBe(true);
    expect(emailLookups).toHaveBeenCalled(); // the free users above were checked…
    emailLookups.mockClear();
    newUser();
    await authorize(USER, await newPaper(), "paper", ctx(ip)); // …but billing off never looks the email up
    expect(emailLookups).not.toHaveBeenCalled();
  });

  it("a refunded paper gives its IP slot back", async () => {
    billingOn();
    const ip = newIp();
    const papers: [string, string][] = [];
    for (let i = 0; i < 4; i++) {
      newUser();
      const p = await newPaper();
      await authorize(USER, p, "paper", ctx(ip));
      papers.push([USER, p]);
    }
    await refund(...papers[0]);
    newUser();
    expect((await authorize(USER, await newPaper(), "paper", ctx(ip))).allowed).toBe(true);
  });

  it("parallel requests from new accounts on one IP can't go over the limit", async () => {
    billingOn();
    const ip = newIp();
    const users = Array.from({ length: 8 }, () => `user_ab_${randomUUID().slice(0, 8)}`);
    const papers = await Promise.all(users.map((u) => newPaper(u)));
    const results = await Promise.all(users.map((u, i) => authorize(u, papers[i], "paper", ctx(ip))));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    expect(results.filter((r) => r.reason === "ip_limit")).toHaveLength(4);
  });

  it("FREE_PAPERS_PER_IP_DAY sets the limit", async () => {
    billingOn();
    process.env.FREE_PAPERS_PER_IP_DAY = "1";
    try {
      const ip = newIp();
      newUser();
      expect((await authorize(USER, await newPaper(), "paper", ctx(ip))).allowed).toBe(true);
      newUser();
      expect((await authorize(USER, await newPaper(), "paper", ctx(ip))).reason).toBe("ip_limit");
    } finally {
      delete process.env.FREE_PAPERS_PER_IP_DAY;
    }
  });

  it("the raw IP is never stored, only its keyed hash", async () => {
    billingOn();
    const ip = newIp();
    newUser();
    const paper = await newPaper();
    await authorize(USER, paper, "paper", ctx(ip));
    const { data } = await db().from("paper_uses").select("*").eq("owner", USER).eq("paper_id", paper).single();
    expect(data!.ip_hash).toBe(ipHash(ip));
    expect(JSON.stringify(data)).not.toContain(ip);
  });

  it("disposable email: free papers refused (subdomains too), nothing counted; paid and gmail are fine", async () => {
    billingOn();
    for (const email of ["x@mailinator.com", "x@inbox.mailinator.com"]) {
      EMAIL = email;
      newUser();
      expect(await authorize(USER, await newPaper(), "paper", ctx(newIp()))).toMatchObject({ allowed: false, reason: "disposable_email" });
      const { count } = await db().from("paper_uses").select("*", { count: "exact", head: true }).eq("owner", USER);
      expect(count).toBe(0);
    }

    // Paying with a disposable address is fine, and needs no email lookup.
    emailLookups.mockClear();
    newUser();
    await db().from("subscriptions").insert({ owner: USER, plan: "starter", status: "active", period_start: new Date().toISOString(), period_end: new Date(Date.now() + 86_400_000 * 30).toISOString() });
    expect((await authorize(USER, await newPaper(), "paper", ctx(newIp()))).allowed).toBe(true);
    expect(emailLookups).not.toHaveBeenCalled();

    EMAIL = "someone@gmail.com";
    newUser();
    const paper = await newPaper();
    expect((await authorize(USER, paper, "paper", ctx(newIp()))).allowed).toBe(true);
    expect(emailLookups).toHaveBeenCalledTimes(1);
    // Already counted: no second lookup.
    await authorize(USER, paper, "question", ctx(newIp()));
    expect(emailLookups).toHaveBeenCalledTimes(1);
  });

  it("walkthrough route: 402 with the reason, read from x-forwarded-for and the Clerk email", async () => {
    billingOn();
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const call = async (paperId: string, ip: string) =>
      POST(new Request("http://x", { method: "POST", headers: { "x-forwarded-for": `${ip}, 10.0.0.1` }, body: JSON.stringify({ paperId }) }));

    EMAIL = "x@yopmail.com";
    newUser();
    let res = await call(await newPaper(), newIp());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "disposable_email", error: expect.stringContaining("permanent email") });

    EMAIL = "someone@gmail.com";
    const ip = newIp();
    for (let i = 0; i < 4; i++) {
      newUser();
      await authorize(USER, await newPaper(), "paper", ctx(ip));
    }
    newUser();
    res = await call(await newPaper(), ip);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "ip_limit", error: expect.stringContaining("this network") });
  });
});
