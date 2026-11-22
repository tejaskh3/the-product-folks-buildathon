// GET    /api/play/papers/:id/comments → the discussion on a library paper (anyone can read)
// POST   /api/play/papers/:id/comments {body, sceneId?} → posted (signed in; 10 an hour)
// DELETE /api/play/papers/:id/comments?id=… → the author removes their own
// Only library (public) papers have a discussion; anything else is a 404.
import { currentProfile, currentUser } from "@/lib/auth";
import { CommentInputError, commentablePaper, deleteOwnComment, listComments, postComment } from "@/lib/comments";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const noStore = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    if (!(await commentablePaper(id))) return json(404, "No discussion here.");
    const user = await currentUser();
    return Response.json({ comments: await listComments(id, user?.id ?? null) }, { headers: noStore });
  } catch (err) {
    console.error("[comments] list failed", err);
    return json(500, "Couldn’t load the discussion.");
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return json(401, "Sign in to join the discussion.");
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { body?: unknown; sceneId?: unknown };
  try {
    if (!(await commentablePaper(id))) return json(404, "No discussion here.");
    const { name } = await currentProfile();
    return Response.json(await postComment(id, { owner: user.id, name }, body), { status: 201, headers: noStore });
  } catch (err) {
    if (err instanceof CommentInputError) return json(400, err.message);
    console.error("[comments] post failed", err);
    return json(500, "Couldn’t post that. Please try again.");
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return json(401, "Sign in first.");
  const comment = new URL(req.url).searchParams.get("id") ?? "";
  try {
    if (!(await deleteOwnComment(id, user.id, comment))) return json(404, "That comment isn’t yours, or it’s already gone.");
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[comments] delete failed", err);
    return json(500, "Couldn’t delete that.");
  }
}
