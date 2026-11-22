"use client";

// One-click "Sign in with Google" when signed out; Clerk's avatar menu (profile, sign out) when signed in.
import { UserButton } from "@clerk/nextjs";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { authDisabled, useUser } from "./useUser";

export function UserMenu() {
  const user = useUser();
  if (authDisabled) return null; // demo mode: no sign-in, no account menu
  if (user === undefined) return <span className="inline-block h-9 w-9" aria-hidden="true" />;

  if (!user) {
    return <GoogleSignInButton label="Sign in" />;
  }

  return <UserButton />;
}
