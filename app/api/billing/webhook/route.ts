// POST /api/billing/webhook — Dodo Payments events.
//
//   verify signature (Standard Webhooks, @dodopayments/core) ─► 401 if bad
//   webhook-id seen before? ─► 200, skip
//   event about a subscription ─► re-fetch it from Dodo ─► syncSubscription ─► remember the webhook-id
//
// A failure answers 500 without remembering the id, so Dodo retries it.
import { verifyWebhookPayload } from "@dodopayments/core/webhook";
import { dodo, syncSubscription } from "@/lib/billing";
import { db } from "@/lib/db";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
  if (!secret) return json(503, "Webhooks aren’t set up.");
  const body = await req.text();
  const headers = Object.fromEntries(["webhook-id", "webhook-signature", "webhook-timestamp"].map((h) => [h, req.headers.get(h) ?? ""]));

  let payload: Awaited<ReturnType<typeof verifyWebhookPayload>>;
  try {
    payload = await verifyWebhookPayload({ webhookKey: secret, headers, body });
  } catch {
    return json(401, "Invalid signature.");
  }

  const id = headers["webhook-id"];
  const { data: seen } = await db().from("webhook_events").select("id").eq("id", id).maybeSingle();
  if (seen) return Response.json({ ok: true, duplicate: true });

  try {
    // Subscription events, and payments that belong to a subscription (renewals), carry its id.
    const subscriptionId = (payload.data as { subscription_id?: unknown }).subscription_id;
    if (typeof subscriptionId === "string" && subscriptionId) {
      const sub = await dodo().subscriptions.retrieve(subscriptionId);
      const saved = await syncSubscription(sub);
      if (!saved) console.warn(`[billing:webhook] ${payload.type} for ${sub.subscription_id} not tied to a user`);
    }
    await db().from("webhook_events").upsert({ id, type: payload.type }, { onConflict: "id", ignoreDuplicates: true });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[billing:webhook] ${payload.type} failed`, err);
    return json(500, "Couldn’t process the event.");
  }
}
