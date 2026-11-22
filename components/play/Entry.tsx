"use client";

import { useRef, useState } from "react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

// Pre-generated demos: they open instantly and make no paid calls.
const EXAMPLES = [
  { label: "Attention Is All You Need", arxiv: "1706.03762" },
  { label: "Google’s original PageRank paper", pdf: "/demo/google.pdf", name: "google.pdf" },
] as const;

export function UploadScreen({
  onUpload,
  busy,
  progress = null,
  error,
  signedIn,
}: {
  onUpload: (input: { file: File } | { arxiv: string }) => void;
  busy: boolean;
  /** A big PDF on its way to Storage: 0–1. */
  progress?: number | null;
  error: string;
  signedIn: boolean;
}) {
  const [arxiv, setArxiv] = useState("");
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file: File | undefined) {
    if (file && !busy) onUpload({ file });
  }

  // Bundled demo PDFs go through the normal upload; the server recognises their bytes.
  async function openBundled(url: string, name: string) {
    setLocalError("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      pick(new File([await res.blob()], name, { type: "application/pdf" }));
    } catch {
      setLocalError("Couldn’t load the demo paper. Please try again.");
    }
  }

  return (
    <Centered>
      <h1 className="font-serif text-4xl leading-tight tracking-[-0.02em] text-ink sm:text-5xl">Drop in a paper.</h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-2">
        Claude reads all of it, draws the core idea first, then answers your questions as diagrams you can click into.
      </p>

      {signedIn ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={`mt-8 flex w-full max-w-lg flex-col items-center rounded-2xl border-[1.5px] border-dashed px-6 py-10 transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-line bg-paper-2 hover:border-node"
            } disabled:cursor-wait`}
          >
            <svg viewBox="0 0 48 48" className="size-11 text-ink-2" aria-hidden="true">
              <path d="M13 6.5h15l9 9v26H13z" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
              <path d="M28 6.5v9h9" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
              <path d="M25 35V22m-5 5 5-5 5 5" fill="none" stroke="var(--color-accent)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="mt-4 text-[15px] text-ink">
              {!busy
                ? "Drop a PDF here, or click to choose"
                : progress !== null && progress < 1
                  ? `Uploading… ${Math.round(progress * 100)}%`
                  : "Handing the paper to Claude…"}
            </span>
            <span className="mt-1 text-sm text-ink-3">Up to 15 MB. Bigger papers: use the arXiv link below.</span>
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (arxiv.trim() && !busy) onUpload({ arxiv: arxiv.trim() });
            }}
            className="mt-4 flex w-full max-w-lg flex-col gap-3 sm:flex-row"
          >
            <label htmlFor="play-arxiv" className="sr-only">
              arXiv link or ID
            </label>
            <input
              id="play-arxiv"
              value={arxiv}
              onChange={(e) => setArxiv(e.target.value)}
              placeholder="or paste an arXiv link, e.g. arxiv.org/abs/1706.03762"
              className="h-11 min-w-0 flex-1 rounded-full border border-line bg-white px-5 text-[15px] outline-none focus:border-ink"
            />
            <button type="submit" disabled={busy || !arxiv.trim()} className="btn-secondary h-11 px-5 disabled:opacity-50">
              Read it
            </button>
          </form>
          <p className="mt-4 text-sm text-ink-3">
            No paper handy?{" "}
            <a href="/sample/google-file-system.pdf" download className="text-accent-hover underline underline-offset-2">
              Download a sample paper
            </a>{" "}
            (The Google File System, 2003), then drop it above.
          </p>
        </>
      ) : (
        <div className="mt-8 flex w-full max-w-lg flex-col items-center rounded-2xl border border-line bg-paper-2 px-6 py-8">
          <p className="text-[15px] text-ink">Sign in to bring your own paper.</p>
          <p className="mt-1 text-sm text-ink-3">Your walkthroughs and answers are saved to your account.</p>
          <GoogleSignInButton label="Continue with Google" variant="primary" className="mt-5" />
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-2 text-sm text-ink-3">
        <p>
          No paper handy? Open a ready-made one, or browse the{" "}
          <a href="/library" className="text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
            library
          </a>
          :
        </p>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={busy}
              onClick={() => ("arxiv" in ex ? onUpload({ arxiv: ex.arxiv }) : openBundled(ex.pdf, ex.name))}
              className="rounded text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink disabled:opacity-50"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>
      {(error || localError) && (
        <p role="alert" className="mt-4 max-w-md text-sm text-ink-2">
          {error || localError}
        </p>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">{children}</div>;
}
