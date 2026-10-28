import type { ReactNode } from 'react';
import {
  formatCotiAmount,
  sanitizeTokenAmountInput,
  TIP_NATIVE_TOKEN_SYMBOL,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { ResolvedTradeToken } from '../../../lib/appHelpers';
import { invertPriceInput } from '../../../lib/tradePricing';
import { SHARE_LABEL, formatRecurringLiveLiquidityAmount } from './P2PTradingPage.helpers';

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
  recurringHidePrivateAmounts: boolean;
  recurringPriceDisplayInverted: boolean;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringQuoteToken?: ResolvedTradeToken | null;
  recurringSellPriceInput: string;
  recurringSellReceiveEditable: boolean;
  recurringSellReceiveInput: string;
  recurringSellReceivePreview: string;
  recurringBaseBalanceLabel: string;
  recurringQuoteBalanceLabel: string;
  recurringBaseMaxInputValue: string;
  recurringQuoteMaxInputValue: string;
  canUseRecurringBaseMax: boolean;
  canUseRecurringQuoteMax: boolean;
  setRecurringHidePrivateAmounts: (value: boolean) => void;
  setRecurringRemoveBuyBudgetInput: (value: string) => void;
  setRecurringRemoveSellInventoryInput: (value: string) => void;
  tradeFeeEscrowContract: string;
  tradeFeeEscrowContractLabel: string;
  tradeFeeEscrowContractTitleLabel: string;
  updateRecurringBuyLiquidityInput: (value: string) => void;
  updateRecurringBuyPriceInput: (value: string) => void;
  updateRecurringBuyReceiveInput: (value: string) => void;
  updateRecurringBuyReversePriceInput: (value: string) => void;
  updateRecurringSellLiquidityInput: (value: string) => void;
  updateRecurringSellPriceInput: (value: string) => void;
  updateRecurringSellReceiveInput: (value: string) => void;
  updateRecurringSellReversePriceInput: (value: string) => void;
  toggleRecurringBuyReceiveEditable: () => void;
  toggleRecurringSellReceiveEditable: () => void;
  onCotiNetwork: boolean;
  tradeRequiredFeeWei: bigint | null;
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
  recurringHidePrivateAmounts,
  recurringPriceDisplayInverted,
  recurringRemoveBuyBudgetInput,
  recurringRemoveSellInventoryInput,
  recurringQuoteToken,
  recurringSellPriceInput,
  recurringSellReceiveEditable,
  recurringSellReceiveInput,
  recurringSellReceivePreview,
  recurringBaseBalanceLabel,
  recurringQuoteBalanceLabel,
  recurringBaseMaxInputValue,
  recurringQuoteMaxInputValue,
  canUseRecurringBaseMax,
  canUseRecurringQuoteMax,
  setRecurringHidePrivateAmounts,
  setRecurringRemoveBuyBudgetInput,
  setRecurringRemoveSellInventoryInput,
  updateRecurringBuyLiquidityInput,
  updateRecurringBuyPriceInput,
  updateRecurringBuyReceiveInput,
  updateRecurringBuyReversePriceInput,
  updateRecurringSellLiquidityInput,
  updateRecurringSellPriceInput,
  updateRecurringSellReceiveInput,
  updateRecurringSellReversePriceInput,
  toggleRecurringBuyReceiveEditable,
  toggleRecurringSellReceiveEditable,
  onCotiNetwork,
  tradeRequiredFeeWei,
  walletAddress
}: TradeRecurringComposerPanelProps) {
  const recurringHasPrivateToken =
    recurringBaseToken?.kind === 'private-erc20' || recurringQuoteToken?.kind === 'private-erc20';
  const recurringBaseSymbol = recurringBaseToken?.symbol ?? 'base';
  const recurringQuoteSymbol = recurringQuoteToken?.symbol ?? 'quote';
  const recurringDisplayedBaseSymbol = recurringPriceDisplayInverted
    ? recurringQuoteSymbol
    : recurringBaseSymbol;
  const recurringDisplayedQuoteSymbol = recurringPriceDisplayInverted
    ? recurringBaseSymbol
    : recurringQuoteSymbol;
  const recurringSellAction = recurringPriceDisplayInverted ? 'Buy' : 'Sell';
  const recurringBuyAction = recurringPriceDisplayInverted ? 'Sell' : 'Buy';
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
      <div className="trade-compose-panel p2p-recurring-builder" role="group" aria-label="Recurring P2P order">
        <div className="trade-compose-grid p2p-recurring-side-grid">
          <section className={`trade-compose-section p2p-recurring-side-panel p2p-recurring-side-panel-${recurringPriceDisplayInverted ? 'buy' : 'sell'}`}>
            <div className="p2p-recurring-side-head">
              <span>{recurringSellAction} side</span>
              <strong>{recurringSellAction} {recurringDisplayedBaseSymbol}</strong>
              <small>Spend {recurringBaseSymbol} · receive {recurringQuoteSymbol}</small>
            </div>
            <label className="trade-compose-field p2p-recurring-price-field">
              <span className="trade-compose-field-head">
                <span>{recurringSellAction} price</span>
                <strong>{recurringDisplayedQuoteSymbol} per {recurringDisplayedBaseSymbol}</strong>
              </span>
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
                <div className="trade-compose-field p2p-recurring-primary-field">
                  <span className="trade-compose-field-head">
                    <span>Starting inventory</span>
                    <span className="trade-compose-field-tools">
                      <span>Available: {recurringBaseBalanceLabel}</span>
                      <button
                        type="button"
                        className="trade-compose-max"
                        onClick={() => updateRecurringSellLiquidityInput(recurringBaseMaxInputValue)}
                        disabled={!canUseRecurringBaseMax || creatingRecurringOrder}
                      >
                        Max
                      </button>
                    </span>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    aria-label={`Starting inventory in ${recurringBaseSymbol}`}
                    value={recurringAddSellInventoryInput}
                    onChange={(event) => updateRecurringSellLiquidityInput(event.target.value)}
                    placeholder="0"
                    disabled={creatingRecurringOrder}
                  />
                  <span className="p2p-recurring-receive-preview">
                    Receive ≈ <strong>{recurringSellReceivePreview || '--'} {recurringQuoteSymbol}</strong>
                  </span>
                </div>
              </>
            ) : null}
          </section>

          <section className={`trade-compose-section p2p-recurring-side-panel p2p-recurring-side-panel-${recurringPriceDisplayInverted ? 'sell' : 'buy'}`}>
            <div className="p2p-recurring-side-head">
              <span>{recurringBuyAction} side</span>
              <strong>{recurringBuyAction} {recurringDisplayedBaseSymbol}</strong>
              <small>Spend {recurringQuoteSymbol} · receive {recurringBaseSymbol}</small>
            </div>
            <label className="trade-compose-field p2p-recurring-price-field">
              <span className="trade-compose-field-head">
                <span>{recurringBuyAction} price</span>
                <strong>{recurringDisplayedQuoteSymbol} per {recurringDisplayedBaseSymbol}</strong>
              </span>
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
                <div className="trade-compose-field p2p-recurring-primary-field">
                  <span className="trade-compose-field-head">
                    <span>Starting budget</span>
                    <span className="trade-compose-field-tools">
                      <span>Available: {recurringQuoteBalanceLabel}</span>
                      <button
                        type="button"
                        className="trade-compose-max"
                        onClick={() => updateRecurringBuyLiquidityInput(recurringQuoteMaxInputValue)}
                        disabled={!canUseRecurringQuoteMax || creatingRecurringOrder}
                      >
                        Max
                      </button>
                    </span>
                  </span>
                  <input
                    className="trade-compose-input"
                    type="text"
                    inputMode="decimal"
                    aria-label={`Starting budget in ${recurringQuoteSymbol}`}
                    value={recurringAddBuyBudgetInput}
                    onChange={(event) => updateRecurringBuyLiquidityInput(event.target.value)}
                    placeholder="0"
                    disabled={creatingRecurringOrder}
                  />
                  <span className="p2p-recurring-receive-preview">
                    Receive ≈ <strong>{recurringBuyReceivePreview || '--'} {recurringBaseSymbol}</strong>
                  </span>
                </div>
              </>
            ) : null}
          </section>
        </div>

        <div className={`trade-compose-privacy-panel p2p-recurring-privacy-note${recurringHasPrivateToken ? ' is-private' : ''}`}>
          <div className="trade-compose-privacy-copy">
            <strong>Amounts</strong>
          </div>
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

        <div className="trade-compose-bottom p2p-recurring-actions">
          <div className="trade-compose-fee-row trade-compose-fee-row-inline p2p-recurring-action-fee">
            <div className="trade-compose-fee-copy">
              <span className="trade-compose-field-label">Fee</span>
              <strong className="trade-compose-fee-value">{recurringFeeSummaryLabel}</strong>
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
                  : 'Create recurring strategy'}
            </button>
          </div>
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
