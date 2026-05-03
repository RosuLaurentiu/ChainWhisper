import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type Ref } from 'react';
import DirectChatCompose from './DirectChatCompose';
import ChatImage from './ChatImage';
import MessageActions from './MessageActions';
import TradeOfferCard from './TradeOfferCard';
import type { ImageAttachmentPreviewState } from '../lib/imageAttachmentPreview';
import { parseImageTag } from '../lib/imagePull';
import useVirtualizedPrependScrollAnchor from '../hooks/useVirtualizedPrependScrollAnchor';
import {
  buildTradeSnapshotKey,
  formatMessageTimestamp,
  getMessageDisplayText,
  parseTradeOfferMessagePayload,
  parseTradeResponseMessagePayload,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  shortenAddress,
  type ChatMessage,
  type Contact,
  type TipTokenSelection,
  type TradeOfferMessagePayload,
  type TradeResponseMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';

type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

const MESSAGE_LINK_PATTERN = /(https?:\/\/[^\s<>"']+|\/trades\/l\/[^\s<>"']+)/gi;
const TRAILING_LINK_PUNCTUATION_PATTERN = /[),.!?;:]+$/;

const splitTrailingLinkPunctuation = (value: string): { linkText: string; trailingText: string } => {
  const trailingMatch = value.match(TRAILING_LINK_PUNCTUATION_PATTERN);
  if (!trailingMatch) {
    return { linkText: value, trailingText: '' };
  }

  const trailingText = trailingMatch[0];
  return {
    linkText: value.slice(0, -trailingText.length),
    trailingText
  };
};

const resolveMessageLinkHref = (value: string): { href: string; external: boolean } | null => {
  if (value.startsWith('/trades/l/')) {
    return { href: value, external: false };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    if (typeof window !== 'undefined' && url.origin === window.location.origin && url.pathname.startsWith('/trades/')) {
      return { href: `${url.pathname}${url.search}${url.hash}`, external: false };
    }

    return { href: url.toString(), external: true };
  } catch {
    return null;
  }
};

const isInChatTradeOffer = (offer: TradeOfferMessagePayload): boolean =>
  !offer.hiddenLiquidity &&
  offer.escrowContract.toLowerCase() !== PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

const DIRECT_MESSAGE_SKELETON_ROWS = [0, 1, 2, 3, 4];

const renderMessageTextWithLinks = (text: string): ReactNode => {
  const rendered: ReactNode[] = [];
  let lastIndex = 0;
  MESSAGE_LINK_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(MESSAGE_LINK_PATTERN)) {
    const rawMatch = match[0];
    const matchIndex = match.index ?? 0;
    const { linkText, trailingText } = splitTrailingLinkPunctuation(rawMatch);
    const link = resolveMessageLinkHref(linkText);
    if (!link || linkText.length === 0) {
      continue;
    }

    if (matchIndex > lastIndex) {
      rendered.push(text.slice(lastIndex, matchIndex));
    }
    rendered.push(
      <a
        key={`message-link-${matchIndex}-${linkText}`}
        className="message-text-link"
        href={link.href}
        target={link.external ? '_blank' : undefined}
        rel={link.external ? 'noreferrer' : undefined}
      >
        {linkText}
      </a>
    );
    if (trailingText) {
      rendered.push(trailingText);
    }
    lastIndex = matchIndex + rawMatch.length;
  }

  if (lastIndex === 0) {
    return text;
  }
  if (lastIndex < text.length) {
    rendered.push(text.slice(lastIndex));
  }

  return rendered;
};

type DirectChatPanelProps = {
  activeContact: string;
  activeContactMeta?: Contact;
  isSelfChat: boolean;
  activeConversationMuted: boolean;
  activeConversationHidden: boolean;
  activeConversationStateSyncPending: boolean;
  walletPromptSensitiveActionsDisabled: boolean;
  walletPromptSensitiveActionsTitle: string;
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
  onSendImage: (file: File) => void;
  uploadingImage: boolean;
  imageAttachmentStatus?: ImageAttachmentPreviewState | null;
  imageAttachDisabled: boolean;
  imageAttachTitle: string;
  onDismissImageAttachmentStatus: () => void;
  onSendMessage: () => void;
  maxMessageLength: number;
  onMessageInputChange: (value: string) => void;
  sending: boolean;
  tipToggleDisabled: boolean;
  tipToggleTitle: string;
  tradeToggleDisabled: boolean;
  tradeToggleTitle: string;
};

function DirectChatPanel({
  activeContact,
  activeContactMeta,
  isSelfChat,
  activeConversationMuted,
  activeConversationHidden,
  activeConversationStateSyncPending,
  walletPromptSensitiveActionsDisabled,
  walletPromptSensitiveActionsTitle,
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
  onSendImage,
  uploadingImage,
  imageAttachmentStatus,
  imageAttachDisabled,
  imageAttachTitle,
  onDismissImageAttachmentStatus,
  onSendMessage,
  maxMessageLength,
  onMessageInputChange,
  sending,
  tipToggleDisabled,
  tipToggleTitle,
  tradeToggleDisabled,
  tradeToggleTitle
}: DirectChatPanelProps) {
  const [tradeCardExpandedState, setTradeCardExpandedState] = useState<Record<string, boolean>>({});
  const chatMessagesNodeRef = useRef<HTMLDivElement | null>(null);
  const setChatMessagesNode = useCallback(
    (node: HTMLDivElement | null) => {
      chatMessagesNodeRef.current = node;
      if (typeof chatMessagesRef === 'function') {
        chatMessagesRef(node);
        return;
      }
      if (chatMessagesRef && 'current' in chatMessagesRef) {
        (chatMessagesRef as MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [chatMessagesRef]
  );
  const activeContactLabel = activeContactMeta?.name
    ? `${activeContactMeta.name} (${shortenAddress(activeContact)})`
    : shortenAddress(activeContact);
  const { visibleTradeOfferIds, latestTradeResponsesById, latestTradeId } = useMemo(() => {
    const nextVisibleTradeOfferIds = new Set<string>();
    const nextLatestTradeResponsesById: Record<string, TradeResponseMessagePayload> = {};
    let nextLatestTradeId = -1;

    for (const message of activeMessages) {
      const parsedTradeOffer = parseTradeOfferMessagePayload(message.text);
      const parsedTradeResponse = parseTradeResponseMessagePayload(message.text);

      if (parsedTradeOffer && isInChatTradeOffer(parsedTradeOffer)) {
        const tradeKey = buildTradeSnapshotKey(parsedTradeOffer.tradeId, parsedTradeOffer.escrowContract);
        nextVisibleTradeOfferIds.add(tradeKey);
        if (parsedTradeOffer.tradeId > nextLatestTradeId) {
          nextLatestTradeId = parsedTradeOffer.tradeId;
        }
      }

      if (parsedTradeResponse) {
        nextLatestTradeResponsesById[
          buildTradeSnapshotKey(parsedTradeResponse.tradeId, parsedTradeResponse.escrowContract)
        ] = parsedTradeResponse;
      }
    }

    return {
      visibleTradeOfferIds: nextVisibleTradeOfferIds,
      latestTradeResponsesById: nextLatestTradeResponsesById,
      latestTradeId: nextLatestTradeId
    };
  }, [activeMessages]);
  const renderableMessages = useMemo(
    () =>
      activeMessages.filter((message) => {
        if (isReactionOnlyMessage(message)) {
          return false;
        }

        const parsedTradeResponse = parseTradeResponseMessagePayload(message.text);
        return !(
          parsedTradeResponse &&
          (visibleTradeOfferIds.has(buildTradeSnapshotKey(parsedTradeResponse.tradeId, parsedTradeResponse.escrowContract)) ||
            (parsedTradeResponse.action === 'countered' &&
              typeof parsedTradeResponse.counterTradeId === 'number' &&
              visibleTradeOfferIds.has(buildTradeSnapshotKey(parsedTradeResponse.counterTradeId, parsedTradeResponse.escrowContract))))
        );
      }),
    [activeMessages, isReactionOnlyMessage, visibleTradeOfferIds]
  );
  const messageVirtualizer = useVirtualizer({
    count: renderableMessages.length,
    getScrollElement: () => chatMessagesNodeRef.current,
    estimateSize: () => 108,
    overscan: 12,
    getItemKey: (index) => renderableMessages[index]?.id ?? index
  });
  const messageVirtualizerTotalSize = messageVirtualizer.getTotalSize();
  useVirtualizedPrependScrollAnchor({
    messages: renderableMessages,
    scrollElementRef: chatMessagesNodeRef,
    threadKey: `direct:${activeContact.trim().toLowerCase()}`,
    totalSize: messageVirtualizerTotalSize
  });
  const showHistorySyncIndicator = loadingOlderHistory && renderableMessages.length > 0;
  const showInitialMessageSkeleton = loadingOlderHistory && renderableMessages.length === 0;

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
              disabled={activeConversationStateSyncPending || walletPromptSensitiveActionsDisabled}
              title={
                walletPromptSensitiveActionsDisabled
                  ? walletPromptSensitiveActionsTitle
                  : activeConversationStateSyncPending
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

      <div className="chat-messages" ref={setChatMessagesNode} onClick={() => markConversationAsRead(activeContact)}>
        {showHistorySyncIndicator ? (
          <div className="chat-message-sync-indicator" role="status" aria-live="polite">
            <span className="inline-spinner" aria-hidden="true" />
            <span>Loading older messages</span>
          </div>
        ) : null}
        {showInitialMessageSkeleton ? (
          <div className="chat-message-skeleton-list" role="status" aria-live="polite" aria-label="Loading direct messages">
            {DIRECT_MESSAGE_SKELETON_ROWS.map((index) => (
              <div
                key={`direct-message-skeleton-${index}`}
                className={index % 3 === 1 ? 'chat-message-skeleton-row outgoing' : 'chat-message-skeleton-row incoming'}
              >
                <div className="chat-message-skeleton-bubble">
                  <span />
                  <span />
                </div>
              </div>
            ))}
          </div>
        ) : renderableMessages.length === 0 ? (
          <p className="chat-empty">No messages yet.</p>
        ) : (
          <div
            className="virtual-message-list"
            style={{ height: `${messageVirtualizerTotalSize}px` }}
          >
            {messageVirtualizer.getVirtualItems().map((virtualItem) => {
            const message = renderableMessages[virtualItem.index];
            if (!message) return null;

            const parsedTradeOfferRaw = parseTradeOfferMessagePayload(message.text);
            const parsedTradeOffer =
              parsedTradeOfferRaw && isInChatTradeOffer(parsedTradeOfferRaw) ? parsedTradeOfferRaw : null;
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
            const showMessageMeta =
              !parsedTradeOffer || message.deliveryState === 'pending' || message.deliveryState === 'failed';

            return (
              <div
                key={message.id}
                ref={(node) => {
                  if (node) {
                    messageVirtualizer.measureElement(node);
                  }
                  messageElementRefs.current[message.id] = node;
                }}
                data-index={virtualItem.index}
                className={message.direction === 'outgoing' ? 'message-row outgoing' : 'message-row incoming'}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <div
                  className={
                    highlightedMessageId === message.id
                      ? 'message-bubble highlighted'
                      : replyingToMessage?.id === message.id
                        ? 'message-bubble replying'
                        : 'message-bubble'
                  }
                >
                  <MessageActions
                    message={message}
                    pickerOpen={!walletPromptSensitiveActionsDisabled && reactionPickerMessageId === message.id}
                    reactedEmojiSet={reactedEmojiSet}
                    sendingReaction={sendingReaction}
                    reactionDisabled={!message.txHash || sendingReaction || walletPromptSensitiveActionsDisabled}
                    reactionTitle={walletPromptSensitiveActionsDisabled ? walletPromptSensitiveActionsTitle : 'React'}
                    replyDisabled={walletPromptSensitiveActionsDisabled}
                    replyTitle={walletPromptSensitiveActionsDisabled ? walletPromptSensitiveActionsTitle : 'Reply'}
                    onToggleReactionPicker={onToggleReactionPicker}
                    onSendReaction={onSendReaction}
                    onReplyToMessage={onReplyToMessage}
                  />
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
                    (() => {
                      const tradeKey = buildTradeSnapshotKey(parsedTradeOffer.tradeId, parsedTradeOffer.escrowContract);
                      const snapshot = tradeSnapshotsById[tradeKey] ?? null;
                      const latestResponse = latestTradeResponsesById[tradeKey] ?? null;
                      const defaultExpanded = parsedTradeOffer.tradeId === latestTradeId;
                      const expanded = tradeCardExpandedState[tradeKey] ?? defaultExpanded;

                      return (
                        <TradeOfferCard
                          offer={parsedTradeOffer}
                          snapshot={snapshot}
                          latestResponse={latestResponse}
                          currentWalletAddress={walletAddress}
                          actionPending={processingTradeActionId === tradeKey}
                          collapsed={!expanded}
                          canToggleCollapsed={true}
                          onToggleCollapsed={() => {
                            setTradeCardExpandedState((previous) => ({
                              ...previous,
                              [tradeKey]: !(previous[tradeKey] ?? defaultExpanded)
                            }));
                          }}
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
                      );
                    })()
                  ) : parsedImageTag ? (
                    <ChatImage tag={message.text} parsed={parsedImageTag} messageTimestamp={message.timestamp} />
                  ) : messageDisplayText ? (
                    <div className="message-text">{renderMessageTextWithLinks(messageDisplayText)}</div>
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
                          disabled={
                            !message.txHash ||
                            sendingReaction ||
                            reaction.reactedByMe ||
                            walletPromptSensitiveActionsDisabled
                          }
                          title={walletPromptSensitiveActionsDisabled ? walletPromptSensitiveActionsTitle : undefined}
                        >
                          <span>{reaction.emoji}</span>
                          <span>{reaction.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {showMessageMeta && (message.timestamp || deliveryLabel) ? (
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
          })}
          </div>
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
        onSendImage={onSendImage}
        uploadingImage={uploadingImage}
        imageAttachmentStatus={imageAttachmentStatus}
        imageAttachDisabled={imageAttachDisabled}
        imageAttachTitle={imageAttachTitle}
        onDismissImageAttachmentStatus={onDismissImageAttachmentStatus}
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

export default memo(DirectChatPanel);
