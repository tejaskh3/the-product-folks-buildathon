// Reading tools against real Postgres: favorites, notes, history, bookmarks and highlights are
// private to each reader, need a paper they can read, and survive only as long as the paper.
// Skipped without local Supabase.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { notesMarkdown, parsePlaceHash, placeHash, type Reading } from "@/lib/readingNotes";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER: string | null = null;
vi.mock("@/lib/auth", () => ({ currentUser: async () => (USER ? { id: USER } : null), currentEmail: async () => null }));

describe("notes export (pure)", () => {
  const reading: Reading = {
    favorite: true,
    notes: "My take: attention replaces recurrence.\n",
    bookmarks: [
      { id: "b2", kind: "page", target: "4", label: "", created_at: "" },
      { id: "b1", kind: "scene", target: "s2", label: "Scene 2: Heads", created_at: "" },
    ],
    highlights: [
      { id: "h1", kind: "page", target: "4", quote: "Multi-head attention allows", color: "yellow", note: "", created_at: "" },
      { id: "h2", kind: "scene", target: "s2", quote: "each head looks\nsomewhere else", color: "blue", note: "Like eyes.", created_at: "" },
    ],
  };
  const placeName = (k: string, t: string) => (k === "scene" ? `Scene ${t.slice(1)}: Heads` : `Page ${t}`);
  const placeOrder = (k: string, t: string) => (k === "scene" ? Number(t.slice(1)) : 100 + Number(t));

  it("writes notes, highlights grouped by place in walkthrough order, then bookmarks", () => {
    const md = notesMarkdown({ title: "Attention", authors: "Vaswani et al.", year: 2017, url: "https://x/play/1", reading, placeName, placeOrder });
    expect(md).toBe(
      [
        "# Attention",
        "",
        "_Vaswani et al., 2017_",
        "",
        "https://x/play/1",
        "",
        "## Notes",
        "",
        "My take: attention replaces recurrence.",
        "",
        "## Highlights",
        "",
        "### Scene 2: Heads",
        "",
        "> each head looks",
        "> somewhere else",
        "",
        "Like eyes.",
        "",
        "### Page 4",
        "",
        "> Multi-head attention allows",
        "",
        "## Bookmarks",
        "",
        "- Scene 2: Heads",
        "- Page 4",
        "",
      ].join("\n"),
    );
  });

  it("leaves out empty sections", () => {
    expect(notesMarkdown({ title: "T", reading: { favorite: false, notes: " ", bookmarks: [], highlights: [] }, placeName })).toBe("# T\n");
  });

  it("place links round-trip", () => {
    expect(parsePlaceHash(placeHash("node", "s1/a b"))).toEqual({ kind: "node", target: "s1/a b" });
    expect(parsePlaceHash("#at=elsewhere:1")).toBeNull();
    expect(parsePlaceHash("#at=page:%E0%A4")).toBeNull();
  });
});

describe.skipIf(!localSupabase)("reading tools (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;

  beforeAll(async () => {
    useLocalSupabase();
    ({ db } = await import("@/lib/db"));
  });
  afterEach(() => {
    USER = null;
  });

  const reader = () => (USER = `user_r_${randomUUID().slice(0, 8)}`);
  const paperFor = async (owner: string | null, over: Record<string, unknown> = {}) => {
    const { data, error } = await db().from("papers").insert({ owner, paper_key: `sha:${randomUUID()}`, title: "A paper", ...over }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string, body?: unknown, q = "") =>
    new Request(`http://x/${q}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const routes = async () => ({
    reading: await import("@/app/api/play/papers/[id]/reading/route"),
    bookmarks: await import("@/app/api/play/papers/[id]/bookmarks/route"),
    highlights: await import("@/app/api/play/papers/[id]/highlights/route"),
    shelf: await import("@/app/api/play/shelf/route"),
  });
  const readingOf = async (id: string) => (await (await (await routes()).reading.GET(req("GET"), ctx(id))).json()) as Reading;

  it("signed out: 401; someone else's private paper: 404", async () => {
    const r = await routes();
    const owner = reader();
    const id = await paperFor(owner);
    USER = null;
    expect((await r.reading.GET(req("GET"), ctx(id))).status).toBe(401);
    reader();
    expect((await r.reading.GET(req("GET"), ctx(id))).status).toBe(404);
    expect((await r.bookmarks.POST(req("POST", { kind: "scene", target: "s1" }), ctx(id))).status).toBe(404);
    expect((await r.highlights.POST(req("POST", { kind: "scene", target: "s1", quote: "x" }), ctx(id))).status).toBe(404);
  });

  it("favorite, notes and opened save independently", async () => {
    const r = await routes();
    const id = await paperFor(reader());
    expect((await r.reading.PATCH(req("PATCH", { favorite: true }), ctx(id))).status).toBe(204);
    expect((await r.reading.PATCH(req("PATCH", { notes: "First thoughts" }), ctx(id))).status).toBe(204);
    expect((await r.reading.PATCH(req("PATCH", { opened: true }), ctx(id))).status).toBe(204);
    expect(await readingOf(id)).toMatchObject({ favorite: true, notes: "First thoughts" });
    expect((await r.reading.PATCH(req("PATCH", { notes: "x".repeat(20001) }), ctx(id))).status).toBe(400);
    expect((await r.reading.PATCH(req("PATCH", { favorite: "yes" }), ctx(id))).status).toBe(400);
    expect((await r.reading.PATCH(req("PATCH", {}), ctx(id))).status).toBe(400);
  });

  it("bookmarks: one per place, removable, validated", async () => {
    const r = await routes();
    const id = await paperFor(reader());
    const a = await (await r.bookmarks.POST(req("POST", { kind: "scene", target: "s2", label: "Scene 2" }), ctx(id))).json();
    const again = await (await r.bookmarks.POST(req("POST", { kind: "scene", target: "s2", label: "Scene 2" }), ctx(id))).json();
    expect(again.id).toBe(a.id);
    await r.bookmarks.POST(req("POST", { kind: "page", target: 4 }), ctx(id));
    expect((await readingOf(id)).bookmarks.map((b) => `${b.kind}:${b.target}`)).toEqual(["scene:s2", "page:4"]);
    expect((await r.bookmarks.POST(req("POST", { kind: "page", target: "four" }), ctx(id))).status).toBe(400);
    expect((await r.bookmarks.POST(req("POST", { kind: "chapter", target: "1" }), ctx(id))).status).toBe(400);
    await r.bookmarks.DELETE(req("DELETE", undefined, `?id=${a.id}`), ctx(id));
    expect((await readingOf(id)).bookmarks.map((b) => b.kind)).toEqual(["page"]);
  });

  it("highlights: add, recolor, note, delete; bad color and empty quote refused", async () => {
    const r = await routes();
    const id = await paperFor(reader());
    const res = await r.highlights.POST(req("POST", { kind: "page", target: "3", quote: "  scaled dot-product  " }), ctx(id));
    expect(res.status).toBe(201);
    const h = await res.json();
    expect(h).toMatchObject({ quote: "scaled dot-product", color: "yellow", note: "" });
    const upd = await (await r.highlights.PATCH(req("PATCH", { color: "pink", note: "Key formula" }, `?id=${h.id}`), ctx(id))).json();
    expect(upd).toMatchObject({ color: "pink", note: "Key formula" });
    expect((await r.highlights.PATCH(req("PATCH", { color: "red" }, `?id=${h.id}`), ctx(id))).status).toBe(400);
    expect((await r.highlights.POST(req("POST", { kind: "page", target: "3", quote: " " }), ctx(id))).status).toBe(400);
    expect((await r.highlights.POST(req("POST", { kind: "page", target: "3", quote: "x".repeat(1001) }), ctx(id))).status).toBe(400);
    await r.highlights.DELETE(req("DELETE", undefined, `?id=${h.id}`), ctx(id));
    expect((await readingOf(id)).highlights).toEqual([]);
  });

  it("on a library paper each reader's layer is private, and can't touch another's", async () => {
    const r = await routes();
    const lib = await paperFor(null, { is_public: true });
    reader(); // Alice
    const h = await (await r.highlights.POST(req("POST", { kind: "scene", target: "s1", quote: "Alice's" }), ctx(lib))).json();
    await r.bookmarks.POST(req("POST", { kind: "scene", target: "s1" }), ctx(lib));
    await r.reading.PATCH(req("PATCH", { notes: "Alice's notes", favorite: true }), ctx(lib));

    reader(); // Bob
    expect(await readingOf(lib)).toEqual({ favorite: false, notes: "", bookmarks: [], highlights: [] });
    await r.highlights.DELETE(req("DELETE", undefined, `?id=${h.id}`), ctx(lib));
    expect((await r.highlights.PATCH(req("PATCH", { note: "Bob was here" }, `?id=${h.id}`), ctx(lib))).status).toBe(400);
    const { data } = await db().from("highlights").select("note").eq("id", h.id).single();
    expect(data).toEqual({ note: "" }); // still Alice's, untouched
  });

  it("the shelf: my papers, favorites, bookmarks and history, and only papers I can still read", async () => {
    const r = await routes();
    const me = reader();
    const mine = await paperFor(me, { title: "Mine" });
    const lib = await paperFor(null, { is_public: true, title: "Library one" });
    await r.reading.PATCH(req("PATCH", { opened: true }), ctx(lib));
    await r.reading.PATCH(req("PATCH", { opened: true, favorite: true }), ctx(mine));
    await r.bookmarks.POST(req("POST", { kind: "page", target: "2", label: "Page 2" }), ctx(lib));
    // A library paper taken down later drops off the shelf instead of leaking.
    const gone = await paperFor(null, { is_public: true, title: "Taken down" });
    await r.reading.PATCH(req("PATCH", { opened: true, favorite: true }), ctx(gone));
    await db().from("papers").update({ is_public: false }).eq("id", gone);

    const shelf = await (await r.shelf.GET()).json();
    expect(shelf.mine.map((p: { id: string }) => p.id)).toEqual([mine]);
    expect(shelf.favorites.map((p: { title: string }) => p.title)).toEqual(["Mine"]);
    expect(shelf.history.map((p: { title: string }) => p.title)).toEqual(["Mine", "Library one"]);
    expect(shelf.bookmarks).toMatchObject([{ kind: "page", target: "2", paper: { id: lib, title: "Library one" } }]);
    USER = null;
    expect((await r.shelf.GET()).status).toBe(401);
  });

  it("deleting a paper removes its reading layer", async () => {
    const r = await routes();
    const me = reader();
    const id = await paperFor(me);
    await r.highlights.POST(req("POST", { kind: "scene", target: "s1", quote: "x" }), ctx(id));
    await r.reading.PATCH(req("PATCH", { favorite: true }), ctx(id));
    await db().from("papers").delete().eq("id", id);
    const counts = await Promise.all(["highlights", "reader_papers"].map(async (t) => (await db().from(t).select("*", { count: "exact", head: true }).eq("paper_id", id)).count));
    expect(counts).toEqual([0, 0]);
  });
});
