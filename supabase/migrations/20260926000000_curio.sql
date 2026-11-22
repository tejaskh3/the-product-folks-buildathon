-- Curio: papers a user uploaded, and every scene/question/diagram explored in them.
-- No login: rows are keyed by the gate email (test@tejas.com). Only the server
-- (service role) touches these tables, so RLS is on with no public policies.

create table if not exists papers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  title text,
  authors text,
  year int,
  arxiv_id text,
  file_id text,
  walkthrough jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists papers_email_idx on papers (email, created_at desc);

create table if not exists nodes (
  paper_id uuid not null references papers (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('scene', 'suggested', 'question', 'deeper')),
  title text not null,
  parent_id text,
  diagram jsonb,
  status text not null default 'pending' check (status in ('pending', 'ready', 'error')),
  created_at timestamptz not null default now(),
  primary key (paper_id, id)
);
create index if not exists nodes_paper_idx on nodes (paper_id, created_at);

alter table papers enable row level security;
alter table nodes enable row level security;
