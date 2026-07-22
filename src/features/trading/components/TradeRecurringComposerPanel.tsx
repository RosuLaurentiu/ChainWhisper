import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  COTI_NETWORK,
  formatCotiAmount,
  sanitizeTokenAmountInput,
  TIP_NATIVE_TOKEN_SYMBOL,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { ResolvedTradeToken, TradeTokenPresetKey } from '../../../lib/appHelpers';
import { invertPriceInput } from '../../../lib/tradePricing';
import {
  RecurringCycleIcon,
  SHARE_LABEL,
  formatRecurringLiveLiquidityAmount,
  renderCarbonPriceReference
} from './P2PTradingPage.helpers';
import { TradeTokenSelect, type TradeComposerTokenOption } from './TradeComposerPanel';

type TradeRecurringComposerPanelProps = {
  actionNotice: ReactNode;
  copyWithFeedback: (value: string, key: string) => Promise<void>;
  createRecurringOrder: () => Promise<void>;
  createdRecurringOrderId: number | null;
  createdRecurringOrderLink: string;
  creatingRecurringOrder: boolean;
  editingRecurringOrder: TradeSnapshot | null;
  lastCopiedKey: string;
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBaseToken?: ResolvedTradeToken | null;
  recurringBuyPriceInput: string;
  recurringBuyReceiveEditable: boolean;
  recurringBuyReceiveInput: string;
  recurringBuyReceivePreview: string;
  recurringComposerCarbonPriceReference: CarbonPairReferenceDisplay | null;
  recurringHidePrivateAmounts: boolean;
  recurringPriceDisplayInverted: boolean;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringQuoteToken?: ResolvedTradeToken | null;
  recurringSellPriceInput: string;
  recurringSellReceiveEditable: boolean;
  recurringSellReceiveInput: string;
  recurringSellReceivePreview: string;
  setRecurringHidePrivateAmounts: (value: boolean) => void;
  setRecurringPriceDisplayInverted: Dispatch<SetStateAction<boolean>>;
  setRecurringRemoveBuyBudgetInput: (value: string) => void;
  setRecurringRemoveSellInventoryInput: (value: string) => void;
  swapRecurringOrderSides: () => void;
  tradeFeeEscrowContract: string;
  tradeFeeEscrowContractLabel: string;
  tradeFeeEscrowContractTitleLabel: string;
  tradeOfferBalanceSummaryLabel: string;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeOfferVerifyUrl?: string;
  tradeRequestBalanceSummaryLabel: string;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  tradeRequestVerifyUrl?: string;
  updateRecurringBuyLiquidityInput: (value: string) => void;
  updateRecurringBuyPriceInput: (value: string) => void;
  updateRecurringBuyReceiveInput: (value: string) => void;
  updateRecurringBuyReversePriceInput: (value: string) => void;
  updateRecurringSellLiquidityInput: (value: string) => void;
  updateRecurringSellPriceInput: (value: string) => void;
  updateRecurringSellReceiveInput: (value: string) => void;
  updateRecurringSellReversePriceInput: (value: string) => void;
  onOfferTokenSelectionChange: (value: TradeTokenPresetKey) => void;
  onRequestTokenSelectionChange: (value: TradeTokenPresetKey) => void;
  toggleRecurringBuyReceiveEditable: () => void;
  toggleRecurringSellReceiveEditable: () => void;
  onCotiNetwork: boolean;
  tradeRequiredFeeWei: bigint | null;
  tradeTokenOptions: TradeComposerTokenOption[];
  walletAddress: string;
};

const CREATED_RECURRING_ORDER_COPY_KEY = 'created-recurring-order-link';

export default function TradeRecurringComposerPanel({
  actionNotice,
  copyWithFeedback,
  createRecurringOrder,
  createdRecurringOrderId,
  createdRecurringOrderLink,
  creatingRecurringOrder,
  editingRecurringOrder,
  lastCopiedKey,
  recurringAddBuyBudgetInput,
  recurringAddSellInventoryInput,
  recurringBaseToken,
  recurringBuyPriceInput,
  recurringBuyReceiveEditable,
  recurringBuyReceiveInput,
  recurringBuyReceivePreview,
  recurringComposerCarbonPriceReference,
  recurringHidePrivateAmounts,
  recurringPriceDisplayInverted,
  recurringRemoveBuyBudgetInput,
  recurringRemoveSellInventoryInput,
  recurringQuoteToken,
  recurringSellPriceInput,
  recurringSellReceiveEditable,
  recurringSellReceiveInput,
  recurringSellReceivePreview,
  setRecurringHidePrivateAmounts,
  setRecurringPriceDisplayInverted,
  setRecurringRemoveBuyBudgetInput,
  setRecurringRemoveSellInventoryInput,
  swapRecurringOrderSides,
  tradeFeeEscrowContract,
  tradeFeeEscrowContractLabel,
  tradeFeeEscrowContractTitleLabel,
  tradeOfferBalanceSummaryLabel,
  tradeOfferTokenSelection,
  tradeOfferVerifyUrl,
  tradeRequestBalanceSummaryLabel,
  tradeRequestTokenSelection,
  tradeRequestVerifyUrl,
  updateRecurringBuyLiquidityInput,
  updateRecurringBuyPriceInput,
  updateRecurringBuyReceiveInput,
  updateRecurringBuyReversePriceInput,
  updateRecurringSellLiquidityInput,
  updateRecurringSellPriceInput,
  updateRecurringSellReceiveInput,
  updateRecurringSellReversePriceInput,
  onOfferTokenSelectionChange,
  onRequestTokenSelectionChange,
  toggleRecurringBuyReceiveEditable,
  toggleRecurringSellReceiveEditable,
  onCotiNetwork,
  tradeRequiredFeeWei,
  tradeTokenOptions,
  walletAddress
}: TradeRecurringComposerPanelProps) {
  const recurringTokenOptions = tradeTokenOptions.filter((option) => !option.value.startsWith('custom'));
  const recurringHasPrivateToken =
    recurringBaseToken?.kind === 'private-erc20' || recurringQuoteToken?.kind === 'private-erc20';
  const recurringPrivateAmountsHidden = recurringHasPrivateToken && recurringHidePrivateAmounts;
  const recurringPrivacyLabel =
    recurringBaseToken?.kind === 'private-erc20' && recurringQuoteToken?.kind === 'private-erc20'
      ? 'Fully private order'
      : recurringBaseToken?.kind === 'private-erc20' || recurringQuoteToken?.kind === 'private-erc20'
        ? 'Hybrid private order'
        : 'Public order';
  const recurringPrivateAmountCopy =
    !recurringHasPrivateToken
      ? 'Select a private token if this order should use COTI private-token settlement.'
      : recurringPrivateAmountsHidden
        ? 'Public views show the prices, but private-token order size and fill amounts stay hidden.'
        : 'Public views can show the entered order size; private-token transfers and receipts still use COTI privacy.';
  const recurringBaseSymbol = recurringBaseToken?.symbol ?? 'base';
  const recurringQuoteSymbol = recurringQuoteToken?.symbol ?? 'quote';
  const recurringDisplayedBuyPriceInput = recurringPriceDisplayInverted
    ? invertPriceInput(recurringBuyPriceInput)
    : recurringBuyPriceInput;
  const recurringDisplayedSellPriceInput = recurringPriceDisplayInverted
    ? invertPriceInput(recurringSellPriceInput)
    : recurringSellPriceInput;
  const recurringFeeSummaryLabel = editingRecurringOrder
    ? `0 ${TIP_NATIVE_TOKEN_SYMBOL}`
    : tradeRequiredFeeWei !== null
      ? `${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL}`
      : '--';
  const recurringActionReadinessLabel = creatingRecurringOrder
    ? editingRecurringOrder
      ? 'Saving recurring order'
      : 'Creating recurring order'
    : !walletAddress
      ? 'Connect wallet to continue'
      : !onCotiNetwork
        ? 'Switch to COTI network'
        : !editingRecurringOrder && tradeRequiredFeeWei === null
          ? 'Loading order fee'
          : 'Set prices and liquidity to create';
  const recurringActionReadinessClassName = [
    'trade-compose-readiness',
    creatingRecurringOrder
      ? 'trade-compose-readiness-busy'
      : walletAddress && onCotiNetwork && (editingRecurringOrder || tradeRequiredFeeWei !== null)
        ? 'trade-compose-readiness-ready'
        : 'trade-compose-readiness-blocked'
  ].join(' ');

  return (
    <>
      <div className="trade-compose-panel p2p-recurring-builder" role="group" aria-label="Recurring OTC order">
        <div className="trade-compose-header p2p-recurring-header">
          <strong>Reusable OTC order</strong>
          <div className="trade-compose-header-meta">
            <span>{recurringPrivacyLabel}</span>
            <a
              className="trade-compose-header-link"
              href={`${COTI_NETWORK.blockExplorerUrl}/address/${tradeFeeEscrowContract}`}
              target="_blank"
              rel="noreferrer"
              title={`Open ${tradeFeeEscrowContractTitleLabel}`}
            >
              {tradeFeeEscrowContractLabel}
            </a>
          </div>
        </div>

        <div className="p2p-recurring-pair-picker" aria-label="Recurring order pair">
          <label className="trade-compose-field trade-compose-asset-field p2p-recurring-asset-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Base</span>
              <strong className="trade-compose-field-value">Available {tradeOfferBalanceSummaryLabel}</strong>
            </span>
            <TradeTokenSelect
              options={recurringTokenOptions}
              value={tradeOfferTokenSelection}
              onChange={(value) => onOfferTokenSelectionChange(value as TradeTokenPresetKey)}
              excludedValues={[tradeRequestTokenSelection]}
              disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
              balanceLabel={tradeOfferBalanceSummaryLabel}
              verifyUrl={tradeOfferVerifyUrl}
            />
          </label>
          <button
            type="button"
            className="p2p-recurring-cycle-indicator"
            onClick={swapRecurringOrderSides}
            disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
            aria-label="Swap recurring token sides"
            title={
              editingRecurringOrder
                ? 'Token sides cannot be swapped while editing a live recurring order'
                : 'Swap recurring token sides'
            }
          >
            <RecurringCycleIcon />
          </button>
          <label className="trade-compose-field trade-compose-asset-field p2p-recurring-asset-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Quote</span>
              <strong className="trade-compose-field-value">Available {tradeRequestBalanceSummaryLabel}</strong>
            </span>
            <TradeTokenSelect
              options={recurringTokenOptions}
              value={tradeRequestTokenSelection}
              onChange={(value) => onRequestTokenSelectionChange(value as TradeTokenPresetKey)}
              excludedValues={[tradeOfferTokenSelection]}
              disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
              balanceLabel={tradeRequestBalanceSummaryLabel}
              verifyUrl={tradeRequestVerifyUrl}
            />
          </label>
          {recurringBaseToken && recurringQuoteToken ? (
            <div className="p2p-recurring-pair-price">
              {renderCarbonPriceReference(recurringComposerCarbonPriceReference, {
                fallbackLabel: 'Carbon price unavailable',
                fallbackTitle: 'Flip recurring price ratio',
                onToggle: () => setRecurringPriceDisplayInverted((value) => !value),
                pressed: recurringPriceDisplayInverted
              })}
            </div>
          ) : null}
        </div>

        <div className="trade-compose-grid p2p-recurring-side-grid">
          <section className="trade-compose-section trade-compose-section-sell p2p-recurring-side-panel p2p-recurring-side-panel-sell">
            <div className="p2p-recurring-side-head">
              <span>Sell side</span>
              <strong>Sell {recurringBaseToken?.symbol ?? 'base'}</strong>
              <small>
                {editingRecurringOrder
                  ? 'Edit the sell price. Liquidity is managed below.'
                  : 'Set the maker sell price. Liquidity is managed below.'}
              </small>
            </div>
            <label className="trade-compose-field p2p-recurring-price-field">
              <span>Sell price</span>
              <input
                className="trade-compose-input"
                type="text"
                inputMode="decimal"
                value={recurringDisplayedSellPriceInput}
                onChange={(event) =>
                  recurringPriceDisplayInverted
                    ? updateRecurringSellReversePriceInput(event.target.value)
                    : updateRecurringSellPriceInput(event.target.value)
                }
                placeholder="0"
                disabled={creatingRecurringOrder}
              />
            </label>
            {!editingRecurringOrder ? (
              <>
                <label className="trade-compose-field p2p-recurring-primary-field">
                  <span>Sell liquidity</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringAddSellInventoryInput}
                    onChange={(event) => updateRecurringSellLiquidityInput(event.target.value)}
                    placeholder="0"
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label
                  className={`trade-compose-field p2p-recurring-derived-field${
                    recurringSellReceiveEditable ? ' is-editing' : ''
                  }`}
                >
                  <span className="trade-compose-field-head">
                    <span>You buy</span>
                    <button
                      type="button"
                      className="p2p-recurring-derived-toggle"
                      onClick={toggleRecurringSellReceiveEditable}
                      aria-label={
                        recurringSellReceiveEditable
                          ? 'Preview amount bought on sell side'
                          : 'Edit amount bought on sell side'
                      }
                      disabled={creatingRecurringOrder}
                    >
                      {recurringSellReceiveEditable ? 'Preview' : 'Edit'}
                    </button>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringSellReceiveEditable ? recurringSellReceiveInput : recurringSellReceivePreview}
                    onChange={(event) => updateRecurringSellReceiveInput(event.target.value)}
                    placeholder="0"
                    readOnly={!recurringSellReceiveEditable}
                    disabled={creatingRecurringOrder}
                  />
                </label>
              </>
            ) : null}
          </section>

          <section className="trade-compose-section trade-compose-section-buy p2p-recurring-side-panel p2p-recurring-side-panel-buy">
            <div className="p2p-recurring-side-head">
              <span>Buy side</span>
              <strong>Buy {recurringBaseToken?.symbol ?? 'base'}</strong>
              <small>
                {editingRecurringOrder
                  ? 'Edit the buy price. Liquidity is managed below.'
                  : 'Set the maker buy price. Liquidity is managed below.'}
              </small>
            </div>
            <label className="trade-compose-field p2p-recurring-price-field">
              <span>Buy price</span>
              <input
                className="trade-compose-input"
                type="text"
                inputMode="decimal"
                value={recurringDisplayedBuyPriceInput}
                onChange={(event) =>
                  recurringPriceDisplayInverted
                    ? updateRecurringBuyReversePriceInput(event.target.value)
                    : updateRecurringBuyPriceInput(event.target.value)
                }
                placeholder="0"
                disabled={creatingRecurringOrder}
              />
            </label>
            {!editingRecurringOrder ? (
              <>
                <label className="trade-compose-field p2p-recurring-primary-field">
                  <span>Buy liquidity</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringAddBuyBudgetInput}
                    onChange={(event) => updateRecurringBuyLiquidityInput(event.target.value)}
                    placeholder="0"
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label
                  className={`trade-compose-field p2p-recurring-derived-field${
                    recurringBuyReceiveEditable ? ' is-editing' : ''
                  }`}
                >
                  <span className="trade-compose-field-head">
                    <span>You buy</span>
                    <button
                      type="button"
                      className="p2p-recurring-derived-toggle"
                      onClick={toggleRecurringBuyReceiveEditable}
                      aria-label={
                        recurringBuyReceiveEditable
                          ? 'Preview amount bought on buy side'
                          : 'Edit amount bought on buy side'
                      }
                      disabled={creatingRecurringOrder}
                    >
                      {recurringBuyReceiveEditable ? 'Preview' : 'Edit'}
                    </button>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringBuyReceiveEditable ? recurringBuyReceiveInput : recurringBuyReceivePreview}
                    onChange={(event) => updateRecurringBuyReceiveInput(event.target.value)}
                    placeholder="0"
                    readOnly={!recurringBuyReceiveEditable}
                    disabled={creatingRecurringOrder}
                  />
                </label>
              </>
            ) : null}
          </section>
        </div>

        <div className={`trade-compose-privacy-panel p2p-recurring-privacy-note${recurringHasPrivateToken ? ' is-private' : ''}`}>
          <div className="trade-compose-privacy-copy">
            <span>Order privacy</span>
            <strong>
              {recurringHasPrivateToken
                ? recurringPrivateAmountsHidden
                  ? 'Private-token amounts hidden'
                  : 'Private-token amounts visible'
                : 'Public amounts visible'}
            </strong>
          </div>
          <p className="trade-compose-privacy-help">{recurringPrivateAmountCopy}</p>
          {recurringHasPrivateToken ? (
            <div
              className="trade-compose-privacy-toggle p2p-recurring-privacy-toggle"
              role="group"
              aria-label="Private-token amount visibility"
            >
              <button
                type="button"
                className={recurringHidePrivateAmounts ? 'active' : undefined}
                onClick={() => setRecurringHidePrivateAmounts(true)}
                aria-pressed={recurringHidePrivateAmounts}
                disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
              >
                Private liquidity
              </button>
              <button
                type="button"
                className={!recurringHidePrivateAmounts ? 'active' : undefined}
                onClick={() => setRecurringHidePrivateAmounts(false)}
                aria-pressed={!recurringHidePrivateAmounts}
                disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
              >
                Visible amounts
              </button>
            </div>
          ) : null}
        </div>

        {editingRecurringOrder ? (
          <div className="p2p-recurring-edit-liquidity">
            <div className="p2p-recurring-edit-liquidity-head">
              <div>
                <span>Live liquidity</span>
                <strong>Edit funding without changing this order link.</strong>
              </div>
            </div>
            <div className="p2p-recurring-grid p2p-recurring-assets p2p-recurring-add-funds">
              <section className="p2p-recurring-liquidity-edit-card">
                <div>
                  <span>Sell liquidity</span>
                  <strong>{formatRecurringLiveLiquidityAmount(editingRecurringOrder, 'sell')}</strong>
                </div>
                <label className="trade-compose-field">
                  <span>Add</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringAddSellInventoryInput}
                    onChange={(event) => updateRecurringSellLiquidityInput(event.target.value)}
                    placeholder={`0 ${recurringBaseSymbol}`}
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label
                  className={`trade-compose-field p2p-recurring-derived-field${
                    recurringSellReceiveEditable ? ' is-editing' : ''
                  }`}
                >
                  <span className="trade-compose-field-head">
                    <span>You buy</span>
                    <button
                      type="button"
                      className="p2p-recurring-derived-toggle"
                      onClick={toggleRecurringSellReceiveEditable}
                      aria-label={
                        recurringSellReceiveEditable
                          ? 'Preview amount bought on sell side'
                          : 'Edit amount bought on sell side'
                      }
                      disabled={creatingRecurringOrder}
                    >
                      {recurringSellReceiveEditable ? 'Preview' : 'Edit'}
                    </button>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringSellReceiveEditable ? recurringSellReceiveInput : recurringSellReceivePreview}
                    onChange={(event) => updateRecurringSellReceiveInput(event.target.value)}
                    placeholder={`Estimated ${recurringQuoteSymbol}`}
                    readOnly={!recurringSellReceiveEditable}
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label className="trade-compose-field">
                  <span>Remove</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringRemoveSellInventoryInput}
                    onChange={(event) => setRecurringRemoveSellInventoryInput(sanitizeTokenAmountInput(event.target.value))}
                    placeholder={`0 ${recurringBaseSymbol}`}
                    disabled={creatingRecurringOrder}
                  />
                </label>
              </section>
              <section className="p2p-recurring-liquidity-edit-card">
                <div>
                  <span>Buy liquidity</span>
                  <strong>{formatRecurringLiveLiquidityAmount(editingRecurringOrder, 'buy')}</strong>
                </div>
                <label className="trade-compose-field">
                  <span>Add</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringAddBuyBudgetInput}
                    onChange={(event) => updateRecurringBuyLiquidityInput(event.target.value)}
                    placeholder={`0 ${recurringQuoteSymbol}`}
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label
                  className={`trade-compose-field p2p-recurring-derived-field${
                    recurringBuyReceiveEditable ? ' is-editing' : ''
                  }`}
                >
                  <span className="trade-compose-field-head">
                    <span>You buy</span>
                    <button
                      type="button"
                      className="p2p-recurring-derived-toggle"
                      onClick={toggleRecurringBuyReceiveEditable}
                      aria-label={
                        recurringBuyReceiveEditable
                          ? 'Preview amount bought on buy side'
                          : 'Edit amount bought on buy side'
                      }
                      disabled={creatingRecurringOrder}
                    >
                      {recurringBuyReceiveEditable ? 'Preview' : 'Edit'}
                    </button>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringBuyReceiveEditable ? recurringBuyReceiveInput : recurringBuyReceivePreview}
                    onChange={(event) => updateRecurringBuyReceiveInput(event.target.value)}
                    placeholder={`Estimated ${recurringBaseSymbol}`}
                    readOnly={!recurringBuyReceiveEditable}
                    disabled={creatingRecurringOrder}
                  />
                </label>
                <label className="trade-compose-field">
                  <span>Remove</span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    value={recurringRemoveBuyBudgetInput}
                    onChange={(event) => setRecurringRemoveBuyBudgetInput(sanitizeTokenAmountInput(event.target.value))}
                    placeholder={`0 ${recurringQuoteSymbol}`}
                    disabled={creatingRecurringOrder}
                  />
                </label>
              </section>
            </div>
          </div>
        ) : null}

        <div className="p2p-recurring-fill-handling">
          <span>Funding and fills</span>
          <p>Liquidity stays in this order and cycles between sides. Closing the order returns remaining funds to the maker.</p>
        </div>

        <div className="trade-compose-bottom p2p-recurring-actions">
          <p className="p2p-recurring-action-copy">
            {editingRecurringOrder
              ? 'Save prices and liquidity changes without changing the link.'
              : 'Set buy and sell prices, then fund buy liquidity, sell liquidity, or both.'}
          </p>
          <div className="trade-compose-fee-row trade-compose-fee-row-inline p2p-recurring-action-fee">
            <div className="trade-compose-fee-copy">
              <span className="trade-compose-field-label">Fee</span>
              <strong className="trade-compose-fee-value">{recurringFeeSummaryLabel}</strong>
              <span className="trade-compose-fee-note">
                {editingRecurringOrder ? 'No create fee for edits.' : 'Fee may vary before submit.'}
              </span>
            </div>
          </div>
          <div className="trade-compose-action-stack p2p-recurring-action-stack">
            {actionNotice ? (
              <div className="trade-compose-action-notice-slot">{actionNotice}</div>
            ) : (
              <p className={recurringActionReadinessClassName} role="status">
                {recurringActionReadinessLabel}
              </p>
            )}
            <button
              type="button"
              className="trade-compose-send"
              onClick={() => createRecurringOrder().catch(() => {})}
              disabled={creatingRecurringOrder}
            >
              {creatingRecurringOrder
                ? editingRecurringOrder
                  ? 'Saving...'
                  : 'Creating...'
                : editingRecurringOrder
                  ? 'Save Recurring Order'
                  : 'Create Recurring Order'}
            </button>
          </div>
        </div>
        <div className="trade-compose-warning">
          <p>
            <strong>OTC safety check:</strong> Verify token contracts, buy/sell prices, and funded liquidity before
            signing. Buy and sell prices are independent.
          </p>
        </div>
      </div>
      {createdRecurringOrderLink ? (
        <div className="standalone-trade-created">
          <div>
            <span>Recurring order #{createdRecurringOrderId}</span>
            <strong>{createdRecurringOrderLink.replace(/^https?:\/\//, '')}</strong>
          </div>
          <button
            type="button"
            className={lastCopiedKey === CREATED_RECURRING_ORDER_COPY_KEY ? 'copied' : undefined}
            onClick={() => copyWithFeedback(createdRecurringOrderLink, CREATED_RECURRING_ORDER_COPY_KEY).catch(() => {})}
            title={
              lastCopiedKey === CREATED_RECURRING_ORDER_COPY_KEY
                ? 'Recurring order link copied'
                : 'Share recurring order link'
            }
            aria-label={lastCopiedKey === CREATED_RECURRING_ORDER_COPY_KEY ? 'Shared' : SHARE_LABEL}
            aria-live="polite"
          >
            {lastCopiedKey === CREATED_RECURRING_ORDER_COPY_KEY ? 'Shared' : SHARE_LABEL}
          </button>
        </div>
      ) : null}
    </>
  );
}
