"use client";

// A compact version of the landing hero: paper → Claude reads it (graph) →
// agents draw → lead agent assembles → result card. `stage` picks the active part.

type Stage = "reading" | "drawing" | "checking";

const INK = "var(--color-ink)";
const LINE = "var(--color-line)";
const NODE = "var(--color-node)";
const ORANGE = "var(--color-accent)";

const W = 960;
const H = 250;
const CY = 118;
const PAPER_X = 84;
const LAYERS = [
  { x: 210, n: 3 },
  { x: 285, n: 4 },
  { x: 360, n: 3 },
];
const AGENT_X = 500;
const AGENT_GAP = 46;
const LEAD_X = 630;
const CARD_X = 800;
const CARD_W = 190;
const CARD_H = 150;

const STATUS: Record<Stage, string> = {
  reading: "Reading the paper…",
  drawing: "Agents are drawing your diagram…",
  checking: "Checking the diagram…",
};

function spread(n: number, gap: number) {
  return Array.from({ length: n }, (_, i) => CY + (i - (n - 1) / 2) * gap);
}
function curve(x1: number, y1: number, x2: number, y2: number) {
  const m = (x1 + x2) / 2;
  return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
}

const nodes = LAYERS.map((l) => spread(l.n, 40).map((y) => [l.x, y] as const));
const agents = spread(4, AGENT_GAP).map((y) => [AGENT_X, y] as const);
const paperExit = [PAPER_X + 40, CY] as const;
const cardIn = CARD_X - CARD_W / 2;

// Edges in each phase, with pulses on a subset.
const readEdges: string[] = [
  ...nodes[0].map(([x, y]) => curve(paperExit[0], paperExit[1], x - 8, y)),
  ...nodes.slice(0, -1).flatMap((layer, l) =>
    layer.flatMap(([x1, y1]) => nodes[l + 1].map(([x2, y2]) => `M${x1} ${y1} L${x2} ${y2}`)),
  ),
];
const fanEdges = agents.map(([x, y], i) => {
  const [nx, ny] = nodes[2][Math.min(i, 2)];
  return curve(nx + 8, ny, x - 16, y);
});
const gatherEdges = agents.map(([x, y]) => curve(x + 16, y, LEAD_X - 26, CY));
const outEdge = `M${LEAD_X + 26} ${CY} L${cardIn} ${CY}`;

const r = 14;
const cardPath = (() => {
  const w = CARD_W;
  const h = CARD_H;
  return `M${-w / 2 + r} ${-h / 2} H${w / 2 - r} a${r} ${r} 0 0 1 ${r} ${r} V${h / 2 - r} a${r} ${r} 0 0 1 ${-r} ${r} H${-w / 2 + r} a${r} ${r} 0 0 1 ${-r} ${-r} V${-h / 2 + r} a${r} ${r} 0 0 1 ${r} ${-r} Z`;
})();

const CSS = `
.aw *{transform-box:fill-box;transform-origin:center}
.aw .aw-pulse{opacity:0;stroke-dasharray:.16 1.3;stroke-dashoffset:1.16}
.aw .aw-lit,.aw .aw-on{opacity:0;transition:opacity .5s ease}
.aw .aw-agent-dim{transition:opacity .5s ease}

/* reading: paper + graph */
.aw[data-stage=reading] .aw-read .aw-pulse{animation:aw-travel 1.6s linear infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=reading] .aw-node-lit{animation:aw-blink 1.6s ease-in-out infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=reading] .aw-paper-line{animation:aw-scan 1.6s ease-in-out infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=reading] .aw-paper{animation:aw-bob 3.2s ease-in-out infinite}

/* drawing: agents + lead */
.aw:not([data-stage=reading]) .aw-node-lit{opacity:.85}
.aw:not([data-stage=reading]) .aw-agent .aw-on,
.aw:not([data-stage=reading]) .aw-lead .aw-on{opacity:1}
.aw[data-stage=drawing] .aw-draw .aw-pulse{animation:aw-travel 1.4s linear infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=drawing] .aw-agent .aw-on{animation:aw-throb 1.4s ease-in-out infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=drawing] .aw-dot{animation:aw-type 1s ease-in-out infinite;animation-delay:var(--dl,0s)}
.aw[data-stage=drawing] .aw-ripple{animation:aw-ripple 1.8s ease-out infinite;animation-delay:var(--dl,0s)}

/* checking: card draws in, tick */
.aw .aw-card-line{stroke-dasharray:1 2;stroke-dashoffset:1;transition:stroke-dashoffset 1.2s cubic-bezier(.45,0,.25,1)}
.aw[data-stage=checking] .aw-card-line{stroke-dashoffset:0}
.aw .aw-card-fill{opacity:0;transition:opacity .6s ease .6s}
.aw[data-stage=checking] .aw-card-fill{opacity:1}
.aw[data-stage=checking] .aw-out{animation:aw-travel 1.4s linear infinite}
.aw .aw-tick{stroke-dasharray:1 2;stroke-dashoffset:1;transition:stroke-dashoffset .5s ease 1.3s}
.aw[data-stage=checking] .aw-tick{stroke-dashoffset:0}
.aw .aw-tick-bg{opacity:0;transform:scale(.4);transition:opacity .3s ease 1.2s,transform .4s cubic-bezier(.3,1.5,.5,1) 1.2s}
.aw[data-stage=checking] .aw-tick-bg{opacity:1;transform:scale(1)}
.aw[data-stage=checking] .aw-scan{animation:aw-scanbar 2s ease-in-out 1.6s infinite}
.aw .aw-scan{opacity:0}

@keyframes aw-travel{0%{opacity:1;stroke-dashoffset:1.16}90%{opacity:1}100%{opacity:0;stroke-dashoffset:-.2}}
@keyframes aw-blink{0%,100%{opacity:.08}40%{opacity:1}}
@keyframes aw-scan{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes aw-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes aw-throb{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes aw-type{0%,100%{opacity:.2}50%{opacity:1}}
@keyframes aw-ripple{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.7)}}
@keyframes aw-scanbar{0%{opacity:0;transform:translateY(-52px)}15%{opacity:.5}85%{opacity:.5}100%{opacity:0;transform:translateY(52px)}}

@media (prefers-reduced-motion: reduce){
  .aw *{animation:none!important;transition:none!important}
  .aw .aw-pulse{opacity:0!important}
  .aw[data-stage=reading] .aw-node-lit{opacity:1}
  .aw[data-stage=reading] .aw-paper-line{opacity:1}
}
`;

function Face({ s = 1 }: { s?: number }) {
  return (
    <g transform={`scale(${s})`}>
      <circle cx={-4.5} cy={-2} r={1.6} fill={INK} />
      <circle cx={4.5} cy={-2} r={1.6} fill={INK} />
      <path d="M-4 3.5 q4 3.6 8 0" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

function Pulses({ paths, color, width, step }: { paths: string[]; color: string; width: number; step: number }) {
  return (
    <>
      {paths.map((d, i) => (
        <path
          key={i}
          className="aw-pulse"
          d={d}
          pathLength={1}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          style={{ ["--dl" as string]: `${((i * step) % 1.6).toFixed(2)}s` }}
        />
      ))}
    </>
  );
}

export function AgentsWorking(props: { stage: Stage }) {
  const { stage } = props;
  return (
    <div className="flex h-[320px] w-full flex-col items-center justify-center gap-4">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="aw block h-auto max-h-[250px] w-full"
        data-stage={stage}
        aria-hidden="true"
      >
        {/* Static wiring */}
        <g fill="none" stroke={LINE} strokeWidth={1}>
          {[...readEdges, ...fanEdges, ...gatherEdges, outEdge].map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Travelling pulses */}
        <g className="aw-read">
          <Pulses paths={readEdges.filter((_, i) => i % 2 === 0)} color={INK} width={1.6} step={0.37} />
        </g>
        <g className="aw-draw">
          <Pulses paths={fanEdges} color={INK} width={1.5} step={0.3} />
          <Pulses paths={gatherEdges} color={ORANGE} width={2} step={0.45} />
        </g>
        <path className="aw-pulse aw-out" d={outEdge} pathLength={1} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinecap="round" />

        {/* 1. Paper */}
        <g transform={`translate(${PAPER_X} ${CY})`}>
          <g className="aw-paper">
            <path
              d="M-30 -44 a5 5 0 0 1 5 -5 h36 l14 14 v53 a5 5 0 0 1 -5 5 h-45 a5 5 0 0 1 -5 -5 z M11 -49 v10 a4 4 0 0 0 4 4 h10"
              fill="white"
              stroke={INK}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <path d="M-21 -34 h22" stroke={INK} strokeWidth={2} strokeLinecap="round" />
            {[-24, -16, -8, 0, 8].map((y, i) => (
              <path
                key={y}
                className="aw-paper-line"
                d={`M-21 ${y} h${i % 2 ? 30 : 38}`}
                stroke={NODE}
                strokeWidth={1.1}
                strokeLinecap="round"
                style={{ ["--dl" as string]: `${i * 0.2}s` }}
              />
            ))}
          </g>
          <text y={82} textAnchor="middle" fontSize={13} fill="var(--color-ink-2)" style={{ fontFamily: "var(--font-sans)" }}>
            The paper
          </text>
        </g>

        {/* 2. Reading graph */}
        {nodes.map((layer, l) =>
          layer.map(([x, y], i) => (
            <g key={`n${l}${i}`} transform={`translate(${x} ${y})`}>
              <circle r={7} fill="white" stroke={NODE} strokeWidth={1.25} />
              <circle
                className="aw-lit aw-node-lit"
                r={7}
                fill={INK}
                style={{ ["--dl" as string]: `${(l * 0.35 + i * 0.12).toFixed(2)}s` }}
              />
            </g>
          )),
        )}
        <text x={LAYERS[1].x} y={CY + 118} textAnchor="middle" fontSize={13} fill="var(--color-ink-2)" style={{ fontFamily: "var(--font-sans)" }}>
          Claude reads it
        </text>

        {/* 3. Agents */}
        {agents.map(([x, y], i) => (
          <g key={`a${i}`} className="aw-agent" transform={`translate(${x} ${y})`} style={{ ["--dl" as string]: `${i * 0.18}s` }}>
            <circle r={15} fill="white" stroke={NODE} strokeWidth={1.25} strokeDasharray="3 4" />
            <g className="aw-on">
              <circle r={16} fill={ORANGE} />
              <Face s={0.9} />
            </g>
            <g className="aw-on">
              {[-6, 0, 6].map((dx, k) => (
                <circle key={k} className="aw-dot" cx={22 + dx + 6} cy={-14} r={1.7} fill={ORANGE} style={{ ["--dl" as string]: `${k * 0.15 + i * 0.1}s` }} />
              ))}
            </g>
          </g>
        ))}
        <text x={AGENT_X} y={CY + 118} textAnchor="middle" fontSize={13} fill="var(--color-ink-2)" style={{ fontFamily: "var(--font-sans)" }}>
          Agents
        </text>

        {/* 4. Lead agent */}
        <g className="aw-lead" transform={`translate(${LEAD_X} ${CY})`}>
          {[0, 0.9].map((d) => (
            <circle key={d} className="aw-on aw-ripple" r={26} fill="none" stroke={ORANGE} strokeWidth={1.25} style={{ ["--dl" as string]: `${d}s` }} />
          ))}
          <circle r={25} fill="white" stroke={NODE} strokeWidth={1.25} strokeDasharray="3 4" />
          <g className="aw-on">
            <circle r={26} fill={ORANGE} />
            <Face s={1.35} />
            <path d="M18 -29 l1.7 -5 l1.7 5 l5 1.7 l-5 1.7 l-1.7 5 l-1.7 -5 l-5 -1.7 z" fill={ORANGE} />
          </g>
          <text y={118} textAnchor="middle" fontSize={13} fill="var(--color-ink-2)" style={{ fontFamily: "var(--font-sans)" }}>
            Lead agent
          </text>
        </g>

        {/* 5. Result card */}
        <g transform={`translate(${CARD_X} ${CY})`}>
          <path d={cardPath} fill="none" stroke={LINE} strokeWidth={1.2} strokeDasharray="4 5" />
          <path className="aw-card-fill" d={cardPath} fill="white" />
          <path className="aw-card-line" d={cardPath} fill="none" stroke={INK} strokeWidth={1.4} pathLength={1} />
          <g className="aw-card-fill">
            <path d="M-72 -50 h96" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
            <path d="M-72 -38 h60" stroke={NODE} strokeWidth={1.4} strokeLinecap="round" />
            {Array.from({ length: 16 }, (_, k) => {
              const rr = Math.floor(k / 4);
              const c = k % 4;
              const w = Math.max(0.15, 1 - Math.abs(rr - c) * 0.32);
              return <rect key={k} x={-72 + c * 12} y={-22 + rr * 12} width={10} height={10} rx={1.5} fill={INK} fillOpacity={w} />;
            })}
            <path d="M-4 26 H72 M-4 26 V-22" stroke={NODE} strokeWidth={1} fill="none" />
            <path d="M-4 26 Q40 22 66 -18" stroke={ORANGE} strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <path d="M-72 50 H72" stroke={LINE} strokeWidth={3} strokeLinecap="round" />
            <circle cx={-18} cy={50} r={6} fill="white" stroke={INK} strokeWidth={1.4} />
          </g>
          <path className="aw-scan" d={`M${-CARD_W / 2 + 10} 0 H${CARD_W / 2 - 10}`} stroke={ORANGE} strokeWidth={1.5} />
          <g transform={`translate(${CARD_W / 2 - 6} ${-CARD_H / 2 + 6})`}>
            <g className="aw-tick-bg">
              <circle r={13} fill={ORANGE} />
            </g>
            <path className="aw-tick" d="M-5.5 0.5 L-1.5 4.5 L6 -4" pathLength={1} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      </svg>

      <div className="text-center">
        <p aria-live="polite" role="status" className="font-serif text-xl text-ink">
          {STATUS[stage]}
        </p>
        <p className="mt-1 text-sm text-ink-3">This takes about a minute.</p>
      </div>
    </div>
  );
}
