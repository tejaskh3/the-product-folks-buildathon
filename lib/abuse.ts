// Server-only: the two checks against farming free papers with new accounts.
//
//   clientIp(req) ─► ipHash(ip) ─► authorize_generation counts free papers per IP hash per day
//   isDisposableEmail(email)    ─► free papers need a permanent address
//
// The raw IP never leaves this file: the database only sees an HMAC of it, keyed with a server
// secret, so the stored hashes can't be reversed by trying all 4 billion IPv4 addresses.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { DISPOSABLE_DOMAINS } from "./disposableDomains";

/** Free papers allowed per IP per day, across all users (default 4). */
export const freePapersPerIpDay = () => {
  const n = Number(process.env.FREE_PAPERS_PER_IP_DAY ?? 4);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
};

/** The caller's IP as Vercel reports it: first x-forwarded-for entry, else x-real-ip. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim();
  return ip && isIP(ip) ? ip : null;
}

/**
 * HMAC-SHA256 of the IP, or null without a secret or an IP (then there's no per-IP limit).
 * IPv6 is bucketed to its /64: one household or server gets a whole /64, so counting single
 * addresses would let anyone rotate past the limit.
 */
export function ipHash(ip: string | null): string | null {
  const secret = process.env.IP_HASH_SECRET || process.env.KEY_ENCRYPTION_SECRET;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(ipBucket(ip)).digest("hex");
}

function ipBucket(ip: string): string {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return v4;
  if (isIP(ip) !== 6) return ip;
  // Expand "::" so the first four groups are the /64 prefix.
  const [head, tail = ""] = ip.toLowerCase().split("%")[0].split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const tailLen = t.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0); // an embedded IPv4 is 2 groups
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - tailLen)).fill("0"), ...t];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** True for an address on a throwaway-email domain, including its subdomains. */
export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = email?.split("@").pop()?.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || !email?.includes("@")) return false;
  const parts = domain.split(".");
  // mail.x.mailinator.com → x.mailinator.com → mailinator.com (never the bare TLD).
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}
