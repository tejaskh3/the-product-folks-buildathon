// Pre-generates the guided walkthrough for the demo paper, "Attention Is All You Need".
//
//   npx tsx --env-file=.env scripts/walkthrough.ts              # plan + every scene
//   npx tsx --env-file=.env scripts/walkthrough.ts --only s3,s5 # redraw scenes, keep the plan
//   npx tsx --env-file=.env scripts/walkthrough.ts --pdf public/demo/google.pdf --out public/demo/walkthrough-google.json
//
// Writes the output file after every finished scene, so progress survives crashes.
import fs from "node:fs";
import path from "node:path";
import { localPaper, spendTracker } from "./localPaper";
import { withoutDiagram, type Scene } from "../lib/walkthrough";
import { DEMO_FILE, generateWalkthrough, type DemoWalkthrough } from "../lib/walkthroughServer";

const CONCURRENCY = 4;
const BUDGET = 6; // dollars

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const onlyArg = arg("--only");
const pdfArg = arg("--pdf");
const OUT_FILE = arg("--out") ? path.resolve(arg("--out")!) : DEMO_FILE;
const only = onlyArg ? new Set(onlyArg.split(",")) : undefined;

const spend = spendTracker(BUDGET);

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

const existing: DemoWalkthrough | null = fs.existsSync(OUT_FILE)
  ? (JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as DemoWalkthrough)
  : null;

// The Attention demo by default; --pdf for any other paper.
const PDF = pdfArg ? path.resolve(pdfArg) : path.join(process.cwd(), "public/demo/attention.pdf");
if (only && !existing?.motif) throw new Error("--only needs an existing walkthrough.json with a plan");

let out: DemoWalkthrough = { paper: { title: "", authors: "" }, motif: "", scenes: [] };
let order: string[] = out.scenes.map((s) => s.id);
let plannedScenes: Omit<Scene, "diagram">[] = [];

function save() {
  out.scenes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
}

async function run(ids?: Set<string>, plan?: Parameters<typeof generateWalkthrough>[0]["plan"]) {
  const failed: string[] = [];
  const res = await generateWalkthrough({
    paper: localPaper(PDF),
    concurrency: CONCURRENCY,
    only: ids,
    plan,
    onUsage: () => spend.track,
    emit: (ev) => {
      if (ev.type === "plan") {
        order = ev.scenes.map((s) => s.id);
        plannedScenes = ev.scenes;
        if (!plan) log(`Plan: ${ev.scenes.length} scenes\n${ev.scenes.map((s) => `   ${s.id} [${s.stage}] ${s.title}`).join("\n")}`);
      } else if (ev.type === "scene") {
        const s: Scene = ev.scene;
        out.scenes = out.scenes.filter((x) => x.id !== s.id).concat(s);
        save();
        log(`✓ ${s.id} ${s.title} (${s.diagram.html.length} B, ${s.diagram.explorables.length} explorables) · spend $${spend.total.toFixed(2)}`);
      } else if (ev.type === "error" && ev.sceneId) {
        failed.push(ev.sceneId);
        log(`✗ ${ev.sceneId} ${ev.message}`);
      }
    },
  });
  return { res, failed };
}

const plan = only && existing?.motif
  ? { paper: existing.paper, motif: existing.motif, scenes: existing.scenes.map((s) => withoutDiagram(s)) }
  : undefined;

async function main() {
  out = existing && only ? existing : { paper: { title: "", authors: "" }, motif: "", scenes: [] };
  const first = await run(only, plan);
  out.paper = first.res.paper;
  out.motif = first.res.motif;
  save();

  if (first.failed.length) {
    log(`Retrying ${first.failed.join(", ")} once`);
    const again = await run(new Set(first.failed), {
      paper: first.res.paper,
      motif: first.res.motif,
      scenes: plannedScenes,
    });
    if (again.failed.length) log(`Still failing: ${again.failed.join(", ")}`);
  }

  log(`Done: ${out.scenes.length}/${order.length} scenes in ${OUT_FILE} · total spend $${spend.total.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
