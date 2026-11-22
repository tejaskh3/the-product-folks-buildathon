// Should PAPER_SENDING be "digest"? Runs one paper both ways with production's calling pattern
// (plan + every scene + a few click-deepers + one typed question + suggestions) and compares
// what it cost and whether the output still holds up.
//
//   npx tsx --env-file=.env scripts/eval-sending.ts --dry-run                       # no model calls, $0: checks the wiring, estimates the bill
//   npx tsx --env-file=.env scripts/eval-sending.ts --dry-run --cache cold          # the same estimate if the provider never caches
//   npx tsx --env-file=.env scripts/eval-sending.ts                                 # Attention (public/demo/attention.pdf), default model
//   npx tsx --env-file=.env scripts/eval-sending.ts --pdf path/to/paper.pdf --model google/gemini-3.8-flash --deepers 2
//   npx tsx --env-file=.env scripts/eval-sending.ts --pdf-url https://arxiv.org/pdf/2005.14165 --modes digest
//
// A real run costs about two papers' worth (~$0.30–0.60 on Haiku): run it on a key with credit.
//
// Per mode: $ (OpenRouter's reported cost) for the paper and per question, input / cached / output
// tokens, scenes drawn, drawing calls (retries), calls that fell back to the whole PDF, cited pages
// that needed fixing, and how many explorable quotes really appear on the pages they cite
// (checked against the PDF's text with the same matcher the reader's highlights use).
// Results (and both walkthroughs, to compare by eye) go to evals/sending-<time>.json.
import fs from "node:fs";
import path from "node:path";
import { findQuoteRanges } from "../lib/highlight";
import type { PaperDigest } from "../lib/digest";
import type { PaperRef, Usage } from "../lib/llm";
import { structuredCall } from "../lib/llm";
import { DEFAULT_MODEL, modelSpec } from "../lib/models";
import { PaperSender, bytesSlicer, type SendingMode } from "../lib/paperSending";
import { pdfPageCount } from "../lib/pdfSlice";
import { generatePlayDiagram } from "../lib/playServer";
import { SUGGEST_PROMPT, SUGGEST_SCHEMA, askPrompt, playDeeperPrompt, type Suggestions } from "../lib/playPrompts";
import { generateWalkthrough } from "../lib/walkthroughServer";
import type { Scene } from "../lib/walkthrough";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = args.includes("--dry-run");
// A dry run never touches the real key, even when .env sets one.
if (dryRun) process.env.OPENROUTER_API_KEY = "sk-or-dry-run";
/** Dry run only: "cold" bills every call as a cache miss (what a real run's "cached" column says happens). */
const coldCache = arg("--cache") === "cold";
const model = arg("--model") ?? DEFAULT_MODEL;
const deepers = Number(arg("--deepers") ?? 3);
const modes = (arg("--modes")?.split(",") ?? ["full", "digest"]) as SendingMode[];
const pdfUrl = arg("--pdf-url");
const pdfFile = path.resolve(arg("--pdf") ?? "public/demo/attention.pdf");

const sum = (us: Usage[], f: (u: Usage) => number) => us.reduce((n, u) => n + f(u), 0);

// Count what the run says about sending, and what the provider rate-limits, without changing any call.
let pageFixes = 0;
const realWarn = console.warn;
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].includes("fixing cited pages")) pageFixes++;
  realWarn(...a);
};
let requestBytes = 0;
let rateLimited = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (typeof init?.body === "string") requestBytes += init.body.length;
  const res = dryRun ? await fakeModel(init?.body as string) : await realFetch(input, init);
  if (res.status === 429) rateLimited++;
  return res;
};

interface Result {
  mode: SendingMode;
  usd: { paper: number; plan: number; scenes: number; perQuestion: number | null; suggest: number; total: number };
  tokens: { input: number; cached: number; output: number; cachedShare: number };
  scenes: { planned: number; drawn: number; drawCalls: number };
  questionsOk: number;
  fallbacks: { step: string; why: string }[];
  pageFixes: number;
  quotes: { checked: number; onCitedPage: number };
  digestChars: number;
  requestMB: number;
  rateLimited: number;
  seconds: number;
  walkthrough: { scenes: Scene[] };
  error?: string;
}

async function evalMode(mode: SendingMode, pdf: Buffer, pageText: (p: number) => Promise<string[]>): Promise<Result> {
  const filename = path.basename(pdfUrl ?? pdfFile).replace(/(\.pdf)?$/i, ".pdf");
  // Production sends the whole paper by signed URL; with no URL given it goes inline, which costs the same tokens.
  const full: PaperRef = { filename, data: pdfUrl ?? `data:application/pdf;base64,${pdf.toString("base64")}` };
  const sender = new PaperSender({ full, mode, slicer: bytesSlicer(pdf, filename) });
  const steps: { step: string; u: Usage }[] = [];
  const track = (step: string) => (u: Usage) => void steps.push({ step, u });
  pageFixes = requestBytes = rateLimited = 0;
  fakeCache.clear();
  const t0 = Date.now();
  let digest: PaperDigest | null = null;
  let scenes: Scene[] = [];
  let planned = 0;
  let questionsOk = 0;
  let error: string | undefined;

  try {
    const res = await generateWalkthrough({
      paper: sender,
      model,
      concurrency: modelSpec(model).maxConcurrency,
      onUsage: track,
      onDigest: async (d) => void (digest = d),
      emit: (ev) => ev.type === "scene" && process.stdout.write("."),
    });
    scenes = res.scenes;
    planned = res.scenes.length + res.unfinished;

    // What a reader runs up after the walkthrough: click-deepers on scene 1's parts, and one typed question on it.
    const first = scenes[0];
    if (dryRun) fakeCache.clear(); // questions come later, after the cache has expired
    const asks = [
      ...(first?.diagram.explorables.slice(0, deepers) ?? []).map((e) => ({
        id: `${first.id}/${e.id}`,
        step: "deeper",
        pages: e.pages,
        prompt: playDeeperPrompt({ parentTitle: first.diagram.title, label: e.label, blurb: e.blurb, pages: e.pages, quote: e.quote }),
      })),
      ...(first ? [{ id: "q-eval", step: "ask", pages: first.pages, prompt: askPrompt("What would break if this step were removed?") }] : []),
    ];
    for (const q of asks) {
      try {
        const { diagram } = await generatePlayDiagram({
          paper: await sender.forPages(q.pages, `${q.step}:${q.id}`),
          prompt: q.prompt,
          id: q.id,
          model,
          onStage: () => {},
          onUsage: track(q.step),
        });
        scenes.push({ ...first, id: q.id, title: diagram.title, diagram }); // quote-checked with the rest
        questionsOk++;
        process.stdout.write("+");
      } catch {
        process.stdout.write("x");
      }
    }
    await structuredCall<Suggestions>({ paper: sender.digestOnly("suggest"), prompt: SUGGEST_PROMPT, schema: SUGGEST_SCHEMA, effort: "low", maxTokens: 16000, model }).then(
      (r) => track("suggest")(r.usage),
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  process.stdout.write("\n");

  // Does each explorable's quote appear on one of the pages it cites? (Typed-question nodes included.)
  let checked = 0;
  let onCitedPage = 0;
  for (const s of scenes) {
    for (const e of s.diagram.explorables) {
      // A real quote is 12–40 words; anything much shorter would "match" almost any page.
      if ((e.quote?.trim().split(/\s+/).length ?? 0) < 6 || !e.pages?.length) continue;
      checked++;
      for (const p of e.pages) {
        const items = await pageText(p);
        if (items.length && findQuoteRanges(items, e.quote).size) {
          onCitedPage++;
          break;
        }
      }
    }
  }

  const all = steps.map((s) => s.u);
  const of = (re: RegExp) => steps.filter((s) => re.test(s.step)).map((s) => s.u);
  const questions = of(/^(deeper|ask)$/);
  const input = sum(all, (u) => u.input_tokens);
  const paperUsd = sum(of(/^(plan|scene:)/), (u) => u.cost_usd);
  return {
    mode,
    usd: {
      paper: paperUsd,
      plan: sum(of(/^plan$/), (u) => u.cost_usd),
      scenes: sum(of(/^scene:/), (u) => u.cost_usd),
      perQuestion: questionsOk ? sum(questions, (u) => u.cost_usd) / questionsOk : null,
      suggest: sum(of(/^suggest$/), (u) => u.cost_usd),
      total: sum(all, (u) => u.cost_usd),
    },
    tokens: { input, cached: sum(all, (u) => u.cached_tokens), output: sum(all, (u) => u.output_tokens), cachedShare: input ? sum(all, (u) => u.cached_tokens) / input : 0 },
    scenes: { planned, drawn: scenes.filter((s) => /^s\d+$/.test(s.id)).length, drawCalls: of(/^scene:/).length },
    questionsOk,
    fallbacks: sender.fallbacks,
    pageFixes,
    quotes: { checked, onCitedPage },
    digestChars: digest ? JSON.stringify(digest).length : 0,
    requestMB: requestBytes / 1e6,
    rateLimited,
    seconds: (Date.now() - t0) / 1000,
    walkthrough: { scenes: scenes.filter((s) => /^s\d+$/.test(s.id)) },
    ...(error ? { error } : {}),
  };
}

/** The PDF's text per page as pdf.js items, for the quote check. */
async function pageTexts(pdf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const cache = new Map<number, string[]>();
  return async (p: number) => {
    if (p < 1 || p > doc.numPages) return [];
    if (!cache.has(p)) {
      const content = await (await doc.getPage(p)).getTextContent();
      cache.set(p, content.items.map((i) => ("str" in i ? i.str : "")));
    }
    return cache.get(p)!;
  };
}

async function main() {
  if (!dryRun && !process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env first (or pass --dry-run).");
  const pdf = pdfUrl ? Buffer.from(await (await realFetch(pdfUrl, { headers: { "user-agent": "Curio/1.0" } })).arrayBuffer()) : fs.readFileSync(pdfFile);
  const pageText = await pageTexts(pdf);
  fullPageCount = await pdfPageCount(pdf);
  console.log(`Paper: ${pdfUrl ?? pdfFile} · model: ${model} · modes: ${modes.join(", ")} · ${deepers} click-deepers + 1 question${dryRun ? " · DRY RUN (fake model, $0)" : ""}\n`);

  const results: Result[] = [];
  for (const mode of modes) {
    console.log(`→ PAPER_SENDING=${mode}`);
    results.push(await evalMode(mode, pdf, pageText));
  }

  const money = (n: number | null) => (n === null ? "-" : `$${n.toFixed(3)}`);
  console.log("\nmode      $/paper   plan   scenes  $/question  suggest   total   input tok  cached  output   scenes  calls  fallbacks  page fixes  quotes on page");
  for (const r of results) {
    console.log(
      [
        r.mode.padEnd(8),
        money(r.usd.paper).padStart(8),
        money(r.usd.plan).padStart(7),
        money(r.usd.scenes).padStart(7),
        money(r.usd.perQuestion).padStart(10),
        money(r.usd.suggest).padStart(8),
        money(r.usd.total).padStart(7),
        String(r.tokens.input).padStart(11),
        `${Math.round(r.tokens.cachedShare * 100)}%`.padStart(7),
        String(r.tokens.output).padStart(7),
        `${r.scenes.drawn}/${r.scenes.planned}`.padStart(8),
        String(r.scenes.drawCalls).padStart(6),
        String(r.fallbacks.length).padStart(10),
        String(r.pageFixes).padStart(11),
        `${r.quotes.onCitedPage}/${r.quotes.checked}`.padStart(15),
      ].join(" "),
    );
    if (r.error) console.log(`    error: ${r.error}`);
    for (const f of r.fallbacks) console.log(`    whole PDF for ${f.step}: ${f.why}`);
    console.log(`    ${r.requestMB.toFixed(1)} MB sent · ${Math.round(r.seconds)}s · ${r.rateLimited} 429s${r.digestChars ? ` · digest ${r.digestChars} chars (~${Math.round(r.digestChars / 4)} tokens)` : ""}`);
  }
  const [a, b] = [results.find((r) => r.mode === "full"), results.find((r) => r.mode === "digest")];
  if (a && b && a.usd.total > 0) {
    const pct = (x: number, y: number) => `${Math.round((1 - y / x) * 100)}%`;
    console.log(`\ndigest vs full: total ${pct(a.usd.total, b.usd.total)} cheaper, paper ${pct(a.usd.paper, b.usd.paper)}, per question ${a.usd.perQuestion && b.usd.perQuestion ? pct(a.usd.perQuestion, b.usd.perQuestion) : "-"}.`);
  }
  if (a && b)
    console.log(
      `Before turning digest on: scenes drawn and drawing calls should match full, quotes-on-page should not drop by more than a few, and both walkthroughs (in the JSON) should read as well as each other.`,
    );

  const dir = path.join(process.cwd(), "evals");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `sending-${dryRun ? "dry-" : ""}${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ pdf: pdfUrl ?? pdfFile, model, deepers, dryRun, results }, null, 2));
  console.log(`\nSaved ${out}.`);
}

// --dry-run: a stand-in model that answers every call validly (a plan with a digest, diagrams citing
// the pages each call was sent, suggestions) and bills it like Anthropic would, from the request itself:
// ~2,000 tokens per PDF page, ~4 characters per text token, $1/M in and $5/M out (Haiku-like),
// and prompt caching (the prefix up to the cache marker: 1.25× to write, 0.1× to read within 5 minutes).
// The reader's questions are billed with a cold cache, as if asked more than 5 minutes after the walkthrough.
// It exercises every code path for $0; the money is an estimate, a real run is the measurement.
type FakePart = { type: string; text?: string; file?: { file_data: string }; cache_control?: unknown };
const PAGE_TOKENS = 2000;
const IN_USD = 1e-6;
const OUT_USD = 5e-6;
const fakeCache = new Set<string>();
let fullPageCount = 15;

async function fakeTokens(parts: FakePart[]): Promise<number> {
  let n = 0;
  for (const p of parts) {
    if (p.type !== "file") n += Math.ceil((p.text?.length ?? 0) / 4);
    else if (!p.file!.file_data.startsWith("data:")) n += fullPageCount * PAGE_TOKENS;
    else n += (await pdfPageCount(Buffer.from(p.file!.file_data.split(",")[1], "base64"))) * PAGE_TOKENS;
  }
  return n;
}

async function fakeModel(body: string): Promise<Response> {
  const req = JSON.parse(body) as { messages: { content: string | FakePart[] }[]; response_format: { json_schema: { schema: { properties: Record<string, unknown> } } } };
  const parts = req.messages[1].content as FakePart[];
  const prompt = parts.at(-1)!.text!;
  const sent = [...(parts.find((p) => p.text?.startsWith("The PDF attached above is NOT"))?.text?.match(/\(([\d, ]+) here/)?.[1].split(", ").map(Number) ?? [1])];
  const props = req.response_format.json_schema.schema.properties;
  let data: unknown;
  if (prompt.startsWith("Plan a guided walkthrough")) {
    const scene = (stage: string, kind: string, pages: number[]) => ({ stage, kind, title: `A ${stage} scene`, narration: "n", pages, quote: "q" });
    data = {
      title: "Dry run",
      authors: "Nobody",
      year: 2026,
      motif: "m",
      scenes: [
        scene("problem", "diagram", [1]),
        scene("prior", "diagram", [2]),
        scene("idea", "figure", [3]),
        scene("method", "equation", [4]),
        scene("method", "diagram", [5, 6]),
        scene("results", "diagram", [8]),
        scene("limits", "diagram", [10]),
      ],
      ...(props.digest ? { digest: fakeDigest() } : {}),
    };
  } else if (props.questions) {
    data = { title: "Dry run", authors: "Nobody", year: 2026, questions: [{ title: "Why?", hook: "h", pages: [2], quote: "q" }] };
  } else {
    const ids = ["a", "b", "c"];
    data = {
      title: "T",
      caption: "c",
      tryHint: "Try: t",
      html: `<svg viewBox="0 0 10 10">${ids.map((id) => `<rect data-explore="${id}"/>`).join("")}</svg>`,
      explorables: ids.map((id) => ({ id, label: id, blurb: "b", pages: sent, quote: "q" })),
    };
  }
  // Everything up to the marker is the cacheable prefix; a prefix seen before is read from cache.
  const marked = parts.findIndex((p) => p.cache_control);
  const prefix = marked >= 0 ? parts.slice(0, marked + 1) : [];
  const key = JSON.stringify([req.messages[0], prefix]);
  const prefixTokens = Math.ceil(String(req.messages[0].content).length / 4) + (await fakeTokens(prefix));
  const restTokens = await fakeTokens(parts.slice(marked + 1));
  const hit = fakeCache.has(key);
  if (!coldCache) fakeCache.add(key);
  // Output: a drawn diagram (HTML + reasoning) ~12k tokens, a plan ~3k (+3.5k for the digest), suggestions ~1k.
  const output = prompt.startsWith("Plan a guided walkthrough") ? 3000 + (props.digest ? 3500 : 0) : props.questions ? 1000 : 12000;
  const cost = (prefixTokens * (hit ? 0.1 : 1.25) + restTokens) * IN_USD + output * OUT_USD;
  const usage = { prompt_tokens: prefixTokens + restTokens, completion_tokens: output, cost, prompt_tokens_details: { cached_tokens: hit ? prefixTokens : 0 } };
  const lines = [{ choices: [{ delta: { content: JSON.stringify(data) }, finish_reason: "stop" }] }, { choices: [], usage }];
  return new Response([...lines.map((c) => `data: ${JSON.stringify(c)}`), "data: [DONE]", ""].join("\n"), { status: 200 });
}

/** About the size a real digest comes out (~3k tokens) for a 15-page paper. */
function fakeDigest(): PaperDigest {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  return {
    title: "Dry run",
    pageCount: fullPageCount,
    sections: Array.from({ length: 12 }, (_, i) => ({ heading: `${i + 1} Section`, pages: [i + 1], summary: words(60), quote: words(25) })),
    definitions: Array.from({ length: 8 }, (_, i) => ({ term: `t${i}`, meaning: words(15), page: i + 1 })),
    equations: Array.from({ length: 4 }, (_, i) => ({ label: `Eq. ${i + 1}`, text: words(10), meaning: words(20), page: 4 })),
    figures: Array.from({ length: 6 }, (_, i) => ({ label: `Figure ${i + 1}`, caption: words(20), page: i + 2 })),
    results: Array.from({ length: 6 }, () => ({ claim: words(20), page: 8 })),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
