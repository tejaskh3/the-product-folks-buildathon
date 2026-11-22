"use client";

// /account — your plan and papers left, your own OpenRouter key, and every model call made for you.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UserMenu } from "@/components/auth/UserMenu";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { useUser } from "@/components/auth/useUser";
import { PRODUCT_NAME } from "@/components/landing/site";
import { openBillingPortal } from "@/lib/plans";
import { PLAN_LABEL, getAccount, getUsage, papersLeft, removeKey, saveKey, type Account, type UsageEvent } from "@/lib/accountClient";

const STEP_LABEL: Record<string, string> = { plan: "Planned the walkthrough", suggest: "Suggested questions", ask: "Answered a question", deeper: "Went deeper" };
const stepLabel = (s: string) => STEP_LABEL[s] ?? (s.startsWith("scene:") ? `Drew scene ${s.slice(7).replace("s", "")}` : s);
const money = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

export default function AccountPage() {
  const user = useUser();
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<UsageEvent[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getAccount().then(setAccount, (e: Error) => setError(e.message));
    getUsage().then(setUsage, () => setUsage([]));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white/85">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {PRODUCT_NAME}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/play" className="text-sm text-ink-2 hover:text-ink">
              Back to papers
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">Account</h1>

        {user === undefined ? null : !user ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <p className="mb-4 text-ink-2">Sign in to see your plan, your key and your usage.</p>
            <GoogleSignInButton label="Sign in with Google" />
          </div>
        ) : error ? (
          <p role="alert" className="text-ink-2">
            {error}
          </p>
        ) : (
          <>
            <PlanSection account={account} />
            <KeySection account={account} onChange={load} />
            <UsageSection events={usage} />
          </>
        )}
      </main>
    </div>
  );
}

function PlanSection({ account }: { account: Account | null }) {
  const left = account ? papersLeft(account) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ends = account?.periodEnd ? new Date(account.periodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;

  async function manage() {
    setBusy(true);
    setError("");
    try {
      await openBillingPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="plan" className="rounded-xl border border-line bg-white p-6">
      <h2 id="plan" className="mb-1 text-sm font-medium tracking-wide text-ink-2 uppercase">
        Plan
      </h2>
      {!account ? (
        <p className="text-ink-3">Loading…</p>
      ) : (
        <>
          <p className="font-serif text-2xl text-ink">{PLAN_LABEL[account.plan]}</p>
          <p className="mt-1 text-ink-2">
            {left ?? (account.key ? "Your own OpenRouter key pays for everything you generate." : "No paper limit.")}
            {ends ? (account.cancelAtPeriodEnd ? ` Ends ${ends}.` : ` Renews ${ends}.`) : ""}
          </p>
          {!account.billing && <p className="mt-3 text-sm text-ink-3">Paid plans are coming soon. Until then there’s no limit.</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/pricing" className="btn-secondary h-9 px-4 text-sm">
              {account.plan === "free" ? "See plans" : "Change plan"}
            </Link>
            {account.canManageBilling && (
              <button type="button" onClick={() => void manage()} disabled={busy} className="btn-secondary h-9 px-4 text-sm disabled:opacity-50">
                {busy ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-accent-hover">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function KeySection({ account, onChange }: { account: Account | null; onChange: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const key = account?.key ?? null;

  async function onSave() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveKey(value.trim());
      setValue("");
      setMessage({
        kind: "ok",
        text: `Saved. ${saved.creditLeft === null ? "This key has no spending limit." : `${money(saved.creditLeft)} of credit left on it.`}`,
      });
      onChange();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setMessage(null);
    try {
      await removeKey();
      setMessage({ kind: "ok", text: "Key removed. Curio no longer has it." });
      onChange();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="key" className="rounded-xl border border-line bg-white p-6">
      <h2 id="key" className="mb-1 text-sm font-medium tracking-wide text-ink-2 uppercase">
        Your OpenRouter key
      </h2>
      <p className="mb-4 text-ink-2">
        Use your own <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">OpenRouter key</a> and
        generate as many papers as you like. It’s stored encrypted and used only for the calls listed under Usage below.
      </p>

      {key && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-paper-2 px-4 py-3">
          <code className="text-sm text-ink">sk-or-…{key.last4}</code>
          <span className="text-sm text-ink-3">added {new Date(key.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <button type="button" onClick={onRemove} disabled={busy} className="ml-auto text-sm text-ink-2 hover:text-ink disabled:opacity-50">
            Remove
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="openrouter-key" className="sr-only">
          OpenRouter key
        </label>
        <input
          id="openrouter-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={key ? "Paste a new key to replace it" : "sk-or-v1-…"}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-ink placeholder:text-ink-3"
        />
        <button type="submit" disabled={busy || !value.trim()} className="btn-primary h-11 px-5 disabled:opacity-50">
          {busy ? "Checking…" : key ? "Replace key" : "Save key"}
        </button>
      </form>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-3 text-sm ${message.kind === "error" ? "text-accent-hover" : "text-ink-2"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function UsageSection({ events }: { events: UsageEvent[] | null }) {
  const total = (events ?? []).reduce((n, e) => n + Number(e.cost_usd), 0);
  const yours = (events ?? []).filter((e) => e.key_source === "byok").reduce((n, e) => n + Number(e.cost_usd), 0);
  return (
    <section aria-labelledby="usage">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="usage" className="text-sm font-medium tracking-wide text-ink-2 uppercase">
          Usage
        </h2>
        {events && events.length > 0 && (
          <p className="text-sm text-ink-2">
            {money(total)} total{yours > 0 ? ` · ${money(yours)} on your key` : ""}
          </p>
        )}
      </div>
      {events === null ? (
        <p className="text-ink-3">Loading…</p>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-ink-2">No model calls yet. Upload a paper to get started.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-ink-3">
              <tr>
                <th className="px-4 py-2 font-normal">When</th>
                <th className="px-4 py-2 font-normal">What</th>
                <th className="px-4 py-2 font-normal">Model</th>
                <th className="px-4 py-2 text-right font-normal">Cost</th>
                <th className="px-4 py-2 font-normal">Paid by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-ink-2">
                    {new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {stepLabel(e.step)}
                    <span className="block truncate text-xs text-ink-3">{e.papers?.title || e.papers?.name || ""}</span>
                  </td>
                  <td className="px-4 py-2 text-ink-2">{e.model.split("/").pop()}</td>
                  <td className="px-4 py-2 text-right text-ink tabular-nums">{money(Number(e.cost_usd))}</td>
                  <td className="px-4 py-2 text-ink-2">{e.key_source === "byok" ? "Your key" : "Curio"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
