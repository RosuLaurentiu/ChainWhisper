import type { ChatMessage } from './appShared';
import {
  chatReactionStableTargetKey,
  type ChatReactionObservation,
  type ChatReactionSource
} from './chatReactionsV1';

export type ChatReactionSummary = Readonly<{
  emoji: string;
  count: number;
  reactedByMe: boolean;
}>;

export const getChatReactionWriteSourceForMessage = (
  message: ChatMessage
): ChatReactionSource | null => {
  if (message.directV2) {
    return Object.freeze({
      kind: 'direct',
      chainId: message.directV2.chainId,
      contractAddress: message.directV2.contractAddress,
      conversationId: message.directV2.conversationId,
      messageId: message.directV2.messageId,
      blockHash: message.directV2.blockHash,
      transactionHash: message.directV2.transactionHash,
      logIndex: message.directV2.logIndex
    });
  }
  if (message.groupV2) {
    return Object.freeze({
      kind: 'group',
      chainId: message.groupV2.chainId,
      contractAddress: message.groupV2.contractAddress,
      groupId: message.groupV2.groupId,
      messageId: message.groupV2.messageId,
      blockHash: message.groupV2.blockHash,
      transactionHash: message.groupV2.transactionHash,
      logIndex: message.groupV2.logIndex
    });
  }
  return null;
};

export const getChatReactionSourceForMessage = (
  message: ChatMessage
): ChatReactionSource | null => {
  if (
    message.directV2?.finality !== 'finalized' &&
    message.groupV2?.finality !== 'finalized'
  ) {
    return null;
  }
  return getChatReactionWriteSourceForMessage(message);
};

export const getChatReactionMessageKey = (message: ChatMessage): string | null => {
  const source = getChatReactionWriteSourceForMessage(message);
  return source ? chatReactionStableTargetKey(source) : null;
};

export const retainPendingChatReactionStates = ({
  pendingStates,
  finalizedSources,
  safeHeadBlock
}: Readonly<{
  pendingStates: ReadonlyMap<string, ChatReactionObservation>;
  finalizedSources: readonly ChatReactionSource[];
  safeHeadBlock: string;
}>): ReadonlyMap<string, ChatReactionObservation> => {
  if (pendingStates.size === 0) return pendingStates;
  const finalizedTargetKeys = new Set(finalizedSources.map(chatReactionStableTargetKey));
  const safeHead = BigInt(safeHeadBlock);
  const next = new Map(pendingStates);
  for (const [key, pending] of next.entries()) {
    if (
      BigInt(pending.blockNumber) <= safeHead &&
      finalizedTargetKeys.has(chatReactionStableTargetKey(pending))
    ) {
      next.delete(key);
    }
  }
  return next.size === pendingStates.size ? pendingStates : next;
};

export const collectChatReactionSources = (
  messages: readonly ChatMessage[]
): readonly ChatReactionSource[] => {
  const sources = new Map<string, ChatReactionSource>();
  for (const message of messages) {
    const source = getChatReactionSourceForMessage(message);
    if (!source) continue;
    const key = chatReactionStableTargetKey(source);
    const previous = sources.get(key);
    if (previous && (
      previous.blockHash !== source.blockHash ||
      previous.transactionHash !== source.transactionHash ||
      previous.logIndex !== source.logIndex
    )) {
      throw new Error('Finalized chat messages contain conflicting canonical source anchors.');
    }
    sources.set(key, source);
  }
  return Object.freeze([...sources.values()]);
};

export const summarizeChatReactionsV1 = (
  states: readonly ChatReactionObservation[],
  walletAddress: string
): ReadonlyMap<string, readonly ChatReactionSummary[]> => {
  const ownAddress = walletAddress.trim().toLowerCase();
  const byTarget = new Map<string, Map<string, Set<string>>>();
  for (const state of states) {
    if (!state.active) continue;
    const targetKey = chatReactionStableTargetKey(state);
    let byEmoji = byTarget.get(targetKey);
    if (!byEmoji) {
      byEmoji = new Map();
      byTarget.set(targetKey, byEmoji);
    }
    let reactors = byEmoji.get(state.emoji);
    if (!reactors) {
      reactors = new Set();
      byEmoji.set(state.emoji, reactors);
    }
    reactors.add(state.reactor.toLowerCase());
  }
  const result = new Map<string, readonly ChatReactionSummary[]>();
  for (const [targetKey, byEmoji] of byTarget.entries()) {
    result.set(targetKey, Object.freeze([...byEmoji.entries()]
      .map(([emoji, reactors]) => Object.freeze({
        emoji,
        count: reactors.size,
        reactedByMe: ownAddress.length > 0 && reactors.has(ownAddress)
      }))
      .sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))));
  }
  return result;
};
