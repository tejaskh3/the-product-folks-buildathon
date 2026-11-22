// /admin — for the people in ADMIN_USER_IDS; a plain 404 for everyone else.
// One section per inbox: reported comments, then feedback.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentsSection } from "@/components/admin/CommentsSection";
import { FeedbackSection } from "@/components/admin/FeedbackSection";
import { UserMenu } from "@/components/auth/UserMenu";
import { PRODUCT_NAME } from "@/components/landing/site";
import { currentAdmin } from "@/lib/admin";
import { isKind } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Admin · ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  if (!(await currentAdmin())) notFound();
  const { kind } = await searchParams;
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white/85">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {PRODUCT_NAME}
          </Link>
          <span className="text-sm text-ink-3">Admin</span>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
        <h1 className="sr-only">Admin</h1>
        <CommentsSection />
        <FeedbackSection kind={isKind(kind) ? kind : null} />
      </main>
    </div>
  );
}
