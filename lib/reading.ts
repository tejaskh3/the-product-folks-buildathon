// Server-only: a reader's private layer on a paper — favorite, notes, history, bookmarks and
// highlights. Every call takes the reader's Clerk id and a paper they may read (their own or
// a library paper); routes check that with readablePaper first.
import { currentUser } from "./auth";
import { db, readablePaper } from "./db";
import { json } from "./playServer";
import { listLibrary, type LibraryPaper } from "./libraryList";
import { HIGHLIGHT_COLORS, type Bookmark, type Highlight, type HighlightColor, type PlaceKind, type Reading } from "./readingNotes";

export type { Bookmark, Highlight, HighlightColor, PlaceKind, Reading };

const KINDS: PlaceKind[] = ["scene", "node", "page"];

/** Bad input from the browser: the route answers 400 with this message. */
export class ReadingInputError extends Error {}

const text = (v: unknown, max: number, what: string, min = 0): string => {
  if (typeof v !== "string") throw new ReadingInputError(`Missing ${what}.`);
  const s = v.trim();
  if (s.length < min) throw new ReadingInputError(`Missing ${what}.`);
  if (s.length > max) throw new ReadingInputError(`That ${what} is too long.`);
  return s;
};

function place(body: { kind?: unknown; target?: unknown }): { kind: PlaceKind; target: string } {
  if (!KINDS.includes(body.kind as PlaceKind)) throw new ReadingInputError("Unknown place.");
  const target = text(typeof body.target === "number" ? String(body.target) : body.target, 200, "place", 1);
  if (body.kind === "page" && !/^\d{1,5}$/.test(target)) throw new ReadingInputError("Unknown page.");
  return { kind: body.kind as PlaceKind, target };
}

function color(v: unknown): HighlightColor {
  if (v === undefined) return "yellow";
  if (!HIGHLIGHT_COLORS.includes(v as HighlightColor)) throw new ReadingInputError("Unknown color.");
  return v as HighlightColor;
}

const must = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};

export async function readingFor(owner: string, paperId: string): Promise<Reading> {
  const [state, bookmarks, highlights] = await Promise.all([
    db().from("reader_papers").select("favorite, notes").eq("owner", owner).eq("paper_id", paperId).maybeSingle(),
    db().from("bookmarks").select("id, kind, target, label, created_at").eq("owner", owner).eq("paper_id", paperId).order("created_at"),
    db().from("highlights").select("id, kind, target, quote, color, note, created_at").eq("owner", owner).eq("paper_id", paperId).order("created_at"),
  ]);
  const s = must(state) as { favorite: boolean; notes: string } | null;
  return {
    favorite: s?.favorite ?? false,
    notes: s?.notes ?? "",
    bookmarks: must(bookmarks) as Bookmark[],
    highlights: must(highlights) as Highlight[],
  };
}

/** Favorite on/off, notes text, or "just opened it" (for History). Only the given fields change. */
export async function updatePaperState(owner: string, paperId: string, body: { favorite?: unknown; notes?: unknown; opened?: unknown }) {
  const row: Record<string, unknown> = { owner, paper_id: paperId, updated_at: new Date().toISOString() };
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== "boolean") throw new ReadingInputError("Favorite is on or off.");
    row.favorite = body.favorite;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") throw new ReadingInputError("Missing notes.");
    if (body.notes.length > 20000) throw new ReadingInputError("Your notes are too long (20,000 characters at most).");
    row.notes = body.notes;
  }
  if (body.opened === true) row.last_opened_at = new Date().toISOString();
  if (Object.keys(row).length === 3) throw new ReadingInputError("Nothing to change.");
  must(await db().from("reader_papers").upsert(row, { onConflict: "owner,paper_id" }));
}

export async function addBookmark(owner: string, paperId: string, body: { kind?: unknown; target?: unknown; label?: unknown }): Promise<Bookmark> {
  const p = place(body);
  const label = body.label === undefined ? "" : text(body.label, 300, "label");
  const data = must(
    await db()
      .from("bookmarks")
      .upsert({ owner, paper_id: paperId, ...p, label }, { onConflict: "owner,paper_id,kind,target" })
      .select("id, kind, target, label, created_at")
      .single(),
  );
  return data as Bookmark;
}

export async function removeBookmark(owner: string, paperId: string, id: string) {
  must(await db().from("bookmarks").delete().eq("owner", owner).eq("paper_id", paperId).eq("id", id));
}

export async function addHighlight(
  owner: string,
  paperId: string,
  body: { kind?: unknown; target?: unknown; quote?: unknown; color?: unknown; note?: unknown },
): Promise<Highlight> {
  const row = {
    owner,
    paper_id: paperId,
    ...place(body),
    quote: text(body.quote, 1000, "passage", 1),
    color: color(body.color),
    note: body.note === undefined ? "" : text(body.note, 2000, "note"),
  };
  const data = must(await db().from("highlights").insert(row).select("id, kind, target, quote, color, note, created_at").single());
  return data as Highlight;
}

export async function updateHighlight(owner: string, paperId: string, id: string, body: { color?: unknown; note?: unknown }): Promise<Highlight> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.color !== undefined) patch.color = color(body.color);
  if (body.note !== undefined) patch.note = text(body.note, 2000, "note");
  const data = must(
    await db()
      .from("highlights")
      .update(patch)
      .eq("owner", owner)
      .eq("paper_id", paperId)
      .eq("id", id)
      .select("id, kind, target, quote, color, note, created_at")
      .maybeSingle(),
  );
  if (!data) throw new ReadingInputError("That highlight is gone.");
  return data as Highlight;
}

export async function removeHighlight(owner: string, paperId: string, id: string) {
  must(await db().from("highlights").delete().eq("owner", owner).eq("paper_id", paperId).eq("id", id));
}

// ---- The shelf: everything across papers, for the tabs on /play ----------------------------

export interface ShelfPaper {
  id: string;
  title: string | null;
  name: string | null;
  authors: string | null;
  year: number | null;
  /** When they last opened it (History), or when it was saved (My papers). */
  at: string | null;
}

export interface ShelfBookmark extends Bookmark {
  paper: { id: string; title: string | null; name: string | null };
}

export interface Shelf {
  library: LibraryPaper[];
  mine: ShelfPaper[];
  favorites: ShelfPaper[];
  bookmarks: ShelfBookmark[];
  history: ShelfPaper[];
}

const PAPER_COLS = "id, title, name, authors, year";
type PaperCols = Omit<ShelfPaper, "at">;

/** Rows joined to papers this reader may still read (their own, or public). */
const readable = (owner: string) => (p: { owner?: string | null; is_public?: boolean } | null) => !!p && (p.owner === owner || p.is_public === true);

export async function shelf(owner: string): Promise<Shelf> {
  const join = `papers!inner(${PAPER_COLS}, owner, is_public)`;
  const [library, mine, favorites, history, bookmarks] = await Promise.all([
    listLibrary().catch(() => []), // the shelf still loads if the library can't
    db().from("papers").select(`${PAPER_COLS}, updated_at`).eq("owner", owner).order("updated_at", { ascending: false }).limit(50),
    db().from("reader_papers").select(`updated_at, ${join}`).eq("owner", owner).eq("favorite", true).order("updated_at", { ascending: false }).limit(50),
    db().from("reader_papers").select(`last_opened_at, ${join}`).eq("owner", owner).not("last_opened_at", "is", null).order("last_opened_at", { ascending: false }).limit(30),
    db().from("bookmarks").select(`id, kind, target, label, created_at, papers!inner(id, title, name, owner, is_public)`).eq("owner", owner).order("created_at", { ascending: false }).limit(100),
  ]);
  type Joined = { papers: PaperCols & { owner: string | null; is_public: boolean } };
  const ok = readable(owner);
  const paperOf = (p: Joined["papers"], at: string | null): ShelfPaper => ({ id: p.id, title: p.title, name: p.name, authors: p.authors, year: p.year, at });
  return {
    library,
    mine: (must(mine) as (PaperCols & { updated_at: string })[]).map((p) => ({ id: p.id, title: p.title, name: p.name, authors: p.authors, year: p.year, at: p.updated_at })),
    favorites: (must(favorites) as unknown as (Joined & { updated_at: string })[]).filter((r) => ok(r.papers)).map((r) => paperOf(r.papers, r.updated_at)),
    history: (must(history) as unknown as (Joined & { last_opened_at: string })[]).filter((r) => ok(r.papers)).map((r) => paperOf(r.papers, r.last_opened_at)),
    bookmarks: (must(bookmarks) as unknown as (Bookmark & Joined)[])
      .filter((r) => ok(r.papers))
      .map(({ papers: p, ...b }) => ({ ...b, paper: { id: p.id, title: p.title, name: p.name } })),
  };
}

// ---- Route plumbing: every reading route is "signed in, on a paper you can read" -----------

/**
 * Runs `fn` for the signed-in reader on paper `id`, turning the usual failures into responses:
 * 401 signed out, 404 a paper they can't read, 400 bad input, 500 anything else.
 */
export async function withReader(id: string, fn: (owner: string) => Promise<Response>): Promise<Response> {
  const user = await currentUser();
  if (!user) return json(401, "Sign in to save highlights, bookmarks and notes.");
  try {
    if (!(await readablePaper(user.id, id))) return json(404, "That paper isn’t available.");
    return await fn(user.id);
  } catch (err) {
    if (err instanceof ReadingInputError) return json(400, err.message);
    console.error("[reading] failed", err);
    return json(500, "Couldn’t save that. Please try again.");
  }
}
