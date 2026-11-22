// POST /api/research — {topic, save?} → the research agent's top 3 articles and top 3 new findings.
// With save, the results also land in the reader's feed as live notifications. Takes ~30–60 s.
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { research } from "@/lib/research";
import { addResearch, getPersona } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { topic?: unknown; save?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 120) : "";
  if (!topic) return json(400, "Name a topic to research.");
  try {
    const result = await research(topic);
    let saved = false;
    if (body.save === true && (await getPersona(user.id))) {
      await addResearch(user.id, result, topic);
      saved = true;
    }
    return Response.json({ ...result, saved }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[research] failed", err);
    return json(500, err instanceof Error ? err.message : "The research agent failed. Try again.");
  }
}
