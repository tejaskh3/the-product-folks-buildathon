"use client";

// Connects /play to saved papers. The server saves everything it generates (plan, scenes,
// questions), so the client only remembers which saved paper is open and restores it.
// Only signed-in users have saved papers; anyone can load the public demo papers.
import { loadSession } from "@/lib/dbClient";
import { setPersistence, type ExplorePersistence } from "./useExploreStore";

/** Point the address bar at /play/<id> so a reload or a shared link reopens this paper. */
function showPaperUrl(id: string) {
  try {
    if (window.location.pathname !== `/play/${id}`) window.history.replaceState(window.history.state, "", `/play/${id}`);
  } catch {
    /* ignore */
  }
}

export const supabasePersistence: ExplorePersistence = {
  onPaper(_key, paper) {
    if (paper.paperId) showPaperUrl(paper.paperId);
  },

  async load(key) {
    const saved = await loadSession({ key });
    if (!saved) return null;
    if (!saved.paper.is_public) showPaperUrl(saved.paper.id);
    const walkthrough = saved.paper.walkthrough ?? undefined;
    const planned = saved.paper.walkthrough_plan?.scenes.length ?? 0;
    const complete = !!walkthrough?.scenes.length && walkthrough.scenes.length >= planned;
    return { walkthrough, nodes: saved.nodes, complete };
  },
};

setPersistence(supabasePersistence);
