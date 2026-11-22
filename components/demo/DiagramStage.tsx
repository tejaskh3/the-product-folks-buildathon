"use client";

import Link from "next/link";

import { AnimatePresence, motion } from "motion/react";
import { AgentsWorking } from "@/components/live/AgentsWorking";
import type { Diagram, Explorable } from "@/lib/types";
import { DiagramFrame } from "./DiagramFrame";

export type LiveStage = "reading" | "drawing" | "checking";

export interface Crumb {
  key: string;
  label: string;
}

/** What the explain card says about going one level deeper on the selected part. */
export type DeeperStatus =
  | { kind: "showing" }
  | { kind: "available"; onGo: () => void }
  | { kind: "needs-code"; onGo: () => void }
  | { kind: "elsewhere"; href: string }
  | { kind: "running"; stage: LiveStage; onCancel: () => void }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "none" };

interface Props {
  crumbs: Crumb[];
  onNavigate: (index: number) => void;
  diagram: Diagram;
  onExplore: (id: string) => void;
  onShowInPaper: () => void;
  selected: Explorable | null;
  onOpenSelectedInPaper: () => void;
  deeper: DeeperStatus;
  /** Label of the part being drawn live, shown as a pending breadcrumb. */
  pendingLabel?: string;
}

const EASE = [0.3, 0, 0.2, 1] as const;

export function DiagramStage({
  crumbs,
  onNavigate,
  diagram,
  onExplore,
  onShowInPaper,
  selected,
  onOpenSelectedInPaper,
  deeper,
  pendingLabel,
}: Props) {
  const running = deeper.kind === "running" ? deeper : null;

  return (
    <div className="min-w-0 space-y-4">
      <section
        aria-labelledby="diagram-title"
        className="rounded-2xl border border-line bg-white shadow-[0_1px_0_var(--color-line),0_24px_48px_-36px_rgb(26_25_23/0.22)]"
      >
        <div className="px-5 pt-5 sm:px-8 sm:pt-7">
          <Breadcrumb crumbs={crumbs} onNavigate={onNavigate} pendingLabel={running ? pendingLabel : undefined} />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <h1 id="diagram-title" className="font-serif text-2xl leading-snug tracking-[-0.01em] text-ink sm:text-[28px]">
              {diagram.title}
            </h1>
            <button type="button" onClick={onShowInPaper} className="btn-secondary h-9 shrink-0 gap-2 self-start px-3.5 text-sm">
              <PageIcon />
              Show in paper
            </button>
          </div>
        </div>

        <div className="mt-5 px-3 sm:px-6">
          <AnimatePresence mode="wait" initial={false}>
            {running ? (
              <motion.div
                key="working"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex min-h-[360px] flex-col items-center justify-center rounded-xl bg-paper-2 px-4 py-10"
              >
                <AgentsWorking stage={running.stage} />
                <button
                  type="button"
                  onClick={running.onCancel}
                  className="mt-6 rounded-md px-2 py-1 text-sm text-ink-3 underline-offset-4 transition-colors hover:text-ink hover:underline"
                >
                  Cancel
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={diagram.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <DiagramFrame diagram={diagram} onExplore={onExplore} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-line px-5 py-5 sm:px-8">
          <p className="max-w-prose text-[15px] leading-relaxed text-ink-2">{diagram.caption}</p>
          {diagram.tryHint && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink-3">
              <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
              {diagram.tryHint}
            </p>
          )}
        </div>
      </section>

      <ExplainCard selected={selected} onOpenInPaper={onOpenSelectedInPaper} deeper={deeper} />
    </div>
  );
}

function Breadcrumb({
  crumbs,
  onNavigate,
  pendingLabel,
}: {
  crumbs: Crumb[];
  onNavigate: (i: number) => void;
  pendingLabel?: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1 && !pendingLabel;
          return (
            <li key={c.key} className="flex min-w-0 items-center gap-1">
              {i > 0 && <Chevron />}
              {last ? (
                <span aria-current="page" className="truncate px-1 text-ink">
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(i)}
                  className="truncate rounded-md px-1 text-ink-3 transition-colors hover:text-ink"
                >
                  {c.label}
                </button>
              )}
            </li>
          );
        })}
        {pendingLabel && (
          <li className="flex min-w-0 items-center gap-1">
            <Chevron />
            <span className="truncate px-1 text-ink-3 italic">{pendingLabel}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function ExplainCard({
  selected,
  onOpenInPaper,
  deeper,
}: {
  selected: Explorable | null;
  onOpenInPaper: () => void;
  deeper: DeeperStatus;
}) {
  return (
    <section aria-label="Explanation" aria-live="polite" className="rounded-2xl border border-line bg-white px-5 py-5 sm:px-8 sm:py-6">
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div
            key={selected.id + selected.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="flex items-center gap-2 font-serif text-xl text-ink">
                <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                {selected.label}
              </h2>
              <button
                type="button"
                onClick={onOpenInPaper}
                className="rounded-md text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
              >
                Open in paper{selected.pages[0] ? `, p. ${selected.pages[0]}` : ""}
              </button>
            </div>
            <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-2">{selected.blurb}</p>
            <DeeperLine deeper={deeper} label={selected.label} />
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 text-sm text-ink-3"
          >
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
            Click any orange part of the diagram to see what it means and where the paper says it.
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

function DeeperLine({ deeper, label }: { deeper: DeeperStatus; label: string }) {
  const base = "mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-sm";
  switch (deeper.kind) {
    case "none":
      return null;
    case "showing":
      return (
        <p className={`${base} text-ink-3`}>
          <span aria-hidden="true">↳</span> You&rsquo;re looking at the deeper diagram for {label}.
        </p>
      );
    case "available":
      return (
        <div className={base}>
          <span className="text-ink-3">There&rsquo;s a deeper diagram for {label}.</span>
          <button type="button" onClick={deeper.onGo} className="btn-secondary h-8 px-3 text-sm">
            Go deeper
          </button>
        </div>
      );
    case "needs-code":
      return (
        <div className={base}>
          <span className="text-ink-3">No saved diagram goes deeper here yet. Curio can draw one now.</span>
          <button type="button" onClick={deeper.onGo} className="btn-primary h-8 px-3.5 text-sm">
            Go deeper live
          </button>
        </div>
      );
    case "elsewhere":
      return (
        <div className={base}>
          <span className="text-ink-3">No saved diagram goes deeper here yet. Open the paper in Play to explore further.</span>
          <Link href={deeper.href} className="btn-primary h-8 px-3.5 text-sm">
            Explore in Play
          </Link>
        </div>
      );
    case "running":
      return (
        <p className={`${base} text-ink-3`}>
          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          Claude is {deeper.stage === "reading" ? "reading the paper" : deeper.stage === "drawing" ? "drawing the diagram" : "checking it against the paper"}…
        </p>
      );
    case "error":
      return (
        <div className={base} role="alert">
          <span className="text-ink-2">{deeper.message}</span>
          <button type="button" onClick={deeper.onRetry} className="btn-secondary h-8 px-3 text-sm">
            Try again
          </button>
        </div>
      );
  }
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-node" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />
      <path d="M6 8h4.5M6 10.5h3" stroke="var(--color-accent)" strokeWidth={1.25} strokeLinecap="round" />
    </svg>
  );
}
