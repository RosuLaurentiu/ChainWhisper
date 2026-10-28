import { getOnChainFailureMessage } from '../../../lib/appHelpers';
import type { ChatReactionSource } from '../../../lib/chatReactionsV1';
import type { ChatReactionWriteResult } from '../../../lib/chatReactionsV1Actions';
import { getChatReactionWriteSourceForMessage } from '../../../lib/chatReactionsV1Messages';
import {
  normalizeReactionEmoji,
  type ChatMessage,
  type SignerSource
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

type UseMessageReactionActionsArgs = {
  activeSignerSource: SignerSource;
  getReactionsForMessage: (message: ChatMessage) => ReactionSummary[];
  sendingReaction: boolean;
  setError: (next: string) => void;
  setReactionPickerMessageId: StateSetter<string | null>;
  setSendingReaction: StateSetter<boolean>;
  unavailableReason?: string | null;
  submitChatReactionV1: ((input: Readonly<{
    source: ChatReactionSource;
    emoji: string;
    active: boolean;
    operationId: string;
  }>) => Promise<ChatReactionWriteResult>) | null;
};

/**
 * Reactions are V1 event writes over confirmed, source-anchored Direct/Group V2 messages.
 * Canonical reaction history remains finalized separately by the reaction indexer.
 * Legacy reaction memos remain readable through history parsers, but are never writable.
 */
export default function useMessageReactionActions({
  activeSignerSource,
  getReactionsForMessage,
  sendingReaction,
  setError,
  setReactionPickerMessageId,
  setSendingReaction,
  unavailableReason,
  submitChatReactionV1
}: UseMessageReactionActionsArgs) {
  let reactionInFlight = false;
  const sendReactionToMessage = async (targetMessage: ChatMessage, emojiInput: string) => {
    setError('');
    if (sendingReaction || reactionInFlight) return;

    const normalizedEmoji = normalizeReactionEmoji(emojiInput);
    if (!normalizedEmoji) {
      setError('Choose a valid emoji reaction.');
      return;
    }

    const source = getChatReactionWriteSourceForMessage(targetMessage);
    if (!source) {
      setError('Legacy chat reactions are read-only after the V2 cutover.');
      return;
    }
    if (activeSignerSource !== 'metamask' || !submitChatReactionV1) {
      setError(unavailableReason?.trim() || 'Public reactions are not active for this chat deployment yet.');
      return;
    }

    const active = !getReactionsForMessage(targetMessage).some(
      (reaction) => reaction.emoji === normalizedEmoji && reaction.reactedByMe
    );
    try {
      reactionInFlight = true;
      setSendingReaction(true);
      setReactionPickerMessageId(null);
      await submitChatReactionV1({
        source,
        emoji: normalizedEmoji,
        active,
        operationId: globalThis.crypto?.randomUUID?.() ??
          `reaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      });
    } catch (reactionError) {
      setError(getOnChainFailureMessage(
        reactionError,
        'Failed to update reaction.'
      ));
    } finally {
      reactionInFlight = false;
      setSendingReaction(false);
    }
  };

  return { sendReactionToMessage };
}
