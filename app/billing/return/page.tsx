"use client";

// Dodo sends people here after checkout (?subscription_id=…&status=…&next=…).
// We ask Dodo directly whether the plan is active (not waiting for the webhook), then go back
// to where they were. If it's still not confirmed after ~30 s: say so, with a support link.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PRODUCT_NAME } from "@/components/landing/site";

const TRY_FOR_MS = 30_000;
const EVERY_MS = 2_000;
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
const SUPPORT = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Curio plan not activating")}` : null;

function Contact({ children }: { children: string }) {
  return SUPPORT ? (
    <a href={SUPPORT} className="underline underline-offset-2">
      {children}
    </a>
  ) : (
    <>reply to your receipt email</>
  );
}

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/play";
}

function Activating() {
  const params = useSearchParams();
  const router = useRouter();
  const subscriptionId = params.get("subscription_id");
  const next = safeNext(params.get("next"));
  const failed = params.get("status") === "failed" || params.get("status") === "cancelled";
  const [state, setState] = useState<"working" | "slow" | "error">(subscriptionId && !failed ? "working" : "error");
  const [message, setMessage] = useState(failed ? "The payment didn’t go through. You haven’t been charged." : subscriptionId ? "" : "We couldn’t find your subscription.");

  useEffect(() => {
    if (!subscriptionId || failed) return;
    let live = true;
    const started = Date.now();
    (async () => {
      while (live) {
        try {
          const res = await fetch("/api/billing/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subscriptionId }),
            cache: "no-store",
          });
          const body = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
          if (res.ok && body?.status === "active") return router.replace(next);
          if (res.status === 403 || res.status === 400 || (res.ok && body?.status && body.status !== "pending")) {
            setState("error");
            setMessage(body?.error ?? "That payment didn’t activate a plan.");
            return;
          }
        } catch {
          /* retry */
        }
        if (Date.now() - started > TRY_FOR_MS) return setState("slow");
        await new Promise((r) => setTimeout(r, EVERY_MS));
      }
    })();
    return () => {
      live = false;
    };
  }, [subscriptionId, failed, next, router]);

  return (
    <div className="max-w-md text-center">
      {state === "working" ? (
        <>
          <span aria-hidden="true" className="mx-auto mb-5 block size-3 animate-pulse rounded-full bg-accent" />
          <h1 className="font-serif text-3xl text-ink">Activating your plan…</h1>
          <p className="mt-3 text-ink-2">Confirming with the payment provider. This takes a few seconds.</p>
        </>
      ) : state === "slow" ? (
        <>
          <h1 className="font-serif text-3xl text-ink">Still activating…</h1>
          <p className="mt-3 text-ink-2">
            Your payment went through, but the plan hasn’t shown up yet. It usually does within a minute. If it doesn’t, <Contact>email us</Contact> and we’ll sort it out.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary h-10 px-5 text-sm">
              Check again
            </button>
            <Link href={next} className="btn-secondary h-10 px-5 text-sm">
              Go back
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="font-serif text-3xl text-ink">That didn’t work</h1>
          <p role="alert" className="mt-3 text-ink-2">
            {message} If something looks wrong, <Contact>email us</Contact>.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/pricing" className="btn-primary h-10 px-5 text-sm">
              See plans
            </Link>
            <Link href={next} className="btn-secondary h-10 px-5 text-sm">
              Go back
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function BillingReturnPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4">
      <p className="mb-10 font-serif text-lg text-ink">{PRODUCT_NAME}</p>
      <Suspense>
        <Activating />
      </Suspense>
    </main>
  );
}
