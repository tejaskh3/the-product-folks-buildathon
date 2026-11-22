"use client";

// The little menu over selected text: highlight in a color, add a note, or ask Curio about it.
// Text belongs to a place via the nearest [data-place-kind][data-place-target] ancestor (a
// scene, an answer, or a PDF page); selections that span two places, or none, get no menu.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HIGHLIGHT_COLORS, type HighlightColor, type PlaceKind } from "@/lib/readingNotes";

export interface Picked {
  kind: PlaceKind;
  target: string;
  quote: string;
}

const MAX_QUOTE = 1000;

export const SWATCH: Record<HighlightColor, string> = {
  yellow: "bg-[rgb(250_204_21)]",
  green: "bg-[rgb(74_222_128)]",
  blue: "bg-[rgb(96_165_250)]",
  pink: "bg-[rgb(244_114_182)]",
};

function placeOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-place-kind][data-place-target]") ?? null;
}

export function SelectionMenu({
  onHighlight,
  onAsk,
}: {
  onHighlight: (p: Picked, color: HighlightColor, note?: string) => void;
  onAsk: (p: Picked) => void;
}) {
  const [picked, setPicked] = useState<(Picked & { x: number; top: number; bottom: number }) | null>(null);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return setPicked(null);
    if (menuRef.current?.contains(sel.anchorNode)) return;
    const a = placeOf(sel.anchorNode);
    if (!a || a !== placeOf(sel.focusNode)) return setPicked(null);
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote || quote.length > MAX_QUOTE) return setPicked(null);
    const box = sel.getRangeAt(0).getBoundingClientRect();
    setPicked({
      kind: a.dataset.placeKind as PlaceKind,
      target: a.dataset.placeTarget!,
      quote,
      x: box.left + box.width / 2,
      top: box.top,
      bottom: box.bottom,
    });
    setNoting(false);
    setNote("");
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    // selectionchange fires while dragging; wait until it settles.
    const onChange = () => {
      if (t) clearTimeout(t);
      t = setTimeout(read, 250);
    };
    const hide = () => setPicked(null);
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [read]);

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  // Keep the whole menu on screen, measured after it renders (its width depends on what it shows).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !picked) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.min(Math.max(8, picked.x - w / 2), window.innerWidth - w - 8)}px`;
  }, [picked, noting]);

  if (!picked || typeof document === "undefined") return null;

  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  // Above the selection; below it near the top of the screen (and on touch, where the OS menu sits above).
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const below = touch || picked.top < 72;

  return createPortal(
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selected text"
      // Keep the selection while pressing buttons in here.
      onMouseDown={(e) => (e.target as HTMLElement).tagName !== "TEXTAREA" && e.preventDefault()}
      style={{ left: 8, top: below ? picked.bottom + 10 : picked.top - 10, transform: below ? undefined : "translateY(-100%)" }}
      className="fixed z-[70] w-max max-w-[calc(100vw-16px)] rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_-12px_rgb(26_25_23/0.35)]"
    >
      {noting ? (
        <form
          className="flex w-[264px] flex-col gap-2 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            onHighlight(picked, "yellow", note.trim());
            done();
          }}
        >
          <label htmlFor="sel-note" className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
            Note
          </label>
          <textarea
            id="sel-note"
            autoFocus
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg bg-paper-2 px-2.5 py-2 text-sm text-ink outline-none focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNoting(false)} className="rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink">
              Back
            </button>
            <button type="submit" className="btn-primary h-8 px-3 text-sm">
              Save note
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Highlight ${c}`}
              onClick={() => {
                onHighlight(picked, c);
                done();
              }}
              className="grid size-8 place-items-center rounded-lg hover:bg-paper-2"
            >
              <span aria-hidden="true" className={`size-4 rounded-full ${SWATCH[c]}`} />
            </button>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
          <button type="button" onClick={() => setNoting(true)} className="h-8 rounded-lg px-2.5 text-sm text-ink hover:bg-paper-2">
            Note
          </button>
          <button
            type="button"
            onClick={() => {
              onAsk(picked);
              done();
            }}
            className="h-8 rounded-lg px-2.5 text-sm text-accent-hover hover:bg-paper-2"
          >
            Ask Curio
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
