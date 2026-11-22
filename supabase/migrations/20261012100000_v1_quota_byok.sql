-- v1 / PR2: plans, the paper quota, and bring-your-own OpenRouter keys.
--
--   authorize_generation(owner, paper, kind, billing)
--     ├─ paper already counted for this owner? ──► allowed (no new count)
--     ├─ billing off ─────────────────────────────► allowed, counted, never denied
--     ├─ BYOK plan + key ─────────────────────────► allowed on the user's key, no limit
--     ├─ question kind over the daily cap ────────► denied "daily_cap"
--     └─ papers counted this period < allowance ──► reserve 1 paper, else denied "quota"
--   A reserved paper becomes "used" once it has a plan + 1 scene (mark_paper_used),
--   or goes back to the user if nothing was drawn (refund_paper).

-- One row per user. No row = the free plan.
create table if not exists subscriptions (
  owner text primary key,
  plan text not null default 'free' check (plan in ('free', 'byok', 'starter', 'pro')),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'expired')),
  period_start timestamptz,
  period_end timestamptz,
  dodo_customer_id text,
  dodo_subscription_id text unique,
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;

-- "This user has used up this paper." Unique per (owner, paper), so a paper can't count twice.
create table if not exists paper_uses (
  owner text not null,
  paper_id uuid not null references papers (id) on delete cascade,
  status text not null check (status in ('reserved', 'used', 'refunded')),
  plan text not null,                 -- the plan it was counted against
  period_start timestamptz,           -- null on the free plan (counted for life)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, paper_id)
);
create index if not exists paper_uses_owner_idx on paper_uses (owner, plan, period_start);
alter table paper_uses enable row level security;

-- A user's own OpenRouter key, AES-256-GCM encrypted by the app (lib/keys.ts). Never readable in SQL.
create table if not exists api_keys (
  owner text primary key,
  provider text not null default 'openrouter' check (provider in ('openrouter')),
  ciphertext text not null,           -- base64(iv | tag | encrypted key)
  key_version integer not null,       -- which KEY_ENCRYPTION_SECRET encrypted it
  last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table api_keys enable row level security;

create or replace function plan_allowance(p_plan text)
returns integer
language sql
immutable
as $$
  select case p_plan when 'free' then 2 when 'starter' then 10 when 'pro' then 30 else null end;
$$;

-- Decides whether `owner` may generate on `paper` and reserves a paper if one is needed.
-- p_kind: 'paper' (walkthrough) or 'question' (ask / click deeper). p_daily_cap applies to
-- questions on the platform key only. Returns
--   { allowed, reason, plan, key_source, reserved_now, used, allowance }.
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
  if found and v_sub.status = 'active' and (v_sub.period_end is null or v_sub.period_end > now()) then
    v_plan := v_sub.plan;
    v_period := v_sub.period_start;
  end if;
  select exists (select 1 from api_keys where owner = p_owner) into v_has_key;

  -- BYOK users pay with their own key; with billing off, anyone who added a key may use it.
  v_key_source := case when v_has_key and (v_plan = 'byok' or not p_billing) then 'byok' else 'platform' end;

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

  v_allowance := plan_allowance(v_plan);
  if v_plan = 'free' then
    select count(*) into v_used from paper_uses where owner = p_owner and plan = 'free' and status in ('reserved', 'used');
  elsif v_allowance is not null then
    select count(*) into v_used from paper_uses
    where owner = p_owner and plan = v_plan and period_start is not distinct from v_period and status in ('reserved', 'used');
  else
    v_used := 0;
  end if;

  if p_billing and v_key_source = 'platform' and v_allowance is not null and v_used >= v_allowance then
    return jsonb_build_object('allowed', false, 'reason', 'quota', 'plan', v_plan, 'key_source', v_key_source, 'used', v_used, 'allowance', v_allowance);
  end if;

  insert into paper_uses (owner, paper_id, status, plan, period_start)
  values (p_owner, p_paper, 'reserved', v_plan, case when v_plan = 'free' then null else v_period end)
  on conflict (owner, paper_id) do update
    set status = 'reserved', plan = excluded.plan, period_start = excluded.period_start, updated_at = now();

  return jsonb_build_object('allowed', true, 'reason', 'reserved', 'plan', v_plan, 'key_source', v_key_source,
    'reserved_now', true, 'used', v_used + 1, 'allowance', v_allowance);
end;
$$;

-- The paper delivered (a plan and at least one scene, or a finished answer): it stays counted.
create or replace function mark_paper_used(p_owner text, p_paper uuid)
returns void
language sql
as $$
  update paper_uses set status = 'used', updated_at = now()
  where owner = p_owner and paper_id = p_paper and status = 'reserved';
$$;

-- Nothing was drawn: give the paper back. Only a reservation can be refunded, never a used paper.
create or replace function refund_paper(p_owner text, p_paper uuid)
returns void
language sql
as $$
  update paper_uses set status = 'refunded', updated_at = now()
  where owner = p_owner and paper_id = p_paper and status = 'reserved';
$$;

revoke execute on function authorize_generation(text, uuid, text, boolean, integer) from public, anon, authenticated;
revoke execute on function mark_paper_used(text, uuid) from public, anon, authenticated;
revoke execute on function refund_paper(text, uuid) from public, anon, authenticated;
