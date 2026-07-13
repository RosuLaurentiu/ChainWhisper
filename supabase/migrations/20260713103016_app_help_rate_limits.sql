create table if not exists public.app_help_rate_limits (
  bucket_date date not null,
  scope text not null check (scope in ('global', 'ip')),
  identity_hash text not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, scope, identity_hash)
);

alter table public.app_help_rate_limits enable row level security;

revoke all on table public.app_help_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.app_help_rate_limits to service_role;

create or replace function public.claim_app_help_request(p_ip_hash text)
returns table (
  allowed boolean,
  reason text,
  user_count integer,
  global_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_bucket_date date := (pg_catalog.now() at time zone 'utc')::date;
  v_user_count integer := 0;
  v_global_count integer := 0;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'App Help IP hash is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chainwhisper:app-help:' || v_bucket_date::text, 0)
  );

  select
    coalesce(max(limits.request_count) filter (
      where limits.scope = 'ip' and limits.identity_hash = p_ip_hash
    ), 0),
    coalesce(max(limits.request_count) filter (
      where limits.scope = 'global' and limits.identity_hash = 'global'
    ), 0)
  into v_user_count, v_global_count
  from public.app_help_rate_limits as limits
  where limits.bucket_date = v_bucket_date
    and (
      (limits.scope = 'ip' and limits.identity_hash = p_ip_hash)
      or (limits.scope = 'global' and limits.identity_hash = 'global')
    );

  if v_global_count >= 1000 then
    return query select false, 'global_limit'::text, v_user_count, v_global_count;
    return;
  end if;

  if v_user_count >= 10 then
    return query select false, 'user_limit'::text, v_user_count, v_global_count;
    return;
  end if;

  insert into public.app_help_rate_limits as limits (
    bucket_date,
    scope,
    identity_hash,
    request_count,
    updated_at
  )
  values (v_bucket_date, 'global', 'global', 1, pg_catalog.now())
  on conflict (bucket_date, scope, identity_hash)
  do update set
    request_count = limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_global_count;

  insert into public.app_help_rate_limits as limits (
    bucket_date,
    scope,
    identity_hash,
    request_count,
    updated_at
  )
  values (v_bucket_date, 'ip', p_ip_hash, 1, pg_catalog.now())
  on conflict (bucket_date, scope, identity_hash)
  do update set
    request_count = limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_user_count;

  return query select true, 'allowed'::text, v_user_count, v_global_count;
end;
$function$;

revoke all on function public.claim_app_help_request(text) from public, anon, authenticated;
grant execute on function public.claim_app_help_request(text) to service_role;

comment on table public.app_help_rate_limits is
  'Daily HMAC-hashed IP and global counters for AI-assisted App Help requests.';
