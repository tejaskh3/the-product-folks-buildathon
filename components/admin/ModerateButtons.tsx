"use client";

// Restore / Delete on a reported comment in /admin. Refreshes the page once saved.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ModerateButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(action: "restore" | "delete") {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-accent-hover">Didn’t save</span>}
      <button type="button" disabled={busy} onClick={() => void act("restore")} className="btn-secondary h-7 px-3 text-xs disabled:opacity-50">
        Restore
      </button>
      <button type="button" disabled={busy} onClick={() => void act("delete")} className="h-7 rounded-full px-3 text-xs text-accent-hover hover:bg-accent-soft disabled:opacity-50">
        Delete
      </button>
    </span>
  );
}
