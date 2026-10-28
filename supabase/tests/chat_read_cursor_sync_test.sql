begin;

select plan(16);

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.chat_read_cursors (
      wallet_address,
      chain_id,
      contract_address,
      thread_kind,
      thread_id
    ) values (
      '0x1111111111111111111111111111111111111111',
      '7082400',
      '0x3333333333333333333333333333333333333333',
      'direct-v2',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  'Alice can insert her own empty Direct cursor using the auth.uid() default'
);

select results_eq(
  $$
    select user_id
    from public.chat_read_cursors
  $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'The inserted cursor is bound to the authenticated user ID'
);

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;

select results_eq(
  $$ select count(*)::bigint from public.chat_read_cursors $$,
  $$ values (0::bigint) $$,
  'Bob cannot read Alice cursor rows'
);

select throws_ok(
  $$
    insert into public.chat_read_cursors (
      user_id,
      wallet_address,
      chain_id,
      contract_address,
      thread_kind,
      thread_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '0x1111111111111111111111111111111111111111',
      '7082400',
      '0x3333333333333333333333333333333333333333',
      'direct-v2',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "chat_read_cursors"',
  'Bob cannot create a cursor owned by Alice'
);

select results_eq(
  $$
    with changed as (
      update public.chat_read_cursors
      set last_read_message_id = '1',
          last_read_block_number = '50',
          last_read_block_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      returning 1
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'Bob cannot update Alice cursor rows'
);

select results_eq(
  $$
    with removed as (
      delete from public.chat_read_cursors
      returning 1
    )
    select count(*)::bigint from removed
  $$,
  $$ values (0::bigint) $$,
  'Bob cannot delete Alice cursor rows'
);

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

select lives_ok(
  $$
    update public.chat_read_cursors
    set last_read_message_id = '5',
        last_read_block_number = '100',
        last_read_block_hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $$,
  'Alice can advance within the current generation'
);

select throws_ok(
  $$
    update public.chat_read_cursors
    set last_read_message_id = '4',
        last_read_block_number = '99',
        last_read_block_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  $$,
  '23514',
  'Chat read cursor cannot move backward within a generation.',
  'An offline device cannot move the cursor backward'
);

select throws_ok(
  $$
    update public.chat_read_cursors
    set last_read_block_number = '101',
        last_read_block_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  $$,
  '23514',
  'Chat read-cursor anchor cannot change within a generation.',
  'The canonical anchor for one message ID is immutable'
);

select throws_ok(
  $$
    update public.chat_read_cursors
    set generation = 1,
        last_read_message_id = '6',
        last_read_block_number = '110',
        last_read_block_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  $$,
  '23514',
  'A newer chat read-cursor generation must begin empty.',
  'A reorg generation cannot skip its empty reset boundary'
);

select lives_ok(
  $$
    update public.chat_read_cursors
    set generation = 1,
        last_read_message_id = '0',
        last_read_block_number = null,
        last_read_block_hash = null
  $$,
  'A newer reorg generation can begin at an empty cursor'
);

select throws_ok(
  $$
    update public.chat_read_cursors
    set generation = 0
  $$,
  '23514',
  'Chat read-cursor generation cannot move backward.',
  'A stale device cannot restore an older generation'
);

select results_eq(
  $$
    select generation, last_read_message_id, last_read_block_number, last_read_block_hash
    from public.chat_read_cursors
  $$,
  $$ values (1::bigint, '0'::text, null::text, null::text) $$,
  'The accepted reorg boundary remains empty and canonical'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$ select count(*)::bigint from public.chat_read_cursors $$,
  '42501',
  'permission denied for table chat_read_cursors',
  'Anonymous clients have no table privilege to read cursor rows'
);

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

select lives_ok(
  $$ delete from public.chat_read_cursors $$,
  'Alice can delete her own synced read status'
);

select results_eq(
  $$ select count(*)::bigint from public.chat_read_cursors $$,
  $$ values (0::bigint) $$,
  'Alice cursor rows are gone after opt-out deletion'
);

select * from finish();
rollback;
