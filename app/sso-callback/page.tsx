"use client";

// Google sends people back here. Clerk finishes the sign-in (or signs a new user up
// transparently) and then returns them to the page they started from.
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/** Only same-site paths, so the `next` parameter can't redirect anywhere else. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/play";
}

function Callback() {
  const next = safeNext(useSearchParams().get("next"));
  return (
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl={next}
      signUpFallbackRedirectUrl={next}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    />
  );
}

export default function SsoCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 text-sm text-ink-3">
      <p>Signing you in…</p>
      <Suspense>
        <Callback />
      </Suspense>
    </main>
  );
}
