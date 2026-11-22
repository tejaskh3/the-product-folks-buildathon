// Server-only: the reader's persona (who they are, which topics they follow) and their notifications.
// Stored in the local database (lib/db.ts). New personas start with a sample feed (lib/personaSamples.ts)
// so the bell and "For you" page are never empty; the research agent adds live items on top.
import { db } from "./db";
import type { ResearchResult } from "./research";
import { samplesFor } from "./personaSamples";

export interface Persona {
  owner: string;
  name: string;
  role: string;
  topics: string[];
}

export interface Notification {
  id: string;
  topic: string;
  kind: "article" | "finding";
  title: string;
  body: string;
  url: string | null;
  arxiv_id: string | null;
  /** "sample" = seeded starter item; "live" = found by the research agent. */
  origin: "sample" | "live";
  read: boolean;
  created_at: string;
}

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function getPersona(owner: string): Promise<Persona | null> {
  return must(await db().from("personas").select("owner, name, role, topics").eq("owner", owner).maybeSingle()) as Persona | null;
}

export async function savePersona(owner: string, p: { name: string; role: string; topics: string[] }): Promise<Persona> {
  const topics = [...new Set(p.topics.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
  const before = await getPersona(owner);
  must(await db().from("personas").upsert({ owner, name: p.name.trim().slice(0, 60), role: p.role.trim().slice(0, 80), topics }, { onConflict: "owner" }));
  // Seed a starter feed for topics that don't have one yet.
  const fresh = topics.filter((t) => !before?.topics.some((b) => b.toLowerCase() === t.toLowerCase()));
  if (fresh.length) {
    const rows = fresh.flatMap((t) =>
      samplesFor(t).map((s, i) => ({ ...s, owner, topic: t, origin: "sample", read: false, created_at: new Date(Date.now() - (i + 1) * 3600_000).toISOString() })),
    );
    must(await db().from("notifications").insert(rows));
  }
  return (await getPersona(owner))!;
}

export async function listNotifications(owner: string): Promise<Notification[]> {
  return must(
    await db()
      .from("notifications")
      .select("id, topic, kind, title, body, url, arxiv_id, origin, read, created_at")
      .eq("owner", owner)
      .order("created_at", { ascending: false })
      .limit(60),
  ) as Notification[];
}

export async function markAllRead(owner: string) {
  must(await db().from("notifications").update({ read: true }).eq("owner", owner).eq("read", false));
}

/** Turns a research result into unread notifications for this reader. */
export async function addResearch(owner: string, r: ResearchResult, topic: string) {
  const now = Date.now();
  const rows = [
    ...r.findings.map((f) => ({ kind: "finding", title: f.title, body: `${f.what_is_new} ${f.why_it_matters}`, url: f.source_url, arxiv_id: f.arxiv_id })),
    ...r.articles.map((a) => ({ kind: "article", title: a.title, body: `${a.source} · ${a.date}. ${a.summary}`, url: a.url, arxiv_id: a.arxiv_id })),
  ].map((n, i) => ({ ...n, owner, topic, origin: "live", read: false, created_at: new Date(now - i * 1000).toISOString() }));
  must(await db().from("notifications").insert(rows));
}
