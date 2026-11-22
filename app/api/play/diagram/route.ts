// POST /api/play/diagram — answers a typed question, or goes deeper on a clicked
// part of an existing diagram. Streams NDJSON (see lib/ndjson.ts).
// The node is saved here, on the server: pending when drawing starts, then ready or error,
// so closing the tab never loses a diagram. On a library paper it's saved as the reader's own
// private node; a diagram the paper (or this reader) already has is served free, with no model call.
// With PAPER_SENDING=digest the model gets the paper's digest plus only the pages in play: the
// clicked part's, or for a typed question the pages of the scene it was asked on.
import { db, nodeOwner, type NodeRow } from "@/lib/db";
import { ndjsonResponse } from "@/lib/ndjson";
import { diagramStream, ID_RE, isPaperId, json, takePlaySlot } from "@/lib/playServer";
import { requireUser } from "@/lib/playAuth";
import { askPrompt, playDeeperPrompt } from "@/lib/playPrompts";
import { PaperUnavailable, paperForGeneration, saveDigest } from "@/lib/paperSource";
import { makeDigest, type PaperSender } from "@/lib/paperSending";
import { usageRecorder, type OnUsage } from "@/lib/usage";
import { authorize, forUser, keyFor, markUsed, notAllowedResponse, refund } from "@/lib/entitlements";
import { clientIp } from "@/lib/abuse";
import { currentEmail } from "@/lib/auth";
import { userMessage } from "@/lib/llm";
import type { DeeperEvent, Diagram } from "@/lib/types";
import type { ExploreNode } from "@/lib/walkthrough";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  paperId?: unknown;
  /** The node as the client shows it: its id, kind, title and parent. */
  node?: { id?: unknown; kind?: unknown; title?: unknown; parentId?: unknown };
  question?: unknown;
  parent?: { id?: unknown; title?: unknown; explorable?: { id?: unknown; label?: unknown; blurb?: unknown; pages?: unknown; quote?: unknown } };
};

const NODE_KINDS = new Set<ExploreNode["kind"]>(["suggested", "question", "deeper"]);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  if (!isPaperId(body.paperId)) return json(400, "Upload a paper first.");
  const paperId = body.paperId;

  const n = body.node ?? {};
  const nodeId = typeof n.id === "string" && ID_RE.test(n.id) ? n.id : null;
  const kind = typeof n.kind === "string" && NODE_KINDS.has(n.kind as ExploreNode["kind"]) ? (n.kind as ExploreNode["kind"]) : null;
  const nodeTitle = str(n.title, 300);
  const nodeParent = typeof n.parentId === "string" && ID_RE.test(n.parentId) ? n.parentId : null;
  if (!nodeId || !kind || !nodeTitle) return json(400, "Invalid request.");

  let prompt: string;
  let parentId: string | undefined;
  let tag: string;
  /** The pages this call is grounded in (PAPER_SENDING=digest sends just these as PDF). */
  let cited: number[] = [];
  if (body.parent) {
    const p = body.parent;
    const e = p.explorable ?? {};
    parentId = typeof p.id === "string" && ID_RE.test(p.id) ? p.id : undefined;
    const eid = typeof e.id === "string" && ID_RE.test(e.id) ? e.id : null;
    const title = str(p.title, 200);
    const label = str(e.label, 80);
    const blurb = str(e.blurb, 600) ?? "";
    const quote = str(e.quote, 600) ?? "";
    const pages = Array.isArray(e.pages) ? e.pages.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 6) : [];
    if (!parentId || !eid || !title || !label || nodeId !== `${parentId}/${eid}`) return json(400, "Invalid request.");
    prompt = playDeeperPrompt({ parentTitle: title, label, blurb, pages, quote });
    tag = "deeper";
    cited = pages;
  } else {
    const question = str(body.question, 300);
    if (!question) return json(400, "Ask a question first.");
    prompt = askPrompt(question);
    tag = "ask";
  }

  let sender, row;
  try {
    ({ sender, row } = await paperForGeneration(user.id, paperId));
  } catch (err) {
    if (err instanceof PaperUnavailable) return json(err.status, err.message);
    throw err;
  }
  const owner = nodeOwner(row, user.id);
  // A typed question is grounded in the scene it was asked on ("s3", or a part of it, "s3/…").
  if (tag === "ask") cited = row.walkthrough_plan?.scenes.find((s) => s.id === nodeParent?.split("/")[0])?.pages ?? [];

  // Already drawn (part of the library paper, or this reader's own earlier answer): free.
  const existing = await readyNode(paperId, nodeId, owner);
  if (existing) {
    return ndjsonResponse<DeeperEvent>(async (send) => {
      send({ type: "done", diagram: existing });
    });
  }

  const busy = takePlaySlot();
  if (busy) return busy;

  // Asking about a paper counts it once (if the walkthrough hasn't already); on BYOK it's free.
  const decision = await authorize(user.id, paperId, "question", { ip: clientIp(req), email: currentEmail });
  if (!decision.allowed) return notAllowedResponse(decision);
  let apiKey: string;
  try {
    apiKey = await keyFor(user.id, decision);
  } catch (err) {
    if (decision.reservedNow) await refund(user.id, paperId);
    return json(503, userMessage(forUser(err, decision)));
  }

  const save = (status: ExploreNode["status"], diagram: Diagram | null) => saveNode(paperId, owner, { id: nodeId, kind, title: nodeTitle, parentId: nodeParent, status, diagram });
  await save("pending", null);

  const track = usageRecorder({ owner: user.id, paperId, keySource: decision.keySource });
  return diagramStream({
    // The whole PDF, unless PAPER_SENDING=digest: then the digest plus the cited pages.
    paper: async () => {
      // Shared by every reader, so never paid for with one reader's own key.
      if (sender.wantsDigest && row.is_public && decision.keySource === "platform") await firstLibraryDigest(sender, paperId, apiKey, track("digest"));
      return sender.forPages(cited, `${tag}:${nodeId}`);
    },
    prompt,
    id: nodeId,
    parentId,
    tag,
    apiKey,
    onUsage: track(tag),
    onDone: async (d) => {
      await save("ready", d);
      await markUsed(user.id, paperId);
    },
    onError: async () => {
      await save("error", null);
      if (decision.reservedNow) await refund(user.id, paperId);
    },
    mapError: (err) => forUser(err, decision),
  });
}

/**
 * A library paper is imported finished, so no plan ever makes its digest: the first question on it
 * makes one (one whole-PDF call) and saves it for every later reader. On failure this question
 * simply gets the whole PDF.
 */
async function firstLibraryDigest(sender: PaperSender, paperId: string, apiKey: string, onUsage: OnUsage) {
  try {
    const { digest, usage } = await makeDigest({ paper: sender.full, apiKey });
    await onUsage(usage);
    if (!digest) return console.warn(`[sending] ${paperId}: the digest call came back unusable`);
    sender.setDigest(digest);
    await saveDigest(paperId, digest);
  } catch (err) {
    console.error(`[sending] ${paperId}: couldn’t make the library digest`, err);
  }
}

/** A finished diagram with this id that this reader can see, if there is one. */
async function readyNode(paperId: string, id: string, owner: string): Promise<Diagram | null> {
  const { data, error } = await db()
    .from("nodes")
    .select("diagram, owner")
    .eq("paper_id", paperId)
    .eq("id", id)
    .eq("status", "ready")
    .in("owner", owner ? ["", owner] : [""]);
  if (error) throw new Error(error.message);
  const hit = (data as Pick<NodeRow, "diagram">[]).find((n) => n.diagram);
  return hit?.diagram ?? null;
}

async function saveNode(
  paperId: string,
  owner: string,
  n: { id: string; kind: ExploreNode["kind"]; title: string; parentId: string | null; status: ExploreNode["status"]; diagram: Diagram | null },
) {
  const { error } = await db()
    .from("nodes")
    .upsert(
      { paper_id: paperId, owner, id: n.id, kind: n.kind, title: n.title, parent_id: n.parentId, diagram: n.diagram, status: n.status },
      { onConflict: "paper_id,owner,id" },
    );
  if (error) throw new Error(`Couldn’t save the question: ${error.message}`);
  // A library paper's shared row isn't "touched" by one reader's question.
  if (!owner) await db().from("papers").update({ updated_at: new Date().toISOString() }).eq("id", paperId);
}
