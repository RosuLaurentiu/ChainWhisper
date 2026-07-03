import { useCallback, useMemo } from 'react';
import {
  buildMessageReferenceKey,
  buildMessageReferenceKeys
} from '../../../lib/appHelpers';
import {
  ChatMessage,
  isWalletAddress,
  normalizeReactionEmoji
} from '../../../lib/appShared';

type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

type UseMessageReactionsArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  activeThreadMessages: ChatMessage[];
  walletAddress: string;
};

export default function useMessageReactions({
  activeContact,
  activeGroupId,
  activeThreadMessages,
  walletAddress
}: UseMessageReactionsArgs) {
  const activeThreadMessageReferenceLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const message of activeThreadMessages) {
      const canonicalKey = buildMessageReferenceKey({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      });
      if (!canonicalKey) {
        continue;
      }

      for (const key of buildMessageReferenceKeys({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      })) {
        if (!lookup.has(key)) {
          lookup.set(key, canonicalKey);
        }
      }
    }

    return lookup;
  }, [activeThreadMessages]);

  const isReactionOnlyMessage = useCallback(
    (message: ChatMessage): boolean =>
      Boolean(
        !message.isSystem &&
          buildMessageReferenceKey({
            txHash: message.reactionToTxHash,
            blockNumber: message.reactionToBlockNumber,
            logIndex: message.reactionToLogIndex
          }) &&
          message.reactionEmoji &&
          (message.text ?? '').trim().length === 0
      ),
    []
  );

  const activeThreadReactions = useMemo(() => {
    const ownAddress = walletAddress.trim().toLowerCase();
    const peerAddress = activeContact?.trim().toLowerCase() ?? '';
    const byTarget = new Map<string, Map<string, Set<string>>>();

    for (const message of activeThreadMessages) {
      if (message.deliveryState === 'failed') {
        continue;
      }

      const targetReferenceKeyCandidates = buildMessageReferenceKeys({
        txHash: message.reactionToTxHash,
        blockNumber: message.reactionToBlockNumber,
        logIndex: message.reactionToLogIndex
      });
      const targetReferenceKey =
        targetReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
        targetReferenceKeyCandidates[0] ??
        '';
      const normalizedEmoji = normalizeReactionEmoji(message.reactionEmoji ?? '');
      if (!targetReferenceKey || !normalizedEmoji) {
        continue;
      }

      let reactorKey = '';
      const senderAddress = message.senderAddress?.trim().toLowerCase() ?? '';
      if (isWalletAddress(senderAddress)) {
        reactorKey = senderAddress;
      } else if (activeGroupId === null) {
        const fallbackDirectSender = message.direction === 'outgoing' ? ownAddress : peerAddress;
        if (isWalletAddress(fallbackDirectSender)) {
          reactorKey = fallbackDirectSender;
        }
      }

      if (!reactorKey) {
        reactorKey = `${message.direction}:${message.id}`;
      }

      let byEmoji = byTarget.get(targetReferenceKey);
      if (!byEmoji) {
        byEmoji = new Map<string, Set<string>>();
        byTarget.set(targetReferenceKey, byEmoji);
      }

      let reactors = byEmoji.get(normalizedEmoji);
      if (!reactors) {
        reactors = new Set<string>();
        byEmoji.set(normalizedEmoji, reactors);
      }

      reactors.add(reactorKey);
    }

    const summarized = new Map<string, MessageReactionSummary[]>();
    for (const [targetTxHash, byEmoji] of byTarget.entries()) {
      const rows = Array.from(byEmoji.entries())
        .map(([emoji, reactors]) => ({
          emoji,
          count: reactors.size,
          reactedByMe: ownAddress.length > 0 && reactors.has(ownAddress)
        }))
        .sort((left, right) => {
          if (left.count !== right.count) {
            return right.count - left.count;
          }
          return left.emoji.localeCompare(right.emoji);
        });

      summarized.set(targetTxHash, rows);
    }

    return summarized;
  }, [activeThreadMessages, activeContact, activeGroupId, activeThreadMessageReferenceLookup, walletAddress]);

  const getReactionsForMessage = useCallback(
    (message: ChatMessage): MessageReactionSummary[] => {
      const messageReferenceKeyCandidates = buildMessageReferenceKeys({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      });
      const messageReferenceKey =
        messageReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
        messageReferenceKeyCandidates[0] ??
        '';
      if (!messageReferenceKey) {
        return [];
      }

      return activeThreadReactions.get(messageReferenceKey) ?? [];
    },
    [activeThreadMessageReferenceLookup, activeThreadReactions]
  );

  return {
    activeThreadMessageReferenceLookup,
    activeThreadReactions,
    getReactionsForMessage,
    isReactionOnlyMessage
  };
}
