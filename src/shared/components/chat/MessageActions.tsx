import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { FilePenLine, LoaderCircle, MessageCircleReply, SmilePlus } from 'lucide-react';
import { DEFAULT_REACTION_EMOJIS, type ChatMessage } from '../../../lib/appShared';

type MessageActionsProps = {
  message: ChatMessage;
  pickerOpen: boolean;
  reactedEmojiSet: Set<string>;
  sendingReaction: boolean;
  reactionDisabled: boolean;
  reactionTitle: string;
  draftTradeDisabled?: boolean;
  draftTradeLoading?: boolean;
  draftTradeTitle?: string;
  replyDisabled: boolean;
  replyTitle: string;
  onDraftTradeFromMessage?: (message: ChatMessage) => void;
  onToggleReactionPicker: (messageId: string) => void;
  onSendReaction: (targetMessage: ChatMessage, emojiInput: string) => Promise<void>;
  onReplyToMessage: (message: ChatMessage) => void;
};

export default function MessageActions({
  message,
  pickerOpen,
  reactedEmojiSet,
  sendingReaction,
  reactionDisabled,
  reactionTitle,
  draftTradeDisabled = false,
  draftTradeLoading = false,
  draftTradeTitle = 'Draft trade',
  replyDisabled,
  replyTitle,
  onDraftTradeFromMessage,
  onToggleReactionPicker,
  onSendReaction,
  onReplyToMessage
}: MessageActionsProps) {
  const pickerId = useId();
  const reactionButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const closePicker = useCallback(() => {
    if (!pickerOpen) {
      return;
    }
    onToggleReactionPicker(message.id);
    window.requestAnimationFrame(() => reactionButtonRef.current?.focus());
  }, [message.id, onToggleReactionPicker, pickerOpen]);

  const handlePickerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableButtons = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      );
      if (focusableButtons.length === 0) {
        return;
      }

      const firstButton = focusableButtons[0];
      const lastButton = focusableButtons[focusableButtons.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstButton) {
        event.preventDefault();
        lastButton.focus();
      } else if (!event.shiftKey && activeElement === lastButton) {
        event.preventDefault();
        firstButton.focus();
      }
    },
    [closePicker]
  );

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    pickerRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [pickerOpen]);

  return (
    <>
      <button
        ref={reactionButtonRef}
        type="button"
        className="message-react-action"
        onClick={() => onToggleReactionPicker(message.id)}
        aria-controls={pickerOpen ? pickerId : undefined}
        aria-expanded={pickerOpen}
        aria-label="React to this message"
        title={reactionTitle}
        disabled={reactionDisabled}
      >
        <SmilePlus aria-hidden="true" size={15} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        className="message-reply-action"
        onClick={() => onReplyToMessage(message)}
        aria-label="Reply to this message"
        title={replyTitle}
        disabled={replyDisabled}
      >
        <MessageCircleReply aria-hidden="true" size={15} strokeWidth={2.25} />
      </button>
      {onDraftTradeFromMessage ? (
        <button
          type="button"
          className={draftTradeLoading ? 'message-draft-trade-action loading' : 'message-draft-trade-action'}
          onClick={() => onDraftTradeFromMessage(message)}
          aria-busy={draftTradeLoading}
          aria-label={draftTradeLoading ? 'Drafting trade from this message' : 'Draft trade from this message'}
          title={draftTradeTitle}
          disabled={draftTradeDisabled}
        >
          {draftTradeLoading ? (
            <LoaderCircle aria-hidden="true" size={15} strokeWidth={2.25} />
          ) : (
            <FilePenLine aria-hidden="true" size={15} strokeWidth={2.25} />
          )}
        </button>
      ) : null}
      {pickerOpen ? (
        <div
          ref={pickerRef}
          id={pickerId}
          className="message-reaction-picker"
          role="dialog"
          aria-label="Pick reaction"
          onKeyDown={handlePickerKeyDown}
        >
          {DEFAULT_REACTION_EMOJIS.map((emoji) => (
            <button
              key={`${message.id}-${emoji}`}
              type="button"
              onClick={() => {
                onSendReaction(message, emoji).catch(() => {});
              }}
              disabled={sendingReaction || reactedEmojiSet.has(emoji)}
              title={reactedEmojiSet.has(emoji) ? `Already reacted with ${emoji}` : `React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
