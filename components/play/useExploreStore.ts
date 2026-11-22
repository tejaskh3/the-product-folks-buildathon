"use client";

// One store for a /play session: the paper, its guided walkthrough, every question
// asked (as a tree of ExploreNodes) and where the reader currently is.
import { useReducer } from "react";
import type { Diagram } from "@/lib/types";
import type { ExploreNode, Scene, Walkthrough } from "@/lib/walkthrough";

export type LiveStage = "reading" | "drawing" | "checking";
export type SceneStatus = "pending" | LiveStage | "ready" | "error";
export type PlanScene = Omit<Scene, "diagram"> & { diagram: Diagram | null; status: SceneStatus; error?: string };
export type Cursor = { kind: "scene"; id: string } | { kind: "node"; id: string };
export type Anchor = { pages: number[]; quote: string; label?: string };

export interface PaperInfo {
  /** The user's saved copy; null for a demo opened while signed out. */
  paperId: string | null;
  /** "arxiv:<id>", "sha:<pdf sha256>", or a legacy key on papers saved before v1. */
  key: string;
  arxivId?: string;
  name: string;
  pdfUrl: string;
  /** A library paper: one shared copy, with a public discussion. */
  isPublic?: boolean;
}

export interface ExploreState {
  paper: PaperInfo | null;
  meta: Walkthrough["paper"] | null;
  /** Paper-level extras: full reference and the closing "key ideas". */
  extras: Pick<Walkthrough, "citation" | "takeaways">;
  scenes: PlanScene[];
  walk: "idle" | "planning" | "streaming" | "done" | "error";
  walkError?: string;
  nodes: ExploreNode[];
  /** Per-node extras the shared ExploreNode type doesn't carry. */
  stages: Record<string, LiveStage>;
  errors: Record<string, string>;
  anchors: Record<string, Anchor>;
  cursor: Cursor | null;
}

const initial: ExploreState = {
  paper: null,
  meta: null,
  extras: {},
  scenes: [],
  walk: "idle",
  nodes: [],
  stages: {},
  errors: {},
  anchors: {},
  cursor: null,
};

type Action =
  | { type: "reset" }
  | { type: "paper"; paper: PaperInfo }
  | { type: "walk"; walk: ExploreState["walk"]; error?: string }
  | { type: "plan"; meta: Walkthrough["paper"]; scenes: Omit<Scene, "diagram">[]; extras?: Pick<Walkthrough, "citation" | "takeaways"> }
  | { type: "sceneStatus"; id: string; status: SceneStatus; error?: string }
  | { type: "scene"; scene: Scene }
  | { type: "hydrate"; walkthrough?: Walkthrough; nodes?: ExploreNode[] }
  | { type: "addNode"; node: ExploreNode; anchor?: Anchor }
  | { type: "nodeStage"; id: string; stage: LiveStage }
  | { type: "nodeReady"; id: string; diagram: Diagram }
  | { type: "nodeError"; id: string; message: string }
  | { type: "retryNode"; id: string }
  | { type: "go"; cursor: Cursor };

function reducer(s: ExploreState, a: Action): ExploreState {
  switch (a.type) {
    case "reset":
      return initial;
    case "paper":
      return { ...initial, paper: a.paper, walk: "planning" };
    case "walk":
      return { ...s, walk: a.walk, walkError: a.error };
    case "plan": {
      // A resumed walkthrough sends the plan again: scenes already drawn stay as they are.
      const drawn = new Map(s.scenes.filter((sc) => sc.status === "ready").map((sc) => [sc.id, sc]));
      const scenes = [...a.scenes]
        .sort((x, y) => x.index - y.index)
        .map((sc) => drawn.get(sc.id) ?? { ...sc, diagram: null, status: "pending" as SceneStatus });
      return { ...s, meta: a.meta, extras: a.extras ?? {}, scenes, walk: "streaming", cursor: s.cursor ?? (scenes[0] ? { kind: "scene", id: scenes[0].id } : null) };
    }
    case "sceneStatus":
      return { ...s, scenes: s.scenes.map((sc) => (sc.id === a.id ? { ...sc, status: a.status, error: a.error } : sc)) };
    case "scene": {
      const exists = s.scenes.some((sc) => sc.id === a.scene.id);
      const next: PlanScene = { ...a.scene, status: "ready" };
      const scenes = exists ? s.scenes.map((sc) => (sc.id === a.scene.id ? next : sc)) : [...s.scenes, next].sort((x, y) => x.index - y.index);
      return { ...s, scenes, cursor: s.cursor ?? { kind: "scene", id: a.scene.id } };
    }
    case "hydrate": {
      const scenes = a.walkthrough ? a.walkthrough.scenes.map((sc) => ({ ...sc, status: "ready" as SceneStatus })) : s.scenes;
      const nodes = a.nodes ? a.nodes.map((n) => (n.status === "pending" ? { ...n, status: "error" as const } : n)) : s.nodes;
      return {
        ...s,
        meta: a.walkthrough?.paper ?? s.meta,
        extras: a.walkthrough ? { citation: a.walkthrough.citation, takeaways: a.walkthrough.takeaways } : s.extras,
        scenes,
        nodes,
        walk: a.walkthrough ? "done" : s.walk,
        cursor: s.cursor ?? (scenes[0] ? { kind: "scene", id: scenes[0].id } : null),
      };
    }
    case "addNode":
      return {
        ...s,
        nodes: [...s.nodes, a.node],
        stages: { ...s.stages, [a.node.id]: "reading" },
        anchors: a.anchor ? { ...s.anchors, [a.node.id]: a.anchor } : s.anchors,
      };
    case "nodeStage":
      return { ...s, stages: { ...s.stages, [a.id]: a.stage } };
    case "nodeReady":
      return { ...s, nodes: s.nodes.map((n) => (n.id === a.id ? { ...n, diagram: a.diagram, status: "ready" } : n)) };
    case "nodeError":
      return {
        ...s,
        nodes: s.nodes.map((n) => (n.id === a.id ? { ...n, status: "error" } : n)),
        errors: { ...s.errors, [a.id]: a.message },
      };
    case "retryNode": {
      const errors = { ...s.errors };
      delete errors[a.id];
      return {
        ...s,
        nodes: s.nodes.map((n) => (n.id === a.id ? { ...n, status: "pending" } : n)),
        stages: { ...s.stages, [a.id]: "reading" },
        errors,
      };
    }
    case "go":
      return { ...s, cursor: a.cursor };
  }
}

export function useExploreStore() {
  return useReducer(reducer, initial);
}

// ---- Tree helpers -------------------------------------------------------------

export function childrenOf(nodes: ExploreNode[], parentId: string | null) {
  return nodes.filter((n) => n.parentId === parentId);
}

/** The scene a node hangs under (walking up through parent questions), if any. */
export function rootSceneId(s: ExploreState, nodeId: string): string | null {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const sceneIds = new Set(s.scenes.map((sc) => sc.id));
  let cur = byId.get(nodeId);
  for (let guard = 0; cur && guard < 50; guard++) {
    if (cur.parentId === null) return null;
    if (sceneIds.has(cur.parentId)) return cur.parentId;
    cur = byId.get(cur.parentId);
  }
  return null;
}

/** Ancestors of a node, top-down, excluding the scene itself. */
export function nodeLineage(s: ExploreState, nodeId: string): ExploreNode[] {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const out: ExploreNode[] = [];
  let cur = byId.get(nodeId);
  for (let guard = 0; cur && guard < 50; guard++) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

// ---- Persistence hook (a DB layer plugs in here; default is a no-op) ----------

/** Stable key for a paper, set by the server at upload. */
export function paperKey(p: PaperInfo) {
  return p.key;
}

// Scenes and nodes are saved by the server as they're generated; the client only opens and restores.
export interface ExplorePersistence {
  /** A paper was opened (after upload). */
  onPaper?(key: string, paper: PaperInfo): void | Promise<void>;
  /** Restore a saved session for this paper; return null when there's nothing saved.
   *  `complete` is false when the walkthrough still has scenes to draw. */
  load?(key: string): Promise<{ walkthrough?: Walkthrough; nodes?: ExploreNode[]; complete: boolean } | null>;
}

let persistence: ExplorePersistence = {};

export function setPersistence(p: ExplorePersistence) {
  persistence = p;
}

export function getPersistence(): ExplorePersistence {
  return persistence;
}

/** Fire-and-forget a persistence call; storage failures must never break the page. */
export function persist(fn: () => void | Promise<void>) {
  try {
    Promise.resolve(fn()).catch(() => {});
  } catch {
    /* ignore */
  }
}
