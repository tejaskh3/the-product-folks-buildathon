// Shared contracts for the guided walkthrough and the question sidebar.
// The walkthrough explains the whole paper as an ordered sequence of scenes;
// every question the reader asks hangs off a scene (or another question) as a node.

import type { Diagram } from "./types";

export type SceneStage = "problem" | "prior" | "idea" | "method" | "results" | "limits";

/** "figure" redraws one of the paper's own figures; "equation" walks through its key equation. */
export type SceneKind = "diagram" | "figure" | "equation";

/** One step of the paper's story, shown as an animated, clickable diagram. */
export interface Scene {
  id: string; // "s1".."s8"
  index: number; // 0-based order
  stage: SceneStage;
  kind?: SceneKind; // missing means "diagram"
  title: string; // e.g. "RNNs read one word at a time"
  narration: string; // 1–2 sentences shown under the diagram, like a voice-over
  pages: number[];
  quote: string; // verbatim passage (≤ 40 words) for paper highlighting
  explanation?: string; // "In plain words": a longer, friendlier paragraph under the narration
  section?: string; // the paper section the scene draws on, e.g. "2.1.1 Description of PageRank Calculation"
  diagram: Diagram; // diagram.id === scene.id
}

/** One idea worth keeping, with a hands-on challenge in the scene where it can be tried. */
export interface Takeaway {
  idea: string;
  tryIt: string;
  sceneId: string;
}

export interface Walkthrough {
  paper: { title: string; authors: string; year?: number };
  scenes: Scene[];
  citation?: string; // full reference for the paper
  takeaways?: Takeaway[];
}

/** A node in the left sidebar tree. Scenes are roots; questions nest under what they were asked from. */
export type NodeKind = "scene" | "suggested" | "question" | "deeper";

export interface ExploreNode {
  id: string;
  kind: NodeKind;
  title: string;
  parentId: string | null; // scene id, question id, or null for paper-level questions
  diagram: Diagram | null; // null while generating
  status: "pending" | "ready" | "error";
  createdAt: number;
}

/** A scene's plan fields, without its diagram. */
export function withoutDiagram(scene: Scene): Omit<Scene, "diagram"> {
  const { id, index, stage, kind, title, narration, pages, quote, explanation, section } = scene;
  return {
    id,
    index,
    stage,
    ...(kind ? { kind } : {}),
    title,
    narration,
    pages,
    quote,
    ...(explanation ? { explanation } : {}),
    ...(section ? { section } : {}),
  };
}
