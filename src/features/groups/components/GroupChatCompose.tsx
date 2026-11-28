import { useRef, useState, type Ref } from 'react';
import ChatSendIcon from '../../../shared/components/chat/ChatSendIcon';
import ChatImageIcon from '../../../shared/components/chat/ChatImageIcon';
import ImageAttachmentPreview from '../../../shared/components/chat/ImageAttachmentPreview';
import { TIP_NATIVE_TOKEN_SYMBOL, type TipTokenSelection } from '../../../lib/appShared';
import { CHAT_IMAGE_FILE_ACCEPT } from '../../../lib/imagePull';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import { insertChatComposerLineBreak, syncChatComposerText } from '../../../shared/chatComposeText';
import { AppTooltip } from '../../../shared/ui/AppTooltip';

type GroupTipRecipient = {
  key: string;
  address: string;
  name?: string;
  shortAddress: string;
};

type GroupChatComposeProps = {
  replyPreviewText: string;
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
  activeGroupTipRecipients: GroupTipRecipient[];
  selectedGroupTipRecipient: GroupTipRecipient | null;
  sendingGroupMessage: boolean;
  processingGroupAction: boolean;
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
  promptEstimate?: Readonly<{ tone: 'ok' | 'warning'; label: string }> | null;
  /** Set while this group has a submitted, unconfirmed outgoing message. */
  sendHoldReason?: string | null;
};

export default function GroupChatCompose({
  replyPreviewText,
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
  processingGroupAction,
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
  sendHoldReason = null
}: GroupChatComposeProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [msgLength, setMsgLength] = useState(0);
  const sendHeld = Boolean(sendHoldReason);
  const attachDisabled = imageAttachDisabled || sendHeld;

  return (
    <div className="chat-compose group-chat-compose">
      {replyPreviewText ? (
        <div className="chat-replying">
          <span>Replying to: {replyPreviewText}</span>
          <button type="button" onClick={onCancelReply}>
            Cancel
          </button>
        </div>
      ) : null}
      {tipComposerOpen ? (
        <div className="chat-tip-panel group-tip-panel" role="group" aria-label="Group tip settings">
          <div className="group-tip-recipient-row">
            <label className="group-tip-recipient-label" htmlFor="group-tip-recipient">
              Member
            </label>
            <select
              id="group-tip-recipient"
              className="group-tip-recipient-select"
              value={groupTipRecipientAddress}
              onChange={(event) => {
                onGroupTipRecipientChange(event.target.value);
              }}
              disabled={tipping || activeGroupTipRecipients.length === 0}
            >
              {activeGroupTipRecipients.length === 0 ? (
                <option value="">No members available</option>
              ) : (
                activeGroupTipRecipients.map((participant) => (
                  <option key={`group-tip-recipient:${participant.key}`} value={participant.address}>
                    {participant.name ? `${participant.name} (${participant.shortAddress})` : participant.shortAddress}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="chat-tip-input-row">
            <div className="chat-tip-token-switch" role="group" aria-label="Tip token">
              <button
                type="button"
                className={tipTokenSelection === 'coti' ? 'active' : undefined}
                onClick={() => onTipTokenSelectionChange('coti')}
                disabled={tipping}
                aria-pressed={tipTokenSelection === 'coti'}
              >
                {TIP_NATIVE_TOKEN_SYMBOL}
              </button>
              <button
                type="button"
                className={tipTokenSelection === 'wisp' ? 'active' : undefined}
                onClick={() => onTipTokenSelectionChange('wisp')}
                disabled={tipping}
                aria-pressed={tipTokenSelection === 'wisp'}
              >
                {rewardTokenSymbol}
              </button>
              <button
                type="button"
                className={tipTokenSelection === 'pwisp' ? 'active' : undefined}
                onClick={() => onTipTokenSelectionChange('pwisp')}
                disabled={tipping}
                aria-pressed={tipTokenSelection === 'pwisp'}
              >
                {privateRewardTokenSymbol}
              </button>
            </div>
            <input
              className="chat-tip-amount-input"
              type="text"
              inputMode="decimal"
              value={tipAmountInput}
              onChange={(event) => onTipAmountInputChange(event.target.value)}
              placeholder={`0 ${activeTipTokenSymbol}`}
              aria-label={`Tip amount in ${activeTipTokenSymbol}`}
              disabled={tipping}
            />
            <AppTooltip text={
                !selectedGroupTipRecipient
                  ? 'Select a member'
                  : tipAmountWeiFromInput <= 0n
                    ? 'Enter a tip amount'
                    : tipAmountExceedsBalance
                      ? `Amount exceeds your ${activeTipTokenSymbol} balance`
                      : `Send ${tipAmountSummaryLabel}`
              }><button
              className="chat-tip-send"
              type="button"
              onClick={onSendTip}
              disabled={!canSendGroupTipFromComposer}
            >
              {tipping ? 'Sending tip...' : `Send ${activeTipTokenSymbol}`}
            </button></AppTooltip>
          </div>
          <div className="chat-tip-meta">
            <span>{tipAmountSummaryLabel}</span>
            <span>
              {selectedGroupTipRecipient
                ? `To: ${selectedGroupTipRecipient.name ?? selectedGroupTipRecipient.shortAddress} | Balance: ${tipBalanceSummaryLabel}`
                : `Balance: ${tipBalanceSummaryLabel}`}
            </span>
          </div>
          {tipAmountExceedsBalance ? (
            <p className="chat-tip-warning">Amount exceeds available balance.</p>
          ) : null}
        </div>
      ) : null}
      {imageAttachmentStatus ? (
        <ImageAttachmentPreview
          status={imageAttachmentStatus}
          onDismiss={onDismissImageAttachmentStatus}
          onRetry={onSendImage}
          retryDisabled={attachDisabled}
        />
      ) : null}
      <div className="group-compose-main">
        <div className="group-compose-entry">
          <input
            ref={imageInputRef}
            type="file"
            accept={CHAT_IMAGE_FILE_ACCEPT}
            hidden
            disabled={attachDisabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (!file) {
                return;
              }
              onSendImage(file);
            }}
          />
          <AppTooltip text={sendHoldReason ?? imageAttachTitle}>
            <button
              type="button"
              className="chat-compose-attach chat-compose-attach-icon"
              onClick={() => {
                imageInputRef.current?.click();
              }}
              disabled={attachDisabled}
              aria-label={uploadingImage ? 'Preparing image' : 'Attach image'}
            >
              <ChatImageIcon />
            </button>
          </AppTooltip>
          <div
            ref={composerRef}
            className="chat-compose-editor"
            contentEditable={!processingGroupAction}
            suppressContentEditableWarning
            role="textbox"
            aria-disabled={processingGroupAction}
            aria-multiline={true}
            aria-label="Group message"
            data-placeholder="Type a group message"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return;
              }

              if (event.shiftKey) {
                event.preventDefault();
                const nextValue = insertChatComposerLineBreak(event.currentTarget, maxMessageLength);
                onMessageInputChange(nextValue);
                setMsgLength(nextValue.length);
                return;
              }

              if (!isMobileNav) {
                event.preventDefault();
                if (!sendHeld) onSendMessage();
              }
            }}
            onInput={(event) => {
              const capped = syncChatComposerText(event.currentTarget, maxMessageLength);
              onMessageInputChange(capped);
              setMsgLength(capped.length);
            }}
            onPaste={(event) => {
              const imageItem = Array.from(event.clipboardData.items).find(
                (item) => item.kind === 'file' && item.type.startsWith('image/')
              );
              if (!imageItem) {
                return;
              }
              event.preventDefault();
              if (attachDisabled) {
                return;
              }
              const file = imageItem.getAsFile();
              if (file) {
                onSendImage(file);
              }
            }}
          />
          <AppTooltip text={
              sendingGroupMessage
                ? 'Sending...'
                : uploadingImage
                  ? 'Preparing image...'
                  : sendHoldReason ?? 'Send group message'
            }>
            <button
              className="group-compose-send chat-compose-send"
              type="button"
              onClick={onSendMessage}
              disabled={sendingGroupMessage || processingGroupAction || uploadingImage || sendHeld}
              aria-label={
                sendingGroupMessage ? 'Sending group message' : uploadingImage ? 'Preparing image' : 'Send group message'
              }
            >
              <ChatSendIcon />
            </button>
          </AppTooltip>
        </div>
        {msgLength > 0 ? (
          <div className="chat-compose-length-row">
            <span
              className={
                msgLength >= maxMessageLength * 0.9
                  ? 'chat-compose-length danger'
                  : msgLength >= maxMessageLength * 0.75
                    ? 'chat-compose-length warning'
                    : 'chat-compose-length'
              }
            >
              {msgLength}/{maxMessageLength}
            </span>
          </div>
        ) : null}
        {sendHoldReason ? (
          <div className="chat-compose-prompt-estimate warning" role="status">
            {sendHoldReason}
          </div>
        ) : promptEstimate ? (
          <div className={`chat-compose-prompt-estimate ${promptEstimate.tone}`}>
            {promptEstimate.label}
          </div>
        ) : null}
        <div className="group-compose-actions group-compose-actions-single">
          <AppTooltip text={
              activeGroupTipRecipients.length === 0
                ? 'No other group members available to tip'
                : tipComposerOpen
                  ? 'Hide tip options'
                  : 'Open tip options'
            }>
            <button
              type="button"
              onClick={onToggleTipComposer}
              className={tipComposerOpen ? 'chat-tip-toggle group-compose-tip active' : 'chat-tip-toggle group-compose-tip'}
              disabled={
                tipping || sendingGroupMessage || processingGroupAction || uploadingImage || activeGroupTipRecipients.length === 0
              }
            >
              Tip
            </button>
          </AppTooltip>
        </div>
      </div>
    </div>
  );
}
