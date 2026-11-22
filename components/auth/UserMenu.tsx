"use client";

// One-click "Sign in with Google" when signed out; Clerk's avatar menu (profile, sign out) when signed in.
// Demo mode (no sign-in): the research agent, the persona feed and the notification bell instead.
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/persona/NotificationBell";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { authDisabled, useUser } from "./useUser";

export function UserMenu() {
  const user = useUser();
  if (authDisabled) {
    return (
      <div className="flex items-center gap-3">
        <Link href="/research" className="text-sm text-ink-2 hover:text-ink">
          Research
        </Link>
        <Link href="/for-you" className="text-sm text-ink-2 hover:text-ink">
          For you
        </Link>
        <NotificationBell />
      </div>
    );
  }
  if (user === undefined) return <span className="inline-block h-9 w-9" aria-hidden="true" />;

  if (!user) {
    return <GoogleSignInButton label="Sign in" />;
  }

  return <UserButton />;
}
