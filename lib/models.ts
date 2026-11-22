// The Claude models Curio may use, called directly through the Anthropic Messages API.
// Every entry reads PDFs natively (figures and equations survive) and supports JSON-schema output.

export interface ModelSpec {
  /** Anthropic model id. */
  id: string;
  label: string;
  /** How many calls may run at once for one walkthrough on our key. */
  maxConcurrency: number;
  /** Put an explicit cache_control marker on the paper block. */
  cacheMarker: boolean;
}

export const MODELS: ModelSpec[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", maxConcurrency: 6, cacheMarker: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", maxConcurrency: 6, cacheMarker: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", maxConcurrency: 8, cacheMarker: true },
];

/** Claude Opus 5.5 by default; ANTHROPIC_MODEL overrides it. */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || MODELS[0].id;

/** BYOK keys are often low-limit, so they never run more than this many calls at once. */
export const BYOK_MAX_CONCURRENCY = 4;

export function modelSpec(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? { id, label: id, maxConcurrency: 4, cacheMarker: true };
}
