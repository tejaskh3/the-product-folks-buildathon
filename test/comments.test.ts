// Comments on library papers against real Postgres: anyone reads, signed-in readers post,
// three reports hide a comment, admins restore or delete. Skipped without local Supabase.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { shownName } from "@/lib/comments";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER: string | null = null;
let NAME: string | null = "Ada Lovelace";
vi.mock("@/lib/auth", () => ({
  currentUser: async () => (USER ? { id: USER } : null),
  currentEmail: async () => null,
  currentProfile: async () => ({ email: "ada@example.com", name: NAME }),
}));

describe("shown names", () => {
  it("first name and last initial, never more", () => {
    expect(shownName("Ada Lovelace")).toBe("Ada L.");
    expect(shownName("  Grace  Brewster  hopper ")).toBe("Grace H.");
    expect(shownName("Plato")).toBe("Plato");
    expect(shownName("")).toBe("Reader");
    expect(shownName(null)).toBe("Reader");
  });
});

describe.skipIf(!localSupabase)("comments (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;
  beforeAll(async () => {
    useLocalSupabase();
    ({ db } = await import("@/lib/db"));
  });
  afterEach(() => {
    USER = null;
    NAME = "Ada Lovelace";
    delete process.env.ADMIN_USER_IDS;
  });

  const reader = () => (USER = `user_c_${randomUUID().slice(0, 8)}`);
  const paper = async (over: Record<string, unknown> = { is_public: true }) =>
    (await db().from("papers").insert({ owner: null, paper_key: `sha:${randomUUID()}`, title: "Library paper", ...over }).select("id").single()).data!.id as string;
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string, body?: unknown, q = "") =>
    new Request(`http://x/${q}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const routes = async () => ({
    c: await import("@/app/api/play/papers/[id]/comments/route"),
    report: await import("@/app/api/play/papers/[id]/comments/report/route"),
    admin: await import("@/app/api/admin/comments/[id]/route"),
  });
  type C = { id: string; author: string; body: string; mine: boolean; hidden: boolean; reportedByMe: boolean; sceneId: string | null };
  const list = async (id: string) => ((await (await (await routes()).c.GET(req("GET"), ctx(id))).json()) as { comments: C[] }).comments;
  const post = async (id: string, body: string, sceneId?: string) => (await routes()).c.POST(req("POST", { body, sceneId }), ctx(id));

  it("anyone reads; posting needs sign-in; only library papers have a discussion", async () => {
    const id = await paper();
    expect((await post(id, "Hello")).status).toBe(401);
    reader();
    const res = await post(id, "  Great paper.  ", "s2");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ author: "Ada L.", body: "Great paper.", sceneId: "s2", mine: true });
    USER = null;
    expect(await list(id)).toMatchObject([{ author: "Ada L.", body: "Great paper.", mine: false }]);

    reader();
    const priv = await paper({ is_public: false, owner: USER });
    expect((await post(priv, "Mine")).status).toBe(404);
    expect((await (await routes()).c.GET(req("GET"), ctx(priv))).status).toBe(404);
  });

  it("checks the text and limits 10 an hour; never stores the email", async () => {
    const id = await paper();
    reader();
    expect((await post(id, "   ")).status).toBe(400);
    expect((await post(id, "x".repeat(2001))).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await post(id, `c${i}`)).status).toBe(201);
    const over = await post(id, "eleventh");
    expect(over.status).toBe(400);
    expect((await over.json()).error).toMatch(/hour/);
    const { data } = await db().from("comments").select("author, body").eq("owner", USER!);
    expect(JSON.stringify(data)).not.toContain("ada@example.com");
  });

  it("three different readers' reports hide it; the same reader twice counts once; authors can't report themselves", async () => {
    const r = await routes();
    const id = await paper();
    const author = reader();
    const c = (await (await post(id, "Spam spam")).json()) as C;
    expect((await r.report.POST(req("POST", { id: c.id }), ctx(id))).status).toBe(400); // own

    for (let i = 0; i < 2; i++) {
      reader();
      await r.report.POST(req("POST", { id: c.id, reason: "spam" }), ctx(id));
      await r.report.POST(req("POST", { id: c.id }), ctx(id)); // again: no effect
    }
    expect((await list(id)).map((x) => x.id)).toContain(c.id);
    expect((await list(id)).find((x) => x.id === c.id)!.reportedByMe).toBe(true);

    reader();
    expect(await (await r.report.POST(req("POST", { id: c.id }), ctx(id))).json()).toEqual({ hidden: true });
    USER = null;
    expect((await list(id)).map((x) => x.id)).not.toContain(c.id);
    USER = author; // the author still sees it, marked hidden
    expect((await list(id)).find((x) => x.id === c.id)).toMatchObject({ hidden: true, mine: true });
  });

  it("parallel reports still hide at exactly three", async () => {
    const id = await paper();
    reader();
    const c = (await (await post(id, "Borderline")).json()) as C;
    // Five readers at once: each call runs as its own reader.
    const reporters = Array.from({ length: 5 }, () => `user_c_${randomUUID().slice(0, 8)}`);
    const { reportComment } = await import("@/lib/comments");
    const results = await Promise.all(reporters.map((who) => reportComment(id, who, c.id, "")));
    expect(results.filter((x) => x?.hidden).length).toBeGreaterThanOrEqual(3);
    const { data } = await db().from("comments").select("report_count, hidden").eq("id", c.id).single();
    expect(data).toEqual({ report_count: 5, hidden: true });
  });

  it("authors delete their own, not others'", async () => {
    const r = await routes();
    const id = await paper();
    reader();
    const c = (await (await post(id, "Oops")).json()) as C;
    reader();
    expect((await r.c.DELETE(req("DELETE", undefined, `?id=${c.id}`), ctx(id))).status).toBe(404);
    const { data } = await db().from("comments").select("owner").eq("id", c.id).single();
    USER = data!.owner as string;
    expect((await r.c.DELETE(req("DELETE", undefined, `?id=${c.id}`), ctx(id))).status).toBe(204);
    expect((await list(id)).map((x) => x.id)).not.toContain(c.id);
  });

  it("admins restore (reports cleared, visible again) or delete; everyone else gets 404", async () => {
    const r = await routes();
    const id = await paper();
    reader();
    const c = (await (await post(id, "Fine actually")).json()) as C;
    const { reportComment, listForModeration } = await import("@/lib/comments");
    for (let i = 0; i < 3; i++) await reportComment(id, `user_c_${randomUUID().slice(0, 8)}`, c.id, "rude");
    expect((await listForModeration()).find((x) => x.id === c.id)).toMatchObject({ hidden: true, report_count: 3, reasons: ["rude", "rude", "rude"] });

    const admin = `user_admin_${randomUUID().slice(0, 6)}`;
    process.env.ADMIN_USER_IDS = admin;
    reader(); // not an admin
    expect((await r.admin.PATCH(req("PATCH", { action: "restore" }), ctx(c.id))).status).toBe(404);
    USER = admin;
    expect((await r.admin.PATCH(req("PATCH", { action: "nuke" }), ctx(c.id))).status).toBe(400);
    expect((await r.admin.PATCH(req("PATCH", { action: "restore" }), ctx(c.id))).status).toBe(200);
    USER = null;
    expect((await list(id)).map((x) => x.id)).toContain(c.id);
    expect((await listForModeration()).map((x) => x.id)).not.toContain(c.id);
    const { count } = await db().from("comment_reports").select("*", { count: "exact", head: true }).eq("comment_id", c.id);
    expect(count).toBe(0);

    USER = admin;
    expect((await r.admin.PATCH(req("PATCH", { action: "delete" }), ctx(c.id))).status).toBe(200);
    USER = null;
    expect((await list(id)).map((x) => x.id)).not.toContain(c.id);
  });
});
