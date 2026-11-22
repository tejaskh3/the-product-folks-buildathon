-- Cheaper paper sending (PAPER_SENDING=digest): a compact text digest of the whole paper,
-- made once (by the walkthrough plan, or the first question on a library paper) and reused by
-- every later call on it, for every reader. Null until then; the code falls back to the whole PDF.
-- Page slices are cached in the existing "papers" bucket under slices/<sha>/, so no bucket change.
alter table papers add column if not exists digest jsonb;
