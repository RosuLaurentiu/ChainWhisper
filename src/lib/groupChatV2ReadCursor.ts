import { getAddress } from '@coti-io/coti-ethers';
import type { ChatMessage } from './appShared';

export const GROUP_CHAT_V2_READ_CURSOR_SCHEMA = 'chainwhisper-group-chat-v2-read-cursor-v1' as const;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export type GroupChatV2ReadCursorScope = Readonly<{
  chainId: bigint;
  contractAddress: string;
  walletAddress: string;
  groupId: bigint;
}>;

export type GroupChatV2ReadCursorAnchor = Readonly<{
  messageId: bigint;
  blockNumber: bigint;
  blockHash: string;
}>;

export type GroupChatV2ReadCursor = Readonly<{
  schema: typeof GROUP_CHAT_V2_READ_CURSOR_SCHEMA;
  chainId: string;
  contractAddress: string;
  walletAddress: string;
  groupId: string;
  generation: number;
  lastReadMessageId: string;
  lastReadBlockNumber: string | null;
  lastReadBlockHash: string | null;
}>;

const integer = (value: unknown, label: string, maximum: bigint): bigint => {
  const normalized = typeof value === 'string' ? value.trim() : String(value);
  if (!DECIMAL.test(normalized)) throw new Error(`${label} is not canonical.`);
  const parsed = BigInt(normalized);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const hash = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!BYTES32.test(normalized)) throw new Error(`${label} is not bytes32.`);
  return normalized;
};

const scope = (value: GroupChatV2ReadCursorScope): GroupChatV2ReadCursorScope => {
  const chainId = BigInt(value.chainId);
  const groupId = BigInt(value.groupId);
  if (chainId <= 0n || chainId > UINT256_MAX || groupId <= 0n || groupId > UINT256_MAX) {
    throw new Error('Group read-cursor scope is invalid.');
  }
  return Object.freeze({
    chainId,
    contractAddress: getAddress(value.contractAddress.trim()),
    walletAddress: getAddress(value.walletAddress.trim()),
    groupId
  });
};

export const createGroupChatV2ReadCursor = (
  rawScope: GroupChatV2ReadCursorScope,
  generation = 0,
  anchor?: GroupChatV2ReadCursorAnchor
): GroupChatV2ReadCursor => {
  const selected = scope(rawScope);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Group read-cursor generation is invalid.');
  }
  if (!anchor) {
    return Object.freeze({
      schema: GROUP_CHAT_V2_READ_CURSOR_SCHEMA,
      chainId: selected.chainId.toString(),
      contractAddress: selected.contractAddress,
      walletAddress: selected.walletAddress,
      groupId: selected.groupId.toString(),
      generation,
      lastReadMessageId: '0',
      lastReadBlockNumber: null,
      lastReadBlockHash: null
    });
  }
  if (
    anchor.messageId <= 0n || anchor.messageId > UINT64_MAX ||
    anchor.blockNumber < 0n || anchor.blockNumber > UINT256_MAX
  ) {
    throw new Error('Group read-cursor anchor is out of range.');
  }
  return Object.freeze({
    ...createGroupChatV2ReadCursor(selected, generation),
    lastReadMessageId: anchor.messageId.toString(),
    lastReadBlockNumber: anchor.blockNumber.toString(),
    lastReadBlockHash: hash(anchor.blockHash, 'Group read-cursor block hash')
  });
};

export const parseGroupChatV2ReadCursor = (
  value: unknown,
  expectedScope?: GroupChatV2ReadCursorScope
): GroupChatV2ReadCursor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Group read cursor must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== GROUP_CHAT_V2_READ_CURSOR_SCHEMA) {
    throw new Error('Unsupported Group Chat V2 read-cursor schema.');
  }
  const selected = scope({
    chainId: integer(record.chainId, 'Cursor chain ID', UINT256_MAX),
    contractAddress: String(record.contractAddress ?? ''),
    walletAddress: String(record.walletAddress ?? ''),
    groupId: integer(record.groupId, 'Cursor group ID', UINT256_MAX)
  });
  if (expectedScope) {
    const expected = scope(expectedScope);
    if (
      selected.chainId !== expected.chainId ||
      selected.contractAddress !== expected.contractAddress ||
      selected.walletAddress !== expected.walletAddress ||
      selected.groupId !== expected.groupId
    ) throw new Error('Group read cursor belongs to another scope.');
  }
  const generation = Number(record.generation);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Group read-cursor generation is invalid.');
  }
  const messageId = integer(record.lastReadMessageId, 'Cursor message ID', UINT64_MAX);
  if (messageId === 0n) {
    if (record.lastReadBlockNumber !== null || record.lastReadBlockHash !== null) {
      throw new Error('An empty group cursor cannot have a block anchor.');
    }
    return createGroupChatV2ReadCursor(selected, generation);
  }
  return createGroupChatV2ReadCursor(selected, generation, {
    messageId,
    blockNumber: integer(record.lastReadBlockNumber, 'Cursor block number', UINT256_MAX),
    blockHash: hash(record.lastReadBlockHash, 'Cursor block hash')
  });
};

export const buildGroupChatV2ReadCursorKey = (rawScope: GroupChatV2ReadCursorScope): string => {
  const selected = scope(rawScope);
  return [
    GROUP_CHAT_V2_READ_CURSOR_SCHEMA,
    selected.chainId,
    selected.contractAddress.toLowerCase(),
    selected.walletAddress.toLowerCase(),
    selected.groupId
  ].join(':');
};

export const mergeGroupChatV2ReadCursors = async ({
  scope: rawScope,
  cursors,
  canonicalMessageCount,
  readCanonicalAnchor
}: {
  scope: GroupChatV2ReadCursorScope;
  cursors: readonly GroupChatV2ReadCursor[];
  canonicalMessageCount: bigint;
  readCanonicalAnchor: (
    messageId: bigint,
    blockNumber: bigint
  ) => Promise<GroupChatV2ReadCursorAnchor | null>;
}): Promise<GroupChatV2ReadCursor> => {
  const selected = scope(rawScope);
  if (canonicalMessageCount < 0n || canonicalMessageCount > UINT64_MAX) {
    throw new Error('Canonical group message count is invalid.');
  }
  const parsed = cursors.map((cursor) => parseGroupChatV2ReadCursor(cursor, selected));
  const generation = parsed.reduce((maximum, cursor) => Math.max(maximum, cursor.generation), 0);
  let latest = createGroupChatV2ReadCursor(selected, generation);
  for (const cursor of parsed) {
    if (cursor.generation !== generation) continue;
    const messageId = BigInt(cursor.lastReadMessageId);
    if (messageId === 0n || messageId > canonicalMessageCount) continue;
    const blockNumber = BigInt(cursor.lastReadBlockNumber ?? '0');
    const canonical = await readCanonicalAnchor(messageId, blockNumber);
    if (
      canonical?.messageId === messageId &&
      canonical.blockNumber === blockNumber &&
      hash(canonical.blockHash, 'Canonical group cursor hash') === cursor.lastReadBlockHash &&
      messageId > BigInt(latest.lastReadMessageId)
    ) latest = cursor;
  }
  return latest;
};

export const advanceGroupChatV2ReadCursor = ({
  cursor,
  scope: rawScope,
  visibleMessage
}: {
  cursor: GroupChatV2ReadCursor;
  scope: GroupChatV2ReadCursorScope;
  visibleMessage: Pick<ChatMessage, 'direction' | 'groupV2'>;
}): GroupChatV2ReadCursor => {
  const selected = scope(rawScope);
  const current = parseGroupChatV2ReadCursor(cursor, selected);
  const identity = visibleMessage.groupV2;
  if (
    !identity ||
    identity.finality !== 'finalized' ||
    identity.chainId !== selected.chainId.toString() ||
    identity.contractAddress.toLowerCase() !== selected.contractAddress.toLowerCase() ||
    identity.groupId !== selected.groupId.toString()
  ) return current;
  const messageId = integer(identity.messageId, 'Visible group message ID', UINT64_MAX);
  if (messageId <= BigInt(current.lastReadMessageId)) return current;
  return createGroupChatV2ReadCursor(selected, current.generation, {
    messageId,
    blockNumber: integer(identity.blockNumber, 'Visible group message block', UINT256_MAX),
    blockHash: identity.blockHash
  });
};

export const hasUnreadGroupChatV2Message = ({
  cursor,
  latestIncomingMessageId
}: {
  cursor: GroupChatV2ReadCursor;
  latestIncomingMessageId: bigint;
}): boolean => latestIncomingMessageId > BigInt(cursor.lastReadMessageId);
