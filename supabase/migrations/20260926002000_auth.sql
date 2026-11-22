-- Real accounts (Supabase Auth, Google sign-in). Each paper belongs to a user;
-- the two pre-generated demo papers are public and readable by anyone.

alter table papers add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table papers add column if not exists is_public boolean not null default false;
alter table papers alter column email drop not null;

drop index if exists papers_email_key_idx;
create unique index if not exists papers_user_key_idx on papers (user_id, paper_key);
create index if not exists papers_user_updated_idx on papers (user_id, updated_at desc);

-- The Google (PageRank) and Attention demo walkthroughs.
update papers set is_public = true
where id in ('88c75ec0-fee6-412c-bc5c-ee7f8a157f0d', '67cd26b5-7dc5-4dfe-8141-6fbca4bf0e08');

-- The server uses the service role (bypasses RLS) and filters by user itself; these
-- policies keep the public key from reading or writing anyone else's rows.
drop policy if exists "papers readable when public or own" on papers;
create policy "papers readable when public or own" on papers
  for select to anon, authenticated using (is_public or user_id = auth.uid());
drop policy if exists "papers insert own" on papers;
create policy "papers insert own" on papers
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "papers update own" on papers;
create policy "papers update own" on papers
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "papers delete own" on papers;
create policy "papers delete own" on papers
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "nodes readable with their paper" on nodes;
create policy "nodes readable with their paper" on nodes
  for select to anon, authenticated
  using (exists (select 1 from papers p where p.id = nodes.paper_id and (p.is_public or p.user_id = auth.uid())));
drop policy if exists "nodes write own" on nodes;
create policy "nodes write own" on nodes
  for all to authenticated
  using (exists (select 1 from papers p where p.id = nodes.paper_id and p.user_id = auth.uid()))
  with check (exists (select 1 from papers p where p.id = nodes.paper_id and p.user_id = auth.uid()));
