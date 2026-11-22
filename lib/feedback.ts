// Server-only: the feedback floater's submissions (feedback, feature requests, paper requests).
//
//   POST /api/feedback ──► check fields ──► paper already in the library? ──yes──► link to it, nothing filed
//                                                       │ no
//                                    10 an hour per user (or per IP hash) ──► feedback row
import { createHash } from "node:crypto";
import { db } from "./db";
import { arxivId } from "./playServer";

export const FEEDBACK_KINDS = ["feedback", "feature", "paper"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const MAX_MESSAGE = 2000;
export const PER_HOUR = 10;

export interface FeedbackRow {
  id: string;
  created_at: string;
  owner: string | null;
  email: string | null;
  kind: FeedbackKind;
  message: string;
  arxiv_id: string | null;
  page: string | null;
  ip_hash: string | null;
  done: boolean;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  email: string | null;
  arxivId: string | null;
  page: string | null;
}

export const isKind = (v: unknown): v is FeedbackKind => typeof v === "string" && (FEEDBACK_KINDS as readonly string[]).includes(v);

/** The submission, cleaned up, or the reason it can't be sent. */
export function parseFeedback(body: unknown): FeedbackInput | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isKind(b.kind)) return { error: "Pick feedback, a feature request, or a paper." };
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (message.length > MAX_MESSAGE) return { error: `That’s over ${MAX_MESSAGE} characters. Try a shorter version.` };

  let arxiv: string | null = null;
  if (b.kind === "paper") {
    const id = typeof b.arxiv === "string" && b.arxiv.length <= 300 ? arxivId(b.arxiv) : null;
    if (!id) return { error: "That doesn’t look like an arXiv link or ID." };
    arxiv = id.replace(/v\d+$/, "");
  } else if (!message) return { error: "Write a few words first." };

  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  if (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail))) return { error: "That email doesn’t look right." };

  const page = typeof b.page === "string" && /^\/[^\s]{0,299}$/.test(b.page) ? b.page : null;
  return { kind: b.kind, message, email: rawEmail || null, arxivId: arxiv, page };
}

/** sha256 of the IP plus a server secret, so the raw IP is never stored. */
export function ipHash(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  const secret = process.env.IP_HASH_SECRET || process.env.KEY_ENCRYPTION_SECRET || "";
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

/** True when this sender has used up the hour's submissions. Signed out with no IP: one shared bucket. */
export async function overLimit(who: { owner: string | null; ipHash: string | null }, now = Date.now()): Promise<boolean> {
  const since = new Date(now - 60 * 60 * 1000).toISOString();
  let q = db().from("feedback").select("id", { count: "exact", head: true }).gte("created_at", since);
  if (who.owner) q = q.eq("owner", who.owner);
  else q = who.ipHash ? q.is("owner", null).eq("ip_hash", who.ipHash) : q.is("owner", null).is("ip_hash", null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return (count ?? 0) >= PER_HOUR;
}

/** The library's copy of this arXiv paper, if it has one. */
export async function libraryArxiv(arxiv: string): Promise<{ id: string; title: string | null } | null> {
  const { data, error } = await db()
    .from("papers")
    .select("id, title")
    .eq("is_public", true)
    .not("library_slug", "is", null)
    .or(`paper_key.eq.arxiv:${arxiv},arxiv_id.eq.${arxiv}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; title: string | null } | null;
}

export async function saveFeedback(f: FeedbackInput, who: { owner: string | null; ipHash: string | null }): Promise<string> {
  const { data, error } = await db()
    .from("feedback")
    .insert({ owner: who.owner, email: f.email, kind: f.kind, message: f.message, arxiv_id: f.arxivId, page: f.page, ip_hash: who.ipHash })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** For /admin: newest first, optionally one kind. */
export async function listFeedback(opts: { kind?: FeedbackKind | null; limit?: number } = {}): Promise<FeedbackRow[]> {
  let q = db().from("feedback").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as FeedbackRow[];
}

/** Marks one done (or not). False when there's no such row. */
export async function setFeedbackDone(id: string, done: boolean): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { data, error } = await db().from("feedback").update({ done }).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
