// Shared data contracts for Curio. Every module (generation script, demo page,
// paper panel, live route) reads and writes these shapes.

export type DiagramKind =
  | "interactive-plot"
  | "flow"
  | "matrix"
  | "geometry"
  | "comparison"
  | "timeline";

/** A question Claude found in the paper, anchored to an exact passage. */
export interface Question {
  id: string; // "q1".."q6"
  title: string; // the question itself, e.g. "Why divide by √dₖ?"
  hook: string; // one line on why it's interesting
  pages: number[]; // 1-indexed PDF pages
  quote: string; // verbatim passage (≤ 40 words) used for highlighting
  diagramKind: DiagramKind;
}

/** A clickable part of a diagram (element carrying data-explore="<id>"). */
export interface Explorable {
  id: string; // kebab-case, unique within its diagram
  label: string; // short name shown in breadcrumb, e.g. "Softmax"
  blurb: string; // 1–2 sentence explanation shown instantly on click
  pages: number[];
  quote: string; // verbatim passage for highlighting
}

/** A generated interactive diagram. `html` runs inside a sandboxed iframe. */
export interface Diagram {
  id: string; // "q1" for top level, "q1/softmax" for a deeper diagram
  parentId?: string;
  title: string;
  caption: string;
  tryHint: string; // "Try: drag the dₖ slider…"
  html: string;
  explorables: Explorable[];
}

export interface Manifest {
  paper: {
    title: string;
    authors: string;
    year: number;
    pdfUrl: string; // served from /public
    fileId?: string; // legacy: the Anthropic Files API id the demo was generated from
  };
  questions: Question[];
  diagrams: Record<string, Diagram>;
}

/** Messages the in-iframe bridge posts to the parent page. */
export type BridgeMessage =
  | { ns: "curio"; type: "ready" }
  | { ns: "curio"; type: "height"; height: number }
  | { ns: "curio"; type: "explore"; id: string };

/** NDJSON lines streamed by POST /api/play/diagram and /api/play/overview. */
export type DeeperEvent =
  | { type: "status"; stage: "reading" | "drawing" | "checking" }
  | { type: "done"; diagram: Diagram }
  | { type: "error"; message: string };
