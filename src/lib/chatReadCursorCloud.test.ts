import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  authorizeChatReadCursorCloudSession,
  type ChatReadCursorCloudSession
} from './chatReadCursorCloudAuth';
import {
  deleteChatReadCursorCloudWallet,
  parseChatReadCursorCloudRow,
  reconcileDirectChatReadCursorCloud,
  reconcileGroupChatReadCursorCloud,
  resetDirectChatReadCursorCloud,
  type ChatReadCursorCloudBackend,
  type ChatReadCursorCloudRow
} from './chatReadCursorCloud';
import { createDirectChatV2ReadCursor } from './directChatV2ReadCursor';
import { createGroupChatV2ReadCursor } from './groupChatV2ReadCursor';
import {
  createCloudSyncedDirectChatV2ReadCursorStore,
  createCloudSyncedGroupChatV2ReadCursorStore
} from './chatReadCursorCloudStores';
import { createDirectChatV2ReadCursorStore } from './directChatV2ReadCursorStore';
import { createGroupChatV2ReadCursorStore } from './groupChatV2ReadCursorStore';
import migration from '../../supabase/migrations/20260813145601_chat_read_cursor_sync.sql?raw';
import supabaseConfig from '../../supabase/config.toml?raw';

const OWNER = '0x1000000000000000000000000000000000000001';
const CONTRACT = '0x2000000000000000000000000000000000000002';
const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION = `0x${'11'.repeat(32)}`;
const BLOCK_HASH_1 = `0x${'aa'.repeat(32)}`;
const BLOCK_HASH_2 = `0x${'bb'.repeat(32)}`;

const user = {
  id: USER_ID,
  app_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-13T00:00:00.000Z',
  identities: [{
    id: OWNER,
    identity_id: 'identity-owner',
    user_id: USER_ID,
    provider: 'web3',
    identity_data: { address: OWNER }
  }],
  user_metadata: {}
} as User;

const session = async (): Promise<ChatReadCursorCloudSession> => {
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(),
      signInWithWeb3: vi.fn(async () => ({
        data: { session: { access_token: 'token' }, user },
        error: null
      })),
      signOut: vi.fn()
    }
  } as unknown as SupabaseClient;
  return authorizeChatReadCursorCloudSession({
    assertCurrent: vi.fn(),
    client,
    ownerAddress: OWNER,
    wallet: { request: vi.fn() }
  });
};

const memoryBackend = (initial: ChatReadCursorCloudRow | null = null) => {
  let stored = initial;
  const writes: ChatReadCursorCloudRow[] = [];
  const deleted: Array<[string, string]> = [];
  const backend: ChatReadCursorCloudBackend = {
    read: vi.fn(async () => stored),
    upsert: vi.fn(async (row) => {
      stored = parseChatReadCursorCloudRow(row);
      writes.push(stored);
      return stored;
    }),
    deleteWallet: vi.fn(async (userId, walletAddress) => {
      deleted.push([userId, walletAddress]);
      stored = null;
    })
  };
  return { backend, deleted, get stored() { return stored; }, writes };
};

const directScope = {
  chainId: 7_082_400n,
  contractAddress: CONTRACT,
  walletAddress: OWNER,
  conversationId: CONVERSATION
};

const groupScope = {
  chainId: 7_082_400n,
  contractAddress: CONTRACT,
  walletAddress: OWNER,
  groupId: 9n
};

describe('chatReadCursorCloud', () => {
  it('merges a local Direct cursor canonically and uploads only finalized identity', async () => {
    const auth = await session();
    const memory = memoryBackend();
    const local = createDirectChatV2ReadCursor(directScope, {
      messageId: 2n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH_1
    });
    const merged = await reconcileDirectChatReadCursorCloud({
      backend: memory.backend,
      canonicalMessageCount: 2n,
      localCursor: local,
      readCanonicalMessageAnchor: async (messageId) => messageId === 2n
        ? { messageId, blockNumber: 100n, blockHash: BLOCK_HASH_1 }
        : null,
      scope: directScope,
      session: auth
    });

    expect(merged.lastReadMessageId).toBe('2');
    expect(memory.stored).toMatchObject({
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      last_read_message_id: '2',
      last_read_block_number: '100',
      last_read_block_hash: BLOCK_HASH_1
    });
    expect(JSON.stringify(memory.stored)).not.toMatch(/message_text|ciphertext|plaintext|epoch_seed|conversation_key/i);
  });

  it('accepts a higher remote Direct cursor only after canonical anchor validation', async () => {
    const auth = await session();
    const remote = parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      generation: 0,
      last_read_message_id: '3',
      last_read_block_number: '101',
      last_read_block_hash: BLOCK_HASH_2
    });
    const memory = memoryBackend(remote);
    const merged = await reconcileDirectChatReadCursorCloud({
      backend: memory.backend,
      canonicalMessageCount: 3n,
      localCursor: createDirectChatV2ReadCursor(directScope),
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 101n,
        blockHash: BLOCK_HASH_2
      }),
      scope: directScope,
      session: auth
    });
    expect(merged.lastReadMessageId).toBe('3');
    expect(memory.writes).toHaveLength(0);
  });

  it('keeps a newer empty Direct reorg generation from being repopulated by a stale device', async () => {
    const auth = await session();
    const remote = parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      generation: 2,
      last_read_message_id: '0',
      last_read_block_number: null,
      last_read_block_hash: null
    });
    const memory = memoryBackend(remote);
    const stale = createDirectChatV2ReadCursor(directScope, 1, {
      messageId: 3n,
      blockNumber: 101n,
      blockHash: BLOCK_HASH_2
    });
    const reset = await reconcileDirectChatReadCursorCloud({
      backend: memory.backend,
      canonicalMessageCount: 3n,
      localCursor: stale,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 101n,
        blockHash: BLOCK_HASH_2
      }),
      scope: directScope,
      session: auth
    });

    expect(reset).toMatchObject({ generation: 2, lastReadMessageId: '0' });
    expect(memory.writes).toHaveLength(0);

    const acknowledged = createDirectChatV2ReadCursor(directScope, 2, {
      messageId: 3n,
      blockNumber: 101n,
      blockHash: BLOCK_HASH_2
    });
    const advanced = await reconcileDirectChatReadCursorCloud({
      backend: memory.backend,
      canonicalMessageCount: 3n,
      localCursor: acknowledged,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 101n,
        blockHash: BLOCK_HASH_2
      }),
      scope: directScope,
      session: auth
    });
    expect(advanced).toMatchObject({ generation: 2, lastReadMessageId: '3' });
    expect(memory.stored).toMatchObject({ generation: 2, last_read_message_id: '3' });
  });

  it('persists an empty Direct generation boundary before a newer local cursor', async () => {
    const auth = await session();
    const remote = parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      generation: 1,
      last_read_message_id: '1',
      last_read_block_number: '90',
      last_read_block_hash: BLOCK_HASH_1
    });
    const memory = memoryBackend(remote);
    const local = createDirectChatV2ReadCursor(directScope, 3, {
      messageId: 2n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH_2
    });
    await reconcileDirectChatReadCursorCloud({
      backend: memory.backend,
      canonicalMessageCount: 2n,
      localCursor: local,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: messageId === 2n ? 100n : 90n,
        blockHash: messageId === 2n ? BLOCK_HASH_2 : BLOCK_HASH_1
      }),
      scope: directScope,
      session: auth
    });

    expect(memory.writes.map((row) => [row.generation, row.last_read_message_id])).toEqual([
      [3, '0'],
      [3, '2']
    ]);
  });

  it('persists an empty Group generation boundary before an offline advanced cursor', async () => {
    const auth = await session();
    const remote = parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'group-v2',
      thread_id: '9',
      generation: 1,
      last_read_message_id: '1',
      last_read_block_number: '90',
      last_read_block_hash: BLOCK_HASH_1
    });
    const memory = memoryBackend(remote);
    const local = createGroupChatV2ReadCursor(groupScope, 3, {
      messageId: 2n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH_2
    });
    const merged = await reconcileGroupChatReadCursorCloud({
      backend: memory.backend,
      getCanonicalMessageCount: async () => 2n,
      localCursor: local,
      readCanonicalAnchor: async (messageId, blockNumber) => ({
        messageId,
        blockNumber,
        blockHash: messageId === 2n ? BLOCK_HASH_2 : BLOCK_HASH_1
      }),
      scope: groupScope,
      session: auth
    });
    expect(merged.generation).toBe(3);
    expect(memory.writes.map((row) => [row.generation, row.last_read_message_id])).toEqual([
      [3, '0'],
      [3, '2']
    ]);
  });

  it('resets Direct cloud state with a higher empty generation and can delete only the bound wallet', async () => {
    const auth = await session();
    const memory = memoryBackend(parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      generation: 4,
      last_read_message_id: '3',
      last_read_block_number: '101',
      last_read_block_hash: BLOCK_HASH_2
    }));
    await resetDirectChatReadCursorCloud({ backend: memory.backend, scope: directScope, session: auth });
    expect(memory.stored).toMatchObject({ generation: 5, last_read_message_id: '0' });
    await deleteChatReadCursorCloudWallet({ backend: memory.backend, session: auth });
    expect(memory.deleted).toEqual([[USER_ID, OWNER.toLowerCase()]]);
  });

  it('rejects malformed anchors and another authenticated scope', () => {
    expect(() => parseChatReadCursorCloudRow({
      user_id: USER_ID,
      wallet_address: OWNER.toLowerCase(),
      chain_id: '7082400',
      contract_address: CONTRACT.toLowerCase(),
      thread_kind: 'direct-v2',
      thread_id: CONVERSATION,
      generation: 0,
      last_read_message_id: '1',
      last_read_block_number: '100',
      last_read_block_hash: `0x${'00'.repeat(32)}`
    })).toThrow(/non-zero bytes32/i);
  });

  it('locks the SQL surface to authenticated owner rows and monotonic resets', () => {
    expect(migration).toContain('alter table public.chat_read_cursors enable row level security;');
    expect(migration).toContain('alter table public.chat_read_cursors force row level security;');
    expect(migration).toContain('revoke all on table public.chat_read_cursors from anon, authenticated;');
    expect(migration).toContain('grant select, insert, update, delete on table public.chat_read_cursors to authenticated;');
    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/g)).toHaveLength(5);
    expect(migration).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\);/u);
    expect(migration).toContain('create trigger enforce_chat_read_cursor_monotonic_update');
    expect(migration).toContain("new.last_read_message_id::numeric < old.last_read_message_id::numeric");
    expect(migration).toContain("new.last_read_message_id <> '0'");
    expect(migration).not.toMatch(/\b(message_text|ciphertext_bytes|conversation_key|epoch_key|private_key)\b/i);
    expect(supabaseConfig).toMatch(/\[auth\.web3\.ethereum\]\s+enabled = true/u);
  });

  it('converges a remote Direct cursor into the canonical local store', async () => {
    const cloudCursor = createDirectChatV2ReadCursor(directScope, {
      messageId: 2n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH_1
    });
    const local = createDirectChatV2ReadCursorStore({
      storage: null,
      broadcastFactory: null,
      runExclusive: null,
      sourceId: 'cloud-direct-test'
    });
    const store = createCloudSyncedDirectChatV2ReadCursorStore({
      local,
      session: {} as ChatReadCursorCloudSession,
      reconcileCloud: vi.fn(async () => cloudCursor)
    });
    const cursor = await store.loadCanonical({
      scope: directScope,
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n,
        blockHash: BLOCK_HASH_1
      })
    });
    expect(cursor.lastReadMessageId).toBe('2');
    store.close();
  });

  it('keeps local unread state available when Supabase is offline', async () => {
    const errors: unknown[] = [];
    const local = createDirectChatV2ReadCursorStore({
      storage: null,
      broadcastFactory: null,
      runExclusive: null,
      sourceId: 'cloud-offline-test'
    });
    const store = createCloudSyncedDirectChatV2ReadCursorStore({
      local,
      onCloudError: (error) => errors.push(error),
      session: {} as ChatReadCursorCloudSession,
      reconcileCloud: vi.fn(async () => { throw new Error('offline'); })
    });
    const cursor = await store.loadCanonical({
      scope: directScope,
      canonicalMessageCount: 0n,
      readCanonicalMessageAnchor: async () => null
    });
    expect(cursor.lastReadMessageId).toBe('0');
    expect(errors).toHaveLength(1);
    store.close();
  });

  it('converges a remote Group generation into the canonical local store', async () => {
    const cloudCursor = createGroupChatV2ReadCursor(groupScope, 2, {
      messageId: 2n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH_2
    });
    const local = createGroupChatV2ReadCursorStore({
      storage: undefined,
      broadcastFactory: undefined,
      runExclusive: undefined,
      instanceId: 'cloud-group-test'
    });
    const store = createCloudSyncedGroupChatV2ReadCursorStore({
      local,
      session: {} as ChatReadCursorCloudSession,
      reconcileCloud: vi.fn(async () => cloudCursor)
    });
    const cursor = await store.loadCanonical(groupScope, {
      getCanonicalMessageCount: async () => 2n,
      readCanonicalAnchor: async (messageId, blockNumber) => ({
        messageId,
        blockNumber,
        blockHash: BLOCK_HASH_2
      })
    });
    expect(cursor.generation).toBe(2);
    expect(cursor.lastReadMessageId).toBe('2');
    store.close();
  });
});
