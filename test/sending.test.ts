// PAPER_SENDING: what each call sends about the paper (lib/paperSending.ts, lib/pdfSlice.ts, lib/digest.ts).
// The model is a stubbed fetch, so these read the exact request bodies a walkthrough would send.
//
//   full    every call ──► the whole PDF, byte-identical to before
//   digest  plan ──► whole PDF + "return a digest" · scenes ──► digest (cached prefix) + PDF of cited pages
//           slicing fails / no digest / no pages ──► the whole PDF for that call
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digestPages, digestText, type PaperDigest } from "@/lib/digest";
import { DIGEST_ONLY_NOTE, sliceNote, structuredCall, type PaperRef } from "@/lib/llm";
import { PaperSender, bytesSlicer, sendingMode, type Slicer } from "@/lib/paperSending";
import { slicePages, slicePdf } from "@/lib/pdfSlice";
import { citedPageProblems, fixCitedPages } from "@/lib/playServer";
import type { RawDiagram } from "@/lib/llm";
import { PLAN_PROMPT, PLAN_SCHEMA } from "@/lib/walkthroughPrompts";
import { generateWalkthrough } from "@/lib/walkthroughServer";

const attention = readFileSync(path.join(__dirname, "..", "public", "demo", "attention.pdf")); // 15 pages
const full: PaperRef = { filename: "attention.pdf", data: "https://storage.example/attention.pdf?token=abc" };

const DIGEST: PaperDigest = {
  title: "Attention Is All You Need",
  pageCount: 15,
  sections: [
    { heading: "1 Introduction", pages: [1, 2], summary: "RNNs read one token at a time.", quote: "Recurrent models typically factor computation along the symbol positions." },
    { heading: "3 Model Architecture", pages: [3, 4, 5], summary: "An encoder-decoder built from attention.", quote: "The Transformer follows this overall architecture." },
  ],
  definitions: [{ term: "d_k", meaning: "Key dimension.", page: 4 }],
  equations: [{ label: "Eq. 1", text: "softmax(QK^T / sqrt(d_k)) V", meaning: "Scaled dot-product attention.", page: 4 }],
  figures: [{ label: "Figure 1", caption: "The Transformer - model architecture.", page: 3 }],
  results: [{ claim: "28.4 BLEU on WMT 2014 English-to-German.", page: 8 }],
};

// The plan's scenes: one per kind of page citation, including one with none.
const PLAN = {
  title: "Attention Is All You Need",
  authors: "Vaswani et al.",
  year: 2017,
  motif: "m",
  scenes: [
    { kind: "diagram", stage: "problem", title: "One", narration: "n", pages: [1], quote: "q" },
    { kind: "figure", stage: "idea", title: "Two", narration: "n", pages: [3], quote: "q" },
    { kind: "equation", stage: "method", title: "Three", narration: "n", pages: [4, 5], quote: "q" },
    { kind: "diagram", stage: "results", title: "Four", narration: "n", pages: [], quote: "q" },
  ],
};

const diagram = (pages: number[] = [1]): RawDiagram => ({
  title: "T",
  caption: "c",
  tryHint: "Try: t",
  html: `<svg viewBox="0 0 10 10">${["a", "b", "c"].map((id) => `<rect data-explore="${id}"/>`).join("")}</svg>`,
  explorables: ["a", "b", "c"].map((id) => ({ id, label: id, blurb: "b", pages, quote: "q" })),
});

function sse(data: unknown): Response {
  const usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.001, prompt_tokens_details: { cached_tokens: 0 } };
  const lines = [{ choices: [{ delta: { content: JSON.stringify(data) }, finish_reason: "stop" }] }, { choices: [], usage }];
  return new Response([...lines.map((c) => `data: ${JSON.stringify(c)}`), "data: [DONE]", ""].join("\n"), { status: 200 });
}

type Body = { messages: { role: string; content: string | Part[] }[]; response_format: { json_schema: { schema: { properties: Record<string, unknown> } } } };
type Part = { type: string; text?: string; file?: { filename: string; file_data: string }; cache_control?: unknown };

/** Stubs the model; returns every request body sent. The plan includes a digest when its schema asks for one. */
function stubModel(planDigest: unknown = DIGEST) {
  const bodies: Body[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Body;
      bodies.push(body);
      const prompt = (body.messages[1].content as Part[]).at(-1)!.text!;
      if (prompt.startsWith("Plan a guided walkthrough")) {
        return sse(body.response_format.json_schema.schema.properties.digest ? { ...PLAN, digest: planDigest } : PLAN);
      }
      return sse(diagram());
    }),
  );
  return bodies;
}

const userParts = (b: Body) => b.messages[1].content as Part[];
const isPlan = (b: Body) => userParts(b).at(-1)!.text!.startsWith("Plan a guided walkthrough");
/** Which scene a drawing request is for ("THIS SCENE … "Two""). */
const sceneOf = (b: Body) => userParts(b).at(-1)!.text!.match(/THIS SCENE \(stage: \w+\): "(\w+)"/)![1];
const pdfPages = async (dataUrl: string) => (await PDFDocument.load(Buffer.from(dataUrl.split(",")[1], "base64"))).getPageCount();

async function walk(sender: PaperSender | PaperRef, extra: Partial<Parameters<typeof generateWalkthrough>[0]> = {}) {
  const onDigest = vi.fn(async () => {});
  const res = await generateWalkthrough({ paper: sender, concurrency: 1, emit: () => {}, onDigest, model: "anthropic/claude-haiku-5.5", ...extra });
  return { res, onDigest };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendingMode", () => {
  it("is full unless PAPER_SENDING=digest", () => {
    vi.stubEnv("PAPER_SENDING", "");
    expect(sendingMode()).toBe("full");
    vi.stubEnv("PAPER_SENDING", "nonsense");
    expect(sendingMode()).toBe("full");
    vi.stubEnv("PAPER_SENDING", "digest");
    expect(sendingMode()).toBe("digest");
  });
});

describe("slicePages", () => {
  it("sends the cited pages plus the page after, at most 3", () => {
    expect(slicePages([5], 15)).toEqual([5, 6]);
    expect(slicePages([4, 5], 15)).toEqual([4, 5, 6]);
    expect(slicePages([4, 6], 15)).toEqual([4, 5, 6]);
    expect(slicePages([2, 3, 7, 8, 9], 15)).toEqual([2, 3, 7]);
    expect(slicePages([15], 15)).toEqual([15]);
  });

  it("ignores pages the paper doesn't have", () => {
    expect(slicePages([0, 99, 3.5], 15)).toEqual([]);
    expect(slicePages([99, 14], 15)).toEqual([14, 15]);
  });
});

describe("slicePdf", () => {
  it("makes a real PDF of just those pages", async () => {
    const out = await slicePdf(attention, [4, 5, 6]);
    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
    expect(out.length).toBeLessThan(attention.length);
  });

  it("refuses pages outside the paper", async () => {
    await expect(slicePdf(attention, [16])).rejects.toThrow(/15-page/);
  });
});

describe("digestText", () => {
  it("renders the same bytes whatever order the stored keys come back in (jsonb reorders them)", () => {
    const shuffled = JSON.parse(
      JSON.stringify({
        results: DIGEST.results,
        figures: DIGEST.figures.map((f) => ({ page: f.page, caption: f.caption, label: f.label })),
        equations: DIGEST.equations,
        definitions: DIGEST.definitions,
        sections: DIGEST.sections.map((s) => ({ quote: s.quote, summary: s.summary, pages: s.pages, heading: s.heading })),
        pageCount: DIGEST.pageCount,
        title: DIGEST.title,
      }),
    ) as PaperDigest;
    expect(digestText(shuffled)).toBe(digestText(DIGEST));
    expect(digestText(DIGEST)).toContain('Figure 1 (p. 3): "The Transformer - model architecture."');
    expect(digestPages(DIGEST)).toEqual([1, 2, 3, 4, 5, 8]);
  });
});

describe("PAPER_SENDING=full", () => {
  it("a walkthrough sends exactly what it sent before: the whole PDF on every call, no digest asked for", async () => {
    const before = stubModel();
    await walk(full);
    const after = stubModel();
    // A full-mode sender (even one holding a digest and a slicer) changes nothing, byte for byte.
    const { onDigest } = await walk(new PaperSender({ full, mode: "full", digest: DIGEST, slicer: bytesSlicer(attention, "attention.pdf") }));

    expect(after.map((b) => JSON.stringify(b))).toEqual(before.map((b) => JSON.stringify(b)));
    expect(after).toHaveLength(1 + PLAN.scenes.length);
    for (const b of after) {
      const [file, marker] = userParts(b);
      expect(file).toEqual({ type: "file", file: { filename: "attention.pdf", file_data: full.data } });
      expect(marker).toEqual({ type: "text", text: "The paper is attached above.", cache_control: { type: "ephemeral" } });
    }
    const plan = after.find(isPlan)!;
    expect(userParts(plan).at(-1)!.text).toBe(PLAN_PROMPT);
    expect(plan.response_format.json_schema.schema).toEqual(PLAN_SCHEMA);
    expect(onDigest).not.toHaveBeenCalled();
  });
});

describe("PAPER_SENDING=digest", () => {
  const digestSender = (over: { digest?: unknown; slicer?: Slicer } = {}) =>
    new PaperSender({ full, mode: "digest", slicer: bytesSlicer(attention, "attention.pdf"), ...over });

  it("the plan reads the whole PDF and returns the digest, which is saved once", async () => {
    const bodies = stubModel();
    const sender = digestSender();
    const { onDigest } = await walk(sender);

    const plan = bodies.find(isPlan)!;
    expect(userParts(plan)[0].file!.file_data).toBe(full.data);
    expect(plan.response_format.json_schema.schema.properties.digest).toBeDefined();
    expect(userParts(plan).at(-1)!.text).toContain("digest: a compact study guide");
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(onDigest).toHaveBeenCalledWith(DIGEST);
    expect(sender.digest).toEqual(DIGEST);
  });

  it("each scene gets the digest plus a PDF of only its cited pages, labelled in the paper's numbering", async () => {
    const bodies = stubModel();
    await walk(digestSender());

    const expected: Record<string, number[]> = { One: [1, 2], Two: [3, 4], Three: [4, 5, 6] };
    const scenes = bodies.filter((b) => !isPlan(b) && sceneOf(b) !== "Four");
    expect(scenes).toHaveLength(3);
    for (const b of scenes) {
      const pages = expected[sceneOf(b)];
      const [digest, file, note] = userParts(b);
      expect(digest.text).toContain(digestText(DIGEST));
      expect(digest.cache_control).toEqual({ type: "ephemeral" });
      expect(file.file!.filename).toBe(`attention-p${pages.join("-")}.pdf`);
      expect(await pdfPages(file.file!.file_data)).toBe(pages.length);
      expect(note.text).toBe(sliceNote(pages));
      expect(note.text).toContain(`its first page is the paper's page ${pages[0]}`);
      expect(userParts(b)).toHaveLength(4); // digest · slice · note · prompt
    }
  });

  it("keeps the cached prefix (system prompt + digest) byte-identical across a paper's calls, and across runs", async () => {
    const first = stubModel();
    await walk(digestSender());
    const prefix = (b: Body) => JSON.stringify([b.messages[0], userParts(b)[0]]);
    const drawn = first.filter((b) => !isPlan(b) && sceneOf(b) !== "Four");
    expect(new Set(drawn.map(prefix)).size).toBe(1);

    // A later run (resume) reads the digest back from the database, keys reordered by jsonb.
    const second = stubModel();
    const reread = Object.fromEntries(Object.entries(structuredClone(DIGEST)).reverse());
    const sender = digestSender({ digest: reread });
    const plan = { paper: { title: PLAN.title, authors: PLAN.authors }, motif: "m", scenes: PLAN.scenes.map((s, i) => ({ ...s, id: `s${i + 1}`, index: i })) } as never;
    await walk(sender, { plan, only: new Set(["s1"]) });
    expect(second).toHaveLength(1);
    expect(prefix(second[0])).toBe(prefix(drawn[0]));
  });

  it("falls back to the whole PDF when a scene cites no pages, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = stubModel();
    const sender = digestSender();
    await walk(sender);
    const four = bodies.find((b) => !isPlan(b) && sceneOf(b) === "Four")!;
    expect(userParts(four)[0].file!.file_data).toBe(full.data);
    expect(sender.fallbacks).toEqual([{ step: "scene:s4", why: "no pages to send" }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scene:s4: no pages to send; sending the whole PDF/));
  });

  it("falls back to the whole PDF for every scene when slicing fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = stubModel();
    const sender = digestSender({ slicer: async () => Promise.reject(new Error("corrupt PDF")) });
    const { res } = await walk(sender);
    expect(res.scenes).toHaveLength(PLAN.scenes.length);
    for (const b of bodies.filter((x) => !isPlan(x))) {
      expect(userParts(b)[0]).toEqual({ type: "file", file: { filename: "attention.pdf", file_data: full.data } });
      expect(userParts(b)[1].text).toBe("The paper is attached above.");
    }
    expect(sender.fallbacks.filter((f) => /corrupt PDF/.test(f.why))).toHaveLength(3);
  });

  it("falls back to the whole PDF when the plan returns no usable digest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = stubModel({ title: "x", pageCount: 0, sections: [], definitions: [], equations: [], figures: [], results: [] });
    const { onDigest } = await walk(digestSender());
    expect(onDigest).not.toHaveBeenCalled();
    for (const b of bodies.filter((x) => !isPlan(x))) expect(userParts(b)[0].file!.file_data).toBe(full.data);
  });

  it("suggestions get the digest alone, no PDF", async () => {
    const bodies = stubModel();
    await structuredCall({ paper: digestSender({ digest: DIGEST }).digestOnly("suggest"), prompt: "suggest", schema: {}, effort: "low", model: "anthropic/claude-haiku-5.5" });
    const parts = userParts(bodies[0]);
    expect(parts.map((p) => p.type)).toEqual(["text", "text", "text"]);
    expect(parts[0].cache_control).toEqual({ type: "ephemeral" });
    expect(parts[1].text).toBe(DIGEST_ONLY_NOTE);
  });

  it("without a digest, suggestions get the whole PDF", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(digestSender().digestOnly("suggest")).toBe(full);
  });
});

describe("cited pages in digest mode", () => {
  const input = { digest: "d", digestPages: [1, 2, 3, 8], slice: { filename: "s.pdf", data: "x", pages: [4, 5, 6] } };

  it("flags pages the call was neither sent nor told about", () => {
    expect(citedPageProblems(diagram([4, 8]), input)).toEqual([]);
    expect(citedPageProblems(diagram([11]), input)).toHaveLength(3);
    expect(citedPageProblems(diagram([11]), full)).toEqual([]); // the whole PDF: anything goes
  });

  it("maps excerpt positions back to the paper's pages, and drops the rest", () => {
    const d = diagram();
    d.explorables[0].pages = [5]; // fine: sent
    d.explorables[1].pages = [9]; // unknown, not a position in a 3-page excerpt → the excerpt's pages
    d.explorables[2].pages = [3, 7]; // 3 is in the digest; 7 is unknown
    const { diagram: out, fixed } = fixCitedPages(d, input);
    expect(fixed).toBe(2);
    expect(out.explorables.map((e) => e.pages)).toEqual([[5], [4, 5, 6], [3]]);

    const local = diagram([2]); // "page 2" of the excerpt... but page 2 is in the digest, so it stays
    expect(fixCitedPages(local, input).fixed).toBe(0);
    const positional = diagram([3]);
    expect(fixCitedPages(positional, { ...input, digestPages: [] }).diagram.explorables[0].pages).toEqual([6]);
  });
});
