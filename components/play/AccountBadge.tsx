"use client";

// Header link to /account. Shows how many papers are left when there's a limit to show.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useUser } from "@/components/auth/useUser";
import { getAccount, papersLeft } from "@/lib/accountClient";

/** `refresh` changes whenever a paper is opened, so the count stays current. */
export function AccountBadge({ refresh }: { refresh?: string | null }) {
  const user = useUser();
  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    getAccount()
      .then((a) => live && setLeft(papersLeft(a)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user, refresh]);

  if (!user) return null;
  return (
    <Link href="/account" className="hidden rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink sm:block">
      {left ?? "Account"}
    </Link>
  );
}
