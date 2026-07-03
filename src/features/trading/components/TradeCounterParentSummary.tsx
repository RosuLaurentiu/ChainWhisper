import { ArrowRight } from 'lucide-react';
import {
  formatExpiryCountdown,
  formatTradeAssetDisplayText,
  shortenAddress,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  formatHiddenFixedPriceTerms,
  formatTradeExpiryParts,
  formatTradeRateText,
  getTradeDisplayTerms,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms
} from '../../../lib/p2pTradeView';
import {
  formatTradeRatioLabel,
  isZeroTradeTakerAddress,
  resolveTradeOrderSummary
} from '../../../lib/tradePerspective';
import {
  getTradeCounterRelation,
  getTradeLiquidityLabel
} from './P2PTradingPage.helpers';

type TradeCounterParentSummaryProps = {
  trade: TradeSnapshot;
  walletAddress: string;
};

export default function TradeCounterParentSummary({ trade, walletAddress }: TradeCounterParentSummaryProps) {
  const displayTerms = getTradeDisplayTerms(trade);
  const parentDisplayTrade = {
    ...trade,
    offer: displayTerms.offer,
    request: displayTerms.request
  };
  const parentOrderSummary = resolveTradeOrderSummary(parentDisplayTrade, walletAddress);
  const termsVisibility = getTradeTermsVisibility(trade);
  const directTermsHydrated = hasHydratedDirectTradeTerms(trade);
  const amountsHidden = termsVisibility === 'hidden-liquidity' || (termsVisibility === 'direct-private-terms' && !directTermsHydrated);
  const counterSellAsset = parentDisplayTrade.request;
  const counterReceiveAsset = parentDisplayTrade.offer;
  const formatCounterParentAmount = (asset: TradeAssetPayload): string =>
    amountsHidden ? `Amount hidden - ${asset.symbol}` : formatTradeAssetDisplayText(asset);
  const parentStatusLabel =
    trade.status === 'open'
      ? 'Active'
      : trade.status === 'unknown'
        ? 'Unknown'
        : trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
  const parentExpiryCountdown =
    trade.status === 'open' && trade.expiresAt > 0 ? formatExpiryCountdown(trade.expiresAt) : null;
  const parentExpiryParts = formatTradeExpiryParts(trade.expiresAt);
  const parentAccessLabel = getTradeLiquidityLabel(trade.offer, trade.request);
  const ratioLabel =
    amountsHidden
      ? termsVisibility === 'direct-private-terms'
        ? 'Private terms'
        : formatTradeRatioLabel(counterSellAsset, counterReceiveAsset) ??
          formatHiddenFixedPriceTerms(counterSellAsset, counterReceiveAsset)
      : formatTradeRatioLabel(counterSellAsset, counterReceiveAsset) ??
        formatTradeRateText(counterSellAsset, counterReceiveAsset);
  const parentTakerLabel = isZeroTradeTakerAddress(trade.taker) ? 'Open offer' : shortenAddress(trade.taker);
  const privacyChips = [
    getTradeLiquidityLabel(trade.offer, trade.request),
    trade.offer.kind !== 'private-erc20' || trade.request.kind !== 'private-erc20' ? 'Public settlement side' : null,
    getTradeCounterRelation(trade)?.chipLabel ?? null
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <section className="p2p-counter-parent-context" aria-label="Parent trade details for counter offer">
      <div className="p2p-counter-parent-head">
        <div>
          <span>Replying to offer #{trade.tradeId}</span>
          <strong>{parentOrderSummary.directionLabel}</strong>
        </div>
        <div className="p2p-counter-parent-chips" aria-label="Parent trade privacy and status">
          <span className={`p2p-offer-status p2p-offer-status-${trade.status}`}>{parentStatusLabel}</span>
          {privacyChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      </div>

      <div className="p2p-counter-parent-terms">
        <div className="p2p-counter-parent-term p2p-counter-parent-term-sell">
          <span>You sell</span>
          <strong>{formatCounterParentAmount(counterSellAsset)}</strong>
          <small>What the parent offer asks for</small>
        </div>
        <div className="p2p-counter-parent-arrow" aria-hidden="true">
          <ArrowRight size={18} strokeWidth={2.2} />
        </div>
        <div className="p2p-counter-parent-term p2p-counter-parent-term-receive">
          <span>You buy</span>
          <strong>{formatCounterParentAmount(counterReceiveAsset)}</strong>
          <small>What the parent offer sells</small>
        </div>
      </div>

      <div className="p2p-counter-parent-facts">
        <div>
          <span>Price ratio</span>
          <strong>{ratioLabel || 'Set your counter price below'}</strong>
        </div>
        <div>
          <span>Maker</span>
          <strong>{shortenAddress(trade.maker)}</strong>
        </div>
        <div>
          <span>Recipient</span>
          <strong>{parentTakerLabel}</strong>
        </div>
        <div>
          <span>Access</span>
          <strong>{parentAccessLabel}</strong>
        </div>
        <div>
          <span>Expires</span>
          <strong
            className={parentExpiryCountdown ? `trade-card-expiry-${parentExpiryCountdown.urgency}` : undefined}
            title={parentExpiryParts.title}
          >
            {parentExpiryCountdown ? parentExpiryCountdown.label.replace(/^Expires /, '') : parentExpiryParts.date}
          </strong>
        </div>
        <div>
          <span>Counter behavior</span>
          <strong>
            {getTradeCounterRelation(trade)?.title ??
              'Counter will create a direct reply linked to this offer'}
          </strong>
        </div>
      </div>
    </section>
  );
}
