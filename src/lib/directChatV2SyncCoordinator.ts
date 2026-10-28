import { getAddress } from '@coti-io/coti-ethers';
import type { ChatMessage, HistoryEntry, WalletAccountRole } from './appShared';
import type {
  DirectChatV2EpochKey,
  DirectChatV2EpochReference,
  DirectChatV2MessageEvent
} from './directChatV2Chain';
import { decryptDirectChatV2EventMessage } from './directChatV2Chain';
import {
  deriveDirectChatV2AadHash,
  DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES
} from './directChatV2Crypto';
import {
  clearDirectChatV2ConversationForReplay,
  createDirectChatV2HistoryCheckpoint,
  mapDecodedDirectChatV2HistoryEvent,
  mapUnavailableDirectChatV2HistoryEvent,
  planDirectChatV2HistoryPage,
  type DirectChatV2DualReadConfig,
  type DirectChatV2EpochKeyResolver,
  type DirectChatV2HistoryCheckpoint,
  type DirectChatV2HistoryScope
} from './directChatV2History';
import { decodeDirectChatV2Payload, type DirectChatV2Payload } from './directChatV2Payload';
import { mergeDirectHistoryEntries } from './directConversationSyncHelpers';

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type DirectChatV2CanonicalBlock = {
  number: bigint;
  hash: string;
  timestamp?: number;
};

export type DirectChatV2SyncDependencies = {
  getLatestBlockNumber: (chainId: bigint) => Promise<bigint>;
  readCanonicalBlock: (
    chainId: bigint,
    blockNumber: bigint
  ) => Promise<DirectChatV2CanonicalBlock | null>;
  readMessagePage: (input: {
    scope: DirectChatV2HistoryScope;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<DirectChatV2MessageEvent[]>;
  /** Must read the conversation message count at the exact historical block tag. */
  readConversationMessageCountAtBlock: (input: {
    scope: DirectChatV2HistoryScope;
    blockNumber: bigint;
  }) => Promise<bigint>;
  resolveEpochKey: DirectChatV2EpochKeyResolver;
  clearEpochKeys: () => void | Promise<void>;
};

export type DirectChatV2SyncResult = {
  status: 'disabled' | 'up-to-date' | 'reorg-reset' | 'page-applied';
  messagesByContact: Record<string, ChatMessage[]>;
  checkpoint?: DirectChatV2HistoryCheckpoint;
  safeHead?: bigint;
  hasMore: boolean;
  reorged: boolean;
  appliedEntries: number;
  unavailableEntries: number;
  mutation?: DirectChatV2SyncMutation;
  page?: {
    fromBlock: bigint;
    toBlock: bigint;
    expectedPreviousMessageId: bigint;
    lastMessageId: bigint;
  };
};

export type DirectChatV2SyncMutation = {
  scope: DirectChatV2HistoryScope;
  viewerAddress: string;
  resetConversation: boolean;
  entries: readonly HistoryEntry[];
};

export const applyDirectChatV2SyncMutation = (
  previousMessages: Record<string, ChatMessage[]>,
  mutation: DirectChatV2SyncMutation
): Record<string, ChatMessage[]> => {
  const baseMessages = mutation.resetConversation
    ? clearDirectChatV2ConversationForReplay(previousMessages, mutation.scope)
    : previousMessages;
  return mergeDirectHistoryEntries(
    baseMessages,
    [...mutation.entries],
    mutation.viewerAddress,
    { pruneOptimisticOutgoing: false }
  );
};

const assertReadLease = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Direct-chat V2 sync scope changed while a page was loading.');
  }
};

const normalizeBytes32 = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!BYTES32_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
};

const parseCheckpointBlockNumber = (checkpoint: DirectChatV2HistoryCheckpoint): bigint => {
  if (!DECIMAL_PATTERN.test(checkpoint.blockNumber)) {
    throw new Error('Direct-chat V2 checkpoint block must be a canonical decimal string.');
  }
  const blockNumber = BigInt(checkpoint.blockNumber);
  if (blockNumber > UINT256_MAX) {
    throw new Error('Direct-chat V2 checkpoint block is out of range.');
  }
  return blockNumber;
};

const normalizeMessageCount = (value: bigint): bigint => {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error('Historical direct-chat V2 message count must be a uint64 value.');
  }
  return value;
};

const validateCanonicalBlock = (
  block: DirectChatV2CanonicalBlock | null,
  blockNumber: bigint
): DirectChatV2CanonicalBlock | null => {
  if (!block) return null;
  if (block.number !== blockNumber) {
    throw new Error('Canonical block reader returned the wrong direct-chat V2 block.');
  }
  normalizeBytes32(block.hash, 'Canonical block hash');
  if (
    block.timestamp !== undefined &&
    (!Number.isSafeInteger(block.timestamp) || block.timestamp < 0)
  ) {
    throw new Error('Canonical direct-chat V2 block timestamp is invalid.');
  }
  return block;
};

const epochReferenceKey = (reference: DirectChatV2EpochReference): string => [
  reference.chainId.toString(),
  reference.contractAddress.toLowerCase(),
  reference.conversationId.toLowerCase(),
  reference.epoch.toString()
].join(':');

const validateResolvedEpochKey = (
  reference: DirectChatV2EpochReference,
  key: DirectChatV2EpochKey
): void => {
  if (
    key.value < 0n ||
    key.value > UINT128_MAX ||
    key.chainId !== reference.chainId ||
    key.contractAddress.toLowerCase() !== reference.contractAddress.toLowerCase() ||
    key.conversationId.toLowerCase() !== reference.conversationId.toLowerCase() ||
    key.epoch !== reference.epoch
  ) {
    throw new Error('Resolved direct-chat V2 epoch key does not match its requested scope.');
  }
};

const validateEventCryptoBinding = (event: DirectChatV2MessageEvent): void => {
  const context = event.context;
  const encrypted = event.encrypted;
  if (
    context.chainId !== event.chainId ||
    context.contractAddress.toLowerCase() !== event.contractAddress.toLowerCase() ||
    context.conversationId.toLowerCase() !== event.conversationId.toLowerCase() ||
    context.epoch !== event.epoch ||
    context.sender.toLowerCase() !== event.sender.toLowerCase() ||
    context.recipient.toLowerCase() !== event.recipient.toLowerCase() ||
    context.senderSequence !== event.senderSequence ||
    context.valueSent !== event.valueSent ||
    context.feeTaken !== event.feeTaken ||
    encrypted.nonce.toLowerCase() !== event.nonce.toLowerCase() ||
    encrypted.aadHash.toLowerCase() !== event.aadHash.toLowerCase() ||
    encrypted.ciphertext.toLowerCase() !== event.ciphertext.toLowerCase()
  ) {
    throw new Error('Direct-chat V2 event crypto fields do not match their canonical log fields.');
  }
  if (!/^0x[0-9a-fA-F]{24}$/.test(event.nonce) || event.nonce === `0x${'00'.repeat(12)}`) {
    throw new Error('Direct-chat V2 event nonce is invalid.');
  }
  normalizeBytes32(event.aadHash, 'Direct-chat V2 event AAD hash');
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(event.ciphertext)) {
    throw new Error('Direct-chat V2 event ciphertext is not canonical hex bytes.');
  }
  const ciphertextLength = (event.ciphertext.length - 2) / 2;
  if (
    ciphertextLength < DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    ciphertextLength > DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Direct-chat V2 event ciphertext is outside the protocol bounds.');
  }
  if (deriveDirectChatV2AadHash(context, event.nonce) !== event.aadHash.toLowerCase()) {
    throw new Error('Direct-chat V2 event AAD does not match its canonical context.');
  }
};

const validateEventPageScope = ({
  events,
  scope,
  fromBlock,
  toBlock
}: {
  events: DirectChatV2MessageEvent[];
  scope: DirectChatV2HistoryScope;
  fromBlock: bigint;
  toBlock: bigint;
}): void => {
  const contractAddress = getAddress(scope.contractAddress.trim()).toLowerCase();
  const conversationId = normalizeBytes32(scope.conversationId, 'Sync conversation ID');
  for (const event of events) {
    if (
      event.chainId !== scope.chainId ||
      event.contractAddress.toLowerCase() !== contractAddress ||
      event.conversationId.toLowerCase() !== conversationId
    ) {
      throw new Error('Direct-chat V2 history page returned an event outside its requested scope.');
    }
    if (event.blockNumber < fromBlock || event.blockNumber > toBlock) {
      throw new Error('Direct-chat V2 history page returned an event outside its requested block range.');
    }
    if (event.removed) {
      throw new Error('Direct-chat V2 history page returned a removed event.');
    }
  }
};

export const syncDirectChatV2HistoryPage = async ({
  config,
  scope,
  viewerAddress,
  accountRole,
  previousMessages,
  checkpoint,
  dependencies,
  shouldContinue
}: {
  config: DirectChatV2DualReadConfig;
  scope: DirectChatV2HistoryScope;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  previousMessages: Record<string, ChatMessage[]>;
  checkpoint?: DirectChatV2HistoryCheckpoint;
  dependencies: DirectChatV2SyncDependencies;
  shouldContinue?: () => boolean;
}): Promise<DirectChatV2SyncResult> => {
  if (!config.enabled) {
    return {
      status: 'disabled',
      messagesByContact: previousMessages,
      checkpoint,
      hasMore: false,
      reorged: false,
      appliedEntries: 0,
      unavailableEntries: 0
    };
  }

  assertReadLease(shouldContinue);
  const latestBlock = await dependencies.getLatestBlockNumber(scope.chainId);
  assertReadLease(shouldContinue);

  const blockPromises = new Map<string, Promise<DirectChatV2CanonicalBlock | null>>();
  const readBlock = (blockNumber: bigint): Promise<DirectChatV2CanonicalBlock | null> => {
    const cacheKey = blockNumber.toString();
    const existing = blockPromises.get(cacheKey);
    if (existing) return existing;
    const pending = dependencies.readCanonicalBlock(scope.chainId, blockNumber).then((block) => {
      assertReadLease(shouldContinue);
      return validateCanonicalBlock(block, blockNumber);
    });
    blockPromises.set(cacheKey, pending);
    return pending;
  };

  let canonicalCheckpointBlockHash: string | null | undefined;
  if (checkpoint) {
    planDirectChatV2HistoryPage({
      scope,
      latestBlock,
      confirmationDepth: config.confirmationDepth,
      maxBlockSpan: config.maxBlockSpan,
      checkpoint,
      canonicalCheckpointBlockHash: checkpoint.blockHash
    });
    const checkpointBlock = await readBlock(parseCheckpointBlockNumber(checkpoint));
    canonicalCheckpointBlockHash = checkpointBlock?.hash ?? null;
  }

  const plan = planDirectChatV2HistoryPage({
    scope,
    latestBlock,
    confirmationDepth: config.confirmationDepth,
    maxBlockSpan: config.maxBlockSpan,
    checkpoint,
    canonicalCheckpointBlockHash
  });
  if (plan.resetConversation) {
    await dependencies.clearEpochKeys();
    assertReadLease(shouldContinue);
  }
  const retainedCheckpoint = plan.resetConversation ? undefined : checkpoint;

  if (plan.fromBlock === undefined || plan.toBlock === undefined) {
    const mutation = plan.resetConversation
      ? { scope, viewerAddress, resetConversation: true, entries: [] } satisfies DirectChatV2SyncMutation
      : undefined;
    return {
      status: plan.resetConversation ? 'reorg-reset' : 'up-to-date',
      messagesByContact: mutation
        ? applyDirectChatV2SyncMutation(previousMessages, mutation)
        : previousMessages,
      checkpoint: retainedCheckpoint,
      safeHead: plan.safeHead,
      hasMore: false,
      reorged: plan.resetConversation,
      appliedEntries: 0,
      unavailableEntries: 0,
      mutation
    };
  }

  const pageBoundaryBlock = await readBlock(plan.toBlock);
  if (!pageBoundaryBlock) {
    throw new Error('Direct-chat V2 page boundary is no longer canonical.');
  }

  assertReadLease(shouldContinue);
  const events = await dependencies.readMessagePage({
    scope,
    fromBlock: plan.fromBlock,
    toBlock: plan.toBlock
  });
  assertReadLease(shouldContinue);
  if (!Array.isArray(events)) {
    throw new Error('Direct-chat V2 history reader did not return an event page.');
  }
  validateEventPageScope({
    events,
    scope,
    fromBlock: plan.fromBlock,
    toBlock: plan.toBlock
  });

  const expectedMessageCount = normalizeMessageCount(
    await dependencies.readConversationMessageCountAtBlock({
      scope,
      blockNumber: plan.toBlock
    })
  );
  assertReadLease(shouldContinue);
  if (
    expectedMessageCount < plan.expectedPreviousMessageId ||
    BigInt(events.length) !== expectedMessageCount - plan.expectedPreviousMessageId
  ) {
    throw new Error(
      `Direct-chat V2 history page is incomplete: expected messages through ${expectedMessageCount}, ` +
      `starting after ${plan.expectedPreviousMessageId}, but received ${events.length} events.`
    );
  }

  const timestampByBlock = new Map<number, number>();
  for (const event of events) {
    const canonicalBlock = await readBlock(event.blockNumber);
    if (!canonicalBlock) {
      throw new Error('Direct-chat V2 event block is no longer canonical.');
    }
    if (canonicalBlock.hash.toLowerCase() !== event.blockHash.toLowerCase()) {
      throw new Error('Direct-chat V2 event block hash does not match the canonical chain.');
    }
    if (canonicalBlock.timestamp !== undefined) {
      if (event.blockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Direct-chat V2 event block cannot be represented by the UI.');
      }
      timestampByBlock.set(Number(event.blockNumber), canonicalBlock.timestamp);
    }
  }

  const sortedEvents = [...events].sort((left, right) => {
    if (left.blockNumber < right.blockNumber) return -1;
    if (left.blockNumber > right.blockNumber) return 1;
    return left.logIndex - right.logIndex;
  });
  let lastMessageId = plan.expectedPreviousMessageId;
  const preparedEvents = sortedEvents.map((event) => {
    const expectedMessageId = lastMessageId + 1n;
    if (event.messageId !== expectedMessageId) {
      throw new Error(
        `Direct-chat V2 history continuity expected message ${expectedMessageId} ` +
        `but received ${event.messageId}.`
      );
    }
    lastMessageId = event.messageId;
    validateEventCryptoBinding(event);
    const timestamp = event.blockNumber <= BigInt(Number.MAX_SAFE_INTEGER)
      ? timestampByBlock.get(Number(event.blockNumber))
      : undefined;
    const fallback = mapUnavailableDirectChatV2HistoryEvent({
      event,
      viewerAddress,
      accountRole,
      finality: 'finalized',
      timestamp
    });
    const reference = {
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      conversationId: event.conversationId,
      epoch: event.epoch
    } satisfies DirectChatV2EpochReference;
    return { event, fallback, reference, timestamp };
  });
  if (lastMessageId !== expectedMessageCount) {
    throw new Error(
      `Direct-chat V2 history page is incomplete: expected message ${expectedMessageCount}, ` +
      `but the page ended at ${lastMessageId}.`
    );
  }

  const epochKeys = new Map<string, DirectChatV2EpochKey>();
  for (const { reference } of preparedEvents) {
    const cacheKey = epochReferenceKey(reference);
    if (epochKeys.has(cacheKey)) continue;
    const key = await dependencies.resolveEpochKey(reference);
    assertReadLease(shouldContinue);
    validateResolvedEpochKey(reference, key);
    epochKeys.set(cacheKey, key);
  }
  const entries: HistoryEntry[] = [];
  let unavailableEntries = 0;
  for (const prepared of preparedEvents) {
    const key = epochKeys.get(epochReferenceKey(prepared.reference));
    if (!key) {
      throw new Error('Direct-chat V2 epoch key was not pre-resolved for this page.');
    }
    let payload: DirectChatV2Payload;
    try {
      const encodedPayload = await decryptDirectChatV2EventMessage({
        encrypted: prepared.event.encrypted,
        key,
        context: prepared.event.context
      });
      assertReadLease(shouldContinue);
      payload = decodeDirectChatV2Payload(encodedPayload);
    } catch (error) {
      if (shouldContinue && !shouldContinue()) throw error;
      entries.push(prepared.fallback);
      unavailableEntries += 1;
      continue;
    }
    entries.push(mapDecodedDirectChatV2HistoryEvent({
      event: prepared.event,
      payload,
      viewerAddress,
      accountRole,
      finality: 'finalized',
      timestamp: prepared.timestamp
    }));
  }

  assertReadLease(shouldContinue);
  if (retainedCheckpoint) {
    const retainedBlockNumber = parseCheckpointBlockNumber(retainedCheckpoint);
    const finalRetainedBoundary = validateCanonicalBlock(
      await dependencies.readCanonicalBlock(scope.chainId, retainedBlockNumber),
      retainedBlockNumber
    );
    assertReadLease(shouldContinue);
    if (
      !finalRetainedBoundary ||
      finalRetainedBoundary.hash.toLowerCase() !== retainedCheckpoint.blockHash.toLowerCase() ||
      finalRetainedBoundary.hash.toLowerCase() !== canonicalCheckpointBlockHash?.toLowerCase()
    ) {
      await dependencies.clearEpochKeys();
      assertReadLease(shouldContinue);
      throw new Error('Direct-chat V2 checkpoint boundary changed while the page was loading.');
    }
  }
  const finalPageBoundary = validateCanonicalBlock(
    await dependencies.readCanonicalBlock(scope.chainId, plan.toBlock),
    plan.toBlock
  );
  assertReadLease(shouldContinue);
  if (
    !finalPageBoundary ||
    finalPageBoundary.hash.toLowerCase() !== pageBoundaryBlock.hash.toLowerCase()
  ) {
    await dependencies.clearEpochKeys();
    assertReadLease(shouldContinue);
    throw new Error('Direct-chat V2 page boundary changed while the page was loading.');
  }

  const nextCheckpoint = createDirectChatV2HistoryCheckpoint({
    scope,
    blockNumber: plan.toBlock,
    blockHash: finalPageBoundary.hash,
    lastMessageId
  });
  const mutation = {
    scope,
    viewerAddress,
    resetConversation: plan.resetConversation,
    entries
  } satisfies DirectChatV2SyncMutation;
  const messagesByContact = applyDirectChatV2SyncMutation(previousMessages, mutation);

  return {
    status: 'page-applied',
    messagesByContact,
    checkpoint: nextCheckpoint,
    safeHead: plan.safeHead,
    hasMore: plan.toBlock < plan.safeHead,
    reorged: plan.resetConversation,
    appliedEntries: entries.length,
    unavailableEntries,
    mutation,
    page: {
      fromBlock: plan.fromBlock,
      toBlock: plan.toBlock,
      expectedPreviousMessageId: plan.expectedPreviousMessageId,
      lastMessageId
    }
  };
};
