"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ExploreNode, SceneStage } from "@/lib/walkthrough";
import { childrenOf, type Cursor, type PlanScene } from "./useExploreStore";

export const STAGE_LABEL: Record<SceneStage, string> = {
  problem: "The problem",
  prior: "Before this",
  idea: "Key idea",
  method: "How it works",
  results: "Results",
  limits: "The catch",
};

interface Props {
  scenes: PlanScene[];
  nodes: ExploreNode[];
  cursor: Cursor | null;
  onGo: (c: Cursor) => void;
  suggestions: { title: string; hook: string }[] | null;
  suggestError: boolean;
  onSuggest: (title: string) => void;
  walkLoading: boolean;
  /** Opens the closing "Key ideas" card; omitted when the walkthrough has none. */
  onKeyIdeas?: () => void;
}

/** Left rail: the walkthrough's scenes with every question nested under where it was asked. */
export function QuestionTree({ scenes, nodes, cursor, onGo, suggestions, suggestError, onSuggest, walkLoading, onKeyIdeas }: Props) {
  const paperLevel = childrenOf(nodes, null);
  const asked = new Set(nodes.map((n) => n.title));
  const isActive = (kind: Cursor["kind"], id: string) => cursor?.kind === kind && cursor.id === id;

  return (
    <div className="min-w-0 space-y-7">
      <nav aria-label="Walkthrough" className="min-w-0">
        <SectionLabel>Walkthrough</SectionLabel>
        {scenes.length === 0 && walkLoading ? (
          <div className="mt-2 space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-xl bg-paper-2 motion-reduce:animate-none" />
            ))}
          </div>
        ) : (
          <ol className="mt-2 space-y-0.5">
            {scenes.map((sc, i) => (
              <li key={sc.id} className="min-w-0">
                <Row
                  active={isActive("scene", sc.id)}
                  onClick={() => onGo({ kind: "scene", id: sc.id })}
                  lead={<span className="w-5 shrink-0 text-right font-mono text-xs text-ink-3 tabular-nums">{i + 1}</span>}
                  status={sc.status === "ready" ? "ready" : sc.status === "error" ? "error" : "pending"}
                >
                  <span className="block truncate">{sc.title}</span>
                  <span className="block text-[11px] tracking-[0.06em] text-ink-3 uppercase">{STAGE_LABEL[sc.stage] ?? sc.stage}</span>
                </Row>
                <Branch nodes={nodes} parentId={sc.id} depth={1} cursor={cursor} onGo={onGo} />
              </li>
            ))}
            {onKeyIdeas && (
              <li className="min-w-0">
                <Row
                  active={false}
                  onClick={onKeyIdeas}
                  lead={<span aria-hidden="true" className="w-5 shrink-0 text-right text-xs text-accent">★</span>}
                  status="ready"
                >
                  <span className="block truncate">Key ideas</span>
                  <span className="block text-[11px] tracking-[0.06em] text-ink-3 uppercase">Try it yourself</span>
                </Row>
              </li>
            )}
          </ol>
        )}
      </nav>

      {paperLevel.length > 0 && (
        <nav aria-label="Your questions" className="min-w-0">
          <SectionLabel>Your questions</SectionLabel>
          <div className="mt-2">
            <Branch nodes={nodes} parentId={null} depth={0} cursor={cursor} onGo={onGo} />
          </div>
        </nav>
      )}

      <section aria-label="Suggested questions" className="min-w-0">
        <SectionLabel>Claude suggests</SectionLabel>
        {suggestions === null ? (
          suggestError ? (
            <p className="mt-2 px-1 text-sm text-ink-3">No suggestions this time. Ask your own.</p>
          ) : (
            <div className="mt-2 space-y-2" aria-hidden="true">
              {[0, 1].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-xl bg-paper-2 motion-reduce:animate-none" />
              ))}
            </div>
          )
        ) : (
          <ul className="mt-2 space-y-1">
            {suggestions
              .filter((s) => !asked.has(s.title))
              .map((s) => (
                <li key={s.title} className="min-w-0">
                  <button
                    type="button"
                    title={s.hook}
                    onClick={() => onSuggest(s.title)}
                    className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-sm leading-snug text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
                  >
                    <span aria-hidden="true" className="mt-px text-accent">+</span>
                    <span className="min-w-0">{s.title}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Branch({
  nodes,
  parentId,
  depth,
  cursor,
  onGo,
}: {
  nodes: ExploreNode[];
  parentId: string | null;
  depth: number;
  cursor: Cursor | null;
  onGo: (c: Cursor) => void;
}) {
  const kids = childrenOf(nodes, parentId);
  if (!kids.length) return null;
  return (
    <ul className={depth > 0 ? "ml-5 border-l border-line pl-2" : ""}>
      <AnimatePresence initial={false}>
        {kids.map((n) => (
          <motion.li
            key={n.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.25, ease: [0.3, 0, 0.2, 1] }}
            className="min-w-0 overflow-hidden"
          >
            <Row
              active={cursor?.kind === "node" && cursor.id === n.id}
              onClick={() => onGo({ kind: "node", id: n.id })}
              lead={<span aria-hidden="true" className="w-3 shrink-0 text-xs text-ink-3">{n.kind === "deeper" ? "↳" : "?"}</span>}
              status={n.status}
              small
            >
              <span className="block truncate">{n.title}</span>
            </Row>
            <Branch nodes={nodes} parentId={n.id} depth={depth + 1} cursor={cursor} onGo={onGo} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Row({
  active,
  onClick,
  lead,
  status,
  small,
  children,
}: {
  active: boolean;
  onClick: () => void;
  lead: React.ReactNode;
  status: "pending" | "ready" | "error";
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2.5 text-left leading-snug transition-colors ${small ? "py-1.5 text-sm" : "py-2 text-[15px]"} ${
        active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
      }`}
    >
      <span className="mt-[3px] flex shrink-0 items-center">{lead}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <StatusDot status={status} />
    </button>
  );
}

function StatusDot({ status }: { status: "pending" | "ready" | "error" }) {
  if (status === "pending")
    return <span aria-label="Drawing" className="mt-[7px] size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />;
  if (status === "error") return <span aria-label="Failed" className="mt-[7px] size-2 shrink-0 rounded-full border border-ink-3" />;
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">{children}</p>;
}
