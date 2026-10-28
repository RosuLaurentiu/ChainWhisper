import { getAddress } from '@coti-io/coti-ethers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createDirectChatV2ReadCursor,
  mergeDirectChatV2ReadCursors,
  parseDirectChatV2ReadCursor,
  type DirectChatV2ReadCursor,
  type DirectChatV2ReadCursorScope
} from './directChatV2ReadCursor';
import type { DirectChatV2ReadCursorCanonicalContext } from './directChatV2ReadCursorStore';
import {
  createGroupChatV2ReadCursor,
  mergeGroupChatV2ReadCursors,
  parseGroupChatV2ReadCursor,
  type GroupChatV2ReadCursor,
  type GroupChatV2ReadCursorAnchor,
  type GroupChatV2ReadCursorScope
} from './groupChatV2ReadCursor';
import {
  resolveChatReadCursorCloudSession,
  type ChatReadCursorCloudSession
} from './chatReadCursorCloudAuth';

export const CHAT_READ_CURSOR_CLOUD_TABLE = 'chat_read_cursors' as const;
const COLUMNS = [
  'user_id',
  'wallet_address',
  'chain_id',
  'contract_address',
  'thread_kind',
  'thread_id',
  'generation',
  'last_read_message_id',
  'last_read_block_number',
  'last_read_block_hash'
].join(',');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export type ChatReadCursorCloudRow = Readonly<{
  user_id: string;
  wallet_address: string;
  chain_id: string;
  contract_address: string;
  thread_kind: 'direct-v2' | 'group-v2';
  thread_id: string;
  generation: number;
  last_read_message_id: string;
  last_read_block_number: string | null;
  last_read_block_hash: string | null;
}>;

export type ChatReadCursorCloudScope = Readonly<{
  userId: string;
  walletAddress: string;
  chainId: string;
  contractAddress: string;
  threadKind: ChatReadCursorCloudRow['thread_kind'];
  threadId: string;
}>;

export type ChatReadCursorCloudBackend = Readonly<{
  deleteWallet: (userId: string, walletAddress: string) => Promise<void>;
  read: (scope: ChatReadCursorCloudScope) => Promise<unknown | null>;
  upsert: (row: ChatReadCursorCloudRow) => Promise<unknown>;
}>;

const integer = (value: unknown, label: string, maximum: bigint): bigint => {
  const selected = typeof value === 'string' ? value.trim() : '';
  if (!DECIMAL.test(selected)) throw new Error(`${label} must be a canonical decimal string.`);
  const parsed = BigInt(selected);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const hash = (value: unknown, label: string): string => {
  const selected = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!BYTES32.test(selected) || selected === `0x${'0'.repeat(64)}`) {
    throw new Error(`${label} must be a non-zero bytes32 value.`);
  }
  return selected;
};

const normalizeScope = (scope: ChatReadCursorCloudScope): ChatReadCursorCloudScope => {
  const userId = scope.userId.trim().toLowerCase();
  if (!UUID.test(userId)) throw new Error('Cloud read-cursor user ID is malformed.');
  const chainId = integer(scope.chainId, 'Cloud read-cursor chain ID', UINT256_MAX);
  if (chainId === 0n) throw new Error('Cloud read-cursor chain ID must be non-zero.');
  const threadId = scope.threadId.trim().toLowerCase();
  if (
    (scope.threadKind === 'direct-v2' && !BYTES32.test(threadId)) ||
    (scope.threadKind === 'group-v2' && integer(threadId, 'Cloud group ID', UINT256_MAX) === 0n)
  ) {
    throw new Error('Cloud read-cursor thread ID is invalid.');
  }
  return Object.freeze({
    userId,
    walletAddress: getAddress(scope.walletAddress.trim()).toLowerCase(),
    chainId: chainId.toString(),
    contractAddress: getAddress(scope.contractAddress.trim()).toLowerCase(),
    threadKind: scope.threadKind,
    threadId
  });
};

export const parseChatReadCursorCloudRow = (
  value: unknown,
  expectedScope?: ChatReadCursorCloudScope
): ChatReadCursorCloudRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cloud read cursor must be an object.');
  }
  const record = value as Record<string, unknown>;
  const threadKind = record.thread_kind;
  if (threadKind !== 'direct-v2' && threadKind !== 'group-v2') {
    throw new Error('Cloud read-cursor thread kind is unsupported.');
  }
  const selectedScope = normalizeScope({
    userId: String(record.user_id ?? ''),
    walletAddress: String(record.wallet_address ?? ''),
    chainId: String(record.chain_id ?? ''),
    contractAddress: String(record.contract_address ?? ''),
    threadKind,
    threadId: String(record.thread_id ?? '')
  });
  if (expectedScope) {
    const expected = normalizeScope(expectedScope);
    if (JSON.stringify(selectedScope) !== JSON.stringify(expected)) {
      throw new Error('Cloud read cursor belongs to another authenticated scope.');
    }
  }
  const generation = Number(record.generation);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Cloud read-cursor generation is invalid.');
  }
  const messageId = integer(record.last_read_message_id, 'Cloud last-read message ID', UINT64_MAX);
  let blockNumber: string | null = null;
  let blockHash: string | null = null;
  if (messageId === 0n) {
    if (record.last_read_block_number !== null || record.last_read_block_hash !== null) {
      throw new Error('An empty cloud read cursor cannot have a block anchor.');
    }
  } else {
    blockNumber = integer(
      record.last_read_block_number,
      'Cloud last-read block number',
      UINT256_MAX
    ).toString();
    blockHash = hash(record.last_read_block_hash, 'Cloud last-read block hash');
  }
  return Object.freeze({
    user_id: selectedScope.userId,
    wallet_address: selectedScope.walletAddress,
    chain_id: selectedScope.chainId,
    contract_address: selectedScope.contractAddress,
    thread_kind: selectedScope.threadKind,
    thread_id: selectedScope.threadId,
    generation,
    last_read_message_id: messageId.toString(),
    last_read_block_number: blockNumber,
    last_read_block_hash: blockHash
  });
};

const scopeFilters = (query: any, scope: ChatReadCursorCloudScope): any => query
  .eq('user_id', scope.userId)
  .eq('wallet_address', scope.walletAddress)
  .eq('chain_id', scope.chainId)
  .eq('contract_address', scope.contractAddress)
  .eq('thread_kind', scope.threadKind)
  .eq('thread_id', scope.threadId);

export const createSupabaseChatReadCursorCloudBackend = (
  client: SupabaseClient
): ChatReadCursorCloudBackend => Object.freeze({
  read: async (rawScope) => {
    const scope = normalizeScope(rawScope);
    const { data, error } = await scopeFilters(
      client.from(CHAT_READ_CURSOR_CLOUD_TABLE).select(COLUMNS),
      scope
    ).maybeSingle();
    if (error) throw new Error('Unable to read the cross-device read cursor.');
    return data ?? null;
  },
  upsert: async (rawRow) => {
    const row = parseChatReadCursorCloudRow(rawRow);
    const { data, error } = await client
      .from(CHAT_READ_CURSOR_CLOUD_TABLE)
      .upsert(row, {
        onConflict: 'user_id,wallet_address,chain_id,contract_address,thread_kind,thread_id'
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw new Error('Unable to save the cross-device read cursor.');
    return data;
  },
  deleteWallet: async (userId, walletAddress) => {
    const selectedUser = userId.trim().toLowerCase();
    if (!UUID.test(selectedUser)) throw new Error('Cloud read-cursor user ID is malformed.');
    const selectedWallet = getAddress(walletAddress.trim()).toLowerCase();
    const { error } = await client
      .from(CHAT_READ_CURSOR_CLOUD_TABLE)
      .delete()
      .eq('user_id', selectedUser)
      .eq('wallet_address', selectedWallet);
    if (error) throw new Error('Unable to delete cross-device read cursors.');
  }
});

const scopeForDirect = (
  userId: string,
  rawScope: DirectChatV2ReadCursorScope
): ChatReadCursorCloudScope => normalizeScope({
  userId,
  walletAddress: rawScope.walletAddress,
  chainId: rawScope.chainId.toString(),
  contractAddress: rawScope.contractAddress,
  threadKind: 'direct-v2',
  threadId: rawScope.conversationId
});

const scopeForGroup = (
  userId: string,
  rawScope: GroupChatV2ReadCursorScope
): ChatReadCursorCloudScope => normalizeScope({
  userId,
  walletAddress: rawScope.walletAddress,
  chainId: rawScope.chainId.toString(),
  contractAddress: rawScope.contractAddress,
  threadKind: 'group-v2',
  threadId: rawScope.groupId.toString()
});

const rowForCursor = (
  scope: ChatReadCursorCloudScope,
  generation: number,
  cursor: Pick<
    DirectChatV2ReadCursor | GroupChatV2ReadCursor,
    'lastReadMessageId' | 'lastReadBlockNumber' | 'lastReadBlockHash'
  >
): ChatReadCursorCloudRow => parseChatReadCursorCloudRow({
  user_id: scope.userId,
  wallet_address: scope.walletAddress,
  chain_id: scope.chainId,
  contract_address: scope.contractAddress,
  thread_kind: scope.threadKind,
  thread_id: scope.threadId,
  generation,
  last_read_message_id: cursor.lastReadMessageId,
  last_read_block_number: cursor.lastReadBlockNumber,
  last_read_block_hash: cursor.lastReadBlockHash
}, scope);

const directCursorFromRow = (
  scope: DirectChatV2ReadCursorScope,
  row: ChatReadCursorCloudRow
): DirectChatV2ReadCursor => row.last_read_message_id === '0'
  ? createDirectChatV2ReadCursor(scope, row.generation)
  : createDirectChatV2ReadCursor(scope, row.generation, {
      messageId: BigInt(row.last_read_message_id),
      blockNumber: BigInt(row.last_read_block_number ?? ''),
      blockHash: row.last_read_block_hash ?? ''
    });

const groupCursorFromRow = (
  scope: GroupChatV2ReadCursorScope,
  row: ChatReadCursorCloudRow
): GroupChatV2ReadCursor => row.last_read_message_id === '0'
  ? createGroupChatV2ReadCursor(scope, row.generation)
  : createGroupChatV2ReadCursor(scope, row.generation, {
      messageId: BigInt(row.last_read_message_id),
      blockNumber: BigInt(row.last_read_block_number ?? ''),
      blockHash: row.last_read_block_hash ?? ''
    });

const sameCursor = (
  row: ChatReadCursorCloudRow | null,
  candidate: ChatReadCursorCloudRow
): boolean => row !== null && JSON.stringify(row) === JSON.stringify(candidate);

export const reconcileDirectChatReadCursorCloud = async ({
  backend,
  canonicalMessageCount,
  localCursor,
  readCanonicalMessageAnchor,
  scope,
  session
}: {
  backend?: ChatReadCursorCloudBackend;
  canonicalMessageCount: bigint;
  localCursor: DirectChatV2ReadCursor;
  readCanonicalMessageAnchor: DirectChatV2ReadCursorCanonicalContext['readCanonicalMessageAnchor'];
  scope: DirectChatV2ReadCursorScope;
  session: ChatReadCursorCloudSession;
}): Promise<DirectChatV2ReadCursor> => {
  const binding = resolveChatReadCursorCloudSession(session);
  await binding.assertCurrent();
  const selectedBackend = backend ?? createSupabaseChatReadCursorCloudBackend(binding.client);
  const cloudScope = scopeForDirect(binding.userId, scope);
  if (cloudScope.walletAddress !== binding.ownerAddress.toLowerCase()) {
    throw new Error('Direct cloud cursor is scoped to another wallet.');
  }
  const rawRemote = await selectedBackend.read(cloudScope);
  await binding.assertCurrent();
  const remote = rawRemote === null ? null : parseChatReadCursorCloudRow(rawRemote, cloudScope);
  const candidates = [parseDirectChatV2ReadCursor(localCursor, scope)];
  if (remote) candidates.push(directCursorFromRow(scope, remote));
  const merged = await mergeDirectChatV2ReadCursors({
    scope,
    cursors: candidates,
    canonicalMessageCount,
    readCanonicalMessageAnchor
  });
  await binding.assertCurrent();
  let persistedRemote = remote;
  if (remote && merged.generation > remote.generation) {
    const empty = rowForCursor(
      cloudScope,
      merged.generation,
      createDirectChatV2ReadCursor(scope, merged.generation)
    );
    parseChatReadCursorCloudRow(await selectedBackend.upsert(empty), cloudScope);
    persistedRemote = empty;
  }
  const candidate = rowForCursor(cloudScope, merged.generation, merged);
  if (!sameCursor(persistedRemote, candidate)) {
    parseChatReadCursorCloudRow(await selectedBackend.upsert(candidate), cloudScope);
    await binding.assertCurrent();
  }
  return merged;
};

export const reconcileGroupChatReadCursorCloud = async ({
  backend,
  getCanonicalMessageCount,
  localCursor,
  readCanonicalAnchor,
  scope,
  session
}: {
  backend?: ChatReadCursorCloudBackend;
  getCanonicalMessageCount: () => Promise<bigint>;
  localCursor: GroupChatV2ReadCursor;
  readCanonicalAnchor: (
    messageId: bigint,
    blockNumber: bigint
  ) => Promise<GroupChatV2ReadCursorAnchor | null>;
  scope: GroupChatV2ReadCursorScope;
  session: ChatReadCursorCloudSession;
}): Promise<GroupChatV2ReadCursor> => {
  const binding = resolveChatReadCursorCloudSession(session);
  await binding.assertCurrent();
  const selectedBackend = backend ?? createSupabaseChatReadCursorCloudBackend(binding.client);
  const cloudScope = scopeForGroup(binding.userId, scope);
  if (cloudScope.walletAddress !== binding.ownerAddress.toLowerCase()) {
    throw new Error('Group cloud cursor is scoped to another wallet.');
  }
  const rawRemote = await selectedBackend.read(cloudScope);
  const canonicalMessageCount = await getCanonicalMessageCount();
  await binding.assertCurrent();
  const remote = rawRemote === null ? null : parseChatReadCursorCloudRow(rawRemote, cloudScope);
  const cursors = [parseGroupChatV2ReadCursor(localCursor, scope)];
  if (remote) cursors.push(groupCursorFromRow(scope, remote));
  const merged = await mergeGroupChatV2ReadCursors({
    scope,
    cursors,
    canonicalMessageCount,
    readCanonicalAnchor
  });
  await binding.assertCurrent();

  // A new generation is a reset boundary. Persist the empty boundary before
  // advancing inside it so the database trigger can reject stale devices.
  let persistedRemote = remote;
  if (remote && merged.generation > remote.generation) {
    const empty = rowForCursor(
      cloudScope,
      merged.generation,
      createGroupChatV2ReadCursor(scope, merged.generation)
    );
    parseChatReadCursorCloudRow(await selectedBackend.upsert(empty), cloudScope);
    persistedRemote = empty;
  }
  const candidate = rowForCursor(cloudScope, merged.generation, merged);
  if (!sameCursor(persistedRemote, candidate)) {
    parseChatReadCursorCloudRow(await selectedBackend.upsert(candidate), cloudScope);
    await binding.assertCurrent();
  }
  return merged;
};

export const resetDirectChatReadCursorCloud = async ({
  backend,
  scope,
  session
}: {
  backend?: ChatReadCursorCloudBackend;
  scope: DirectChatV2ReadCursorScope;
  session: ChatReadCursorCloudSession;
}): Promise<void> => {
  const binding = resolveChatReadCursorCloudSession(session);
  await binding.assertCurrent();
  const selectedBackend = backend ?? createSupabaseChatReadCursorCloudBackend(binding.client);
  const cloudScope = scopeForDirect(binding.userId, scope);
  const rawRemote = await selectedBackend.read(cloudScope);
  const remote = rawRemote === null ? null : parseChatReadCursorCloudRow(rawRemote, cloudScope);
  const reset = rowForCursor(
    cloudScope,
    (remote?.generation ?? -1) + 1,
    createDirectChatV2ReadCursor(scope, (remote?.generation ?? -1) + 1)
  );
  parseChatReadCursorCloudRow(await selectedBackend.upsert(reset), cloudScope);
  await binding.assertCurrent();
};

export const deleteChatReadCursorCloudWallet = async ({
  backend,
  session
}: {
  backend?: ChatReadCursorCloudBackend;
  session: ChatReadCursorCloudSession;
}): Promise<void> => {
  const binding = resolveChatReadCursorCloudSession(session);
  await binding.assertCurrent();
  await (backend ?? createSupabaseChatReadCursorCloudBackend(binding.client))
    .deleteWallet(binding.userId, binding.ownerAddress.toLowerCase());
  await binding.assertCurrent();
};
