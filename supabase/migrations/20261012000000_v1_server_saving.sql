-- v1 / PR1: PDFs we store ourselves, server-side saving of walkthroughs, the usage ledger,
-- and per-user nodes on shared (library) papers.

-- Papers: where the PDF lives, the walkthrough plan (scenes before they're drawn),
-- and a short lease so two tabs don't draw the same paper's scenes at once.
alter table papers add column if not exists pdf_sha256 text;
alter table papers add column if not exists walkthrough_plan jsonb;
alter table papers add column if not exists drawing_until timestamptz;

-- Private bucket for paper PDFs, keyed by sha256. Only the server (service role) touches it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

-- Nodes: owner '' = part of the paper itself; otherwise the Clerk user whose private question it is.
alter table nodes add column if not exists owner text not null default '';
alter table nodes drop constraint if exists nodes_pkey;
alter table nodes add primary key (paper_id, owner, id);

-- One row per model call: the usage page and spend alerts read this.
create table if not exists usage_events (
  id bigint generated always as identity primary key,
  owner text not null,
  paper_id uuid references papers (id) on delete set null,
  step text not null,                 -- plan | scene:s3 | overview | ask | deeper | suggest
  model text not null,
  key_source text not null check (key_source in ('platform', 'byok')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_owner_idx on usage_events (owner, created_at desc);
alter table usage_events enable row level security;

-- Adds or replaces one finished scene in papers.walkthrough, keeping scenes in order.
-- A single UPDATE, so scenes finishing at the same moment can't overwrite each other.
create or replace function save_walkthrough_scene(p_paper uuid, p_scene jsonb)
returns void
language sql
as $$
  update papers
  set walkthrough = jsonb_set(
        coalesce(walkthrough, jsonb_build_object('paper', walkthrough_plan -> 'paper', 'scenes', '[]'::jsonb)),
        '{scenes}',
        (
          select coalesce(jsonb_agg(x.s order by (x.s ->> 'index')::int), '[]'::jsonb)
          from (
            select s from jsonb_array_elements(coalesce(walkthrough -> 'scenes', '[]'::jsonb)) as s
            where s ->> 'id' <> p_scene ->> 'id'
            union all
            select p_scene
          ) as x (s)
        )
      ),
      updated_at = now()
  where id = p_paper;
$$;

-- Takes the drawing lease for a paper if nobody holds it. Returns true when taken.
create or replace function take_drawing_lease(p_paper uuid, p_seconds integer)
returns boolean
language sql
as $$
  with taken as (
    update papers
    set drawing_until = now() + make_interval(secs => p_seconds)
    where id = p_paper and (drawing_until is null or drawing_until < now())
    returning id
  )
  select exists (select 1 from taken);
$$;

revoke execute on function save_walkthrough_scene(uuid, jsonb) from public, anon, authenticated;
revoke execute on function take_drawing_lease(uuid, integer) from public, anon, authenticated;
