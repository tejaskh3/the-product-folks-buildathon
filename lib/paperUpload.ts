// Server-only: what every upload does once it has checked bytes, whichever way they arrived
// (one request, arXiv, or a big PDF staged in Storage). Returns the upload response.
//
//   bytes ──► sha256 ──► library paper? ──► { paperId: the shared copy } (anyone; no new row)
//                          │
//                          ├─ demo? ──signed out──► { key, demo } (no row, no storage)
//                          └─signed in──► store PDF ──► upsert papers row (owner, key) ──► { paperId, key }
//
// Uploading a paper the user already has reopens it: same key, same row, nothing regenerated.
import { createHash } from "node:crypto";
import { db, libraryPaper } from "./db";
import { signInRequired } from "./playAuth";
import { json } from "./playServer";
import { currentEmail, type SignedInUser } from "./auth";
import { findDemo } from "./walkthroughServer";
import { storePdf } from "./pdfStore";
import { withoutDiagram, type Walkthrough } from "./walkthrough";

export async function openUploadedPaper(opts: { user: SignedInUser | null; pdf: Buffer; name: string; arxiv: string | null }): Promise<Response> {
  const { user, pdf, name, arxiv } = opts;
  const sha = createHash("sha256").update(pdf).digest("hex");
  const key = arxiv ? `arxiv:${arxiv}` : `sha:${sha}`;

  // In the library: everyone reads the one shared copy. Questions on it are saved per reader.
  const lib = await libraryPaper({ key, sha }).catch(() => null);
  if (lib) {
    return Response.json(
      { paperId: lib.id, key: lib.paper_key, name: lib.title || name, demo: true, library: true, suggestions: lib.suggestions },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const demo = await findDemo({ arxiv, pdfSha: sha });
  const suggestions = demo?.suggestions ?? null;

  // Pre-generated demo papers open for everyone, with no storage or paid calls.
  if (!user) {
    if (!demo) return signInRequired();
    return Response.json({ paperId: null, key, name, demo: true, suggestions }, { headers: { "cache-control": "no-store" } });
  }

  try {
    await storePdf(pdf);
    const { data, error } = await db()
      .from("papers")
      .upsert(
        {
          owner: user.id,
          email: await currentEmail().catch(() => null),
          paper_key: key,
          name: name.slice(0, 300),
          arxiv_id: arxiv,
          pdf_sha256: sha,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner,paper_key" },
      )
      .select("id, walkthrough")
      .single();
    if (error) throw new Error(error.message);

    // A demo paper starts from its pre-generated walkthrough, so opening it costs nothing.
    if (demo && !data.walkthrough) {
      const walkthrough: Walkthrough = {
        paper: demo.paper,
        scenes: demo.scenes,
        ...(demo.citation ? { citation: demo.citation } : {}),
        ...(demo.takeaways?.length ? { takeaways: demo.takeaways } : {}),
      };
      const plan = { paper: demo.paper, motif: demo.motif ?? "", scenes: demo.scenes.map(withoutDiagram) };
      const { error: wErr } = await db()
        .from("papers")
        .update({ walkthrough, walkthrough_plan: plan, title: demo.paper.title, authors: demo.paper.authors, year: demo.paper.year ?? null })
        .eq("id", data.id);
      if (wErr) throw new Error(wErr.message);
    }
    return Response.json({ paperId: data.id, key, name, demo: !!demo, suggestions }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[play:upload] saving the paper failed", err);
    return json(502, "Couldn’t save the paper. Please try again.");
  }
}
