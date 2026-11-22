"use client";

// The "done" checkbox on an /admin row. Saves straight away; puts itself back if the save fails.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DoneToggle({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setOn(!next);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
      {error ? <span className="text-accent-hover">Didn’t save</span> : "Done"}
    </label>
  );
}
