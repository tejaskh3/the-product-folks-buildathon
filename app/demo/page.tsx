"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DiagramStage, type Crumb, type DeeperStatus } from "@/components/demo/DiagramStage";
import { QuestionRail } from "@/components/demo/QuestionRail";
import type { PaperTarget } from "@/components/demo/PaperPanel";
import { PRODUCT_NAME } from "@/components/landing/site";
import type { Diagram, Explorable, Manifest } from "@/lib/types";

const PaperPanel = dynamic(() => import("@/components/demo/PaperPanel"), { ssr: false });

type PathEntry = { id: string; label: string };

export default function DemoPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [path, setPath] = useState<PathEntry[]>([]);
  const [selected, setSelected] = useState<Explorable | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperTarget, setPaperTarget] = useState<PaperTarget | null>(null);

  // Load the pre-generated manifest (falls back to the fixture during development).
  useEffect(() => {
    (async () => {
      for (const url of ["/demo/manifest.json", "/demo/fixture.json"]) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const m = (await res.json()) as Manifest;
          const firstReady = m.questions.find((q) => m.diagrams[q.id]);
          if (!firstReady) continue;
          setManifest(m);
          const fromUrl = new URLSearchParams(window.location.search).get("q");
          const start = m.questions.find((q) => q.id === fromUrl && m.diagrams[q.id]) ?? firstReady;
          setQuestionId(start.id);
          setPath([{ id: start.id, label: `Q${m.questions.indexOf(start) + 1}` }]);
          return;
        } catch {
          /* try the next source */
        }
      }
      setLoadError("The demo isn't generated yet.");
    })();
  }, []);

  const all = useMemo(() => manifest?.diagrams ?? {}, [manifest]);
  const current = path.length ? all[path[path.length - 1].id] : undefined;
  const question = manifest?.questions.find((q) => q.id === questionId);

  function selectQuestion(id: string) {
    if (!manifest?.diagrams[id]) return;
    setQuestionId(id);
    setPath([{ id, label: `Q${manifest.questions.findIndex((q) => q.id === id) + 1}` }]);
    setSelected(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("q", id);
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }

  function navigate(index: number) {
    setPath((p) => p.slice(0, index + 1));
    setSelected(null);
  }

  function onExplore(id: string) {
    const e = current?.explorables.find((x) => x.id === id);
    if (!e) return;
    setSelected(e);
    // The explanation card sits below the diagram; bring it into view so the click visibly does something.
    requestAnimationFrame(() =>
      document.querySelector('[aria-label="Explanation"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  function openPaper(t: PaperTarget) {
    setPaperTarget(t);
    setPaperOpen(true);
  }

  function goDeeper(e: Explorable) {
    if (!current) return;
    const key = `${current.id}/${e.id}`;
    if (all[key]) {
      setPath((p) => [...p, { id: key, label: e.label }]);
      setSelected(null);
    }
  }

  // What the explain card offers for the selected part.
  let deeper: DeeperStatus = { kind: "none" };
  if (selected && current) {
    const e = selected;
    // The demo is read-only: live exploration happens in Play.
    deeper = all[`${current.id}/${e.id}`] ? { kind: "available", onGo: () => goDeeper(e) } : { kind: "elsewhere", href: "/play" };
  }

  const crumbs: Crumb[] = path.map((p) => ({ key: p.id, label: p.label }));

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {PRODUCT_NAME}
          </Link>
          {manifest && (
            <span className="hidden min-w-0 truncate rounded-full border border-line px-3 py-1 text-sm text-ink-2 sm:block">
              {manifest.paper.title} · {manifest.paper.authors} {manifest.paper.year}
            </span>
          )}
          {manifest && question && (
            <button
              type="button"
              onClick={() => openPaper({ page: question.pages[0] ?? 1, quote: question.quote, label: question.title })}
              className="btn-secondary ml-auto h-9 px-3.5 text-sm"
            >
              Read the paper
            </button>
          )}
        </div>
      </header>

      {!manifest ? (
        <div className="flex min-h-[60vh] items-center justify-center px-6 text-center text-ink-3">
          {loadError || "Loading the paper…"}
        </div>
      ) : (
        <main className="mx-auto grid max-w-[1320px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10 lg:py-10">
          <aside className="min-w-0 overflow-x-auto lg:sticky lg:top-24 lg:self-start lg:overflow-visible">
            <QuestionRail
              questions={manifest.questions.filter((q) => manifest.diagrams[q.id])}
              activeId={questionId}
              onSelect={selectQuestion}
            />
          </aside>

          {current && question && (
            <DiagramStage
              crumbs={crumbs}
              onNavigate={navigate}
              diagram={current}
              onExplore={onExplore}
              onShowInPaper={() =>
                openPaper(
                  path.length === 1
                    ? { page: question.pages[0] ?? 1, quote: question.quote, label: question.title }
                    : paperTargetFor(all, path) ?? { page: question.pages[0] ?? 1, quote: question.quote, label: question.title },
                )
              }
              selected={selected}
              onOpenSelectedInPaper={() =>
                selected && openPaper({ page: selected.pages[0] ?? 1, quote: selected.quote, label: selected.label })
              }
              deeper={deeper}
            />
          )}
        </main>
      )}

      {manifest && (
        <PaperPanel
          open={paperOpen}
          onClose={() => setPaperOpen(false)}
          pdfUrl={manifest.paper.pdfUrl}
          title={manifest.paper.title}
          target={paperTarget}
        />
      )}

    </div>
  );
}

/** For a deeper diagram, cite the explorable that led to it. */
function paperTargetFor(all: Record<string, Diagram>, path: PathEntry[]): PaperTarget | null {
  const last = path[path.length - 1];
  const parent = path.length > 1 ? all[path[path.length - 2].id] : undefined;
  const eid = last.id.split("/").pop();
  const e = parent?.explorables.find((x) => x.id === eid);
  return e ? { page: e.pages[0] ?? 1, quote: e.quote, label: e.label } : null;
}
