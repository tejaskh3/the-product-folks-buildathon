// The header for the persona and research pages, matching /library.
import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import { PRODUCT_NAME } from "@/components/landing/site";

export function PageHeader() {
  return (
    <header className="border-b border-line bg-white/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          {PRODUCT_NAME}
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/library" className="text-sm text-ink-2 hover:text-ink">
            Library
          </Link>
          <Link href="/play" className="hidden text-sm text-ink-2 hover:text-ink sm:inline">
            Your papers
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
