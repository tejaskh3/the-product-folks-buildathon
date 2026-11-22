// /library — famous papers, already explained. Free to read for everyone, signed in or not.
// Each one is a single shared copy; questions readers ask on it are saved privately per reader.
import type { Metadata } from "next";
import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import { PRODUCT_NAME } from "@/components/landing/site";
import { listLibrary } from "@/lib/libraryList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Library · ${PRODUCT_NAME}`,
  description: "Landmark research papers, each explained as an animated walkthrough you can click into. Free to read.",
};

export default async function LibraryPage() {
  let papers: Awaited<ReturnType<typeof listLibrary>> = [];
  try {
    papers = await listLibrary();
  } catch (err) {
    console.error("[library] couldn’t load", err);
  }
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {PRODUCT_NAME}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/pricing" className="text-sm text-ink-2 hover:text-ink">
              Pricing
            </Link>
            <Link href="/play" className="text-sm text-ink-2 hover:text-ink">
              Your papers
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">Library</h1>
        <p className="mt-3 max-w-xl text-[15px] text-ink-2">
          Landmark papers, already explained. Read any of them free. Sign in to ask your own questions; your questions stay private to you.
        </p>
        {papers.length === 0 ? (
          <div className="mt-10 rounded-xl border border-line bg-white p-6">
            <p className="text-ink-2">The library is being stocked. Meanwhile, try a ready-made walkthrough or bring your own paper.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/demo" className="btn-primary h-10 px-5 text-sm">
                See a walkthrough
              </Link>
              <Link href="/play" className="btn-secondary h-10 px-5 text-sm">
                Bring a paper
              </Link>
            </div>
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {papers.map((p) => (
              <li key={p.id}>
                <Link href={`/play/${p.id}`} className="flex h-full flex-col rounded-xl border border-line bg-white p-5 transition-colors hover:border-node">
                  <h2 className="font-serif text-xl leading-snug text-ink">{p.title || "Untitled paper"}</h2>
                  <p className="mt-1 text-sm text-ink-3">
                    {[p.authors, p.year].filter(Boolean).join(" · ")}
                  </p>
                  {p.blurb && <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-2">{p.blurb}</p>}
                  <p className="mt-4 text-sm text-accent-hover">{p.scenes ? `${p.scenes} scenes` : "Read it"} →</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
