"use client";

// Slide-out paper viewer. Renders the target page (plus neighbours) with
// react-pdf and highlights the cited quote inside the text layer.
// Import this with next/dynamic({ ssr: false }): pdf.js needs the browser.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { findQuoteRanges, highlightItem, type ItemRanges } from "@/lib/highlight";
import type { Highlight } from "@/lib/readingNotes";
import { usePaintHighlights } from "@/components/play/paintHighlights";
import { BookmarkButton } from "@/components/play/NotesPanel";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface PaperTarget {
  page: number;
  quote: string;
  label?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  title: string;
  target: PaperTarget | null;
  /** Signed in: the reader's page highlights and bookmarks. Selecting text on a page can highlight it. */
  reading?: {
    highlights: Highlight[];
    isBookmarked: (page: number) => boolean;
    toggleBookmark: (page: number) => void;
  };
}

const EASE = [0.3, 0, 0.2, 1] as const;

export default function PaperPanel({ open, onClose, pdfUrl, title, target, reading }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(560);
  // Highlight ranges per page, tagged with the target they were computed for.
  const [rangeState, setRangeState] = useState<{ key: string; byPage: Record<number, ItemRanges> }>({ key: "", byPage: {} });
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrolledFor = useRef<string>("");

  const isDesktop = useIsDesktop();
  const targetKey = target ? `${target.page}|${target.quote}` : "";

  const ranges = useMemo(() => (rangeState.key === targetKey ? rangeState.byPage : {}), [rangeState, targetKey]);

  // Track the panel's inner width so pages fit exactly.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, Math.floor(el.clientWidth - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Esc closes; focus the close button on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const page = target ? Math.min(Math.max(1, target.page), numPages || target.page) : 1;
  const pages = numPages ? [page - 1, page, page + 1].filter((p) => p >= 1 && p <= numPages) : [];

  const onText = useCallback(
    (pageNumber: number, items: string[]) => {
      if (!target) return;
      const r = findQuoteRanges(items, target.quote);
      setRangeState((prev) => ({
        key: targetKey,
        byPage: { ...(prev.key === targetKey ? prev.byPage : {}), [pageNumber]: r },
      }));
    },
    [target, targetKey],
  );

  // Once every rendered page has been searched: did we find the quote? (null = still searching)
  const found = !pages.length || pages.some((p) => !(p in ranges)) ? null : pages.some((p) => ranges[p].size > 0);

  const scrollToHighlight = useCallback(() => {
    if (scrolledFor.current === targetKey) return;
    const mark = bodyRef.current?.querySelector("mark.curio-hl");
    if (mark) {
      scrolledFor.current = targetKey;
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [targetKey]);

  // If there is no match, still land on the target page.
  useEffect(() => {
    if (found === false) {
      bodyRef.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: "start" });
    }
  }, [found, page]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-ink/15 lg:bg-ink/5"
          />
          <motion.aside
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label="The paper"
            initial={isDesktop ? { x: "100%" } : { y: "100%" }}
            animate={isDesktop ? { x: 0 } : { y: 0 }}
            exit={isDesktop ? { x: "100%" } : { y: "100%" }}
            transition={{ duration: 0.35, ease: EASE }}
            className="fixed z-50 flex flex-col bg-white shadow-[0_0_0_1px_var(--color-line),0_24px_64px_-24px_rgb(26_25_23/0.35)] max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[85dvh] max-lg:rounded-t-2xl lg:inset-y-0 lg:right-0 lg:w-[44vw] lg:min-w-[480px]"
          >
            <header className="border-b border-line px-5 pt-4 pb-4">
              <div className="flex items-center gap-3">
                <span className="truncate text-sm text-ink-3">{title}</span>
                <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 font-mono text-xs text-ink-2">p. {page}</span>
                {reading && <BookmarkButton what="page" on={reading.isBookmarked(page)} onToggle={() => reading.toggleBookmark(page)} />}
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close paper"
                  className="ml-auto rounded-md p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {target?.quote && (
                <blockquote className="mt-3 border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink-2">
                  {target.label && <span className="mb-1 block text-xs font-medium tracking-wide text-ink-3 uppercase">{target.label}</span>}
                  &ldquo;{target.quote}&rdquo;
                  {found === false && <span className="mt-1 block text-xs text-ink-3">Exact passage not located in the text layer; showing page {page}.</span>}
                </blockquote>
              )}
            </header>

            <div ref={bodyRef} className="flex-1 overflow-y-auto bg-paper-2 px-4 py-4">
              <style>{`
                .curio-pdf .textLayer { opacity: 1; }
                .curio-pdf .textLayer span { color: transparent; }
                .curio-pdf mark.curio-hl {
                  color: transparent;
                  background: rgb(229 112 47 / 0.22);
                  box-shadow: 0 2px 0 0 var(--color-accent);
                  border-radius: 2px;
                  animation: curio-hl-in 600ms ease-out both;
                }
                @keyframes curio-hl-in { from { background: rgb(229 112 47 / 0); box-shadow: none; } }
                @media (prefers-reduced-motion: reduce) { .curio-pdf mark.curio-hl { animation: none; } }
              `}</style>
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<PageSkeleton />}
                error={<p className="p-6 text-sm text-ink-2">Couldn&rsquo;t load the paper.</p>}
                className="curio-pdf space-y-4"
              >
                {pages.map((p) => (
                  <PageBox key={`${targetKey}-${p}`} page={p} highlights={reading?.highlights}>
                    <Page
                      pageNumber={p}
                      width={width}
                      renderAnnotationLayer={false}
                      loading={<PageSkeleton />}
                      onGetTextSuccess={(tc) => onText(p, tc.items.map((it) => ("str" in it ? it.str : "")))}
                      customTextRenderer={(item) => highlightItem(item.str, ranges[p]?.get(item.itemIndex))}
                      onRenderTextLayerSuccess={scrollToHighlight}
                    />
                  </PageBox>
                ))}
              </Document>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** One rendered page: a place for bookmarks and highlights (data-place-*), with the reader's highlights painted on. */
function PageBox({ page, highlights, children }: { page: number; highlights?: Highlight[]; children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const marks = (highlights ?? []).filter((h) => h.target === String(page)).map((h) => ({ quote: h.quote, color: h.color }));
  usePaintHighlights(el, marks);
  return (
    <div
      ref={setEl}
      data-page={page}
      {...(highlights ? { "data-place-kind": "page", "data-place-target": String(page) } : {})}
      className="mx-auto w-fit overflow-hidden rounded-md bg-white shadow-[0_0_0_1px_var(--color-line)]"
    >
      {children}
    </div>
  );
}

function PageSkeleton() {
  return <div className="mx-auto aspect-[8.5/11] w-full max-w-[560px] animate-pulse rounded-md bg-white motion-reduce:animate-none" />;
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}
