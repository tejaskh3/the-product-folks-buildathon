// POST   /api/play/papers/:id/bookmarks {kind, target, label?} → the bookmark (same place twice: one bookmark)
// DELETE /api/play/papers/:id/bookmarks?id=… → removed
import { addBookmark, removeBookmark, withReader } from "@/lib/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return withReader(id, async (owner) => Response.json(await addBookmark(owner, id, body), { status: 201 }));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const bookmark = new URL(req.url).searchParams.get("id") ?? "";
  return withReader(id, async (owner) => {
    if (/^[0-9a-f-]{36}$/i.test(bookmark)) await removeBookmark(owner, id, bookmark);
    return new Response(null, { status: 204 });
  });
}
