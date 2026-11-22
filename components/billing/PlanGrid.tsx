"use client";

// The plan cards with their buttons: shared by /pricing and the paywall.
import Link from "next/link";
import { useState } from "react";
import { useGoogleSignIn } from "@/components/auth/googleSignIn";
import { useUser } from "@/components/auth/useUser";
import type { Plan } from "@/lib/accountClient";
import { PLANS, startCheckout } from "@/lib/plans";

export function PlanGrid({
  current,
  billing,
  next,
  showFree = true,
  hideCurrent = false,
}: {
  /** The user's plan, when known. */
  current?: Plan | null;
  /** Checkout is open (BILLING_ENABLED). Off: plans are shown, buttons say "Coming soon". */
  billing: boolean;
  /** Where to land once a plan is active. */
  next: string;
  showFree?: boolean;
  /** Leave out the plan they're on (the paywall only offers ways forward). */
  hideCurrent?: boolean;
}) {
  const user = useUser();
  const { start: signIn } = useGoogleSignIn();
  const [busy, setBusy] = useState<Plan | null>(null);
  const [error, setError] = useState("");

  async function choose(plan: Exclude<Plan, "free">) {
    if (!user) return void signIn();
    setBusy(plan);
    setError("");
    try {
      await startCheckout(plan, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  const plans = PLANS.filter((p) => (showFree || p.plan !== "free") && !(hideCurrent && current === p.plan));
  return (
    <div>
      <ul className={`grid gap-4 sm:grid-cols-2 ${plans.length > 3 ? "lg:grid-cols-4" : plans.length === 3 ? "lg:grid-cols-3" : ""}`}>
        {plans.map((p) => {
          const isCurrent = current === p.plan || (!current && user && p.plan === "free");
          return (
            <li key={p.plan} className={`flex flex-col rounded-xl border bg-white p-5 ${p.plan === "pro" ? "border-accent" : "border-line"}`}>
              <h3 className="text-sm font-medium tracking-wide text-ink-2 uppercase">{p.name}</h3>
              <p className="mt-2 font-serif text-3xl text-ink">{p.price}</p>
              <p className="mt-1 text-[15px] text-ink">{p.papers}</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-2">
                {p.points.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <p className="flex h-10 items-center text-sm text-ink-3">Your plan</p>
                ) : p.plan === "free" ? (
                  <Link href="/play" className="btn-secondary h-10 w-full px-4 text-sm">
                    Start reading
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={!billing || busy !== null}
                    onClick={() => void choose(p.plan as Exclude<Plan, "free">)}
                    className={`${p.plan === "pro" && billing ? "btn-primary" : "btn-secondary"} h-10 w-full px-4 text-sm disabled:text-ink-3 disabled:opacity-60`}
                  >
                    {!billing ? "Coming soon" : busy === p.plan ? "Opening checkout…" : p.plan === "byok" ? "Use your own key" : `Choose ${p.name}`}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-4 text-sm text-accent-hover">
          {error}
        </p>
      )}
      {!billing && <p className="mt-4 text-sm text-ink-3">Paid plans are coming soon. Until then there’s no paper limit.</p>}
    </div>
  );
}
