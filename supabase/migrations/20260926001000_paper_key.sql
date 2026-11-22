-- Stable per-user key for a paper ("arxiv:<id>" or "file:<files-api-id>") so the
-- client can upsert without knowing the row id, plus the display name for resume.
alter table papers add column if not exists paper_key text;
alter table papers add column if not exists name text;
create unique index if not exists papers_email_key_idx on papers (email, paper_key);
