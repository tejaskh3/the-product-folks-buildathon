"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSrcDoc } from "@/lib/bridge";
import type { BridgeMessage, Diagram } from "@/lib/types";

const MIN_HEIGHT = 360;
const MAX_HEIGHT = 2400;
const READY_TIMEOUT_MS = 3000;

interface Props {
  diagram: Diagram;
  onExplore: (id: string) => void;
}

/** Sandboxed iframe for one generated diagram. Remounts whenever the diagram changes. */
export function DiagramFrame(props: Props) {
  return <Frame key={props.diagram.id} {...props} />;
}

function isBridgeMessage(data: unknown): data is BridgeMessage {
  return typeof data === "object" && data !== null && (data as { ns?: unknown }).ns === "curio";
}

function Frame({ diagram, onExplore }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const srcDoc = useMemo(() => buildSrcDoc(diagram), [diagram]);

  // Latest callback without re-subscribing the listener.
  const onExploreRef = useRef(onExplore);
  useEffect(() => {
    onExploreRef.current = onExplore;
  }, [onExplore]);

  useEffect(() => {
    const allowed = new Set(diagram.explorables.map((e) => e.id));
    function onMessage(event: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data: unknown = event.data;
      if (!isBridgeMessage(data)) return;
      switch (data.type) {
        case "ready":
          setReady(true);
          break;
        case "height": {
          const h = Number(data.height);
          if (Number.isFinite(h)) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(h))));
          break;
        }
        case "explore":
          if (typeof data.id === "string" && allowed.has(data.id)) onExploreRef.current(data.id);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [diagram]);

  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  if (timedOut && !ready) {
    return (
      <div
        role="status"
        className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-paper-2 px-6 py-12 text-center"
      >
        <svg viewBox="0 0 48 48" className="size-10 text-node" aria-hidden="true">
          <rect x={8} y={10} width={32} height={28} rx={4} fill="none" stroke="currentColor" strokeWidth={1.5} />
          <path d="M8 18h32" stroke="currentColor" strokeWidth={1.5} />
          <circle cx={24} cy={28} r={3} fill="var(--color-accent)" />
        </svg>
        <p className="mt-4 font-serif text-lg text-ink">{diagram.title}</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">{diagram.caption}</p>
        <p className="mt-4 text-sm text-ink-3">This diagram didn&rsquo;t load.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <iframe
        ref={iframeRef}
        title={diagram.title}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        className={`block w-full rounded-xl bg-white transition-[height,opacity] duration-300 ease-out motion-reduce:transition-none ${ready ? "opacity-100" : "opacity-0"}`}
        style={{ height, border: 0 }}
      />
      {!ready && (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse rounded-xl bg-paper-2 motion-reduce:animate-none" />
      )}
    </div>
  );
}
