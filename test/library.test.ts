// The library against real Postgres: import checks, one shared copy (no cloning), signed-out
// reading, private per-reader questions, and free reuse of diagrams the paper already has.
// Skipped without local Supabase.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER: string | null = null;
vi.mock("@/lib/auth", () => ({ currentUser: async () => (USER ? { id: USER } : null), currentEmail: async () => null }));

const modelCalls: string[] = [];
vi.mock("@/lib/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/llm")>();
  const usage = { model: "test/model", input_tokens: 1, output_tokens: 1, cached_tokens: 0, reasoning_tokens: 0, cost_usd: 0.001, latency_ms: 1 };
  return {
    ...real,
    structuredCall: vi.fn(async (opts: { prompt: string }) => {
      modelCalls.push(opts.prompt.slice(0, 40));
      return { data: diagramData("answer"), usage };
    }),
  };
});

function diagramData(title: string) {
  const ids = ["a", "b", "c"];
  return {
    title,
    caption: "c",
    tryHint: "t",
    html: `<svg viewBox="0 0 10 10">${ids.map((id) => `<g data-explore="${id}"><rect width="1" height="1"/></g>`).join("")}</svg>`,
    explorables: ids.map((id) => ({ id, label: id, blurb: "b", pages: [1], quote: "q" })),
  };
}

function entry(slug: string, over: Record<string, unknown> = {}) {
  const scene = (i: number) => ({
    id: `s${i + 1}`,
    index: i,
    stage: "method" as const,
    title: `Scene ${i + 1}`,
    narration: "n",
    pages: [1],
    quote: "q",
    diagram: { id: `s${i + 1}`, ...diagramData(`Scene ${i + 1}`) },
  });
  return {
    slug,
    blurb: "A paper.",
    walkthrough: { paper: { title: `Paper ${slug}`, authors: "A et al.", year: 2020 }, scenes: [0, 1, 2].map(scene) },
    suggestions: { title: `Paper ${slug}`, authors: "A et al.", year: 2020, questions: [{ title: "Why?", hook: "h", pages: [1], quote: "q" }] },
    ...over,
  };
}

const pdfBytes = () => Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n2 0 obj << /Type /Page >> endobj\n`);

describe.skipIf(!localSupabase)("library (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;
  let lib: typeof import("@/lib/library");

  beforeAll(async () => {
    useLocalSupabase();
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
    ({ db } = await import("@/lib/db"));
    lib = await import("@/lib/library");
  });
  afterEach(() => {
    USER = null;
    modelCalls.length = 0;
  });

  async function imported(slug = `paper-${randomUUID().slice(0, 8)}`) {
    const pdf = pdfBytes();
    const { id } = await lib.importLibraryPaper(entry(slug), pdf);
    // A diagram that's part of the paper itself (owner ''): free for every reader.
    await db().from("nodes").insert({ paper_id: id, owner: "", id: "s1/a", kind: "deeper", title: "a", parent_id: "s1", status: "ready", diagram: { id: "s1/a", parentId: "s1", ...diagramData("Part of the paper") } });
    return { id, pdf, slug };
  }
  const reader = () => (USER = `user_l_${randomUUID().slice(0, 8)}`);
  const getPaper = async (id: string) => {
    const { GET } = await import("@/app/api/play/papers/[id]/route");
    return (await GET(new Request("http://x"), { params: Promise.resolve({ id }) })).json() as Promise<{ paper: { id: string }; nodes: { id: string; title: string }[] }>;
  };
  const ask = async (paperId: string, body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/play/diagram/route");
    return (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId, ...body }) }))).text();
  };
  const uses = async (owner: string) => (await db().from("paper_uses").select("paper_id, status").eq("owner", owner)).data ?? [];

  describe("import checks", () => {
    it("the shipped library entries pass", () => {
      for (const [file, walk] of [
        ["attention-is-all-you-need", "walkthrough.json"],
        ["anatomy-of-a-search-engine", "walkthrough-google.json"],
      ]) {
        const meta = JSON.parse(readFileSync(`library/${file}.json`, "utf8"));
        const walkthrough = JSON.parse(readFileSync(`public/demo/${walk}`, "utf8"));
        expect(lib.libraryProblems({ ...meta, walkthrough })).toEqual([]);
      }
    });

    it("a scene that wouldn't pass live checks keeps the paper out", async () => {
      const bad = entry("bad-one");
      bad.walkthrough.scenes[1].diagram.html = "<div>no svg</div>";
      expect(lib.libraryProblems(bad).join()).toMatch(/scene 2.*svg/i);
      await expect(lib.importLibraryPaper(bad, pdfBytes())).rejects.toThrow(/Not importable/);
    });

    it("re-importing updates the same row, so links keep working", async () => {
      const slug = `again-${randomUUID().slice(0, 8)}`;
      const pdf = pdfBytes();
      const first = await lib.importLibraryPaper(entry(slug), pdf);
      const second = await lib.importLibraryPaper(entry(slug, { blurb: "Better blurb." }), pdf);
      expect(second).toEqual({ id: first.id, created: false });
      const { data } = await db().from("papers").select("library_blurb, is_public, owner").eq("id", first.id).single();
      expect(data).toEqual({ library_blurb: "Better blurb.", is_public: true, owner: null });
    });

    it("takes over an older public row it replaces", async () => {
      const legacyKey = `file:file_${randomUUID().slice(0, 8)}`;
      const { data: legacy } = await db().from("papers").insert({ paper_key: legacyKey, is_public: true }).select("id").single();
      const { id } = await lib.importLibraryPaper(entry(`legacy-${randomUUID().slice(0, 8)}`, { replaces: [legacyKey] }), pdfBytes());
      expect(id).toBe(legacy!.id);
    });
  });

  it("signed out: uploading the same PDF opens the shared copy and streams it, with no model calls and no new row", async () => {
    const paper = await imported();
    const { POST: upload } = await import("@/app/api/play/upload/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array(paper.pdf)], "mine.pdf", { type: "application/pdf" }));
    const up = await (await upload(new Request("http://x", { method: "POST", body: form }))).json();
    expect(up).toMatchObject({ paperId: paper.id, library: true, demo: true });
    expect(up.suggestions.questions[0].title).toBe("Why?");

    const { POST: walk } = await import("@/app/api/play/walkthrough/route");
    const lines = (await (await walk(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: paper.id }) }))).text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.filter((e) => e.type === "scene")).toHaveLength(3);
    expect(modelCalls).toHaveLength(0);
    const { count } = await db().from("papers").select("*", { count: "exact", head: true }).eq("pdf_sha256", (await db().from("papers").select("pdf_sha256").eq("id", paper.id).single()).data!.pdf_sha256);
    expect(count).toBe(1);
  });

  it("signed in: also the shared copy, not a clone", async () => {
    const paper = await imported();
    reader();
    const { POST: upload } = await import("@/app/api/play/upload/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array(paper.pdf)], "mine.pdf", { type: "application/pdf" }));
    expect((await (await upload(new Request("http://x", { method: "POST", body: form }))).json()).paperId).toBe(paper.id);
    expect((await db().from("papers").select("id").eq("owner", USER!)).data).toEqual([]);
  });

  it("a diagram the paper already has is free: no model call, no paper counted", async () => {
    const paper = await imported();
    const me = reader();
    const out = await ask(paper.id, {
      node: { id: "s1/a", kind: "deeper", title: "a", parentId: "s1" },
      parent: { id: "s1", title: "Scene 1", explorable: { id: "a", label: "a", blurb: "b", pages: [1], quote: "q" } },
    });
    expect(JSON.parse(out.trim().split("\n").pop()!)).toMatchObject({ type: "done", diagram: { title: "Part of the paper" } });
    expect(modelCalls).toHaveLength(0);
    expect(await uses(me)).toEqual([]);
  });

  it("questions are private: saved for the reader who asked, invisible to everyone else; the first one counts 1 paper", async () => {
    const paper = await imported();
    const alice = reader();
    await ask(paper.id, { node: { id: "q-alice1", kind: "question", title: "Alice's question", parentId: null }, question: "Alice's question" });
    await ask(paper.id, { node: { id: "q-alice2", kind: "question", title: "Alice again", parentId: null }, question: "Alice again" });
    expect(modelCalls).toHaveLength(2);
    expect(await uses(alice)).toEqual([{ paper_id: paper.id, status: "used" }]); // counted once

    const mine = await getPaper(paper.id);
    expect(mine.nodes.map((n) => n.id).sort()).toEqual(["q-alice1", "q-alice2", "s1/a"]);

    reader(); // Bob
    expect((await getPaper(paper.id)).nodes.map((n) => n.id)).toEqual(["s1/a"]);
    USER = null; // signed out
    expect((await getPaper(paper.id)).nodes.map((n) => n.id)).toEqual(["s1/a"]);

    const { data } = await db().from("nodes").select("owner").eq("paper_id", paper.id).eq("id", "q-alice1").single();
    expect(data!.owner).toBe(alice);
  });

  it("a reader's own answer is free to reopen", async () => {
    const paper = await imported();
    reader();
    const node = { id: "s2/b", kind: "deeper", title: "b", parentId: "s2" };
    const parent = { id: "s2", title: "Scene 2", explorable: { id: "b", label: "b", blurb: "b", pages: [1], quote: "q" } };
    await ask(paper.id, { node, parent });
    await ask(paper.id, { node, parent });
    expect(modelCalls).toHaveLength(1);
  });

  it("their own papers keep working as before: nodes are part of the paper", async () => {
    const me = reader();
    const pdf = pdfBytes();
    const { storePdf } = await import("@/lib/pdfStore");
    const sha = await storePdf(pdf);
    const { data } = await db().from("papers").insert({ owner: me, paper_key: `sha:${sha}`, pdf_sha256: sha }).select("id").single();
    await ask(data!.id, { node: { id: "q-own", kind: "question", title: "Mine", parentId: null }, question: "Mine" });
    const { data: n } = await db().from("nodes").select("owner").eq("paper_id", data!.id).single();
    expect(n!.owner).toBe("");
  });

  it("suggestions saved on the paper are served free", async () => {
    const paper = await imported();
    const me = reader();
    const { POST } = await import("@/app/api/play/suggest/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: paper.id }) }));
    expect((await res.json()).questions[0].title).toBe("Why?");
    expect(modelCalls).toHaveLength(0);
    expect(await uses(me)).toEqual([]);
  });

  it("someone else's private paper stays private", async () => {
    const owner = reader();
    const { data } = await db().from("papers").insert({ owner, paper_key: `sha:${randomUUID()}` }).select("id").single();
    reader();
    const { GET } = await import("@/app/api/play/papers/[id]/route");
    expect((await GET(new Request("http://x"), { params: Promise.resolve({ id: data!.id }) })).status).toBe(404);
  });
});
