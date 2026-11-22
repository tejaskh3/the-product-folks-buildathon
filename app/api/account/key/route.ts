// PUT    /api/account/key {key} — checks the OpenRouter key with OpenRouter, then stores it encrypted.
// DELETE /api/account/key      — removes it. The key itself is never sent back; only its last 4 characters.
import { checkOpenRouterKey, deleteUserKey, looksLikeOpenRouterKey, saveUserKey } from "@/lib/keys";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { key } = ((await req.json().catch(() => ({}))) ?? {}) as { key?: unknown };
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!looksLikeOpenRouterKey(trimmed)) return json(400, "That doesn’t look like an OpenRouter key. It starts with sk-or-.");

  const check = await checkOpenRouterKey(trimmed);
  if (!check.ok) {
    const message =
      check.reason === "invalid"
        ? "OpenRouter rejected that key. Check you copied all of it."
        : check.reason === "no_credit"
          ? "That key has no credit left. Top it up at openrouter.ai, then add it again."
          : "Couldn’t reach OpenRouter to check the key. Please try again.";
    return json(check.reason === "unreachable" ? 502 : 400, message);
  }
  try {
    const info = await saveUserKey(user.id, trimmed);
    return Response.json({ ...info, creditLeft: check.creditLeft }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[account:key] save failed", err instanceof Error ? err.message : "unknown");
    return json(500, "Couldn’t save the key.");
  }
}

export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    await deleteUserKey(user.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[account:key] delete failed", err);
    return json(500, "Couldn’t remove the key.");
  }
}
