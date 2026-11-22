import type { CSSProperties } from "react";

const INK = "var(--color-ink)";
const NODE = "var(--color-node)";
const LINE = "var(--color-line)";
const ORANGE = "var(--color-accent)";

const delay = (s: number) => ({ "--delay": `${s}s` }) as CSSProperties;

const stroke = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  pathLength: 1,
  "data-d": "",
} as const;

export function UploadIllustration() {
  return (
    <svg viewBox="0 0 240 150" className="h-auto w-full" role="img" aria-label="A paper being dropped into an upload tray, with a progress line filling beneath it">
      <path {...stroke} d="M92 20 a5 5 0 0 1 5 -5 h38 l14 14 v58 a5 5 0 0 1 -5 5 h-47 a5 5 0 0 1 -5 -5 z M135 15 v10 a4 4 0 0 0 4 4 h10" stroke={INK} strokeWidth={1.5} />
      <path {...stroke} d="M102 36 h22 M102 46 h36 M102 54 h30 M102 62 h36" stroke={NODE} strokeWidth={1.2} style={delay(0.35)} />
      <path {...stroke} d="M64 84 v18 a10 10 0 0 0 10 10 h92 a10 10 0 0 0 10 -10 v-18" stroke={INK} strokeWidth={1.5} style={delay(0.2)} />
      <path d="M78 132 h84" stroke={LINE} strokeWidth={3} strokeLinecap="round" data-f="" style={delay(0.3)} />
      <path {...stroke} d="M78 132 h58" stroke={INK} strokeWidth={3} style={delay(0.8)} />
    </svg>
  );
}

export function AgentsIllustration() {
  const agents: [number, number][] = [
    [62, 44],
    [120, 30],
    [178, 44],
  ];
  return (
    <svg viewBox="0 0 240 150" className="h-auto w-full" role="img" aria-label="Three small orange agents each pulling a question out of the lines of a paper">
      <path {...stroke} d="M40 96 h160 M40 108 h128 M40 120 h150 M40 132 h96" stroke={NODE} strokeWidth={1.2} />
      {agents.map(([x, y], i) => (
        <g key={i}>
          <path {...stroke} d={`M${x} ${y + 17} C${x} ${y + 34} ${60 + i * 50} 80 ${60 + i * 50} 92`} stroke={NODE} strokeWidth={1} style={delay(0.3 + i * 0.12)} />
          <g data-f="" style={delay(0.55 + i * 0.12)}>
            <circle cx={x} cy={y} r={15} fill={ORANGE} />
            <circle cx={x - 4.5} cy={y - 2} r={1.6} fill={INK} />
            <circle cx={x + 4.5} cy={y - 2} r={1.6} fill={INK} />
            <path d={`M${x - 4} ${y + 3.5} q4 3.5 8 0`} fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
          </g>
        </g>
      ))}
      <path {...stroke} d="M52 104 h40 M126 128 h36" stroke={INK} strokeWidth={2.2} style={delay(0.9)} />
      <path {...stroke} d="M196 12 q8 -4 12 2 q3 6 -5 9 v4 M203 33 v0.5" stroke={INK} strokeWidth={1.5} style={delay(1.05)} />
    </svg>
  );
}

export function PlayIllustration() {
  return (
    <svg viewBox="0 0 240 150" className="h-auto w-full" role="img" aria-label="A small interactive chart with a curve, a slider and a hand-drawn cursor dragging the slider">
      <path {...stroke} d="M52 18 a8 8 0 0 1 8 -8 h120 a8 8 0 0 1 8 8 v114 a8 8 0 0 1 -8 8 h-120 a8 8 0 0 1 -8 -8 z" stroke={INK} strokeWidth={1.5} />
      <path {...stroke} d="M70 94 H170 M70 94 V30" stroke={NODE} strokeWidth={1.2} style={delay(0.25)} />
      <path {...stroke} d="M70 94 L166 72" stroke={NODE} strokeWidth={1.5} style={delay(0.45)} />
      <path {...stroke} d="M70 94 Q130 92 164 34" stroke={INK} strokeWidth={1.8} style={delay(0.55)} />
      <path d="M70 118 H170" stroke={LINE} strokeWidth={3} strokeLinecap="round" data-f="" style={delay(0.3)} />
      <path {...stroke} d="M70 118 H132" stroke={INK} strokeWidth={3} style={delay(0.8)} />
      <circle cx={132} cy={118} r={6} fill="white" stroke={INK} strokeWidth={1.5} data-f="" style={delay(1)} />
      <path {...stroke} d="M138 124 l3 16 l4 -5 l6 8 l3 -2 l-6 -8 l6 -2 z" stroke={INK} strokeWidth={1.3} style={delay(1.1)} />
    </svg>
  );
}
