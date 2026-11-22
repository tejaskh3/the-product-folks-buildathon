"use client";

// The reader's private layer on the open paper: favorite, notes, bookmarks, highlights.
// Changes show at once and save in the background; a failed save puts things back and says so.
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/readingClient";
import type { Highlight, HighlightColor, PlaceKind, Reading } from "@/lib/readingNotes";

const EMPTY: Reading = { favorite: false, notes: "", bookmarks: [], highlights: [] };
const NOTES_SAVE_MS = 800;

export type NotesStatus = "idle" | "saving" | "saved" | "error";

export function useReading(paperId: string | null | undefined, signedIn: boolean) {
  const id = signedIn && paperId ? paperId : null;
  // State belongs to one paper; opening another starts from empty without a reset effect.
  const [state, setState] = useState<{ id: string | null; reading: Reading; loaded: boolean }>({ id: null, reading: EMPTY, loaded: false });
  const mine = state.id === id;
  const reading = mine ? state.reading : EMPTY;
  const loaded = mine && state.loaded;
  const setReading = useCallback(
    (next: Reading | ((r: Reading) => Reading)) =>
      setState((st) => {
        const base = st.id === id ? st.reading : EMPTY;
        return { id, loaded: st.id === id && st.loaded, reading: typeof next === "function" ? next(base) : next };
      }),
    [id],
  );
  const [error, setError] = useState("");
  const [notesStatus, setNotesStatus] = useState<NotesStatus>("idle");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .getReading(id)
      .then((r) => live && setState({ id, reading: r, loaded: true }))
      .catch(() => live && setState({ id, reading: EMPTY, loaded: true }));
    api.patchReading(id, { opened: true }).catch(() => {}); // History
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => () => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
  }, []);

  /** Optimistic: apply now, undo if the save fails. */
  const attempt = useCallback(async (apply: (r: Reading) => Reading, save: () => Promise<unknown>, what: string) => {
    let before: Reading = EMPTY;
    setReading((r) => ((before = r), apply(r)));
    setError("");
    try {
      await save();
    } catch (err) {
      setReading(before);
      setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setReading]);

  const toggleFavorite = useCallback(() => {
    if (!id) return;
    const next = !reading.favorite;
    void attempt((r) => ({ ...r, favorite: next }), () => api.patchReading(id, { favorite: next }), "Couldn’t save the favorite");
  }, [attempt, id, reading.favorite]);

  const setNotes = useCallback(
    (notes: string) => {
      if (!id) return;
      setReading((r) => ({ ...r, notes }));
      setNotesStatus("saving");
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => {
        api
          .patchReading(id, { notes })
          .then(() => setNotesStatus("saved"))
          .catch(() => setNotesStatus("error"));
      }, NOTES_SAVE_MS);
    },
    [id, setReading],
  );

  const bookmarkFor = useCallback((kind: PlaceKind, target: string) => reading.bookmarks.find((b) => b.kind === kind && b.target === target) ?? null, [reading.bookmarks]);

  const toggleBookmark = useCallback(
    async (kind: PlaceKind, target: string, label: string) => {
      if (!id) return;
      const existing = reading.bookmarks.find((b) => b.kind === kind && b.target === target);
      if (existing) {
        await attempt((r) => ({ ...r, bookmarks: r.bookmarks.filter((b) => b.id !== existing.id) }), () => api.removeBookmark(id, existing.id), "Couldn’t remove the bookmark");
        return;
      }
      setError("");
      try {
        const b = await api.addBookmark(id, { kind, target, label });
        setReading((r) => ({ ...r, bookmarks: [...r.bookmarks.filter((x) => x.id !== b.id), b] }));
      } catch (err) {
        setError(`Couldn’t save the bookmark: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [attempt, id, reading.bookmarks, setReading],
  );

  const addHighlight = useCallback(
    async (h: { kind: PlaceKind; target: string; quote: string; color: HighlightColor; note?: string }): Promise<Highlight | null> => {
      if (!id) return null;
      setError("");
      try {
        const saved = await api.addHighlight(id, h);
        setReading((r) => ({ ...r, highlights: [...r.highlights, saved] }));
        return saved;
      } catch (err) {
        setError(`Couldn’t save the highlight: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    [id, setReading],
  );

  const updateHighlight = useCallback(
    (hid: string, patch: { color?: HighlightColor; note?: string }) => {
      if (!id) return;
      void attempt(
        (r) => ({ ...r, highlights: r.highlights.map((h) => (h.id === hid ? { ...h, ...patch } : h)) }),
        () => api.updateHighlight(id, hid, patch),
        "Couldn’t update the highlight",
      );
    },
    [attempt, id],
  );

  const removeHighlight = useCallback(
    (hid: string) => {
      if (!id) return;
      void attempt((r) => ({ ...r, highlights: r.highlights.filter((h) => h.id !== hid) }), () => api.removeHighlight(id, hid), "Couldn’t remove the highlight");
    },
    [attempt, id],
  );

  return {
    enabled: !!id,
    loaded,
    reading,
    error,
    clearError: () => setError(""),
    notesStatus,
    toggleFavorite,
    setNotes,
    bookmarkFor,
    toggleBookmark,
    addHighlight,
    updateHighlight,
    removeHighlight,
  };
}

export type ReadingApi = ReturnType<typeof useReading>;
