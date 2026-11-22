"use client";

// Shared pieces for the persona feed, the notification bell and the research page.
import Link from "next/link";
import { useEffect, useState } from "react";

export interface FeedItem {
  id: string;
  topic: string;
  kind: "article" | "finding";
  title: string;
  body: string;
  url: string | null;
  arxiv_id: string | null;
  origin: "sample" | "live";
  read: boolean;
  created_at: string;
}

export interface PersonaState {
  persona: { name: string; role: string; topics: string[] } | null;
  notifications: FeedItem[];
  unread: number;
}

export interface ResearchResult {
  topic: string;
  headline: string;
  articles: { title: string; source: string; date: string; url: string; summary: string; arxiv_id: string | null }[];
  findings: { title: string; what_is_new: string; why_it_matters: string; source_url: string; arxiv_id: string | null }[];
  saved?: boolean;
}

export async function fetchPersona(): Promise<PersonaState> {
  const res = await fetch("/api/persona", { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn’t load your feed.");
  return res.json();
}

export async function runResearch(topic: string, save: boolean): Promise<ResearchResult> {
  const res = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, save }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "The research agent failed. Try again.");
  return data;
}

export const explainHref = (arxiv: string) => `/play?arxiv=${encodeURIComponent(arxiv)}`;

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const STEPS = ["Searching the web…", "Reading sources…", "Comparing what’s new…", "Picking the top three…", "Writing it up…"];

/** Cycling status text while the research agent works (~30–60 s). */
export function useProgressText(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), 8000);
    return () => {
      clearInterval(t);
      setI(0); // start from the first step next time
    };
  }, [active]);
  return STEPS[i];
}

export function Spinner() {
  return <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-line border-t-accent" />;
}

export function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const cls = `rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-accent bg-accent-soft text-ink" : "border-line bg-white text-ink-2 hover:border-node"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} aria-pressed={!!active}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/** One feed item, in the bell dropdown (compact) or on the For you page. */
export function FeedCard({ item, compact }: { item: FeedItem; compact?: boolean }) {
  return (
    <article className={`rounded-xl border bg-white ${compact ? "border-transparent p-3 hover:border-line" : "border-line p-5"} ${!item.read && !compact ? "ring-1 ring-accent/30" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="rounded-full bg-paper-2 px-2 py-0.5 font-medium text-ink-2">{item.topic}</span>
        {item.origin === "live" && <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-white">LIVE</span>}
        <span>{item.kind === "finding" ? "New finding" : "Article"}</span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(item.created_at)}</span>
        {!item.read && <span aria-label="unread" className="ml-auto size-2 rounded-full bg-accent" />}
      </div>
      <h3 className={`mt-1.5 font-serif leading-snug text-ink ${compact ? "text-[15px]" : "text-lg"}`}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>
      <p className={`mt-1 text-ink-2 ${compact ? "line-clamp-2 text-[13px]" : "text-[15px] leading-relaxed"}`}>{item.body}</p>
      {item.arxiv_id && (
        <Link href={explainHref(item.arxiv_id)} className="mt-2 inline-block text-sm font-medium text-accent-hover hover:underline">
          Explain this paper →
        </Link>
      )}
    </article>
  );
}
