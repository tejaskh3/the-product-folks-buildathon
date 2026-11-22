// The signed-in Clerk user for this request, for route handlers. Kept apart from
// playServer so the offline generation scripts never import Clerk.
import { auth, currentUser as clerkUser } from "@clerk/nextjs/server";

export interface SignedInUser {
  id: string; // Clerk user id, e.g. "user_2abc…"
}

/** Demo switch: NEXT_PUBLIC_AUTH_DISABLED=1 treats every request as one shared demo user, no sign-in. */
export const authDisabled = () => process.env.NEXT_PUBLIC_AUTH_DISABLED === "1";
const DEMO_USER: SignedInUser = { id: "demo_user" };

/** The signed-in user for this request, verified by Clerk, or null. */
export async function currentUser(): Promise<SignedInUser | null> {
  if (authDisabled()) return DEMO_USER;
  const { userId } = await auth();
  return userId ? { id: userId } : null;
}

/** The user's primary email, for the papers row. Costs a Clerk API call, so only used on save. */
export async function currentEmail(): Promise<string | null> {
  if (authDisabled()) return null;
  const user = await clerkUser();
  return user?.primaryEmailAddress?.emailAddress ?? null;
}

/** Email and display name, for prefilling checkout. One Clerk API call. */
export async function currentProfile(): Promise<{ email: string | null; name: string | null }> {
  if (authDisabled()) return { email: null, name: "Demo" };
  const user = await clerkUser();
  return { email: user?.primaryEmailAddress?.emailAddress ?? null, name: user?.fullName ?? null };
}
