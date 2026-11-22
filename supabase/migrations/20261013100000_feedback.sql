-- The feedback floater: feedback, feature requests and paper requests, read on /admin.
-- Anyone can send one (signed out too); the server caps it at 10 an hour per user, or per
-- ip_hash (sha256 of IP + a server secret, never the raw IP) when signed out.
-- Written to run more than once.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner text,                         -- Clerk user id; null when signed out
  email text,                         -- so we can reply; optional
  kind text not null check (kind in ('feedback', 'feature', 'paper')),
  message text not null default '' check (char_length(message) <= 2000),
  arxiv_id text,                      -- 'paper' requests: normalized, no version suffix
  page text,                          -- the path they were on
  ip_hash text,
  done boolean not null default false
);
alter table feedback enable row level security;

-- Only the server (service role) reads or writes; no anon/authenticated policies.
drop policy if exists "feedback is server-only" on feedback;

create index if not exists feedback_created_idx on feedback (created_at desc);
create index if not exists feedback_owner_idx on feedback (owner, created_at) where owner is not null;
create index if not exists feedback_ip_idx on feedback (ip_hash, created_at) where ip_hash is not null;
