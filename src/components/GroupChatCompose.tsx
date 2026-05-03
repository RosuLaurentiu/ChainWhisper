import { useRef, useState, type Ref } from 'react';
import ChatSendIcon from './ChatSendIcon';
import ChatImageIcon from './ChatImageIcon';
import ImageAttachmentPreview from './ImageAttachmentPreview';
import { TIP_NATIVE_TOKEN_SYMBOL, type TipTokenSelection } from '../lib/appShared';
import { CHAT_IMAGE_FILE_ACCEPT } from '../lib/imagePull';
import type { ImageAttachmentPreviewState } from '../lib/imageAttachmentPreview';
import { insertChatComposerLineBreak, syncChatComposerText } from './chatComposeText';

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
  onMessageInputChange
}: GroupChatComposeProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [msgLength, setMsgLength] = useState(0);

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
            <button
              className="chat-tip-send"
              type="button"
              onClick={onSendTip}
              disabled={!canSendGroupTipFromComposer}
              title={
                !selectedGroupTipRecipient
                  ? 'Select a member'
                  : tipAmountWeiFromInput <= 0n
                    ? 'Enter a tip amount'
                    : tipAmountExceedsBalance
                      ? `Amount exceeds your ${activeTipTokenSymbol} balance`
                      : `Send ${tipAmountSummaryLabel}`
              }
            >
              {tipping ? 'Sending tip...' : `Send ${activeTipTokenSymbol}`}
            </button>
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
        <ImageAttachmentPreview status={imageAttachmentStatus} onDismiss={onDismissImageAttachmentStatus} />
      ) : null}
      <div className="group-compose-main">
        <div className="group-compose-entry">
          <input
            ref={imageInputRef}
            type="file"
            accept={CHAT_IMAGE_FILE_ACCEPT}
            hidden
            disabled={imageAttachDisabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (!file) {
                return;
              }
              onSendImage(file);
            }}
          />
          <button
            type="button"
            className="chat-compose-attach chat-compose-attach-icon"
            onClick={() => {
              imageInputRef.current?.click();
            }}
            disabled={imageAttachDisabled}
            aria-label={uploadingImage ? 'Preparing image' : 'Attach image'}
            title={imageAttachTitle}
          >
            <ChatImageIcon />
          </button>
          <div
            ref={composerRef}
            className="chat-compose-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
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
                onSendMessage();
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
              if (imageAttachDisabled) {
                return;
              }
              const file = imageItem.getAsFile();
              if (file) {
                onSendImage(file);
              }
            }}
          />
          <button
            className="group-compose-send chat-compose-send"
            type="button"
            onClick={onSendMessage}
            disabled={sendingGroupMessage || processingGroupAction || uploadingImage}
            aria-label={
              sendingGroupMessage ? 'Sending group message' : uploadingImage ? 'Preparing image' : 'Send group message'
            }
            title={sendingGroupMessage ? 'Sending...' : uploadingImage ? 'Preparing image...' : 'Send group message'}
          >
            <ChatSendIcon />
          </button>
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
        <div className="group-compose-actions group-compose-actions-single">
          <button
            type="button"
            onClick={onToggleTipComposer}
            className={tipComposerOpen ? 'chat-tip-toggle group-compose-tip active' : 'chat-tip-toggle group-compose-tip'}
            disabled={
              tipping || sendingGroupMessage || processingGroupAction || uploadingImage || activeGroupTipRecipients.length === 0
            }
            title={
              activeGroupTipRecipients.length === 0
                ? 'No other group members available to tip'
                : tipComposerOpen
                  ? 'Hide tip options'
                  : 'Open tip options'
            }
          >
            Tip
          </button>
        </div>
      </div>
    </div>
  );
}
