// /pricing — the plans. Server-rendered so it's readable without JavaScript and by search engines.
import type { Metadata } from "next";
import Link from "next/link";
import { PlanGrid } from "@/components/billing/PlanGrid";
import { UserMenu } from "@/components/auth/UserMenu";
import { PRODUCT_NAME } from "@/components/landing/site";
import { billingEnabled } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Pricing · ${PRODUCT_NAME}`,
  description: "Two papers free. Then $5 for 10 papers a month, $10 for 30, or $2 with your own OpenRouter key.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {PRODUCT_NAME}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/library" className="text-sm text-ink-2 hover:text-ink">
              Library
            </Link>
            <Link href="/play" className="text-sm text-ink-2 hover:text-ink">
              Your papers
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">Pricing</h1>
        <p className="mt-3 max-w-xl text-[15px] text-ink-2">
          Every paper gets a full walkthrough, and you can ask and click deeper as much as you like. A paper counts once, the first time you open it. The library is free for everyone.
        </p>
        <div className="mt-10">
          <PlanGrid billing={billingEnabled()} next="/play" />
        </div>
        <p className="mt-8 text-sm text-ink-3">Prices in USD. Cancel anytime from your account; your plan runs to the end of the month you paid for.</p>
      </main>
    </div>
  );
}
