// Server-only: putting a finished paper into the library (scripts/import-library.ts).
//
//   walkthrough + suggestions ──► libraryProblems (the same diagram checks live papers pass)
//        └─ ok ──► store the PDF ──► one shared papers row: is_public, owner null, plan + walkthrough + suggestions
//
// Readers' questions on it are saved as their own private nodes (see nodeOwner in lib/db.ts).
import { createHash } from "node:crypto";
import { db, type WalkthroughPlanRow } from "./db";
import { hardProblems, repair } from "./playServer";
import type { Suggestions } from "./playPrompts";
import { storePdf } from "./pdfStore";
import { STAGES } from "./walkthroughPrompts";
import { withoutDiagram, type Walkthrough } from "./walkthrough";

export interface LibraryEntry {
  /** URL-friendly name, unique in the library, e.g. "attention-is-all-you-need". */
  slug: string;
  /** Order on /library (lowest first). */
  rank?: number;
  /** One line under the title on /library. */
  blurb?: string;
  arxiv?: string;
  walkthrough: Walkthrough & { motif?: string };
  suggestions?: Suggestions | null;
  /** Paper keys of older public rows this entry takes over (e.g. a pre-v1 demo row). */
  replaces?: string[];
}

/** Everything that would stop this paper going into the library. Empty means it can go in. */
export function libraryProblems(e: LibraryEntry): string[] {
  const out: string[] = [];
  const w = e.walkthrough;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug ?? "")) out.push(`slug "${e.slug}" must be lowercase words joined by dashes`);
  if (!w?.paper?.title?.trim()) out.push("walkthrough.paper.title is missing");
  if (!w?.scenes?.length) out.push("the walkthrough has no scenes");
  const ids = new Set<string>();
  (w?.scenes ?? []).forEach((s, i, all) => {
    const at = `scene ${i + 1} (${s.id})`;
    if (!/^s\d+$/.test(s.id ?? "") || ids.has(s.id)) out.push(`${at}: ids must be unique, like s1, s2, …`);
    ids.add(s.id);
    if (!Number.isInteger(s.index) || (i > 0 && s.index <= all[i - 1].index)) out.push(`${at}: index must increase scene by scene`);
    if (!STAGES.includes(s.stage)) out.push(`${at}: unknown stage "${s.stage}"`);
    if (!s.title?.trim() || !s.narration?.trim()) out.push(`${at}: needs a title and narration`);
    if (!s.diagram) return void out.push(`${at}: has no diagram`);
    if (s.diagram.id !== s.id) out.push(`${at}: diagram.id must be "${s.id}"`);
    for (const p of hardProblems(repair(s.diagram), false)) out.push(`${at}: ${p}`);
  });
  const q = e.suggestions?.questions;
  if (q && (!Array.isArray(q) || q.some((x) => !x.title?.trim()))) out.push("suggestions.questions must each have a title");
  return out;
}

/** Saves (or replaces) the library copy of a paper. Returns its id. Throws on any libraryProblems. */
export async function importLibraryPaper(e: LibraryEntry, pdf: Buffer): Promise<{ id: string; created: boolean }> {
  const problems = libraryProblems(e);
  if (problems.length) throw new Error(`Not importable:\n- ${problems.join("\n- ")}`);

  const sha = createHash("sha256").update(pdf).digest("hex");
  await storePdf(pdf);
  const arxiv = e.arxiv?.replace(/v\d+$/, "") ?? null;
  const key = arxiv ? `arxiv:${arxiv}` : `sha:${sha}`;
  const w = e.walkthrough;
  // Repairs that need no redraw (stray data-explore attributes, unmatched explorables), as live papers get.
  const scenes = w.scenes.map((s) => ({ ...s, diagram: { ...s.diagram, ...repair(s.diagram) } }));
  const plan: WalkthroughPlanRow = { paper: w.paper, motif: w.motif ?? "", scenes: scenes.map(withoutDiagram) };
  const walkthrough: Walkthrough = {
    paper: w.paper,
    scenes,
    ...(w.citation ? { citation: w.citation } : {}),
    ...(w.takeaways?.length ? { takeaways: w.takeaways } : {}),
  };

  // The same paper already in the library (by slug, key, hash, or an older key it replaces) is updated in place,
  // so links to it keep working.
  const ors = [`library_slug.eq.${e.slug}`, `paper_key.eq.${key}`, `pdf_sha256.eq.${sha}`, ...(e.replaces ?? []).map((k) => `paper_key.eq.${k}`)];
  const { data: found, error: fErr } = await db().from("papers").select("id").eq("is_public", true).or(ors.join(",")).order("created_at").limit(1);
  if (fErr) throw new Error(fErr.message);

  const row = {
    owner: null,
    is_public: true,
    paper_key: key,
    name: `${e.slug}.pdf`,
    title: w.paper.title,
    authors: w.paper.authors,
    year: w.paper.year ?? null,
    arxiv_id: arxiv,
    pdf_sha256: sha,
    walkthrough,
    walkthrough_plan: plan,
    suggestions: e.suggestions ?? null,
    library_slug: e.slug,
    library_rank: e.rank ?? null,
    library_blurb: e.blurb ?? null,
    drawing_until: null,
    updated_at: new Date().toISOString(),
  };
  if (found?.length) {
    const id = found[0].id as string;
    const { error } = await db().from("papers").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return { id, created: false };
  }
  const { data, error } = await db().from("papers").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, created: true };
}
