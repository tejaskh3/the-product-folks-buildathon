"use client";

// Paints saved highlights over rendered text with the CSS Custom Highlight API: no markup
// changes, so it works the same on scene text and inside the PDF's text layer. Browsers
// without it (older Safari/Firefox) just don't paint; highlights still list in Notes.
//
// Matching ignores whitespace, because a selection's text and the DOM's text differ in line
// breaks and spaces (PDF text layers especially).
import { useEffect } from "react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/readingNotes";

type Mark = { quote: string; color: HighlightColor };

/** Ranges in `root` for each quote. Exported for tests. */
export function rangesFor(root: Node, marks: Mark[]): Map<HighlightColor, Range[]> {
  const out = new Map<HighlightColor, Range[]>();
  if (!marks.length) return out;
  // Every non-space character in reading order, with where it lives.
  const chars: string[] = [];
  const at: [Text, number][] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest("script,style,[data-no-highlight]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const s = n.data;
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) continue;
      chars.push(s[i]);
      at.push([n, i]);
    }
  }
  const hay = chars.join("");
  for (const m of marks) {
    const needle = m.quote.replace(/\s+/g, "");
    if (!needle) continue;
    const i = hay.indexOf(needle);
    if (i < 0) continue;
    const [sn, so] = at[i];
    const [en, eo] = at[i + needle.length - 1];
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    out.set(m.color, [...(out.get(m.color) ?? []), r]);
  }
  return out;
}

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** Each painter owns its ranges; the page's highlight per color is the union of all painters. */
const painters = new Map<symbol, Map<HighlightColor, Range[]>>();
function repaint() {
  for (const color of HIGHLIGHT_COLORS) {
    const ranges = [...painters.values()].flatMap((m) => m.get(color) ?? []);
    if (ranges.length) CSS.highlights.set(`curio-${color}`, new Highlight(...ranges));
    else CSS.highlights.delete(`curio-${color}`);
  }
}

/** Paints `marks` inside `root` while mounted. `version` repaints when the text underneath changes. */
export function usePaintHighlights(root: HTMLElement | null, marks: Mark[], version: unknown = 0) {
  const key = JSON.stringify(marks);
  useEffect(() => {
    if (!root || !supported()) return;
    const id = Symbol("painter");
    const paint = () => {
      painters.set(id, rangesFor(root, JSON.parse(key) as Mark[]));
      repaint();
    };
    paint();
    // Text arrives late (PDF text layers, diagrams settling): repaint on changes, batched.
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        paint();
      });
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      painters.delete(id);
      repaint();
    };
  }, [root, key, version]);
}
