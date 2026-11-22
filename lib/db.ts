// Server-only access for saved papers and explorations. Must never be imported by client code.
// Backed by lib/localDb.ts (a JSON file + a folder of PDFs) instead of Supabase: it speaks the
// same supabase-js query API, so the rest of the code is unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExploreNode, Scene, Walkthrough } from "@/lib/walkthrough";
import type { Suggestions } from "@/lib/playPrompts";
import type { PaperDigest } from "@/lib/digest";
import { localClient } from "@/lib/localDb";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  return (client ??= localClient() as unknown as SupabaseClient);
}

export interface PaperRow {
  id: string;
  /** Clerk user id; null for library papers. */
  owner: string | null;
  paper_key: string;
  name: string | null;
  title: string | null;
  authors: string | null;
  year: number | null;
  arxiv_id: string | null;
  file_id: string | null;
  /** sha256 of the stored PDF (Storage bucket "papers"); null for papers saved before v1. */
  pdf_sha256: string | null;
  walkthrough: Walkthrough | null;
  /** The planned scenes, before (and while) they are drawn. */
  walkthrough_plan: WalkthroughPlanRow | null;
  /** Library paper: one shared copy anyone can read. */
  is_public: boolean;
  /** Suggested questions, saved once so reopening the paper is free. */
  suggestions: Suggestions | null;
  /** The paper's digest (lib/digest.ts), made once with PAPER_SENDING=digest; null until then. */
  digest: PaperDigest | null;
  library_slug: string | null;
  library_rank: number | null;
  library_blurb: string | null;
  created_at: string;
  updated_at: string;
}

/** A paper row as the browser gets it: without the digest, which is prompt material (and ~15 KB). */
export function clientPaper(row: PaperRow): Omit<PaperRow, "digest"> {
  const { digest, ...rest } = row;
  void digest;
  return rest;
}

export interface WalkthroughPlanRow {
  paper: Walkthrough["paper"];
  motif: string;
  scenes: Omit<Scene, "diagram">[];
}

export interface NodeRow {
  id: string;
  kind: ExploreNode["kind"];
  title: string;
  parent_id: string | null;
  diagram: ExploreNode["diagram"];
  status: ExploreNode["status"];
  created_at: string;
}

export function toNode(r: NodeRow): ExploreNode {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    parentId: r.parent_id,
    diagram: r.diagram,
    status: r.status,
    createdAt: Date.parse(r.created_at),
  };
}

/** The user's own paper with this id, or null. */
export async function ownedPaper(userId: string, id: string): Promise<PaperRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db().from("papers").select("*").eq("id", id).eq("owner", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PaperRow | null;
}

/** A paper this visitor may read: their own, or a public demo. Signed-out visitors get public ones only. */
export async function readablePaper(userId: string | null, id: string): Promise<PaperRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const q = db().from("papers").select("*").eq("id", id);
  const { data, error } = await (userId ? q.or(`owner.eq.${userId},is_public.eq.true`) : q.eq("is_public", true)).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PaperRow | null;
}

/**
 * Whose nodes a user's question is saved as. On their own paper it's part of the paper ('');
 * on a library paper it's a private node of theirs, which no other reader sees.
 */
export function nodeOwner(row: Pick<PaperRow, "owner">, userId: string): string {
  return row.owner === userId ? "" : userId;
}

/** The nodes this visitor sees on a paper: the paper's own, plus their private ones. */
export async function visibleNodes(paperId: string, userId: string | null): Promise<ExploreNode[]> {
  let q = db().from("nodes").select("*").eq("paper_id", paperId);
  q = userId ? q.in("owner", ["", userId]) : q.eq("owner", "");
  const { data, error } = await q.order("created_at");
  if (error) throw new Error(error.message);
  return (data as NodeRow[]).map(toNode);
}

/** The finished library paper for this paper key or PDF hash, if the library has it. */
export async function libraryPaper(q: { key?: string | null; sha?: string | null }): Promise<PaperRow | null> {
  const ors = [q.key && `paper_key.eq.${q.key}`, q.sha && /^[0-9a-f]{64}$/.test(q.sha) && `pdf_sha256.eq.${q.sha}`].filter(Boolean);
  if (!ors.length) return null;
  const { data, error } = await db().from("papers").select("*").eq("is_public", true).not("walkthrough", "is", null).or(ors.join(",")).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PaperRow | null;
}
