// POST /api/feedback {kind, message, email?, arxiv?, page?} — the feedback floater.
// Open to everyone, signed out too. A paper the library already has is linked, not filed.
import { currentEmail, currentUser } from "@/lib/auth";
import { ipHash, libraryArxiv, overLimit, parseFeedback, saveFeedback } from "@/lib/feedback";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 10_000;

export async function POST(req: Request) {
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return json(413, "That’s too long to send.");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, "Couldn’t read that.");
  }
  const input = parseFeedback(body);
  if ("error" in input) return json(400, input.error);

  try {
    if (input.kind === "paper" && input.arxivId) {
      const lib = await libraryArxiv(input.arxivId);
      if (lib) return Response.json({ library: { id: lib.id, title: lib.title, href: `/play/${lib.id}` } }, { headers: { "cache-control": "no-store" } });
    }
    const user = await currentUser();
    const who = { owner: user?.id ?? null, ipHash: user ? null : ipHash(req) };
    if (await overLimit(who)) return json(429, "That’s a lot of messages for one hour. Try again a bit later.");
    // Signed in: their account email, so we can reply without asking.
    const email = input.email ?? (user ? await currentEmail().catch(() => null) : null);
    await saveFeedback({ ...input, email }, who);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[feedback] couldn’t save", err);
    return json(503, "Couldn’t send that right now. Try again in a minute.");
  }
}
