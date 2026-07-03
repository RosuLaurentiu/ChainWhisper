import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  COTI_NETWORK,
  parseTokenAmountInput,
  sanitizeTokenAmountInput,
  shortenAddress,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { P2PActionNoticeSurface } from '../../../lib/p2pActionNotice';
import {
  buildTradeAssetExplorerUrl,
  formatTradeContractIdLabel,
  getRecurringTerminalSideState,
  getSnapshotKey,
  getTradeContractNamespaceLabel,
  type RecurringTerminalActionSide
} from '../../../lib/p2pTradeView';
import { resolveRecurringPriceDeskDisplay } from '../../../lib/tradePerspective';
import {
  SHARE_LABEL,
  formatExactTokenAmountInput,
  formatRecurringPriceDeskAriaLabel,
  formatRecurringTokenAmount,
  getRecurringFillSideForDisplayAction,
  getRecurringLiquidityLabel,
  parseTokenAmountString,
  renderCarbonPriceReference,
  renderDeskPriceLabel,
  type TerminalHistoryPanelConfig
} from './P2PTradingPage.helpers';
import { TradeTerminalHistoryMobileControls } from './TradeTerminalHistoryPanel';

type RecurringStatusAction = 'pause' | 'resume' | 'cancel';

type TradeRecurringTerminalProps = {
  snapshot: TradeSnapshot;
  walletKey: string;
  onCotiNetwork: boolean;
  lastCopiedKey: string;
  reversedRateTradeIds: Record<string, boolean>;
  recurringTerminalSide: RecurringTerminalActionSide;
  recurringBuyFillInput: string;
  recurringSellFillInput: string;
  processingRecurringAction: string;
  makerControlsExpanded: boolean;
  terminalHistorySheetKey: string;
  setRecurringTerminalSide: (side: RecurringTerminalActionSide) => void;
  setRecurringBuyFillInput: (value: string) => void;
  setRecurringSellFillInput: (value: string) => void;
  setTerminalHistorySheetKey: (key: string) => void;
  askAgentAboutOrder: (snapshot: TradeSnapshot) => void;
  beginEditRecurringOrder: (snapshot: TradeSnapshot) => void;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  fillRecurringOrderSide: (snapshot: TradeSnapshot, side: RecurringTerminalActionSide) => Promise<void>;
  getCarbonReferenceDisplay: (
    baseAsset?: TradeAssetPayload | null,
    quoteAsset?: TradeAssetPayload | null,
    inverted?: boolean
  ) => CarbonPairReferenceDisplay | null;
  getRecurringTerminalHistoryConfig: (snapshot: TradeSnapshot) => TerminalHistoryPanelConfig | null;
  renderActionNotice: (surface: P2PActionNoticeSurface, tradeKey?: string) => ReactNode;
  renderTradeConversationButton: (snapshot: TradeSnapshot, shareUrl?: string, accessSecret?: string) => ReactNode;
  resolveTerminalAssetBalanceLabel: (asset: TradeAssetPayload, maximumFractionDigits?: number) => string;
  toggleMakerControls: (surface: 'terminal', tradeKey: string) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
  updateRecurringOrderStatus: (snapshot: TradeSnapshot, action: RecurringStatusAction) => Promise<void>;
};

export default function TradeRecurringTerminal({
  snapshot,
  walletKey,
  onCotiNetwork,
  lastCopiedKey,
  reversedRateTradeIds,
  recurringTerminalSide,
  recurringBuyFillInput,
  recurringSellFillInput,
  processingRecurringAction,
  makerControlsExpanded,
  terminalHistorySheetKey,
  setRecurringTerminalSide,
  setRecurringBuyFillInput,
  setRecurringSellFillInput,
  setTerminalHistorySheetKey,
  askAgentAboutOrder,
  beginEditRecurringOrder,
  buildTradeShareUrl,
  copyWithFeedback,
  fillRecurringOrderSide,
  getCarbonReferenceDisplay,
  getRecurringTerminalHistoryConfig,
  renderActionNotice,
  renderTradeConversationButton,
  resolveTerminalAssetBalanceLabel,
  toggleMakerControls,
  toggleTradeRateDirection,
  updateRecurringOrderStatus
}: TradeRecurringTerminalProps) {
  const recurring = snapshot.recurringOrder;
  if (!recurring) {
    return null;
  }

  const tradeKey = getSnapshotKey(snapshot);
  const isMaker = walletKey.length > 0 && snapshot.maker.toLowerCase() === walletKey;
  const isActive = recurring.recurringStatus === 'active';
  const isPaused = recurring.recurringStatus === 'paused';
  const statusLabel =
    recurring.recurringStatus === 'active'
      ? 'Active'
      : recurring.recurringStatus === 'paused'
        ? 'Paused'
        : recurring.recurringStatus === 'cancelled'
          ? 'Cancelled'
          : 'Unknown';
  const modeLabel = getRecurringLiquidityLabel(recurring.mode);
  const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
  const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
  const revealedBaseInventory = isMaker ? recurring.makerPrivateInventory?.baseInventory : undefined;
  const revealedQuoteInventory = isMaker ? recurring.makerPrivateInventory?.quoteInventory : undefined;
  const hasPositiveRecurringAmount = (amount?: string): boolean => parseTokenAmountString(amount) > 0n;
  const baseInventoryLabel =
    baseHidden && revealedBaseInventory !== undefined
      ? formatRecurringTokenAmount(recurring.baseAsset, revealedBaseInventory, false)
      : baseHidden && recurring.hasPrivateBaseInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.baseAsset, recurring.publicBaseInventory, false);
  const quoteInventoryLabel =
    quoteHidden && revealedQuoteInventory !== undefined
      ? formatRecurringTokenAmount(recurring.quoteAsset, revealedQuoteInventory, false)
      : quoteHidden && recurring.hasPrivateQuoteInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.quoteAsset, recurring.publicQuoteInventory, false);
  const sellLiquidityLive =
    baseHidden && revealedBaseInventory !== undefined
      ? hasPositiveRecurringAmount(revealedBaseInventory)
      : baseHidden
        ? recurring.sellSideOpen && recurring.hasPrivateBaseInventory
        : hasPositiveRecurringAmount(recurring.publicBaseInventory);
  const buyLiquidityLive =
    quoteHidden && revealedQuoteInventory !== undefined
      ? hasPositiveRecurringAmount(revealedQuoteInventory)
      : quoteHidden
        ? recurring.buySideOpen && recurring.hasPrivateQuoteInventory
        : hasPositiveRecurringAmount(recurring.publicQuoteInventory);
  const recurringPriceDisplay = resolveRecurringPriceDeskDisplay({
    terms: {
      baseAsset: recurring.baseAsset,
      quoteAsset: recurring.quoteAsset,
      buyTerms: recurring.buyTerms,
      sellTerms: recurring.sellTerms
    },
    toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
    subjectLabel: `Recurring order ${recurring.orderId}`
  });
  const recurringDisplaySellFillSide = getRecurringFillSideForDisplayAction(
    'sell',
    recurringPriceDisplay.isReversed
  );
  const recurringDisplayBuyFillSide = getRecurringFillSideForDisplayAction(
    'buy',
    recurringPriceDisplay.isReversed
  );
  const recurringFillPriceNote =
    recurringTerminalSide === 'buy'
      ? `You buy ${recurringPriceDisplay.displayBaseAsset.symbol} with ${recurringPriceDisplay.displayQuoteAsset.symbol} at ${recurringPriceDisplay.buySide.priceLabel}.`
      : `You sell ${recurringPriceDisplay.displayBaseAsset.symbol} for ${recurringPriceDisplay.displayQuoteAsset.symbol} at ${recurringPriceDisplay.sellSide.priceLabel}.`;
  const recurringCarbonPriceReference = getCarbonReferenceDisplay(
    recurring.baseAsset,
    recurring.quoteAsset,
    recurringPriceDisplay.isReversed
  );
  const shareUrl = buildTradeShareUrl(snapshot.tradeId, undefined, snapshot.escrowContract);
  const shareKey = `terminal-recurring-order-link:${tradeKey}`;
  const buyProcessing = processingRecurringAction === `${tradeKey}:buy`;
  const sellProcessing = processingRecurringAction === `${tradeKey}:sell`;
  const sellToOrderState = getRecurringTerminalSideState(snapshot, 'sell');
  const buyFromOrderState = getRecurringTerminalSideState(snapshot, 'buy');
  const recurringSellDisplayState =
    recurringDisplaySellFillSide === 'buy' ? sellToOrderState : buyFromOrderState;
  const recurringBuyDisplayState =
    recurringDisplayBuyFillSide === 'buy' ? sellToOrderState : buyFromOrderState;
  const activeRecurringFillSide =
    recurringTerminalSide === 'buy' ? recurringDisplayBuyFillSide : recurringDisplaySellFillSide;
  const activeRecurringTerminalState =
    recurringTerminalSide === 'buy' ? recurringBuyDisplayState : recurringSellDisplayState;
  const recurringTerminalInputValue =
    activeRecurringFillSide === 'buy' ? recurringBuyFillInput : recurringSellFillInput;
  const recurringTerminalProcessing = activeRecurringFillSide === 'buy' ? buyProcessing : sellProcessing;
  const recurringTerminalCanSubmit = !isMaker && activeRecurringTerminalState.isOpen;
  const recurringTerminalReady = Boolean(
    walletKey &&
    onCotiNetwork &&
    recurringTerminalInputValue.trim() &&
    recurringTerminalCanSubmit &&
    !recurringTerminalProcessing
  );
  const recurringTerminalInputAsset =
    activeRecurringFillSide === 'buy' ? recurring.baseAsset : recurring.quoteAsset;
  const recurringTerminalOutputAsset =
    activeRecurringFillSide === 'buy' ? recurring.quoteAsset : recurring.baseAsset;
  const recurringTerminalDisplayActionLabel =
    recurringTerminalSide === 'buy'
      ? `Buy ${recurringPriceDisplay.displayBaseAsset.symbol}`
      : `Sell ${recurringPriceDisplay.displayBaseAsset.symbol}`;
  const recurringTerminalInputAmount = parseTokenAmountInput(
    recurringTerminalInputValue,
    recurringTerminalInputAsset.decimals
  );
  const recurringTerminalOutputAmount = (() => {
    if (!recurringTerminalInputAmount || recurringTerminalInputAmount <= 0n) {
      return 0n;
    }
    const terms = activeRecurringFillSide === 'buy' ? recurring.buyTerms : recurring.sellTerms;
    const baseAmount = parseTokenAmountString(terms.baseAmount);
    const quoteAmount = parseTokenAmountString(terms.quoteAmount);
    if (baseAmount <= 0n || quoteAmount <= 0n) {
      return 0n;
    }
    return activeRecurringFillSide === 'buy'
      ? (recurringTerminalInputAmount * quoteAmount) / baseAmount
      : (recurringTerminalInputAmount * baseAmount) / quoteAmount;
  })();
  const recurringTerminalReceiveValue =
    recurringTerminalOutputAmount > 0n
      ? formatExactTokenAmountInput(recurringTerminalOutputAmount, recurringTerminalOutputAsset.decimals)
      : '';
  const setRecurringTerminalDesiredOutput = (asset: 'base' | 'quote', value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    const desiredAmount = parseTokenAmountInput(
      sanitized,
      asset === 'base' ? recurring.baseAsset.decimals : recurring.quoteAsset.decimals
    );
    const terms = asset === 'base' ? recurring.sellTerms : recurring.buyTerms;
    const baseAmount = parseTokenAmountString(terms.baseAmount);
    const quoteAmount = parseTokenAmountString(terms.quoteAmount);
    if (desiredAmount === null || desiredAmount <= 0n || baseAmount <= 0n || quoteAmount <= 0n) {
      if (asset === 'base') {
        setRecurringSellFillInput('');
      } else {
        setRecurringBuyFillInput('');
      }
      return;
    }
    if (asset === 'base') {
      const requiredQuote = (desiredAmount * quoteAmount + baseAmount - 1n) / baseAmount;
      setRecurringSellFillInput(formatExactTokenAmountInput(requiredQuote, recurring.quoteAsset.decimals));
    } else {
      const requiredBase = (desiredAmount * baseAmount + quoteAmount - 1n) / quoteAmount;
      setRecurringBuyFillInput(formatExactTokenAmountInput(requiredBase, recurring.baseAsset.decimals));
    }
  };
  const recurringTerminalInputAssetKey = activeRecurringFillSide === 'buy' ? 'base' : 'quote';
  const recurringTerminalOutputAssetKey = activeRecurringFillSide === 'buy' ? 'quote' : 'base';
  const renderRecurringTerminalAmountField = (
    action: 'sell' | 'buy',
    assetKey: 'base' | 'quote',
    value: string
  ) => {
    const asset = assetKey === 'base' ? recurring.baseAsset : recurring.quoteAsset;
    const balanceLabel = resolveTerminalAssetBalanceLabel(asset);
    const balanceTitle = resolveTerminalAssetBalanceLabel(asset, 6);

    return (
      <label
        key={`${action}:${assetKey}`}
        className={`p2p-terminal-input-field p2p-terminal-input-field-${action}${
          action === 'buy' ? ' p2p-terminal-output-field' : ''
        }`}
      >
        <div className="p2p-terminal-field-head">
          <span>You {action} {asset.symbol}</span>
          <small title={balanceTitle}>{balanceLabel}</small>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            if (action === 'buy') {
              setRecurringTerminalDesiredOutput(assetKey, event.target.value);
            } else if (activeRecurringFillSide === 'buy') {
              setRecurringBuyFillInput(sanitizeTokenAmountInput(event.target.value));
            } else {
              setRecurringSellFillInput(sanitizeTokenAmountInput(event.target.value));
            }
          }}
          placeholder={`0 ${asset.symbol}`}
          disabled={!recurringTerminalCanSubmit || recurringTerminalProcessing}
        />
      </label>
    );
  };
  const recurringDisplayBaseSymbol = recurringPriceDisplay.displayBaseAsset.symbol.trim() || 'Base';
  const recurringDisplayQuoteSymbol = recurringPriceDisplay.displayQuoteAsset.symbol.trim() || 'Quote';
  const recurringDisplayPairLabel = `${recurringDisplayBaseSymbol}/${recurringDisplayQuoteSymbol}`;
  const recurringBaseExplorerUrl = buildTradeAssetExplorerUrl(recurringPriceDisplay.displayBaseAsset);
  const recurringQuoteExplorerUrl = buildTradeAssetExplorerUrl(recurringPriceDisplay.displayQuoteAsset);
  const recurringMakerExplorerUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${snapshot.maker}`;
  const recurringTokenExplorerLinks = [
    recurringBaseExplorerUrl
      ? {
          key: recurringBaseExplorerUrl,
          href: recurringBaseExplorerUrl,
          label: recurringPriceDisplay.displayBaseAsset.symbol,
          title: `View ${recurringPriceDisplay.displayBaseAsset.symbol} on token explorer`
        }
      : null,
    recurringQuoteExplorerUrl
      ? {
          key: recurringQuoteExplorerUrl,
          href: recurringQuoteExplorerUrl,
          label: recurringPriceDisplay.displayQuoteAsset.symbol,
          title: `View ${recurringPriceDisplay.displayQuoteAsset.symbol} on token explorer`
        }
      : null
  ]
    .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
    .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
  const historyConfig = getRecurringTerminalHistoryConfig(snapshot);
  return (
    <article className="p2p-terminal-shell p2p-terminal-shell-recurring" key={tradeKey}>
      <header className="p2p-terminal-head">
        <div className="p2p-terminal-title">
          <span className="p2p-terminal-eyebrow">{getTradeContractNamespaceLabel(snapshot)} order</span>
          <h3>{recurringDisplayPairLabel}</h3>
          <div className="p2p-terminal-tag-row" aria-label="Recurring order tags">
            <span className="p2p-order-id">{formatTradeContractIdLabel(snapshot)}</span>
            <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
            <span className="p2p-order-chip">{modeLabel}</span>
          </div>
        </div>
        <div className="p2p-terminal-toolbar">
          <button type="button" className="p2p-terminal-share" onClick={() => askAgentAboutOrder(snapshot)}>
            Ask Agent
          </button>
          {renderTradeConversationButton(snapshot, shareUrl)}
          <button
            type="button"
            className={lastCopiedKey === shareKey ? 'p2p-terminal-share copied' : 'p2p-terminal-share'}
            onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
            title={lastCopiedKey === shareKey ? 'Recurring order link copied' : 'Share recurring order link'}
            aria-label={lastCopiedKey === shareKey ? 'Shared' : SHARE_LABEL}
            aria-live="polite"
          >
            {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
          </button>
        </div>
      </header>

      <div className="p2p-terminal-main">
        <section className="p2p-terminal-market" aria-label="Recurring order market summary">
          <button
            type="button"
            className="p2p-terminal-price-card p2p-terminal-price-desk"
            onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
            title={recurringPriceDisplay.toggleTitle}
            aria-label={formatRecurringPriceDeskAriaLabel(`Recurring order ${recurring.orderId}`, recurringPriceDisplay)}
          >
            <div className="p2p-recurring-price-card-head">
              <span>Price ratio</span>
            </div>
            <div className="p2p-recurring-price-grid">
              <div
                className={[
                  'p2p-recurring-price-box',
                  'p2p-recurring-price-sell',
                  !isMaker && recurringTerminalSide === 'sell' ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
              >
                <span>{recurringPriceDisplay.sellSide.label}</span>
                <strong className="p2p-price-label">{renderDeskPriceLabel(recurringPriceDisplay.sellSide.priceLabel)}</strong>
              </div>
              <div
                className={[
                  'p2p-recurring-price-box',
                  'p2p-recurring-price-buy',
                  !isMaker && recurringTerminalSide === 'buy' ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
              >
                <span>{recurringPriceDisplay.buySide.label}</span>
                <strong className="p2p-price-label">{renderDeskPriceLabel(recurringPriceDisplay.buySide.priceLabel)}</strong>
              </div>
            </div>
            {renderCarbonPriceReference(recurringCarbonPriceReference)}
          </button>

          <div className="p2p-terminal-liquidity-grid" aria-label="Recurring order liquidity">
            <div>
              <div className="p2p-terminal-liquidity-head">
                <span>Sell liquidity</span>
                <i
                  className={sellLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                  title={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
                  role="img"
                  aria-label={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
                />
              </div>
              <strong className={baseHidden && revealedBaseInventory === undefined && recurring.hasPrivateBaseInventory ? 'p2p-order-muted-slot' : undefined}>
                {baseInventoryLabel}
              </strong>
            </div>
            <div>
              <div className="p2p-terminal-liquidity-head">
                <span>Buy liquidity</span>
                <i
                  className={buyLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                  title={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
                  role="img"
                  aria-label={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
                />
              </div>
              <strong className={quoteHidden && revealedQuoteInventory === undefined && recurring.hasPrivateQuoteInventory ? 'p2p-order-muted-slot' : undefined}>
                {quoteInventoryLabel}
              </strong>
            </div>
            <div>
              <span>Executions</span>
              <strong className={recurring.executionCount === 0 ? 'p2p-order-muted-slot' : undefined}>
                {recurring.executionCount > 0 ? recurring.executionCount : 'None'}
              </strong>
            </div>
          </div>

          <div className="p2p-terminal-stat-grid p2p-terminal-stat-grid-compact">
            <div>
              <span>Maker</span>
              <a href={recurringMakerExplorerUrl} target="_blank" rel="noreferrer" title={snapshot.maker}>
                {isMaker ? `${shortenAddress(snapshot.maker)} (you)` : shortenAddress(snapshot.maker)}
              </a>
            </div>
          </div>

          <div className="p2p-terminal-token-actions" aria-label="Token explorer links">
            <span>Verify tokens</span>
            <div>
              {recurringTokenExplorerLinks.length ? (
                recurringTokenExplorerLinks.map((link) => (
                  <a key={link.key} href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                    {link.label}
                  </a>
                ))
              ) : (
                <strong>Native only</strong>
              )}
            </div>
          </div>
        </section>

        <section className="p2p-terminal-ticket" aria-label="Recurring order action ticket">
          {renderActionNotice('terminal', tradeKey)}

          {isMaker ? (
            <div className="p2p-terminal-action-stack p2p-terminal-maker-disclosure">
              <button
                type="button"
                className={makerControlsExpanded ? 'p2p-terminal-manage-toggle active' : 'p2p-terminal-manage-toggle'}
                onClick={() => toggleMakerControls('terminal', tradeKey)}
                aria-expanded={makerControlsExpanded}
              >
                <SlidersHorizontal size={15} strokeWidth={2.4} aria-hidden="true" />
                <span>Manage order</span>
              </button>
              {makerControlsExpanded ? (
                <div className="p2p-terminal-maker-actions">
                  {isActive ? (
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-counter"
                      onClick={() => updateRecurringOrderStatus(snapshot, 'pause').catch(() => {})}
                      disabled={processingRecurringAction === `${tradeKey}:pause`}
                    >
                      {processingRecurringAction === `${tradeKey}:pause` ? 'Pausing...' : 'Pause'}
                    </button>
                  ) : null}
                  {isPaused ? (
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-counter"
                      onClick={() => updateRecurringOrderStatus(snapshot, 'resume').catch(() => {})}
                      disabled={processingRecurringAction === `${tradeKey}:resume`}
                    >
                      {processingRecurringAction === `${tradeKey}:resume` ? 'Resuming...' : 'Resume'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-counter"
                    onClick={() => beginEditRecurringOrder(snapshot)}
                    disabled={Boolean(processingRecurringAction)}
                  >
                    Edit
                  </button>
                  {recurring.recurringStatus !== 'cancelled' ? (
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-refuse"
                      onClick={() => updateRecurringOrderStatus(snapshot, 'cancel').catch(() => {})}
                      disabled={processingRecurringAction === `${tradeKey}:cancel`}
                    >
                      {processingRecurringAction === `${tradeKey}:cancel` ? 'Closing...' : 'Close order'}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p>Open maker actions to edit prices, adjust funding, pause, or close this order.</p>
              )}
            </div>
          ) : (
            <>
              <div className="p2p-terminal-tabs" role="tablist" aria-label="Choose recurring order side">
                <button
                  type="button"
                  className={`p2p-terminal-side-sell${recurringTerminalSide === 'sell' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={recurringTerminalSide === 'sell'}
                  onClick={() => setRecurringTerminalSide('sell')}
                >
                  Sell
                </button>
                <button
                  type="button"
                  className={`p2p-terminal-side-buy${recurringTerminalSide === 'buy' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={recurringTerminalSide === 'buy'}
                  onClick={() => setRecurringTerminalSide('buy')}
                >
                  Buy
                </button>
              </div>
              <p className="p2p-recurring-fill-price-note">{recurringFillPriceNote}</p>
              <div className="p2p-terminal-amount-grid" aria-label="Recurring order amount calculator">
                {renderRecurringTerminalAmountField(
                  'sell',
                  recurringTerminalInputAssetKey,
                  recurringTerminalInputValue
                )}
                {renderRecurringTerminalAmountField(
                  'buy',
                  recurringTerminalOutputAssetKey,
                  recurringTerminalReceiveValue
                )}
              </div>
              <button
                type="button"
                className={
                  `${recurringTerminalSide === 'buy'
                    ? 'trade-card-action trade-card-action-accept p2p-terminal-primary-action'
                    : 'trade-card-action trade-card-action-counter p2p-terminal-primary-action'}${
                    recurringTerminalProcessing ? ' p2p-action-pending' : ''
                  }`
                }
                onClick={() => fillRecurringOrderSide(snapshot, activeRecurringFillSide).catch(() => {})}
                disabled={!recurringTerminalReady}
                title={
                  recurringTerminalProcessing
                    ? 'Confirming on-chain...'
                    : !walletKey
                      ? 'Connect wallet first.'
                      : !onCotiNetwork
                        ? 'Switch to COTI Mainnet first.'
                        : !recurringTerminalInputValue.trim()
                          ? 'Enter an amount to continue.'
                          : !recurringTerminalCanSubmit
                            ? activeRecurringTerminalState.disabledLabel
                            : undefined
                }
              >
                {recurringTerminalProcessing
                  ? 'Processing...'
                  : !walletKey
                    ? 'Connect wallet'
                    : !onCotiNetwork
                      ? 'Switch network'
                      : !recurringTerminalInputValue.trim()
                        ? 'Enter amount'
                        : recurringTerminalCanSubmit
                          ? recurringTerminalDisplayActionLabel
                          : activeRecurringTerminalState.disabledLabel}
              </button>
            </>
          )}
        </section>
      </div>

      {historyConfig ? (
        <TradeTerminalHistoryMobileControls
          config={historyConfig}
          sheetKey={terminalHistorySheetKey}
          setSheetKey={setTerminalHistorySheetKey}
          renderActionNotice={renderActionNotice}
        />
      ) : null}
    </article>
  );
}
