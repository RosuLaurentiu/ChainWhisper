import type { ReactNode, Ref } from 'react';
import ChatSendIcon from './ChatSendIcon';
import { TIP_NATIVE_TOKEN_SYMBOL, type TipTokenSelection } from '../lib/appShared';

type DirectChatComposeProps = {
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

export default function DirectChatCompose({
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
}: DirectChatComposeProps) {
  return (
    <div className={tradeComposerOpen ? 'chat-compose trade-compose-active' : 'chat-compose'}>
      {replyPreviewText ? (
        <div className="chat-replying">
          <span>Replying to: {replyPreviewText}</span>
          <button type="button" onClick={onCancelReply}>
            Cancel
          </button>
        </div>
      ) : null}
      {tipComposerOpen ? (
        <div className="chat-tip-panel" role="group" aria-label="Tip settings">
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
              disabled={!canSendTipFromComposer}
              title={
                tipAmountWeiFromInput <= 0n
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
            <span>Balance: {tipBalanceSummaryLabel}</span>
          </div>
          {tipAmountExceedsBalance ? (
            <p className="chat-tip-warning">Amount exceeds available balance.</p>
          ) : null}
        </div>
      ) : null}
      {tradeComposerOpen ? tradeComposerContent : null}
      <div className="chat-compose-main">
        <div className="chat-compose-entry">
          <div
            ref={composerRef}
            className="chat-compose-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline={isMobileNav}
            aria-label="Message"
            data-placeholder="Type a message"
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
            type="button"
            className="chat-compose-send"
            onClick={onSendMessage}
            disabled={sending || tipping}
            aria-label={sending ? 'Sending message' : 'Send message'}
            title={sending ? 'Sending...' : 'Send message'}
          >
            <ChatSendIcon />
          </button>
        </div>
        <div className="chat-compose-actions">
          <button
            type="button"
            onClick={onToggleTipComposer}
            className={tipComposerOpen ? 'chat-tip-toggle active' : 'chat-tip-toggle'}
            disabled={tipToggleDisabled}
            title={tipToggleTitle}
          >
            Tip
          </button>
          <button
            type="button"
            onClick={onToggleTradeComposer}
            className={tradeComposerOpen ? 'chat-tip-toggle active' : 'chat-tip-toggle'}
            disabled={tradeToggleDisabled}
            title={tradeToggleTitle}
          >
            Trade
          </button>
        </div>
      </div>
    </div>
  );
}
