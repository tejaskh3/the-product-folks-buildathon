// Server-side saving, against a real local Supabase (`npx supabase start`) with the repo's migrations.
// Skipped when local Supabase isn't running. The model is stubbed; Clerk is stubbed to a fixed user.
//
//   upload (multipart) ─► papers row + stored PDF
//   walkthrough        ─► plan + scenes saved as they land, usage rows written
//   walkthrough again  ─► draws only missing scenes, no new plan call
//   diagram            ─► node saved pending → ready, under owner ''
//   PAPER_SENDING=digest ─► digest saved once on the row, scenes sent sliced pages (cached in storage)
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localSupabase } from "./localSupabase";

const local = localSupabase;

const USER = `user_test_${randomUUID().slice(0, 8)}`;
vi.mock("@/lib/auth", () => ({
  currentUser: async () => ({ id: USER }),
  currentEmail: async () => "test@example.com",
}));

// The model: a plan with 4 scenes, and a valid diagram for every drawing call.
const calls: string[] = [];
/** What each call was sent about the paper (PaperInput), in call order. */
const sent: unknown[] = [];
const DIGEST = {
  title: "Test Paper",
  pageCount: 6,
  sections: [{ heading: "1 Intro", pages: [1, 2], summary: "s", quote: "q" }],
  definitions: [],
  equations: [],
  figures: [{ label: "Figure 1", caption: "c", page: 3 }],
  results: [],
};
vi.mock("@/lib/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/llm")>();
  const usage = { model: "test/model", input_tokens: 100, output_tokens: 50, cached_tokens: 80, reasoning_tokens: 10, cost_usd: 0.001, latency_ms: 5 };
  return {
    ...real,
    structuredCall: vi.fn(async (opts: { prompt: string; paper: unknown; schema: { properties?: Record<string, unknown> } }) => {
      sent.push(opts.paper);
      if (opts.prompt.includes("Plan a guided walkthrough")) {
        calls.push("plan");
        const scene = (n: number) => ({ stage: "method", kind: "diagram", title: `Scene ${n}`, narration: "n", pages: [n], quote: "q" });
        const plan = { title: "Test Paper", authors: "Tester et al.", year: 2026, motif: "m", scenes: [1, 2, 3, 4].map(scene) };
        return { data: opts.schema.properties?.digest ? { ...plan, digest: DIGEST } : plan, usage };
      }
      if (opts.prompt.startsWith("Read the WHOLE attached paper and return its digest")) {
        calls.push("digest");
        return { data: { digest: DIGEST }, usage };
      }
      if (opts.prompt.startsWith("Read the attached paper. Return:")) {
        calls.push("suggest");
        return { data: { title: "Test Paper", authors: "T", year: 2026, questions: [{ title: "Why?", hook: "h", pages: [2], quote: "q" }] }, usage };
      }
      calls.push("draw");
      const html = `<svg viewBox="0 0 10 10">${["a", "b", "c"].map((id) => `<rect data-explore="${id}"/>`).join("")}</svg>`;
      const explorables = ["a", "b", "c"].map((id) => ({ id, label: id, blurb: "b", pages: [1], quote: "q" }));
      return { data: { title: "T", caption: "c", tryHint: "t", html, explorables }, usage };
    }),
  };
});

const fakePdf = () =>
  Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n`);

async function events(res: Response) {
  return (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe.skipIf(!local)("server-side saving (local Supabase)", () => {
  let db: typeof import("@/lib/db").db;

  beforeAll(async () => {
    process.env.SUPABASE_URL = local!.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = local!.key;
    ({ db } = await import("@/lib/db"));
  });

  beforeEach(() => {
    calls.length = 0;
    sent.length = 0;
  });

  async function upload(pdf = fakePdf()) {
    const { POST } = await import("@/app/api/play/upload/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array(pdf)], "test.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://x/api/play/upload", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    return (await res.json()) as { paperId: string; key: string };
  }

  async function walk(paperId: string) {
    const { POST } = await import("@/app/api/play/walkthrough/route");
    return events(await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId }) })));
  }

  it("upload creates the row and stores the PDF; uploading again reopens the same row", async () => {
    const pdf = fakePdf();
    const a = await upload(pdf);
    const b = await upload(pdf);
    expect(a.paperId).toBe(b.paperId);
    expect(a.key).toMatch(/^sha:[0-9a-f]{64}$/);
    const { data } = await db().from("papers").select("owner, pdf_sha256").eq("id", a.paperId).single();
    expect(data).toEqual({ owner: USER, pdf_sha256: a.key.slice(4) });
  });

  it("saves the plan and every scene on the server, and logs usage per call", async () => {
    const { paperId } = await upload();
    const evs = await walk(paperId);

    expect(evs[0].type).toBe("plan");
    expect(evs.filter((e) => e.type === "scene")).toHaveLength(4);
    expect(evs.at(-1)).toEqual({ type: "done" });
    expect(calls).toEqual(["plan", "draw", "draw", "draw", "draw"]);

    const { data: row } = await db().from("papers").select("walkthrough, walkthrough_plan, title, drawing_until").eq("id", paperId).single();
    expect(row!.walkthrough_plan.scenes).toHaveLength(4);
    expect(row!.walkthrough.scenes.map((s: { id: string }) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(row!.title).toBe("Test Paper");
    expect(row!.drawing_until).toBeNull(); // lease released

    const { data: usage } = await db().from("usage_events").select("step, key_source, cost_usd").eq("paper_id", paperId);
    expect(usage!.map((u) => u.step).sort()).toEqual(["plan", "scene:s1", "scene:s2", "scene:s3", "scene:s4"]);
    expect(usage!.every((u) => u.key_source === "platform" && Number(u.cost_usd) === 0.001)).toBe(true);
  });

  it("a finished walkthrough streams from the database with no model calls", async () => {
    const { paperId } = await upload();
    await walk(paperId);
    calls.length = 0;
    const evs = await walk(paperId);
    expect(evs.filter((e) => e.type === "scene")).toHaveLength(4);
    expect(calls).toEqual([]);
  });

  it("resuming draws only the missing scenes and never re-plans", async () => {
    const { paperId } = await upload();
    await walk(paperId);
    // Simulate a run that timed out after two scenes.
    const { data: row } = await db().from("papers").select("walkthrough").eq("id", paperId).single();
    await db()
      .from("papers")
      .update({ walkthrough: { ...row!.walkthrough, scenes: row!.walkthrough.scenes.slice(0, 2) } })
      .eq("id", paperId);
    calls.length = 0;

    const evs = await walk(paperId);
    expect(calls).toEqual(["draw", "draw"]);
    expect(evs.filter((e) => e.type === "scene")).toHaveLength(4);
    const { data: after } = await db().from("papers").select("walkthrough").eq("id", paperId).single();
    expect(after!.walkthrough.scenes).toHaveLength(4);
  });

  it("another tab holding the lease gets saved scenes and a continue, without drawing", async () => {
    const { paperId } = await upload();
    await db().rpc("take_drawing_lease", { p_paper: paperId, p_seconds: 60 });
    const evs = await walk(paperId);
    expect(evs.map((e) => e.type)).toEqual(["continue", "done"]);
    expect(calls).toEqual([]);
  });

  it("save_walkthrough_scene keeps every scene when they land at the same moment", async () => {
    const { paperId } = await upload();
    await db()
      .from("papers")
      .update({ walkthrough_plan: { paper: { title: "P", authors: "A" }, motif: "", scenes: [] } })
      .eq("id", paperId);
    const scene = (i: number) => ({ id: `s${i + 1}`, index: i, stage: "method", title: `S${i}`, narration: "", pages: [], quote: "", diagram: {} });
    await Promise.all([7, 3, 0, 5, 1, 6, 2, 4].map((i) => db().rpc("save_walkthrough_scene", { p_paper: paperId, p_scene: scene(i) })));
    // Replacing a scene keeps the count.
    await db().rpc("save_walkthrough_scene", { p_paper: paperId, p_scene: { ...scene(2), title: "again" } });

    const { data } = await db().from("papers").select("walkthrough").eq("id", paperId).single();
    const scenes = data!.walkthrough.scenes as { id: string; title: string }[];
    expect(scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
    expect(scenes[2].title).toBe("again");
    expect(data!.walkthrough.paper).toEqual({ title: "P", authors: "A" });
  });

  it("the diagram route saves the node as ready, under the paper's own owner ''", async () => {
    const { paperId } = await upload();
    const { POST } = await import("@/app/api/play/diagram/route");
    const node = { id: "q-test1", kind: "question", title: "Why?", parentId: "s1" };
    const evs = await events(
      await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId, node, question: "Why?" }) })),
    );
    expect(evs.at(-1).type).toBe("done");
    const { data } = await db().from("nodes").select("owner, status, kind, parent_id, diagram").eq("paper_id", paperId).eq("id", "q-test1").single();
    expect(data).toMatchObject({ owner: "", status: "ready", kind: "question", parent_id: "s1" });
    expect(data!.diagram.html).toContain("<svg");
  });

  it("rejects a deeper node whose id doesn't match its parent and part", async () => {
    const { paperId } = await upload();
    const { POST } = await import("@/app/api/play/diagram/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          paperId,
          node: { id: "s1/other", kind: "deeper", title: "x", parentId: "s1" },
          parent: { id: "s1", title: "Scene", explorable: { id: "a", label: "A" } },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("generation on someone else's paper is refused", async () => {
    const { data } = await db()
      .from("papers")
      .insert({ owner: "user_someone_else", paper_key: `sha:${randomUUID()}`, pdf_sha256: "x" })
      .select("id")
      .single();
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: data!.id }) }));
    expect(res.status).toBe(404);
  });

  it("an old uploaded paper with no stored PDF is read-only with a re-upload message", async () => {
    const { data } = await db()
      .from("papers")
      .insert({ owner: USER, paper_key: `file:file_old${randomUUID().slice(0, 6)}`, file_id: "file_oldanthropic" })
      .select("id")
      .single();
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const evs = await events(await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId: data!.id }) })));
    expect(evs.find((e) => e.type === "error").message).toMatch(/Upload the PDF again/);
    expect(calls).toEqual([]);
  });

  describe("PAPER_SENDING=digest", () => {
    /** A real 6-page PDF (pdf-lib can slice it), unique per call so each test gets its own paper. */
    async function realPdf() {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      for (let i = 1; i <= 6; i++) doc.addPage().drawText(`page ${i} ${randomUUID()}`);
      return Buffer.from(await doc.save());
    }
    const pageCountOf = async (dataUrl: string) => {
      const { PDFDocument } = await import("pdf-lib");
      return (await PDFDocument.load(Buffer.from(dataUrl.split(",")[1], "base64"))).getPageCount();
    };
    type Sent = { digest?: string; slice?: { data: string; pages: number[] }; data?: string };

    beforeEach(() => {
      vi.stubEnv("PAPER_SENDING", "digest");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("the plan saves a digest on the paper; scenes get it plus only their pages, cached in storage", async () => {
      const { paperId, key } = await upload(await realPdf());
      await walk(paperId);
      expect(calls).toEqual(["plan", "draw", "draw", "draw", "draw"]);

      const { data: row } = await db().from("papers").select("digest").eq("id", paperId).single();
      expect(row!.digest).toEqual(DIGEST);

      const plan = sent[0] as Sent;
      expect(plan.digest).toBeUndefined();
      expect(plan.data).toMatch(/^data:application\/pdf;base64,/); // the whole PDF (local storage → inline)
      const scenes = sent.slice(1) as Sent[];
      expect(new Set(scenes.map((s) => s.digest)).size).toBe(1);
      for (const s of scenes) {
        expect(s.digest).toContain("TITLE: Test Paper");
        expect(await pageCountOf(s.slice!.data)).toBe(s.slice!.pages.length);
        expect(s.slice!.pages.length).toBeLessThanOrEqual(3);
      }
      expect(scenes.map((s) => s.slice!.pages).sort()).toEqual([[1, 2], [2, 3], [3, 4], [4, 5]]);

      const { data: cached } = await db().storage.from("papers").list(`slices/${key.slice(4)}`);
      expect(cached!.map((f) => f.name).sort()).toEqual(["p1-2.pdf", "p2-3.pdf", "p3-4.pdf", "p4-5.pdf"]);
    });

    it("the digest is made once: a resume reuses it, and suggestions and go-deeper read it too", async () => {
      const { paperId } = await upload(await realPdf());
      await walk(paperId);
      const firstDigest = (sent[1] as Sent).digest;
      const { data: row } = await db().from("papers").select("walkthrough").eq("id", paperId).single();
      await db()
        .from("papers")
        .update({ walkthrough: { ...row!.walkthrough, scenes: row!.walkthrough.scenes.slice(0, 3) } })
        .eq("id", paperId);
      calls.length = 0;
      sent.length = 0;

      await walk(paperId);
      expect(calls).toEqual(["draw"]); // no second plan, so no second digest
      expect((sent[0] as Sent).digest).toBe(firstDigest);

      const { POST: suggest } = await import("@/app/api/play/suggest/route");
      await db().from("papers").update({ suggestions: null }).eq("id", paperId);
      expect((await suggest(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId }) }))).status).toBe(200);
      expect(sent.at(-1)).toEqual({ digest: firstDigest, digestPages: [1, 2, 3] });

      const { POST: diagram } = await import("@/app/api/play/diagram/route");
      const parent = { id: "s1", title: "Scene 1", explorable: { id: "a", label: "A", blurb: "b", pages: [5], quote: "q" } };
      const evs = await events(
        await diagram(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId, node: { id: "s1/a", kind: "deeper", title: "A", parentId: "s1" }, parent }) })),
      );
      expect(evs.at(-1).type).toBe("done");
      expect((sent.at(-1) as Sent).slice!.pages).toEqual([5, 6]);
    });

    it("the first question on a library paper makes its digest once, for every later reader", async () => {
      const { paperId } = await upload(await realPdf());
      // Library papers are imported finished: no plan call will ever make their digest.
      await db().from("papers").update({ owner: null, is_public: true }).eq("id", paperId);
      const { POST: diagram } = await import("@/app/api/play/diagram/route");
      const ask = (id: string) =>
        diagram(
          new Request("http://x", {
            method: "POST",
            body: JSON.stringify({
              paperId,
              node: { id: `s1/${id}`, kind: "deeper", title: id, parentId: "s1" },
              parent: { id: "s1", title: "Scene 1", explorable: { id, label: id, blurb: "b", pages: [2], quote: "q" } },
            }),
          }),
        ).then(events);

      expect((await ask("a")).at(-1).type).toBe("done");
      expect(calls).toEqual(["digest", "draw"]);
      expect((sent[1] as Sent).slice!.pages).toEqual([2, 3]);
      const { data: row } = await db().from("papers").select("digest").eq("id", paperId).single();
      expect(row!.digest).toEqual(DIGEST);
      const { data: usage } = await db().from("usage_events").select("step").eq("paper_id", paperId);
      expect(usage!.map((u) => u.step).sort()).toEqual(["deeper", "digest"]);

      calls.length = 0;
      expect((await ask("b")).at(-1).type).toBe("done");
      expect(calls).toEqual(["draw"]); // reused, not remade
    });

    it("a PDF that can't be sliced falls back to the whole PDF for every scene", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { paperId } = await upload(); // fakePdf(): not a PDF pdf-lib can open
      const evs = await walk(paperId);
      expect(evs.filter((e) => e.type === "scene")).toHaveLength(4);
      for (const s of sent.slice(1) as Sent[]) {
        expect(s.digest).toBeUndefined();
        expect(s.data).toMatch(/^data:application\/pdf;base64,/);
      }
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scene:s\d: slicing pages .* failed/));
      warn.mockRestore();
    });
  });

  it("an old saved demo recovers its bundled PDF on first open", async () => {
    const { data } = await db()
      .from("papers")
      .insert({ owner: USER, paper_key: `file:demo${randomUUID().slice(0, 6)}`, file_id: "file_01NZ22YY3uL3nLTsw36jn5po" })
      .select("*")
      .single();
    const { ensurePdf } = await import("@/lib/paperSource");
    const sha = await ensurePdf(data!);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const { data: after } = await db().from("papers").select("pdf_sha256").eq("id", data!.id).single();
    expect(after!.pdf_sha256).toBe(sha);
  });
});

describe("demo papers (regression)", () => {
  it("stream instantly to signed-out visitors by key, with no model calls", async () => {
    calls.length = 0;
    const { POST } = await import("@/app/api/play/walkthrough/route");
    const evs = await events(await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ key: "arxiv:1706.03762" }) })));
    expect(evs[0].type).toBe("plan");
    expect(evs.filter((e) => e.type === "scene").length).toBeGreaterThan(3);
    expect(evs.at(-1)).toEqual({ type: "done" });
    expect(calls).toEqual([]);
  }, 30_000);
});
