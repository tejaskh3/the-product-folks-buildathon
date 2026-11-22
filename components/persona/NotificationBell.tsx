"use client";

// The 🔔 in the header: unread count, and the latest items from the reader's persona feed.
// Opening it marks everything read. Polls every 30 s so live research results show up on their own.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedCard, fetchPersona, type PersonaState } from "./shared";

const POLL_MS = 30_000;

export function NotificationBell() {
  const [state, setState] = useState<PersonaState | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetchPersona().then(setState).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("curio:feed-changed", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("curio:feed-changed", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state?.unread) {
      // Keep the dots visible in this dropdown; the badge clears now and the server remembers.
      setState((s) => (s ? { ...s, unread: 0 } : s));
      fetch("/api/notifications", { method: "POST" }).catch(() => {});
    }
  };

  const unread = state?.unread ?? 0;
  const items = state?.notifications.slice(0, 8) ?? [];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-[18px] text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-serif text-lg text-ink">What’s new for you</span>
            {state?.persona && <span className="text-xs text-ink-3">{state.persona.topics.join(" · ")}</span>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {!state?.persona ? (
              <div className="p-4 text-sm text-ink-2">
                Tell Curio what you follow and it will keep you on the cutting edge.
                <Link href="/for-you" onClick={() => setOpen(false)} className="btn-primary mt-3 flex h-9 w-full items-center justify-center text-sm">
                  Set up your persona
                </Link>
              </div>
            ) : items.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">Nothing yet. Refresh live from your For you page.</p>
            ) : (
              items.map((n) => <FeedCard key={n.id} item={n} compact />)
            )}
          </div>
          {state?.persona && (
            <Link href="/for-you" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-3 text-center text-sm font-medium text-accent-hover hover:bg-paper">
              See all in For you →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
