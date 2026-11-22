"use client";

// The signed-in reader's shelf on the /play upload screen: Library · My papers · Favorites ·
// Bookmarks · History. Everything except Library is private to them.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getShelf, type Shelf as ShelfData, type ShelfPaper } from "@/lib/readingClient";
import { placeHash } from "@/lib/readingNotes";

type Tab = "library" | "mine" | "favorites" | "bookmarks" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "mine", label: "My papers" },
  { id: "favorites", label: "Favorites" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "history", label: "History" },
];

const EMPTY: Record<Tab, string> = {
  library: "The library is being stocked.",
  mine: "Papers you bring appear here.",
  favorites: "Star a paper while reading it to keep it here.",
  bookmarks: "Bookmark a scene, an answer or a page to find it again.",
  history: "Papers you open appear here.",
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export function Shelf() {
  const [shelf, setShelf] = useState<ShelfData | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ library: null, mine: null, favorites: null, bookmarks: null, history: null });

  useEffect(() => {
    let live = true;
    getShelf()
      .then((s) => live && setShelf(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return null;
  // Until they choose: their own papers if they have any, else the library.
  const tab: Tab = picked ?? (shelf?.mine.length ? "mine" : "library");

  function onKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length].id;
    setPicked(t);
    tabRefs.current[t]?.focus();
  }

  const count = (t: Tab) => (shelf ? shelf[t].length : 0);

  return (
    <section aria-label="Your shelf" className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
      <div role="tablist" aria-label="Shelf" onKeyDown={onKey} className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            role="tab"
            id={`shelf-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="shelf-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setPicked(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-ink text-white" : "text-ink-2 hover:bg-paper-2 hover:text-ink"}`}
          >
            {t.label}
            {count(t.id) > 0 && <span className={`ml-1.5 ${tab === t.id ? "text-white/70" : "text-ink-3"}`}>{count(t.id)}</span>}
          </button>
        ))}
      </div>

      <div id="shelf-panel" role="tabpanel" aria-labelledby={`shelf-tab-${tab}`}>
        {!shelf ? (
          <div className="h-24 animate-pulse rounded-xl bg-paper-2 motion-reduce:animate-none" />
        ) : shelf[tab].length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-4 text-sm text-ink-3">
            {EMPTY[tab]}
            {tab === "library" || tab === "mine" ? null : (
              <>
                {" "}
                <button type="button" onClick={() => setPicked("library")} className="text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                  Browse the library
                </button>
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {tab === "library"
              ? shelf.library.map((p) => (
                  <Row key={p.id} href={`/play/${p.id}`} title={p.title || "Untitled paper"} meta={[p.authors, p.year].filter(Boolean).join(" · ")} />
                ))
              : tab === "bookmarks"
                ? shelf.bookmarks.map((b) => (
                    <Row
                      key={b.id}
                      href={`/play/${b.paper.id}${placeHash(b.kind, b.target)}`}
                      title={b.label || (b.kind === "page" ? `Page ${b.target}` : "Bookmark")}
                      meta={b.paper.title || b.paper.name || "Untitled paper"}
                    />
                  ))
                : (shelf[tab] as ShelfPaper[]).map((p) => <Row key={p.id} href={`/play/${p.id}`} title={p.title || p.name || "Untitled paper"} meta={day(p.at)} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({ href, title, meta }: { href: string; title: string; meta: string }) {
  return (
    <li>
      <Link href={href} className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-accent-soft/60">
        <span className="min-w-0 truncate text-ink">{title}</span>
        {meta && <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-2">{meta}</span>}
      </Link>
    </li>
  );
}
