// POST /api/research/save — {topic, result} → adds an already-fetched research result to the reader's feed,
// so "Add to my feed" on /research doesn't pay for the search twice.
import { requireUser } from "@/lib/playAuth";
import { json } from "@/lib/playServer";
import { addResearch, getPersona } from "@/lib/persona";
import type { ResearchResult } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const arxiv = (v: unknown) => (typeof v === "string" && /^[\w./-]{4,40}$/.test(v) ? v : null);

function clean(r: unknown): ResearchResult | null {
  const o = r as Partial<Record<keyof ResearchResult, unknown>> | null;
  if (!o || !Array.isArray(o.articles) || !Array.isArray(o.findings)) return null;
  return {
    topic: str(o.topic, 120),
    headline: str(o.headline),
    articles: (o.articles as Record<string, unknown>[]).slice(0, 3).map((a) => ({ title: str(a?.title, 300), source: str(a?.source, 120), date: str(a?.date, 40), url: str(a?.url, 1000), summary: str(a?.summary), arxiv_id: arxiv(a?.arxiv_id) })),
    findings: (o.findings as Record<string, unknown>[]).slice(0, 3).map((f) => ({ title: str(f?.title, 300), what_is_new: str(f?.what_is_new), why_it_matters: str(f?.why_it_matters), source_url: str(f?.source_url, 1000), arxiv_id: arxiv(f?.arxiv_id) })),
  };
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { topic?: unknown; result?: unknown };
  const topic = str(body.topic, 120).trim();
  const result = clean(body.result);
  if (!topic || !result) return json(400, "Nothing to save.");
  if (!(await getPersona(user.id))) return json(409, "Set up your persona first.");
  try {
    await addResearch(user.id, result, topic);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[research:save] failed", err);
    return json(500, "Couldn’t add this to your feed.");
  }
}
