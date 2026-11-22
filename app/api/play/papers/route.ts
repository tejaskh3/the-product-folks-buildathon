// GET  /api/play/papers         → the signed-in user's saved papers, newest first
// GET  /api/play/papers?key=…   → one saved paper (by paper key) with its nodes, or 404:
//                                  the user's own copy first, else a public demo paper
// Papers are created by POST /api/play/upload.
import { clientPaper, db, visibleNodes, type PaperRow } from "@/lib/db";
import { json } from "@/lib/playServer";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_COLUMNS = "id, paper_key, name, title, authors, year, arxiv_id, created_at, updated_at";

export async function GET(req: Request) {
  const user = await currentUser();
  const key = new URL(req.url).searchParams.get("key");
  try {
    if (key) {
      const paper = await byKey(user?.id ?? null, key);
      if (!paper) return json(404, "Not saved yet.");
      return Response.json({ paper: clientPaper(paper), nodes: await visibleNodes(paper.id, user?.id ?? null) });
    }
    if (!user) return Response.json({ papers: [] });
    const { data, error } = await db().from("papers").select(LIST_COLUMNS).eq("owner", user.id).order("updated_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return Response.json({ papers: data });
  } catch (err) {
    return json(500, err instanceof Error ? err.message : "Couldn’t load saved papers.");
  }
}

/** The user's own saved copy of a paper, else the public demo with that key. */
async function byKey(userId: string | null, key: string): Promise<PaperRow | null> {
  if (userId) {
    const { data, error } = await db().from("papers").select("*").eq("owner", userId).eq("paper_key", key).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PaperRow;
  }
  const { data, error } = await db().from("papers").select("*").eq("is_public", true).eq("paper_key", key).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PaperRow | null;
}
