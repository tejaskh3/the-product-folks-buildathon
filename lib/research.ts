// Server-only: the research agent. One Claude Opus call with live web search finds what's new on a
// topic and returns the top 3 articles and top 3 new findings, each linked to its source.
//
//   research("crypto") ──► messages.stream (web_search_20260209, JSON-schema output)
//        ├─ stop_reason "pause_turn" → send the turn back and let it continue (server-tool loop)
//        └─ final text → parsed against RESEARCH_SCHEMA
import Anthropic from "@anthropic-ai/sdk";

export interface ResearchArticle {
  title: string;
  source: string;
  date: string;
  url: string;
  summary: string;
  /** arXiv id when the article is a paper, so Curio can explain it. */
  arxiv_id: string | null;
}

export interface ResearchFinding {
  title: string;
  what_is_new: string;
  why_it_matters: string;
  source_url: string;
  arxiv_id: string | null;
}

export interface ResearchResult {
  topic: string;
  headline: string;
  articles: ResearchArticle[];
  findings: ResearchFinding[];
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "headline", "articles", "findings"],
  properties: {
    topic: { type: "string" },
    headline: { type: "string" },
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "source", "date", "url", "summary", "arxiv_id"],
        properties: {
          title: { type: "string" },
          source: { type: "string" },
          date: { type: "string" },
          url: { type: "string" },
          summary: { type: "string" },
          arxiv_id: nullableString,
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "what_is_new", "why_it_matters", "source_url", "arxiv_id"],
        properties: {
          title: { type: "string" },
          what_is_new: { type: "string" },
          why_it_matters: { type: "string" },
          source_url: { type: "string" },
          arxiv_id: nullableString,
        },
      },
    },
  },
} as const;

const SYSTEM = `You are Curio's research agent. A reader names a topic; you find what is genuinely new and cutting-edge on it right now, using web search.

Return exactly:
- headline: one sentence on the state of the topic this month.
- articles: the 3 most important recent articles or papers (prefer the last few months; prefer primary sources such as papers, official announcements and serious reporting over listicles). summary is one or two plain sentences.
- findings: the 3 most significant new findings, results or developments. what_is_new says concretely what changed; why_it_matters says who it affects and how. source_url links to where it was reported.

Rules: every url and source_url must be a real page you saw in your search results. Give dates as "Mon YYYY" (or "YYYY" if only the year is known). Set arxiv_id (e.g. "2406.01234", no version suffix) only when the item is an arXiv paper you saw; otherwise null. Write plainly for a smart non-expert.`;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const MAX_CONTINUATIONS = 4;

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

export async function research(topic: string): Promise<ResearchResult> {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: "user", content: `Topic: ${topic}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Find what's cutting-edge on this topic now.` },
  ];

  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const msg = await client()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: "low", format: { type: "json_schema", schema: RESEARCH_SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming)
      .finalMessage();

    if (msg.stop_reason === "pause_turn") {
      // A long server-tool turn paused: hand it back unchanged so it carries on.
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      continue;
    }
    if (msg.stop_reason === "refusal") throw new Error("The research agent declined this topic. Try another one.");
    if (msg.stop_reason === "max_tokens") throw new Error("The research ran too long. Try a narrower topic.");

    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const out = JSON.parse(json) as ResearchResult;
    out.articles = out.articles.slice(0, 3);
    out.findings = out.findings.slice(0, 3);
    return out;
  }
  throw new Error("The research agent took too many steps. Try again.");
}
