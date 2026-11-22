// A tiny keyframe generator for the hero loop.
// Each track is written in seconds on one shared cycle and compiled to a
// CSS @keyframes rule that only touches opacity, transform and stroke-dashoffset.

export const CYCLE = 9.8;
// Everything lit during the cycle fades back out from here.
export const RESET = 9.0;

type Props = { o?: number; s?: number; x?: number; y?: number; r?: number; d?: number };
type Frame = [number, Props];

const DEFAULTS: Required<Props> = { o: 1, s: 1, x: 0, y: 0, r: 0, d: 0 };
const EASE = "cubic-bezier(.45,0,.25,1)";
const LINEAR = "linear";

const rules: string[] = [];
const names = new Set<string>();

function pct(t: number) {
  return `${((Math.min(Math.max(t, 0), CYCLE) / CYCLE) * 100).toFixed(3)}%`;
}

function track(name: string, frames: Frame[], ease = EASE): string {
  if (names.has(name)) return name;
  names.add(name);

  const used = new Set<keyof Props>();
  frames.forEach(([, p]) => (Object.keys(p) as (keyof Props)[]).forEach((k) => used.add(k)));
  const hasTransform = used.has("s") || used.has("x") || used.has("y") || used.has("r");

  let prev: Required<Props> = { ...DEFAULTS };
  const blocks = [...frames]
    .sort((a, b) => a[0] - b[0])
    .map(([t, p]) => {
      const v = { ...prev, ...p };
      prev = v;
      const decl: string[] = [];
      if (used.has("o")) decl.push(`opacity:${v.o}`);
      if (hasTransform)
        decl.push(`transform:translate(${v.x}px,${v.y}px) scale(${v.s}) rotate(${v.r}deg)`);
      if (used.has("d")) decl.push(`stroke-dashoffset:${v.d}`);
      decl.push(`animation-timing-function:${ease}`);
      return `${pct(t)}{${decl.join(";")}}`;
    });

  rules.push(
    `@keyframes ${name}{${blocks.join("")}}.${name}{animation:${name} ${CYCLE}s infinite both}`,
  );
  return name;
}

/** Fades (and optionally slides or scales) in at `at`, holds, then fades out at RESET. */
export function appear(name: string, at: number, from: Props = {}, dur = 0.45) {
  const start = { o: 0, s: 1, x: 0, y: 0, ...from };
  return track(name, [
    [0, start],
    [at, start],
    [at + dur, { o: 1, s: 1, x: 0, y: 0 }],
    [RESET, { o: 1 }],
    [RESET + 0.4, { o: 0 }],
    [CYCLE, { o: 0 }],
  ]);
}

/** Draws a pathLength=1 stroke in over `dur`, then fades it out at RESET. */
export function draw(name: string, at: number, dur: number) {
  return track(name, [
    [0, { o: 1, d: 1.02 }],
    [at, { d: 1.02 }],
    [at + dur, { d: 0 }],
    [RESET, { o: 1, d: 0 }],
    [RESET + 0.4, { o: 0 }],
    [CYCLE, { o: 0 }],
  ]);
}

/** A short dash that travels along a pathLength=1 stroke once. */
export function pulse(name: string, at: number, dur: number) {
  return track(
    name,
    [
      [0, { o: 0, d: 0.2 }],
      [at, { o: 0, d: 0.2 }],
      [at + 0.02, { o: 1 }],
      [at + dur, { o: 1, d: -1.02 }],
      [at + dur + 0.02, { o: 0 }],
      [CYCLE, { o: 0, d: -1.02 }],
    ],
    "cubic-bezier(.35,0,.65,1)",
  );
}

/** Pops a highlight in at `at` and keeps it lit until RESET. */
export function light(name: string, at: number) {
  return track(name, [
    [0, { o: 0, s: 0.6 }],
    [at, { o: 0, s: 0.6 }],
    [at + 0.18, { o: 1, s: 1.12 }],
    [at + 0.34, { s: 1 }],
    [RESET, { o: 1, s: 1 }],
    [RESET + 0.4, { o: 0 }],
    [CYCLE, { o: 0, s: 0.6 }],
  ]);
}

/** Continuous spin between two moments. */
export function spin(name: string, from: number, to: number, turns: number) {
  return track(
    name,
    [
      [0, { o: 0, r: 0 }],
      [from, { o: 0, r: 0 }],
      [from + 0.2, { o: 1, r: ((turns * 360 * 0.2) / (to - from)) }],
      [to - 0.2, { o: 1, r: turns * 360 * (1 - 0.2 / (to - from)) }],
      [to, { o: 0, r: turns * 360 }],
      [CYCLE, { o: 0, r: turns * 360 }],
    ],
    LINEAR,
  );
}

/** On/off blinking, used for the typing dots. */
export function blink(name: string, from: number, to: number, phase: number) {
  const frames: Frame[] = [[0, { o: 0, y: 0 }], [from + phase - 0.01, { o: 0, y: 0 }]];
  for (let t = from + phase; t + 0.35 <= to; t += 0.5) {
    frames.push([t, { o: 0.25, y: 0 }], [t + 0.15, { o: 1, y: -2 }], [t + 0.35, { o: 0.25, y: 0 }]);
  }
  frames.push([to, { o: 0, y: 0 }], [CYCLE, { o: 0, y: 0 }]);
  return track(name, frames);
}

/** An expanding ring. */
export function ripple(name: string, at: number) {
  return track(name, [
    [0, { o: 0, s: 1 }],
    [at - 0.01, { o: 0, s: 1 }],
    [at, { o: 0.7, s: 1 }],
    [at + 0.7, { o: 0, s: 1.7 }],
    [CYCLE, { o: 0, s: 1.7 }],
  ]);
}

/** Moves along x between two moments and holds. */
export function slide(name: string, at: number, dur: number, dx: number) {
  return track(name, [
    [0, { o: 0, x: 0 }],
    [at - 0.3, { o: 0, x: 0 }],
    [at, { o: 1, x: 0 }],
    [at + dur, { x: dx }],
    [RESET, { o: 1, x: dx }],
    [RESET + 0.4, { o: 0 }],
    [CYCLE, { o: 0, x: dx }],
  ]);
}

/** Tilts around the element's transform-origin and back. */
export function flip(name: string, at: number, deg: number) {
  return track(name, [
    [0, { r: 0 }],
    [at, { r: 0 }],
    [at + 0.3, { r: deg }],
    [at + 0.65, { r: 0 }],
    [CYCLE, { r: 0 }],
  ]);
}

export function timelineCss() {
  return rules.join("\n");
}
