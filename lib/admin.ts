// Server-only: who can open /admin (feedback inbox, reported comments).
// ADMIN_USER_IDS is a comma-separated list of Clerk user ids; unset means nobody.
import { currentUser } from "./auth";

export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

/** The signed-in admin, or null for everyone else (signed out included). */
export async function currentAdmin(): Promise<{ id: string } | null> {
  const user = await currentUser();
  return user && isAdmin(user.id) ? user : null;
}
