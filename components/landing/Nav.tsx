import { UserMenu } from "@/components/auth/UserMenu";
import { PRODUCT_NAME, TRY_URL } from "./site";

export function Nav() {
  return (
    <header className="border-b border-line">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 rounded-md font-serif text-xl text-ink">
          <Mark />
          {PRODUCT_NAME}
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="hidden rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:text-ink sm:block">
            How it works
          </a>
          <a href="/library" className="hidden rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:text-ink sm:block">
            Library
          </a>
          <a href="/pricing" className="hidden rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:text-ink sm:block">
            Pricing
          </a>
          <UserMenu />
          <a href={TRY_URL} className="btn-primary ml-1 h-9 px-4 text-sm">
            Try it
          </a>
        </div>
      </nav>
    </header>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path d="M5 4.5a2 2 0 0 1 2-2h7l5 5v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={12} cy={14} r={3.4} fill="var(--color-accent)" />
    </svg>
  );
}
