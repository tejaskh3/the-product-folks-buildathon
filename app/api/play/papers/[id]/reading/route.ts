// GET   /api/play/papers/:id/reading → the reader's favorite, notes, bookmarks and highlights here
// PATCH /api/play/papers/:id/reading {favorite?, notes?, opened?} → saved; `opened` feeds History
// Private to the signed-in reader, on their own papers and library papers alike.
import { readingFor, updatePaperState, withReader } from "@/lib/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const noStore = { headers: { "cache-control": "no-store" } };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withReader(id, async (owner) => Response.json(await readingFor(owner, id), noStore));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return withReader(id, async (owner) => {
    await updatePaperState(owner, id, body);
    return new Response(null, { status: 204 });
  });
}
