"use client";

// /for-you — the reader's persona and their feed of what's new on the topics they follow.
// No persona yet → a short onboarding form. "Brief me" reads the latest aloud; "Refresh live"
// runs the research agent on a topic and adds its findings to the feed.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/persona/PageHeader";
import { Chip, FeedCard, Spinner, fetchPersona, runResearch, useProgressText, type PersonaState } from "@/components/persona/shared";

const SUGGESTED = ["AI", "Crypto", "Biotech", "Climate", "Quantum", "Finance"];
const MAX_TOPICS = 6;

export default function ForYouPage() {
  const [state, setState] = useState<PersonaState | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    fetchPersona()
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const onSaved = (s: PersonaState) => {
    setState(s);
    setEditing(false);
    window.dispatchEvent(new Event("curio:feed-changed"));
  };

  return (
    <div className="min-h-screen bg-paper">
      <PageHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        {error && <p className="mb-6 rounded-lg border border-line bg-white p-4 text-sm text-ink-2">{error}</p>}
        {!state ? (
          <p className="flex items-center gap-2 text-ink-2">
            <Spinner /> Loading your feed…
          </p>
        ) : !state.persona || editing ? (
          <PersonaForm initial={state.persona} onSaved={onSaved} onCancel={state.persona ? () => setEditing(false) : undefined} />
        ) : (
          <Feed state={state} reload={load} onEdit={() => setEditing(true)} />
        )}
      </main>
    </div>
  );
}

// ---- Onboarding / edit -------------------------------------------------------------------------

function PersonaForm({ initial, onSaved, onCancel }: { initial: PersonaState["persona"]; onSaved: (s: PersonaState) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [topics, setTopics] = useState<string[]>(initial?.topics ?? []);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (t: string) =>
    setTopics((cur) => (cur.some((c) => c.toLowerCase() === t.toLowerCase()) ? cur.filter((c) => c.toLowerCase() !== t.toLowerCase()) : cur.length >= MAX_TOPICS ? cur : [...cur, t]));
  const addCustom = () => {
    const t = custom.trim();
    if (t) toggle(t);
    setCustom("");
  };
  const all = [...SUGGESTED, ...topics.filter((t) => !SUGGESTED.some((s) => s.toLowerCase() === t.toLowerCase()))];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, role, topics }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn’t save.");
      onSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl">
      <h1 className="font-serif text-4xl text-ink sm:text-5xl">{initial ? "Edit your persona" : "Stay on the cutting edge"}</h1>
      <p className="mt-3 text-[15px] text-ink-2">Tell Curio who you are and what you follow. It watches those topics and tells you what’s new, by notification or out loud.</p>

      <label className="mt-8 block text-sm font-medium text-ink" htmlFor="p-name">
        Your name
      </label>
      <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. Tejas" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-white px-3 text-ink outline-none focus:border-accent" />

      <label className="mt-5 block text-sm font-medium text-ink" htmlFor="p-role">
        What you do <span className="font-normal text-ink-3">(optional)</span>
      </label>
      <input id="p-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="e.g. Founder, PhD student, investor" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-white px-3 text-ink outline-none focus:border-accent" />

      <p className="mt-6 text-sm font-medium text-ink">
        Topics you follow <span className="font-normal text-ink-3">(up to {MAX_TOPICS})</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {all.map((t) => (
          <Chip key={t} active={topics.some((c) => c.toLowerCase() === t.toLowerCase())} onClick={() => toggle(t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          maxLength={60}
          placeholder="Add your own, e.g. CRISPR, AI agents"
          className="h-10 flex-1 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
        />
        <button type="button" onClick={addCustom} disabled={!custom.trim() || topics.length >= MAX_TOPICS} className="btn-secondary h-10 px-4 text-sm disabled:opacity-50">
          Add
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="mt-8 flex gap-3">
        <button type="submit" disabled={busy || !name.trim() || !topics.length} className="btn-primary h-11 px-6 disabled:opacity-50">
          {busy ? "Saving…" : initial ? "Save" : "Start my feed"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary h-11 px-5">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---- The feed ----------------------------------------------------------------------------------

function Feed({ state, reload, onEdit }: { state: PersonaState; reload: () => void; onEdit: () => void }) {
  const persona = state.persona!;
  const [topic, setTopic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const progress = useProgressText(busy);

  const items = useMemo(() => state.notifications.filter((n) => !topic || n.topic.toLowerCase() === topic.toLowerCase()), [state.notifications, topic]);
  const unread = state.notifications.filter((n) => !n.read);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const briefMe = () => {
    const synth = window.speechSynthesis;
    if (!synth) return setError("This browser can’t speak. Try Chrome or Safari.");
    if (speaking) {
      synth.cancel();
      return setSpeaking(false);
    }
    const pool = unread.length ? unread : state.notifications;
    const top = pool.slice(0, 3).map((n) => n.title.replace(/^(Worth reading|Worth knowing|Start here|Tip):\s*/i, ""));
    const intro = unread.length ? `You have ${unread.length} new ${unread.length === 1 ? "update" : "updates"}.` : `Here's what's on your radar.`;
    const text = [`Hi ${persona.name}.`, intro, ...top.map((t, i) => `${["First", "Second", "Third"][i]}: ${t}.`), "Open Curio to dive deeper."].join(" ");
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  const refresh = async () => {
    const t = topic ?? persona.topics[0];
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await runResearch(t, true);
      setNote(`Added ${r.articles.length + r.findings.length} live updates on ${t}.`);
      reload();
      window.dispatchEvent(new Event("curio:feed-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The research agent failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-ink sm:text-5xl">Hi {persona.name}</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            {persona.role ? `${persona.role} · ` : ""}
            {unread.length ? `${unread.length} new on your topics` : "You’re all caught up"}
            {" · "}
            <button type="button" onClick={onEdit} className="text-accent-hover hover:underline">
              Edit persona
            </button>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={briefMe} className="btn-secondary h-10 px-4 text-sm" aria-pressed={speaking}>
            {speaking ? "■ Stop" : "🔊 Brief me"}
          </button>
          <button type="button" onClick={refresh} disabled={busy} className="btn-primary h-10 px-4 text-sm disabled:opacity-60">
            {busy ? "Researching…" : `⚡ Refresh live${topic ? `: ${topic}` : ""}`}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Chip active={!topic} onClick={() => setTopic(null)}>
          All
        </Chip>
        {persona.topics.map((t) => (
          <Chip key={t} active={topic === t} onClick={() => setTopic(t)}>
            {t}
          </Chip>
        ))}
      </div>

      {busy && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-sm text-ink-2" role="status">
          <Spinner /> {progress} <span className="text-ink-3">The research agent is searching the web for what’s new on {topic ?? persona.topics[0]}. About 40 seconds.</span>
        </div>
      )}
      {note && !busy && <p className="mt-6 rounded-xl border border-line bg-white p-4 text-sm text-ink">{note}</p>}
      {error && <p className="mt-6 rounded-xl border border-line bg-white p-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 grid gap-3">
        {items.length === 0 ? (
          <p className="rounded-xl border border-line bg-white p-6 text-ink-2">
            Nothing here yet. Hit <b>Refresh live</b> and the research agent will find what’s new.
          </p>
        ) : (
          items.map((n) => <FeedCard key={n.id} item={n} />)
        )}
      </div>

      <p className="mt-10 text-sm text-ink-3">
        Want a one-off deep dive instead?{" "}
        <Link href="/research" className="text-accent-hover hover:underline">
          Ask the research agent
        </Link>
        .
      </p>
    </>
  );
}
