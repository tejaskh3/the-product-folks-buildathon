// Server-only: the usage ledger. One row per model call, written as soon as the call returns,
// so the user's usage page shows exactly what ran on their behalf and which key paid.
import { db } from "./db";
import type { Usage } from "./llm";

export type KeySource = "platform" | "byok";

export interface UsageContext {
  owner: string;
  paperId: string | null;
  keySource: KeySource;
}

export async function recordUsage(ctx: UsageContext, step: string, u: Usage): Promise<void> {
  const { error } = await db().from("usage_events").insert({
    owner: ctx.owner,
    paper_id: ctx.paperId,
    step,
    model: u.model,
    key_source: ctx.keySource,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cached_tokens: u.cached_tokens,
    reasoning_tokens: u.reasoning_tokens,
    cost_usd: u.cost_usd,
  });
  // Never fail a generation over bookkeeping, but make a missing row visible in the logs.
  if (error) console.error(`[usage] couldn’t record ${step} for ${ctx.owner}`, error.message);
}

/** Usage callback for a generation: `track("scene:s3")(usage)` records one call; await it. */
export function usageRecorder(ctx: UsageContext) {
  return (step: string) => (u: Usage) => recordUsage(ctx, step, u);
}

export type OnUsage = (u: Usage) => Promise<void> | void;
