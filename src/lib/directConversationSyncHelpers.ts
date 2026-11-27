import {
  normalizeMessagesByContact,
  type ChatMessage,
  type HistoryEntry
} from './appShared';

export const historyEntryToChatMessage = (
  entry: HistoryEntry,
  requestedWalletAddress: string
): ChatMessage => ({
  id: entry.id,
  direction: entry.direction,
  text: entry.text,
  senderAddress: entry.direction === 'outgoing' ? entry.accountAddress ?? requestedWalletAddress : entry.contact,
  accountAddress: entry.accountAddress ?? requestedWalletAddress,
  accountRole: entry.accountRole,
  replyToMessageId: entry.replyToMessageId,
  replyToMessageAnchor: entry.replyToMessageAnchor,
  replyToText: entry.replyToText,
  replyToTxHash: entry.replyToTxHash,
  replyToBlockNumber: entry.replyToBlockNumber,
  replyToLogIndex: entry.replyToLogIndex,
  reactionToTxHash: entry.reactionToTxHash,
  reactionToBlockNumber: entry.reactionToBlockNumber,
  reactionToLogIndex: entry.reactionToLogIndex,
  reactionEmoji: entry.reactionEmoji,
  tradeReference: entry.tradeReference,
  timestamp: entry.timestamp,
  blockNumber: entry.blockNumber,
  logIndex: entry.logIndex,
  txHash: entry.txHash,
  directV2: entry.directV2
});

const isSubmittedLocalDirectMessage = (message: ChatMessage): boolean =>
  message.id.startsWith('local-direct-v2-') &&
  message.deliveryState === 'submitted' &&
  !message.directV2 &&
  typeof message.txHash === 'string' &&
  message.txHash.length > 0;

/**
 * Merges confirmed history entries by stable message ID. Optimistic outgoing
 * messages are not matched by content here; V2 replaces them through the
 * receipt-authenticated update in directChatV2WriteCoordinator. A 'submitted'
 * local copy (broadcast, receipt unknown) is removed only when history holds an
 * outgoing entry with the same transaction hash.
 */
export const mergeDirectHistoryEntries = (
  previous: Record<string, ChatMessage[]>,
  entriesInput: HistoryEntry[],
  requestedWalletAddress: string
): Record<string, ChatMessage[]> => {
  if (entriesInput.length === 0) {
    return previous;
  }

  const entries = [...entriesInput].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.logIndex - right.logIndex;
  });
  const next: Record<string, ChatMessage[]> = { ...previous };
  const confirmedOutgoingTxHashesByContact = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.direction !== 'outgoing' || !entry.txHash) continue;
    const key = entry.contact.toLowerCase();
    const hashes = confirmedOutgoingTxHashesByContact.get(key) ?? new Set<string>();
    hashes.add(entry.txHash.toLowerCase());
    confirmedOutgoingTxHashesByContact.set(key, hashes);
  }
  for (const [key, hashes] of confirmedOutgoingTxHashesByContact) {
    const existing = next[key];
    if (!existing) continue;
    const pruned = existing.filter((message) =>
      !isSubmittedLocalDirectMessage(message) || !hashes.has((message.txHash ?? '').toLowerCase())
    );
    if (pruned.length !== existing.length) next[key] = pruned;
  }
  const existingIdsByContact = new Map<string, Set<string>>();

  for (const entry of entries) {
    const key = entry.contact.toLowerCase();
    const existing = next[key] ?? [];
    let existingIds = existingIdsByContact.get(key);
    if (!existingIds) {
      existingIds = new Set(existing.map((message) => message.id));
      existingIdsByContact.set(key, existingIds);
    }

    const confirmedMessage = historyEntryToChatMessage(entry, requestedWalletAddress);

    if (existingIds.has(entry.id)) {
      next[key] = existing.map((message) =>
        message.id === entry.id
          ? {
              ...message,
              ...confirmedMessage,
              deliveryState: undefined
            }
          : message
      );
      continue;
    }

    existingIds.add(entry.id);
    next[key] = [...existing, confirmedMessage];
  }

  return normalizeMessagesByContact(next);
};
