// Puts finished papers into the library. Each entry is checked like a live paper first;
// nothing is saved if any scene fails.
//
//   npx tsx --env-file=.env scripts/import-library.ts library/attention.json [more.json …] [--dry-run] [--suggest]
//
// --suggest: an entry without suggested questions gets them from the model now (~$0.01),
// so no reader ever pays for them.
//
// An entry (library/<slug>.json):
//   { "slug": "attention-is-all-you-need", "rank": 1, "blurb": "…",
//     "arxiv": "1706.03762"            ← or "pdf": "path/to/paper.pdf"
//     "walkthrough": "public/demo/walkthrough.json"   ← a path, or the walkthrough itself
//     "suggestions": { … } | omitted (taken from the walkthrough file's "suggestions" if it has them)
//     "replaces": ["file:…"] }         ← older public rows this one takes over
//
// Make the walkthrough with scripts/walkthrough.ts (or Claude Code), then import it here.
import fs from "node:fs";
import path from "node:path";
import { importLibraryPaper, libraryProblems, type LibraryEntry } from "../lib/library";
import { structuredCall } from "../lib/llm";
import { SUGGEST_PROMPT, SUGGEST_SCHEMA, type Suggestions } from "../lib/playPrompts";
import { MAX_ARXIV_BYTES, checkPdf, fetchArxivPdf } from "../lib/paperSource";

type EntryFile = Omit<LibraryEntry, "walkthrough"> & { pdf?: string; walkthrough: string | LibraryEntry["walkthrough"] };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const suggest = args.includes("--suggest");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("Usage: scripts/import-library.ts library/<slug>.json […] [--dry-run]");
  process.exit(1);
}

async function main() {
  let failed = 0;
  for (const file of files) {
    const base = path.dirname(path.resolve(file));
    const at = (p: string) => (path.isAbsolute(p) ? p : fs.existsSync(path.resolve(p)) ? path.resolve(p) : path.join(base, p));
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as EntryFile;
      const walkthrough = typeof raw.walkthrough === "string" ? JSON.parse(fs.readFileSync(at(raw.walkthrough), "utf8")) : raw.walkthrough;
      const entry: LibraryEntry = { ...raw, walkthrough, suggestions: raw.suggestions ?? walkthrough.suggestions ?? null };
      const problems = libraryProblems(entry);
      if (problems.length) throw new Error(`fails the checks:\n  - ${problems.join("\n  - ")}`);

      const pdf = raw.pdf ? fs.readFileSync(at(raw.pdf)) : raw.arxiv ? await fetchArxivPdf(raw.arxiv) : null;
      if (!pdf) throw new Error(`needs "arxiv" or "pdf"`);
      checkPdf(pdf, MAX_ARXIV_BYTES);
      if (!entry.suggestions && suggest && !dryRun) {
        const paper = { filename: `${entry.slug}.pdf`, data: `data:application/pdf;base64,${pdf.toString("base64")}` };
        const { data, usage } = await structuredCall<Suggestions>({ paper, prompt: SUGGEST_PROMPT, schema: SUGGEST_SCHEMA, effort: "low", maxTokens: 16000 });
        entry.suggestions = { ...data, questions: data.questions.slice(0, 4) };
        console.log(`  ${entry.slug}: suggested questions made ($${usage.cost_usd.toFixed(4)})`);
      }
      if (!entry.suggestions) console.warn(`  ${entry.slug}: no suggested questions (pass --suggest to make them)`);

      if (dryRun) {
        console.log(`✓ ${entry.slug}: ${walkthrough.scenes.length} scenes pass (dry run, nothing saved)`);
        continue;
      }
      const { id, created } = await importLibraryPaper(entry, pdf);
      console.log(`✓ ${entry.slug}: ${created ? "added" : "updated"} → /play/${id}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
