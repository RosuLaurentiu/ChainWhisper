import { getAddress } from '@coti-io/coti-ethers';
import type { ChatMessage } from './appShared';

export const DIRECT_CHAT_V2_READ_CURSOR_SCHEMA = 'chainwhisper-direct-chat-v2-read-cursor-v1' as const;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type DirectChatV2ReadCursorScope = {
  chainId: bigint;
  contractAddress: string;
  walletAddress: string;
  conversationId: string;
};

export type DirectChatV2ReadCursor = {
  schema: typeof DIRECT_CHAT_V2_READ_CURSOR_SCHEMA;
  chainId: string;
  contractAddress: string;
  walletAddress: string;
  conversationId: string;
  generation: number;
  lastReadMessageId: string;
  lastReadBlockNumber: string | null;
  lastReadBlockHash: string | null;
};

export type DirectChatV2ReadCursorAnchor = {
  messageId: bigint;
  blockNumber: bigint;
  blockHash: string;
};

const parseInteger = (value: unknown, label: string, maximum: bigint): bigint => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a canonical decimal string.`);
  }
  const parsed = BigInt(normalized);
  if (parsed > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed;
};

const normalizeScope = (scope: DirectChatV2ReadCursorScope): DirectChatV2ReadCursorScope => {
  const chainId = BigInt(scope.chainId);
  if (chainId <= 0n || chainId > UINT256_MAX) {
    throw new Error('Read-cursor chain ID must be a non-zero uint256 value.');
  }
  const conversationId = scope.conversationId.trim().toLowerCase();
  if (!BYTES32_PATTERN.test(conversationId)) {
    throw new Error('Read-cursor conversation ID must be a 32-byte hex value.');
  }
  return {
    chainId,
    contractAddress: getAddress(scope.contractAddress.trim()),
    walletAddress: getAddress(scope.walletAddress.trim()),
    conversationId
  };
};

const cursorMatchesScope = (
  cursor: DirectChatV2ReadCursor,
  scope: DirectChatV2ReadCursorScope
): boolean => (
  cursor.chainId === scope.chainId.toString() &&
  cursor.contractAddress.toLowerCase() === scope.contractAddress.toLowerCase() &&
  cursor.walletAddress.toLowerCase() === scope.walletAddress.toLowerCase() &&
  cursor.conversationId.toLowerCase() === scope.conversationId
);

const requireCursorScope = (
  cursor: DirectChatV2ReadCursor,
  scope: DirectChatV2ReadCursorScope
): void => {
  if (!cursorMatchesScope(cursor, scope)) {
    throw new Error('Direct-chat V2 read cursor belongs to a different wallet or conversation.');
  }
};

export const createDirectChatV2ReadCursor = (
  rawScope: DirectChatV2ReadCursorScope,
  generationOrAnchor: number | DirectChatV2ReadCursorAnchor = 0,
  selectedAnchor?: DirectChatV2ReadCursorAnchor
): DirectChatV2ReadCursor => {
  const scope = normalizeScope(rawScope);
  const generation = typeof generationOrAnchor === 'number' ? generationOrAnchor : 0;
  const anchor = typeof generationOrAnchor === 'number' ? selectedAnchor : generationOrAnchor;
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Direct-chat read-cursor generation is invalid.');
  }
  if (!anchor) {
    return Object.freeze({
      schema: DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
      chainId: scope.chainId.toString(),
      contractAddress: scope.contractAddress,
      walletAddress: scope.walletAddress,
      conversationId: scope.conversationId,
      generation,
      lastReadMessageId: '0',
      lastReadBlockNumber: null,
      lastReadBlockHash: null
    });
  }
  if (anchor.messageId <= 0n || anchor.messageId > UINT64_MAX) {
    throw new Error('Last-read message ID must be a non-zero uint64 value.');
  }
  if (anchor.blockNumber < 0n || anchor.blockNumber > UINT256_MAX) {
    throw new Error('Last-read block number must be a uint256 value.');
  }
  const blockHash = normalizeHex32(anchor.blockHash, 'Last-read block hash');
  return Object.freeze({
    schema: DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
    chainId: scope.chainId.toString(),
    contractAddress: scope.contractAddress,
    walletAddress: scope.walletAddress,
    conversationId: scope.conversationId,
    generation,
    lastReadMessageId: anchor.messageId.toString(),
    lastReadBlockNumber: anchor.blockNumber.toString(),
    lastReadBlockHash: blockHash
  });
};

const normalizeHex32 = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!BYTES32_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized;
};

export const parseDirectChatV2ReadCursor = (
  value: unknown,
  expectedScope?: DirectChatV2ReadCursorScope
): DirectChatV2ReadCursor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Direct-chat V2 read cursor must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== DIRECT_CHAT_V2_READ_CURSOR_SCHEMA) {
    throw new Error('Unsupported direct-chat V2 read-cursor schema.');
  }
  const scope = normalizeScope({
    chainId: parseInteger(record.chainId, 'Read-cursor chain ID', UINT256_MAX),
    contractAddress: String(record.contractAddress ?? ''),
    walletAddress: String(record.walletAddress ?? ''),
    conversationId: String(record.conversationId ?? '')
  });
  const lastReadMessageId = parseInteger(
    record.lastReadMessageId,
    'Last-read message ID',
    UINT64_MAX
  );
  const generation = record.generation === undefined ? 0 : Number(record.generation);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Direct-chat read-cursor generation is invalid.');
  }
  let cursor: DirectChatV2ReadCursor;
  if (lastReadMessageId === 0n) {
    if (record.lastReadBlockNumber !== null || record.lastReadBlockHash !== null) {
      throw new Error('An empty direct-chat read cursor cannot have a block anchor.');
    }
    cursor = createDirectChatV2ReadCursor(scope, generation);
  } else {
    cursor = createDirectChatV2ReadCursor(scope, generation, {
      messageId: lastReadMessageId,
      blockNumber: parseInteger(record.lastReadBlockNumber, 'Last-read block number', UINT256_MAX),
      blockHash: typeof record.lastReadBlockHash === 'string' ? record.lastReadBlockHash : ''
    });
  }
  if (expectedScope) {
    requireCursorScope(cursor, normalizeScope(expectedScope));
  }
  return cursor;
};

export const serializeDirectChatV2ReadCursor = (cursor: DirectChatV2ReadCursor): string =>
  JSON.stringify(parseDirectChatV2ReadCursor(cursor));

export const buildDirectChatV2ReadCursorStorageKey = (
  rawScope: DirectChatV2ReadCursorScope
): string => {
  const scope = normalizeScope(rawScope);
  return [
    DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
    scope.chainId.toString(),
    scope.contractAddress.toLowerCase(),
    scope.walletAddress.toLowerCase(),
    scope.conversationId
  ].join(':');
};

export const mergeDirectChatV2ReadCursors = async ({
  scope: rawScope,
  cursors,
  canonicalMessageCount,
  readCanonicalMessageAnchor
}: {
  scope: DirectChatV2ReadCursorScope;
  cursors: readonly DirectChatV2ReadCursor[];
  canonicalMessageCount: bigint;
  readCanonicalMessageAnchor: (
    messageId: bigint
  ) => Promise<DirectChatV2ReadCursorAnchor | null>;
}): Promise<DirectChatV2ReadCursor> => {
  const scope = normalizeScope(rawScope);
  if (canonicalMessageCount < 0n || canonicalMessageCount > UINT64_MAX) {
    throw new Error('Canonical message count must be a uint64 value.');
  }
  const parsedCursors = cursors.map((candidate) =>
    parseDirectChatV2ReadCursor(candidate, scope)
  );
  const generation = parsedCursors.reduce(
    (maximum, cursor) => Math.max(maximum, cursor.generation),
    0
  );
  let latest = createDirectChatV2ReadCursor(scope, generation);
  const canonicalAnchorPromises = new Map<
    string,
    Promise<DirectChatV2ReadCursorAnchor | null>
  >();
  for (const cursor of parsedCursors) {
    if (cursor.generation !== generation) continue;
    const candidateMessageId = BigInt(cursor.lastReadMessageId);
    if (
      candidateMessageId === 0n ||
      cursor.lastReadBlockNumber === null ||
      cursor.lastReadBlockHash === null
    ) {
      continue;
    }
    const blockNumber = BigInt(cursor.lastReadBlockNumber);
    const messageKey = candidateMessageId.toString();
    let canonicalAnchorPromise = canonicalAnchorPromises.get(messageKey);
    if (!canonicalAnchorPromise) {
      canonicalAnchorPromise = readCanonicalMessageAnchor(candidateMessageId).then((anchor) => {
        if (anchor === null) return null;
        const canonicalMessageId = BigInt(anchor.messageId);
        const canonicalBlockNumber = BigInt(anchor.blockNumber);
        if (canonicalMessageId !== candidateMessageId) {
          throw new Error('Canonical cursor anchor returned a different message ID.');
        }
        if (canonicalBlockNumber < 0n || canonicalBlockNumber > UINT256_MAX) {
          throw new Error('Canonical cursor block number is out of range.');
        }
        return {
          messageId: canonicalMessageId,
          blockNumber: canonicalBlockNumber,
          blockHash: normalizeHex32(anchor.blockHash, 'Canonical cursor block hash')
        };
      });
      canonicalAnchorPromises.set(messageKey, canonicalAnchorPromise);
    }
    const canonicalAnchor = await canonicalAnchorPromise;
    if (candidateMessageId > canonicalMessageCount) {
      if (canonicalAnchor !== null) {
        throw new Error(
          'Canonical cursor context is inconsistent: an anchored message exceeds the message count.'
        );
      }
      continue;
    }
    if (
      canonicalAnchor === null ||
      canonicalAnchor.blockNumber !== blockNumber ||
      canonicalAnchor.blockHash !== cursor.lastReadBlockHash.toLowerCase()
    ) {
      continue;
    }
    if (candidateMessageId > BigInt(latest.lastReadMessageId)) {
      latest = cursor;
    }
  }
  return latest;
};

const messageIdentityInScope = (
  message: ChatMessage,
  scope: DirectChatV2ReadCursorScope
): { messageId: bigint; blockNumber: bigint; blockHash: string } | null => {
  const identity = message.directV2;
  if (
    !identity ||
    identity.finality !== 'finalized' ||
    identity.chainId !== scope.chainId.toString() ||
    identity.contractAddress.toLowerCase() !== scope.contractAddress.toLowerCase() ||
    identity.conversationId.toLowerCase() !== scope.conversationId
  ) {
    return null;
  }
  return {
    messageId: parseInteger(identity.messageId, 'Message ID', UINT64_MAX),
    blockNumber: parseInteger(identity.blockNumber, 'Message block number', UINT256_MAX),
    blockHash: normalizeHex32(identity.blockHash, 'Message block hash')
  };
};

export const advanceDirectChatV2ReadCursorToVisibleMessage = ({
  cursor: rawCursor,
  scope: rawScope,
  visibleMessage
}: {
  cursor: DirectChatV2ReadCursor;
  scope: DirectChatV2ReadCursorScope;
  visibleMessage: ChatMessage;
}): DirectChatV2ReadCursor => {
  const scope = normalizeScope(rawScope);
  const cursor = parseDirectChatV2ReadCursor(rawCursor, scope);
  const visibleIdentity = messageIdentityInScope(visibleMessage, scope);
  if (visibleIdentity === null || visibleIdentity.messageId <= BigInt(cursor.lastReadMessageId)) {
    return cursor;
  }
  return createDirectChatV2ReadCursor(scope, cursor.generation, visibleIdentity);
};

export const countDirectChatV2UnreadMessages = ({
  cursor: rawCursor,
  scope: rawScope,
  messages
}: {
  cursor: DirectChatV2ReadCursor;
  scope: DirectChatV2ReadCursorScope;
  messages: readonly ChatMessage[];
}): number => {
  const scope = normalizeScope(rawScope);
  const cursor = parseDirectChatV2ReadCursor(rawCursor, scope);
  const lastReadMessageId = BigInt(cursor.lastReadMessageId);
  const unreadIds = new Set<string>();
  for (const message of messages) {
    if (message.direction !== 'incoming') continue;
    const identity = messageIdentityInScope(message, scope);
    if (identity !== null && identity.messageId > lastReadMessageId) {
      unreadIds.add(identity.messageId.toString());
    }
  }
  return unreadIds.size;
};
