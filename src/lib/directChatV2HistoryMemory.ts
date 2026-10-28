import { getAddress } from '@coti-io/coti-ethers';
import type { ChatMessage } from './appShared';
import { buildDirectChatV2MessageKey } from './directChatV2Chain';
import {
  planDirectChatV2HistoryPage,
  type DirectChatV2HistoryCheckpoint,
  type DirectChatV2HistoryScope
} from './directChatV2History';
import {
  applyDirectChatV2SyncMutation,
  type DirectChatV2SyncResult
} from './directChatV2SyncCoordinator';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type DirectChatV2HistoryMemoryState = {
  messagesByContact: Record<string, ChatMessage[]>;
  checkpointsByScope: Readonly<Record<string, DirectChatV2HistoryCheckpoint>>;
  revisionsByScope: Readonly<Record<string, number>>;
};

export const buildDirectChatV2HistoryMemoryScopeKey = ({
  scope,
  walletAddress
}: {
  scope: DirectChatV2HistoryScope;
  walletAddress: string;
}): string => {
  if (scope.chainId <= 0n) {
    throw new Error('Direct-chat V2 history-memory chain ID must be non-zero.');
  }
  if (
    scope.deploymentBlock < 0n ||
    scope.conversationStartBlock < scope.deploymentBlock
  ) {
    throw new Error('Direct-chat V2 history-memory block scope is invalid.');
  }
  const conversationId = scope.conversationId.trim().toLowerCase();
  if (!BYTES32_PATTERN.test(conversationId)) {
    throw new Error('Direct-chat V2 history-memory conversation ID is invalid.');
  }
  return [
    'chainwhisper-direct-chat-v2-history-memory-v1',
    scope.chainId.toString(),
    getAddress(scope.contractAddress.trim()).toLowerCase(),
    getAddress(walletAddress.trim()).toLowerCase(),
    conversationId
  ].join(':');
};

export const getDirectChatV2HistoryMemoryRevision = ({
  state,
  scope,
  walletAddress
}: {
  state: DirectChatV2HistoryMemoryState;
  scope: DirectChatV2HistoryScope;
  walletAddress: string;
}): number => {
  const scopeKey = buildDirectChatV2HistoryMemoryScopeKey({ scope, walletAddress });
  const revision = state.revisionsByScope[scopeKey] ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Direct-chat V2 history-memory revision is invalid.');
  }
  return revision;
};

export const createDirectChatV2HistoryMemoryState = (
  messagesByContact: Record<string, ChatMessage[]> = {}
): DirectChatV2HistoryMemoryState => ({
  messagesByContact,
  checkpointsByScope: {},
  revisionsByScope: {}
});

const hasContiguousMemoryBackingForCheckpoint = ({
  checkpoint,
  checkpointBlock,
  contractAddress,
  messagesByContact,
  scope,
  walletAddress
}: {
  checkpoint: DirectChatV2HistoryCheckpoint;
  checkpointBlock: bigint;
  contractAddress: string;
  messagesByContact: Readonly<Record<string, readonly ChatMessage[]>>;
  scope: DirectChatV2HistoryScope;
  walletAddress: string;
}): boolean => {
  const lastMessageId = BigInt(checkpoint.lastMessageId);
  const messageIds = new Set<string>();

  for (const messages of Object.values(messagesByContact)) {
    for (const message of messages) {
      const identity = message.directV2;
      if (
        !identity ||
        identity.protocol !== 'direct-v2' ||
        identity.finality !== 'finalized' ||
        identity.chainId !== scope.chainId.toString() ||
        identity.contractAddress.toLowerCase() !== contractAddress.toLowerCase() ||
        identity.conversationId.toLowerCase() !== scope.conversationId.toLowerCase() ||
        message.accountAddress?.toLowerCase() !== walletAddress.toLowerCase() ||
        !DECIMAL_PATTERN.test(identity.messageId) ||
        !DECIMAL_PATTERN.test(identity.blockNumber) ||
        !BYTES32_PATTERN.test(identity.blockHash)
      ) {
        continue;
      }

      const messageId = BigInt(identity.messageId);
      if (
        messageId <= 0n ||
        messageId > lastMessageId ||
        BigInt(identity.blockNumber) > checkpointBlock
      ) {
        continue;
      }

      try {
        if (message.id !== buildDirectChatV2MessageKey({
          chainId: scope.chainId,
          contractAddress,
          conversationId: scope.conversationId,
          messageId
        })) {
          continue;
        }
      } catch {
        continue;
      }

      messageIds.add(messageId.toString());
    }
  }

  return BigInt(messageIds.size) === lastMessageId;
};

/**
 * Returns a checkpoint only when the in-memory message projection can back it.
 *
 * Direct-chat plaintext remains memory-only. Persisting a checkpoint without its
 * message projection would make a reload resume after messages that are no longer
 * present, so an unbacked checkpoint deliberately becomes `undefined` and the
 * history coordinator replays from `conversationStartBlock`.
 */
export const selectDirectChatV2MemoryBackedCheckpoint = ({
  checkpoint,
  messagesByContact,
  scope,
  walletAddress
}: {
  checkpoint?: DirectChatV2HistoryCheckpoint;
  messagesByContact: Readonly<Record<string, readonly ChatMessage[]>>;
  scope: DirectChatV2HistoryScope;
  walletAddress: string;
}): DirectChatV2HistoryCheckpoint | undefined => {
  if (!checkpoint) return undefined;

  try {
    const checkpointBlock = BigInt(checkpoint.blockNumber);
    const plan = planDirectChatV2HistoryPage({
      scope,
      latestBlock: checkpointBlock,
      confirmationDepth: 0n,
      maxBlockSpan: 1n,
      checkpoint,
      canonicalCheckpointBlockHash: checkpoint.blockHash
    });
    if (plan.checkpointStatus !== 'valid') return undefined;

    const lastMessageId = BigInt(checkpoint.lastMessageId);
    if (lastMessageId === 0n) return checkpoint;

    const contractAddress = getAddress(scope.contractAddress.trim());
    const normalizedWalletAddress = getAddress(walletAddress.trim());
    return hasContiguousMemoryBackingForCheckpoint({
      checkpoint,
      checkpointBlock,
      contractAddress,
      messagesByContact,
      scope,
      walletAddress: normalizedWalletAddress
    })
      ? checkpoint
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Applies a V2 sync mutation and its checkpoint in one pure state transition.
 * Nothing in this state is serialized; callers must discard it on reload or
 * wallet/chain changes. A reorg result is required to carry the scoped reset
 * mutation produced by the sync coordinator. Callers must capture
 * `expectedRevision` before starting the async page read and pass that unchanged
 * when reducing its result.
 */
export const reduceDirectChatV2HistoryMemorySync = ({
  previous,
  result,
  scope,
  walletAddress,
  expectedRevision
}: {
  previous: DirectChatV2HistoryMemoryState;
  result: DirectChatV2SyncResult;
  scope: DirectChatV2HistoryScope;
  walletAddress: string;
  expectedRevision: number;
}): DirectChatV2HistoryMemoryState => {
  if (result.status === 'disabled') return previous;

  const scopeKey = buildDirectChatV2HistoryMemoryScopeKey({ scope, walletAddress });
  const currentRevision = previous.revisionsByScope[scopeKey] ?? 0;
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision !== currentRevision
  ) {
    throw new Error('Direct-chat V2 sync result was produced from a stale memory revision.');
  }
  if (result.reorged && !result.mutation?.resetConversation) {
    throw new Error('A direct-chat V2 reorg must include its scoped memory reset mutation.');
  }
  if (!result.reorged && result.mutation?.resetConversation) {
    throw new Error('A direct-chat V2 scoped memory reset requires a reorg result.');
  }
  if (result.mutation) {
    const mutationScopeKey = buildDirectChatV2HistoryMemoryScopeKey({
      scope: result.mutation.scope,
      walletAddress: result.mutation.viewerAddress
    });
    if (mutationScopeKey !== scopeKey) {
      throw new Error('Direct-chat V2 sync mutation belongs to a different memory scope.');
    }
  }

  if (result.status === 'page-applied') {
    if (!result.page || !result.checkpoint) {
      throw new Error('A direct-chat V2 page result requires page and checkpoint provenance.');
    }
    const currentCheckpointMessageId = previous.checkpointsByScope[scopeKey]?.lastMessageId ?? '0';
    if (
      !result.reorged &&
      result.page.expectedPreviousMessageId.toString() !== currentCheckpointMessageId
    ) {
      throw new Error('Direct-chat V2 page was produced from a stale history checkpoint.');
    }
    if (result.page.lastMessageId.toString() !== result.checkpoint.lastMessageId) {
      throw new Error('Direct-chat V2 page and checkpoint message IDs do not match.');
    }
  }

  const messagesByContact = result.mutation
    ? applyDirectChatV2SyncMutation(previous.messagesByContact, result.mutation)
    : previous.messagesByContact;
  const checkpointsByScope: Record<string, DirectChatV2HistoryCheckpoint> = {
    ...previous.checkpointsByScope
  };
  const revisionsByScope: Record<string, number> = {
    ...previous.revisionsByScope
  };
  delete checkpointsByScope[scopeKey];

  const backedCheckpoint = selectDirectChatV2MemoryBackedCheckpoint({
    checkpoint: result.checkpoint,
    messagesByContact,
    scope,
    walletAddress
  });
  if (backedCheckpoint) checkpointsByScope[scopeKey] = backedCheckpoint;

  if (result.reorged) {
    const nextRevision = currentRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new Error('Direct-chat V2 history-memory revision is exhausted.');
    }
    revisionsByScope[scopeKey] = nextRevision;
  }

  return { messagesByContact, checkpointsByScope, revisionsByScope };
};
