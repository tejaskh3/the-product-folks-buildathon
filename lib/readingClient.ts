// Browser helpers for a reader's private layer (/api/play/papers/:id/reading, bookmarks,
// highlights) and the shelf (/api/play/shelf). The session cookie identifies the reader.
import type { Bookmark, Highlight, HighlightColor, PlaceKind, Reading } from "./readingNotes";

export interface ShelfPaper {
  id: string;
  title: string | null;
  name: string | null;
  authors: string | null;
  year: number | null;
  at: string | null;
}

export interface Shelf {
  library: { id: string; title: string | null; authors: string | null; year: number | null; blurb: string | null; scenes: number }[];
  mine: ShelfPaper[];
  favorites: ShelfPaper[];
  bookmarks: (Bookmark & { paper: { id: string; title: string | null; name: string | null } })[];
  history: ShelfPaper[];
}

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

const base = (paperId: string) => `/api/play/papers/${paperId}`;

export const getReading = (paperId: string) => call<Reading>(`${base(paperId)}/reading`);
export const patchReading = (paperId: string, body: { favorite?: boolean; notes?: string; opened?: boolean }) =>
  call<null>(`${base(paperId)}/reading`, { method: "PATCH", json: body });

export const addBookmark = (paperId: string, b: { kind: PlaceKind; target: string; label: string }) =>
  call<Bookmark>(`${base(paperId)}/bookmarks`, { method: "POST", json: b });
export const removeBookmark = (paperId: string, id: string) => call<null>(`${base(paperId)}/bookmarks?id=${id}`, { method: "DELETE" });

export const addHighlight = (paperId: string, h: { kind: PlaceKind; target: string; quote: string; color: HighlightColor; note?: string }) =>
  call<Highlight>(`${base(paperId)}/highlights`, { method: "POST", json: h });
export const updateHighlight = (paperId: string, id: string, patch: { color?: HighlightColor; note?: string }) =>
  call<Highlight>(`${base(paperId)}/highlights?id=${id}`, { method: "PATCH", json: patch });
export const removeHighlight = (paperId: string, id: string) => call<null>(`${base(paperId)}/highlights?id=${id}`, { method: "DELETE" });

export const getShelf = () => call<Shelf>("/api/play/shelf");
