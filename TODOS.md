# TODOS

Work deferred from v1 (`docs/plan-v1-survive-and-charge.md`, CEO review 2026-10-07). Raw ideas: `docs/product-notes.md`.

## "Video explanations coming soon" teaser
- **What:** a card on the pricing page plus a disabled "Watch as video" button with a notify-me list.
- **Why:** measures interest in video.
- **Cons:** NotebookLM already makes free video overviews; this invites a direct comparison. Lead with interactive diagrams instead.
- **Effort:** S · **Priority:** P3 · **Depends on:** pricing page.

## Cheaper paper sending (summary + cited pages)
- **What:** instead of sending the whole PDF on every call, send a text summary made once per paper, plus only the pages a scene cites, as PDF.
- **Why:** each paper currently sends the full PDF 9–17+ times; this could cut input cost a lot.
- **Context:** revisit once `scripts/eval-models.ts` (T3) has measured real cost per paper. Scene prompts already know their `pages`.
- **Effort:** M → with CC: S · **Priority:** P2 · **Depends on:** T3 results.
- **Status:** built behind `PAPER_SENDING=digest` (default `full`, unchanged). Before turning it on, run `scripts/eval-sending.ts` on a real paper: with a warm prompt cache the whole PDF is already cheap (cached reads cost a tenth), so the win depends on the measured cache hit rate.
- **To do:** run the real comparison (about $0.30–0.60 of credit), then decide whether to turn it on.

## Done in v1 (2026-10-13)
Reading tools (highlights, bookmarks, favorites, notes + Markdown export, shelf tabs), public comments on library papers with 3-report auto-hide and `/admin` moderation, feedback floater with the `/admin` inbox, free-tier abuse limits (per-IP daily cap, disposable emails), uploads up to 15 MB straight to Storage.
