// Server-only: users' own OpenRouter keys, encrypted with AES-256-GCM before they reach the database.
//
//   stored = base64( iv[12] | tag[16] | ciphertext ),  key_version = which secret encrypted it
//
// Secrets live only in env: KEY_ENCRYPTION_SECRET (version 1), KEY_ENCRYPTION_SECRET_V2, … each a
// base64-encoded 32-byte key. To rotate: add the next version, set KEY_ENCRYPTION_VERSION to it;
// old rows still decrypt with their own version and are re-encrypted when the user saves again.
// A database dump alone can't reveal a key, and only the last 4 characters ever leave the server.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function secret(version: number): Buffer {
  const raw = version === 1 ? process.env.KEY_ENCRYPTION_SECRET : process.env[`KEY_ENCRYPTION_SECRET_V${version}`];
  if (!raw) throw new Error(`Key encryption secret v${version} is not set`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`Key encryption secret v${version} must be 32 bytes (base64)`);
  return key;
}

const currentVersion = () => Number(process.env.KEY_ENCRYPTION_VERSION ?? 1);

export function encryptKey(plain: string, version = currentVersion()): { ciphertext: string; version: number } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secret(version), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64"), version };
}

/** Throws if the ciphertext was changed or the secret is wrong (GCM authenticates both). */
export function decryptKey(ciphertext: string, version: number): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", secret(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

export const looksLikeOpenRouterKey = (k: string) => /^sk-or-[A-Za-z0-9_-]{20,200}$/.test(k);

export interface KeyInfo {
  last4: string;
  updatedAt: string;
}

export async function saveUserKey(owner: string, key: string): Promise<KeyInfo> {
  const { ciphertext, version } = encryptKey(key);
  const row = { owner, provider: "openrouter", ciphertext, key_version: version, last4: key.slice(-4), updated_at: new Date().toISOString() };
  const { error } = await db().from("api_keys").upsert(row, { onConflict: "owner" });
  if (error) throw new Error(`Couldn’t save the key: ${error.message}`);
  return { last4: row.last4, updatedAt: row.updated_at };
}

export async function deleteUserKey(owner: string): Promise<void> {
  const { error } = await db().from("api_keys").delete().eq("owner", owner);
  if (error) throw new Error(`Couldn’t delete the key: ${error.message}`);
}

export async function userKeyInfo(owner: string): Promise<KeyInfo | null> {
  const { data, error } = await db().from("api_keys").select("last4, updated_at").eq("owner", owner).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { last4: data.last4, updatedAt: data.updated_at } : null;
}

/** The user's key in plain text, for one generation. Null when they have none. */
export async function userKey(owner: string): Promise<string | null> {
  const { data, error } = await db().from("api_keys").select("ciphertext, key_version").eq("owner", owner).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? decryptKey(data.ciphertext, data.key_version) : null;
}

/** What OpenRouter says about a key: valid, and how much credit it has left (null = no limit). */
export async function checkOpenRouterKey(key: string): Promise<{ ok: true; creditLeft: number | null } | { ok: false; reason: "invalid" | "no_credit" | "unreachable" }> {
  // Curio now calls Anthropic directly with the platform key; only real OpenRouter keys are checked here.
  if (!key.startsWith("sk-or-")) return { ok: true, creditLeft: null };
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid" };
  if (!res.ok) return { ok: false, reason: "unreachable" };
  const { data } = (await res.json()) as { data?: { limit_remaining?: number | null } };
  const left = data?.limit_remaining ?? null;
  if (left !== null && left <= 0) return { ok: false, reason: "no_credit" };
  return { ok: true, creditLeft: left };
}
