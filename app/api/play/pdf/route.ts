// GET /api/play/pdf?arxiv=ID — same-origin proxy so the paper panel can render
// arXiv PDFs (arXiv sends no CORS headers). Streams the upstream body through.
import { arxivId, json } from "@/lib/playServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const id = arxivId(new URL(req.url).searchParams.get("arxiv") ?? "");
  if (!id) return json(400, "Missing arXiv id.");
  const res = await fetch(`https://arxiv.org/pdf/${id}`, { headers: { "user-agent": "Curio/1.0" }, redirect: "follow" });
  if (!res.ok || !res.body) return json(502, `arXiv returned ${res.status}.`);
  return new Response(res.body, {
    headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" },
  });
}
