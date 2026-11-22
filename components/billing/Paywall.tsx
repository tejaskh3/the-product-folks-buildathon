"use client";

// Shown when a paper would go over the plan's allowance (a 402 "quota" from the server), or when
// a free paper is refused by the abuse checks ("ip_limit", "disposable_email"): same plans, own heading.
// Nothing was charged or counted; choosing a plan comes back to this paper once it's active.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { PlanGrid } from "./PlanGrid";
import type { Plan } from "@/lib/accountClient";

export type PaywallReason = "quota" | "ip_limit" | "disposable_email";

const COPY: Record<Exclude<PaywallReason, "quota">, { title: string; body: string }> = {
  ip_limit: {
    title: "Too many free papers from this network today",
    body: "Try again tomorrow, or pick a plan to keep going now. This paper wasn’t counted.",
  },
  disposable_email: {
    title: "Free papers need a permanent email address",
    body: "Sign in with your usual email to use the free papers, or pick a plan. The library stays free to read.",
  },
};

export function Paywall({
  allowance,
  plan,
  reason = "quota",
  onClose,
}: {
  allowance: number | null;
  plan?: Plan | null;
  reason?: PaywallReason;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const next = typeof window === "undefined" ? "/play" : window.location.pathname + window.location.search;
  const copy =
    reason === "quota"
      ? {
          title: plan && plan !== "free" ? "You’ve used this month’s papers" : `You’ve used your ${allowance ?? 2} free papers`,
          body: "Pick a plan to keep going. This paper wasn’t counted, and you’ll come straight back to it. Papers you’ve already opened stay free to explore.",
        }
      : COPY[reason];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="paywall-title">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div ref={ref} tabIndex={-1} className="relative max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-paper p-5 shadow-2xl outline-none sm:rounded-2xl sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="paywall-title" className="font-serif text-2xl text-ink sm:text-3xl">
              {copy.title}
            </h2>
            <p className="mt-2 max-w-prose text-ink-2">{copy.body}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink">
            Close
          </button>
        </div>
        <PlanGrid billing current={plan} next={next} showFree={false} hideCurrent />
        <p className="mt-5 text-sm text-ink-3">
          {reason !== "quota" && (
            <>
              Compare plans on the{" "}
              <Link href="/pricing" className="underline decoration-line underline-offset-2 hover:text-ink">
                pricing page
              </Link>
              .{" "}
            </>
          )}
          Or read the <Link href="/library" className="underline decoration-line underline-offset-2 hover:text-ink">library</Link>, free for everyone.
        </p>
      </div>
    </div>
  );
}
