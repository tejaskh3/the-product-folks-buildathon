// POST   /api/play/papers/:id/highlights {kind, target, quote, color?, note?} → the highlight
// PATCH  /api/play/papers/:id/highlights?id=… {color?, note?} → updated
// DELETE /api/play/papers/:id/highlights?id=… → removed
import { addHighlight, removeHighlight, updateHighlight, withReader } from "@/lib/reading";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const highlightId = (req: Request) => {
  const v = new URL(req.url).searchParams.get("id") ?? "";
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};
const bodyOf = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await bodyOf(req);
  return withReader(id, async (owner) => Response.json(await addHighlight(owner, id, body), { status: 201 }));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const hid = highlightId(req);
  const body = await bodyOf(req);
  return withReader(id, async (owner) => (hid ? Response.json(await updateHighlight(owner, id, hid, body)) : json(400, "Which highlight?")));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const hid = highlightId(req);
  return withReader(id, async (owner) => {
    if (hid) await removeHighlight(owner, id, hid);
    return new Response(null, { status: 204 });
  });
}
