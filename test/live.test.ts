// Opt-in live smoke test: the real model, through the real routes, into local Supabase.
// Costs one walkthrough (~$0.12 on Haiku 5.5). Run with:
//   LIVE_E2E=1 npx vitest run test/live.test.ts
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const live = process.env.LIVE_E2E === "1";
const USER = `user_live_${randomUUID().slice(0, 8)}`;
vi.mock("@/lib/auth", () => ({ currentUser: async () => ({ id: USER }), currentEmail: async () => null }));

describe.skipIf(!live)("live: arXiv paper → walkthrough → saved", () => {
  it("draws and saves a full walkthrough with the real model", async () => {
    const env = execSync("npx -y supabase@latest status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    process.env.SUPABASE_URL = env.match(/^API_URL="([^"]+)"/m)![1];
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.match(/^SERVICE_ROLE_KEY="([^"]+)"/m)![1];
    // Real key from .env.
    process.env.OPENROUTER_API_KEY = readFileSync(".env", "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m)![1].trim();

    const upload = await import("@/app/api/play/upload/route");
    const up = await upload.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ arxiv: "1512.03385" }) }));
    expect(up.status).toBe(200);
    const { paperId } = (await up.json()) as { paperId: string };

    const walk = await import("@/app/api/play/walkthrough/route");
    const res = await walk.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ paperId }) }));
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    const errors = events.filter((e) => e.type === "error");
    console.log(events.map((e) => e.type).join(" "), errors);

    const { db } = await import("@/lib/db");
    const { data } = await db().from("papers").select("title, walkthrough, walkthrough_plan").eq("id", paperId).single();
    console.log(`"${data!.title}": ${data!.walkthrough?.scenes.length}/${data!.walkthrough_plan?.scenes.length} scenes saved`);
    expect(data!.walkthrough.scenes.length).toBe(data!.walkthrough_plan.scenes.length);
    const { data: usage } = await db().from("usage_events").select("step, cost_usd, cached_tokens").eq("paper_id", paperId);
    console.log(`${usage!.length} calls, $${usage!.reduce((n, u) => n + Number(u.cost_usd), 0).toFixed(3)}`);
  }, 600_000);
});
