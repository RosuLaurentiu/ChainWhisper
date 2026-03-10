import type { Ref } from 'react';
import { TIP_NATIVE_TOKEN_SYMBOL, type GroupFeeModeSelection, type TipTokenSelection } from '../lib/appShared';

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
  groupFeeModeSelection: GroupFeeModeSelection;
  onToggleGroupFeeMode: () => void;
  selectedGroupFeeLabel: string;
  sendingGroupMessage: boolean;
  processingGroupAction: boolean;
  composerRef: Ref<HTMLDivElement>;
  isMobileNav: boolean;
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
  groupFeeModeSelection,
  onToggleGroupFeeMode,
  selectedGroupFeeLabel,
  sendingGroupMessage,
  processingGroupAction,
  composerRef,
  isMobileNav,
  onSendMessage,
  maxMessageLength,
  onMessageInputChange
}: GroupChatComposeProps) {
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
      <div className="group-compose-main">
        <button
          type="button"
          className={
            groupFeeModeSelection === 'token'
              ? 'group-fee-toggle group-fee-toggle-compact token'
              : 'group-fee-toggle group-fee-toggle-compact coti'
          }
          onClick={onToggleGroupFeeMode}
          disabled={sendingGroupMessage || processingGroupAction}
          aria-label="Toggle group fee mode"
          aria-pressed={groupFeeModeSelection === 'token'}
          title={
            groupFeeModeSelection === 'coti'
              ? `${selectedGroupFeeLabel}. Click to switch to ${rewardTokenSymbol} mode.`
              : `${selectedGroupFeeLabel}. Click to switch to COTI mode.`
          }
        >
          {groupFeeModeSelection === 'token' ? rewardTokenSymbol : 'COTI'}
        </button>
        <div
          ref={composerRef}
          className="chat-compose-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline={isMobileNav}
          aria-label="Group message"
          data-placeholder="Type a group message"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isMobileNav) {
              event.preventDefault();
              onSendMessage();
            }
          }}
          onInput={(event) => {
            const raw = event.currentTarget.textContent ?? '';
            const normalized = raw.replace(/\r/g, '');
            const nextValue = isMobileNav ? normalized : normalized.replace(/\n/g, '');
            const capped = nextValue.slice(0, maxMessageLength);
            if (capped !== raw) {
              event.currentTarget.textContent = capped;
            }
            onMessageInputChange(capped);
          }}
        />
        <button
          className="group-compose-send"
          type="button"
          onClick={onSendMessage}
          disabled={sendingGroupMessage || processingGroupAction}
        >
          {sendingGroupMessage ? 'Sending...' : 'Send'}
        </button>
        <button
          type="button"
          onClick={onToggleTipComposer}
          className={tipComposerOpen ? 'chat-tip-toggle active' : 'chat-tip-toggle'}
          disabled={tipping || sendingGroupMessage || processingGroupAction || activeGroupTipRecipients.length === 0}
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
  );
}
