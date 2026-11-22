"use client";

import { useEffect, useRef } from "react";
import type { Question } from "@/lib/types";

interface Props {
  questions: Question[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Numbered list of questions (lg+), horizontally scrolling chips below lg. */
export function QuestionRail({ questions, activeId, onSelect }: Props) {
  const chipsRef = useRef<HTMLDivElement>(null);

  // Keep the active chip in view on mobile.
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>(`[data-qid="${CSS.escape(activeId)}"]`);
    if (!row || !chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollTo({ left, behavior: "smooth" });
    else if (row.scrollLeft < right) row.scrollTo({ left: right, behavior: "smooth" });
  }, [activeId]);

  return (
    <nav aria-label="Questions in this paper" className="min-w-0">
      {/* Desktop: vertical numbered list */}
      <div className="hidden lg:block">
        <p className="px-3 text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">Questions</p>
        <ol className="mt-3 space-y-1">
          {questions.map((q, i) => {
            const active = q.id === activeId;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onSelect(q.id)}
                  aria-current={active ? "true" : undefined}
                  className={`group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 ${active ? "bg-paper-2" : "hover:bg-paper-2/70"}`}
                >
                  <Num n={i + 1} active={active} />
                  <span className="min-w-0">
                    <span className={`block text-[15px] leading-snug ${active ? "text-ink" : "text-ink-2 group-hover:text-ink"}`}>
                      {q.title}
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-ink-3">{q.hook}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Mobile: chips row */}
      <div
        ref={chipsRef}
        className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden [&::-webkit-scrollbar]:hidden"
      >
        {questions.map((q, i) => {
          const active = q.id === activeId;
          return (
            <button
              key={q.id}
              type="button"
              data-qid={q.id}
              onClick={() => onSelect(q.id)}
              aria-current={active ? "true" : undefined}
              className={`flex max-w-[16rem] shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-sm transition-colors duration-150 ${active ? "border-ink bg-paper-2 text-ink" : "border-line text-ink-2 hover:border-node"}`}
            >
              <Num n={i + 1} active={active} small />
              <span className="truncate">{q.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Num({ n, active, small }: { n: number; active: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full text-xs tabular-nums transition-colors duration-150 ${small ? "size-6" : "mt-px size-6"} ${active ? "bg-accent text-ink" : "border border-line text-ink-3"}`}
    >
      {n}
    </span>
  );
}
