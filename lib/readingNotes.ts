// A reader's private layer on a paper, as both server and browser see it, plus the Markdown
// export of their notes. No server imports here: the notes panel builds the export itself.

export type PlaceKind = "scene" | "node" | "page";
export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

export interface Bookmark {
  id: string;
  kind: PlaceKind;
  target: string;
  label: string;
  created_at: string;
}

export interface Highlight {
  id: string;
  kind: PlaceKind;
  target: string;
  quote: string;
  color: HighlightColor;
  note: string;
  created_at: string;
}

export interface Reading {
  favorite: boolean;
  notes: string;
  bookmarks: Bookmark[];
  highlights: Highlight[];
}

/** "#at=scene:s3" style fragments: a bookmark's link opens the paper at that place. */
export function placeHash(kind: PlaceKind, target: string): string {
  return `#at=${kind}:${encodeURIComponent(target)}`;
}

export function parsePlaceHash(hash: string): { kind: PlaceKind; target: string } | null {
  const m = hash.match(/^#at=(scene|node|page):(.+)$/);
  if (!m) return null;
  try {
    return { kind: m[1] as PlaceKind, target: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/**
 * The reader's notes on one paper as Markdown: their own notes, then highlights grouped by
 * where they are (in walkthrough order), then bookmarks. `placeName` turns a place into words
 * ("Scene 2: Attention", "Page 4").
 */
export function notesMarkdown(opts: {
  title: string;
  authors?: string | null;
  year?: number | null;
  url?: string;
  reading: Reading;
  placeName: (kind: PlaceKind, target: string) => string;
  /** Sort key for a place, so highlights follow the walkthrough; unknown places go last. */
  placeOrder?: (kind: PlaceKind, target: string) => number;
}): string {
  const { reading, placeName } = opts;
  const order = opts.placeOrder ?? (() => 0);
  const byline = [opts.authors, opts.year].filter(Boolean).join(", ");
  const out: string[] = [`# ${opts.title}`];
  if (byline) out.push("", `_${byline}_`);
  if (opts.url) out.push("", opts.url);

  if (reading.notes.trim()) out.push("", "## Notes", "", reading.notes.trim());

  if (reading.highlights.length) {
    out.push("", "## Highlights");
    const groups = new Map<string, Highlight[]>();
    for (const h of reading.highlights) {
      const key = `${h.kind}\u0000${h.target}`;
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    const sorted = [...groups.values()].sort((a, b) => order(a[0].kind, a[0].target) - order(b[0].kind, b[0].target));
    for (const hs of sorted) {
      out.push("", `### ${placeName(hs[0].kind, hs[0].target)}`);
      for (const h of hs) {
        out.push("", ...h.quote.split("\n").map((l) => `> ${l}`));
        if (h.note.trim()) out.push("", h.note.trim());
      }
    }
  }

  if (reading.bookmarks.length) {
    out.push("", "## Bookmarks", "");
    for (const b of [...reading.bookmarks].sort((x, y) => order(x.kind, x.target) - order(y.kind, y.target)))
      out.push(`- ${placeName(b.kind, b.target)}${b.label && b.label !== placeName(b.kind, b.target) ? ` — ${b.label}` : ""}`);
  }
  return out.join("\n") + "\n";
}
