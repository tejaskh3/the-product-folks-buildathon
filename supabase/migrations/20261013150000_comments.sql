-- Public comments on library papers. Anyone can read; signed-in readers post. Three reports from
-- different readers hide a comment until an admin restores or deletes it on /admin.
-- Only the server (service role) reads or writes these; RLS is on with no policies.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers (id) on delete cascade,
  owner text not null,
  -- Shown name, fixed when posting ("Ada L."); never the email.
  author text not null check (length(author) between 1 and 80),
  -- The scene it's about, if any (null: the paper as a whole).
  scene_id text check (scene_id is null or length(scene_id) <= 200),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  report_count integer not null default 0,
  hidden boolean not null default false,
  deleted_at timestamptz,
  -- 'author' or 'admin'
  deleted_by text check (deleted_by is null or deleted_by in ('author', 'admin'))
);
create index if not exists comments_paper_idx on comments (paper_id, created_at) where deleted_at is null;
create index if not exists comments_owner_idx on comments (owner, created_at desc);
create index if not exists comments_moderation_idx on comments (report_count desc, created_at desc) where deleted_at is null and report_count > 0;
alter table comments enable row level security;

create table if not exists comment_reports (
  comment_id uuid not null references comments (id) on delete cascade,
  reporter text not null,
  reason text not null default '' check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (comment_id, reporter)
);
alter table comment_reports enable row level security;

revoke all on comments, comment_reports from anon, authenticated;

-- One report per reader per comment; the third distinct report hides it. Atomic, so parallel
-- reports can't miss the threshold. Returns the new count and whether it's hidden.
create or replace function report_comment(p_comment uuid, p_reporter text, p_reason text default '', p_hide_at integer default 3)
returns table (report_count integer, hidden boolean)
language plpgsql
as $$
begin
  perform 1 from comments c where c.id = p_comment and c.deleted_at is null for update;
  if not found then
    return;
  end if;
  insert into comment_reports (comment_id, reporter, reason)
  values (p_comment, p_reporter, left(coalesce(p_reason, ''), 300))
  on conflict (comment_id, reporter) do nothing;
  return query
  update comments c
     set report_count = (select count(*) from comment_reports r where r.comment_id = p_comment),
         hidden = c.hidden or (select count(*) from comment_reports r where r.comment_id = p_comment) >= p_hide_at
   where c.id = p_comment
  returning c.report_count, c.hidden;
end;
$$;
revoke execute on function report_comment(uuid, text, text, integer) from public, anon, authenticated;
