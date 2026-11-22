// The feedback floater against real Postgres: sending signed in and out, field checks, the
// hourly cap, paper requests the library already has, and /admin's routes (404 unless admin).
// Skipped without local Supabase.
import { randomInt, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER: string | null = null;
let EMAIL: string | null = null;
vi.mock("@/lib/auth", () => ({ currentUser: async () => (USER ? { id: USER } : null), currentEmail: async () => EMAIL }));

const ADMIN = `user_admin_${randomUUID().slice(0, 8)}`;
const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
const randomArxiv = () => `${randomInt(1000, 9999)}.${randomInt(10000, 99999)}`;

describe.skipIf(!localSupabase)("feedback (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;

  beforeAll(async () => {
    useLocalSupabase();
    process.env.ADMIN_USER_IDS = `user_someone_else, ${ADMIN}`;
    process.env.IP_HASH_SECRET = "test-secret";
    ({ db } = await import("@/lib/db"));
  });
  afterEach(() => {
    USER = null;
    EMAIL = null;
  });

  async function send(body: unknown, ip = randomIp()) {
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(new Request("http://x/api/feedback", { method: "POST", headers: { "x-forwarded-for": `${ip}, 70.1.1.1` }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; library?: { id: string; href: string; title: string } } };
  }
  const rowsFor = async (col: "owner" | "ip_hash" | "message", v: string) => (await db().from("feedback").select("*").eq(col, v)).data ?? [];

  it("signed in: saved with their id and account email, and no IP hash", async () => {
    USER = `user_fb_${randomUUID().slice(0, 8)}`;
    EMAIL = "reader@example.com";
    const res = await send({ kind: "feature", message: "  Dark mode please  ", page: "/play/abc" });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const [row] = await rowsFor("owner", USER);
    expect(row).toMatchObject({ kind: "feature", message: "Dark mode please", email: "reader@example.com", page: "/play/abc", ip_hash: null, done: false, arxiv_id: null });
  });

  it("signed out: anyone can send, with an optional email; the IP is stored only as a hash", async () => {
    const ip = randomIp();
    const message = `Loved it ${randomUUID()}`;
    expect((await send({ kind: "feedback", message, email: "me@example.org", page: "javascript:alert(1)" }, ip)).status).toBe(200);
    const [row] = await rowsFor("message", message);
    expect(row).toMatchObject({ owner: null, email: "me@example.org", page: null });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(ip);
  });

  it("checks the fields", async () => {
    expect((await send({ kind: "praise", message: "hi" })).status).toBe(400);
    expect((await send({ kind: "feedback", message: "   " })).body.error).toMatch(/few words/);
    expect((await send({ kind: "feedback", message: "x".repeat(2001) })).body.error).toMatch(/2000/);
    expect((await send({ kind: "feedback", message: "hi", email: "not-an-email" })).body.error).toMatch(/email/);
    expect((await send({ kind: "paper", arxiv: "my favourite paper" })).body.error).toMatch(/arXiv/);
    expect((await send("{not json")).status).toBe(400);
    expect((await send({ kind: "feedback", message: "x".repeat(20_000) })).status).toBe(413);
  });

  it("a paper request keeps a normalized arXiv id, no version", async () => {
    USER = `user_fb_${randomUUID().slice(0, 8)}`;
    const id = randomArxiv();
    expect((await send({ kind: "paper", arxiv: `https://arxiv.org/abs/${id}v3`, message: "" })).status).toBe(200);
    expect((await rowsFor("owner", USER))[0]).toMatchObject({ kind: "paper", arxiv_id: id, message: "" });
  });

  it("a paper the library already has is linked, not filed", async () => {
    const id = randomArxiv();
    const { data: paper } = await db()
      .from("papers")
      .insert({ paper_key: `arxiv:${id}`, arxiv_id: id, is_public: true, library_slug: `lib-${randomUUID().slice(0, 8)}`, title: "A Library Paper" })
      .select("id")
      .single();
    USER = `user_fb_${randomUUID().slice(0, 8)}`;
    const res = await send({ kind: "paper", arxiv: `arxiv.org/pdf/${id}v2` });
    expect(res).toEqual({ status: 200, body: { library: { id: paper!.id, title: "A Library Paper", href: `/play/${paper!.id}` } } });
    expect(await rowsFor("owner", USER)).toEqual([]);

    // A public paper that isn't in the library (no slug) is still worth requesting.
    const other = randomArxiv();
    await db().from("papers").insert({ paper_key: `arxiv:${other}`, arxiv_id: other, is_public: true });
    expect((await send({ kind: "paper", arxiv: other })).body).toEqual({ ok: true });
  });

  it("caps each sender at 10 an hour: per user signed in, per IP hash signed out", async () => {
    USER = `user_fb_${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 10; i++) expect((await send({ kind: "feedback", message: `n${i}` })).status).toBe(200);
    const over = await send({ kind: "feedback", message: "one more" });
    expect(over.status).toBe(429);
    expect(await rowsFor("owner", USER)).toHaveLength(10);
    USER = `user_fb_${randomUUID().slice(0, 8)}`; // someone else is unaffected
    expect((await send({ kind: "feedback", message: "hi" })).status).toBe(200);

    USER = null;
    const ip = randomIp();
    for (let i = 0; i < 10; i++) expect((await send({ kind: "feedback", message: `anon ${i}` }, ip)).status).toBe(200);
    expect((await send({ kind: "feedback", message: "anon more" }, ip)).status).toBe(429);
    expect((await send({ kind: "feedback", message: "other ip" }, randomIp())).status).toBe(200);
  });

  describe("/admin routes", () => {
    const list = async (q = "") => {
      const { GET } = await import("@/app/api/admin/feedback/route");
      return GET(new Request(`http://x/api/admin/feedback${q}`));
    };
    const patch = async (id: string, body: unknown) => {
      const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
      return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    };

    it("404 for signed-out visitors and signed-in non-admins", async () => {
      const { data } = await db().from("feedback").insert({ kind: "feedback", message: "secret" }).select("id").single();
      for (const who of [null, "user_not_admin"]) {
        USER = who;
        expect((await list()).status).toBe(404);
        expect((await patch(data!.id, { done: true })).status).toBe(404);
      }
      expect((await db().from("feedback").select("done").eq("id", data!.id).single()).data!.done).toBe(false);
    });

    it("admins list newest first, filter by kind, and tick items done", async () => {
      const tag = randomUUID();
      await db().from("feedback").insert({ kind: "feedback", message: `${tag} older`, created_at: new Date(Date.now() - 1000).toISOString() });
      const { data: newer } = await db().from("feedback").insert({ kind: "feature", message: `${tag} newer` }).select("id").single();
      USER = ADMIN;

      const all = ((await (await list()).json()) as { feedback: { id: string; message: string; created_at: string }[] }).feedback;
      const mine = all.filter((r) => r.message.startsWith(tag)).map((r) => r.message);
      expect(mine).toEqual([`${tag} newer`, `${tag} older`]);
      const times = all.map((r) => Date.parse(r.created_at));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const features = ((await (await list("?kind=feature")).json()) as { feedback: { kind: string }[] }).feedback;
      expect(features.length).toBeGreaterThan(0);
      expect(features.every((r) => r.kind === "feature")).toBe(true);

      expect(await (await patch(newer!.id, { done: true })).json()).toEqual({ id: newer!.id, done: true });
      expect((await db().from("feedback").select("done").eq("id", newer!.id).single()).data!.done).toBe(true);
      expect((await patch(newer!.id, { done: "yes" })).status).toBe(400);
      expect((await patch(randomUUID(), { done: true })).status).toBe(404);
    });
  });
});
