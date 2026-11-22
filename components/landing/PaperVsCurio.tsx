"use client";

import { useEffect, useRef, useState } from "react";
import { DiagramFrame } from "@/components/demo/DiagramFrame";
import type { Scene, Walkthrough } from "@/lib/walkthrough";

// The Google paper's saved walkthrough; opens with the test email.
const WALKTHROUGH_URL = "/play/88c75ec0-fee6-412c-bc5c-ee7f8a157f0d";

const noop = () => {};

/** Loads the pre-made Google walkthrough once the section is near the viewport. */
function useGoogleScenes() {
  const ref = useRef<HTMLElement>(null);
  const [scenes, setScenes] = useState<{ figure?: Scene; equation?: Scene } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        fetch("/demo/walkthrough-google.json")
          .then((r) => (r.ok ? (r.json() as Promise<Walkthrough>) : Promise.reject(new Error(String(r.status)))))
          .then((w) => {
            if (cancelled) return;
            setScenes({
              figure: w.scenes.find((s) => s.kind === "figure"),
              equation: w.scenes.find((s) => s.kind === "equation"),
            });
          })
          .catch(() => !cancelled && setScenes({}));
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  return { ref, scenes };
}

export function PaperVsCurio() {
  const { ref, scenes } = useGoogleScenes();

  return (
    <section ref={ref} id="paper-vs-curio" aria-labelledby="pvc-title" className="scroll-mt-8 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid gap-6 md:grid-cols-12 md:items-end">
          <h2 id="pvc-title" className="font-serif text-4xl leading-tight tracking-[-0.02em] text-ink sm:text-5xl md:col-span-7">
            The paper drew this. Curio makes it move.
          </h2>
          <p className="max-w-md leading-relaxed text-ink-2 md:col-span-5 md:justify-self-end">
            Google&apos;s 1998 paper, <cite className="not-italic text-ink">The Anatomy of a Large-Scale Hypertextual Web Search Engine</cite>.
            Same figure, same equation. One you squint at, one you can play with.
          </p>
        </div>

        <Pair
          label="The figure"
          paper={
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/demo/google-fig1.png"
              alt="Figure 1 from the original paper: a low-resolution diagram of grey blobs and cylinders connected by crossing arrows."
              width={665}
              height={800}
              loading="lazy"
              className="mx-auto h-auto w-full max-w-[420px]"
            />
          }
          paperCaption="Fig. 1, Brin & Page (1998), p. 7"
          scene={scenes?.figure}
          loaded={scenes !== null}
        />

        <Pair
          label="The equation"
          paper={
            <div className="px-2 py-10 text-center font-serif text-lg leading-relaxed text-ink sm:text-xl">
              PR(A) = (1−d) + d (PR(T1)/C(T1) + ... + PR(Tn)/C(Tn))
            </div>
          }
          paperCaption="As printed, Brin & Page (1998), p. 4"
          scene={scenes?.equation}
          loaded={scenes !== null}
        />

        <div className="mt-10">
          <a href={WALKTHROUGH_URL} className="btn-primary h-11 px-5">
            Open the full walkthrough →
          </a>
        </div>
      </div>
    </section>
  );
}

function Pair({
  label,
  paper,
  paperCaption,
  scene,
  loaded,
}: {
  label: string;
  paper: React.ReactNode;
  paperCaption: string;
  scene?: Scene;
  loaded: boolean;
}) {
  return (
    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
      <figure className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <p className="font-mono text-xs tracking-widest text-ink-2 uppercase">In the paper · {label}</p>
        <div className="mt-4">{paper}</div>
        <figcaption className="mt-3 text-sm text-ink-2">{paperCaption}</figcaption>
      </figure>

      <figure className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
          <p className="font-mono text-xs tracking-widest text-accent uppercase">In Curio · {label}</p>
          {scene && <p className="truncate text-sm text-ink-2">{scene.title}</p>}
        </div>
        {scene ? (
          <DiagramFrame diagram={scene.diagram} onExplore={noop} />
        ) : (
          <p className="px-6 py-16 text-center text-sm text-ink-2">
            {loaded ? "This diagram isn't available right now." : "Loading the live diagram…"}
          </p>
        )}
        {scene && <figcaption className="border-t border-line px-5 py-3 text-sm text-ink-2 sm:px-6">{scene.diagram.caption}</figcaption>}
      </figure>
    </div>
  );
}
