// The feedback inbox on /admin: newest first, filter by kind, tick off what's done.
// Server component; only rendered after the page has checked the visitor is an admin.
import Link from "next/link";
import { listFeedback, type FeedbackKind, type FeedbackRow } from "@/lib/feedback";
import { DoneToggle } from "./DoneToggle";

const KIND_LABEL: Record<FeedbackKind, string> = { feedback: "Feedback", feature: "Feature request", paper: "Paper request" };
const FILTERS: { kind: FeedbackKind | null; label: string }[] = [
  { kind: null, label: "All" },
  { kind: "feedback", label: "Feedback" },
  { kind: "feature", label: "Features" },
  { kind: "paper", label: "Papers" },
];

export async function FeedbackSection({ kind }: { kind: FeedbackKind | null }) {
  let rows: FeedbackRow[] = [];
  let failed = false;
  try {
    rows = await listFeedback({ kind });
  } catch (err) {
    console.error("[admin] couldn’t load feedback", err);
    failed = true;
  }
  const open = rows.filter((r) => !r.done).length;

  return (
    <section aria-labelledby="feedback-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="feedback-title" className="font-serif text-2xl text-ink">
            Feedback
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {rows.length} shown · {open} open
          </p>
        </div>
        <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.label}
              href={f.kind ? `/admin?kind=${f.kind}` : "/admin"}
              aria-current={kind === f.kind ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${kind === f.kind ? "border-ink text-ink" : "border-line text-ink-2 hover:border-node"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {failed ? (
        <p role="alert" className="mt-6 text-sm text-accent-hover">
          Couldn’t load feedback.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-white p-5 text-ink-2">Nothing here yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className={`rounded-xl border border-line bg-white p-4 sm:p-5 ${r.done ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className="font-medium tracking-wide text-ink-2 uppercase">{KIND_LABEL[r.kind]}</span>
                <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
                {r.page && <span className="break-all">{r.page}</span>}
                <span className="ml-auto">
                  <DoneToggle id={r.id} done={r.done} />
                </span>
              </div>
              {r.arxiv_id && (
                <p className="mt-2 text-[15px]">
                  <a href={`https://arxiv.org/abs/${r.arxiv_id}`} target="_blank" rel="noreferrer" className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                    arXiv {r.arxiv_id}
                  </a>
                </p>
              )}
              {r.message && <p className="mt-2 text-[15px] break-words whitespace-pre-wrap text-ink">{r.message}</p>}
              <p className="mt-2 text-xs break-all text-ink-3">
                {r.email ? (
                  <a href={`mailto:${r.email}`} className="underline decoration-line underline-offset-2 hover:text-ink">
                    {r.email}
                  </a>
                ) : (
                  "No email"
                )}
                {" · "}
                {r.owner ?? "Signed out"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
