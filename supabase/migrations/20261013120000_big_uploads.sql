-- Direct-to-storage uploads for PDFs over 4 MB (Vercel caps request bodies at ~4.5 MB).
--
--   POST /api/play/upload/start ──► staged_uploads row + signed upload URL to papers/incoming/<owner>/<uuid>.pdf
--   browser PUTs the file straight to Storage
--   POST /api/play/upload/finish ──► claim the row (owner, unfinished, fresh) ──► check, hash, store as <sha>.pdf
--   GET /api/cron/uploads (daily) ──► remove staged objects older than a day, and their rows
--
-- Only the server (service role) reads or writes this table.
create table if not exists staged_uploads (
  path text primary key,                -- object path in the "papers" bucket, under incoming/
  owner text not null,                  -- Clerk user who started it; only they can finish it
  created_at timestamptz not null default now(),
  finished_at timestamptz               -- set once, by the finish call that claims it
);
create index if not exists staged_uploads_created_idx on staged_uploads (created_at);
alter table staged_uploads enable row level security;

-- The bucket already allows 15 MB PDFs (20261012000000_v1_server_saving.sql); make sure of it.
update storage.buckets
set file_size_limit = 15728640, allowed_mime_types = array['application/pdf']
where id = 'papers' and (file_size_limit is distinct from 15728640 or allowed_mime_types is distinct from array['application/pdf']);
