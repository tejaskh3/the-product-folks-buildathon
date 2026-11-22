// GET /api/play/papers/:id → the paper with the nodes this visitor may see (the user's own paper,
// or a library paper with its own nodes plus the user's private questions on it).
// Saving happens on the server inside the generation routes, so there is no write route here.
import { clientPaper, readablePaper, visibleNodes } from "@/lib/db";
import { json } from "@/lib/playServer";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const userId = (await currentUser())?.id ?? null;
    const paper = await readablePaper(userId, id);
    if (!paper) return json(404, "That paper isn’t available. Sign in with the account that saved it.");
    return Response.json({ paper: clientPaper(paper), nodes: await visibleNodes(id, userId) });
  } catch (err) {
    return json(500, err instanceof Error ? err.message : "Couldn’t load the paper.");
  }
}
