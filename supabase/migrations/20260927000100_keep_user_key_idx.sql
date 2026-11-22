-- Keep the old (user_id, paper_key) index until the Supabase Auth build is fully replaced;
-- the previous deploy upserts against it. Harmless afterwards (user_id stays null).
create unique index if not exists papers_user_key_idx on papers (user_id, paper_key);
