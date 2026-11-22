-- Accounts moved from Supabase Auth to Clerk. Papers are owned by a Clerk user id
-- (text, e.g. "user_2abc…") in `owner`; `user_id` (Supabase Auth uuid) is kept but unused.
-- The server uses the service role and always filters by owner; the public key can only
-- read the public demo papers.

alter table papers add column if not exists owner text;

drop index if exists papers_user_key_idx;
drop index if exists papers_user_updated_idx;
create unique index if not exists papers_owner_key_idx on papers (owner, paper_key);
create index if not exists papers_owner_updated_idx on papers (owner, updated_at desc);

drop policy if exists "papers readable when public or own" on papers;
drop policy if exists "papers insert own" on papers;
drop policy if exists "papers update own" on papers;
drop policy if exists "papers delete own" on papers;
drop policy if exists "nodes readable with their paper" on nodes;
drop policy if exists "nodes write own" on nodes;

create policy "public demo papers readable" on papers
  for select to anon, authenticated using (is_public);
create policy "public demo nodes readable" on nodes
  for select to anon, authenticated
  using (exists (select 1 from papers p where p.id = nodes.paper_id and p.is_public));
