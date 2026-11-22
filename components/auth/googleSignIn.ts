"use client";

// One-click sign-in: straight to Google's account picker, no intermediate Clerk screen.
// New users are signed up transparently by the callback page (/sso-callback).
import { useClerk } from "@clerk/nextjs";
import { useCallback, useState } from "react";

/** Where to land after signing in: the page the user is on now (path + query), or /play. */
function currentPath(): string {
  try {
    return window.location.pathname + window.location.search || "/play";
  } catch {
    return "/play";
  }
}

export function useGoogleSignIn() {
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (returnTo?: string) => {
      const signIn = clerk.client?.signIn;
      const done = returnTo ?? currentPath();
      if (!signIn) {
        // Clerk hasn't loaded its client yet; fall back to the hosted page.
        window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(done)}`);
        return;
      }
      setBusy(true);
      try {
        await signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: `/sso-callback?next=${encodeURIComponent(done)}`,
          redirectUrlComplete: done,
        });
      } catch {
        setBusy(false);
        window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(done)}`);
      }
    },
    [clerk],
  );

  return { start, busy };
}
