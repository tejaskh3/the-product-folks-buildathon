// Pre-generates the Curio demo for "Attention Is All You Need".
//
//   npm run generate                 # everything (skips diagrams already in the manifest)
//   npm run generate -- --only q3    # regenerate one question (and its deeper diagrams)
//   npm run generate -- --fresh      # ignore the existing manifest
//   npm run generate -- --no-deeper  # skip the deeper wave
//
// Writes public/demo/manifest.json after every finished diagram, so progress survives crashes.
import fs from "node:fs";
import path from "node:path";
import { generateDiagram, structuredCall } from "../lib/llm";
import { localPaper, spendTracker } from "./localPaper";
import { QUESTIONS_PROMPT, QUESTIONS_SCHEMA, deeperDiagramPrompt, questionDiagramPrompt } from "../lib/prompts";
import type { Manifest, Question } from "../lib/types";

const PDF = path.join(process.cwd(), "public/demo/attention.pdf");
const OUT = path.join(process.cwd(), "public/demo/manifest.json");
const DEEPER_PER_QUESTION = 2;
const CONCURRENCY = 4; // new credit accounts have low rate limits

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const fresh = args.includes("--fresh");
const skipDeeper = args.includes("--no-deeper");

const spend = spendTracker();
const track = spend.track;

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

function load(): Manifest {
  if (!fresh && fs.existsSync(OUT)) {
    const m = JSON.parse(fs.readFileSync(OUT, "utf8")) as Manifest;
    if (m.paper) return m;
  }
  return {
    paper: { title: "Attention Is All You Need", authors: "Vaswani et al.", year: 2017, pdfUrl: "/demo/attention.pdf" },
    questions: [],
    diagrams: {},
  };
}

const manifest = load();
function save() {
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

const results: { id: string; ok: boolean; bytes?: number; note?: string }[] = [];

async function makeDiagram(id: string, prompt: string, parentId?: string) {
  const start = Date.now();
  try {
    const { diagram, usage } = await generateDiagram({ paper: localPaper(PDF), prompt, id, parentId });
    usage.forEach(track);
    manifest.diagrams[id] = diagram;
    save();
    results.push({ id, ok: true, bytes: diagram.html.length, note: usage.length > 1 ? "retried" : "" });
    log(`✓ ${id} (${((Date.now() - start) / 1000).toFixed(0)}s, ${diagram.html.length} B, ${diagram.explorables.length} explorables) · spend so far $${spend.total.toFixed(2)}`);
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 160) });
    log(`✗ ${id}: ${(e as Error).message}`);
  }
}

async function main() {
  // 1. The paper, sent inline with every call.
  const paper = localPaper(PDF);

  // 2. Questions.
  if (manifest.questions.length === 0) {
    log("Finding questions (effort high)…");
    const { data, usage } = await structuredCall<{ questions: Question[] }>({
      paper,
      prompt: QUESTIONS_PROMPT,
      schema: QUESTIONS_SCHEMA,
      effort: "high",
    });
    track(usage);
    log(`Questions done · spend so far $${spend.total.toFixed(2)}`);
    manifest.questions = data.questions;
    save();
    data.questions.forEach((q) => log(`  ${q.id}: ${q.title}  (p. ${q.pages.join(",")})`));
  }

  const targets = manifest.questions.filter((q) => !only || q.id === only);
  if (only && targets.length === 0) throw new Error(`No question with id ${only}`);

  // 3. Top-level diagrams, in parallel.
  const wave1 = targets.filter((q) => only || !manifest.diagrams[q.id]);
  log(`Wave 1: ${wave1.length} diagrams`);
  await pool(wave1, CONCURRENCY, (q) => makeDiagram(q.id, questionDiagramPrompt(q)));

  // 4. Deeper diagrams for the first N explorables of each question.
  if (!skipDeeper) {
    const jobs: { id: string; prompt: string; parentId: string }[] = [];
    for (const q of targets) {
      const parent = manifest.diagrams[q.id];
      if (!parent) continue;
      for (const e of parent.explorables.slice(0, DEEPER_PER_QUESTION)) {
        const id = `${q.id}/${e.id}`;
        if (!only && manifest.diagrams[id]) continue;
        jobs.push({
          id,
          parentId: q.id,
          prompt: deeperDiagramPrompt({
            questionTitle: q.title,
            parentTitle: parent.title,
            label: e.label,
            blurb: e.blurb,
            pages: e.pages,
            quote: e.quote,
          }),
        });
      }
    }
    log(`Wave 2: ${jobs.length} deeper diagrams`);
    await pool(jobs, CONCURRENCY, (j) => makeDiagram(j.id, j.prompt, j.parentId));
  }

  // 5. Summary.
  // Drop deeper diagrams whose explorable no longer exists on the (possibly regenerated) parent.
  for (const [id, d] of Object.entries(manifest.diagrams)) {
    if (d.parentId) {
      const parent = manifest.diagrams[d.parentId];
      const eid = id.split("/")[1];
      if (!parent || !parent.explorables.some((e) => e.id === eid)) delete manifest.diagrams[id];
    }
  }
  save();
  console.log("\nid                         ok   bytes   note");
  for (const r of results.sort((a, b) => a.id.localeCompare(b.id)))
    console.log(`${r.id.padEnd(26)} ${r.ok ? "✓ " : "✗ "}  ${String(r.bytes ?? "").padStart(6)}  ${r.note ?? ""}`);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed · ${Object.keys(manifest.diagrams).length} diagrams in manifest · ~$${spend.total.toFixed(2)} this run · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
