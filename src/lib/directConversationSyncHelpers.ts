import { buildMessageReferenceKeys, messageReferencesMatch, type MessageReferenceCandidate } from './appHelpers';
import {
  isWalletAddress,
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
  senderAddress: entry.direction === 'outgoing' ? requestedWalletAddress : entry.contact,
  replyToMessageId: entry.replyToMessageId,
  replyToText: entry.replyToText,
  replyToTxHash: entry.replyToTxHash,
  replyToBlockNumber: entry.replyToBlockNumber,
  replyToLogIndex: entry.replyToLogIndex,
  reactionToTxHash: entry.reactionToTxHash,
  reactionToBlockNumber: entry.reactionToBlockNumber,
  reactionToLogIndex: entry.reactionToLogIndex,
  reactionEmoji: entry.reactionEmoji,
  timestamp: entry.timestamp,
  blockNumber: entry.blockNumber,
  logIndex: entry.logIndex,
  txHash: entry.txHash
});

const findMatchingOptimisticOutgoingIndex = (
  existingMessages: ChatMessage[],
  entry: HistoryEntry
): number => {
  let matchedLocalIndex = -1;
  let matchedLocalScore = Number.MAX_SAFE_INTEGER;

  for (let index = 0; index < existingMessages.length; index += 1) {
    const candidate = existingMessages[index];
    if (
      !candidate.id.startsWith('local-') ||
      candidate.direction !== 'outgoing' ||
      candidate.text !== entry.text ||
      (candidate.replyToText ?? '') !== (entry.replyToText ?? '') ||
      !optimisticReferencesMatch(
        {
          txHash: candidate.replyToTxHash,
          blockNumber: candidate.replyToBlockNumber,
          logIndex: candidate.replyToLogIndex
        },
        {
          txHash: entry.replyToTxHash,
          blockNumber: entry.replyToBlockNumber,
          logIndex: entry.replyToLogIndex
        }
      ) ||
      !optimisticReferencesMatch(
        {
          txHash: candidate.reactionToTxHash,
          blockNumber: candidate.reactionToBlockNumber,
          logIndex: candidate.reactionToLogIndex
        },
        {
          txHash: entry.reactionToTxHash,
          blockNumber: entry.reactionToBlockNumber,
          logIndex: entry.reactionToLogIndex
        }
      ) ||
      (candidate.reactionEmoji ?? '') !== (entry.reactionEmoji ?? '')
    ) {
      continue;
    }

    const isOptimisticCandidate =
      candidate.deliveryState === 'pending' ||
      candidate.deliveryState === 'sent' ||
      candidate.deliveryState === 'failed';
    if (!isOptimisticCandidate) {
      continue;
    }

    const candidateTimestamp = typeof candidate.timestamp === 'number' ? candidate.timestamp : undefined;
    const entryTimestamp = typeof entry.timestamp === 'number' ? entry.timestamp : undefined;
    if (typeof candidateTimestamp === 'number' && typeof entryTimestamp === 'number') {
      const diff = Math.abs(candidateTimestamp - entryTimestamp);
      if (diff > 180) {
        continue;
      }
      if (diff < matchedLocalScore) {
        matchedLocalScore = diff;
        matchedLocalIndex = index;
      }
      continue;
    }

    if (matchedLocalIndex === -1) {
      matchedLocalIndex = index;
    }
  }

  return matchedLocalIndex;
};

const optimisticReferencesMatch = (
  left: MessageReferenceCandidate,
  right: MessageReferenceCandidate
): boolean => {
  const leftKeys = buildMessageReferenceKeys(left);
  const rightKeys = buildMessageReferenceKeys(right);
  if (leftKeys.length === 0 && rightKeys.length === 0) {
    return true;
  }
  return messageReferencesMatch(left, right);
};

export const mergeDirectHistoryEntries = (
  previous: Record<string, ChatMessage[]>,
  entriesInput: HistoryEntry[],
  requestedWalletAddress: string,
  options?: { pruneOptimisticOutgoing?: boolean }
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
  const shouldPruneOptimisticOutgoing = options?.pruneOptimisticOutgoing ?? true;
  const next: Record<string, ChatMessage[]> = { ...previous };
  const existingIdsByContact = new Map<string, Set<string>>();
  const prunedOptimisticByContact = new Set<string>();
  const confirmedOutgoingTxHashesByContact = new Map<string, Set<string>>();

  if (shouldPruneOptimisticOutgoing) {
    for (const entry of entries) {
      if (entry.direction !== 'outgoing' || !entry.txHash) {
        continue;
      }

      const key = entry.contact.toLowerCase();
      const existingHashes = confirmedOutgoingTxHashesByContact.get(key);
      if (existingHashes) {
        existingHashes.add(entry.txHash.toLowerCase());
        continue;
      }

      confirmedOutgoingTxHashesByContact.set(key, new Set([entry.txHash.toLowerCase()]));
    }
  }

  for (const entry of entries) {
    const key = entry.contact.toLowerCase();
    if (shouldPruneOptimisticOutgoing && !prunedOptimisticByContact.has(key)) {
      const confirmedHashes = confirmedOutgoingTxHashesByContact.get(key);
      if (confirmedHashes && confirmedHashes.size > 0) {
        next[key] = (next[key] ?? []).filter((message) => {
          if (!message.txHash) {
            return true;
          }

          const isOptimistic =
            message.deliveryState === 'pending' ||
            message.deliveryState === 'sent' ||
            message.deliveryState === 'failed';

          if (!isOptimistic) {
            return true;
          }

          return !confirmedHashes.has(message.txHash.toLowerCase());
        });
      }

      prunedOptimisticByContact.add(key);
    }

    if (shouldPruneOptimisticOutgoing && entry.direction === 'outgoing') {
      const existingForDedupe = next[key] ?? [];
      const matchedLocalIndex = findMatchingOptimisticOutgoingIndex(existingForDedupe, entry);

      if (matchedLocalIndex >= 0) {
        const pruned = [...existingForDedupe];
        pruned.splice(matchedLocalIndex, 1);
        next[key] = pruned;
      }
    }

    const existing = next[key] ?? [];
    let existingIds = existingIdsByContact.get(key);
    if (!existingIds) {
      existingIds = new Set(existing.map((message) => message.id));
      existingIdsByContact.set(key, existingIds);
    }

    if (existingIds.has(entry.id)) {
      continue;
    }

    existingIds.add(entry.id);
    next[key] = [...existing, historyEntryToChatMessage(entry, requestedWalletAddress)];
  }

  return normalizeMessagesByContact(next);
};

export type DirectUnreadResolution = {
  nextReadByContact: Record<string, number>;
  nextUnread: Record<string, boolean>;
  readByContactChanged: boolean;
  unreadChanged: boolean;
};

export const resolveDirectUnreadState = ({
  activeKey,
  candidateAddresses,
  globalReadTs,
  latestMessageTimeByContact,
  pageVisible,
  previousReadByContact,
  previousUnread,
  suppressedKeys,
  walletKey
}: {
  activeKey?: string;
  candidateAddresses: string[];
  globalReadTs: number;
  latestMessageTimeByContact: Map<string, number>;
  pageVisible: boolean;
  previousReadByContact: Record<string, number>;
  previousUnread: Record<string, boolean>;
  suppressedKeys: Set<string>;
  walletKey: string;
}): DirectUnreadResolution => {
  const unreadCandidateAddresses = candidateAddresses
    .map((address) => address.trim().toLowerCase())
    .filter((address) => isWalletAddress(address) && address !== walletKey);
  const candidateSet = new Set(unreadCandidateAddresses);
  const nextReadByContact = { ...previousReadByContact };
  let readByContactChanged = false;
  const nextUnread = { ...previousUnread };
  let unreadChanged = false;

  for (const address of unreadCandidateAddresses) {
    const latestMessageTime = latestMessageTimeByContact.get(address) ?? 0;
    if (address === activeKey && pageVisible && latestMessageTime > 0) {
      const existingReadTs = nextReadByContact[address] ?? 0;
      if (latestMessageTime > existingReadTs) {
        nextReadByContact[address] = latestMessageTime;
        readByContactChanged = true;
      }
    }

    const contactReadTs = nextReadByContact[address] ?? 0;
    const effectiveReadTs = Math.max(globalReadTs, contactReadTs);
    const shouldUnread =
      !suppressedKeys.has(address) &&
      latestMessageTime > effectiveReadTs &&
      !(address === activeKey && pageVisible);
    if (shouldUnread) {
      if (!nextUnread[address]) {
        nextUnread[address] = true;
        unreadChanged = true;
      }
    } else if (nextUnread[address]) {
      delete nextUnread[address];
      unreadChanged = true;
    }
  }

  for (const existingKey of Object.keys(nextUnread)) {
    if (!candidateSet.has(existingKey)) {
      delete nextUnread[existingKey];
      unreadChanged = true;
    }
  }

  return {
    nextReadByContact,
    nextUnread,
    readByContactChanged,
    unreadChanged
  };
};
