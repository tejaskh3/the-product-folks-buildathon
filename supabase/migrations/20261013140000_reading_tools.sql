-- Reading tools: favorites, notes, history, bookmarks and highlights. All private to one reader
-- (Clerk id in `owner`), on their own papers and on library papers alike. Only the server
-- (service role) reads or writes these; RLS is on with no policies.

-- One row per reader per paper they've opened: favorite, their notes, when they last opened it.
create table if not exists reader_papers (
  owner text not null,
  paper_id uuid not null references papers (id) on delete cascade,
  favorite boolean not null default false,
  notes text not null default '' check (length(notes) <= 20000),
  last_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner, paper_id)
);
create index if not exists reader_papers_history_idx on reader_papers (owner, last_opened_at desc);
create index if not exists reader_papers_favorite_idx on reader_papers (owner) where favorite;
alter table reader_papers enable row level security;

-- A saved place: a scene, an answer (node) or a PDF page.
create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  paper_id uuid not null references papers (id) on delete cascade,
  kind text not null check (kind in ('scene', 'node', 'page')),
  target text not null check (length(target) between 1 and 200),
  label text not null default '' check (length(label) <= 300),
  created_at timestamptz not null default now(),
  unique (owner, paper_id, kind, target)
);
create index if not exists bookmarks_owner_idx on bookmarks (owner, created_at desc);
alter table bookmarks enable row level security;

-- A highlighted passage in a scene's text, an answer, or a PDF page, with a color and an optional note.
create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  paper_id uuid not null references papers (id) on delete cascade,
  kind text not null check (kind in ('scene', 'node', 'page')),
  target text not null check (length(target) between 1 and 200),
  quote text not null check (length(quote) between 1 and 1000),
  color text not null default 'yellow' check (color in ('yellow', 'green', 'blue', 'pink')),
  note text not null default '' check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists highlights_owner_paper_idx on highlights (owner, paper_id, created_at);
alter table highlights enable row level security;

revoke all on reader_papers, bookmarks, highlights from anon, authenticated;
