// Browser helper for POST /api/play/walkthrough: streams the paper's guided walkthrough.
import { fail } from "./playClient";
import type { Scene, Walkthrough } from "./walkthrough";

export type WalkthroughEvent =
  | { type: "plan"; paper: Walkthrough["paper"]; scenes: Omit<Scene, "diagram">[]; citation?: string; takeaways?: Walkthrough["takeaways"] }
  | { type: "scene"; scene: Scene }
  | { type: "status"; sceneId: string; stage: "drawing" | "checking" }
  | { type: "error"; sceneId?: string; message: string }
  /** Time ran out with scenes still drawing: call again to finish them (no new charge). */
  | { type: "continue" }
  | { type: "done" };

export async function streamWalkthrough(
  opts: { paperId?: string | null; key?: string; signal?: AbortSignal },
  onEvent: (e: WalkthroughEvent) => void,
): Promise<void> {
  const res = await fetch("/api/play/walkthrough", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paperId: opts.paperId ?? undefined, key: opts.key }),
    signal: opts.signal,
    cache: "no-store",
  });
  if (!res.ok) await fail(res, `Walkthrough failed (${res.status})`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let sawDone = false;
  const handle = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let ev: WalkthroughEvent;
    try {
      ev = JSON.parse(t) as WalkthroughEvent;
    } catch {
      return;
    }
    if (ev.type === "done") sawDone = true;
    onEvent(ev);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      if (done) buf += decoder.decode();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (done) {
        handle(buf);
        break;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!sawDone) onEvent({ type: "done" });
}
