// Big uploads (over 4 MB) against real Postgres and Storage: start → PUT to the signed URL →
// finish, who may finish which upload, the checks, and the cleanup cron. Skipped without local Supabase.
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localSupabase, useLocalSupabase } from "./localSupabase";

let USER: string | null = null;
vi.mock("@/lib/auth", () => ({ currentUser: async () => (USER ? { id: USER } : null), currentEmail: async () => null }));

const MB = 1024 * 1024;
/** A PDF-shaped buffer of about `mb` MB, unique each time (so its sha is too). */
const bigPdf = (mb: number) =>
  Buffer.concat([Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n2 0 obj << /Type /Page >> endobj\n`), Buffer.alloc(Math.round(mb * MB), 0x20)]);

function diagramData(title: string) {
  const ids = ["a", "b", "c"];
  return {
    title,
    caption: "c",
    tryHint: "t",
    html: `<svg viewBox="0 0 10 10">${ids.map((id) => `<g data-explore="${id}"><rect width="1" height="1"/></g>`).join("")}</svg>`,
    explorables: ids.map((id) => ({ id, label: id, blurb: "b", pages: [1], quote: "q" })),
  };
}

function libraryEntry(slug: string) {
  const scene = (i: number) => ({
    id: `s${i + 1}`,
    index: i,
    stage: "method" as const,
    title: `Scene ${i + 1}`,
    narration: "n",
    pages: [1],
    quote: "q",
    diagram: { id: `s${i + 1}`, ...diagramData(`Scene ${i + 1}`) },
  });
  return {
    slug,
    blurb: "A big paper.",
    walkthrough: { paper: { title: `Paper ${slug}`, authors: "A et al.", year: 2020 }, scenes: [0, 1, 2].map(scene) },
    suggestions: { title: `Paper ${slug}`, authors: "A et al.", year: 2020, questions: [{ title: "Why?", hook: "h", pages: [1], quote: "q" }] },
  };
}

describe.skipIf(!localSupabase)("big uploads (local Supabase)", { timeout: 30_000 }, () => {
  let db: typeof import("@/lib/db").db;

  beforeAll(async () => {
    useLocalSupabase();
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
    ({ db } = await import("@/lib/db"));
  });
  afterEach(() => {
    USER = null;
  });

  const signIn = () => (USER = `user_big_${randomUUID().slice(0, 8)}`);
  const post = (body: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function start(size = 5 * MB) {
    const { POST } = await import("@/app/api/play/upload/start/route");
    return POST(post({ size }));
  }
  async function finish(path: string, name = "thesis.pdf") {
    const { POST } = await import("@/app/api/play/upload/finish/route");
    return POST(post({ path, name }));
  }
  /** start + PUT, the way the browser does it. */
  async function staged(pdf: Buffer, claimedSize = pdf.length) {
    const res = await start(claimedSize);
    expect(res.status).toBe(200);
    const { path, signedUrl } = (await res.json()) as { path: string; signedUrl: string };
    const put = await fetch(signedUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: new Uint8Array(pdf) });
    return { path, put };
  }
  const stagedExists = async (path: string) => {
    const { data } = await db().storage.from("papers").download(path);
    return !!data;
  };

  it("start → PUT → finish creates the paper, stores it by sha, and removes the staged object", async () => {
    const me = signIn();
    const pdf = bigPdf(5);
    const { path, put } = await staged(pdf);
    expect(put.ok).toBe(true);
    expect(path).toMatch(new RegExp(`^incoming/${me}/[0-9a-f-]{36}\\.pdf$`));

    const res = await finish(path);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ key: expect.stringMatching(/^sha:/), name: "thesis.pdf", demo: false });

    const { sha256 } = await import("@/lib/pdfStore");
    const { data: row } = await db().from("papers").select("owner, pdf_sha256, name").eq("id", body.paperId).single();
    expect(row).toEqual({ owner: me, pdf_sha256: sha256(pdf), name: "thesis.pdf" });
    const { data: stored } = await db().storage.from("papers").download(`${sha256(pdf)}.pdf`);
    expect(stored?.size).toBe(pdf.length);
    expect(await stagedExists(path)).toBe(false);
  });

  it("the same response shape as the one-request upload, and re-uploading reopens the same row", async () => {
    signIn();
    const pdf = bigPdf(4.5);
    const first = await (await finish((await staged(pdf)).path)).json();
    const again = await (await finish((await staged(pdf)).path)).json();
    expect(again).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(["demo", "key", "name", "paperId", "suggestions"]);
  });

  it("start needs a signed-in user, and turns away files over 15 MB up front", async () => {
    expect((await start()).status).toBe(401);
    signIn();
    expect((await start(16 * MB)).status).toBe(413);
  });

  it("someone else's staged upload can't be finished", async () => {
    signIn();
    const { path } = await staged(bigPdf(4.5));
    signIn(); // another user
    expect((await finish(path)).status).toBe(404);
    expect(await stagedExists(path)).toBe(true); // still the owner's to finish
  });

  it("a staged upload finishes once", async () => {
    signIn();
    const { path } = await staged(bigPdf(4.5));
    expect((await finish(path)).status).toBe(200);
    expect((await finish(path)).status).toBe(404);
  });

  it("paths Curio didn't hand out are refused", async () => {
    signIn();
    expect((await finish(`${"a".repeat(64)}.pdf`)).status).toBe(400);
    expect((await finish(`incoming/${USER}/../../x.pdf`)).status).toBe(400);
    expect((await finish(`incoming/${USER}/${randomUUID()}.pdf`)).status).toBe(404);
  });

  it("a staged upload that never arrived reads as interrupted", async () => {
    signIn();
    const { path } = (await (await start()).json()) as { path: string };
    expect((await finish(path)).status).toBe(409);
  });

  it("bytes that aren't a PDF are refused, and the staged object is removed", async () => {
    signIn();
    // Storage only takes application/pdf, but the bytes are whatever the browser sends.
    const notPdf = Buffer.concat([Buffer.from("<html>"), Buffer.alloc(5 * MB, 0x20)]);
    const { path, put } = await staged(notPdf);
    expect(put.ok).toBe(true);
    const res = await finish(path);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/isn’t a PDF/);
    expect(await stagedExists(path)).toBe(false);
  });

  it("over 15 MB: Storage refuses the PUT, and finish refuses what got through", async () => {
    signIn();
    const { put } = await staged(bigPdf(15.5), 5 * MB); // a browser that lies about the size
    expect(put.ok).toBe(false);
    expect(await put.text()).toMatch(/EntityTooLarge|413/);

    // If the bucket limit were ever looser, finish still checks the size itself.
    const { checkPdf } = await import("@/lib/paperSource");
    const { MAX_PDF_BYTES } = await import("@/lib/uploadLimits");
    expect(() => checkPdf(bigPdf(15.5), MAX_PDF_BYTES)).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("a big library PDF opens the shared copy, with no new row", async () => {
    const lib = await import("@/lib/library");
    const pdf = bigPdf(5);
    const { id } = await lib.importLibraryPaper(libraryEntry(`big-${randomUUID().slice(0, 8)}`), pdf);
    const me = signIn();
    const { path } = await staged(pdf);
    const body = await (await finish(path)).json();
    expect(body).toMatchObject({ paperId: id, library: true, demo: true });
    expect(body.suggestions.questions[0].title).toBe("Why?");
    expect((await db().from("papers").select("id").eq("owner", me)).data).toEqual([]);
    expect(await stagedExists(path)).toBe(false);
  });

  describe("cleanup cron", () => {
    const cron = async (auth?: string) => {
      const { GET } = await import("@/app/api/cron/uploads/route");
      return GET(new Request("http://x", { headers: auth ? { authorization: auth } : {} }));
    };

    it("needs the cron secret", async () => {
      process.env.CRON_SECRET = "s3cret";
      expect((await cron()).status).toBe(401);
      expect((await cron("Bearer wrong")).status).toBe(401);
      delete process.env.CRON_SECRET;
      expect((await cron("Bearer ")).status).toBe(401);
    });

    it("removes staged uploads older than a day, and leaves fresh ones", async () => {
      process.env.CRON_SECRET = "s3cret";
      signIn();
      const old = await staged(bigPdf(4.5));
      const fresh = await staged(bigPdf(4.5));
      await db()
        .from("staged_uploads")
        .update({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
        .eq("path", old.path);

      const res = await cron("Bearer s3cret");
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBeGreaterThanOrEqual(1);
      expect(await stagedExists(old.path)).toBe(false);
      expect((await db().from("staged_uploads").select("path").eq("path", old.path)).data).toEqual([]);
      expect(await stagedExists(fresh.path)).toBe(true);
      expect((await finish(fresh.path)).status).toBe(200);
      delete process.env.CRON_SECRET;
    });
  });
});
