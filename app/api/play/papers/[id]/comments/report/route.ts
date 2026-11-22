// POST /api/play/papers/:id/comments/report {id, reason?} → reported (signed in, once per reader).
// The third reader to report a comment hides it until an admin looks at it.
import { currentUser } from "@/lib/auth";
import { CommentInputError, reportComment } from "@/lib/comments";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return json(401, "Sign in to report a comment.");
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; reason?: unknown };
  try {
    const done = await reportComment(id, user.id, typeof body.id === "string" ? body.id : "", body.reason);
    if (!done) return json(404, "That comment is already gone.");
    return Response.json(done, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof CommentInputError) return json(400, err.message);
    console.error("[comments] report failed", err);
    return json(500, "Couldn’t send the report.");
  }
}
