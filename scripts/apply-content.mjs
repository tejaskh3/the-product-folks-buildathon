// Merge hand-written walkthrough content (plain-words text, sections, citation, key ideas)
// into the Google demo walkthrough: both the bundled JSON and the saved Supabase row.
// No model calls. Idempotent: re-running with the same content changes nothing.
//
//   node --env-file=.env scripts/apply-content.mjs [--dry]

import { readFile, writeFile } from "node:fs/promises";

const CONTENT = "content/google.json";
const DEMO = "public/demo/walkthrough-google.json";
const PAPER_ID = "88c75ec0-fee6-412c-bc5c-ee7f8a157f0d";
const dry = process.argv.includes("--dry");

function merge(walkthrough, content) {
  const scenes = walkthrough.scenes.map((sc) => {
    const c = content.scenes?.[sc.id];
    if (!c) return sc;
    return {
      ...sc,
      ...(c.explanation ? { explanation: c.explanation.trim() } : {}),
      ...(c.section ? { section: c.section.trim() } : {}),
    };
  });
  const ids = new Set(scenes.map((s) => s.id));
  const takeaways = (content.takeaways ?? []).filter((t) => t.idea && t.tryIt && ids.has(t.sceneId));
  return {
    ...walkthrough,
    scenes,
    ...(content.citation ? { citation: content.citation.trim() } : {}),
    ...(takeaways.length ? { takeaways } : {}),
  };
}

const content = JSON.parse(await readFile(CONTENT, "utf8"));

// 1. Bundled demo file (what the instant demo stream serves).
const demo = JSON.parse(await readFile(DEMO, "utf8"));
const merged = merge(demo, content);
const covered = merged.scenes.filter((s) => s.explanation).length;
console.log(`demo file: ${covered}/${merged.scenes.length} scenes with explanation, ${merged.takeaways?.length ?? 0} key ideas`);
if (!dry) await writeFile(DEMO, JSON.stringify(merged, null, 2) + "\n");

// 2. Saved Supabase row (what /play/<id> and "Your papers" load).
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const rowRes = await fetch(`${url}/rest/v1/papers?id=eq.${PAPER_ID}&select=walkthrough`, { headers });
const [row] = await rowRes.json();
if (!row?.walkthrough) throw new Error(`paper ${PAPER_ID} not found or has no walkthrough`);
const mergedRow = merge(row.walkthrough, content);
if (!dry) {
  const res = await fetch(`${url}/rest/v1/papers?id=eq.${PAPER_ID}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ walkthrough: mergedRow, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`supabase PATCH ${res.status}: ${await res.text()}`);
}
console.log(`supabase row: ${mergedRow.scenes.filter((s) => s.explanation).length}/${mergedRow.scenes.length} scenes with explanation${dry ? " (dry run)" : " — saved"}`);
