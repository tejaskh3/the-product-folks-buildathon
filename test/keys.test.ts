// lib/keys.ts: AES-256-GCM round trip, tamper detection, wrong secret, rotation, and the key format check.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptKey, encryptKey, looksLikeOpenRouterKey } from "@/lib/keys";

const KEY = "sk-or-v1-" + "a".repeat(64);

beforeAll(() => {
  process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
  process.env.KEY_ENCRYPTION_SECRET_V2 = randomBytes(32).toString("base64");
});

describe("key encryption", () => {
  it("round-trips, and never stores the key in plain text", () => {
    const { ciphertext, version } = encryptKey(KEY);
    expect(version).toBe(1);
    expect(ciphertext).not.toContain("sk-or");
    expect(decryptKey(ciphertext, version)).toBe(KEY);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptKey(KEY).ciphertext).not.toBe(encryptKey(KEY).ciphertext);
  });

  it("rejects a tampered ciphertext", () => {
    const { ciphertext } = encryptKey(KEY);
    const buf = Buffer.from(ciphertext, "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptKey(buf.toString("base64"), 1)).toThrow();
  });

  it("rejects the wrong secret", () => {
    const { ciphertext } = encryptKey(KEY, 1);
    expect(() => decryptKey(ciphertext, 2)).toThrow();
  });

  it("keeps old rows readable after rotating to a new version", () => {
    const old = encryptKey(KEY, 1);
    const fresh = encryptKey(KEY, 2);
    expect(decryptKey(old.ciphertext, 1)).toBe(KEY);
    expect(decryptKey(fresh.ciphertext, 2)).toBe(KEY);
  });

  it("refuses to run with a missing or wrong-length secret", () => {
    const saved = process.env.KEY_ENCRYPTION_SECRET;
    process.env.KEY_ENCRYPTION_SECRET = Buffer.from("short").toString("base64");
    expect(() => encryptKey(KEY, 1)).toThrow(/32 bytes/);
    delete process.env.KEY_ENCRYPTION_SECRET;
    expect(() => encryptKey(KEY, 1)).toThrow(/not set/);
    process.env.KEY_ENCRYPTION_SECRET = saved;
  });
});

describe("looksLikeOpenRouterKey", () => {
  it.each([
    [KEY, true],
    ["sk-or-v1-short", false],
    ["sk-ant-api03-" + "a".repeat(40), false],
    ["", false],
  ])("%s → %s", (k, ok) => expect(looksLikeOpenRouterKey(k)).toBe(ok));
});
