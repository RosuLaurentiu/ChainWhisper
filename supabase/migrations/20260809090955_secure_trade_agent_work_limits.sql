create table if not exists public.trade_agent_request_limits (
  bucket_start timestamptz not null,
  request_kind text not null check (request_kind in ('estimate', 'quote', 'recover', 'run')),
  scope text not null check (scope in ('global', 'ip')),
  identity_hash text not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_start, request_kind, scope, identity_hash)
);

alter table public.trade_agent_request_limits enable row level security;

revoke all on table public.trade_agent_request_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.trade_agent_request_limits to service_role;

create or replace function public.claim_trade_agent_request(p_ip_hash text, p_kind text)
returns table (
  allowed boolean,
  reason text,
  user_count integer,
  global_count integer,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_bucket_start timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_user_count integer := 0;
  v_global_count integer := 0;
  v_user_limit integer;
  v_global_limit integer;
  v_retry_after_seconds integer := greatest(
    1,
    pg_catalog.ceil(
      extract(epoch from (v_bucket_start + interval '1 hour' - pg_catalog.now()))
    )::integer
  );
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Trade Agent IP hash is invalid.' using errcode = '22023';
  end if;
  if p_kind not in ('estimate', 'quote', 'recover', 'run') then
    raise exception 'Trade Agent request kind is invalid.' using errcode = '22023';
  end if;

  v_user_limit := case p_kind
    when 'quote' then 60
    else 120
  end;
  v_global_limit := case p_kind
    when 'quote' then 2000
    else 5000
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'chainwhisper:trade-agent:' || p_kind || ':' || v_bucket_start::text,
      0
    )
  );

  select
    coalesce(max(limits.request_count) filter (
      where limits.scope = 'ip' and limits.identity_hash = p_ip_hash
    ), 0),
    coalesce(max(limits.request_count) filter (
      where limits.scope = 'global' and limits.identity_hash = 'global'
    ), 0)
  into v_user_count, v_global_count
  from public.trade_agent_request_limits as limits
  where limits.bucket_start = v_bucket_start
    and limits.request_kind = p_kind
    and (
      (limits.scope = 'ip' and limits.identity_hash = p_ip_hash)
      or (limits.scope = 'global' and limits.identity_hash = 'global')
    );

  if v_global_count >= v_global_limit then
    return query select false, 'global_limit'::text, v_user_count, v_global_count, v_retry_after_seconds;
    return;
  end if;
  if v_user_count >= v_user_limit then
    return query select false, 'user_limit'::text, v_user_count, v_global_count, v_retry_after_seconds;
    return;
  end if;

  insert into public.trade_agent_request_limits as limits (
    bucket_start,
    request_kind,
    scope,
    identity_hash,
    request_count,
    updated_at
  )
  values (v_bucket_start, p_kind, 'global', 'global', 1, pg_catalog.now())
  on conflict (bucket_start, request_kind, scope, identity_hash)
  do update set
    request_count = limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_global_count;

  insert into public.trade_agent_request_limits as limits (
    bucket_start,
    request_kind,
    scope,
    identity_hash,
    request_count,
    updated_at
  )
  values (v_bucket_start, p_kind, 'ip', p_ip_hash, 1, pg_catalog.now())
  on conflict (bucket_start, request_kind, scope, identity_hash)
  do update set
    request_count = limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_user_count;

  return query select true, 'allowed'::text, v_user_count, v_global_count, v_retry_after_seconds;
end;
$function$;

revoke all on function public.claim_trade_agent_request(text, text) from public, anon, authenticated;
grant execute on function public.claim_trade_agent_request(text, text) to service_role;

alter table public.trade_agent_payments
  add column if not exists attempt_count integer not null default 1,
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

update public.trade_agent_payments
set
  attempt_count = greatest(attempt_count, 1),
  claim_token = case
    when status = 'pending' then coalesce(claim_token, pg_catalog.gen_random_uuid())
    else null
  end,
  lease_expires_at = case
    when status = 'pending' then coalesce(lease_expires_at, updated_at + interval '2 minutes')
    else null
  end;

alter table public.trade_agent_payments
  drop constraint if exists trade_agent_payments_attempt_count_check,
  add constraint trade_agent_payments_attempt_count_check
    check (attempt_count between 1 and 3),
  drop constraint if exists trade_agent_payments_status_check,
  add constraint trade_agent_payments_status_check
    check (status in ('pending', 'completed', 'failed', 'terminal'));

create index if not exists trade_agent_payments_retry_idx
  on public.trade_agent_payments (status, next_attempt_at, lease_expires_at);

create or replace function public.claim_trade_agent_payment(
  p_payment_id bigint,
  p_claim_token uuid
)
returns setof public.trade_agent_payments
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_payment public.trade_agent_payments%rowtype;
begin
  if p_payment_id is null or p_payment_id <= 0 or p_claim_token is null then
    raise exception 'Trade Agent payment claim is invalid.' using errcode = '22023';
  end if;

  select payments.*
  into v_payment
  from public.trade_agent_payments as payments
  where payments.id = p_payment_id
  for update;

  if not found then
    return;
  end if;

  if v_payment.status = 'failed' then
    if v_payment.attempt_count >= 3 then
      update public.trade_agent_payments as payments
      set
        claim_token = null,
        lease_expires_at = null,
        next_attempt_at = null,
        status = 'terminal',
        updated_at = v_now
      where payments.id = p_payment_id;
      return;
    end if;
    if v_payment.next_attempt_at is not null and v_payment.next_attempt_at > v_now then
      return;
    end if;
  elsif v_payment.status = 'pending' then
    if coalesce(v_payment.lease_expires_at, v_payment.updated_at + interval '2 minutes') > v_now then
      return;
    end if;
    if v_payment.attempt_count >= 3 then
      update public.trade_agent_payments as payments
      set
        claim_token = null,
        lease_expires_at = null,
        next_attempt_at = null,
        status = 'terminal',
        updated_at = v_now
      where payments.id = p_payment_id;
      return;
    end if;
  else
    return;
  end if;

  return query
  update public.trade_agent_payments as payments
  set
    attempt_count = payments.attempt_count + 1,
    claim_token = p_claim_token,
    completed_at = null,
    error_message = null,
    lease_expires_at = v_now + interval '2 minutes',
    next_attempt_at = null,
    response_expires_at = null,
    response_json = null,
    status = 'pending',
    updated_at = v_now
  where payments.id = p_payment_id
  returning payments.*;
end;
$function$;

revoke all on function public.claim_trade_agent_payment(bigint, uuid) from public, anon, authenticated;
grant execute on function public.claim_trade_agent_payment(bigint, uuid) to service_role;

comment on table public.trade_agent_request_limits is
  'Atomic hourly HMAC-hashed IP and project-wide admission counters for public Trade Agent routes.';

comment on column public.trade_agent_payments.attempt_count is
  'Number of claimed provider attempts for this paid request; capped at three.';

comment on column public.trade_agent_payments.claim_token is
  'Opaque current-worker fence required when writing a provider result.';

do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid
      into existing_job_id
      from cron.job
      where jobname = 'trade-agent-rate-limit-retention-daily'
      limit 1;

    if existing_job_id is not null then
      perform cron.unschedule(existing_job_id);
    end if;

    perform cron.schedule(
      'trade-agent-rate-limit-retention-daily',
      '31 3 * * *',
      $job$
        delete from public.trade_agent_request_limits
        where bucket_start < now() - interval '2 days';
      $job$
    );
  end if;
end
$$;
