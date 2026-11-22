// Prompts and JSON schemas for Curio's generation calls.

/** Design tokens exposed to generated diagrams as CSS variables. Mirrors app/globals.css. */
export const DIAGRAM_TOKENS = {
  "--paper": "#ffffff",
  "--paper-2": "#f8f7f5",
  "--ink": "#1a1917",
  "--ink-2": "#57554f",
  "--ink-3": "#8c8983",
  "--line": "#e7e5e0",
  "--node": "#bdb9b1",
  "--accent": "#e5702f",
  "--accent-hover": "#d6621f",
  "--accent-soft": "#fcefe6",
} as const;

export const SYSTEM_PROMPT = `You are Curio, an explainer that turns research papers into small interactive, animated diagrams. You are precise about what the paper says, and you care about how things look and feel to use.`;

export const QUESTIONS_PROMPT = `You are helping a curious engineer truly understand the attached paper.

Find the 6 questions about this paper whose answers are best shown as a moving, interactive picture rather than a paragraph. Good questions are about mechanisms ("why divide by √dₖ?", "how does masking stop the decoder from cheating?"), not trivia. Cover different parts of the paper; order them so they build on each other.

For each question give:
- id: "q1".."q6"
- title: the question, at most 60 characters
- hook: one sentence on why the answer is surprising or useful
- pages: the 1-indexed PDF page numbers where the answer lives
- quote: a VERBATIM passage from the paper (copy it exactly, 12–40 words, no ellipses, no LaTeX) that best anchors the answer. It must appear on the first listed page. Avoid passages that are mostly math symbols.
- diagramKind: one of interactive-plot, flow, matrix, geometry, comparison, timeline`;

export const DIAGRAM_RULES = `DIAGRAM CONTRACT (follow exactly):
1. Output ONE self-contained HTML body fragment: optional <style>, markup (mostly inline <svg>), and <script>. No <html>/<head>/<body> tags. Vanilla JS and SVG only. No libraries, no external URLs, no fetch/XMLHttpRequest/import, no <script src>, no web fonts, no images except inline SVG. Under 45 KB.
2. Layout: the frame is ~760px wide on desktop and ~340px on mobile. Use an <svg> with a viewBox and width="100%" so it scales; keep text ≥ 12px at 340px wide. No horizontal scrolling. Controls (sliders, toggles, buttons) sit below or beside the drawing and wrap on small screens.
3. Look: white background (var(--paper)), ink var(--ink), secondary text var(--ink-2)/var(--ink-3), hairlines var(--line), neutral nodes var(--node). ORANGE var(--accent) is reserved for things that are clickable or currently active; tint with var(--accent-soft). Font: inherit (system sans). Clean line-art style, thin 1.5px strokes, rounded caps. Calm and premium, not busy. Use ONLY these palette variables (ink, greys, and the orange accent): no violet, purple, blue, red or green, and never name a colour in captions, hints or labels (say "the highlighted arc", not "the orange arc").
4. Motion: on load, a 3–6 second intro animation that builds the idea step by step, then settles. Provide a small "Replay" button. Use requestAnimationFrame or CSS transitions on transform/opacity/stroke-dashoffset. If matchMedia('(prefers-reduced-motion: reduce)').matches, render the final state with no animation.
5. Interaction: at least one direct control (slider, toggle, draggable point, or hover-scrub) that changes the diagram live and teaches the idea. Label it clearly.
6. Explorables: 3–5 elements that represent deeper concepts get data-explore="<id>" (kebab-case ids) plus tabindex="0", role="button", aria-label, cursor:pointer, and an orange outline/tint on hover and :focus-visible. Do NOT add click handlers for these yourself; the host page handles clicks on [data-explore]. Write data-explore as a literal attribute in the markup; never create it with setAttribute or dataset. Every data-explore id must appear in the explorables list and vice versa.
7. Honesty: every number and claim comes from the paper. Where you use made-up example values (e.g. toy vectors), label them "illustrative" in small text.
8. Accessibility: meaningful <title> inside the svg, visible labels, sufficient contrast.
9. Legibility: no text may overlap other text, and no line, curve or shape may run through a label. Put axis/series labels outside the plot area or in a legend, leave margins inside the viewBox, and check label positions at both the start and end of every animation and slider range. Keep body text 12–16px and headings ≤ 20px in viewBox units at the rendered size.

For each explorable give: id (matches data-explore), label (≤ 24 chars), blurb (1–2 plain sentences that explain it), pages, and quote (VERBATIM 12–40 word passage from the paper that best anchors it, no LaTeX).
Also give: title (≤ 60 chars), caption (1–2 sentences, cite page numbers like "(p. 4)"), tryHint (starts with "Try:", one short sentence telling the viewer what to play with).`;

export function questionDiagramPrompt(q: { title: string; hook: string; pages: number[]; quote: string; diagramKind: string }) {
  return `Build the interactive diagram that answers this question about the attached paper.

QUESTION: ${q.title}
WHY IT MATTERS: ${q.hook}
ANCHOR (pages ${q.pages.join(", ")}): "${q.quote}"
SUGGESTED FORM: ${q.diagramKind}

${DIAGRAM_RULES}`;
}

export function deeperDiagramPrompt(ctx: {
  questionTitle: string;
  parentTitle: string;
  label: string;
  blurb: string;
  pages: number[];
  quote: string;
}) {
  return `The viewer was exploring the diagram "${ctx.parentTitle}" (answering "${ctx.questionTitle}") and clicked on "${ctx.label}" to go deeper.

What they clicked: ${ctx.blurb}
ANCHOR (pages ${ctx.pages.join(", ")}): "${ctx.quote}"

Build a NEW, more focused interactive diagram that explains "${ctx.label}" in depth, grounded in the attached paper. Do not repeat the parent diagram; zoom in.

${DIAGRAM_RULES}`;
}

const explorableSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "blurb", "pages", "quote"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    blurb: { type: "string" },
    pages: { type: "array", items: { type: "integer" } },
    quote: { type: "string" },
  },
} as const;

export const QUESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "hook", "pages", "quote", "diagramKind"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          hook: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          quote: { type: "string" },
          diagramKind: {
            type: "string",
            enum: ["interactive-plot", "flow", "matrix", "geometry", "comparison", "timeline"],
          },
        },
      },
    },
  },
} as const;

export const DIAGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "caption", "tryHint", "html", "explorables"],
  properties: {
    title: { type: "string" },
    caption: { type: "string" },
    tryHint: { type: "string" },
    html: { type: "string" },
    explorables: { type: "array", items: explorableSchema },
  },
} as const;
