// Picks Curio's model on evidence: runs a full walkthrough plus a few click-deepers on each
// candidate, with the same calling pattern production uses, and reports what it cost.
//
//   npx tsx --env-file=.env scripts/eval-models.ts                          # every model in lib/models.ts
//   npx tsx --env-file=.env scripts/eval-models.ts --models google/gemini-3.8-flash,anthropic/claude-haiku-5.5
//   npx tsx --env-file=.env scripts/eval-models.ts --deepers 5 --pdf-url https://arxiv.org/pdf/2005.14165
//
// Per model: scenes drawn / planned, how many drawing calls that took (retries), 429s seen,
// $ per paper (plan + scenes), $ per click-deeper, share of input tokens served from cache,
// and wall time. The paper is sent by one fixed URL for every call, like production, so
// provider caching behaves as it will for real users.
//
// Pricing check: Pro is $10 for 30 papers; after Dodo's fee (~$1) a paper must cost under ~$0.28.
import fs from "node:fs";
import path from "node:path";
import type { PaperRef, Usage } from "../lib/llm";
import { MODELS, modelSpec } from "../lib/models";
import { generatePlayDiagram } from "../lib/playServer";
import { playDeeperPrompt } from "../lib/playPrompts";
import { generateWalkthrough } from "../lib/walkthroughServer";
import type { Scene } from "../lib/walkthrough";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const models = arg("--models")?.split(",") ?? MODELS.map((m) => m.id);
const deepers = Number(arg("--deepers") ?? 3);
const pdfUrl = arg("--pdf-url") ?? "https://arxiv.org/pdf/1706.03762";
const PRO_LIMIT = 0.28;

// Count rate-limit answers without changing how calls are made.
let rateLimited = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a: Parameters<typeof fetch>) => {
  const res = await realFetch(...a);
  if (res.status === 429) rateLimited++;
  return res;
};

interface Result {
  model: string;
  planned: number;
  drawn: number;
  failed: number;
  drawCalls: number;
  rateLimited: number;
  paperUsd: number;
  deeperUsd: number | null;
  deepersOk: number;
  cachedShare: number;
  seconds: number;
  planSeconds: number;
  slowestSceneSeconds: number;
  avgSceneOutputTokens: number;
  avgSceneReasoningTokens: number;
  error?: string;
}

const sum = (us: Usage[], f: (u: Usage) => number) => us.reduce((n, u) => n + f(u), 0);

async function evalModel(model: string): Promise<Result> {
  const paper: PaperRef = { filename: path.basename(pdfUrl) + ".pdf", data: pdfUrl };
  const paperUsage: Usage[] = [];
  const sceneUsage: Usage[] = [];
  let planSeconds = 0;
  const deeperUsage: Usage[] = [];
  let drawCalls = 0;
  let failed = 0;
  rateLimited = 0;
  const t0 = Date.now();

  try {
    const res = await generateWalkthrough({
      paper,
      model,
      concurrency: modelSpec(model).maxConcurrency,
      onUsage: (step) => (u) => {
        paperUsage.push(u);
        if (step === "plan") planSeconds = u.latency_ms / 1000;
        if (step.startsWith("scene:")) {
          drawCalls++;
          sceneUsage.push(u);
        }
      },
      emit: (ev) => {
        if (ev.type === "error" && ev.sceneId) failed++;
        if (ev.type === "scene") process.stdout.write(".");
      },
    });

    // Click-deepers on the first scene's parts: the per-question cost users run up after a paper.
    const first: Scene | undefined = res.scenes[0];
    let deepersOk = 0;
    for (const e of first?.diagram.explorables.slice(0, deepers) ?? []) {
      try {
        await generatePlayDiagram({
          paper,
          model,
          id: `${first!.id}/${e.id}`,
          parentId: first!.id,
          prompt: playDeeperPrompt({ parentTitle: first!.diagram.title, label: e.label, blurb: e.blurb, pages: e.pages, quote: e.quote }),
          onStage: () => {},
          onUsage: (u) => {
            deeperUsage.push(u);
          },
        });
        deepersOk++;
        process.stdout.write("+");
      } catch {
        process.stdout.write("x");
      }
    }
    process.stdout.write("\n");

    const all = [...paperUsage, ...deeperUsage];
    const input = sum(all, (u) => u.input_tokens);
    return {
      model,
      planned: res.scenes.length + res.unfinished,
      drawn: res.scenes.length,
      failed,
      drawCalls,
      rateLimited,
      paperUsd: sum(paperUsage, (u) => u.cost_usd),
      deeperUsd: deeperUsage.length ? sum(deeperUsage, (u) => u.cost_usd) / Math.max(1, deepersOk) : null,
      deepersOk,
      cachedShare: input ? sum(all, (u) => u.cached_tokens) / input : 0,
      seconds: (Date.now() - t0) / 1000,
      planSeconds,
      slowestSceneSeconds: Math.max(0, ...sceneUsage.map((u) => u.latency_ms / 1000)),
      avgSceneOutputTokens: sceneUsage.length ? Math.round(sum(sceneUsage, (u) => u.output_tokens) / sceneUsage.length) : 0,
      avgSceneReasoningTokens: sceneUsage.length ? Math.round(sum(sceneUsage, (u) => u.reasoning_tokens) / sceneUsage.length) : 0,
    };
  } catch (err) {
    process.stdout.write("\n");
    return {
      model,
      planned: 0,
      drawn: 0,
      failed,
      drawCalls,
      rateLimited,
      paperUsd: sum(paperUsage, (u) => u.cost_usd),
      deeperUsd: null,
      deepersOk: 0,
      cachedShare: 0,
      seconds: (Date.now() - t0) / 1000,
      planSeconds,
      slowestSceneSeconds: 0,
      avgSceneOutputTokens: 0,
      avgSceneReasoningTokens: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env first.");
  console.log(`Paper: ${pdfUrl} · models: ${models.join(", ")} · ${deepers} click-deepers each\n`);
  const results: Result[] = [];
  for (const m of models) {
    console.log(`→ ${m}`);
    results.push(await evalModel(m));
  }

  console.log("\nmodel                          scenes  calls  429s   $/paper  $/deeper  cached   time   pro?");
  for (const r of results) {
    const pro = r.error ? "error" : r.paperUsd <= PRO_LIMIT && r.drawn === r.planned ? "ok" : "no";
    console.log(
      [
        r.model.padEnd(30),
        `${r.drawn}/${r.planned}`.padStart(6),
        String(r.drawCalls).padStart(6),
        String(r.rateLimited).padStart(5),
        `$${r.paperUsd.toFixed(3)}`.padStart(9),
        (r.deeperUsd === null ? "-" : `$${r.deeperUsd.toFixed(3)}`).padStart(9),
        `${Math.round(r.cachedShare * 100)}%`.padStart(7),
        `${Math.round(r.seconds)}s`.padStart(6),
        pro.padStart(6),
      ].join(" "),
    );
    if (r.error) console.log(`    ${r.error}`);
    else
      console.log(
        `    plan ${Math.round(r.planSeconds)}s · slowest scene ${Math.round(r.slowestSceneSeconds)}s · scene output ~${r.avgSceneOutputTokens} tokens (${r.avgSceneReasoningTokens} reasoning)`,
      );
  }

  const dir = path.join(process.cwd(), "evals");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `models-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ pdfUrl, deepers, results }, null, 2));
  console.log(`\nSaved ${out}. A paper must cost under $${PRO_LIMIT} for Pro to make money.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
