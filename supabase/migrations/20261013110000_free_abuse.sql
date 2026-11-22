-- Defenses against farming free papers with new accounts.
--
--   a new free paper on our key (billing on)
--     ├─ email on the disposable list ─────────────► denied "disposable_email"
--     └─ free papers from this IP in the last day ≥ limit ─► denied "ip_limit"
--   Paid plans, BYOK with a key, papers already counted and billing off are never affected.
--
-- The IP is never stored: the app sends an HMAC of it (lib/abuse.ts), kept only on free papers.

alter table paper_uses add column if not exists ip_hash text;
create index if not exists paper_uses_ip_idx on paper_uses (ip_hash, created_at) where ip_hash is not null;

-- The 5-argument version is replaced (not overloaded), so PostgREST has one function to pick.
drop function if exists authorize_generation(text, uuid, text, boolean, integer);

-- Same rules as PR3, plus two checks just before a new free paper is reserved:
--   p_email_disposable: true → denied; null → "check_email" (the app looks the email up and asks
--     again, so the Clerk call only happens when a free paper is about to be counted); false → fine.
--   p_ip_hash / p_ip_limit: free papers counted from this IP hash in the last day, across all users.
--     Locked per IP hash, so parallel requests from two new accounts can't both take the last one.
create or replace function authorize_generation(
  p_owner text,
  p_paper uuid,
  p_kind text,
  p_billing boolean,
  p_daily_cap integer default 100,
  p_ip_hash text default null,
  p_ip_limit integer default null,
  p_email_disposable boolean default false
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
  v_from_ip integer;
  v_guard boolean;
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

  -- A new free paper on our key: the abuse checks. Only these papers carry the IP hash.
  v_guard := p_billing and v_count_as = 'free' and v_key_source = 'platform';
  if v_guard then
    if p_email_disposable is null then
      return jsonb_build_object('allowed', false, 'reason', 'check_email', 'plan', v_plan, 'key_source', v_key_source);
    elsif p_email_disposable then
      return jsonb_build_object('allowed', false, 'reason', 'disposable_email', 'plan', v_plan, 'key_source', v_key_source);
    end if;
    if p_ip_hash is not null and p_ip_limit is not null then
      perform pg_advisory_xact_lock(hashtext('authorize-ip:' || p_ip_hash));
      select count(*) into v_from_ip from paper_uses
      where ip_hash = p_ip_hash and plan = 'free' and status in ('reserved', 'used')
        and created_at > now() - interval '1 day';
      if v_from_ip >= p_ip_limit then
        return jsonb_build_object('allowed', false, 'reason', 'ip_limit', 'plan', v_plan, 'key_source', v_key_source);
      end if;
    end if;
  end if;

  -- created_at restarts when a refunded paper is reserved again: it's a new count for the IP window.
  insert into paper_uses (owner, paper_id, status, plan, period_start, ip_hash)
  values (p_owner, p_paper, 'reserved', v_count_as, case when v_count_as = 'free' then null else v_period end,
    case when v_count_as = 'free' then p_ip_hash end)
  on conflict (owner, paper_id) do update
    set status = 'reserved', plan = excluded.plan, period_start = excluded.period_start, ip_hash = excluded.ip_hash,
      created_at = now(), updated_at = now();

  return jsonb_build_object('allowed', true, 'reason', 'reserved', 'plan', v_plan, 'key_source', v_key_source,
    'reserved_now', true, 'used', v_used + 1, 'allowance', v_allowance);
end;
$$;

revoke execute on function authorize_generation(text, uuid, text, boolean, integer, text, integer, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
