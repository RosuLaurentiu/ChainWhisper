begin;

select plan(23);

select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'app_help_rate_limits',
        'chat_image_cleanup_state',
        'chat_image_uploads',
        'chat_image_work_counters',
        'chat_read_cursors',
        'trade_agent_payments',
        'trade_agent_request_limits'
      )
      and c.relrowsecurity
    order by c.relname
  $$,
  $$ values
    ('app_help_rate_limits'::text collate "C"),
    ('chat_image_cleanup_state'::text collate "C"),
    ('chat_image_uploads'::text collate "C"),
    ('chat_image_work_counters'::text collate "C"),
    ('chat_read_cursors'::text collate "C"),
    ('trade_agent_payments'::text collate "C"),
    ('trade_agent_request_limits'::text collate "C")
  $$,
  'Every exposed application table enables RLS'
);

select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relforcerowsecurity
    order by c.relname
  $$,
  $$ values ('chat_read_cursors'::text collate "C") $$,
  'Only the owner-facing cursor table needs forced RLS'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name in (
        'app_help_rate_limits', 'chat_image_cleanup_state', 'chat_image_uploads',
        'chat_image_work_counters', 'chat_read_cursors', 'trade_agent_payments',
        'trade_agent_request_limits'
      )
  $$,
  $$ values (0::bigint) $$,
  'Anonymous callers receive no application-table privileges'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name <> 'chat_read_cursors'
      and table_name in (
        'app_help_rate_limits', 'chat_image_cleanup_state', 'chat_image_uploads',
        'chat_image_work_counters', 'trade_agent_payments', 'trade_agent_request_limits'
      )
  $$,
  $$ values (0::bigint) $$,
  'Authenticated wallets receive no service-table privileges'
);

select results_eq(
  $$
    select privilege_type::text collate "C"
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'chat_read_cursors'
      and grantee = 'authenticated'
    order by privilege_type
  $$,
  $$ values
    ('DELETE'::text collate "C"),
    ('INSERT'::text collate "C"),
    ('SELECT'::text collate "C"),
    ('UPDATE'::text collate "C")
  $$,
  'Authenticated wallets receive exactly the cursor CRUD privileges governed by RLS'
);

select results_eq(
  $$
    select privilege_type::text collate "C"
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'trade_agent_payments'
      and grantee = 'service_role'
    order by privilege_type
  $$,
  $$ values
    ('INSERT'::text collate "C"),
    ('SELECT'::text collate "C"),
    ('UPDATE'::text collate "C")
  $$,
  'Trade Agent service role receives only the DML used by the Edge Function'
);

select results_eq(
  $$
    select privilege_type::text collate "C"
    from information_schema.role_usage_grants
    where object_schema = 'public'
      and object_name = 'trade_agent_payments_id_seq'
      and grantee = 'service_role'
    order by privilege_type
  $$,
  $$ values ('USAGE'::text collate "C") $$,
  'Trade Agent service role can allocate payment identity values but not alter the sequence'
);

set local role service_role;

select lives_ok(
  $$
    insert into public.trade_agent_payments (
      payment_tx_hash,
      payer_address,
      fee_token_address,
      fee_recipient,
      fee_amount_wei,
      action_type
    ) values (
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
      '1',
      'service-role-boundary-test'
    )
  $$,
  'Trade Agent service role can insert the payment record used by the Edge Function'
);

select lives_ok(
  $$
    update public.trade_agent_payments
    set status = 'completed', completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where payment_tx_hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $$,
  'Trade Agent service role can complete its payment record'
);

reset role;

select results_eq(
  $$
    select table_name::text collate "C",
           string_agg(privilege_type, ',' order by privilege_type)::text collate "C"
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'service_role'
      and table_name in ('app_help_rate_limits', 'chat_image_uploads', 'trade_agent_request_limits')
      and privilege_type in ('DELETE', 'INSERT', 'SELECT', 'UPDATE')
    group by table_name
    order by table_name
  $$,
  $$ values
    ('app_help_rate_limits'::text collate "C", 'INSERT,SELECT,UPDATE'::text collate "C"),
    ('chat_image_uploads'::text collate "C", 'DELETE,INSERT,SELECT,UPDATE'::text collate "C"),
    ('trade_agent_request_limits'::text collate "C", 'DELETE,INSERT,SELECT,UPDATE'::text collate "C")
  $$,
  'Service tables expose only their required DML set'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'service_role'
      and table_name in ('chat_image_work_counters', 'chat_image_cleanup_state')
  $$,
  $$ values (0::bigint) $$,
  'SECURITY DEFINER image internals have no direct service-role table access'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'app_help_rate_limits', 'chat_image_cleanup_state', 'chat_image_uploads',
        'chat_image_work_counters', 'trade_agent_payments', 'trade_agent_request_limits'
      )
  $$,
  $$ values (0::bigint) $$,
  'Service-only tables have no end-user RLS policies'
);

select results_eq(
  $$
    select policyname::text collate "C", cmd::text collate "C"
    from pg_policies
    where schemaname = 'public' and tablename = 'chat_read_cursors'
    order by cmd, policyname
  $$,
  $$ values
    ('Wallet users can delete their own chat cursors'::text collate "C", 'DELETE'::text collate "C"),
    ('Wallet users can create their own chat cursors'::text collate "C", 'INSERT'::text collate "C"),
    ('Wallet users can read their own chat cursors'::text collate "C", 'SELECT'::text collate "C"),
    ('Wallet users can update their own chat cursors'::text collate "C", 'UPDATE'::text collate "C")
  $$,
  'Cursor RLS exposes exactly owner-bound CRUD policies'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join pg_roles r
    where n.nspname = 'public'
      and r.rolname in ('anon', 'authenticated')
      and p.proname in (
        'claim_app_help_request', 'claim_chat_image_cleanup_batch', 'claim_chat_image_work',
        'claim_trade_agent_payment', 'claim_trade_agent_request',
        'finish_chat_image_cleanup_run', 'reject_legacy_chat_image_confirmation',
        'enforce_chat_read_cursor_monotonic_update'
      )
      and has_function_privilege(r.oid, p.oid, 'EXECUTE')
  $$,
  $$ values (0::bigint) $$,
  'Anonymous and authenticated callers cannot execute privileged or trigger functions'
);

select results_eq(
  $$
    select p.proname::text collate "C"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_app_help_request', 'claim_chat_image_cleanup_batch', 'claim_chat_image_work',
        'claim_trade_agent_payment', 'claim_trade_agent_request', 'finish_chat_image_cleanup_run'
      )
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
    order by p.proname
  $$,
  $$ values
    ('claim_app_help_request'::text collate "C"),
    ('claim_chat_image_cleanup_batch'::text collate "C"),
    ('claim_chat_image_work'::text collate "C"),
    ('claim_trade_agent_payment'::text collate "C"),
    ('claim_trade_agent_request'::text collate "C"),
    ('finish_chat_image_cleanup_run'::text collate "C")
  $$,
  'Service role can execute only the intended admission and cleanup API functions'
);

select results_eq(
  $$
    select p.proname::text collate "C"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_chat_image_cleanup_batch', 'claim_chat_image_work',
        'finish_chat_image_cleanup_run'
      )
      and p.prosecdef
    order by p.proname
  $$,
  $$ values
    ('claim_chat_image_cleanup_batch'::text collate "C"),
    ('claim_chat_image_work'::text collate "C"),
    ('finish_chat_image_cleanup_run'::text collate "C")
  $$,
  'Only image internals that require inaccessible tables use SECURITY DEFINER'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_app_help_request', 'claim_trade_agent_payment', 'claim_trade_agent_request',
        'enforce_chat_read_cursor_monotonic_update', 'reject_legacy_chat_image_confirmation'
      )
      and p.prosecdef
  $$,
  $$ values (0::bigint) $$,
  'All other application functions remain invoker-context functions'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_chat_image_cleanup_batch', 'claim_chat_image_work',
        'finish_chat_image_cleanup_run'
      )
      and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
  $$,
  $$ values (3::bigint) $$,
  'Every SECURITY DEFINER function pins an empty search path'
);

select results_eq(
  $$
    select p.proname::text collate "C",
           (select setting from unnest(p.proconfig) setting where setting like 'statement_timeout=%')::text collate "C"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_chat_image_cleanup_batch', 'claim_chat_image_work',
        'finish_chat_image_cleanup_run'
      )
    order by p.proname
  $$,
  $$ values
    ('claim_chat_image_cleanup_batch'::text collate "C", 'statement_timeout=5s'::text collate "C"),
    ('claim_chat_image_work'::text collate "C", 'statement_timeout=2s'::text collate "C"),
    ('finish_chat_image_cleanup_run'::text collate "C", 'statement_timeout=2s'::text collate "C")
  $$,
  'Privileged image functions have bounded statement timeouts'
);

select results_eq(
  $$
    select public::boolean, file_size_limit::bigint
    from storage.buckets
    where id = 'chat-images'
  $$,
  $$ values (true, 8454144::bigint) $$,
  'Encrypted chat-image bucket is public-read and capped at 8 MiB plaintext plus 64 KiB encryption overhead'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (qual ilike '%chat-images%' or with_check ilike '%chat-images%')
  $$,
  $$ values (0::bigint) $$,
  'No direct Storage policy can upload into the encrypted image bucket'
);

select results_eq(
  $$ select jobname::text collate "C", schedule::text collate "C" from cron.job order by jobname $$,
  $$ values
    ('chat-image-cleanup-every-15-min'::text collate "C", '*/15 * * * *'::text collate "C"),
    ('trade-agent-rate-limit-retention-daily'::text collate "C", '31 3 * * *'::text collate "C"),
    ('trade-agent-response-expiry-hourly'::text collate "C", '17 * * * *'::text collate "C")
  $$,
  'Only the three reviewed bounded maintenance jobs are scheduled'
);

select results_eq(
  $$
    select count(*)::bigint
    from cron.job
    where jobname = 'chat-image-cleanup-every-15-min'
      and command like '%vault.decrypted_secrets%'
      and command like '%chat_image_cleanup_secret%'
      and command not like '%CHAT_IMAGE_CLEANUP_SECRET=%'
  $$,
  $$ values (1::bigint) $$,
  'Cleanup cron resolves its secret from Vault instead of embedding it'
);

select * from finish();
rollback;
