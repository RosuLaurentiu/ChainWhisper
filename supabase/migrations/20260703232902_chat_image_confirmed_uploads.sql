create table if not exists public.chat_image_uploads (
  blob_id text primary key
    check (blob_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  owner_address text not null
    check (owner_address ~* '^0x[0-9a-f]{40}$'),
  conversation_kind text not null
    check (conversation_kind in ('direct', 'group')),
  mime text not null
    check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  plaintext_size integer not null
    check (plaintext_size > 0 and plaintext_size <= 8388608),
  encrypted_size integer not null
    check (encrypted_size > 0 and encrypted_size <= 8454144),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_tx_hash text
    check (confirmed_tx_hash is null or confirmed_tx_hash ~* '^0x[0-9a-f]{64}$')
);

alter table public.chat_image_uploads enable row level security;

revoke all on public.chat_image_uploads from anon, authenticated;
grant select, insert, update, delete on public.chat_image_uploads to service_role;

create unique index if not exists chat_image_uploads_confirmed_tx_hash_key
on public.chat_image_uploads (lower(confirmed_tx_hash))
where confirmed_tx_hash is not null;

drop policy if exists "Allow public chat image uploads" on storage.objects;
