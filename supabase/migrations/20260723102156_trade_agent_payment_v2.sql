alter table public.trade_agent_payments
  add column if not exists request_hash text,
  add column if not exists quote_issued_at timestamptz,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists response_json jsonb,
  add column if not exists response_expires_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.trade_agent_payments enable row level security;

alter table public.trade_agent_payments
  drop constraint if exists trade_agent_payments_request_hash_check,
  add constraint trade_agent_payments_request_hash_check
    check (request_hash is null or request_hash ~ '^0x[0-9a-f]{64}$');

alter table public.trade_agent_payments
  drop constraint if exists trade_agent_payments_quote_window_check,
  add constraint trade_agent_payments_quote_window_check
    check (
      (quote_issued_at is null and quote_expires_at is null)
      or (
        quote_issued_at is not null
        and quote_expires_at is not null
        and quote_expires_at > quote_issued_at
      )
    );

alter table public.trade_agent_payments
  drop constraint if exists trade_agent_payments_response_json_check,
  add constraint trade_agent_payments_response_json_check
    check (
      response_json is null
      or (
        jsonb_typeof(response_json) = 'object'
        and response_expires_at is not null
      )
    );

alter table public.trade_agent_payments
  drop constraint if exists trade_agent_payments_status_check,
  add constraint trade_agent_payments_status_check
    check (status in ('pending', 'completed', 'failed'));

create index if not exists trade_agent_payments_status_updated_idx
  on public.trade_agent_payments (status, updated_at);

create index if not exists trade_agent_payments_response_expiry_idx
  on public.trade_agent_payments (response_expires_at)
  where response_json is not null;

revoke all on table public.trade_agent_payments from anon, authenticated;

comment on column public.trade_agent_payments.request_hash is
  'SHA-256 hash of the canonical v2 action, prompt, and sanitized context. Raw prompts and contexts are never stored.';

comment on column public.trade_agent_payments.response_json is
  'Validated, normalized Agent response cached for wallet-authenticated recovery only.';

do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid
      into existing_job_id
      from cron.job
      where jobname = 'trade-agent-response-expiry-hourly'
      limit 1;

    if existing_job_id is not null then
      perform cron.unschedule(existing_job_id);
    end if;

    perform cron.schedule(
      'trade-agent-response-expiry-hourly',
      '17 * * * *',
      $job$
        update public.trade_agent_payments
        set
          response_json = null,
          updated_at = now()
        where response_json is not null
          and response_expires_at <= now();
      $job$
    );
  end if;
end
$$;
