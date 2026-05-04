import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref } from 'react';
import GroupChatCompose from './GroupChatCompose';
import ChatImage from './ChatImage';
import MessageActions from './MessageActions';
import MessageTextWithLinks from './MessageTextWithLinks';
import type { ImageAttachmentPreviewState } from '../lib/imageAttachmentPreview';
import { closeDetailsOnEscape } from './a11y';
import { parseImageTag } from '../lib/imagePull';
import useVirtualizedPrependScrollAnchor from '../hooks/useVirtualizedPrependScrollAnchor';
import {
  formatMessageTimestamp,
  getMessageDisplayText,
  isWalletAddress,
  shortenAddress,
  type ChatMessage,
  type GroupSummary,
  type TipTokenSelection
} from '../lib/appShared';

type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

type GroupParticipantSummary = {
  key: string;
  address: string;
  name?: string;
  shortAddress: string;
  isSelf: boolean;
  isAdmin: boolean;
};

type GroupChatPanelProps = {
  activeGroupId: number;
  activeGroupMeta: GroupSummary | null;
  isActiveGroupAdmin: boolean;
  activeGroupMemberCount: number;
  activeGroupParticipants: GroupParticipantSummary[];
  lastCopiedKey: string | null;
  onCopyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  processingGroupAction: boolean;
  onRemoveMember: (address: string) => Promise<void>;
  desktopJoinCodeList?: ReactNode;
  desktopInviteMenu: ReactNode;
  mobileInviteTools: ReactNode;
  desktopGroupActions: ReactNode;
  mobileGroupActions: ReactNode;
  isMobileNav: boolean;
  syncingGroups: boolean;
  mobileGroupOptionsOpen: boolean;
  onToggleMobileGroupOptions: () => void;
  onRefreshGroup: () => void;
  chatMessagesRef: Ref<HTMLDivElement>;
  activeGroupMessages: ChatMessage[];
  messageLoadPhase: 'initial' | 'history' | null;
  isReactionOnlyMessage: (message: ChatMessage) => boolean;
  getReactionsForMessage: (message: ChatMessage) => MessageReactionSummary[];
  reactionPickerMessageId: string | null;
  onToggleReactionPicker: (messageId: string) => void;
  sendingReaction: boolean;
  onSendReaction: (targetMessage: ChatMessage, emojiInput: string) => Promise<void>;
  walletPromptSensitiveActionsDisabled: boolean;
  walletPromptSensitiveActionsTitle: string;
  replyingToMessage: ChatMessage | null;
  onReplyToMessage: (message: ChatMessage) => void;
  highlightedMessageId: string | null;
  messageElementRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  onJumpToReferencedMessage: (
    replyToMessageId?: string,
    replyToText?: string,
    replyToTxHash?: string,
    replyToBlockNumber?: number,
    replyToLogIndex?: number
  ) => void;
  getReplyReferenceFallbackLabel: (message: ChatMessage) => string;
  walletAddress: string;
  findContactNameForWalletAddress: (address?: string) => string | undefined;
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
  canSendGroupTipFromComposer: boolean;
  tipAmountExceedsBalance: boolean;
  tipAmountSummaryLabel: string;
  tipBalanceSummaryLabel: string;
  onSendTip: () => void;
  groupTipRecipientAddress: string;
  onGroupTipRecipientChange: (address: string) => void;
  activeGroupTipRecipients: GroupParticipantSummary[];
  selectedGroupTipRecipient: GroupParticipantSummary | null;
  sendingGroupMessage: boolean;
  composerRef: Ref<HTMLDivElement>;
  onSendImage: (file: File) => void;
  uploadingImage: boolean;
  imageAttachmentStatus?: ImageAttachmentPreviewState | null;
  imageAttachDisabled: boolean;
  imageAttachTitle: string;
  onDismissImageAttachmentStatus: () => void;
  onSendMessage: () => void;
  maxMessageLength: number;
  onMessageInputChange: (value: string) => void;
  onOpenInternalAppLink: (href: string) => void;
};

export default function GroupChatPanel({
  activeGroupId,
  activeGroupMeta,
  isActiveGroupAdmin,
  activeGroupMemberCount,
  activeGroupParticipants,
  lastCopiedKey,
  onCopyWithFeedback,
  processingGroupAction,
  onRemoveMember,
  desktopJoinCodeList,
  desktopInviteMenu,
  mobileInviteTools,
  desktopGroupActions,
  mobileGroupActions,
  isMobileNav,
  syncingGroups,
  mobileGroupOptionsOpen,
  onToggleMobileGroupOptions,
  onRefreshGroup,
  chatMessagesRef,
  activeGroupMessages,
  messageLoadPhase,
  isReactionOnlyMessage,
  getReactionsForMessage,
  reactionPickerMessageId,
  onToggleReactionPicker,
  sendingReaction,
  onSendReaction,
  walletPromptSensitiveActionsDisabled,
  walletPromptSensitiveActionsTitle,
  replyingToMessage,
  onReplyToMessage,
  highlightedMessageId,
  messageElementRefs,
  onJumpToReferencedMessage,
  getReplyReferenceFallbackLabel,
  walletAddress,
  findContactNameForWalletAddress,
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
  canSendGroupTipFromComposer,
  tipAmountExceedsBalance,
  tipAmountSummaryLabel,
  tipBalanceSummaryLabel,
  onSendTip,
  groupTipRecipientAddress,
  onGroupTipRecipientChange,
  activeGroupTipRecipients,
  selectedGroupTipRecipient,
  sendingGroupMessage,
  composerRef,
  onSendImage,
  uploadingImage,
  imageAttachmentStatus,
  imageAttachDisabled,
  imageAttachTitle,
  onDismissImageAttachmentStatus,
  onSendMessage,
  maxMessageLength,
  onMessageInputChange,
  onOpenInternalAppLink
}: GroupChatPanelProps) {
  const chatMessagesNodeRef = useRef<HTMLDivElement | null>(null);
  const mobileGroupToolsButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const renderableMessages = useMemo(
    () => activeGroupMessages.filter((message) => !isReactionOnlyMessage(message)),
    [activeGroupMessages, isReactionOnlyMessage]
  );
  const showInitialMessageSkeleton = messageLoadPhase !== null && renderableMessages.length === 0;
  const showHistorySyncIndicator = messageLoadPhase !== null && renderableMessages.length > 0;
  const messageLoadLabel = messageLoadPhase === 'initial' ? 'Catching up' : 'Loading older messages';
  const messageLoadAriaLabel =
    messageLoadPhase === 'initial' ? 'Catching up group messages' : 'Loading older group messages';
  const messageVirtualizer = useVirtualizer({
    count: renderableMessages.length,
    getScrollElement: () => chatMessagesNodeRef.current,
    estimateSize: () => 112,
    overscan: 12,
    getItemKey: (index) => renderableMessages[index]?.id ?? index
  });
  const messageVirtualizerTotalSize = messageVirtualizer.getTotalSize();
  useVirtualizedPrependScrollAnchor({
    messages: renderableMessages,
    scrollElementRef: chatMessagesNodeRef,
    threadKey: `group:${activeGroupId}`,
    totalSize: messageVirtualizerTotalSize
  });
  const closeMobileGroupOptions = useCallback(() => {
    if (!mobileGroupOptionsOpen) {
      return;
    }

    onToggleMobileGroupOptions();
    window.requestAnimationFrame(() => mobileGroupToolsButtonRef.current?.focus());
  }, [mobileGroupOptionsOpen, onToggleMobileGroupOptions]);
  const handleMobileGroupOptionsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeMobileGroupOptions();
    },
    [closeMobileGroupOptions]
  );

  return (
    <div className="chat-shell">
      <div className="chat-header chat-header-group">
        <div className="group-header-meta">
          <div className="group-title-stack">
            <strong>{(activeGroupMeta?.title ? activeGroupMeta.title : `Group ${activeGroupId}`) + ` (#${activeGroupId})`}</strong>
            <span className="group-title-badges">
              <span className="group-title-badge">{activeGroupMeta?.isPrivate ? 'Private' : 'Public'}</span>
              <span className={isActiveGroupAdmin ? 'group-title-badge admin' : 'group-title-badge'}>
                {isActiveGroupAdmin ? 'Admin' : 'Member'}
              </span>
            </span>
          </div>
          <div className="group-meta-dropdowns">
            <details className="group-members-dropdown" onKeyDown={closeDetailsOnEscape}>
              <summary>
                Members {activeGroupMemberCount}
              </summary>
              <ul className="group-members-list">
                {activeGroupParticipants.length > 0 ? (
                  activeGroupParticipants.map((participant) => {
                    const participantCopyKey = `group-member:${participant.address.toLowerCase()}`;
                    const isParticipantCopied = lastCopiedKey === participantCopyKey;

                    return (
                      <li key={participant.key}>
                        <div className="group-member-row">
                          <button
                            type="button"
                            className={isParticipantCopied ? 'group-member-copy copied' : 'group-member-copy'}
                            onClick={(event) => {
                              onCopyWithFeedback(participant.address, participantCopyKey).catch(() => {});
                              const detailsElement = event.currentTarget.closest('details');
                              if (detailsElement instanceof HTMLDetailsElement) {
                                detailsElement.open = false;
                              }
                            }}
                            title={isParticipantCopied ? 'Copied' : `Copy ${participant.address}`}
                          >
                            <span className="group-member-name">
                              {participant.name ?? participant.shortAddress}
                              {participant.isSelf ? <span className="group-member-badge">You</span> : null}
                              {participant.isAdmin ? <span className="group-member-badge">Admin</span> : null}
                            </span>
                            <span className="group-member-address">
                              {isParticipantCopied ? 'Copied' : participant.shortAddress}
                            </span>
                          </button>
                          {isActiveGroupAdmin && !participant.isSelf ? (
                            <button
                              type="button"
                              className="group-member-remove"
                              onClick={() => {
                                onRemoveMember(participant.address).catch(() => {});
                              }}
                              disabled={processingGroupAction}
                              title={`Remove ${participant.address}`}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                ) : (
                  <li className="group-members-empty">No members loaded yet.</li>
                )}
              </ul>
            </details>
          </div>
        </div>
        <div className="group-header-controls">
          {isMobileNav ? (
            <>
              <button
                type="button"
                className="contact group-mobile-refresh-btn group-refresh-button"
                onClick={onRefreshGroup}
                disabled={syncingGroups}
              >
                {syncingGroups ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                ref={mobileGroupToolsButtonRef}
                type="button"
                className={
                  mobileGroupOptionsOpen
                    ? 'contact active group-mobile-tools-toggle'
                    : 'contact group-mobile-tools-toggle'
                }
                aria-expanded={mobileGroupOptionsOpen}
                aria-controls="group-mobile-tools-panel"
                onClick={onToggleMobileGroupOptions}
              >
                {mobileGroupOptionsOpen ? 'Hide tools' : 'Group tools'}
              </button>
            </>
          ) : (
            <>
              {desktopInviteMenu}
              {desktopJoinCodeList}
              <button
                type="button"
                className="contact group-refresh-button group-desktop-refresh-btn"
                onClick={onRefreshGroup}
                disabled={syncingGroups}
              >
                {syncingGroups ? 'Refreshing...' : 'Refresh'}
              </button>
            </>
          )}
        </div>
        {isMobileNav && mobileGroupOptionsOpen ? (
          <div
            id="group-mobile-tools-panel"
            className="group-mobile-options-panel"
            role="dialog"
            aria-label="Group tools"
            onKeyDown={handleMobileGroupOptionsKeyDown}
          >
            <div className="group-mobile-section">
              <div className="group-mobile-section-header">
                <span className="group-mobile-section-title">Invite tools</span>
                <span className="group-mobile-section-subtitle">Members and join codes</span>
              </div>
              {mobileInviteTools}
            </div>

            <div className="group-mobile-section group-mobile-section-actions">
              <div className="group-mobile-section-header">
                <span className="group-mobile-section-title">Group actions</span>
                <span className="group-mobile-section-subtitle">
                  {isActiveGroupAdmin ? 'Rename, leave, or close group' : 'Leave group'}
                </span>
              </div>
              <div className="group-mobile-options-actions group-mobile-options-actions-secondary">
                {mobileGroupActions}
              </div>
            </div>
          </div>
        ) : !isMobileNav ? (
          <div className="group-header-actions">{desktopGroupActions}</div>
        ) : null}
      </div>

      <div className="chat-messages" ref={setChatMessagesNode}>
        {showHistorySyncIndicator ? (
          <div className="group-message-sync-indicator" role="status" aria-live="polite">
            <span className="inline-spinner" aria-hidden="true" />
            <span>{messageLoadLabel}</span>
          </div>
        ) : null}
        {showInitialMessageSkeleton ? (
          <div className="group-message-skeleton-list" role="status" aria-live="polite" aria-label={messageLoadAriaLabel}>
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={`group-message-skeleton-${index}`}
                className={index % 3 === 1 ? 'group-message-skeleton-row outgoing' : 'group-message-skeleton-row incoming'}
              >
                <div className="group-message-skeleton-bubble">
                  <span />
                  <span />
                </div>
              </div>
            ))}
          </div>
        ) : renderableMessages.length === 0 ? (
          <div className="chat-empty-state" role="status" aria-live="polite">
            <strong>No group messages yet</strong>
            <p>Send the first message, or refresh this group if recent messages are still syncing.</p>
            <div className="chat-empty-actions">
              <button type="button" onClick={onRefreshGroup} disabled={syncingGroups}>
                {syncingGroups ? 'Refreshing...' : 'Refresh'}
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

            const isGroupSystemMessage = Boolean(message.isSystem);

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
            const normalizedSender = message.senderAddress?.trim().toLowerCase() ?? '';
            const isSelfSender =
              normalizedSender.length > 0 &&
              walletAddress.length > 0 &&
              normalizedSender === walletAddress.trim().toLowerCase();
            const canCopySenderAddress = Boolean(message.senderAddress && isWalletAddress(message.senderAddress));
            const senderCopyKey = `message-sender:${message.id}`;
            const isSenderCopied = lastCopiedKey === senderCopyKey;
            const senderLabel = isSelfSender
              ? 'You'
              : findContactNameForWalletAddress(message.senderAddress) ??
                (message.senderAddress && isWalletAddress(message.senderAddress)
                  ? shortenAddress(message.senderAddress)
                  : 'Member');
            const canReplyToGroupMessage = !isGroupSystemMessage;
            const messageRowClassName = isGroupSystemMessage
              ? 'message-row system'
              : message.direction === 'outgoing'
                ? 'message-row outgoing'
                : 'message-row incoming';
            const messageBubbleClassName = [
              isGroupSystemMessage ? 'message-bubble system' : 'message-bubble',
              highlightedMessageId === message.id
                ? 'highlighted'
                : canReplyToGroupMessage && replyingToMessage?.id === message.id
                  ? 'replying'
                  : ''
            ]
              .filter((className) => className.length > 0)
              .join(' ');

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
                className={messageRowClassName}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <div
                  className={messageBubbleClassName}
                >
                  {canReplyToGroupMessage ? (
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
                  ) : null}
                  {message.direction === 'incoming' && !isGroupSystemMessage ? (
                    canCopySenderAddress ? (
                      <button
                        type="button"
                        className={isSenderCopied ? 'message-sender-copy copied' : 'message-sender-copy'}
                        onClick={() => {
                          onCopyWithFeedback(message.senderAddress as string, senderCopyKey).catch(() => {});
                        }}
                        title={isSenderCopied ? 'Copied' : `Copy ${message.senderAddress as string}`}
                        aria-label={isSenderCopied ? 'Sender address copied' : `Copy sender address for ${senderLabel}`}
                      >
                        {isSenderCopied ? `${senderLabel} (copied)` : senderLabel}
                      </button>
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>{senderLabel}</div>
                    )
                  ) : null}
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
                      aria-label={`Go to replied message: ${getReplyReferenceFallbackLabel(message)}`}
                    >
                      {'\u21AA'} {getReplyReferenceFallbackLabel(message)}
                    </button>
                  ) : null}
                  {parsedImageTag ? (
                    <ChatImage tag={message.text} parsed={parsedImageTag} messageTimestamp={message.timestamp} />
                  ) : messageDisplayText ? (
                    <div className="message-text">
                      <MessageTextWithLinks text={messageDisplayText} onOpenInternalLink={onOpenInternalAppLink} />
                    </div>
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
          })}
          </div>
        )}
      </div>

      <GroupChatCompose
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
        canSendGroupTipFromComposer={canSendGroupTipFromComposer}
        tipAmountExceedsBalance={tipAmountExceedsBalance}
        tipAmountSummaryLabel={tipAmountSummaryLabel}
        tipBalanceSummaryLabel={tipBalanceSummaryLabel}
        onSendTip={onSendTip}
        groupTipRecipientAddress={groupTipRecipientAddress}
        onGroupTipRecipientChange={onGroupTipRecipientChange}
        activeGroupTipRecipients={activeGroupTipRecipients}
        selectedGroupTipRecipient={selectedGroupTipRecipient}
        sendingGroupMessage={sendingGroupMessage}
        processingGroupAction={processingGroupAction}
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
      />
    </div>
  );
}
