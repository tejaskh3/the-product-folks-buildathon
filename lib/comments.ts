// Server-only: public discussion on library papers, and its moderation.
//
//   GET    comments ──► everyone: visible ones (not hidden, not deleted); authors also see their own hidden ones
//   POST   comment  ──► signed in, library paper, 10 an hour ──► saved with a shown name ("Ada L.")
//   report          ──► one per reader ──► third distinct report hides it (report_comment, atomic)
//   /admin          ──► reported and hidden comments ──► restore (clears reports) or delete
import { db } from "./db";

export const MAX_COMMENT = 2000;
export const COMMENTS_PER_HOUR = 10;
export const HIDE_AFTER_REPORTS = 3;

export interface CommentRow {
  id: string;
  paper_id: string;
  owner: string;
  author: string;
  scene_id: string | null;
  body: string;
  created_at: string;
  report_count: number;
  hidden: boolean;
  deleted_at: string | null;
}

/** A comment as the reader sees it. */
export interface PublicComment {
  id: string;
  author: string;
  sceneId: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
  /** Only ever true on the author's own comment: others never see hidden ones. */
  hidden: boolean;
  reportedByMe: boolean;
}

export class CommentInputError extends Error {}

const must = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};

/** "Ada Lovelace" → "Ada L."; nothing usable → "Reader". Never the email. */
export function shownName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Reader";
  const first = parts[0].slice(0, 40);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

/** A paper that takes comments: public (the library). */
export async function commentablePaper(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return !!must(await db().from("papers").select("id").eq("id", id).eq("is_public", true).maybeSingle());
}

export async function listComments(paperId: string, viewer: string | null): Promise<PublicComment[]> {
  let q = db().from("comments").select("*").eq("paper_id", paperId).is("deleted_at", null);
  q = viewer ? q.or(`hidden.eq.false,owner.eq.${viewer}`) : q.eq("hidden", false);
  const rows = must(await q.order("created_at").limit(500)) as CommentRow[];
  let reported = new Set<string>();
  if (viewer && rows.length) {
    const r = must(await db().from("comment_reports").select("comment_id").eq("reporter", viewer).in("comment_id", rows.map((c) => c.id))) as { comment_id: string }[];
    reported = new Set(r.map((x) => x.comment_id));
  }
  return rows.map((c) => ({
    id: c.id,
    author: c.author,
    sceneId: c.scene_id,
    body: c.body,
    createdAt: c.created_at,
    mine: c.owner === viewer,
    hidden: c.hidden,
    reportedByMe: reported.has(c.id),
  }));
}

export async function postComment(paperId: string, who: { owner: string; name: string | null }, body: { body?: unknown; sceneId?: unknown }, now = Date.now()): Promise<PublicComment> {
  if (typeof body.body !== "string" || !body.body.trim()) throw new CommentInputError("Write something first.");
  const text = body.body.trim();
  if (text.length > MAX_COMMENT) throw new CommentInputError(`Comments are ${MAX_COMMENT.toLocaleString("en")} characters at most.`);
  const sceneId = body.sceneId === undefined || body.sceneId === null ? null : typeof body.sceneId === "string" && body.sceneId.length <= 200 ? body.sceneId : null;

  const since = new Date(now - 3600_000).toISOString();
  const { count } = await db().from("comments").select("id", { count: "exact", head: true }).eq("owner", who.owner).gte("created_at", since);
  if ((count ?? 0) >= COMMENTS_PER_HOUR) throw new CommentInputError("That’s a lot of comments for one hour. Try again a bit later.");

  const row = must(
    await db().from("comments").insert({ paper_id: paperId, owner: who.owner, author: shownName(who.name), scene_id: sceneId, body: text }).select("*").single(),
  ) as CommentRow;
  return { id: row.id, author: row.author, sceneId: row.scene_id, body: row.body, createdAt: row.created_at, mine: true, hidden: false, reportedByMe: false };
}

/** The author removes their own comment. False when it isn't theirs (or is already gone). */
export async function deleteOwnComment(paperId: string, owner: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = must(
    await db().from("comments").update({ deleted_at: new Date().toISOString(), deleted_by: "author" }).eq("id", id).eq("paper_id", paperId).eq("owner", owner).is("deleted_at", null).select("id"),
  ) as { id: string }[];
  return rows.length > 0;
}

/** One report per reader. Returns whether the comment is now hidden, or null when there's nothing to report. */
export async function reportComment(paperId: string, reporter: string, id: string, reason: unknown): Promise<{ hidden: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const c = must(await db().from("comments").select("owner, paper_id").eq("id", id).is("deleted_at", null).maybeSingle()) as { owner: string; paper_id: string } | null;
  if (!c || c.paper_id !== paperId) return null;
  if (c.owner === reporter) throw new CommentInputError("You can delete your own comment instead.");
  const rows = must(
    await db().rpc("report_comment", { p_comment: id, p_reporter: reporter, p_reason: typeof reason === "string" ? reason.slice(0, 300) : "", p_hide_at: HIDE_AFTER_REPORTS }),
  ) as { report_count: number; hidden: boolean }[];
  return rows[0] ? { hidden: rows[0].hidden } : null;
}

// ---- /admin --------------------------------------------------------------------------------

export interface ModerationRow extends CommentRow {
  paper: { id: string; title: string | null } | null;
  reasons: string[];
}

/** Reported or hidden comments, most reported first. `hiddenOnly` narrows to what readers can't see. */
export async function listForModeration(opts: { hiddenOnly?: boolean; limit?: number } = {}): Promise<ModerationRow[]> {
  let q = db().from("comments").select("*, papers(id, title), comment_reports(reason)").is("deleted_at", null).gt("report_count", 0);
  if (opts.hiddenOnly) q = q.eq("hidden", true);
  const rows = must(await q.order("hidden", { ascending: false }).order("report_count", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 200)) as (CommentRow & {
    papers: { id: string; title: string | null } | null;
    comment_reports: { reason: string }[];
  })[];
  return rows.map(({ papers, comment_reports, ...c }) => ({ ...c, paper: papers, reasons: comment_reports.map((r) => r.reason).filter(Boolean) }));
}

/** Restore: visible again, reports cleared (readers can report it afresh). Delete: gone for everyone. */
export async function moderate(id: string, action: "restore" | "delete"): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  if (action === "delete") {
    const rows = must(await db().from("comments").update({ deleted_at: new Date().toISOString(), deleted_by: "admin" }).eq("id", id).is("deleted_at", null).select("id")) as { id: string }[];
    return rows.length > 0;
  }
  const rows = must(await db().from("comments").update({ hidden: false, report_count: 0 }).eq("id", id).is("deleted_at", null).select("id")) as { id: string }[];
  if (!rows.length) return false;
  must(await db().from("comment_reports").delete().eq("comment_id", id));
  return true;
}
