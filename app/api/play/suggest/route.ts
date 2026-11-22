// POST /api/play/suggest — paper title plus 4 suggested questions (fast, low effort).
// Saved on the paper the first time, so reopening it (or reading it in the library) is free.
import { db, readablePaper } from "@/lib/db";
import { structuredCall, userMessage } from "@/lib/llm";
import { isPaperId, json, takePlaySlot } from "@/lib/playServer";
import { requireUser } from "@/lib/playAuth";
import { SUGGEST_PROMPT, SUGGEST_SCHEMA, type Suggestions } from "@/lib/playPrompts";
import { PaperUnavailable, paperForGeneration } from "@/lib/paperSource";
import { recordUsage } from "@/lib/usage";
import { authorize, forUser, keyFor, notAllowedResponse, type Decision } from "@/lib/entitlements";
import { clientIp } from "@/lib/abuse";
import { currentEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { paperId } = ((await req.json().catch(() => ({}))) ?? {}) as { paperId?: unknown };
  if (!isPaperId(paperId)) return json(400, "Upload a paper first.");
  const saved = await readablePaper(user.id, paperId).catch(() => null);
  if (saved?.suggestions) return Response.json(saved.suggestions, { headers: { "cache-control": "no-store" } });
  const busy = takePlaySlot();
  if (busy) return busy;
  // Suggestions come with opening a new paper, so they share its count (and its key).
  let decision: Decision | null = null;
  try {
    decision = await authorize(user.id, paperId, "paper", { ip: clientIp(req), email: currentEmail });
    if (!decision.allowed) return notAllowedResponse(decision);
    const apiKey = await keyFor(user.id, decision);
    const { sender } = await paperForGeneration(user.id, paperId);
    const { data, usage } = await structuredCall<Suggestions>({
      // With PAPER_SENDING=digest and a digest saved: the digest alone. Otherwise the whole PDF.
      paper: sender.digestOnly("suggest"),
      prompt: SUGGEST_PROMPT,
      schema: SUGGEST_SCHEMA,
      effort: "low",
      maxTokens: 16000,
      apiKey,
    });
    await recordUsage({ owner: user.id, paperId, keySource: decision.keySource }, "suggest", usage);
    data.questions = data.questions.slice(0, 4);
    const { error } = await db().from("papers").update({ suggestions: data }).eq("id", paperId);
    if (error) console.error("[play:suggest] couldn’t save suggestions", error.message);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof PaperUnavailable) return json(err.status, err.message);
    console.error("[play:suggest] failed", err);
    return json(502, userMessage(forUser(err, decision), "suggested questions for this paper"));
  }
}
