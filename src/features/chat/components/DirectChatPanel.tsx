import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type Ref } from 'react';
import DirectChatCompose, { type ChatComposerPromptEstimate } from './DirectChatCompose';
import ChatImage from '../../../shared/components/chat/ChatImage';
import MessageActions from '../../../shared/components/chat/MessageActions';
import MessageTextWithLinks from '../../../shared/components/chat/MessageTextWithLinks';
import LinkedTradeContextPanel from '../../trading/components/LinkedTradeContextPanel';
import TradeOfferCard from '../../trading/components/TradeOfferCard';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import { parseImageTag } from '../../../lib/imagePull';
import useVirtualizedPrependScrollAnchor from '../../../shared/hooks/useVirtualizedPrependScrollAnchor';
import { buildTradeTerminalPath } from '../../trading/hooks/useP2PTradeRoute';
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
  type TradeMessageReferencePayload,
  type TradeOfferMessagePayload,
  type TradeResponseMessagePayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  extractTradeTerminalPathFromMessage,
  type LinkedTradeContext
} from '../../../lib/linkedTradeContext';
import { isSupportedDirectTradeV2Escrow } from '../../../lib/directTradeV2Deployment';
import { getCounterOfferUnavailableReason } from '../../../lib/tradeCounterSupport';

type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

const isInChatTradeOffer = (offer: TradeOfferMessagePayload): boolean =>
  !offer.hiddenLiquidity &&
  offer.escrowContract.toLowerCase() !== PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

export const canShowInChatTradeOffer = (
  offer: TradeOfferMessagePayload,
  privacyUnlocked: boolean
): boolean => privacyUnlocked && isInChatTradeOffer(offer);

const DIRECT_MESSAGE_SKELETON_ROWS = [0, 1, 2, 3, 4];

export const hasDirectMessageReplyReference = (message: ChatMessage): boolean => Boolean(
  message.replyToMessageId ||
  message.replyToText ||
  message.replyToTxHash ||
  typeof message.replyToBlockNumber === 'number'
);

export const getDirectReplyActionPolicy = ({
  directChatV2RepliesEnabled,
  message,
  walletPromptSensitiveActionsDisabled,
  walletPromptSensitiveActionsTitle
}: {
  directChatV2RepliesEnabled: boolean;
  message: ChatMessage;
  walletPromptSensitiveActionsDisabled: boolean;
  walletPromptSensitiveActionsTitle: string;
}): Readonly<{ disabled: boolean; title: string }> => {
  if (!walletPromptSensitiveActionsDisabled) return { disabled: false, title: 'Reply' };
  if (!directChatV2RepliesEnabled) {
    return { disabled: true, title: walletPromptSensitiveActionsTitle };
  }
  if (!message.directV2) {
    return {
      disabled: true,
      title: 'Direct Chat V2 replies can target only new-protocol messages.'
    };
  }
  return { disabled: false, title: 'Reply' };
};

const getTradeReferenceLabel = (reference: TradeMessageReferencePayload): string =>
  `Trade #${reference.tradeId}`;

const getTradeReferenceSummary = (reference: TradeMessageReferencePayload): string =>
  `Open trade #${reference.tradeId} in order review.`;

type DirectChatPanelProps = {
  activeContact: string;
  activeContactMeta?: Contact;
  isSelfChat: boolean;
  activeConversationHidden: boolean;
  activeConversationStateSyncPending: boolean;
  walletPromptSensitiveActionsDisabled: boolean;
  walletPromptSensitiveActionsTitle: string;
  chatReactionsV1Enabled: boolean;
  directChatV2RepliesEnabled: boolean;
  pendingNativeCreditLabel: string;
  withdrawingNativeCredit: boolean;
  onWithdrawNativeCredit: () => void;
  directChatV2KeyRotationEnabled: boolean;
  rotatingDirectChatV2Key: boolean;
  onRotateDirectChatV2Key: () => void;
  onToggleConversationHidden: () => void;
  onSaveContactName: (name: string) => Promise<boolean>;
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
    replyToMessageAnchor?: string,
    replyToText?: string,
    replyToTxHash?: string,
    replyToBlockNumber?: number,
    replyToLogIndex?: number
  ) => void;
  getReplyReferenceFallbackLabel: (message: ChatMessage) => string;
  tradeSnapshotsById: Record<string, TradeSnapshot>;
  supportedTradeEscrowContract?: string;
  supportedTradeEscrowContracts?: readonly string[];
  linkedTradeContext?: LinkedTradeContext | null;
  linkedTradeContextShareCopied?: boolean;
  walletAddress: string;
  privacyUnlocked: boolean;
  processingTradeActionId: string;
  onCopyLinkedTradeContextLink: (value: string) => void;
  draftingTradeMessageId?: string;
  draftTradeFeeLabel?: string;
  negotiationFeeLabel?: string;
  pendingTradeAgentRetry?: boolean;
  negotiatingLinkedTrade?: boolean;
  onDraftTradeFromMessage?: (message: ChatMessage) => void;
  onNegotiateLinkedTrade?: (context: LinkedTradeContext) => void;
  onDismissLinkedTradeContext: () => void;
  onOpenTradeTerminalPath: (path: string) => void;
  onRevealTradeTerms?: (offer: TradeOfferMessagePayload) => Promise<void>;
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
  nativeTipsOnly: boolean;
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
  promptEstimate?: ChatComposerPromptEstimate | null;
  onOpenInternalAppLink: (href: string) => void;
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
  activeConversationHidden,
  activeConversationStateSyncPending,
  walletPromptSensitiveActionsDisabled,
  walletPromptSensitiveActionsTitle,
  chatReactionsV1Enabled,
  directChatV2RepliesEnabled,
  pendingNativeCreditLabel,
  withdrawingNativeCredit,
  onWithdrawNativeCredit,
  directChatV2KeyRotationEnabled,
  rotatingDirectChatV2Key,
  onRotateDirectChatV2Key,
  onToggleConversationHidden,
  onSaveContactName,
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
  supportedTradeEscrowContract,
  supportedTradeEscrowContracts,
  linkedTradeContext,
  linkedTradeContextShareCopied = false,
  walletAddress,
  privacyUnlocked,
  processingTradeActionId,
  onCopyLinkedTradeContextLink,
  draftingTradeMessageId = '',
  draftTradeFeeLabel = 'paid',
  negotiationFeeLabel = 'paid',
  pendingTradeAgentRetry = false,
  negotiatingLinkedTrade = false,
  onDraftTradeFromMessage,
  onNegotiateLinkedTrade,
  onDismissLinkedTradeContext,
  onOpenTradeTerminalPath,
  onRevealTradeTerms,
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
  nativeTipsOnly,
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
  promptEstimate,
  onOpenInternalAppLink,
  sending,
  tipToggleDisabled,
  tipToggleTitle,
  tradeToggleDisabled,
  tradeToggleTitle
}: DirectChatPanelProps) {
  const [tradeCardExpandedState, setTradeCardExpandedState] = useState<Record<string, boolean>>({});
  const [savedNameInput, setSavedNameInput] = useState(activeContactMeta?.savedName ?? '');
  const [savingContactName, setSavingContactName] = useState(false);
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
  const activeContactName = activeContactMeta?.savedName?.trim() || activeContactMeta?.name?.trim();
  const activeContactLabel = activeContactName
    ? `${activeContactName} (${shortenAddress(activeContact)})`
    : shortenAddress(activeContact);
  useEffect(() => {
    setSavedNameInput(activeContactMeta?.savedName ?? '');
  }, [activeContact, activeContactMeta?.savedName]);
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

        const parsedTradeOffer = parseTradeOfferMessagePayload(message.text);
        if (parsedTradeOffer && !canShowInChatTradeOffer(parsedTradeOffer, privacyUnlocked)) {
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
    [activeMessages, isReactionOnlyMessage, privacyUnlocked, visibleTradeOfferIds]
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
  const linkedTradeContextContent = linkedTradeContext ? (
    <LinkedTradeContextPanel
      context={linkedTradeContext}
      currentWalletAddress={walletAddress}
      negotiating={negotiatingLinkedTrade}
      negotiateFeeLabel={negotiationFeeLabel}
      onNegotiate={onNegotiateLinkedTrade}
      onCopyShareLink={onCopyLinkedTradeContextLink}
      onDismiss={onDismissLinkedTradeContext}
      onOpenTerminal={onOpenTradeTerminalPath}
      shareCopied={linkedTradeContextShareCopied}
    />
  ) : null;

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <strong>{isSelfChat ? `${activeContactLabel} (self)` : activeContactLabel}</strong>
        <div className="chat-header-actions">
          {!isSelfChat ? (
            <form
              className="chat-contact-name-editor"
              onSubmit={(event) => {
                event.preventDefault();
                if (savingContactName) return;
                setSavingContactName(true);
                void onSaveContactName(savedNameInput).finally(() => setSavingContactName(false));
              }}
            >
              <input
                value={savedNameInput}
                onChange={(event) => setSavedNameInput(event.currentTarget.value)}
                maxLength={32}
                placeholder="Saved as"
                aria-label="Private saved contact name"
                disabled={savingContactName || walletPromptSensitiveActionsDisabled}
              />
              <button
                type="submit"
                className="contact"
                disabled={savingContactName || walletPromptSensitiveActionsDisabled}
                title="Save a private name for this contact"
              >
                {savingContactName ? 'Saving...' : 'Save as'}
              </button>
            </form>
          ) : null}
          {pendingTradeAgentRetry ? (
            <span
              className="chat-header-state"
              role="status"
              aria-live="polite"
              title="Reopen the original message or linked order to retry the paid Agent request without another WISP transfer."
            >
              Agent retry ready
            </span>
          ) : null}
          {activeConversationHidden ? (
            <span className="chat-header-state">Hidden</span>
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
              onClick={onToggleConversationHidden}
              disabled={activeConversationStateSyncPending || walletPromptSensitiveActionsDisabled}
              title={
                walletPromptSensitiveActionsDisabled
                  ? walletPromptSensitiveActionsTitle
                  : activeConversationStateSyncPending
                  ? 'Waiting for confirmation...'
                  : activeConversationHidden
                    ? 'Unhide conversation'
                    : 'Hide conversation'
              }
            >
              {activeConversationStateSyncPending ? 'Saving...' : activeConversationHidden ? 'Unhide' : 'Hide'}
            </button>
          ) : null}
          {pendingNativeCreditLabel ? (
            <button
              type="button"
              className="contact"
              onClick={onWithdrawNativeCredit}
              disabled={withdrawingNativeCredit}
              title="Claim native COTI tips credited by Direct Chat V2"
            >
              {withdrawingNativeCredit
                ? 'Claiming tips...'
                : `Claim ${pendingNativeCreditLabel}`}
            </button>
          ) : null}
          {directChatV2KeyRotationEnabled && !isSelfChat ? (
            <button
              type="button"
              className="contact"
              onClick={onRotateDirectChatV2Key}
              disabled={rotatingDirectChatV2Key}
              title="Rotate the conversation encryption key. Existing messages remain readable."
            >
              {rotatingDirectChatV2Key ? 'Rotating key...' : 'Rotate key'}
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
          <div className="chat-empty-state" role="status" aria-live="polite">
            <strong>No messages yet</strong>
            <p>Send the first message, or sync history if this conversation already exists on-chain.</p>
            <div className="chat-empty-actions">
              <button type="button" onClick={onLoadFullConversationHistory} disabled={syncingHistory}>
                {syncingHistory ? 'Syncing...' : 'Sync History'}
              </button>
            </div>
          </div>
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
            const messageTradeTerminalPath =
              !parsedTradeOffer && !message.tradeReference && messageDisplayText
                ? extractTradeTerminalPathFromMessage(messageDisplayText)
                : null;
            const parsedImageTag = parseImageTag(message.text);
            const messageReactions = getReactionsForMessage(message);
            const canDraftTradeFromMessage = Boolean(
              onDraftTradeFromMessage &&
              messageDisplayText.trim() &&
              !parsedTradeOffer &&
              !parsedImageTag
            );
            const reactedEmojiSet = new Set(
              messageReactions.filter((reaction) => reaction.reactedByMe).map((reaction) => reaction.emoji)
            );
            const directChatV2Finalizing = message.directV2?.finality === 'confirmed';
            const deliveryLabel =
              message.deliveryState === 'pending'
                ? 'Sending...'
                : message.deliveryState === 'sent'
                  ? directChatV2Finalizing
                    ? 'Sent · finalizing (about 25s)'
                    : 'Sent'
                  : message.deliveryState === 'failed'
                    ? 'Failed'
                    : '';
            const showMessageMeta =
              !parsedTradeOffer || message.deliveryState === 'pending' || message.deliveryState === 'failed';
            const replyAction = getDirectReplyActionPolicy({
              directChatV2RepliesEnabled,
              message,
              walletPromptSensitiveActionsDisabled,
              walletPromptSensitiveActionsTitle
            });
            const chatReactionV1Allowed = chatReactionsV1Enabled &&
              Boolean(message.directV2);

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
                    pickerOpen={
                      (!walletPromptSensitiveActionsDisabled || chatReactionV1Allowed) &&
                      reactionPickerMessageId === message.id
                    }
                    reactedEmojiSet={reactedEmojiSet}
                    sendingReaction={sendingReaction}
                    reactionDisabled={
                      !message.txHash || sendingReaction ||
                      (walletPromptSensitiveActionsDisabled && !chatReactionV1Allowed)
                    }
                    reactionTitle={
                      walletPromptSensitiveActionsDisabled && !chatReactionV1Allowed
                        ? walletPromptSensitiveActionsTitle
                        : chatReactionV1Allowed
                          ? 'React publicly on-chain · 1 wallet transaction'
                          : 'React'
                    }
                    reactionDisclosure={
                      chatReactionV1Allowed
                        ? 'Emoji reactions are public on-chain and need one wallet transaction.'
                        : undefined
                    }
                    draftTradeDisabled={walletPromptSensitiveActionsDisabled || draftingTradeMessageId === message.id}
                    draftTradeLoading={draftingTradeMessageId === message.id}
                    draftTradeTitle={
                      walletPromptSensitiveActionsDisabled
                        ? walletPromptSensitiveActionsTitle
                        : draftingTradeMessageId === message.id
                          ? 'Drafting trade...'
                          : `Draft trade · ${draftTradeFeeLabel}`
                    }
                    replyDisabled={replyAction.disabled}
                    replyTitle={replyAction.title}
                    onDraftTradeFromMessage={canDraftTradeFromMessage ? onDraftTradeFromMessage : undefined}
                    onToggleReactionPicker={onToggleReactionPicker}
                    onSendReaction={onSendReaction}
                    onReplyToMessage={onReplyToMessage}
                  />
                  {hasDirectMessageReplyReference(message) ? (
                    <button
                      type="button"
                      className="message-reply"
                      onClick={() =>
                        onJumpToReferencedMessage(
                          message.replyToMessageId,
                          message.replyToMessageAnchor,
                          message.replyToText,
                          message.replyToTxHash,
                          message.replyToBlockNumber,
                          message.replyToLogIndex
                        )
                      }
                      title="Go to replied message"
                      aria-label={`Go to replied message: ${getReplyReferenceFallbackLabel(message)}`}
                    >
                      {'\u21AA'} {getReplyReferenceFallbackLabel(message)}
                    </button>
                  ) : null}
                  {message.tradeReference ? (
                    <button
                      type="button"
                      className="message-trade-reference"
                      onClick={() => onOpenTradeTerminalPath(message.tradeReference!.terminalPath)}
                      title="Open order"
                      aria-label={`Open ${getTradeReferenceLabel(message.tradeReference)} order`}
                    >
                      <span className="message-trade-reference-kicker">Trade</span>
                      <strong>{getTradeReferenceLabel(message.tradeReference)}</strong>
                      <span>{getTradeReferenceSummary(message.tradeReference)}</span>
                    </button>
                  ) : null}
                  {parsedTradeOffer ? (
                    (() => {
                      const tradeKey = buildTradeSnapshotKey(parsedTradeOffer.tradeId, parsedTradeOffer.escrowContract);
                      const snapshot = tradeSnapshotsById[tradeKey] ?? null;
                      const latestResponse = latestTradeResponsesById[tradeKey] ?? null;
                      const defaultExpanded = parsedTradeOffer.tradeId === latestTradeId;
                      const expanded = tradeCardExpandedState[tradeKey] ?? defaultExpanded;
                      const counterUnavailableReason = snapshot
                        ? getCounterOfferUnavailableReason(snapshot, walletAddress.trim().toLowerCase())
                        : undefined;
                      const terminalPath = buildTradeTerminalPath(
                        parsedTradeOffer.tradeId,
                        parsedTradeOffer.accessSecret,
                        parsedTradeOffer.escrowContract
                      );

                      const unsupportedTradeCard = !isSupportedDirectTradeV2Escrow(
                        parsedTradeOffer.escrowContract, supportedTradeEscrowContracts, supportedTradeEscrowContract
                      );

                      return (
                        <TradeOfferCard
                          offer={parsedTradeOffer}
                          snapshot={snapshot}
                          latestResponse={latestResponse}
                          currentWalletAddress={walletAddress}
                          actionPending={processingTradeActionId === tradeKey}
                          showCounterAction={!counterUnavailableReason}
                          counterUnavailableReason={counterUnavailableReason}
                          collapsed={!expanded}
                          canToggleCollapsed={true}
                          onToggleCollapsed={() => {
                            setTradeCardExpandedState((previous) => ({
                              ...previous,
                              [tradeKey]: !(previous[tradeKey] ?? defaultExpanded)
                            }));
                          }}
                          termsUnavailableReason={unsupportedTradeCard
                            ? 'Archived offer details are unavailable on this network.'
                            : undefined}
                          onOpenTerminal={unsupportedTradeCard
                            ? undefined
                            : () => onOpenTradeTerminalPath(terminalPath)}
                          onRevealTerms={onRevealTradeTerms
                            ? () => {
                                onRevealTradeTerms(parsedTradeOffer).catch(() => {});
                              }
                            : undefined}
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
                    <>
                      <div className="message-text">
                        <MessageTextWithLinks text={messageDisplayText} onOpenInternalLink={onOpenInternalAppLink} />
                      </div>
                      {messageTradeTerminalPath ? (
                        <button
                          type="button"
                          className="message-open-terminal"
                          onClick={() => onOpenTradeTerminalPath(messageTradeTerminalPath)}
                        >
                          Open order
                        </button>
                      ) : null}
                    </>
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
                            (walletPromptSensitiveActionsDisabled && !chatReactionV1Allowed)
                          }
                          title={
                            walletPromptSensitiveActionsDisabled && !chatReactionV1Allowed
                              ? walletPromptSensitiveActionsTitle
                              : undefined
                          }
                          aria-label={`${reaction.reactedByMe ? 'Your reaction' : 'Reaction'} ${reaction.emoji}, ${
                            reaction.count
                          } ${reaction.count === 1 ? 'reaction' : 'reactions'}`}
                        >
                          <span>{reaction.emoji}</span>
                          <span>{reaction.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {showMessageMeta && (message.timestamp || deliveryLabel || message.accountRole === 'owner') ? (
                    <div className="message-meta">
                      {message.accountRole === 'owner' ? (
                        <span className="message-account-badge">Owner wallet</span>
                      ) : null}
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
        nativeTipsOnly={nativeTipsOnly}
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
        linkedTradeContextContent={linkedTradeContextContent}
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
        promptEstimate={promptEstimate}
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
