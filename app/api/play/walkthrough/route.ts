// POST /api/play/walkthrough — explains the whole paper as a guided sequence of scenes.
// Streams NDJSON WalkthroughEvents: the plan first, then each scene as its diagram is ready.
//
//   {key} (signed out) ──► demo paper? ──► stream the pre-generated walkthrough
//   {paperId}          ──► finished?   ──► stream what's saved (free; library papers need no sign-in)
//                     └──► plan saved? ──► draw only the missing scenes   ┐ every plan and scene is saved
//                     └──► otherwise   ──► plan, then draw every scene    ┘ on the server as it lands
//
// Out of time with scenes left → a "continue" event; the client calls again to finish them.
import { db, readablePaper, type PaperRow, type WalkthroughPlanRow } from "@/lib/db";
import { LlmError, userMessage } from "@/lib/llm";
import { BYOK_MAX_CONCURRENCY, DEFAULT_MODEL, modelSpec } from "@/lib/models";
import { authorize, forUser, keyFor, markUsed, notAllowedResponse, refund } from "@/lib/entitlements";
import { checkOpenRouterKey } from "@/lib/keys";
import { ndjsonResponse } from "@/lib/ndjson";
import { signInRequired } from "@/lib/playAuth";
import { currentEmail, currentUser } from "@/lib/auth";
import { clientIp } from "@/lib/abuse";
import { arxivId, isPaperId, json, takePlaySlot } from "@/lib/playServer";
import { PaperUnavailable, paperForGeneration, saveDigest } from "@/lib/paperSource";
import { usageRecorder } from "@/lib/usage";
import { findDemo, generateWalkthrough, type DemoWalkthrough } from "@/lib/walkthroughServer";
import type { WalkthroughEvent } from "@/lib/walkthroughClient";
import { withoutDiagram, type Scene } from "@/lib/walkthrough";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEADLINE_MS = 270_000; // leave room to save the last scenes and close inside the 300 s limit
const LEASE_SECONDS = 290;
const DEMO_SPACING_MS = 150;

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { paperId?: unknown; key?: unknown };

  if (!isPaperId(body.paperId)) {
    const demo = await demoForKey(body.key);
    if (!demo) return json(400, "Upload a paper first.");
    return ndjsonResponse<WalkthroughEvent>((send) => streamSaved(send, demo, DEMO_SPACING_MS));
  }

  const user = await currentUser();
  const row = await readablePaper(user?.id ?? null, body.paperId);
  if (!row) return user ? json(404, "That paper isn’t one of yours. Upload it first.") : signInRequired();

  const plan = row.walkthrough_plan;
  const saved = row.walkthrough?.scenes ?? [];
  if (row.walkthrough && saved.length && (!plan || saved.length >= plan.scenes.length)) {
    return ndjsonResponse<WalkthroughEvent>((send) => streamSaved(send, { ...row.walkthrough!, motif: plan?.motif }, 0));
  }
  if (!user) return signInRequired();
  // Library papers are finished before they're published; only an owner's paper is ever drawn.
  if (row.owner !== user.id) return json(409, "This paper is still being prepared. Try again later.");

  const busy = takePlaySlot();
  if (busy) return busy;

  // May this user draw this paper, and whose key pays? (Reserves a paper the first time.)
  const decision = await authorize(user.id, row.id, "paper", { ip: clientIp(req), email: currentEmail });
  if (!decision.allowed) return notAllowedResponse(decision);
  let apiKey: string;
  try {
    apiKey = await keyFor(user.id, decision);
    if (decision.keySource === "byok") {
      // Check the user's key before spending anything, so a dead key never leaves half a paper.
      const check = await checkOpenRouterKey(apiKey);
      if (!check.ok) {
        if (decision.reservedNow) await refund(user.id, row.id);
        return json(402, check.reason === "no_credit" ? userMessage(new LlmError("OutOfCredit", "")) : userMessage(new LlmError("KeyInvalid", "")));
      }
    }
  } catch (err) {
    if (decision.reservedNow) await refund(user.id, row.id);
    return json(503, userMessage(forUser(err, decision)));
  }
  const concurrency = Math.min(modelSpec(DEFAULT_MODEL).maxConcurrency, decision.keySource === "byok" ? BYOK_MAX_CONCURRENCY : Infinity);

  const started = Date.now();
  let lastScene = "s1";
  let drawn = saved.length;
  let continued = false;
  return ndjsonResponse<WalkthroughEvent>(
    async (send) => {
      let leased = false;
      try {
        // Another tab is already drawing this paper: show what's there and check back shortly.
        leased = await takeLease(row.id);
        if (!leased) {
          if (plan) send({ type: "plan", paper: plan.paper, scenes: plan.scenes });
          for (const scene of saved) send({ type: "scene", scene });
          send({ type: "continue" });
          send({ type: "done" });
          return;
        }
        // The whole PDF for every call, unless PAPER_SENDING=digest (lib/paperSending.ts).
        const { sender } = await paperForGeneration(user.id, row.id);
        const track = usageRecorder({ owner: user.id, paperId: row.id, keySource: decision.keySource });
        await generateWalkthrough({
          paper: sender,
          onDigest: (d) => saveDigest(row.id, d),
          plan: plan ?? undefined,
          saved,
          concurrency,
          apiKey,
          deadline: started + DEADLINE_MS,
          onUsage: track,
          onPlan: (p) => savePlan(row, p),
          onScene: async (scene) => {
            await saveScene(row.id, scene);
            // A plan plus one scene: the paper is delivered and stays counted.
            if (++drawn === 1) await markUsed(user.id, row.id);
          },
          emit: (ev) => {
            if (ev.type === "status") lastScene = ev.sceneId;
            if (ev.type === "continue") continued = true;
            send(ev);
          },
        });
        send({ type: "done" });
      } catch (err) {
        console.error("[walkthrough] failed", err);
        const message = err instanceof PaperUnavailable ? err.message : userMessage(forUser(err, decision), "a walkthrough for this paper");
        send({ type: "error", message });
        send({ type: "done" });
      } finally {
        if (leased) {
          await releaseLease(row.id);
          // Nothing drawn and nothing still coming: the paper goes back to the user.
          if (drawn === 0 && !continued) await refund(user.id, row.id);
        }
      }
    },
    () => ({ type: "status", sceneId: lastScene, stage: "drawing" }),
  );
}

/** A demo's walkthrough by paper key ("arxiv:<id>" or "sha:<hash>"), for signed-out visitors. */
async function demoForKey(key: unknown): Promise<DemoWalkthrough | null> {
  if (typeof key !== "string") return null;
  if (key.startsWith("arxiv:")) return findDemo({ arxiv: arxivId(key.slice(6))?.replace(/v\d+$/, "") ?? null });
  if (/^sha:[0-9a-f]{64}$/.test(key)) return findDemo({ pdfSha: key.slice(4) });
  return null;
}

/** Streams an already-finished walkthrough: no model calls. */
async function streamSaved(send: (ev: WalkthroughEvent) => void, w: DemoWalkthrough, spacingMs: number) {
  send({
    type: "plan",
    paper: w.paper,
    scenes: w.scenes.map((s) => withoutDiagram(s)),
    ...(w.citation ? { citation: w.citation } : {}),
    ...(w.takeaways?.length ? { takeaways: w.takeaways } : {}),
  });
  for (const scene of w.scenes) {
    if (spacingMs) await new Promise((r) => setTimeout(r, spacingMs));
    send({ type: "scene", scene });
  }
  send({ type: "done" });
}

async function savePlan(row: PaperRow, plan: WalkthroughPlanRow) {
  const { error } = await db()
    .from("papers")
    .update({
      walkthrough_plan: plan,
      title: plan.paper.title ?? row.title,
      authors: plan.paper.authors ?? row.authors,
      year: plan.paper.year ?? row.year,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(`Couldn’t save the plan: ${error.message}`);
}

async function saveScene(paperId: string, scene: Scene) {
  const { error } = await db().rpc("save_walkthrough_scene", { p_paper: paperId, p_scene: scene });
  if (error) throw new Error(error.message);
}

async function takeLease(paperId: string): Promise<boolean> {
  const { data, error } = await db().rpc("take_drawing_lease", { p_paper: paperId, p_seconds: LEASE_SECONDS });
  if (error) throw new Error(error.message);
  return data === true;
}

async function releaseLease(paperId: string) {
  const { error } = await db().from("papers").update({ drawing_until: null }).eq("id", paperId);
  if (error) console.error("[walkthrough] couldn’t release the drawing lease", error.message);
}
