import type { ChatMessage } from './appShared';
import { deriveChatReactionSourceAnchor } from './chatReactionsV1';
import { getChatReactionWriteSourceForMessage } from './chatReactionsV1Messages';

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export const normalizeChatReplySourceAnchor = (value: string): string => {
  if (!BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error('Chat reply source anchor must be non-zero bytes32.');
  }
  return value.toLowerCase();
};

export const getChatReplySourceAnchor = (message: ChatMessage): string | null => {
  const source = getChatReactionWriteSourceForMessage(message);
  return source ? deriveChatReactionSourceAnchor(source) : null;
};

export const chatReplyTargetMatchesAnchor = ({
  replyToMessageId,
  replyToMessageAnchor,
  candidate
}: Readonly<{
  replyToMessageId?: string;
  replyToMessageAnchor?: string;
  candidate: ChatMessage;
}>): boolean => {
  if (!replyToMessageId || candidate.id !== replyToMessageId) return false;
  if (!replyToMessageAnchor) return true;
  const candidateAnchor = getChatReplySourceAnchor(candidate);
  return candidateAnchor !== null && candidateAnchor === normalizeChatReplySourceAnchor(replyToMessageAnchor);
};
