// POST /api/billing/portal → { url }: Dodo's customer portal (cancel, change card, invoices)
// for the signed-in user's own customer record. Never takes a customer id from the browser.
import { BillingUnavailable, portalUrl } from "@/lib/billing";
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const url = await portalUrl(user.id);
    if (!url) return json(404, "You don’t have a subscription yet.");
    return Response.json({ url }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BillingUnavailable) return json(503, err.message);
    console.error("[billing:portal] failed", err);
    return json(502, "Couldn’t open billing. Please try again.");
  }
}
