import {
  sortMessagesChronologically,
  type ChatMessage,
  type GroupMessageEntry
} from './appShared';

export const mergeGroupMessageEntries = (
  existing: ChatMessage[],
  entries: GroupMessageEntry[]
): ChatMessage[] => {
  const confirmedOutgoingTxHashes = new Set(
    entries
      .filter((entry) => entry.direction === 'outgoing')
      .map((entry) => entry.txHash.toLowerCase())
  );
  const prunedExisting = existing.filter((message) => {
    if (!message.id.startsWith('local-group-')) {
      return true;
    }
    if (!message.txHash) {
      return true;
    }
    return !confirmedOutgoingTxHashes.has(message.txHash.toLowerCase());
  });

  const nextMessages = [...prunedExisting];
  const existingIds = new Set(nextMessages.map((message) => message.id));
  for (const entry of entries) {
    if (existingIds.has(entry.id)) {
      if (entry.groupV2) {
        const existingIndex = nextMessages.findIndex((message) => message.id === entry.id);
        const existingMessage = nextMessages[existingIndex];
        if (existingMessage?.groupV2) {
          if (
            existingMessage.groupV2.blockHash !== entry.groupV2.blockHash ||
            existingMessage.groupV2.transactionHash !== entry.groupV2.transactionHash ||
            existingMessage.groupV2.logIndex !== entry.groupV2.logIndex
          ) {
            throw new Error('Group V2 message finality update conflicts with its canonical source log.');
          }
          nextMessages[existingIndex] = {
            ...existingMessage,
            text: entry.text,
            senderAddress: entry.senderAddress,
            accountAddress: entry.accountAddress,
            accountRole: entry.accountRole,
            replyToMessageId: entry.replyToMessageId,
            replyToMessageAnchor: entry.replyToMessageAnchor,
            replyToText: entry.replyToText,
            tradeReference: entry.tradeReference,
            timestamp: entry.timestamp,
            blockNumber: entry.blockNumber,
            logIndex: entry.logIndex,
            txHash: entry.txHash,
            groupV2: entry.groupV2,
            deliveryState: undefined
          };
        }
      }
      continue;
    }

    existingIds.add(entry.id);
    nextMessages.push({
      id: entry.id,
      direction: entry.direction,
      text: entry.text,
      senderAddress: entry.senderAddress,
      accountAddress: entry.accountAddress,
      accountRole: entry.accountRole,
      isSystem: entry.isSystem,
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
      groupV2: entry.groupV2
    });
  }

  return sortMessagesChronologically(nextMessages);
};
