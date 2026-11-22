// Offline scripts send a local PDF to the model inline (base64), so they need no storage or upload.
import fs from "node:fs";
import path from "node:path";
import type { PaperRef, Usage } from "../lib/llm";

export function localPaper(file: string): PaperRef {
  return { filename: path.basename(file), data: `data:application/pdf;base64,${fs.readFileSync(file).toString("base64")}` };
}

/** Running total of what the script has spent, as reported by OpenRouter. */
export function spendTracker(budget?: number) {
  let cost = 0;
  return {
    track(u: Usage) {
      cost += u.cost_usd;
      if (budget && cost > budget) console.warn(`!! spend $${cost.toFixed(2)} is over the $${budget} budget`);
    },
    get total() {
      return cost;
    },
  };
}
