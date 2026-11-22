// Pure text-matching helpers for highlighting a quote inside a PDF page's text
// layer. No DOM access here, so this runs in Node too (see
// scripts/test-highlight.ts).
//
// react-pdf hands us a page as a list of text items. A sentence is usually
// split across many items: line breaks, font changes, and math such as "dk"
// arriving as "d" + "k" (a subscript). We match against a normalized version
// of the joined text while keeping a map back to (itemIndex, charOffset) in
// the ORIGINAL item strings, so the ranges we return line up with what the
// text layer renders.

export type Range = [start: number, end: number];
export type ItemRanges = Map<number, Range[]>;

const QUOTES: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "«": '"', "»": '"',
};
const DASHES = /[‐‑‒–—―−﹘﹣－]/g;
const SOFT_HYPHEN = /­/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Normalize one code point. May return "" (dropped) or several chars (ligatures). */
function normChar(ch: string): string {
  if (ch === "­") return "";
  if (/\s/.test(ch)) return " ";
  let out = ch.normalize("NFKC").toLowerCase();
  out = out.replace(DASHES, "-");
  if (QUOTES[out]) out = QUOTES[out];
  // NFKC can turn some chars into whitespace (e.g. no-break space variants).
  return out.replace(/\s+/g, " ");
}

/**
 * Lowercase, NFKC (ligatures like "ﬁ" become "fi"), unified quotes and dashes,
 * no soft hyphens or "-\n" line-break hyphenation, single spaces, trimmed.
 */
export function normalize(s: string): string {
  const pre = s.replace(SOFT_HYPHEN, "").replace(/([\p{L}])[-‐­]\s*\n\s*(?=[\p{L}])/gu, "$1");
  let out = "";
  for (const ch of pre) out += normChar(ch);
  return out.replace(/\s+/g, " ").trim();
}

/** Letters and digits only: robust to split subscripts, hyphenation and punctuation. */
function compact(s: string): string {
  let out = "";
  for (const ch of s) if (WORD_CHAR.test(ch)) out += ch;
  return out;
}

type Pos = { item: number; start: number; end: number };
type Stream = { text: string; pos: Pos[] };

/**
 * Build the spaced and compact normalized streams for a page. Each char of
 * each stream remembers where it came from in the original item strings.
 */
function buildStreams(items: string[]): { spaced: Stream; compact: Stream } {
  const spacedChars: string[] = [];
  const spacedPos: Pos[] = [];
  const compactChars: string[] = [];
  const compactPos: Pos[] = [];

  const push = (c: string, p: Pos) => {
    if (c === " ") {
      if (spacedChars.length === 0 || spacedChars[spacedChars.length - 1] === " ") return;
    }
    spacedChars.push(c);
    spacedPos.push(p);
    if (WORD_CHAR.test(c)) {
      compactChars.push(c);
      compactPos.push(p);
    }
  };

  items.forEach((str, item) => {
    if (item > 0) {
      const prev = items[item - 1];
      if (prev.length > 0 && !/\s$/.test(prev)) push(" ", { item: item - 1, start: prev.length, end: prev.length });
    }
    let offset = 0;
    for (const ch of str) {
      const p: Pos = { item, start: offset, end: offset + ch.length };
      for (const c of normChar(ch)) push(c, p);
      offset += ch.length;
    }
  });

  return {
    spaced: { text: spacedChars.join(""), pos: spacedPos },
    compact: { text: compactChars.join(""), pos: compactPos },
  };
}

/**
 * Turn a match [s, e) in a stream into per-item ranges in ORIGINAL item
 * string coordinates. Items fully spanned by the match are covered entirely.
 */
function toItemRanges(items: string[], stream: Stream, s: number, e: number): ItemRanges {
  const first = stream.pos[s];
  const last = stream.pos[e - 1];
  const out: ItemRanges = new Map();
  for (let i = first.item; i <= last.item; i++) {
    const len = items[i].length;
    const start = i === first.item ? first.start : 0;
    const end = i === last.item ? last.end : len;
    if (end > start) out.set(i, [[start, end]]);
  }
  return out;
}

/**
 * Find `quote` on a page given its text items. Strategy, first hit wins:
 * 1. exact normalized match
 * 2. whitespace/punctuation-insensitive match of the whole quote
 * 3. the first 8 words of the quote
 * 4. the longest run of >= 5 consecutive quote words present on the page
 * Returns char ranges per item index (empty map when nothing is found).
 */
export function findQuoteRanges(items: string[], quote: string): ItemRanges {
  const q = normalize(quote);
  if (!q || items.length === 0) return new Map();
  const { spaced, compact: flat } = buildStreams(items);

  // 1. Exact normalized match.
  const exact = spaced.text.indexOf(q);
  if (exact >= 0) return toItemRanges(items, spaced, exact, exact + q.length);

  const findCompact = (needle: string): ItemRanges | null => {
    if (needle.length < 12) return null; // too short to trust
    const at = flat.text.indexOf(needle);
    return at >= 0 ? toItemRanges(items, flat, at, at + needle.length) : null;
  };

  // 2. Whole quote, ignoring spaces and punctuation (handles "d" + "k" subscripts).
  const whole = findCompact(compact(q));
  if (whole) return whole;

  const words = q.split(" ").map(compact).filter(Boolean);

  // 3. First 8 words.
  if (words.length > 8) {
    const head = findCompact(words.slice(0, 8).join(""));
    if (head) return head;
  }

  // 4. Longest run of >= 5 consecutive words.
  const MIN = 5;
  let best: { at: number; len: number } | null = null;
  for (let i = 0; i + MIN <= words.length; i++) {
    let j = i + MIN;
    let needle = words.slice(i, j).join("");
    let at = flat.text.indexOf(needle);
    if (at < 0) continue;
    while (j < words.length) {
      const next = needle + words[j];
      const nextAt = flat.text.indexOf(next);
      if (nextAt < 0) break;
      needle = next;
      at = nextAt;
      j++;
    }
    if (needle.length >= 12 && (!best || needle.length > best.len)) best = { at, len: needle.length };
    if (j === words.length) break; // cannot do better from later starts
  }
  if (best) return toItemRanges(items, flat, best.at, best.at + best.len);

  return new Map();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML for one text item with `ranges` wrapped in <mark class="curio-hl">.
 * Everything is escaped.
 */
export function highlightItem(str: string, ranges: Range[] | undefined): string {
  if (!ranges || ranges.length === 0) return escapeHtml(str);
  const sorted = [...ranges]
    .map(([a, b]): Range => [Math.max(0, Math.min(a, str.length)), Math.max(0, Math.min(b, str.length))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let out = "";
  let cursor = 0;
  for (const [a, b] of sorted) {
    const start = Math.max(a, cursor);
    if (b <= start) continue;
    out += escapeHtml(str.slice(cursor, start));
    out += `<mark class="curio-hl">${escapeHtml(str.slice(start, b))}</mark>`;
    cursor = b;
  }
  return out + escapeHtml(str.slice(cursor));
}
