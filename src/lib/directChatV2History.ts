import { getAddress } from '@coti-io/coti-ethers';
import {
  parseChatMessagePayload,
  type ChatMessage,
  type DirectChatV2MessageFinality,
  type HistoryEntry,
  type WalletAccountRole
} from './appShared';
import {
  DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN,
  buildDirectChatV2MessageKey,
  decryptDirectChatV2EventMessage,
  type DirectChatV2EpochKey,
  type DirectChatV2EpochReference,
  type DirectChatV2MessageEvent
} from './directChatV2Chain';
import { decodeDirectChatV2Payload, type DirectChatV2Payload } from './directChatV2Payload';

const UINT256_MAX = (1n << 256n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

export const DIRECT_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT = '(Encrypted message unavailable)';

export const DIRECT_CHAT_V2_DUAL_READ_DISABLED = Object.freeze({ enabled: false as const });

export type DirectChatV2DualReadConfig =
  | typeof DIRECT_CHAT_V2_DUAL_READ_DISABLED
  | {
      enabled: true;
      confirmationDepth: bigint;
      maxBlockSpan?: bigint;
    };

export type DirectChatV2EpochKeyResolver = (
  reference: DirectChatV2EpochReference
) => Promise<DirectChatV2EpochKey>;

export type DirectChatV2HistoryScope = {
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  deploymentBlock: bigint;
  /** Canonical ConversationCreated block, attested by the verified V2 adapter. */
  conversationStartBlock: bigint;
};

export type DirectChatV2HistoryCheckpoint = {
  protocol: 'direct-v2';
  chainId: string;
  contractAddress: string;
  conversationId: string;
  blockNumber: string;
  blockHash: string;
  lastMessageId: string;
};

export type DirectChatV2HistoryPagePlan = {
  safeHead: bigint;
  fromBlock?: bigint;
  toBlock?: bigint;
  checkpointStatus: 'none' | 'valid' | 'reorg';
  resetConversation: boolean;
  expectedPreviousMessageId: bigint;
  expectedNextMessageId: bigint;
};

const normalizeUint256 = (value: bigint, label: string): bigint => {
  if (value < 0n || value > UINT256_MAX) {
    throw new Error(`${label} must be a uint256 value.`);
  }
  return value;
};

const normalizeUint64 = (value: bigint, label: string): bigint => {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must be a uint64 value.`);
  }
  return value;
};

const parseCanonicalDecimal = (value: string, label: string, max: bigint): bigint => {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a canonical decimal string.`);
  }
  const parsed = BigInt(normalized);
  if (parsed > max) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed;
};

const normalizeBytes32 = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!BYTES32_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
};

const normalizeHistoryScope = (scope: DirectChatV2HistoryScope): DirectChatV2HistoryScope => {
  const deploymentBlock = normalizeUint256(scope.deploymentBlock, 'History deployment block');
  const conversationStartBlock = normalizeUint256(
    scope.conversationStartBlock,
    'History conversation start block'
  );
  if (conversationStartBlock < deploymentBlock) {
    throw new Error('Direct-chat V2 conversation history cannot start before deployment.');
  }
  return {
    chainId: normalizeUint256(scope.chainId, 'History chain ID'),
    contractAddress: getAddress(scope.contractAddress.trim()),
    conversationId: normalizeBytes32(scope.conversationId, 'History conversation ID'),
    deploymentBlock,
    conversationStartBlock
  };
};

const assertCheckpointScope = (
  checkpoint: DirectChatV2HistoryCheckpoint,
  scope: DirectChatV2HistoryScope
): { blockNumber: bigint; blockHash: string; lastMessageId: bigint } => {
  const checkpointChainId = parseCanonicalDecimal(checkpoint.chainId, 'Checkpoint chain ID', UINT256_MAX);
  if (
    checkpoint.protocol !== 'direct-v2' ||
    checkpointChainId !== scope.chainId ||
    getAddress(checkpoint.contractAddress.trim()).toLowerCase() !== scope.contractAddress.toLowerCase() ||
    normalizeBytes32(checkpoint.conversationId, 'Checkpoint conversation ID') !== scope.conversationId
  ) {
    throw new Error('Direct-chat V2 history checkpoint belongs to a different read scope.');
  }
  const blockNumber = parseCanonicalDecimal(checkpoint.blockNumber, 'Checkpoint block', UINT256_MAX);
  if (blockNumber < scope.conversationStartBlock) {
    throw new Error('Direct-chat V2 history checkpoint predates the conversation.');
  }
  return {
    blockNumber,
    blockHash: normalizeBytes32(checkpoint.blockHash, 'Checkpoint block hash'),
    lastMessageId: parseCanonicalDecimal(checkpoint.lastMessageId, 'Checkpoint message ID', UINT64_MAX)
  };
};

const assertReadLease = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Direct-chat V2 history read scope changed during decryption.');
  }
};

const normalizeOptionalTimestamp = (timestamp?: number): number | undefined => {
  if (timestamp === undefined) return undefined;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Direct-chat V2 block timestamp is invalid.');
  }
  return timestamp;
};

const inspectHistoryEvent = (
  event: DirectChatV2MessageEvent,
  viewerAddress: string
) => {
  if (event.removed) {
    throw new Error('Removed direct-chat V2 logs cannot be normalized as history.');
  }
  if (event.blockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Direct-chat V2 message block is not safely representable by the UI.');
  }

  const viewer = getAddress(viewerAddress.trim());
  const viewerKey = viewer.toLowerCase();
  const senderKey = event.sender.toLowerCase();
  const recipientKey = event.recipient.toLowerCase();
  if (viewerKey !== senderKey && viewerKey !== recipientKey) {
    throw new Error('Direct-chat V2 message is outside the requested wallet scope.');
  }

  const expectedMessageKey = buildDirectChatV2MessageKey({
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    conversationId: event.conversationId,
    messageId: event.messageId
  });
  if (event.key !== expectedMessageKey) {
    throw new Error('Direct-chat V2 message has a non-canonical stable identity.');
  }

  const direction: HistoryEntry['direction'] = viewerKey === senderKey ? 'outgoing' : 'incoming';
  return {
    viewer,
    expectedMessageKey,
    direction,
    contact: direction === 'outgoing' ? event.recipient : event.sender
  };
};

const buildHistoryEntry = ({
  event,
  payload,
  inspection,
  accountRole,
  finality,
  timestamp,
  contentState = 'available'
}: {
  event: DirectChatV2MessageEvent;
  payload: DirectChatV2Payload;
  inspection: ReturnType<typeof inspectHistoryEvent>;
  accountRole?: WalletAccountRole;
  finality: DirectChatV2MessageFinality;
  timestamp?: number;
  contentState?: 'available' | 'unavailable';
}): HistoryEntry => {
  const parsedBody = parseChatMessagePayload(payload.body);
  const stableReplyToMessageId = payload.replyToMessageId === undefined
    ? undefined
    : buildDirectChatV2MessageKey({
        chainId: event.chainId,
        contractAddress: event.contractAddress,
        conversationId: event.conversationId,
        messageId: payload.replyToMessageId
      });

  return {
    id: inspection.expectedMessageKey,
    contact: inspection.contact,
    direction: inspection.direction,
    text: parsedBody.cleanText,
    accountAddress: inspection.viewer,
    accountRole,
    replyToMessageId: stableReplyToMessageId ?? parsedBody.replyToMessageId,
    replyToMessageAnchor: payload.replyToMessageAnchor,
    replyToText: payload.replyPreview ?? parsedBody.replyToText,
    replyToTxHash: parsedBody.replyToTxHash,
    replyToBlockNumber: parsedBody.replyToBlockNumber,
    replyToLogIndex: parsedBody.replyToLogIndex,
    tradeReference: parsedBody.tradeReference,
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    logIndex: event.logIndex,
    timestamp: normalizeOptionalTimestamp(timestamp),
    directV2: {
      protocol: 'direct-v2',
      contentState,
      chainId: event.chainId.toString(),
      contractAddress: event.contractAddress,
      conversationId: event.conversationId,
      messageId: event.messageId.toString(),
      epoch: event.epoch.toString(),
      senderSequence: event.senderSequence.toString(),
      nonce: event.nonce,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber.toString(),
      blockHash: event.blockHash,
      logIndex: event.logIndex,
      finality
    }
  };
};

export const mapUnavailableDirectChatV2HistoryEvent = ({
  event,
  viewerAddress,
  accountRole,
  finality,
  timestamp
}: {
  event: DirectChatV2MessageEvent;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  finality: DirectChatV2MessageFinality;
  timestamp?: number;
}): HistoryEntry => buildHistoryEntry({
  event,
  payload: {
    version: 1,
    body: DIRECT_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT
  },
  inspection: inspectHistoryEvent(event, viewerAddress),
  accountRole,
  finality,
  timestamp,
  contentState: 'unavailable'
});

export const mapDecodedDirectChatV2HistoryEvent = ({
  event,
  payload,
  viewerAddress,
  accountRole,
  finality,
  timestamp
}: {
  event: DirectChatV2MessageEvent;
  payload: DirectChatV2Payload;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  finality: DirectChatV2MessageFinality;
  timestamp?: number;
}): HistoryEntry => buildHistoryEntry({
  event,
  payload,
  inspection: inspectHistoryEvent(event, viewerAddress),
  accountRole,
  finality,
  timestamp
});

export const normalizeDirectChatV2HistoryEvent = async ({
  event,
  viewerAddress,
  accountRole,
  resolveEpochKey,
  finality,
  timestamp,
  shouldContinue
}: {
  event: DirectChatV2MessageEvent;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  resolveEpochKey: DirectChatV2EpochKeyResolver;
  finality: DirectChatV2MessageFinality;
  timestamp?: number;
  shouldContinue?: () => boolean;
}): Promise<HistoryEntry> => {
  const inspection = inspectHistoryEvent(event, viewerAddress);

  assertReadLease(shouldContinue);
  const epochReference = {
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    conversationId: event.conversationId,
    epoch: event.epoch
  } satisfies DirectChatV2EpochReference;
  const epochKey = await resolveEpochKey(epochReference);
  assertReadLease(shouldContinue);
  const encodedPayload = await decryptDirectChatV2EventMessage({
    encrypted: event.encrypted,
    key: epochKey,
    context: event.context
  });
  assertReadLease(shouldContinue);
  const payload = decodeDirectChatV2Payload(encodedPayload);
  return buildHistoryEntry({ event, payload, inspection, accountRole, finality, timestamp });
};

export const normalizeDirectChatV2HistoryEvents = async ({
  events,
  expectedPreviousMessageId,
  viewerAddress,
  accountRole,
  resolveEpochKey,
  finality,
  timestampByBlock,
  shouldContinue
}: {
  events: DirectChatV2MessageEvent[];
  expectedPreviousMessageId: bigint;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  resolveEpochKey: DirectChatV2EpochKeyResolver;
  finality: DirectChatV2MessageFinality;
  timestampByBlock?: ReadonlyMap<number, number>;
  shouldContinue?: () => boolean;
}): Promise<{
  entries: HistoryEntry[];
  previousMessageId: bigint;
  lastMessageId: bigint;
  nextMessageId: bigint;
}> => {
  const sorted = [...events].sort((left, right) => {
    if (left.blockNumber < right.blockNumber) return -1;
    if (left.blockNumber > right.blockNumber) return 1;
    return left.logIndex - right.logIndex;
  });
  const previousMessageId = normalizeUint64(expectedPreviousMessageId, 'Previous message ID');
  let lastMessageId = previousMessageId;
  const seenMessageKeys = new Set<string>();
  const keyByEpoch = new Map<string, Promise<DirectChatV2EpochKey>>();
  const cachedResolver: DirectChatV2EpochKeyResolver = (reference) => {
    const cacheKey = [
      reference.chainId.toString(),
      reference.contractAddress.toLowerCase(),
      reference.conversationId.toLowerCase(),
      reference.epoch.toString()
    ].join(':');
    const existing = keyByEpoch.get(cacheKey);
    if (existing) return existing;
    const pending = resolveEpochKey(reference);
    keyByEpoch.set(cacheKey, pending);
    return pending;
  };
  const entries: HistoryEntry[] = [];

  for (const event of sorted) {
    if (seenMessageKeys.has(event.key)) {
      throw new Error('Direct-chat V2 history page contains a duplicate stable message identity.');
    }
    seenMessageKeys.add(event.key);
    const expectedMessageId = lastMessageId + 1n;
    if (event.messageId !== expectedMessageId) {
      throw new Error(
        `Direct-chat V2 history continuity expected message ${expectedMessageId} but received ${event.messageId}.`
      );
    }
    lastMessageId = event.messageId;
    const blockNumber = event.blockNumber <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(event.blockNumber)
      : Number.NaN;
    entries.push(await normalizeDirectChatV2HistoryEvent({
      event,
      viewerAddress,
      accountRole,
      resolveEpochKey: cachedResolver,
      finality,
      timestamp: Number.isSafeInteger(blockNumber) ? timestampByBlock?.get(blockNumber) : undefined,
      shouldContinue
    }));
  }

  return {
    entries,
    previousMessageId,
    lastMessageId,
    nextMessageId: lastMessageId + 1n
  };
};

export const planDirectChatV2HistoryPage = ({
  scope: rawScope,
  latestBlock,
  confirmationDepth,
  maxBlockSpan = DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN,
  checkpoint,
  canonicalCheckpointBlockHash
}: {
  scope: DirectChatV2HistoryScope;
  latestBlock: bigint;
  confirmationDepth: bigint;
  maxBlockSpan?: bigint;
  checkpoint?: DirectChatV2HistoryCheckpoint;
  canonicalCheckpointBlockHash?: string | null;
}): DirectChatV2HistoryPagePlan => {
  const scope = normalizeHistoryScope(rawScope);
  const head = normalizeUint256(latestBlock, 'Latest block');
  const depth = normalizeUint256(confirmationDepth, 'Confirmation depth');
  const span = normalizeUint256(maxBlockSpan, 'History page span');
  if (span === 0n || span > DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Direct-chat V2 history page span exceeds the adapter limit.');
  }
  const safeHead = head >= depth ? head - depth : 0n;

  let checkpointStatus: DirectChatV2HistoryPagePlan['checkpointStatus'] = 'none';
  let resetConversation = false;
  let nextBlock = scope.conversationStartBlock;
  let expectedPreviousMessageId = 0n;
  if (checkpoint) {
    const normalizedCheckpoint = assertCheckpointScope(checkpoint, scope);
    if (canonicalCheckpointBlockHash === undefined) {
      throw new Error('The checkpoint block hash must be re-read before history resumes.');
    }
    const canonicalHash = canonicalCheckpointBlockHash === null
      ? null
      : normalizeBytes32(canonicalCheckpointBlockHash, 'Canonical checkpoint block hash');
    const storedHash = normalizedCheckpoint.blockHash;
    const checkpointIsCanonical =
      canonicalHash !== null &&
      canonicalHash === storedHash &&
      normalizedCheckpoint.blockNumber <= safeHead;
    if (checkpointIsCanonical) {
      checkpointStatus = 'valid';
      nextBlock = normalizedCheckpoint.blockNumber + 1n;
      expectedPreviousMessageId = normalizedCheckpoint.lastMessageId;
    } else {
      checkpointStatus = 'reorg';
      resetConversation = true;
      nextBlock = scope.conversationStartBlock;
    }
  }

  const expectedNextMessageId = expectedPreviousMessageId + 1n;

  if (safeHead < scope.conversationStartBlock || nextBlock > safeHead) {
    return {
      safeHead,
      checkpointStatus,
      resetConversation,
      expectedPreviousMessageId,
      expectedNextMessageId
    };
  }
  return {
    safeHead,
    fromBlock: nextBlock,
    toBlock: nextBlock + span - 1n < safeHead ? nextBlock + span - 1n : safeHead,
    checkpointStatus,
    resetConversation,
    expectedPreviousMessageId,
    expectedNextMessageId
  };
};

export const createDirectChatV2HistoryCheckpoint = ({
  scope: rawScope,
  blockNumber,
  blockHash,
  lastMessageId
}: {
  scope: DirectChatV2HistoryScope;
  blockNumber: bigint;
  blockHash: string;
  lastMessageId: bigint;
}): DirectChatV2HistoryCheckpoint => {
  const scope = normalizeHistoryScope(rawScope);
  const normalizedBlock = normalizeUint256(blockNumber, 'Checkpoint block');
  if (normalizedBlock < scope.conversationStartBlock) {
    throw new Error('Direct-chat V2 checkpoint cannot predate the conversation.');
  }
  const normalizedLastMessageId = normalizeUint64(lastMessageId, 'Checkpoint message ID');
  return {
    protocol: 'direct-v2',
    chainId: scope.chainId.toString(),
    contractAddress: scope.contractAddress,
    conversationId: scope.conversationId,
    blockNumber: normalizedBlock.toString(),
    blockHash: normalizeBytes32(blockHash, 'Checkpoint block hash'),
    lastMessageId: normalizedLastMessageId.toString()
  };
};

export const clearDirectChatV2ConversationForReplay = (
  previous: Record<string, ChatMessage[]>,
  rawScope: DirectChatV2HistoryScope
): Record<string, ChatMessage[]> => {
  const scope = normalizeHistoryScope(rawScope);
  let changed = false;
  const next: Record<string, ChatMessage[]> = {};

  for (const [contact, messages] of Object.entries(previous)) {
    const retained = messages.filter((message) => {
      const identity = message.directV2;
      const shouldRemove = Boolean(
        identity &&
        identity.chainId === scope.chainId.toString() &&
        identity.contractAddress.toLowerCase() === scope.contractAddress.toLowerCase() &&
        identity.conversationId.toLowerCase() === scope.conversationId
      );
      if (shouldRemove) changed = true;
      return !shouldRemove;
    });
    if (retained.length > 0 || messages.length === 0) {
      next[contact] = retained;
    }
  }

  return changed ? next : previous;
};
