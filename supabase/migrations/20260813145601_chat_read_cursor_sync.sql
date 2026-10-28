create table public.chat_read_cursors (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wallet_address text not null,
  chain_id text not null,
  contract_address text not null,
  thread_kind text not null,
  thread_id text not null,
  generation bigint not null default 0,
  last_read_message_id text not null default '0',
  last_read_block_number text,
  last_read_block_hash text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint chat_read_cursors_pkey primary key (
    user_id,
    wallet_address,
    chain_id,
    contract_address,
    thread_kind,
    thread_id
  ),
  constraint chat_read_cursors_wallet_address_check check (
    wallet_address ~ '^0x[0-9a-f]{40}$'
  ),
  constraint chat_read_cursors_chain_id_check check (
    chain_id ~ '^[1-9][0-9]*$' and
    length(chain_id) <= 78 and
    chain_id::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
  ),
  constraint chat_read_cursors_contract_address_check check (
    contract_address ~ '^0x[0-9a-f]{40}$'
  ),
  constraint chat_read_cursors_thread_kind_check check (
    thread_kind in ('direct-v2', 'group-v2')
  ),
  constraint chat_read_cursors_thread_id_check check (
    case thread_kind
      when 'direct-v2' then thread_id ~ '^0x[0-9a-f]{64}$'
      when 'group-v2' then
        thread_id ~ '^[1-9][0-9]*$' and
        length(thread_id) <= 78 and
        thread_id::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
      else false
    end
  ),
  constraint chat_read_cursors_generation_check check (
    generation >= 0 and generation <= 9007199254740991
  ),
  constraint chat_read_cursors_message_id_check check (
    last_read_message_id ~ '^(0|[1-9][0-9]*)$' and
    length(last_read_message_id) <= 20 and
    last_read_message_id::numeric <= 18446744073709551615
  ),
  constraint chat_read_cursors_block_number_check check (
    last_read_block_number is null or (
      last_read_block_number ~ '^(0|[1-9][0-9]*)$' and
      length(last_read_block_number) <= 78 and
      last_read_block_number::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    )
  ),
  constraint chat_read_cursors_anchor_check check (
    (
      last_read_message_id = '0' and
      last_read_block_number is null and
      last_read_block_hash is null
    ) or (
      last_read_message_id <> '0' and
      last_read_block_number is not null and
      last_read_block_hash ~ '^0x[0-9a-f]{64}$' and
      last_read_block_hash <> ('0x' || repeat('0', 64))
    )
  )
);

comment on table public.chat_read_cursors is
  'Optional owner-authenticated finalized Direct/Group V2 read cursors. Never stores messages, ciphertext, contacts, keys, or private trading data.';
comment on column public.chat_read_cursors.generation is
  'Monotonic reorg/reset generation. A newer generation must begin with an empty cursor.';

create or replace function public.enforce_chat_read_cursor_monotonic_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if
    new.user_id is distinct from old.user_id or
    new.wallet_address is distinct from old.wallet_address or
    new.chain_id is distinct from old.chain_id or
    new.contract_address is distinct from old.contract_address or
    new.thread_kind is distinct from old.thread_kind or
    new.thread_id is distinct from old.thread_id
  then
    raise exception using
      errcode = '23514',
      message = 'Chat read-cursor scope is immutable.';
  end if;

  if new.generation < old.generation then
    raise exception using
      errcode = '23514',
      message = 'Chat read-cursor generation cannot move backward.';
  elsif new.generation = old.generation then
    if new.last_read_message_id::numeric < old.last_read_message_id::numeric then
      raise exception using
        errcode = '23514',
        message = 'Chat read cursor cannot move backward within a generation.';
    end if;
    if
      new.last_read_message_id::numeric = old.last_read_message_id::numeric and
      (
        new.last_read_block_number is distinct from old.last_read_block_number or
        new.last_read_block_hash is distinct from old.last_read_block_hash
      )
    then
      raise exception using
        errcode = '23514',
        message = 'Chat read-cursor anchor cannot change within a generation.';
    end if;
  elsif
    new.last_read_message_id <> '0' or
    new.last_read_block_number is not null or
    new.last_read_block_hash is not null
  then
    raise exception using
      errcode = '23514',
      message = 'A newer chat read-cursor generation must begin empty.';
  end if;

  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke execute on function public.enforce_chat_read_cursor_monotonic_update() from public, anon, authenticated;

create trigger enforce_chat_read_cursor_monotonic_update
before update on public.chat_read_cursors
for each row execute function public.enforce_chat_read_cursor_monotonic_update();

alter table public.chat_read_cursors enable row level security;
alter table public.chat_read_cursors force row level security;

revoke all on table public.chat_read_cursors from anon, authenticated;
grant select, insert, update, delete on table public.chat_read_cursors to authenticated;

create policy "Wallet users can read their own chat cursors"
on public.chat_read_cursors
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Wallet users can create their own chat cursors"
on public.chat_read_cursors
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Wallet users can update their own chat cursors"
on public.chat_read_cursors
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Wallet users can delete their own chat cursors"
on public.chat_read_cursors
for delete
to authenticated
using ((select auth.uid()) = user_id);
