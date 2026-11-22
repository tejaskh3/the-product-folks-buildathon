"use client";

// The "Feedback" button, bottom-right on every page, and its panel: feedback, a feature request,
// or a paper for the library. Anyone can send one. It stays out of the way: hidden while another
// dialog is open, on pages that are mid-task (checkout return, sign-in), and on phones wherever a
// page marks itself data-no-floater="phone" (an open paper on /play, whose controls sit low).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useUser } from "@/components/auth/useUser";

type Kind = "feedback" | "feature" | "paper";

// Short labels on phones so all three fit at 360 px; the full name is always the accessible one.
const TABS: { kind: Kind; label: string; short: string }[] = [
  { kind: "feedback", label: "Feedback", short: "Feedback" },
  { kind: "feature", label: "Feature request", short: "Feature" },
  { kind: "paper", label: "Request a paper", short: "Paper" },
];

const MAX = 2000;
const HIDDEN_ON = ["/billing/return", "/sign-in", "/sign-up", "/sso-callback"];

type Status = { state: "idle" | "sending" } | { state: "sent" } | { state: "library"; title: string | null; href: string } | { state: "error"; message: string };

export function FeedbackFloater() {
  const pathname = usePathname();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("feedback");
  const [drafts, setDrafts] = useState<Record<Kind, string>>({ feedback: "", feature: "", paper: "" });
  const [arxiv, setArxiv] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [blocked, setBlocked] = useState({ modal: false, phone: false });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Watch the page for other dialogs and for the "not on phones here" marker.
  useEffect(() => {
    const check = () => {
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => el.id !== "feedback-dialog");
      const phone = !!document.querySelector('[data-no-floater="phone"]');
      setBlocked((b) => (b.modal === modal && b.phone === phone ? b : { modal, phone }));
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "data-no-floater"] });
    return () => mo.disconnect();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus the first field on opening, and the next step once something is sent.
  const step = status.state === "sent" || status.state === "library" ? status.state : "form";
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open, step]);

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || (blocked.modal && !open)) return null;

  // Keeps Tab inside the panel while it's open.
  function trap(e: ReactKeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])")).filter(
      (el) => el.tabIndex >= 0,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onTabKey(e: ReactKeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].kind;
    pick(next);
    document.getElementById(`feedback-tab-${next}`)?.focus();
  }

  function pick(k: Kind) {
    setKind(k);
    if (status.state !== "sending") setStatus({ state: "idle" });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setStatus({ state: "sending" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, message: drafts[kind], email: user ? undefined : email || undefined, arxiv: kind === "paper" ? arxiv : undefined, page: pathname }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; library?: { title: string | null; href: string } } | null;
      if (!res.ok) return setStatus({ state: "error", message: body?.error ?? "Couldn’t send that. Try again in a minute." });
      if (body?.library) return setStatus({ state: "library", title: body.library.title, href: body.library.href });
      setDrafts((d) => ({ ...d, [kind]: "" }));
      if (kind === "paper") setArxiv("");
      setStatus({ state: "sent" });
    } catch {
      setStatus({ state: "error", message: "Couldn’t reach Curio. Check your connection and try again." });
    }
  }

  const message = drafts[kind];
  const canSend = status.state !== "sending" && (kind === "paper" ? arxiv.trim().length > 0 : message.trim().length > 0);
  const field = "w-full rounded-xl bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]";
  const label = "block text-xs font-medium tracking-[0.08em] text-ink-3 uppercase";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "feedback-dialog" : undefined}
        className={`btn-secondary fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-9 gap-1.5 px-3.5 text-sm shadow-[0_8px_24px_-12px_rgb(26_25_23/0.35)] print:hidden ${
          blocked.phone ? "max-lg:hidden" : ""
        } ${open ? "invisible" : ""}`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 text-ink-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
        </svg>
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:justify-end sm:p-4">
          <button type="button" aria-label="Close" tabIndex={-1} onClick={close} className="absolute inset-0 bg-ink/30 sm:bg-ink/10" />
          <div
            ref={panelRef}
            id="feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            onKeyDown={trap}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:w-[26rem] sm:rounded-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id="feedback-title" className="font-serif text-xl text-ink">
                Tell us what you think
              </h2>
              <button type="button" onClick={close} className="shrink-0 rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink">
                Close
              </button>
            </div>

            <div role="tablist" aria-label="What are you sending?" className="flex gap-1 rounded-full bg-paper-2 p-1">
              {TABS.map((t, i) => (
                <button
                  key={t.kind}
                  id={`feedback-tab-${t.kind}`}
                  type="button"
                  role="tab"
                  aria-selected={kind === t.kind}
                  aria-controls="feedback-panel"
                  tabIndex={kind === t.kind ? 0 : -1}
                  onClick={() => pick(t.kind)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  aria-label={t.label}
                  className={`h-8 min-w-0 flex-auto rounded-full px-2.5 text-[13px] whitespace-nowrap ${kind === t.kind ? "bg-white text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:text-ink"}`}
                >
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            <div id="feedback-panel" role="tabpanel" aria-labelledby={`feedback-tab-${kind}`} className="mt-4">
              {status.state === "sent" ? (
                <div role="status">
                  <p className="text-[15px] text-ink">Thanks, we got it.</p>
                  <p className="mt-1 text-sm text-ink-2">
                    {kind === "paper" ? "We add the most-requested papers to the library first." : "We read every one."}
                  </p>
                  <div className="mt-5 flex gap-2">
                    <button type="button" data-autofocus onClick={() => setStatus({ state: "idle" })} className="btn-secondary h-10 px-4 text-sm">
                      Send another
                    </button>
                    <button type="button" onClick={close} className="btn-primary h-10 px-4 text-sm">
                      Done
                    </button>
                  </div>
                </div>
              ) : status.state === "library" ? (
                <div role="status">
                  <p className="text-[15px] text-ink">Good news: that one’s already in the library.</p>
                  <p className="mt-1 text-sm text-ink-2">It’s free to read, no request needed.</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link href={status.href} data-autofocus onClick={() => setOpen(false)} className="btn-primary h-10 max-w-full px-4 text-sm">
                      <span className="truncate">Open {status.title ?? "it"}</span>
                    </Link>
                    <button type="button" onClick={() => setStatus({ state: "idle" })} className="btn-secondary h-10 px-4 text-sm">
                      Request another
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={send} className="space-y-4">
                  {kind === "paper" && (
                    <div>
                      <label htmlFor="feedback-arxiv" className={label}>
                        arXiv link or ID
                      </label>
                      <input
                        id="feedback-arxiv"
                        data-autofocus
                        value={arxiv}
                        maxLength={300}
                        onChange={(e) => setArxiv(e.target.value)}
                        placeholder="arxiv.org/abs/1706.03762"
                        inputMode="url"
                        autoComplete="off"
                        className={`${field} mt-2 h-10`}
                      />
                      <p className="mt-1.5 text-xs text-ink-3">We add the most-requested papers to the library, free for everyone.</p>
                    </div>
                  )}
                  <div>
                    <label htmlFor="feedback-message" className={label}>
                      {kind === "feedback" ? "What’s on your mind?" : kind === "feature" ? "What should Curio do?" : "Why this one? (optional)"}
                    </label>
                    <textarea
                      id="feedback-message"
                      data-autofocus={kind === "paper" ? undefined : true}
                      value={message}
                      maxLength={MAX}
                      rows={kind === "paper" ? 2 : 4}
                      onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
                      placeholder={kind === "feedback" ? "What worked, what didn’t" : kind === "feature" ? "It would help if…" : "A line on why it’s worth adding"}
                      className={`${field} mt-2 resize-y py-2`}
                    />
                    {message.length > MAX - 200 && (
                      <p className="mt-1 text-right text-xs text-ink-3">
                        {message.length}/{MAX}
                      </p>
                    )}
                  </div>
                  {user === null && (
                    <div>
                      <label htmlFor="feedback-email" className={label}>
                        Email (optional)
                      </label>
                      <input
                        id="feedback-email"
                        type="email"
                        value={email}
                        maxLength={254}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="So we can reply"
                        autoComplete="email"
                        className={`${field} mt-2 h-10`}
                      />
                    </div>
                  )}
                  {status.state === "error" && (
                    <p role="alert" className="text-sm text-accent-hover">
                      {status.message}
                    </p>
                  )}
                  <button type="submit" disabled={!canSend} className="btn-primary h-10 w-full px-4 text-sm disabled:opacity-40">
                    {status.state === "sending" ? "Sending…" : "Send"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
