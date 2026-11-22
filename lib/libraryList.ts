// Server-only: the library's papers, for /library and the shelf's Library tab.
import { db } from "./db";

export interface LibraryPaper {
  id: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  blurb: string | null;
  scenes: number;
}

export async function listLibrary(): Promise<LibraryPaper[]> {
  const { data, error } = await db()
    .from("papers")
    .select("id, title, authors, year, library_blurb, walkthrough_plan")
    .eq("is_public", true)
    .not("walkthrough", "is", null)
    .order("library_rank", { ascending: true, nullsFirst: false })
    .order("year", { ascending: false });
  if (error) throw new Error(error.message);
  // The plan, not the walkthrough: same scene count without loading every diagram.
  type Row = Omit<LibraryPaper, "blurb" | "scenes"> & { library_blurb: string | null; walkthrough_plan: { scenes: unknown[] } | null };
  return (data as Row[]).map((p) => ({ id: p.id, title: p.title, authors: p.authors, year: p.year, blurb: p.library_blurb, scenes: p.walkthrough_plan?.scenes.length ?? 0 }));
}
