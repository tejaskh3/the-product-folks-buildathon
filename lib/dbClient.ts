// Browser-side helpers for the saved-papers API (/api/play/papers). The session cookie identifies the user.
import type { ExploreNode, Walkthrough } from "@/lib/walkthrough";

export interface SavedPaperSummary {
  id: string;
  paper_key: string;
  name: string | null;
  title: string | null;
  authors: string | null;
  year: number | null;
  arxiv_id: string | null;
  updated_at: string;
}

export interface SavedPaper extends SavedPaperSummary {
  file_id: string | null;
  pdf_sha256: string | null;
  is_public: boolean;
  walkthrough: Walkthrough | null;
  /** All planned scenes; more than walkthrough.scenes means some are still to draw. */
  walkthrough_plan: { scenes: { id: string }[] } | null;
}

export interface SavedSession {
  paper: SavedPaper;
  nodes: ExploreNode[];
}

async function ok(res: Response) {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res;
}

/** A saved session by row id, or by paper key. Resolves null when nothing is saved. */
export async function loadSession(by: { id: string } | { key: string }): Promise<SavedSession | null> {
  const url = "id" in by ? `/api/play/papers/${by.id}` : `/api/play/papers?key=${encodeURIComponent(by.key)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  await ok(res);
  return (await res.json()) as SavedSession;
}
