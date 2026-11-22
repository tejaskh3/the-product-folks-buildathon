"use client";

import { useEffect, useRef, useState } from "react";
import {
  appear,
  blink,
  draw,
  flip,
  light,
  pulse,
  ripple,
  slide,
  spin,
  timelineCss,
} from "./timeline";

/* ---------- Timeline (seconds within one ~10 s loop) ---------- */

const LAYERS = [3, 5, 5, 4];
const AGENTS = 5;

const T = {
  book: appear("pp-book", 0.1, { y: -22 }, 0.6),
  progress: draw("pp-progress", 0.5, 1.4),
  pageA: flip("pp-page-a", 0.9, -9),
  pageB: flip("pp-page-b", 1.2, -6),
  feed: [0, 1, 2].map((i) => pulse(`pp-feed-${i}`, 1.5 + i * 0.08, 0.6)),
  // Pulses between graph layers, in three staggered buckets per layer gap.
  edge: [0, 1, 2].map((l) =>
    [0, 1, 2].map((b) => pulse(`pp-edge-${l}-${b}`, 2.15 + l * 0.6 + b * 0.07, 0.5)),
  ),
  node: LAYERS.map((count, l) =>
    Array.from({ length: count }, (_, i) =>
      light(`pp-node-${l}-${i}`, (l === 0 ? 2.05 : 2.55 + (l - 1) * 0.6) + i * 0.04),
    ),
  ),
  fan: Array.from({ length: AGENTS }, (_, a) => pulse(`pp-fan-${a}`, 3.95 + a * 0.05, 0.55)),
  agent: Array.from({ length: AGENTS }, (_, a) => light(`pp-agent-${a}`, 4.45 + a * 0.1)),
  orbit: Array.from({ length: AGENTS }, (_, a) => spin(`pp-orbit-${a}`, 4.7 + a * 0.1, 6.1, 2)),
  typing: [0, 1, 2].map((i) => blink(`pp-type-${i}`, 4.8, 6.1, i * 0.12)),
  gather: Array.from({ length: AGENTS }, (_, a) => pulse(`pp-gather-${a}`, 6.0 + a * 0.05, 0.5)),
  lead: light("pp-lead", 6.4),
  ripples: [ripple("pp-ripple-0", 6.55), ripple("pp-ripple-1", 6.85)],
  out: pulse("pp-out", 6.95, 0.4),
  card: draw("pp-card", 7.15, 0.75),
  cardFill: appear("pp-card-fill", 7.35, {}, 0.4),
  heading: appear("pp-heading", 7.6, { y: 4 }),
  cells: Array.from({ length: 11 }, (_, k) => appear(`pp-cell-${k}`, 7.85 + k * 0.05, { s: 0.4 }, 0.25)),
  curveN: draw("pp-curve-n", 7.9, 0.5),
  curveN2: draw("pp-curve-n2", 8.05, 0.7),
  knob: slide("pp-knob", 8.0, 0.7, 64),
  label: appear("pp-label", 8.55),
};

const CSS = `${timelineCss()}
.pp-scene *{transform-box:fill-box;transform-origin:center}
.pp-scene .pp-pulse{opacity:0}
.pp-scene[data-paused] *{animation-play-state:paused!important}
@media (prefers-reduced-motion: reduce){.pp-scene *{animation:none!important}}`;

/* ---------- Geometry ---------- */

type Orientation = "h" | "v";

// Positions along the main axis (the direction of flow) and the cross axis.
const GEO = {
  h: {
    w: 1200, h: 400, cross: 196, book: 110, bookExit: 60,
    layers: [290, 380, 470, 560], nodeGap: 58, agents: 715, agentGap: 64,
    lead: 855, card: 1062, cardEdge: 122, cardScale: 1,
  },
  v: {
    w: 420, h: 1030, cross: 210, book: 92, bookExit: 76,
    layers: [250, 320, 390, 460], nodeGap: 62, agents: 572, agentGap: 74,
    lead: 690, card: 890, cardEdge: 134, cardScale: 1.35,
  },
} as const;

const INK = "var(--color-ink)";
const LINE = "var(--color-line)";
const NODE = "var(--color-node)";
const ORANGE = "var(--color-accent)";

function spread(count: number, gap: number, center: number) {
  return Array.from({ length: count }, (_, i) => center + (i - (count - 1) / 2) * gap);
}

function Scene({ o, paused }: { o: Orientation; paused: boolean }) {
  const g = GEO[o];
  const p = (m: number, c: number): [number, number] => (o === "h" ? [m, c] : [c, m]);
  const at = (m: number, c: number) => {
    const [x, y] = p(m, c);
    return `translate(${x} ${y})`;
  };
  const line = (a: [number, number], b: [number, number]) => {
    const [x1, y1] = p(...a);
    const [x2, y2] = p(...b);
    return `M${x1} ${y1} L${x2} ${y2}`;
  };
  // A smooth S-curve that leaves and arrives along the main axis.
  const curve = (a: [number, number], b: [number, number]) => {
    const mid = (a[0] + b[0]) / 2;
    const pts = [a, [mid, a[1]], [mid, b[1]], b].map(([m, c]) => p(m, c).join(" "));
    return `M${pts[0]} C${pts[1]} ${pts[2]} ${pts[3]}`;
  };

  const nodes = LAYERS.map((count, l) =>
    spread(count, g.nodeGap, g.cross).map((c) => [g.layers[l], c] as [number, number]),
  );
  const agents = spread(AGENTS, g.agentGap, g.cross).map((c) => [g.agents, c] as [number, number]);
  const lead: [number, number] = [g.lead, g.cross];
  const cardIn: [number, number] = [g.card - g.cardEdge, g.cross];
  const exits = [-22, 0, 22].map((d) => [g.book + g.bookExit, g.cross + d] as [number, number]);

  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className="pp-scene block h-auto w-full" aria-hidden="true" data-paused={paused ? "" : undefined}>
      {/* Static wiring */}
      <g fill="none" stroke={LINE} strokeWidth={1}>
        {exits.map((e, i) => (
          <path key={`f${i}`} d={curve(e, nodes[0][i])} />
        ))}
        {nodes.slice(0, -1).map((layer, l) =>
          layer.map((a, i) => nodes[l + 1].map((b, j) => <path key={`e${l}${i}${j}`} d={line(a, b)} />)),
        )}
        {agents.map((a, i) => (
          <path key={`fa${i}`} d={curve(nodes[3][Math.min(i, 3)], a)} />
        ))}
        {agents.map((a, i) => (
          <path key={`g${i}`} d={curve(a, lead)} />
        ))}
        <path d={line(lead, cardIn)} />
      </g>

      {/* Travelling pulses */}
      <g fill="none" strokeLinecap="round" strokeDasharray="0.18 1.4">
        {exits.map((e, i) => (
          <path key={`pf${i}`} className={`pp-pulse ${T.feed[i]}`} d={curve(e, nodes[0][i])} pathLength={1} stroke={INK} strokeWidth={1.75} />
        ))}
        {nodes.slice(0, -1).map((layer, l) =>
          layer.map((a, i) =>
            nodes[l + 1].map((b, j) =>
              (i + j) % 2 === 0 ? (
                <path key={`pe${l}${i}${j}`} className={`pp-pulse ${T.edge[l][(i + 2 * j) % 3]}`} d={line(a, b)} pathLength={1} stroke={INK} strokeWidth={1.5} />
              ) : null,
            ),
          ),
        )}
        {agents.map((a, i) => (
          <path key={`pfa${i}`} className={`pp-pulse ${T.fan[i]}`} d={curve(nodes[3][Math.min(i, 3)], a)} pathLength={1} stroke={INK} strokeWidth={1.5} />
        ))}
        {agents.map((a, i) => (
          <path key={`pg${i}`} className={`pp-pulse ${T.gather[i]}`} d={curve(a, lead)} pathLength={1} stroke={ORANGE} strokeWidth={2} />
        ))}
        <path className={`pp-pulse ${T.out}`} d={line(lead, cardIn)} pathLength={1} stroke={ORANGE} strokeWidth={2} />
      </g>

      {/* 1. The paper dropping into the upload tray */}
      <g transform={at(g.book, g.cross)}>
        <g className={T.book}>
          <g className={T.pageB} style={{ transformOrigin: "0% 100%" }}>
            <rect x={-29} y={-66} width={64} height={90} rx={5} fill="white" stroke={NODE} strokeWidth={1.25} />
          </g>
          <g className={T.pageA} style={{ transformOrigin: "0% 100%" }}>
            <rect x={-32} y={-63} width={65} height={90} rx={5} fill="white" stroke={NODE} strokeWidth={1.25} />
          </g>
          <path
            d="M-36 -52 a6 6 0 0 1 6 -6 h44 l16 16 v62 a6 6 0 0 1 -6 6 h-54 a6 6 0 0 1 -6 -6 z M14 -58 v12 a4 4 0 0 0 4 4 h12"
            fill="white" stroke={INK} strokeWidth={1.5} strokeLinejoin="round"
          />
          <g stroke={INK} strokeLinecap="round">
            <path d="M-26 -42 h26" strokeWidth={2} />
            <path d="M-26 -30 h44 M-26 -22 h38 M-26 -14 h44 M-26 -6 h30" strokeWidth={1} stroke={NODE} />
            <path d="M-26 6 q8 -10 16 -2 t18 -4 t12 0" fill="none" strokeWidth={1.1} />
          </g>
        </g>
        <path d="M-52 16 v14 a9 9 0 0 0 9 9 h86 a9 9 0 0 0 9 -9 v-14" fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" />
        <path d="M-40 56 h80" stroke={LINE} strokeWidth={3} strokeLinecap="round" />
        <path className={T.progress} d="M-40 56 h80" pathLength={1} strokeDasharray="1 2" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      </g>

      {/* 2. The reading graph */}
      {nodes.map((layer, l) =>
        layer.map(([m, c], i) => (
          <g key={`n${l}${i}`} transform={at(m, c)}>
            <circle r={7} fill="white" stroke={NODE} strokeWidth={1.25} />
            <circle className={T.node[l][i]} r={7} fill={INK} />
          </g>
        )),
      )}

      {/* 3. Agents */}
      {agents.map(([m, c], i) => (
        <g key={`a${i}`} transform={at(m, c)}>
          <circle r={18} fill="white" stroke={NODE} strokeWidth={1.25} strokeDasharray="3 4" />
          <g className={T.agent[i]}>
            <circle r={19} fill={ORANGE} />
            <Face />
          </g>
          {i % 2 === 0 ? (
            <g className={T.orbit[i]}>
              <circle r={27} fill="none" />
              <circle cy={-27} r={2.6} fill={ORANGE} />
            </g>
          ) : (
            <g>
              {[-7, 0, 7].map((d, k) => {
                const [x, y] = p(d, -28);
                return <circle key={k} className={T.typing[k]} cx={x} cy={y} r={2} fill={ORANGE} />;
              })}
            </g>
          )}
        </g>
      ))}

      {/* 4. Lead agent */}
      <g transform={at(...lead)}>
        {T.ripples.map((r) => (
          <circle key={r} className={r} r={30} fill="none" stroke={ORANGE} strokeWidth={1.25} />
        ))}
        <circle r={30} fill="white" stroke={NODE} strokeWidth={1.25} strokeDasharray="3 4" />
        <g className={T.lead}>
          <circle r={31} fill={ORANGE} />
          <g transform="scale(1.55)">
            <Face />
          </g>
          <path d="M22 -34 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z" fill={ORANGE} />
        </g>
      </g>

      {/* 5. The result card */}
      <g transform={`${at(g.card, g.cross)} scale(${g.cardScale})`}>
        <ResultCard />
      </g>

      {o === "h" && (
        <g fill="var(--color-ink-2)" fontSize={13} textAnchor="middle" style={{ fontFamily: "var(--font-sans)" }}>
          <text x={g.book} y={g.h - 22}>Your paper</text>
          <text x={(g.layers[0] + g.layers[3]) / 2} y={g.h - 22}>Claude reads it</text>
          <text x={g.agents} y={g.h - 22}>Agents</text>
          <text x={g.lead} y={g.h - 22}>Lead agent</text>
        </g>
      )}
    </svg>
  );
}

function Face() {
  return (
    <g>
      <circle cx={-5.5} cy={-2.5} r={1.9} fill={INK} />
      <circle cx={5.5} cy={-2.5} r={1.9} fill={INK} />
      <path d="M-5 4 q5 4.5 10 0" fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

// Weights for the little attention matrix; a loose diagonal band.
const WEIGHTS = Array.from({ length: 6 }, (_, r) =>
  Array.from({ length: 6 }, (_, c) => Math.max(0.12, 1 - Math.abs(r - c) * 0.3 - ((r * 7 + c * 3) % 5) * 0.04)),
);

function ResultCard() {
  const w = 240;
  const h = 196;
  const r = 14;
  const outline = `M${-w / 2 + r} ${-h / 2} H${w / 2 - r} a${r} ${r} 0 0 1 ${r} ${r} V${h / 2 - r} a${r} ${r} 0 0 1 ${-r} ${r} H${-w / 2 + r} a${r} ${r} 0 0 1 ${-r} ${-r} V${-h / 2 + r} a${r} ${r} 0 0 1 ${r} ${-r} Z`;

  return (
    <g>
      <path className={T.cardFill} d={outline} fill="white" />
      <path className={T.card} d={outline} fill="none" stroke={INK} strokeWidth={1.4} pathLength={1} strokeDasharray="1 2" />

      <g className={T.heading} fill={INK} fontSize={15} style={{ fontFamily: "var(--font-serif)" }}>
        <text x={-104} y={-66}>Why does attention</text>
        <text x={-104} y={-47}>scale quadratically?</text>
      </g>

      {/* n × n attention grid */}
      <g transform="translate(-104 -30)">
        {WEIGHTS.map((row, i) =>
          row.map((wt, j) => (
            <g key={`${i}${j}`} className={T.cells[i + j]}>
              <rect x={j * 10} y={i * 10} width={8} height={8} rx={1.5} fill={INK} fillOpacity={wt} />
            </g>
          )),
        )}
      </g>

      {/* n vs n² plot */}
      <g transform="translate(-20 30)" fill="none" strokeLinecap="round">
        <path className={T.heading} d="M0 0 H116 M0 0 V-62" stroke={NODE} strokeWidth={1} />
        <path className={T.curveN} d="M0 0 L116 -26" pathLength={1} strokeDasharray="1 2" stroke={NODE} strokeWidth={1.5} />
        <path className={T.curveN2} d="M0 0 Q70 -2 112 -60" pathLength={1} strokeDasharray="1 2" stroke={INK} strokeWidth={1.75} />
        <g className={T.label} fill="var(--color-ink-2)" stroke="none" fontSize={11} style={{ fontFamily: "var(--font-sans)" }}>
          <text x={98} y={-18}>n</text>
          <text x={82} y={-56}>n²</text>
        </g>
      </g>

      {/* slider */}
      <g transform="translate(0 58)">
        <path className={T.heading} d="M-104 0 H104" stroke={LINE} strokeWidth={3} strokeLinecap="round" />
        <g className={T.knob}>
          <circle cx={-44} r={7} fill="white" stroke={INK} strokeWidth={1.5} />
        </g>
        <g className={T.label} fill="var(--color-ink-2)" fontSize={11} style={{ fontFamily: "var(--font-sans)" }}>
          <text x={-104} y={24}>Drag to add tokens</text>
          <text x={104} y={24} textAnchor="end">36 pairs</text>
        </g>
      </g>
    </g>
  );
}

export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="A paper drops into an upload tray. Pulses carry it through a network of nodes as Claude reads it, then fan out to five small orange agents that each work on a question. They pass their findings to one larger lead agent, which draws a result card: an interactive diagram answering “Why does attention scale quadratically?”"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hidden md:block">
        <Scene o="h" paused={!visible} />
      </div>
      <div className="mx-auto max-w-[420px] md:hidden">
        <Scene o="v" paused={!visible} />
      </div>
    </div>
  );
}
