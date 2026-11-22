"use client";

// The reader's notes on this paper: their own text (saved as they type), every highlight with
// its note, and their bookmarks. Each one jumps back to its place. Exports to Markdown.
import { useEffect, useRef } from "react";
import { notesMarkdown, type PlaceKind } from "@/lib/readingNotes";
import type { ReadingApi } from "./useReading";
import { SWATCH } from "./SelectionMenu";
import { HIGHLIGHT_COLORS } from "@/lib/readingNotes";

export function NotesPanel({
  reading: r,
  title,
  authors,
  year,
  placeName,
  placeOrder,
  onGo,
  onClose,
}: {
  reading: ReadingApi;
  title: string;
  authors?: string | null;
  year?: number | null;
  placeName: (kind: PlaceKind, target: string) => string;
  placeOrder: (kind: PlaceKind, target: string) => number;
  onGo: (kind: PlaceKind, target: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { reading } = r;
  const highlights = [...reading.highlights].sort((a, b) => placeOrder(a.kind, a.target) - placeOrder(b.kind, b.target));
  const bookmarks = [...reading.bookmarks].sort((a, b) => placeOrder(a.kind, a.target) - placeOrder(b.kind, b.target));

  function exportMarkdown() {
    const md = notesMarkdown({ title, authors, year, url: window.location.origin + window.location.pathname, reading, placeName, placeOrder });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${(title || "paper").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "paper"}-notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const status = { idle: "", saving: "Saving…", saved: "Saved", error: "Couldn’t save. Keep this tab open and try again." }[r.notesStatus];
  const go = (kind: PlaceKind, target: string) => {
    onGo(kind, target);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="notes-title">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id="notes-title" className="font-serif text-xl text-ink">
            Your notes
          </h2>
          <button type="button" onClick={exportMarkdown} className="btn-secondary ml-auto h-8 px-3 text-sm">
            Export .md
          </button>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink">
            Close
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          <button
            type="button"
            onClick={r.toggleFavorite}
            aria-pressed={reading.favorite}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${reading.favorite ? "border-accent text-ink" : "border-line text-ink-2 hover:text-ink"}`}
          >
            <svg viewBox="0 0 16 16" className={`size-4 ${reading.favorite ? "text-accent" : ""}`} aria-hidden="true">
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill={reading.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
            </svg>
            {reading.favorite ? "In your favorites" : "Add to favorites"}
          </button>
          <section>
            <div className="flex items-baseline justify-between">
              <label htmlFor="paper-notes" className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
                Notes
              </label>
              <span aria-live="polite" className={`text-xs ${r.notesStatus === "error" ? "text-accent-hover" : "text-ink-3"}`}>
                {status}
              </span>
            </div>
            <textarea
              id="paper-notes"
              value={reading.notes}
              maxLength={20000}
              onChange={(e) => r.setNotes(e.target.value)}
              rows={7}
              placeholder="What you want to remember about this paper. Only you can see this."
              className="mt-2 w-full resize-y rounded-xl bg-paper-2 px-3 py-2.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]"
            />
          </section>

          <section aria-labelledby="hl-title">
            <h3 id="hl-title" className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
              Highlights{highlights.length ? ` · ${highlights.length}` : ""}
            </h3>
            {highlights.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Select any text in a scene or in the paper to highlight it.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {highlights.map((h) => (
                  <li key={h.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => go(h.kind, h.target)} className="min-w-0 truncate text-left text-xs text-ink-3 hover:text-ink">
                        {placeName(h.kind, h.target)} →
                      </button>
                      <div className="ml-auto flex shrink-0 items-center">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Make it ${c}`}
                            aria-pressed={h.color === c}
                            onClick={() => r.updateHighlight(h.id, { color: c })}
                            className="grid size-6 place-items-center rounded-md hover:bg-paper-2"
                          >
                            <span aria-hidden="true" className={`size-3 rounded-full ${SWATCH[c]} ${h.color === c ? "ring-2 ring-ink ring-offset-1" : ""}`} />
                          </button>
                        ))}
                        <button type="button" onClick={() => r.removeHighlight(h.id)} className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink">
                          Remove
                        </button>
                      </div>
                    </div>
                    <blockquote className={`mt-2 border-l-[3px] pl-3 font-serif text-[15px] leading-relaxed text-ink-2 ${BORDER[h.color]}`}>“{h.quote}”</blockquote>
                    <textarea
                      aria-label="Note on this highlight"
                      defaultValue={h.note}
                      maxLength={2000}
                      rows={h.note ? 2 : 1}
                      placeholder="Add a note"
                      onBlur={(e) => e.target.value !== h.note && r.updateHighlight(h.id, { note: e.target.value })}
                      className="mt-2 w-full resize-y rounded-lg bg-paper-2 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="bm-title">
            <h3 id="bm-title" className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
              Bookmarks{bookmarks.length ? ` · ${bookmarks.length}` : ""}
            </h3>
            {bookmarks.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Bookmark a scene, an answer or a page of the paper to find it again.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {bookmarks.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 px-3 py-2.5">
                    <button type="button" onClick={() => go(b.kind, b.target)} className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:text-accent-hover">
                      {placeName(b.kind, b.target)}
                    </button>
                    <button type="button" onClick={() => void r.toggleBookmark(b.kind, b.target, b.label)} className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const BORDER = { yellow: "border-[rgb(250_204_21)]", green: "border-[rgb(74_222_128)]", blue: "border-[rgb(96_165_250)]", pink: "border-[rgb(244_114_182)]" } as const;

/** A small bookmark toggle, used on scenes, answers and PDF pages. */
export function BookmarkButton({ on, onToggle, what }: { on: boolean; onToggle: () => void; what: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove bookmark from this ${what}` : `Bookmark this ${what}`}
      title={on ? "Bookmarked" : "Bookmark"}
      onClick={onToggle}
      className={`grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-paper-2 ${on ? "text-accent" : "text-ink-3 hover:text-ink"}`}
    >
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        <path d="M4 2.5h8v11l-4-2.6-4 2.6z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </button>
  );
}
