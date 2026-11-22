// Prompts for the guided walkthrough: one call plans the paper's story as scenes,
// then each scene gets its own animated diagram that continues the same visual story.
import { DIAGRAM_RULES } from "./prompts";
import { DIGEST_INSTRUCTIONS, DIGEST_SCHEMA, type PaperDigest } from "./digest";
import type { Scene, SceneKind, SceneStage } from "./walkthrough";

export const STAGES: SceneStage[] = ["problem", "prior", "idea", "method", "results", "limits"];
export const KINDS: SceneKind[] = ["diagram", "figure", "equation"];

export interface WalkthroughPlan {
  title: string;
  authors: string;
  year: number;
  motif: string; // the recurring visual cast every scene reuses
  scenes: Omit<Scene, "id" | "index" | "diagram">[];
  /** Only with PAPER_SENDING=digest (PLAN_WITH_DIGEST_SCHEMA). */
  digest?: PaperDigest;
}

export const PLAN_PROMPT = `Plan a guided walkthrough that explains the WHOLE attached paper to a curious newcomer, like a short animated explainer video told in scenes.

Return:
- title, authors (first author's surname + "et al." if several), year (0 if unknown)
- motif: 2–3 sentences defining the recurring visual cast every scene will reuse so the walkthrough feels like one continuous story: a single concrete running example from the paper's domain (e.g. one short example sentence, image or dataset row), how its parts are drawn (shapes), and which colors mean what. Keep it simple enough to draw in SVG.
- scenes: 6 to 8 scenes in story order. Stages, in this order: "problem" (1 scene: hook with the problem the paper attacks and why it matters), "prior" (1 scene: how it was done before and where that breaks), "idea" (1 scene: the key insight in one picture), "method" (2–3 scenes: how it works, step by step, each building on the last), "results" (1 scene: the headline evidence with the paper's real numbers), "limits" (1 scene: honest limitations or open questions).
  Two of the scenes are special, and every walkthrough must include exactly one of each (they count toward the 6–8 and sit where they fit the story, usually "method"; 9 scenes maximum):
  - kind "figure": a FIGURE REMAKE of the paper's most important original figure — pick the one that is hardest to read (crude, cramped, pixelated or cluttered) but explains the most. Title it after what the figure shows. Its quote MUST be that figure's caption copied verbatim (e.g. "Figure 1. High Level Google Architecture"), and pages = the page the figure is on.
  - kind "equation": the paper's single most important equation, explained at an easy level. Its quote must be the sentence(s) that introduce or state the equation, verbatim.
  Every other scene has kind "diagram". If the paper truly has no figures, use kind "diagram" instead of "figure"; if it has no equations, use "diagram" instead of "equation".
  Each scene: kind, stage, title (≤ 60 chars, a claim not a label, e.g. "RNNs must read one word at a time"), narration (1–2 plain sentences, ≤ 45 words, spoken-voice style; scenes after the first build on the previous one), pages (1-indexed PDF pages), quote (a VERBATIM 12–40 word passage from the paper that anchors this scene, copied exactly, no LaTeX, no ellipses).`;

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "authors", "year", "motif", "scenes"],
  properties: {
    title: { type: "string" },
    authors: { type: "string" },
    year: { type: "integer" },
    motif: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "stage", "title", "narration", "pages", "quote"],
        properties: {
          kind: { type: "string", enum: KINDS },
          stage: { type: "string", enum: STAGES },
          title: { type: "string" },
          narration: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          quote: { type: "string" },
        },
      },
    },
  },
} as const;

/** PAPER_SENDING=digest: the plan (which still reads the whole PDF) also writes the digest later calls read instead. */
export const PLAN_WITH_DIGEST_PROMPT = `${PLAN_PROMPT}
- ${DIGEST_INSTRUCTIONS}`;

export const PLAN_WITH_DIGEST_SCHEMA = {
  ...PLAN_SCHEMA,
  required: [...PLAN_SCHEMA.required, "digest"],
  properties: { ...PLAN_SCHEMA.properties, digest: DIGEST_SCHEMA },
} as const;

export function scenePrompt(ctx: {
  motif: string;
  scene: Omit<Scene, "diagram">;
  total: number;
  prev?: { title: string; narration: string };
  next?: { title: string };
}) {
  const { scene } = ctx;
  return `You are drawing scene ${scene.index + 1} of ${ctx.total} of a guided, animated walkthrough of the attached paper.

RECURRING VISUAL CAST (reuse it exactly so all scenes feel like one story): ${ctx.motif}

${ctx.prev ? `PREVIOUS SCENE: "${ctx.prev.title}" (${ctx.prev.narration})` : "This is the opening scene: hook the viewer with the problem."}
THIS SCENE (stage: ${scene.stage}): "${scene.title}"
NARRATION shown under the diagram: ${scene.narration}
ANCHOR (pages ${scene.pages.join(", ")}): "${scene.quote}"
${ctx.next ? `NEXT SCENE: "${ctx.next.title}" (end in a state that leads into it)` : "This is the final scene: close honestly."}

${kindRules(scene)}Build the diagram for THIS scene only. Its intro animation should act out the narration step by step (it is the "video" moment), then settle into an interactive state with a control that lets the viewer test the idea themselves. Use the diagram title "${scene.title}". The 3–5 explorables are the parts of this scene a curious viewer would stop and ask about.

${DIAGRAM_RULES}`;
}

function kindRules(scene: Omit<Scene, "diagram">): string {
  if (scene.kind === "figure")
    return `THIS IS A FIGURE REMAKE. Redraw the paper's original figure captioned "${scene.quote}" (page ${scene.pages.join(", ")}) as a clean, modern, animated version:
- Fidelity first: the same components, labels, arrows, data and numbers as the original figure. Invent nothing and add no components that aren't in it. Use the original's labels verbatim.
- Make it clearer than the original: tidy layout, no crossing arrows where avoidable, readable type, consistent shapes.
- Animate the process the figure depicts (e.g. data flowing through the components in order, each lighting up as it acts), then settle into an interactive state.
- Every labelled component is an explorable (up to 5 — choose the most important).
- The caption must start with "Redrawn from Fig. N (p. P)." using the original figure number and page.

`;
  if (scene.kind === "equation")
    return `THIS IS AN EQUATION SCENE. Explain the paper's key equation (anchored by: "${scene.quote}") at an easy level:
- Show the equation exactly as the paper states it, rendered with native MathML (<math>…</math>) inside the HTML — no external fonts or libraries. Wrap each term in <mrow data-term="term-id">.
- Build it up step by step in the intro animation: start from the simplest piece and add one term at a time, each with a one-line plain-English meaning that appears beside it.
- Include a small live example drawn in SVG (e.g. a tiny worked case) and "plug in numbers" sliders for the equation's parameters that recompute the result live in JS, with the numbers visible.
- Hovering a term highlights both the term and the part of the example it controls.
- Explorables are the equation's key terms and the example's key parts.

`;
  return "";
}
