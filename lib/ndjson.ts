// Server-only: an NDJSON response that streams the events of one async job.
// Shared by every generation route so keep-alive and closing behave the same everywhere.
//
//   run(send) ──► send(ev) ──► one JSON line per event ──► client
//        │
//        └─ every KEEPALIVE_MS: heartbeat() (if given and non-null) is sent too,
//           so proxies don't drop a quiet connection while the model is thinking.
//
// If the client goes away, send() becomes a no-op and the job keeps running to completion.

const KEEPALIVE_MS = 15_000;

export function ndjsonResponse<E>(
  run: (send: (ev: E) => void) => Promise<void>,
  heartbeat?: () => E | null,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    closed = true;
    if (timer) clearInterval(timer);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: E) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          closed = true;
        }
      };
      if (heartbeat) {
        timer = setInterval(() => {
          const ev = heartbeat();
          if (ev) send(ev);
        }, KEEPALIVE_MS);
      }
      try {
        await run(send);
      } catch (err) {
        // Callers handle their own expected failures; this only catches bugs.
        console.error("[ndjson] stream job threw", err);
      } finally {
        const alreadyClosed = closed;
        stop();
        if (!alreadyClosed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
