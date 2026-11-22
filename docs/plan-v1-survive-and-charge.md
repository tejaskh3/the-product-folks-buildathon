# Plan v1: Survive and charge

Reviewed with `/plan-ceo-review` on 2026-10-07 (Approach A, hold scope). Source ideas: `docs/product-notes.md`. Nothing is built yet.

**Goal:** get generation working again on OpenRouter, start charging, and use a free library to bring people in. Everything else waits until people are using it.

## Architecture

```
                         ┌──────────────── Browser ────────────────┐
                         │ /library  /play  /settings/key  /usage  │
                         │ /pricing (paywall modal)                │
                         └───────┬───────────────────────┬─────────┘
                                 │                       │ Dodo hosted checkout
                                 ▼                       ▼
 ┌─────────────── Next.js API routes (Clerk auth) ───────────────┐   ┌──────────┐
 │ upload ──► PDF store (Supabase Storage, key = sha256)         │   │  Dodo    │
 │ walkthrough / diagram / overview / suggest                    │   │ Payments │
 │   1. entitlement check (plan + quota, atomic reserve)         │   └────┬─────┘
 │   2. pick key: ours | user's BYOK (decrypt per call)          │        │ webhook
 │   3. lib/llm.ts ──► OpenRouter (PDF sent with each call)      │        ▼
 │   4. write usage_events row (OpenRouter-reported cost)        │  /api/billing/webhook
 └───────────────────────────────────────────────────────────────┘        │
 Supabase: papers · nodes (exist; is_public = library)                    │
           NEW: subscriptions · paper_uses · usage_events ·    ◄─────────┘
                api_keys (AES-GCM ciphertext) · webhook_events
```

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Approach | **A: Survive and charge.** OpenRouter + BYOK + usage log + free quota + Dodo + read-only library. |
| D2 | Review mode | Hold scope. |
| 1.3 | PDF input | Store each PDF in Supabase Storage (key = sha256) and send it with every call through OpenRouter's PDF input. |
| 1.1 | Quota | Reserve 1 paper atomically (Postgres function) when the walkthrough starts; refund automatically if zero scenes finish. |
| 1.2 | BYOK key storage | AES-256-GCM in the app, secret in `KEY_ENCRYPTION_SECRET`, key-version column, only the last 4 characters ever leave the server. |
| 2.1 | BYOK models | Curated list of 3–5 tested models (PDF input + JSON schema + diagram checks pass). |
| 2.2 | BYOK failures | Check the key's remaining credit before a walkthrough; show 401/402 as "key invalid" / "out of credit" with a top-up link. |
| 3.1 | Free-tier abuse | Accept the risk and monitor it in the usage ledger. |
| 3.2 | Dodo webhook | Verify the signature, skip webhook ids already seen, re-fetch the subscription from Dodo and save that. |
| 4.1 | Re-upload | Same user + same paper (arXiv id or PDF hash) reopens the saved paper for free. "Regenerate" counts. |
| 4.2 | Back from checkout | "Activating your plan…" screen confirms with Dodo directly, then resumes the pending upload. |
| 4.3 / OV-7 | Library questions | **No cloning.** The library paper stays as one shared copy; each user's questions and click deepers are stored as their own private nodes on it. The first one uses 1 paper; after that it's free like any owned paper. BYOK: always free. |
| 5.1 | Model layer | One `lib/llm.ts` (OpenRouter only) replacing `lib/claude.ts`. Cost comes from OpenRouter; delete the `PRICE` tables in `scripts/generate.ts` and `scripts/walkthrough.ts`. |
| 6.1 | Tests | Add Vitest. Cover quota (including two tabs at once), key encryption, webhooks, entitlement rules, model error mapping. |
| 7.1 | PDF size | Cap at 60 pages, with a clear message. Size: 4 MB for uploads, 15 MB for arXiv (see E1). |
| 8.1 | Spend protection | Hard credit limit on our OpenRouter key, a daily spend alert, and the free tier pauses itself past a daily budget. |
| 9.1 | Rollout | `BILLING_ENABLED` env flag; Dodo test mode first. |
| 10.1 / OV-10 | Old saved papers | **Recover when opened**, not in a batch: arXiv and demo papers are fetched and stored the first time someone opens them; uploaded ones go read-only with "Re-upload to keep exploring" (free, matched by hash). |
| OV-1 | Build order | Keep v1 as reviewed (Dodo full flow + BYOK in v1). Outside voice suggested sequencing; user chose to keep it. |
| OV-3 | Saving | **The server owns saving.** The walkthrough route saves each scene and handles the reserve and refund itself; unfinished scenes are completed by the resume route (see E2). The browser only displays. Replaces saving from the browser in `components/play/supabasePersistence.ts`. |
| OV-6 | Click deeper | No visible cap, but a generous hidden daily limit per user on our key (e.g. 100/day) with a friendly "come back tomorrow". BYOK: unlimited. |
| OV-11 | Our key hits its limit | Separate budgets: the free tier pauses first, paid users get a higher budget. If the hard limit trips: "Curio is at capacity, try again in a few hours. This paper wasn't counted." plus an alert to you. |
| OV-12 | Monthly reset | Resets on each user's billing date (from Dodo). An upgrade takes effect immediately (new allowance minus papers used this period); a downgrade applies at the next renewal. |
| OV-2 | Choosing models | `scripts/eval-models.ts`: runs the Attention and Google walkthroughs on each candidate and reports `checkDiagram` pass rate, retries, speed and $ per paper. This also produces the cost numbers for pricing. |

**Pricing** (from the notes): Free = 2 papers ever · BYOK $2/mo, unlimited · Starter $5/mo, 10 papers · Pro $10/mo, 30 papers. Click deeper is free and unlimited on owned papers. **Measure real cost per paper on the chosen model before Starter and Pro go live.**

Dodo fees (4% + $0.40, plus 0.5% on subscriptions, plus 1.5% on international cards):

| Plan | Fee | You keep |
|---|---|---|
| $2 | ~$0.52 (26%) | $1.48 |
| $5 | ~$0.70 | $4.30 |
| $10 | ~$1.00 | $9.00 |

## NOT in scope (v1)
- Public comments, reporting, auto-hide and the admin dashboard: a community feature needs a community first.
- Highlights, bookmarks, favorites, notes panel, shelf tabs: these keep users coming back, so they come once users exist.
- Feedback floater: deferred (a plain mailto link is fine in the meantime).
- "Video explanations coming soon" teaser: NotebookLM already has free video overviews; lead with interactive diagrams instead.
- Other model providers for BYOK: OpenRouter only, as decided.
- Anti-abuse beyond monitoring (3.1).
- Sending a text summary plus only the needed pages instead of the whole PDF: revisit once cost per paper is measured.

## What already exists
- `papers.is_public` plus its "public or own" read rules: these become the library.
- `nodes` table: already stores questions and click deeper per paper.
- Unique `(owner, paper_key)` index: makes "re-upload reopens it" (4.1) almost free.
- `lib/highlight.ts`: maps a quote to PDF text ranges, for highlights later.
- `DiagramFrame` sandbox (`allow-scripts`, no same-origin): generated HTML is already contained.
- `checkDiagram` and the repair-then-retry flow in `lib/playServer.ts`: unchanged, now applied to OpenRouter output.
- `takePlaySlot` (one in-memory limit for the whole server): stays as a backstop, but it isn't a per-user quota.

## Where this leaves us
v1 brings Curio back: it works again, earns money, has a library people can share, and its costs are known. The 12-month picture (a library of hundreds of papers drawing search traffic, a profitable cost per paper) still needs: more library papers, the reading tools, and a cheaper way to send papers (summary plus selected pages).

## Error & rescue registry

| Codepath | Failure | Rescue | User sees |
|---|---|---|---|
| llm.structuredCall | 401 bad BYOK key | stop before starting (key check) / show clear error | "Your OpenRouter key is invalid" + settings link |
| | 402 out of credit | key check + clear error | "Your key is out of credit" + top-up link |
| | 429 / provider 5xx | retry with backoff | a short delay |
| | model ignores JSON schema / bad JSON | one repair retry, then fail the scene | "Couldn't draw this scene, try again" (scene-level) |
| | refusal / output cut off | existing handling | existing message |
| entitlement.reserve | quota used up | paywall | paywall modal |
| | database error | fail closed, log owner + paper | "Something went wrong, you weren't charged" |
| walkthrough | no plan, or plan but zero scenes | automatic refund (a paper counts once it has a plan plus 1 scene, E2) | "Nothing was drawn, this paper wasn't counted" |
| billing webhook | bad signature | 401, log | - |
| | duplicate / out of order | dedupe + re-fetch from Dodo | - |
| key decrypt | wrong or rotated secret | fail, ask the user to re-enter the key | "Please re-enter your OpenRouter key" |
| Dodo status check | Dodo down while activating | retry for 30 s, then a support link | "Still activating…" then a support link |

## Failure modes registry

| Codepath | Failure | Rescued | Test | User sees | Logged |
|---|---|---|---|---|---|
| Quota reserve | two tabs at once | Y (atomic) | Y (6.1) | paywall on the 3rd | Y |
| Walkthrough | crash after reserve | Y (refund) | Y | refund message | Y |
| Walkthrough | tab closed mid-run | Y (server saves, OV-3) | Y | paper complete on return | Y |
| Our OpenRouter key | hard limit hit for paid users | Y (OV-11) | Y | "at capacity, not counted" | Y |
| Webhook | replayed event | Y (dedupe) | Y | - | Y |
| Our OpenRouter key | balance drained | Y (separate keys per tier, each with an OpenRouter limit) | manual | free tier paused | Y |
| Walkthrough | 300 s limit hit, scenes left | Y (resume route, E2) | Y | remaining scenes keep drawing | Y |
| Cache | prefix changes per call | Y (one URL per run, warm first, E4) | eval | - | eval report |
| Old papers | dead file id | Y (recovery / read-only) | Y | re-upload prompt | Y |

No critical gaps remain after these decisions.

## Engineering decisions (`/plan-eng-review`, 2026-10-07)

| # | Topic | Decision |
|---|---|---|
| E-D2 | Shipping | **3 PRs, same scope.** PR1 brings generation back; PR2 adds quota, spend guard and BYOK; PR3 adds Dodo and the library. |
| 1A | Routing | Generation routes take **`paperId`**. The server loads the paper row, checks the owner, and finds the PDF. The client never sends a file id. |
| E6 | Paper row | **Upload creates the row** (key `sha:<hash>` or `arxiv:<id>`) and returns `paperId`. A migration maps old `file:` keys; `findDemo` matches on the arXiv id or the hash. |
| 1B | Quota storage | `paper_uses(owner, paper_id, status reserved\|used\|refunded, period_start)` with a unique `(owner, paper_id)`. |
| E8 | Free vs paid periods | Free uses are counted all-time (max 2). A new subscription starts a fresh period with the full allowance; free uses never count against it. |
| 4B | Checks before each call | One SQL function, `authorize_generation(owner, paper_id, kind)`, returns allowed/denied + reason + which key + reservation id in a single database call. |
| 1C / E5 | Nodes | `nodes.owner text not null default ''` (`''` = part of the paper itself); primary key `(paper_id, owner, id)` so the existing save still works. If the library paper already has the requested deeper diagram, it's served free. |
| 1D / E4 | PDF transport + caching | Sign **one** Storage URL per run and reuse it; base64 as fallback. The plan call warms the cache before the scenes start. Cache markers for providers that need them. The eval measures the real cached cost with this exact pattern. |
| E2 | Partial papers | Scenes not finished at the deadline are saved as `pending`; the client calls `POST /api/play/papers/:id/resume` to finish them on the already-reserved paper (no new charge). A paper counts as used once its plan plus 1 scene exist. |
| E1 | Upload size | Uploads stay ≤ 4 MB (Vercel's 4.5 MB request limit); arXiv papers up to 15 MB (the server downloads them itself); page cap via a light page count. Direct-to-storage upload → TODOS. |
| E7 | Spend guard | **Separate OpenRouter keys for the free and paid tiers**, each with its own spending limit enforced by OpenRouter. The ledger is used only for the usage page and alerts. The hidden click-deeper cap stays a simple database count. *(Replaces the database spend counter.)* |
| 4A | Calls at once | Each curated model has its own `maxConcurrency` setting (measured by the eval). BYOK uses `min(limit, 4)`; the resume route (E2) absorbs slow keys. |
| 2A | Streaming | First, a refactor PR with no behavior change: move the 3 copies into `lib/ndjson.ts`. |
| 2B | Errors | Typed errors (`KeyInvalid`, `OutOfCredit`, `AtCapacity`, `QuotaExhausted`, `BadOutput`, `Refused`) plus one `userMessage(err)`. Remove "Claude" from user-facing text. |
| 2C | Old /demo | Retire live click deeper on /demo: delete `/api/deeper` and `lib/liveClient.ts`; /demo stays read-only and links to /play. |
| 3A / 3B | Tests | Vitest integration tests against local Supabase (`supabase start`); 3 Playwright end-to-end tests (new paper, paywall, pay → resume in Dodo test mode with a fixed test product and test user). |
| E9 | PR2 without billing | PR2 ships with `BILLING_ENABLED=false` = no limits, until PR3 adds a way to pay. |
| E10 | Library papers | Generated with Claude Code, then loaded through `scripts/import-library.ts`, which runs `checkDiagram` and the walkthrough schema and saves through the same code as live papers. |
| — | Dodo | Use the official `@dodopayments/nextjs` adapter (checkout, customer portal, signed webhooks) instead of writing our own. |

```
PR1 request flow (walkthrough)
 client ──POST {paperId}──► route ──► authorize_generation()  (PR2; PR1: owner check only)
                              │            └─ denied → typed error → userMessage
                              ▼
                    sign PDF URL once ──► plan call (warms cache) ──► scenes (maxConcurrency)
                              │                                        │ each scene: save node (server)
                              │                                        │             + usage_events row
                              ▼                                        ▼
                     deadline hit? ── yes ──► mark remaining 'pending' ──► client calls /resume
                              │ no
                              ▼
                        done (paper_uses: reserved → used once plan + 1 scene exist; 0 → refunded)
```

## Implementation tasks

**PR0: refactor, no behavior change**
- [ ] **T0 (P1, human ~2h / CC ~10m)** `lib/ndjson.ts` shared stream helper; walkthrough, diagram and overview routes use it. (2A) Verify: existing flows unchanged by hand + regression tests.

**PR1: generation works again**
- [ ] **T3 (P1, human ~4h / CC ~25m)** `scripts/eval-models.ts`: `checkDiagram` pass rate, retries, speed, cached vs uncached tokens, $ per paper, `maxConcurrency`, on 2–3 PDF-native candidates using the real calling pattern (E4). Lock the default model and the curated list; check Pro needs under ~$0.28 per paper. (OV-2, 4C, E4)
- [ ] **T1 (P1, human ~1d / CC ~40m)** `lib/llm.ts` on OpenRouter: curated models with `maxConcurrency`, cache markers, typed errors + `userMessage`, cost reported by OpenRouter. Delete `lib/claude.ts` and the `PRICE` tables. (5.1, 2B, 4A, 4C)
- [ ] **T2 (P1, human ~1d / CC ~30m)** PDF store: Supabase Storage keyed by sha256, one signed URL per run with base64 fallback, 4 MB uploads / 15 MB arXiv, page count. (1.3, 1D, E1)
- [ ] **T2b (P1, human ~4h / CC ~25m)** Upload creates the paper row (`sha:`/`arxiv:` keys), migration for old `file:` keys, `findDemo` by arXiv id or hash; routes take `paperId` with an owner check. (1A, E6)
- [ ] **T9b (P1, human ~1d / CC ~40m)** Server owns saving: the routes save nodes and `usage_events`; the `pending` state plus a resume route; remove saving from the browser in `supabasePersistence.ts`. (OV-3, E2)
- [ ] **T4a (P1, human ~3h / CC ~15m)** Migrations: `usage_events`, `nodes.owner` + new primary key. (1C, E5)
- [ ] **T9 (P1, human ~3h / CC ~15m)** Old papers recovered when opened, plus a read-only state. (OV-10)
- [ ] **T14 (P1, human ~1h / CC ~5m)** Retire live /demo: delete `/api/deeper` and `lib/liveClient.ts`; link to /play. (2C)
- [ ] **T10a (P1, human ~1d / CC ~45m)** Vitest + local Supabase; tests for llm errors, `userMessage`, the PDF store, server-side saving and resume; **regressions:** signed-out demo streams instantly, `/play/<id>` resume loads nodes, walkthrough event format unchanged. (6.1, 3A)

**PR2: quota, spend guard, BYOK (`BILLING_ENABLED=false` = no limits)**
- [ ] **T4b (P1, human ~4h / CC ~20m)** `subscriptions`, `paper_uses`, `api_keys`, `webhook_events` + `authorize_generation` (lock per owner, free = all-time, paid = period). (1B, 4B, E8, 4.1, OV-7)
- [ ] **T5 (P1, human ~3h / CC ~15m)** BYOK: AES-GCM with a key version, settings page, key check before generating. (1.2, 2.2)
- [ ] **T8 (P1, human ~3h / CC ~15m)** Spend guard: separate OpenRouter keys for the free and paid tiers, each with a limit; daily alert from the ledger; hidden click-deeper cap; "at capacity, not counted" message. (8.1, E7, OV-6, OV-11)
- [ ] **T7 (P1, human ~4h / CC ~20m)** Usage page + quota badge. (transparency)
- [ ] **T10b (P1, human ~4h / CC ~20m)** Tests: two-tab race, refund, period boundaries, free all-time, AES-GCM round trip/tamper, `authorize_generation` matrix. (6.1, 3A)

**PR3: billing + library**
- [ ] **T6 (P1, human ~1d / CC ~45m)** Dodo via `@dodopayments/nextjs`: checkout, webhook (dedupe + re-fetch), "Activating…" resume, customer portal, test mode → live. (3.2, 4.2, 9.1, OV-12)
- [ ] **T11 (P2, human ~1d / CC ~45m)** `/library` grid, signed-out reading, per-user nodes on shared papers, free reuse of existing diagrams. (OV-7, E5)
- [ ] **T12 (P2, human ~3h / CC ~15m)** `scripts/import-library.ts` + generate 10–20 papers with Claude Code. (E10)
- [ ] **T10c (P1, human ~1d / CC ~45m)** Playwright: new paper, paywall, pay → resume (fixed Dodo test product + test user). (3B, E9)
- [ ] **T13 (P2)** Run `/plan-design-review` on the paywall, key settings, usage, library and activating screens before building their UI.

## Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T0 ndjson refactor | app/api/play, lib/ | — |
| T3 eval script | scripts/, lib/llm | T1 (shares lib/llm) |
| T1 llm layer | lib/ | T0 |
| T2/T2b PDF store + paper row | lib/, app/api/play/upload, supabase/ | T0 |
| T9b server saving + resume | app/api/play, components/play, lib/ | T1, T2b |
| T4b + T5 + T8 quota/BYOK/spend | supabase/, lib/, app/settings | PR1 merged |
| T7 usage page | app/usage | T4a |
| T6 Dodo | app/api/billing, app/pricing | T4b |
| T11/T12 library | app/library, scripts/ | T4a |

- **Lane A:** T0 → T1 → T3 (lib/llm, sequential)
- **Lane B:** T2 → T2b (upload, storage, migrations), in parallel with A after T0
- **Lane C:** T9b + T14 after A and B merge
- **PR2:** Lane D: T4b → T5/T8 · Lane E: T7 (app/usage) in parallel
- **PR3:** Lane F: T6 · Lane G: T11/T12 in parallel (different modules)
- **Conflict flag:** Lanes A and B both touch `lib/`; keep `lib/llm.ts` and `lib/pdfStore.ts` as separate files and merge A first.

## NOT in scope (eng review additions)
- Direct-to-storage upload for PDFs over 4 MB → TODOS.md (E1).
- Live click deeper on /demo: retired (2C).
- A database spend counter: replaced by separate OpenRouter keys per tier (E7).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: HOLD_SCOPE, 0 critical gaps, 6 items deferred to TODOS.md |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | ISSUES_FOUND (claude subagent) | CEO pass: 12 points, 8 decided; eng pass: 11 points, 8 decided (E1/E2/E4/E5/E6/E7/E8/E10), 2 folded into tasks (E9/E11), 1 overlapped (E3 → E2) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 21 issues, 0 critical gaps; ships as PR0 + 3 PRs |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** Both passes agreed on measuring cost first. The outside voice caught 3 things the eng review missed (partial papers past the deadline, cache prefix stability, the 4.5 MB request limit) and swapped the database spend counter for separate OpenRouter keys per tier; the user accepted all of them.
- **VERDICT:** CEO + ENG CLEARED, ready to implement (design review recommended before the UI tasks in PR2/PR3).

NO UNRESOLVED DECISIONS
