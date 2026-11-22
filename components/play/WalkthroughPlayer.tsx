"use client";

import { useEffect, useRef, useState } from "react";
import { STAGE_LABEL } from "./QuestionTree";
import type { PlanScene } from "./useExploreStore";

/** Segmented progress bar: one segment per scene, grouped and labelled by stage. */
export function WalkthroughProgress({
  scenes,
  current,
  onGo,
}: {
  scenes: PlanScene[];
  current: number;
  onGo: (index: number) => void;
}) {
  const groups: { stage: PlanScene["stage"]; items: { scene: PlanScene; index: number }[] }[] = [];
  scenes.forEach((scene, index) => {
    const last = groups[groups.length - 1];
    if (last && last.stage === scene.stage) last.items.push({ scene, index });
    else groups.push({ stage: scene.stage, items: [{ scene, index }] });
  });

  return (
    <nav aria-label="Walkthrough progress" className="min-w-0">
      <ol className="flex min-w-0 gap-1.5">
        {groups.map((g) => (
          <li key={`${g.stage}-${g.items[0].index}`} className="min-w-0" style={{ flex: g.items.length }}>
            <div className="flex gap-1">
              {g.items.map(({ scene, index }) => {
                const state = index === current ? "current" : index < current ? "seen" : "ahead";
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => onGo(index)}
                    aria-label={`Scene ${index + 1}: ${scene.title}`}
                    aria-current={state === "current" ? "step" : undefined}
                    className="group flex-1 py-2"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-colors ${
                        state === "current"
                          ? "bg-accent"
                          : scene.status !== "ready"
                            ? "animate-pulse bg-line motion-reduce:animate-none"
                            : state === "seen"
                              ? "bg-ink/70 group-hover:bg-ink"
                              : "bg-node/60 group-hover:bg-node"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <p
              className={`hidden truncate text-[11px] tracking-[0.06em] uppercase sm:block ${
                g.items.some((it) => it.index === current) ? "text-ink" : "text-ink-3"
              }`}
            >
              {STAGE_LABEL[g.stage] ?? g.stage}
            </p>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Back / Next controls. Next gently pulses once the scene has had time to play. */
export function SceneNav({
  index,
  total,
  onBack,
  onNext,
  nudge,
}: {
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  nudge: boolean;
}) {
  const last = index >= total - 1;
  return (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onBack} disabled={index === 0} className="btn-secondary h-10 px-4 text-sm disabled:opacity-40">
        ← Back
      </button>
      <span className="font-mono text-xs text-ink-3 tabular-nums">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={last}
        className="btn-primary relative h-10 px-5 text-sm disabled:opacity-40"
      >
        {nudge && !last && (
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-[inherit] bg-accent/40 motion-reduce:hidden" />
        )}
        <span className="relative">{last ? "End of walkthrough" : "Next scene →"}</span>
      </button>
    </div>
  );
}

/** Free-text question box, scoped to whatever the reader is looking at. */
export function AskBox({
  context,
  onAsk,
  prefill,
}: {
  context: string;
  onAsk: (q: string) => void;
  /** "Ask Curio" on selected text: start the question with it. `n` changes on every request. */
  prefill?: { text: string; n: number } | null;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // A new prefill replaces whatever was typed (set while rendering, not in an effect).
  const [seen, setSeen] = useState<number | null>(null);
  if (prefill && prefill.n !== seen) {
    setSeen(prefill.n);
    setQ(prefill.text);
  }
  useEffect(() => {
    if (!prefill) return;
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }, [prefill]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = q.trim();
        if (!text) return;
        onAsk(text);
        setQ("");
      }}
      className="rounded-2xl border border-line bg-white p-3"
    >
      <label htmlFor="ask" className="block truncate px-1 text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
        Ask about {context}
      </label>
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          id="ask"
          value={q}
          maxLength={220}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Why does this beat the previous approach?"
          className="h-10 min-w-0 flex-1 rounded-xl bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]"
        />
        <button type="submit" disabled={!q.trim()} className="btn-primary h-10 shrink-0 px-4 text-sm disabled:opacity-40">
          Ask
        </button>
      </div>
      <p className="mt-2 px-1 text-xs text-ink-3">Answered as a diagram, right here. It stays in the list on the left.</p>
    </form>
  );
}
