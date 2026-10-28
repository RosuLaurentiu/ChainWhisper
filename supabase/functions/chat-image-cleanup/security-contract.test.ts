const migrationUrl = new URL(
  '../../migrations/20260809113000_secure_chat_image_work.sql',
  import.meta.url
);
const readmeUrl = new URL('../../../README.md', import.meta.url);

const migration = await Deno.readTextFile(migrationUrl);
const readme = await Deno.readTextFile(readmeUrl);

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test('migration exposes the stable binding and admission contract', () => {
  for (const column of [
    'authorization_version smallint',
    'conversation_target text',
    'ciphertext_sha256 char(64)',
    'confirmation_token_hash char(64)',
    'authorization_issued_at timestamptz',
    'authorization_expires_at timestamptz'
  ]) {
    assert(migration.includes(column), `Missing binding column: ${column}`);
  }
  assert(migration.includes('create or replace function public.claim_chat_image_work('));
  assert(migration.includes('p_client_hash text'));
  assert(migration.includes('p_wallet_address text default null'));
  assert(migration.includes("p_kind not in ('upload', 'confirm')"));
  assert(migration.includes("pg_catalog.pg_advisory_xact_lock("));
  assert(migration.includes("grant execute on function public.claim_chat_image_work"));
  assert(migration.includes('to service_role;'));
  assert(migration.includes('from public, anon, authenticated;'));
  assert(migration.includes('set authorization_version = 0'));
  assert(migration.includes('alter column authorization_version set default 1'));
  assert(migration.includes('create trigger reject_legacy_chat_image_confirmation'));
  assert(migration.includes('and confirmation_token_hash is not null'));
});

Deno.test('migration keeps cleanup claims single-flight and bounded', () => {
  assert(migration.includes('create or replace function public.claim_chat_image_cleanup_batch('));
  assert(migration.includes('p_limit integer default 500'));
  assert(migration.includes('if p_limit is null or p_limit < 1 or p_limit > 500'));
  assert(migration.includes('where public.chat_image_cleanup_state.locked_until <= v_now'));
  assert(migration.includes('with pending_candidates as ('));
  assert(migration.includes('), confirmed_candidates as ('));
  assert(!migration.includes('storage_candidates as ('));
  assert(!migration.includes('on storage.objects (created_at, name)'));
  assert((migration.match(/\blimit p_limit\b/g) ?? []).length === 3);
  assert(migration.includes('create or replace function public.finish_chat_image_cleanup_run('));
});

Deno.test('scheduler authenticates from Vault without embedding the cleanup secret', () => {
  assert(migration.includes("'x-chat-image-cleanup-secret'"));
  assert(migration.includes('from vault.decrypted_secrets'));
  assert(migration.includes("where name = 'chat_image_cleanup_secret'"));
  assert(migration.includes('timeout_milliseconds := 120000'));
  assert(!migration.includes('CHAT_IMAGE_CLEANUP_SECRET='));
});

Deno.test('README requires the complete hardened image deployment sequence', () => {
  assert(readme.includes('CHAT_IMAGE_RATE_LIMIT_SECRET'));
  assert(readme.includes('CHAT_IMAGE_CLEANUP_SECRET'));
  assert(readme.includes('20260809113000_secure_chat_image_work.sql'));
  assert(readme.includes('Do not deploy only the original storage migration'));
  assert(readme.includes('Do not apply the hardening migration first while the original unauthenticated cleanup function remains deployed'));
  assert(readme.includes('chat_image_cleanup_secret'));
  const imageSection = readme.slice(readme.indexOf('## Supabase Image Storage'));
  const edgeIndex = imageSection.indexOf('Deploy all four hardened Edge functions');
  const migrationIndex = imageSection.indexOf('Apply all image migrations in chronological order');
  const frontendIndex = imageSection.indexOf('Deploy the matching frontend');
  assert(edgeIndex >= 0 && edgeIndex < migrationIndex && migrationIndex < frontendIndex);
});
