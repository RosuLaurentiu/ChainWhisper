import { ArrowRight } from 'lucide-react';
import type { FormEventHandler, ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import { getOtcSwapSourceLabel, type OtcSwapInputMode, type OtcSwapQuoteCandidate } from '../../../lib/otcSwapQuote';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import { TradeTokenSelect, type TradeComposerTokenOption } from './TradeComposerPanel';

type OtcSwapPanelProps = {
  tradeEntryModeTabs: ReactNode;
  actionMode: OtcSwapInputMode;
  linkedActionModes: Record<OtcSwapInputMode, boolean>;
  orderLinkInput: string;
  orderLinkError: string;
  pinnedTradeKey: string;
  pinnedTrade: TradeSnapshot | null;
  sellBalanceLabel: string;
  sellBalanceTitle: string;
  sellAmountInput: string;
  sellTokenSelection: TradeTokenPresetKey;
  sellVerifyUrl?: string;
  buyAmountInput: string;
  buyTokenSelection: TradeTokenPresetKey;
  buyVerifyUrl?: string;
  tokenOptions: TradeComposerTokenOption[];
  displayQuote: OtcSwapQuoteCandidate | null;
  bestQuote: OtcSwapQuoteCandidate | null;
  carbonReference: CarbonPairReferenceDisplay | null;
  priceDisplayInverted: boolean;
  marketLabel: string;
  reviewDisabled: boolean;
  reviewLabel: string;
  onActionModeChange: (mode: OtcSwapInputMode) => void;
  onSubmitOrderLink: FormEventHandler<HTMLFormElement>;
  onOrderLinkInputChange: (value: string) => void;
  onClearPinnedOrder: () => void;
  onSellAmountInputChange: (value: string) => void;
  onBuyAmountInputChange: (value: string) => void;
  onTokenSelectionChange: (side: 'sell' | 'buy', value: TradeTokenPresetKey) => void;
  onFlipTokens: () => void;
  onTogglePriceInverted: () => void;
  onCreateLimitOrder: () => void;
  onBrowseDesk: () => void;
  onExecuteQuote: () => Promise<void>;
  onOpenCurrentOrder: () => void;
  formatAvailability: (quote?: OtcSwapQuoteCandidate | null) => string;
};

export default function OtcSwapPanel({
  tradeEntryModeTabs,
  actionMode,
  linkedActionModes,
  orderLinkInput,
  orderLinkError,
  pinnedTradeKey,
  pinnedTrade,
  sellBalanceLabel,
  sellBalanceTitle,
  sellAmountInput,
  sellTokenSelection,
  sellVerifyUrl,
  buyAmountInput,
  buyTokenSelection,
  buyVerifyUrl,
  tokenOptions,
  displayQuote,
  bestQuote,
  carbonReference,
  priceDisplayInverted,
  marketLabel,
  reviewDisabled,
  reviewLabel,
  onActionModeChange,
  onSubmitOrderLink,
  onOrderLinkInputChange,
  onClearPinnedOrder,
  onSellAmountInputChange,
  onBuyAmountInputChange,
  onTokenSelectionChange,
  onFlipTokens,
  onTogglePriceInverted,
  onCreateLimitOrder,
  onBrowseDesk,
  onExecuteQuote,
  onOpenCurrentOrder,
  formatAvailability
}: OtcSwapPanelProps) {
  return (
    <section className="standalone-trades-section p2p-swap-section p2p-trade-workspace-panel" aria-label="OTC swap">
      <div className="p2p-trade-entry-panel">
        {tradeEntryModeTabs}
        <div className="p2p-swap-panel">
          <div className="p2p-swap-side-switch" role="tablist" aria-label="Swap action">
            <button
              type="button"
              className={actionMode === 'sell' ? 'active' : undefined}
              onClick={() => {
                if (linkedActionModes.sell) {
                  onActionModeChange('sell');
                }
              }}
              role="tab"
              aria-selected={actionMode === 'sell'}
              disabled={!linkedActionModes.sell}
              title={!linkedActionModes.sell ? 'This linked order cannot be sold into.' : undefined}
            >
              Sell
            </button>
            <button
              type="button"
              className={actionMode === 'buy' ? 'active' : undefined}
              onClick={() => {
                if (linkedActionModes.buy) {
                  onActionModeChange('buy');
                }
              }}
              role="tab"
              aria-selected={actionMode === 'buy'}
              disabled={!linkedActionModes.buy}
              title={!linkedActionModes.buy ? 'This linked order cannot be bought from.' : undefined}
            >
              Buy
            </button>
          </div>

          <div className={`p2p-swap-link-panel${pinnedTradeKey ? ' p2p-swap-link-panel-pinned' : ''}`}>
            <form className="p2p-swap-link-form" onSubmit={onSubmitOrderLink}>
              <input
                type="text"
                value={orderLinkInput}
                onChange={(event) => onOrderLinkInputChange(event.target.value)}
                placeholder="Paste offer link, code, or id"
                aria-label="Offer link, code, or id"
              />
              <button type="submit">Open</button>
            </form>
            {pinnedTradeKey ? (
              <div className="p2p-swap-linked-order">
                <span>
                  {pinnedTrade
                    ? `Linked ${getOtcSwapSourceLabel(pinnedTrade.recurringOrder ? 'recurring' : 'standard')} #${
                        pinnedTrade.recurringOrder?.orderId ?? pinnedTrade.tradeId
                      }`
                    : 'Opening linked order'}
                </span>
                <button type="button" onClick={onClearPinnedOrder}>
                  Clear
                </button>
              </div>
            ) : null}
            {orderLinkError ? <p className="p2p-swap-link-error">{orderLinkError}</p> : null}
          </div>

          <div className="p2p-swap-card p2p-swap-card-sell">
            <div className="p2p-swap-card-head">
              <span>Sell</span>
              <small title={sellBalanceTitle}>{sellBalanceLabel}</small>
            </div>
            <div className="p2p-swap-card-body">
              <input
                type="text"
                inputMode="decimal"
                value={sellAmountInput}
                onChange={(event) => onSellAmountInputChange(event.target.value)}
                placeholder="0"
                aria-label="Sell amount"
              />
              <TradeTokenSelect
                options={tokenOptions}
                value={sellTokenSelection}
                onChange={(value) => onTokenSelectionChange('sell', value as TradeTokenPresetKey)}
                excludedValues={[buyTokenSelection]}
                balanceLabel={sellBalanceLabel}
                verifyUrl={sellVerifyUrl}
              />
            </div>
          </div>

          <button
            type="button"
            className="p2p-swap-token-flip"
            onClick={onFlipTokens}
            aria-label="Swap selected tokens"
            title="Swap selected tokens"
          >
            <ArrowRight size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>

          <div className="p2p-swap-card p2p-swap-card-buy">
            <div className="p2p-swap-card-head">
              <span>Buy</span>
              <small>{displayQuote ? getOtcSwapSourceLabel(displayQuote.sourceType) : 'Best single order'}</small>
            </div>
            <div className="p2p-swap-card-body">
              <input
                type="text"
                inputMode="decimal"
                value={buyAmountInput}
                onChange={(event) => onBuyAmountInputChange(event.target.value)}
                placeholder="0"
                aria-label="Buy amount"
              />
              <TradeTokenSelect
                options={tokenOptions}
                value={buyTokenSelection}
                onChange={(value) => onTokenSelectionChange('buy', value as TradeTokenPresetKey)}
                excludedValues={[sellTokenSelection]}
                verifyUrl={buyVerifyUrl}
              />
            </div>
          </div>

          <div className="p2p-swap-quote-grid" aria-label="Price comparison">
            <div className="p2p-swap-quote-card">
              <span>Carbon reference</span>
              {carbonReference ? (
                <button
                  type="button"
                  className="p2p-swap-price-toggle"
                  onClick={onTogglePriceInverted}
                  aria-pressed={priceDisplayInverted}
                  title={carbonReference.title}
                >
                  {carbonReference.label}
                </button>
              ) : (
                <strong>Carbon price unavailable</strong>
              )}
            </div>
            <div className="p2p-swap-quote-card p2p-swap-quote-card-chainwhisper">
              <span>ChainWhisper</span>
              <strong className="p2p-swap-market-price-label">{marketLabel}</strong>
            </div>
          </div>

          {displayQuote ? (
            <div className="p2p-swap-order-summary">
              <div>
                <span>{pinnedTradeKey ? 'Linked order' : 'Best order'}</span>
                <strong>
                  {getOtcSwapSourceLabel(displayQuote.sourceType)} #{displayQuote.tradeId}
                </strong>
              </div>
              <div>
                <span>Availability</span>
                <strong>{formatAvailability(displayQuote)}</strong>
              </div>
            </div>
          ) : (
            <div className="p2p-swap-order-empty">
              <strong>{pinnedTradeKey ? 'Linked order is open for review.' : 'No single order for this pair yet.'}</strong>
              <p>
                {pinnedTradeKey
                  ? 'Clear the linked order to return to the best available order.'
                  : 'Create a limit order at your price, or browse public offers.'}
              </p>
              {pinnedTradeKey ? (
                <button type="button" className="standalone-trade-secondary-btn" onClick={onClearPinnedOrder}>
                  Clear link
                </button>
              ) : (
                <div className="p2p-swap-empty-actions">
                  <button type="button" className="trade-card-action trade-card-action-accept" onClick={onCreateLimitOrder}>
                    Create limit order
                  </button>
                  <button type="button" className="standalone-trade-secondary-btn" onClick={onBrowseDesk}>
                    Browse Desk
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="p2p-swap-actions">
            <button
              type="button"
              className="trade-card-action trade-card-action-accept p2p-swap-review"
              onClick={() => {
                onExecuteQuote().catch(() => {});
              }}
              disabled={reviewDisabled}
            >
              {reviewLabel}
            </button>
            {bestQuote || pinnedTrade ? (
              <button type="button" className="standalone-trade-secondary-btn" onClick={onOpenCurrentOrder}>
                Open order
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
