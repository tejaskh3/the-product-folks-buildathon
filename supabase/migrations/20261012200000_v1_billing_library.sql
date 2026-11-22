-- v1 / PR3: Dodo billing and the library.
--
--   Dodo webhook ──► webhook_events (seen? skip) ──► re-fetch the subscription from Dodo ──► subscriptions
--   Library paper = papers.is_public, one shared copy. Each reader's questions on it are their own
--   private nodes (nodes.owner = their id); diagrams that are part of the paper (owner '') are free.

-- Webhook deliveries already handled, by Dodo's webhook-id. Retries and duplicates are skipped.
create table if not exists webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table webhook_events enable row level security;

alter table subscriptions add column if not exists dodo_product_id text;
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;

-- Suggested questions, saved once per paper so reopening it (or reading it in the library) is free.
alter table papers add column if not exists suggestions jsonb;
-- Library listing: a URL-friendly name, the order on /library, and a one-line pitch.
alter table papers add column if not exists library_slug text unique;
alter table papers add column if not exists library_rank integer;
alter table papers add column if not exists library_blurb text;

-- Same rules as PR2, with three changes:
--   · a renewal that lands a little late doesn't drop a paying user to free (1 day grace);
--   · BYOK without a key counts against the free allowance (it isn't unlimited on our key);
--   · papers used this period count across paid plans, so an upgrade gives
--     "new allowance minus papers already used this period", not a fresh start.
create or replace function authorize_generation(
  p_owner text,
  p_paper uuid,
  p_kind text,
  p_billing boolean,
  p_daily_cap integer default 100
)
returns jsonb
language plpgsql
as $$
declare
  v_sub subscriptions%rowtype;
  v_plan text := 'free';
  v_count_as text;
  v_period timestamptz := null;
  v_has_key boolean;
  v_key_source text;
  v_existing paper_uses%rowtype;
  v_allowance integer;
  v_used integer;
  v_today integer;
begin
  -- One decision at a time per user: two tabs can't both take the last paper.
  perform pg_advisory_xact_lock(hashtext('authorize:' || p_owner));

  select * into v_sub from subscriptions where owner = p_owner;
  if found and v_sub.status = 'active' and (v_sub.period_end is null or v_sub.period_end + interval '1 day' > now()) then
    v_plan := v_sub.plan;
    v_period := v_sub.period_start;
  end if;
  select exists (select 1 from api_keys where owner = p_owner) into v_has_key;

  -- BYOK users pay with their own key; with billing off, anyone who added a key may use it.
  v_key_source := case when v_has_key and (v_plan = 'byok' or not p_billing) then 'byok' else 'platform' end;
  -- What the paper counts against: BYOK without a key is the free allowance.
  v_count_as := case when v_plan = 'byok' and not v_has_key then 'free' else v_plan end;

  -- Hidden fair-use cap on questions run on our key.
  if p_kind = 'question' and v_key_source = 'platform' and p_billing then
    select count(*) into v_today from usage_events
    where owner = p_owner and key_source = 'platform' and step in ('ask', 'deeper')
      and created_at > now() - interval '1 day';
    if v_today >= p_daily_cap then
      return jsonb_build_object('allowed', false, 'reason', 'daily_cap', 'plan', v_plan, 'key_source', v_key_source);
    end if;
  end if;

  select * into v_existing from paper_uses where owner = p_owner and paper_id = p_paper;
  if found and v_existing.status in ('reserved', 'used') then
    return jsonb_build_object('allowed', true, 'reason', 'already_counted', 'plan', v_plan, 'key_source', v_key_source, 'reserved_now', false);
  end if;

  v_allowance := case when v_key_source = 'byok' then null else plan_allowance(v_count_as) end;
  if v_count_as = 'free' then
    select count(*) into v_used from paper_uses where owner = p_owner and plan = 'free' and status in ('reserved', 'used');
  elsif v_allowance is not null then
    select count(*) into v_used from paper_uses
    where owner = p_owner and plan in ('starter', 'pro') and period_start is not distinct from v_period and status in ('reserved', 'used');
  else
    v_used := 0;
  end if;

  if p_billing and v_allowance is not null and v_used >= v_allowance then
    return jsonb_build_object('allowed', false, 'reason', 'quota', 'plan', v_plan, 'key_source', v_key_source, 'used', v_used, 'allowance', v_allowance);
  end if;

  insert into paper_uses (owner, paper_id, status, plan, period_start)
  values (p_owner, p_paper, 'reserved', v_count_as, case when v_count_as = 'free' then null else v_period end)
  on conflict (owner, paper_id) do update
    set status = 'reserved', plan = excluded.plan, period_start = excluded.period_start, updated_at = now();

  return jsonb_build_object('allowed', true, 'reason', 'reserved', 'plan', v_plan, 'key_source', v_key_source,
    'reserved_now', true, 'used', v_used + 1, 'allowance', v_allowance);
end;
$$;

revoke execute on function authorize_generation(text, uuid, text, boolean, integer) from public, anon, authenticated;

-- Readers see a library paper's own nodes (owner ''), never other readers' private ones.
drop policy if exists "public demo nodes readable" on nodes;
create policy "public demo nodes readable" on nodes
  for select to anon, authenticated
  using (owner = '' and exists (select 1 from papers p where p.id = nodes.paper_id and p.is_public));
