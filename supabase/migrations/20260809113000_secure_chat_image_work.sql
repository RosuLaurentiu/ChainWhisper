alter table public.chat_image_uploads
  add column if not exists authorization_version smallint,
  add column if not exists conversation_target text,
  add column if not exists ciphertext_sha256 char(64),
  add column if not exists confirmation_token_hash char(64),
  add column if not exists authorization_issued_at timestamptz,
  add column if not exists authorization_expires_at timestamptz;

update public.chat_image_uploads
set authorization_version = 0
where authorization_version is null;

alter table public.chat_image_uploads
  alter column authorization_version set default 1,
  alter column authorization_version set not null;

alter table public.chat_image_uploads
  drop constraint if exists chat_image_uploads_binding_fields_check,
  drop constraint if exists chat_image_uploads_authorization_state_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_image_uploads'::regclass
      and conname = 'chat_image_uploads_authorization_version_check'
  ) then
    alter table public.chat_image_uploads
      add constraint chat_image_uploads_authorization_version_check
      check (authorization_version in (0, 1));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_image_uploads'::regclass
      and conname = 'chat_image_uploads_conversation_target_check'
  ) then
    alter table public.chat_image_uploads
      add constraint chat_image_uploads_conversation_target_check
      check (
        conversation_target is null
        or (
          conversation_target = btrim(conversation_target)
          and length(conversation_target) between 1 and 128
          and conversation_target !~ '[[:cntrl:]]'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_image_uploads'::regclass
      and conname = 'chat_image_uploads_ciphertext_sha256_check'
  ) then
    alter table public.chat_image_uploads
      add constraint chat_image_uploads_ciphertext_sha256_check
      check (ciphertext_sha256 is null or ciphertext_sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_image_uploads'::regclass
      and conname = 'chat_image_uploads_confirmation_token_hash_check'
  ) then
    alter table public.chat_image_uploads
      add constraint chat_image_uploads_confirmation_token_hash_check
      check (confirmation_token_hash is null or confirmation_token_hash ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_image_uploads'::regclass
      and conname = 'chat_image_uploads_authorization_state_check'
  ) then
    alter table public.chat_image_uploads
      add constraint chat_image_uploads_authorization_state_check
      check (
        (
          authorization_version = 0
          and conversation_target is null
          and ciphertext_sha256 is null
          and confirmation_token_hash is null
          and authorization_issued_at is null
          and authorization_expires_at is null
        )
        or (
          authorization_version = 1
          and conversation_target is not null
          and ciphertext_sha256 is not null
          and confirmation_token_hash is not null
          and authorization_issued_at is not null
          and authorization_expires_at is not null
          and authorization_expires_at > authorization_issued_at
          and authorization_expires_at <= authorization_issued_at + interval '15 minutes'
          and (
            (
              confirmed_at is null
              and confirmed_tx_hash is null
              and confirmation_token_hash is not null
            )
            or (
              confirmed_at is not null
              and confirmed_tx_hash is not null
            )
          )
        )
      );
  end if;
end $$;

create or replace function public.reject_legacy_chat_image_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.authorization_version = 0 and new.authorization_version <> 0 then
    raise exception 'Legacy chat image uploads cannot be upgraded in place.' using errcode = '23514';
  end if;
  if old.authorization_version = 0
    and old.confirmed_at is null
    and (new.confirmed_at is not null or new.confirmed_tx_hash is not null) then
    raise exception 'Unsigned legacy chat image uploads cannot be confirmed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_legacy_chat_image_confirmation() from public;

drop trigger if exists reject_legacy_chat_image_confirmation
on public.chat_image_uploads;

create trigger reject_legacy_chat_image_confirmation
before update of authorization_version, confirmed_at, confirmed_tx_hash
on public.chat_image_uploads
for each row execute function public.reject_legacy_chat_image_confirmation();

create unique index if not exists chat_image_uploads_confirmation_token_hash_key
on public.chat_image_uploads (confirmation_token_hash)
where confirmation_token_hash is not null;

create index if not exists chat_image_uploads_pending_cleanup_idx
on public.chat_image_uploads (created_at, blob_id)
where confirmed_at is null;

create index if not exists chat_image_uploads_confirmed_cleanup_idx
on public.chat_image_uploads (confirmed_at, blob_id)
where confirmed_at is not null;

create table if not exists public.chat_image_work_counters (
  window_start timestamptz not null,
  work_kind text not null
    check (work_kind in ('upload', 'confirm')),
  scope_kind text not null
    check (scope_kind in ('client', 'wallet', 'global')),
  scope_key text not null,
  cost_units bigint not null default 0
    check (cost_units >= 0),
  byte_count bigint not null default 0
    check (byte_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (window_start, work_kind, scope_kind, scope_key),
  check (
    (scope_kind = 'global' and scope_key = '*')
    or (scope_kind = 'client' and scope_key ~ '^[0-9a-f]{64}$')
    or (scope_kind = 'wallet' and scope_key ~ '^0x[0-9a-f]{40}$')
  )
);

alter table public.chat_image_work_counters enable row level security;
revoke all on public.chat_image_work_counters from public, anon, authenticated, service_role;

create or replace function public.claim_chat_image_work(
  p_kind text,
  p_client_hash text,
  p_wallet_address text default null,
  p_cost_units integer default 1,
  p_bytes bigint default 0
)
returns table (
  allowed boolean,
  reason text,
  retry_after_seconds integer,
  client_cost bigint,
  client_bytes bigint,
  wallet_cost bigint,
  wallet_bytes bigint,
  global_cost bigint,
  global_bytes bigint
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz := date_trunc('hour', v_now);
  v_client_hash text := lower(coalesce(p_client_hash, ''));
  v_wallet_address text := case
    when p_wallet_address is null then null
    else lower(btrim(p_wallet_address))
  end;
  v_retry_after_seconds integer;
  v_client_cost bigint := 0;
  v_client_bytes bigint := 0;
  v_wallet_cost bigint := 0;
  v_wallet_bytes bigint := 0;
  v_global_cost bigint := 0;
  v_global_bytes bigint := 0;
  v_client_cost_limit bigint;
  v_client_byte_limit bigint;
  v_wallet_cost_limit bigint;
  v_wallet_byte_limit bigint;
  v_global_cost_limit bigint;
  v_global_byte_limit bigint;
begin
  if p_kind is null or p_kind not in ('upload', 'confirm') then
    raise exception 'Unsupported chat image work kind.' using errcode = '22023';
  end if;
  if v_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid chat image client identity hash.' using errcode = '22023';
  end if;
  if v_wallet_address is not null and v_wallet_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid chat image wallet address.' using errcode = '22023';
  end if;
  if p_cost_units is null or p_cost_units < 1 or p_cost_units > 10 then
    raise exception 'Invalid chat image work cost.' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > 8454144 then
    raise exception 'Invalid chat image byte cost.' using errcode = '22023';
  end if;
  if (p_kind = 'upload' and p_bytes < 1) or (p_kind = 'confirm' and p_bytes <> 0) then
    raise exception 'Chat image byte cost does not match the work kind.' using errcode = '22023';
  end if;

  if p_kind = 'upload' then
    v_client_cost_limit := 20;
    v_client_byte_limit := 67108864;
    v_wallet_cost_limit := 40;
    v_wallet_byte_limit := 134217728;
    v_global_cost_limit := 2000;
    v_global_byte_limit := 4294967296;
  else
    v_client_cost_limit := 60;
    v_client_byte_limit := 0;
    v_wallet_cost_limit := 120;
    v_wallet_byte_limit := 0;
    v_global_cost_limit := 6000;
    v_global_byte_limit := 0;
  end if;

  v_retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_window_start + interval '1 hour' - v_now)))::integer
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'chat-image-work:' || p_kind || ':' || v_window_start::text,
      0
    )
  );

  select
    coalesce(max(c.cost_units) filter (
      where c.scope_kind = 'client' and c.scope_key = v_client_hash
    ), 0),
    coalesce(max(c.byte_count) filter (
      where c.scope_kind = 'client' and c.scope_key = v_client_hash
    ), 0),
    coalesce(max(c.cost_units) filter (
      where c.scope_kind = 'wallet' and c.scope_key = v_wallet_address
    ), 0),
    coalesce(max(c.byte_count) filter (
      where c.scope_kind = 'wallet' and c.scope_key = v_wallet_address
    ), 0),
    coalesce(max(c.cost_units) filter (
      where c.scope_kind = 'global' and c.scope_key = '*'
    ), 0),
    coalesce(max(c.byte_count) filter (
      where c.scope_kind = 'global' and c.scope_key = '*'
    ), 0)
  into
    v_client_cost,
    v_client_bytes,
    v_wallet_cost,
    v_wallet_bytes,
    v_global_cost,
    v_global_bytes
  from public.chat_image_work_counters c
  where c.window_start = v_window_start
    and c.work_kind = p_kind;

  if v_global_cost + p_cost_units > v_global_cost_limit
    or (p_kind = 'upload' and v_global_bytes + p_bytes > v_global_byte_limit) then
    return query select false, 'global_limit'::text, v_retry_after_seconds,
      v_client_cost, v_client_bytes, v_wallet_cost, v_wallet_bytes, v_global_cost, v_global_bytes;
    return;
  end if;
  if v_client_cost + p_cost_units > v_client_cost_limit
    or (p_kind = 'upload' and v_client_bytes + p_bytes > v_client_byte_limit) then
    return query select false, 'client_limit'::text, v_retry_after_seconds,
      v_client_cost, v_client_bytes, v_wallet_cost, v_wallet_bytes, v_global_cost, v_global_bytes;
    return;
  end if;
  if v_wallet_address is not null and (
    v_wallet_cost + p_cost_units > v_wallet_cost_limit
    or (p_kind = 'upload' and v_wallet_bytes + p_bytes > v_wallet_byte_limit)
  ) then
    return query select false, 'wallet_limit'::text, v_retry_after_seconds,
      v_client_cost, v_client_bytes, v_wallet_cost, v_wallet_bytes, v_global_cost, v_global_bytes;
    return;
  end if;

  insert into public.chat_image_work_counters (
    window_start, work_kind, scope_kind, scope_key, cost_units, byte_count, updated_at
  ) values (
    v_window_start, p_kind, 'global', '*', p_cost_units, p_bytes, v_now
  )
  on conflict (window_start, work_kind, scope_kind, scope_key) do update
  set
    cost_units = public.chat_image_work_counters.cost_units + excluded.cost_units,
    byte_count = public.chat_image_work_counters.byte_count + excluded.byte_count,
    updated_at = excluded.updated_at;

  insert into public.chat_image_work_counters (
    window_start, work_kind, scope_kind, scope_key, cost_units, byte_count, updated_at
  ) values (
    v_window_start, p_kind, 'client', v_client_hash, p_cost_units, p_bytes, v_now
  )
  on conflict (window_start, work_kind, scope_kind, scope_key) do update
  set
    cost_units = public.chat_image_work_counters.cost_units + excluded.cost_units,
    byte_count = public.chat_image_work_counters.byte_count + excluded.byte_count,
    updated_at = excluded.updated_at;

  if v_wallet_address is not null then
    insert into public.chat_image_work_counters (
      window_start, work_kind, scope_kind, scope_key, cost_units, byte_count, updated_at
    ) values (
      v_window_start, p_kind, 'wallet', v_wallet_address, p_cost_units, p_bytes, v_now
    )
    on conflict (window_start, work_kind, scope_kind, scope_key) do update
    set
      cost_units = public.chat_image_work_counters.cost_units + excluded.cost_units,
      byte_count = public.chat_image_work_counters.byte_count + excluded.byte_count,
      updated_at = excluded.updated_at;
  end if;

  v_client_cost := v_client_cost + p_cost_units;
  v_client_bytes := v_client_bytes + p_bytes;
  v_global_cost := v_global_cost + p_cost_units;
  v_global_bytes := v_global_bytes + p_bytes;
  if v_wallet_address is not null then
    v_wallet_cost := v_wallet_cost + p_cost_units;
    v_wallet_bytes := v_wallet_bytes + p_bytes;
  end if;

  delete from public.chat_image_work_counters stale
  where stale.ctid in (
    select old.ctid
    from public.chat_image_work_counters old
    where old.window_start < v_window_start - interval '48 hours'
    order by old.window_start
    limit 500
  );

  return query select true, 'allowed'::text, v_retry_after_seconds,
    v_client_cost, v_client_bytes, v_wallet_cost, v_wallet_bytes, v_global_cost, v_global_bytes;
end;
$$;

revoke all on function public.claim_chat_image_work(text, text, text, integer, bigint)
from public, anon, authenticated;
grant execute on function public.claim_chat_image_work(text, text, text, integer, bigint)
to service_role;

create table if not exists public.chat_image_cleanup_state (
  singleton boolean primary key default true
    check (singleton),
  lease_token uuid,
  locked_until timestamptz not null default '-infinity'::timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz
);

insert into public.chat_image_cleanup_state (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.chat_image_cleanup_state enable row level security;
revoke all on public.chat_image_cleanup_state from public, anon, authenticated, service_role;

create or replace function public.claim_chat_image_cleanup_batch(
  p_pending_cutoff timestamptz,
  p_confirmed_cutoff timestamptz,
  p_limit integer default 500,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid;
  v_retry_after_seconds integer := 0;
  v_blob_ids jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid chat image cleanup batch limit.' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'Invalid chat image cleanup lease duration.' using errcode = '22023';
  end if;
  if p_pending_cutoff is null or p_confirmed_cutoff is null
    or p_pending_cutoff > v_now or p_confirmed_cutoff > v_now then
    raise exception 'Invalid chat image cleanup cutoff.' using errcode = '22023';
  end if;

  insert into public.chat_image_cleanup_state (
    singleton, lease_token, locked_until, last_started_at
  ) values (
    true,
    pg_catalog.gen_random_uuid(),
    v_now + make_interval(secs => p_lease_seconds),
    v_now
  )
  on conflict (singleton) do update
  set
    lease_token = excluded.lease_token,
    locked_until = excluded.locked_until,
    last_started_at = excluded.last_started_at
  where public.chat_image_cleanup_state.locked_until <= v_now
  returning lease_token into v_lease_token;

  if v_lease_token is null then
    select greatest(
      1,
      ceil(extract(epoch from (s.locked_until - v_now)))::integer
    )
    into v_retry_after_seconds
    from public.chat_image_cleanup_state s
    where s.singleton;

    return jsonb_build_object(
      'admitted', false,
      'retryAfterSeconds', coalesce(v_retry_after_seconds, p_lease_seconds)
    );
  end if;

  with pending_candidates as (
    select u.blob_id, u.created_at as expired_at
    from public.chat_image_uploads u
    where u.confirmed_at is null
      and u.created_at <= p_pending_cutoff
    order by u.created_at, u.blob_id
    limit p_limit
  ), confirmed_candidates as (
    select u.blob_id, u.confirmed_at as expired_at
    from public.chat_image_uploads u
    where u.confirmed_at is not null
      and u.confirmed_at <= p_confirmed_cutoff
    order by u.confirmed_at, u.blob_id
    limit p_limit
  ), candidates as (
    select p.blob_id, p.expired_at from pending_candidates p
    union all
    select c.blob_id, c.expired_at from confirmed_candidates c
  ), deduplicated as (
    select c.blob_id, min(c.expired_at) as expired_at
    from candidates c
    group by c.blob_id
  ), bounded as (
    select d.blob_id, d.expired_at
    from deduplicated d
    order by d.expired_at, d.blob_id
    limit p_limit
  )
  select coalesce(jsonb_agg(b.blob_id order by b.expired_at, b.blob_id), '[]'::jsonb)
  into v_blob_ids
  from bounded b;

  return jsonb_build_object(
    'admitted', true,
    'leaseToken', v_lease_token,
    'blobIds', v_blob_ids,
    'retryAfterSeconds', 0
  );
end;
$$;

create or replace function public.finish_chat_image_cleanup_run(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_updated integer := 0;
begin
  if p_lease_token is null then
    return false;
  end if;

  update public.chat_image_cleanup_state
  set
    lease_token = null,
    locked_until = clock_timestamp(),
    last_finished_at = clock_timestamp()
  where singleton
    and lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_chat_image_cleanup_batch(timestamptz, timestamptz, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_chat_image_cleanup_batch(timestamptz, timestamptz, integer, integer)
to service_role;

revoke all on function public.finish_chat_image_cleanup_run(uuid)
from public, anon, authenticated;
grant execute on function public.finish_chat_image_cleanup_run(uuid)
to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'chat-image-cleanup-every-15-min';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'chat-image-cleanup-every-15-min',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := 'https://ousgmjyajyorywpqbdkf.supabase.co/functions/v1/chat-image-cleanup',
        headers := jsonb_strip_nulls(jsonb_build_object(
          'Content-Type', 'application/json',
          'x-chat-image-cleanup-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'chat_image_cleanup_secret'
            order by created_at desc
            limit 1
          )
        )),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$
  );
end $$;

comment on function public.claim_chat_image_work(text, text, text, integer, bigint) is
  'Atomically admits bounded chat-image upload or confirmation work per client, wallet, and project hour.';

comment on function public.claim_chat_image_cleanup_batch(timestamptz, timestamptz, integer, integer) is
  'Claims a single cleanup lease and returns at most 500 expired tracked or orphaned chat-image object names.';
