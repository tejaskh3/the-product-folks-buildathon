"use client";

import { useGoogleSignIn } from "./googleSignIn";

/** "Sign in with Google" in one click. `variant` matches the site's button styles. */
export function GoogleSignInButton({
  label = "Sign in with Google",
  variant = "quiet",
  className = "",
}: {
  label?: string;
  variant?: "quiet" | "primary";
  className?: string;
}) {
  const { start, busy } = useGoogleSignIn();
  const base =
    variant === "primary"
      ? "btn-primary h-11 px-6"
      : "rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:text-ink";

  return (
    <button
      type="button"
      onClick={() => start()}
      disabled={busy}
      className={`inline-flex items-center gap-2 disabled:opacity-60 ${base} ${className}`}
    >
      <GoogleMark />
      {busy ? "Opening Google…" : label}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
