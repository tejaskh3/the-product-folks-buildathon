"use client";

// The signed-in user as the browser sees it. `undefined` while Clerk loads, `null` when signed out.
// For display only; every API route checks the session again on the server.
import { useUser as useClerkUser } from "@clerk/nextjs";

/** Demo switch: NEXT_PUBLIC_AUTH_DISABLED=1 treats every visitor as one shared demo user, no sign-in. */
export const authDisabled = process.env.NEXT_PUBLIC_AUTH_DISABLED === "1";

type ClerkUser = ReturnType<typeof useClerkUser>["user"];
const DEMO_USER = { id: "demo_user" } as unknown as NonNullable<ClerkUser>;

export function useUser() {
  const { isLoaded, user } = useClerkUser();
  if (authDisabled) return DEMO_USER;
  return isLoaded ? (user ?? null) : undefined;
}
