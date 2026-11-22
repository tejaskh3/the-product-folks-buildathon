"use client";

// The public discussion under a library paper. Anyone reads; signed-in readers post (about the
// scene they're on, or the paper), delete their own, and report others'. Three reports hide one.
import { useCallback, useEffect, useState } from "react";

interface Comment {
  id: string;
  author: string;
  sceneId: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
  hidden: boolean;
  reportedByMe: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Discussion({
  paperId,
  sceneId,
  sceneLabel,
  onGoScene,
  signedIn,
  onSignIn,
}: {
  paperId: string;
  /** The scene the reader is on, if any: new comments can be about it. */
  sceneId: string | null;
  sceneLabel: (id: string) => string | null;
  onGoScene: (id: string) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [aboutScene, setAboutScene] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const base = `/api/play/papers/${paperId}/comments`;

  const load = useCallback(() => {
    call<{ comments: Comment[] }>(base)
      .then((r) => setComments(r.comments))
      .catch(() => setFailed(true));
  }, [base]);
  useEffect(load, [load]);

  async function post() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const c = await call<Comment>(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text, sceneId: aboutScene ? sceneId : null }),
      });
      setComments((cs) => [...(cs ?? []), c]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    setComments((cs) => cs?.filter((x) => x.id !== c.id) ?? cs);
    try {
      await call(`${base}?id=${c.id}`, { method: "DELETE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      load();
    }
  }

  async function report(c: Comment) {
    setComments((cs) => cs?.map((x) => (x.id === c.id ? { ...x, reportedByMe: true } : x)) ?? cs);
    try {
      const r = await call<{ hidden: boolean }>(`${base}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      if (r.hidden) setComments((cs) => cs?.filter((x) => x.id !== c.id) ?? cs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      load();
    }
  }

  if (failed) return null;
  const count = comments?.length ?? 0;
  const here = sceneId ? sceneLabel(sceneId) : null;

  return (
    <section aria-labelledby="discussion-title" className="rounded-2xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="discussion-body"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
      >
        <span id="discussion-title" className="text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
          Discussion{count ? ` · ${count}` : ""}
        </span>
        <span aria-hidden="true" className="text-sm text-ink-3">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div id="discussion-body" className="border-t border-line px-4 py-4 sm:px-5">
          {comments === null ? (
            <div className="h-16 animate-pulse rounded-xl bg-paper-2 motion-reduce:animate-none" />
          ) : comments.length === 0 ? (
            <p className="text-sm text-ink-3">No comments yet. Start the discussion.</p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => {
                const label = c.sceneId ? sceneLabel(c.sceneId) : null;
                return (
                  <li key={c.id} className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
                      <span className="font-medium text-ink-2">{c.author}</span>
                      <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
                      {label && c.sceneId && (
                        <button type="button" onClick={() => onGoScene(c.sceneId!)} className="text-accent-hover hover:underline">
                          on {label}
                        </button>
                      )}
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink">{c.body}</p>
                    {c.hidden && <p className="mt-1 text-xs text-accent-hover">Hidden after reports from readers. Only you can see it until it’s reviewed.</p>}
                    {signedIn && (
                      <p className="mt-1 text-xs">
                        {c.mine ? (
                          <button type="button" onClick={() => void remove(c)} className="text-ink-3 hover:text-ink">
                            Delete
                          </button>
                        ) : c.reportedByMe ? (
                          <span className="text-ink-3">Reported. Thanks.</span>
                        ) : (
                          <button type="button" onClick={() => void report(c)} className="text-ink-3 hover:text-ink">
                            Report
                          </button>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {signedIn ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void post();
              }}
              className="mt-5 space-y-2"
            >
              <label htmlFor="comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="comment"
                value={text}
                maxLength={2000}
                rows={3}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add to the discussion. Everyone can read this."
                className="w-full resize-y rounded-xl bg-paper-2 px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:shadow-[0_0_0_1px_var(--color-ink)]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {here ? (
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={aboutScene} onChange={(e) => setAboutScene(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                    About {here}
                  </label>
                ) : (
                  <span />
                )}
                <button type="submit" disabled={busy || !text.trim()} className="btn-primary h-9 px-4 text-sm disabled:opacity-40">
                  {busy ? "Posting…" : "Post"}
                </button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-accent-hover">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <p className="mt-5 text-sm text-ink-2">
              <button type="button" onClick={onSignIn} className="underline decoration-line underline-offset-4 hover:text-ink">
                Sign in
              </button>{" "}
              to join the discussion.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
