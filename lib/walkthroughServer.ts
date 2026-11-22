// Server-only: plans a paper's walkthrough and draws each scene, streaming events as they land.
// Used by POST /api/play/walkthrough and scripts/walkthrough.ts.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { structuredCall, userMessage, type PaperRef } from "./llm";
import type { PaperDigest } from "./digest";
import { PaperSender, fullSender } from "./paperSending";
import { generatePlayDiagram } from "./playServer";
import { PLAN_PROMPT, PLAN_SCHEMA, PLAN_WITH_DIGEST_PROMPT, PLAN_WITH_DIGEST_SCHEMA, STAGES, scenePrompt, type WalkthroughPlan } from "./walkthroughPrompts";
import type { Scene, Walkthrough } from "./walkthrough";
import type { WalkthroughPlanRow } from "./db";
import type { Suggestions } from "./playPrompts";
import type { WalkthroughEvent } from "./walkthroughClient";
import type { OnUsage } from "./usage";

export const DEMO_ARXIV = "1706.03762";
export const DEMO_FILE = path.join(process.cwd(), "public", "demo", "walkthrough.json");

/** A pre-generated demo walkthrough (fileId is the legacy Anthropic id it was made from). */
export type DemoWalkthrough = Walkthrough & { fileId?: string; motif?: string; suggestions?: Suggestions };

/** Papers with a pre-generated walkthrough: matched by arXiv id or by the exact PDF bytes. */
const DEMOS: { walkthrough: string; arxiv?: string; pdf?: string }[] = [
  { walkthrough: "walkthrough.json", arxiv: DEMO_ARXIV },
  { walkthrough: "walkthrough-google.json", pdf: "google.pdf" },
];
const demoPath = (f: string) => path.join(process.cwd(), "public", "demo", f);

async function readDemo(file: string): Promise<DemoWalkthrough | null> {
  try {
    return JSON.parse(await readFile(demoPath(file), "utf8")) as DemoWalkthrough;
  } catch {
    return null;
  }
}

export async function loadDemo(): Promise<DemoWalkthrough | null> {
  return readDemo("walkthrough.json");
}

/** The demo walkthrough for this arXiv id or PDF (sha256 of its bytes), if there is one. */
export async function findDemo(q: { arxiv?: string | null; pdfSha?: string | null }) {
  for (const d of DEMOS) {
    const w = await readDemo(d.walkthrough);
    if (!w?.scenes.length) continue;
    if (q.arxiv && d.arxiv === q.arxiv) return w;
    if (q.pdfSha && d.pdf) {
      const bytes = await readFile(demoPath(d.pdf)).catch(() => null);
      if (bytes && createHash("sha256").update(bytes).digest("hex") === q.pdfSha) return w;
    }
  }
  return null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

/** Normalises the plan: known stages only, sequential ids, at most 9 scenes. */
function toScenes(plan: WalkthroughPlan): Omit<Scene, "diagram">[] {
  return plan.scenes
    .filter((s) => STAGES.includes(s.stage) && s.title?.trim())
    .slice(0, 9)
    .map((s, index) => ({
      id: `s${index + 1}`,
      index,
      stage: s.stage,
      kind: s.kind === "figure" || s.kind === "equation" ? s.kind : "diagram",
      title: s.title.trim(),
      narration: s.narration.trim(),
      pages: (s.pages ?? []).filter((p) => Number.isInteger(p) && p > 0).slice(0, 6),
      quote: s.quote.trim(),
    }));
}

/**
 * Plans the walkthrough (unless a saved plan is passed), then draws the scenes up to `concurrency` at once.
 *
 *   plan ─► onPlan (saved) ─► emit plan + already-saved scenes
 *        └► pool(missing scenes): draw ─► onScene (saved) ─► emit scene
 *   deadline hit with scenes left ─► emit "continue": the client calls again and only the rest are drawn.
 *
 * `paper` is the whole PDF (every call gets it), or a PaperSender: with PAPER_SENDING=digest the plan
 * also writes the digest (onDigest saves it) and each scene gets the digest plus its own pages.
 */
export async function generateWalkthrough(opts: {
  paper: PaperRef | PaperSender;
  /** Digest mode: the digest the plan made, to save on the paper. */
  onDigest?: (d: PaperDigest) => Promise<void>;
  emit: (e: WalkthroughEvent) => void;
  concurrency: number;
  deadline?: number; // epoch ms
  /** `step` names the call ("plan", "scene:s3") for the usage ledger. */
  onUsage?: (step: string) => OnUsage;
  onPlan?: (plan: WalkthroughPlanRow) => Promise<void>;
  onScene?: (scene: Scene) => Promise<void>;
  apiKey?: string;
  model?: string;
  only?: Set<string>; // draw just these scene ids
  plan?: WalkthroughPlanRow;
  /** Scenes already drawn on an earlier run; sent right after the plan and not redrawn. */
  saved?: Scene[];
}): Promise<{ paper: Walkthrough["paper"]; motif: string; scenes: Scene[]; unfinished: number }> {
  const sender = opts.paper instanceof PaperSender ? opts.paper : fullSender(opts.paper);
  let plan = opts.plan;
  if (!plan) {
    const withDigest = sender.wantsDigest;
    const res = await structuredCall<WalkthroughPlan>({
      paper: sender.full,
      prompt: withDigest ? PLAN_WITH_DIGEST_PROMPT : PLAN_PROMPT,
      schema: withDigest ? PLAN_WITH_DIGEST_SCHEMA : PLAN_SCHEMA,
      effort: "medium",
      // The digest adds a few thousand output tokens.
      maxTokens: withDigest ? 32000 : 16000,
      apiKey: opts.apiKey,
      model: opts.model,
    });
    await opts.onUsage?.("plan")(res.usage);
    if (withDigest) {
      sender.setDigest(res.data.digest);
      if (!sender.digest) console.warn("[sending] the plan came back without a usable digest; scenes get the whole PDF");
      // A digest that isn't saved only costs the next run its savings, so it never fails this one.
      else await opts.onDigest?.(sender.digest).catch((e: unknown) => console.error("[sending] couldn’t save the digest", e));
    }
    const scenes = toScenes(res.data);
    if (scenes.length < 3) throw new Error("The walkthrough plan came back too short.");
    plan = {
      paper: { title: res.data.title, authors: res.data.authors, ...(res.data.year ? { year: res.data.year } : {}) },
      motif: res.data.motif,
      scenes,
    };
    await opts.onPlan?.(plan);
  }
  const { paper, motif, scenes: planned } = plan;
  opts.emit({ type: "plan", paper, scenes: planned });

  const done = new Map<string, Scene>();
  for (const sc of opts.saved ?? []) {
    done.set(sc.id, sc);
    opts.emit({ type: "scene", scene: sc });
  }
  const failed = new Set<string>();
  const todo = planned.filter((s) => !done.has(s.id) && (!opts.only || opts.only.has(s.id)));
  let timedOut = false;

  const work = pool(todo, opts.concurrency, async (s) => {
    if (timedOut) return;
    const i = s.index;
    try {
      const { diagram } = await generatePlayDiagram({
        paper: await sender.forPages(s.pages, `scene:${s.id}`),
        id: s.id,
        prompt: scenePrompt({
          motif,
          scene: s,
          total: planned.length,
          prev: i > 0 ? { title: planned[i - 1].title, narration: planned[i - 1].narration } : undefined,
          next: i < planned.length - 1 ? { title: planned[i + 1].title } : undefined,
        }),
        onStage: (stage) => opts.emit({ type: "status", sceneId: s.id, stage }),
        onUsage: opts.onUsage?.(`scene:${s.id}`),
        apiKey: opts.apiKey,
        model: opts.model,
      });
      const scene: Scene = { ...s, diagram: { ...diagram, id: s.id } };
      // Saved even after the deadline: the work is paid for, and the next run will pick it up.
      await opts.onScene?.(scene).catch((e: unknown) => console.error(`[walkthrough] ${s.id} couldn’t be saved`, e));
      done.set(s.id, scene);
      if (!timedOut) opts.emit({ type: "scene", scene });
    } catch (err) {
      console.error(`[walkthrough] ${s.id} failed`, err);
      failed.add(s.id);
      if (!timedOut) opts.emit({ type: "error", sceneId: s.id, message: userMessage(err, "this scene") });
    }
  });

  if (opts.deadline) {
    const left = opts.deadline - Date.now();
    await Promise.race([work, new Promise<void>((r) => setTimeout(r, Math.max(0, left)))]);
    if (todo.some((s) => !done.has(s.id) && !failed.has(s.id))) {
      timedOut = true;
      opts.emit({ type: "continue" });
    }
  } else {
    await work;
  }

  const scenes = planned.map((s) => done.get(s.id)).filter((s): s is Scene => !!s);
  return { paper, motif, scenes, unfinished: planned.length - scenes.length };
}
