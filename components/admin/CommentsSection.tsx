// Reported comments on /admin: hidden ones (3+ reports) first, then anything reported.
// Restore puts a comment back and clears its reports; delete removes it for everyone.
// Server component; only rendered after the page has checked the visitor is an admin.
import Link from "next/link";
import { HIDE_AFTER_REPORTS, listForModeration, type ModerationRow } from "@/lib/comments";
import { ModerateButtons } from "./ModerateButtons";

export async function CommentsSection() {
  let rows: ModerationRow[] = [];
  let failed = false;
  try {
    rows = await listForModeration();
  } catch (err) {
    console.error("[admin] couldn’t load reported comments", err);
    failed = true;
  }
  const hidden = rows.filter((r) => r.hidden).length;

  return (
    <section aria-labelledby="comments-title">
      <h2 id="comments-title" className="font-serif text-2xl text-ink">
        Reported comments
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        {rows.length} reported · {hidden} hidden (after {HIDE_AFTER_REPORTS} reports)
      </p>

      {failed ? (
        <p role="alert" className="mt-6 text-sm text-accent-hover">
          Couldn’t load reported comments.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-white p-5 text-ink-2">Nothing reported.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className={`font-medium tracking-wide uppercase ${c.hidden ? "text-accent-hover" : "text-ink-2"}`}>
                  {c.hidden ? "Hidden" : "Visible"} · {c.report_count} {c.report_count === 1 ? "report" : "reports"}
                </span>
                <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
                {c.paper && (
                  <Link href={`/play/${c.paper.id}`} className="underline decoration-line underline-offset-2 hover:text-ink">
                    {c.paper.title || "Untitled paper"}
                  </Link>
                )}
                <span className="ml-auto">
                  <ModerateButtons id={c.id} />
                </span>
              </div>
              <p className="mt-2 text-[15px] break-words whitespace-pre-wrap text-ink">{c.body}</p>
              <p className="mt-2 text-xs break-all text-ink-3">
                {c.author} · {c.owner}
              </p>
              {c.reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
                  {c.reasons.map((r, i) => (
                    <li key={i}>“{r}”</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
