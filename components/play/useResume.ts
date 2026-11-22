"use client";

// Reopens a saved paper when /play/<paperId> is loaded directly (reload or shared link).
import { useEffect, useRef, useState } from "react";
import { loadSession } from "@/lib/dbClient";
import type { PaperInfo, useExploreStore } from "./useExploreStore";

type Dispatch = ReturnType<typeof useExploreStore>[1];

export function paperIdFromPath(): string | null {
  try {
    const m = window.location.pathname.match(/^\/play\/([0-9a-f-]{36})\/?$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Loads the saved paper named in the URL once auth has loaded. Returns an error message, if any. */
export function useResumeFromUrl(ready: boolean, hasPaper: boolean, dispatch: Dispatch, onUnfinished: (paper: PaperInfo) => void): string {
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    const id = paperIdFromPath();
    if (!ready || hasPaper || !id || started.current) return;
    started.current = true;
    (async () => {
      try {
        const saved = await loadSession({ id });
        if (!saved) throw new Error("That paper isn’t available. Sign in with the account that saved it, or upload it again below.");
        const row = saved.paper;
        // The server recovers older papers' PDFs on first open; uploads it can't recover answer 409.
        const pdf = await fetch(`/api/play/papers/${row.id}/pdf`);
        const pdfUrl = pdf.ok ? URL.createObjectURL(await pdf.blob()) : "";
        const paper: PaperInfo = {
          paperId: row.id,
          key: row.paper_key,
          arxivId: row.arxiv_id ?? undefined,
          name: row.name ?? row.title ?? "Saved paper",
          pdfUrl,
          isPublic: row.is_public,
        };
        dispatch({ type: "paper", paper });
        dispatch({ type: "hydrate", walkthrough: row.walkthrough ?? undefined, nodes: saved.nodes });
        const planned = row.walkthrough_plan?.scenes.length ?? 0;
        const drawn = row.walkthrough?.scenes.length ?? 0;
        // Scenes still to draw: the page finishes them (no new charge). Their own paper with no walkthrough yet
        // (refused for quota, then they picked a plan): start it; the server decides whether it counts.
        if (paper.paperId && (planned > drawn || (!row.walkthrough && !row.is_public))) onUnfinished(paper);
        else if (!row.walkthrough) dispatch({ type: "walk", walk: "done" });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        try {
          window.history.replaceState(window.history.state, "", "/play");
        } catch {
          /* ignore */
        }
      }
    })();
  }, [ready, hasPaper, dispatch, onUnfinished]);

  return error;
}
