"use client";

import type { Takeaway } from "@/lib/walkthrough";

/** "In plain words": the longer explanation under a scene's narration. */
export function PlainWords({ text }: { text: string }) {
  return (
    <div className="mt-4 max-w-prose border-l-2 border-accent/60 pl-4">
      <p className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">In plain words</p>
      <p className="mt-1.5 text-[16px] leading-relaxed text-ink">{text}</p>
    </div>
  );
}

/** Where the scene comes from: section, page and the verbatim passage. */
export function SourceNote({
  section,
  pages,
  quote,
  onShow,
}: {
  section?: string;
  pages: number[];
  quote: string;
  onShow: () => void;
}) {
  const page = pages.length ? `p. ${pages.join(", ")}` : null;
  const where = [section, page].filter(Boolean).join(" · ");
  return (
    <aside aria-label="Source" className="min-w-0 rounded-2xl border border-line bg-paper-2 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
          From the paper{where && <span className="tracking-normal normal-case"> · {where}</span>}
        </p>
        <button type="button" onClick={onShow} className="shrink-0 text-sm text-accent-hover underline-offset-4 hover:underline">
          Show in paper →
        </button>
      </div>
      {quote && <blockquote className="mt-2 font-serif text-[15px] leading-relaxed text-ink-2 italic">“{quote}”</blockquote>}
    </aside>
  );
}

/** Closing card: the ideas worth keeping, each with a challenge in the scene where it can be tried. */
export function KeyIdeas({
  takeaways,
  sceneLabel,
  onTry,
  citation,
}: {
  takeaways: Takeaway[];
  sceneLabel: (sceneId: string) => string | null;
  onTry: (sceneId: string) => void;
  citation?: string;
}) {
  return (
    <section
      id="key-ideas"
      aria-labelledby="key-ideas-title"
      className="scroll-mt-20 rounded-2xl border border-line bg-white px-5 py-6 shadow-[0_1px_0_var(--color-line),0_24px_48px_-36px_rgb(26_25_23/0.22)] sm:px-8 sm:py-7"
    >
      <p className="text-xs font-medium tracking-[0.08em] text-accent uppercase">End of walkthrough</p>
      <h2 id="key-ideas-title" className="mt-1 font-serif text-2xl leading-snug tracking-[-0.01em] text-ink sm:text-3xl">
        Key ideas — try it yourself
      </h2>
      <ol className="mt-5 space-y-3">
        {takeaways.map((t, i) => {
          const label = sceneLabel(t.sceneId);
          return (
            <li key={i} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-xl bg-paper-2 px-4 py-3.5">
              <span className="font-mono text-sm text-accent tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[16px] leading-snug font-medium text-ink">{t.idea}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
                  <span className="font-medium text-ink">Try it: </span>
                  {t.tryIt}
                </p>
                {label && (
                  <button type="button" onClick={() => onTry(t.sceneId)} className="btn-secondary mt-2.5 h-8 max-w-full px-3 text-sm">
                    <span className="truncate">Go to {label} →</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {citation && <p className="mt-6 border-t border-line pt-4 text-sm leading-relaxed text-ink-3">Source: {citation}</p>}
    </section>
  );
}
