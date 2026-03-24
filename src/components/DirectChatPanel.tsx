import type { MutableRefObject, ReactNode, Ref } from 'react';
import DirectChatCompose from './DirectChatCompose';
import ChatImage from './ChatImage';
import TradeOfferCard from './TradeOfferCard';
import { parseImageTag } from '../lib/imagePull';
import {
  DEFAULT_REACTION_EMOJIS,
  formatMessageTimestamp,
  getMessageDisplayText,
  parseTradeOfferMessagePayload,
  shortenAddress,
  type ChatMessage,
  type Contact,
  type TipTokenSelection,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';

type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

type DirectChatPanelProps = {
  activeContact: string;
  activeContactMeta?: Contact;
  isSelfChat: boolean;
  activeConversationMuted: boolean;
  activeConversationHidden: boolean;
  activeConversationStateSyncPending: boolean;
  onToggleConversationMute: () => void;
  onLoadFullConversationHistory: () => void;
  syncingHistory: boolean;
  chatMessagesRef: Ref<HTMLDivElement>;
  markConversationAsRead: (contactAddress?: string | null) => void;
  loadingOlderHistory: boolean;
  activeMessages: ChatMessage[];
  isReactionOnlyMessage: (message: ChatMessage) => boolean;
  reactionPickerMessageId: string | null;
  onToggleReactionPicker: (messageId: string) => void;
  sendingReaction: boolean;
  onSendReaction: (targetMessage: ChatMessage, emojiInput: string) => Promise<void>;
  onReplyToMessage: (message: ChatMessage) => void;
  replyingToMessage: ChatMessage | null;
  highlightedMessageId: string | null;
  messageElementRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  getReactionsForMessage: (message: ChatMessage) => MessageReactionSummary[];
  onJumpToReferencedMessage: (
    replyToMessageId?: string,
    replyToText?: string,
    replyToTxHash?: string,
    replyToBlockNumber?: number,
    replyToLogIndex?: number
  ) => void;
  getReplyReferenceFallbackLabel: (message: ChatMessage) => string;
  tradeSnapshotsById: Record<string, TradeSnapshot>;
  walletAddress: string;
  processingTradeActionId: string;
  onAcceptTrade: (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => Promise<void>;
  onDeclineTrade: (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => Promise<void>;
  onCounterTrade: (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => Promise<void>;
  onCancelTrade: (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => Promise<void>;
  replyingPreviewText: string;
  onCancelReply: () => void;
  tipComposerOpen: boolean;
  onToggleTipComposer: () => void;
  tipping: boolean;
  tipTokenSelection: TipTokenSelection;
  onTipTokenSelectionChange: (selection: TipTokenSelection) => void;
  rewardTokenSymbol: string;
  privateRewardTokenSymbol: string;
  tipAmountInput: string;
  onTipAmountInputChange: (value: string) => void;
  activeTipTokenSymbol: string;
  tipAmountWeiFromInput: bigint;
  canSendTipFromComposer: boolean;
  tipAmountExceedsBalance: boolean;
  tipAmountSummaryLabel: string;
  tipBalanceSummaryLabel: string;
  onSendTip: () => void;
  tradeComposerOpen: boolean;
  tradeComposerContent?: ReactNode;
  onToggleTradeComposer: () => void;
  composerRef: Ref<HTMLDivElement>;
  isMobileNav: boolean;
  onSendMessage: () => void;
  maxMessageLength: number;
  onMessageInputChange: (value: string) => void;
  sending: boolean;
  tipToggleDisabled: boolean;
  tipToggleTitle: string;
  tradeToggleDisabled: boolean;
  tradeToggleTitle: string;
};

export default function DirectChatPanel({
  activeContact,
  activeContactMeta,
  isSelfChat,
  activeConversationMuted,
  activeConversationHidden,
  activeConversationStateSyncPending,
  onToggleConversationMute,
  onLoadFullConversationHistory,
  syncingHistory,
  chatMessagesRef,
  markConversationAsRead,
  loadingOlderHistory,
  activeMessages,
  isReactionOnlyMessage,
  reactionPickerMessageId,
  onToggleReactionPicker,
  sendingReaction,
  onSendReaction,
  onReplyToMessage,
  replyingToMessage,
  highlightedMessageId,
  messageElementRefs,
  getReactionsForMessage,
  onJumpToReferencedMessage,
  getReplyReferenceFallbackLabel,
  tradeSnapshotsById,
  walletAddress,
  processingTradeActionId,
  onAcceptTrade,
  onDeclineTrade,
  onCounterTrade,
  onCancelTrade,
  replyingPreviewText,
  onCancelReply,
  tipComposerOpen,
  onToggleTipComposer,
  tipping,
  tipTokenSelection,
  onTipTokenSelectionChange,
  rewardTokenSymbol,
  privateRewardTokenSymbol,
  tipAmountInput,
  onTipAmountInputChange,
  activeTipTokenSymbol,
  tipAmountWeiFromInput,
  canSendTipFromComposer,
  tipAmountExceedsBalance,
  tipAmountSummaryLabel,
  tipBalanceSummaryLabel,
  onSendTip,
  tradeComposerOpen,
  tradeComposerContent,
  onToggleTradeComposer,
  composerRef,
  isMobileNav,
  onSendMessage,
  maxMessageLength,
  onMessageInputChange,
  sending,
  tipToggleDisabled,
  tipToggleTitle,
  tradeToggleDisabled,
  tradeToggleTitle
}: DirectChatPanelProps) {
  const activeContactLabel = activeContactMeta?.name
    ? `${activeContactMeta.name} (${shortenAddress(activeContact)})`
    : shortenAddress(activeContact);

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <strong>{isSelfChat ? `${activeContactLabel} (self)` : activeContactLabel}</strong>
        <div className="chat-header-actions">
          {activeConversationMuted || activeConversationHidden ? (
            <span className="chat-header-state">
              {activeConversationMuted ? 'Muted' : null}
              {activeConversationMuted && activeConversationHidden ? ' | ' : null}
              {activeConversationHidden ? 'Hidden' : null}
            </span>
          ) : null}
          {activeConversationStateSyncPending ? (
            <span className="chat-header-sync" role="status" aria-live="polite" aria-label="Saving conversation">
              <span className="inline-spinner" aria-hidden="true" />
            </span>
          ) : null}
          {!isSelfChat ? (
            <button
              type="button"
              className="contact"
              onClick={onToggleConversationMute}
              disabled={activeConversationStateSyncPending}
              title={
                activeConversationStateSyncPending
                  ? 'Waiting for confirmation...'
                  : activeConversationMuted
                    ? 'Unmute conversation'
                    : 'Mute conversation'
              }
            >
              {activeConversationStateSyncPending ? 'Saving...' : activeConversationMuted ? 'Unmute' : 'Mute'}
            </button>
          ) : null}
          <button type="button" className="contact" onClick={onLoadFullConversationHistory} disabled={syncingHistory}>
            {syncingHistory ? 'Syncing...' : 'Sync History'}
          </button>
        </div>
      </div>

      <div className="chat-messages" ref={chatMessagesRef} onClick={() => markConversationAsRead(activeContact)}>
        {loadingOlderHistory ? <p className="chat-empty">Loading older messages...</p> : null}
        {!activeMessages.some((message) => !isReactionOnlyMessage(message)) ? (
          <p className="chat-empty">No messages yet.</p>
        ) : (
          activeMessages.map((message) => {
            if (isReactionOnlyMessage(message)) {
              return null;
            }

            const parsedTradeOffer = parseTradeOfferMessagePayload(message.text);
            const messageDisplayText = getMessageDisplayText(message.text, message.direction);
            const parsedImageTag = parseImageTag(message.text);
            const messageReactions = getReactionsForMessage(message);
            const reactedEmojiSet = new Set(
              messageReactions.filter((reaction) => reaction.reactedByMe).map((reaction) => reaction.emoji)
            );
            const deliveryLabel =
              message.deliveryState === 'pending'
                ? 'Sending...'
                : message.deliveryState === 'sent'
                  ? 'Sent'
                  : message.deliveryState === 'failed'
                    ? 'Failed'
                    : '';

            return (
              <div
                key={message.id}
                className={message.direction === 'outgoing' ? 'message-row outgoing' : 'message-row incoming'}
              >
                <div
                  ref={(node) => {
                    messageElementRefs.current[message.id] = node;
                  }}
                  className={
                    highlightedMessageId === message.id
                      ? 'message-bubble highlighted'
                      : replyingToMessage?.id === message.id
                        ? 'message-bubble replying'
                        : 'message-bubble'
                  }
                >
                  <>
                    <button
                      type="button"
                      className="message-react-action"
                      onClick={() => onToggleReactionPicker(message.id)}
                      aria-label="React to this message"
                      title="React"
                      disabled={!message.txHash || sendingReaction}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="message-reply-action"
                      onClick={() => onReplyToMessage(message)}
                      aria-label="Reply to this message"
                      title="Reply"
                    >
                      R
                    </button>
                    {reactionPickerMessageId === message.id ? (
                      <div className="message-reaction-picker" role="dialog" aria-label="Pick reaction">
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
                  {message.replyToText || message.replyToTxHash || typeof message.replyToBlockNumber === 'number' ? (
                    <button
                      type="button"
                      className="message-reply"
                      onClick={() =>
                        onJumpToReferencedMessage(
                          message.replyToMessageId,
                          message.replyToText,
                          message.replyToTxHash,
                          message.replyToBlockNumber,
                          message.replyToLogIndex
                        )
                      }
                      title="Go to replied message"
                    >
                      {'\u21AA'} {getReplyReferenceFallbackLabel(message)}
                    </button>
                  ) : null}
                  {parsedTradeOffer ? (
                    <TradeOfferCard
                      offer={parsedTradeOffer}
                      snapshot={tradeSnapshotsById[String(parsedTradeOffer.tradeId)] ?? null}
                      currentWalletAddress={walletAddress}
                      actionPending={processingTradeActionId === String(parsedTradeOffer.tradeId)}
                      onAccept={() => {
                        onAcceptTrade(parsedTradeOffer, message).catch(() => {});
                      }}
                      onDecline={() => {
                        onDeclineTrade(parsedTradeOffer, message).catch(() => {});
                      }}
                      onCounter={() => {
                        onCounterTrade(parsedTradeOffer, message).catch(() => {});
                      }}
                      onCancel={() => {
                        onCancelTrade(parsedTradeOffer, message).catch(() => {});
                      }}
                    />
                  ) : parsedImageTag ? (
                    <ChatImage tag={message.text} parsed={parsedImageTag} />
                  ) : messageDisplayText ? (
                    <div>{messageDisplayText}</div>
                  ) : null}
                  {messageReactions.length > 0 ? (
                    <div className="message-reactions">
                      {messageReactions.map((reaction) => (
                        <button
                          key={`${message.id}-${reaction.emoji}`}
                          type="button"
                          className={reaction.reactedByMe ? 'message-reaction-chip active' : 'message-reaction-chip'}
                          onClick={() => {
                            onSendReaction(message, reaction.emoji).catch(() => {});
                          }}
                          disabled={!message.txHash || sendingReaction || reaction.reactedByMe}
                        >
                          <span>{reaction.emoji}</span>
                          <span>{reaction.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.timestamp || deliveryLabel ? (
                    <div className="message-meta">
                      {message.timestamp ? (
                        <span className="message-time">{formatMessageTimestamp(message.timestamp)}</span>
                      ) : null}
                      {deliveryLabel ? (
                        <span
                          className={
                            message.deliveryState === 'failed'
                              ? 'message-delivery failed'
                              : message.deliveryState === 'pending'
                                ? 'message-delivery pending'
                                : 'message-delivery sent'
                          }
                        >
                          {deliveryLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <DirectChatCompose
        replyPreviewText={replyingPreviewText}
        onCancelReply={onCancelReply}
        tipComposerOpen={tipComposerOpen}
        onToggleTipComposer={onToggleTipComposer}
        tipping={tipping}
        tipTokenSelection={tipTokenSelection}
        onTipTokenSelectionChange={onTipTokenSelectionChange}
        rewardTokenSymbol={rewardTokenSymbol}
        privateRewardTokenSymbol={privateRewardTokenSymbol}
        tipAmountInput={tipAmountInput}
        onTipAmountInputChange={onTipAmountInputChange}
        activeTipTokenSymbol={activeTipTokenSymbol}
        tipAmountWeiFromInput={tipAmountWeiFromInput}
        canSendTipFromComposer={canSendTipFromComposer}
        tipAmountExceedsBalance={tipAmountExceedsBalance}
        tipAmountSummaryLabel={tipAmountSummaryLabel}
        tipBalanceSummaryLabel={tipBalanceSummaryLabel}
        onSendTip={onSendTip}
        tradeComposerOpen={tradeComposerOpen}
        tradeComposerContent={tradeComposerContent}
        onToggleTradeComposer={onToggleTradeComposer}
        composerRef={composerRef}
        isMobileNav={isMobileNav}
        onSendMessage={onSendMessage}
        maxMessageLength={maxMessageLength}
        onMessageInputChange={onMessageInputChange}
        sending={sending}
        tipToggleDisabled={tipToggleDisabled}
        tipToggleTitle={tipToggleTitle}
        tradeToggleDisabled={tradeToggleDisabled}
        tradeToggleTitle={tradeToggleTitle}
      />
    </div>
  );
}
