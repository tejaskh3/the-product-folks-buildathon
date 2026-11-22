"use client";

import { useId, useState } from "react";
import { PRODUCT_NAME } from "./site";

const TOKENS = ["The", "cat", "sat", "on", "the", "red", "mat"];

// Hand-tuned attention weights: mostly local, with a few long-range links.
function weight(i: number, j: number) {
  const links: Record<string, number> = { "2-1": 0.9, "6-5": 0.8, "6-2": 0.55, "4-6": 0.5, "1-0": 0.6 };
  return links[`${i}-${j}`] ?? Math.max(0.08, 0.7 - Math.abs(i - j) * 0.22);
}

const QUESTIONS = [
  "Why does attention scale quadratically?",
  "What does one head actually look at?",
  "Why divide by the square root of d?",
];

export function Example() {
  const [paperOpen, setPaperOpen] = useState(true);
  const [hover, setHover] = useState<[number, number]>([2, 1]);
  const panelId = useId();

  const n = TOKENS.length;

  return (
    <section id="example" aria-labelledby="example-title" className="scroll-mt-8 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid gap-6 md:grid-cols-12 md:items-end">
          <h2 id="example-title" className="font-serif text-4xl leading-tight tracking-[-0.02em] text-ink sm:text-5xl md:col-span-6">
            What comes back
          </h2>
          <p className="max-w-md leading-relaxed text-ink-2 md:col-span-6 md:justify-self-end">
            Here is one question from <cite className="not-italic text-ink">Attention Is All You Need</cite>. Hover the
            grid, or tab to it and use the arrow keys, to see which word looks at which. The passage it came from stays open beside it.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_0_var(--color-line),0_24px_48px_-32px_rgb(26_25_23/0.25)]">
          {/* Window bar */}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <span className="shrink-0 font-serif text-base text-ink">{PRODUCT_NAME}</span>
              <span className="truncate text-ink-2">Attention Is All You Need</span>
            </div>
            <button
              type="button"
              onClick={() => setPaperOpen((v) => !v)}
              aria-expanded={paperOpen}
              aria-controls={panelId}
              className="btn-secondary h-8 shrink-0 px-3 text-sm"
            >
              {paperOpen ? "Hide paper" : "Show paper"}
            </button>
          </div>

          <div className={`relative ${paperOpen ? "md:min-h-[520px]" : ""}`}>
            {/* Diagram side */}
            <div className={`p-5 transition-[padding] duration-500 sm:p-8 ${paperOpen ? "md:pr-[calc(40%+2rem)]" : ""}`}>
              <ul className="flex flex-wrap gap-2" aria-label="Questions found in this paper">
                {QUESTIONS.map((q, i) => (
                  <li
                    key={q}
                    className={`rounded-full border px-3 py-1.5 text-sm ${i === 0 ? "border-ink text-ink" : "border-line text-ink-2"}`}
                  >
                    {q}
                  </li>
                ))}
              </ul>

              <div className="mt-6 rounded-xl border border-line p-5 sm:p-6">
                <h3 className="font-serif text-2xl leading-snug text-ink">Why does attention scale quadratically?</h3>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">
                  Every word compares itself with every other word, so {n} words make {n} × {n} = {n * n} comparisons.
                  Double the words and the grid grows four times.
                </p>

                <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
                  <div
                    tabIndex={0}
                    role="application"
                    aria-roledescription="attention grid"
                    aria-label="Attention between words. Use the arrow keys to move between cells."
                    className="grid w-fit shrink-0 grid-cols-[2.75rem_repeat(7,1.5rem)] gap-1 rounded-lg p-1 sm:grid-cols-[3.25rem_repeat(7,1.75rem)]"
                    onMouseLeave={() => setHover([2, 1])}
                    onKeyDown={(e) => {
                      const moves: Record<string, [number, number]> = {
                        ArrowUp: [-1, 0],
                        ArrowDown: [1, 0],
                        ArrowLeft: [0, -1],
                        ArrowRight: [0, 1],
                      };
                      const d = moves[e.key];
                      if (!d) return;
                      e.preventDefault();
                      const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
                      setHover(([i, j]) => [clamp(i + d[0]), clamp(j + d[1])]);
                    }}
                  >
                    <span />
                    {TOKENS.map((t, j) => (
                      <span
                        key={`c${j}`}
                        aria-hidden="true"
                        className={`truncate text-center text-[10px] sm:text-[11px] ${hover[1] === j ? "font-medium text-ink" : "text-ink-2"}`}
                      >
                        {t}
                      </span>
                    ))}
                    {TOKENS.map((row, i) => (
                      <div key={`r${i}`} className="contents" aria-hidden="true">
                        <span className={`self-center pr-1 text-right text-xs ${hover[0] === i ? "font-medium text-ink" : "text-ink-2"}`}>
                          {row}
                        </span>
                        {TOKENS.map((_, j) => {
                          const active = hover[0] === i && hover[1] === j;
                          const inCross = hover[0] === i || hover[1] === j;
                          return (
                            <span
                              key={j}
                              onMouseEnter={() => setHover([i, j])}
                              className={`size-6 rounded-[5px] transition-[box-shadow,transform] duration-150 sm:size-7 ${active ? "scale-110 ring-2 ring-ink ring-offset-2" : ""} ${!active && inCross ? "ring-1 ring-ink/25" : ""}`}
                              style={{ backgroundColor: `rgb(26 25 23 / ${weight(i, j)})` }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                    <p className="leading-relaxed text-ink-2">
                        <span className="text-ink">“{TOKENS[hover[0]]}”</span> looks at{" "}
                        <span className="text-ink">“{TOKENS[hover[1]]}”</span> with weight{" "}
                        <span className="text-ink tabular-nums">{weight(hover[0], hover[1]).toFixed(2)}</span>.
                    </p>
                    <svg viewBox="0 0 200 110" className="mt-4 h-auto w-full max-w-[260px]" role="img" aria-label="Comparisons grow as n squared, much faster than the straight line n">
                      <path d="M20 94 H192 M20 94 V8" fill="none" stroke="var(--color-node)" strokeWidth={1} />
                      <path d="M20 94 L188 58" fill="none" stroke="var(--color-node)" strokeWidth={1.5} />
                      <path d="M20 94 Q130 92 180 12" fill="none" stroke="var(--color-ink)" strokeWidth={1.75} />
                      <circle cx={112} cy={74} r={4} fill="white" stroke="var(--color-ink)" strokeWidth={1.5} />
                      <g fontSize={11} fill="var(--color-ink-2)" style={{ fontFamily: "var(--font-sans)" }}>
                        <text x={170} y={54}>n</text>
                        <text x={160} y={12}>n²</text>
                        <text x={20} y={108}>words</text>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Paper panel */}
            <aside
              id={panelId}
              aria-label="Original paper"
              className={`border-line bg-paper-2 max-md:border-t md:absolute md:inset-y-0 md:right-0 md:w-[40%] md:border-l md:transition-transform md:duration-500 md:ease-[cubic-bezier(.3,0,.2,1)] ${paperOpen ? "md:translate-x-0" : "max-md:hidden md:translate-x-full"}`}
              inert={!paperOpen}
            >
              <div className="h-full overflow-hidden p-5 sm:p-8">
                <p className="text-sm text-ink-2">Section 4</p>
                <h3 className="mt-1 font-serif text-xl text-ink">Why Self-Attention</h3>
                <div className="mt-5 space-y-2.5" aria-hidden="true">
                  {[100, 94, 97, 62].map((w, i) => (
                    <div key={i} className="h-2 rounded-full bg-line" style={{ width: `${w}%` }} />
                  ))}
                </div>
                <blockquote className="mt-5 border-l-2 border-ink bg-white py-3 pr-3 pl-4 font-serif text-[17px] leading-relaxed text-ink">
                  A self-attention layer connects all positions with a constant number of sequentially executed
                  operations, whereas a recurrent layer requires O(n) sequential operations.
                </blockquote>
                <div className="mt-5 space-y-2.5" aria-hidden="true">
                  {[96, 100, 88, 99, 70, 93, 45].map((w, i) => (
                    <div key={i} className="h-2 rounded-full bg-line" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
