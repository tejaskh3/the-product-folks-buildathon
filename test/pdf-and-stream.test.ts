// Pure helpers: PDF checks (lib/paperSource, lib/pdfStore) and the NDJSON stream (lib/ndjson).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ndjsonResponse } from "@/lib/ndjson";
import { PaperUnavailable, checkPdf } from "@/lib/paperSource";
import { pageCount, sha256 } from "@/lib/pdfStore";

const attention = readFileSync(path.join(__dirname, "..", "public", "demo", "attention.pdf"));

/** A minimal PDF-shaped buffer with `n` page objects. */
const fakePdf = (n: number) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${n} >> endobj\n${Array.from({ length: n }, (_, i) => `${i + 2} 0 obj << /Type /Page >> endobj`).join("\n")}`);

describe("pageCount", () => {
  it("counts page objects, not the page tree", () => {
    expect(pageCount(fakePdf(3))).toBe(3);
  });

  it("reads a real paper", () => {
    // Attention Is All You Need: 15 pages.
    expect(pageCount(attention)).toBe(15);
  });
});

describe("checkPdf", () => {
  it("accepts a normal paper", () => {
    expect(() => checkPdf(attention, 15 * 1024 * 1024)).not.toThrow();
  });

  it("rejects bytes that aren't a PDF", () => {
    expect(() => checkPdf(Buffer.from("<html>"), 1e6)).toThrow(PaperUnavailable);
  });

  it("rejects a PDF over the size limit with 413", () => {
    expect(() => checkPdf(attention, 1000)).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("rejects a PDF over 60 pages", () => {
    expect(() => checkPdf(fakePdf(61), 1e6)).toThrow(/61 pages/);
    expect(() => checkPdf(fakePdf(60), 1e6)).not.toThrow();
  });
});

describe("sha256", () => {
  it("is stable for the same bytes", () => {
    expect(sha256(attention)).toBe(sha256(Buffer.from(attention)));
    expect(sha256(attention)).toMatch(/^[0-9a-f]{64}$/);
  });
});

async function lines(res: Response) {
  return (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("ndjsonResponse", () => {
  it("streams one JSON line per event with NDJSON headers", async () => {
    const res = ndjsonResponse<{ n: number }>(async (send) => {
      send({ n: 1 });
      send({ n: 2 });
    });
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await lines(res)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("sends heartbeats while the job is quiet, and skips null ones", async () => {
    vi.useFakeTimers();
    let beat = 0;
    const res = ndjsonResponse<{ beat?: number; end?: boolean }>(
      async (send) => {
        await new Promise((r) => setTimeout(r, 46_000));
        send({ end: true });
      },
      () => (++beat === 2 ? null : { beat }),
    );
    const text = res.text();
    await vi.advanceTimersByTimeAsync(46_000);
    vi.useRealTimers();
    const out = (await text).trim().split("\n").map((l) => JSON.parse(l));
    expect(out).toEqual([{ beat: 1 }, { beat: 3 }, { end: true }]);
  });

  it("closes the stream when the job throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = ndjsonResponse<{ n: number }>(async (send) => {
      send({ n: 1 });
      throw new Error("bug");
    });
    expect(await lines(res)).toEqual([{ n: 1 }]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
