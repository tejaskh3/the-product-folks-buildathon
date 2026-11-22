"use client";

// /research — the research agent. Name a topic; Claude Opus searches the web and returns the
// top 3 articles and top 3 new findings. arXiv papers open straight into a Curio walkthrough.
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/persona/PageHeader";
import { Chip, Spinner, explainHref, fetchPersona, runResearch, useProgressText, type ResearchResult } from "@/components/persona/shared";

const EXAMPLES = ["Crypto", "AI agents", "CRISPR", "Fusion energy"];

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [hasPersona, setHasPersona] = useState(false);
  const [saved, setSaved] = useState<"no" | "saving" | "yes">("no");
  const progress = useProgressText(busy);

  useEffect(() => {
    fetchPersona()
      .then((s) => setHasPersona(!!s.persona))
      .catch(() => {});
  }, []);

  const go = async (t: string) => {
    const q = t.trim();
    if (!q || busy) return;
    setTopic(q);
    setAsked(q);
    setBusy(true);
    setError("");
    setResult(null);
    setSaved("no");
    try {
      setResult(await runResearch(q, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The research agent failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaved("saving");
    const res = await fetch("/api/research/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: asked, result }) }).catch(() => null);
    if (res?.ok) {
      setSaved("yes");
      window.dispatchEvent(new Event("curio:feed-changed"));
    } else setSaved("no");
  };

  return (
    <div className="min-h-screen bg-paper">
      <PageHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">What do you want to stay on top of?</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-ink-2">Name a topic. The research agent searches the web right now and brings back the top 3 articles and the top 3 new findings.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(topic);
          }}
          className="mt-6 flex flex-col gap-3 sm:flex-row"
        >
          <label htmlFor="r-topic" className="sr-only">
            Topic
          </label>
          <input
            id="r-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={120}
            placeholder="e.g. Crypto, AI agents, CRISPR"
            className="h-12 flex-1 rounded-xl border border-line bg-white px-4 text-[15px] text-ink outline-none focus:border-accent"
          />
          <button type="submit" disabled={busy || !topic.trim()} className="btn-primary h-12 px-6 disabled:opacity-60">
            {busy ? "Researching…" : "Find what’s new"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <Chip key={ex} onClick={() => go(ex)}>
              {ex}
            </Chip>
          ))}
        </div>

        {busy && (
          <div className="mt-8 flex items-center gap-3 rounded-xl border border-line bg-white p-5 text-ink-2" role="status">
            <Spinner />
            <span>
              <b className="text-ink">{progress}</b> <span className="text-sm text-ink-3">Researching “{asked}”, usually 30–60 seconds.</span>
            </span>
          </div>
        )}
        {error && <p className="mt-8 rounded-xl border border-line bg-white p-5 text-sm text-red-700">{error}</p>}

        {result && (
          <section className="mt-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="max-w-3xl font-serif text-2xl leading-snug text-ink">{result.headline}</p>
              {hasPersona ? (
                <button type="button" onClick={save} disabled={saved !== "no"} className="btn-secondary h-10 shrink-0 px-4 text-sm disabled:opacity-60">
                  {saved === "yes" ? "✓ Added to your feed" : saved === "saving" ? "Adding…" : "+ Add to my feed"}
                </button>
              ) : (
                <Link href="/for-you" className="btn-secondary flex h-10 shrink-0 items-center px-4 text-sm">
                  Follow topics in For you
                </Link>
              )}
            </div>

            <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-3">Top 3 articles</h2>
            <ol className="mt-3 grid gap-4 md:grid-cols-3">
              {result.articles.map((a, i) => (
                <li key={i} className="flex flex-col rounded-xl border border-line bg-white p-5">
                  <span className="text-xs text-ink-3">
                    {a.source} · {a.date}
                  </span>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 font-serif text-lg leading-snug text-ink hover:underline">
                    {a.title}
                  </a>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-2">{a.summary}</p>
                  {a.arxiv_id && (
                    <Link href={explainHref(a.arxiv_id)} className="btn-primary mt-4 flex h-9 items-center justify-center text-sm">
                      Explain this paper →
                    </Link>
                  )}
                </li>
              ))}
            </ol>

            <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-3">Top 3 new findings</h2>
            <ol className="mt-3 grid gap-4">
              {result.findings.map((f, i) => (
                <li key={i} className="rounded-xl border border-line bg-white p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif text-2xl text-accent">{i + 1}</span>
                    <h3 className="font-serif text-xl leading-snug text-ink">{f.title}</h3>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">What’s new</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{f.what_is_new}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Why it matters</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{f.why_it_matters}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="text-accent-hover hover:underline">
                      Source ↗
                    </a>
                    {f.arxiv_id && (
                      <Link href={explainHref(f.arxiv_id)} className="font-medium text-accent-hover hover:underline">
                        Explain this paper →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
