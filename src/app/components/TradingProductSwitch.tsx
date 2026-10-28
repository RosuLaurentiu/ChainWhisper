import { ArrowLeftRight, ChevronDown, CircleDollarSign, Coins } from 'lucide-react';
import type { P2PTradingHeaderContext } from '../../features/trading/components/P2PTradingPage.helpers';
import { CURRENT_DEX_DISPLAY_PAIR, CURRENT_DEX_DISPLAY_TOKENS, readCurrentDexDisplay } from '../../lib/currentDexDisplay';
import type { CurrentCheapDexIdentity } from '../../lib/dexV2Deployment';
import type { CurrentDexMarketReference } from '../../lib/currentDexMarketReference';

export type TradingPair = readonly [string, string];
export const SUCCESSOR_TESTNET_PAIRS: readonly TradingPair[] = Object.freeze([
  Object.freeze(['BCN', 'HBR'] as const),
  Object.freeze(['BCN', 'EMBR'] as const),
  Object.freeze(['BCN', 'ORBT'] as const),
  Object.freeze(['HBR', 'EMBR'] as const),
  Object.freeze(['HBR', 'ORBT'] as const),
  Object.freeze(['EMBR', 'ORBT'] as const)
]);
const SUCCESSOR_REFERENCE_VALUES: Readonly<Record<string, number>> = Object.freeze({
  BCN: 1,
  HBR: 2,
  EMBR: 6,
  ORBT: 24
});

export const successorPairReferencePrice = ([base, quote]: TradingPair): number =>
  SUCCESSOR_REFERENCE_VALUES[quote] / SUCCESSOR_REFERENCE_VALUES[base];

type TradingProductSwitchProps = {
  onNavigate: (product: 'dex' | 'p2p') => void;
  priceDisplayInverted: boolean;
  onPriceDisplayInvertedChange: (inverted: boolean) => void;
  marketReference?: CurrentDexMarketReference;
  dexCandidate?: CurrentCheapDexIdentity;
} & ({ activeProduct: 'dex'; selectedPair: TradingPair; onSelectedPairChange: (pair: TradingPair) => void; p2pMarket?: never }
  | { activeProduct: 'p2p'; p2pMarket: P2PTradingHeaderContext; selectedPair?: never; onSelectedPairChange?: never });

export default function TradingProductSwitch(props: TradingProductSwitchProps) {
  const {
  activeProduct,
  onNavigate,
  onSelectedPairChange,
  priceDisplayInverted,
  onPriceDisplayInvertedChange,
  marketReference,
  dexCandidate
  } = props;
  const p2pMarket = props.activeProduct === 'p2p' ? props.p2pMarket : null;
  const selectedPair: TradingPair = props.activeProduct === 'dex' ? props.selectedPair
    : [props.p2pMarket.baseToken?.symbol ?? 'Base', props.p2pMarket.quoteToken?.symbol ?? 'Quote'];
  const dexDisplay = activeProduct === 'dex' && dexCandidate ? readCurrentDexDisplay(dexCandidate) : null;
  if (dexDisplay && !dexDisplay.pairs.some(({ tokens }) =>
    tokens[0].label === selectedPair[0] && tokens[1].label === selectedPair[1] ||
    tokens[1].label === selectedPair[0] && tokens[0].label === selectedPair[1])) {
    throw new Error('Displayed pair is outside the selected DEX candidate.');
  }
  const displayPair = activeProduct === 'dex' && !dexDisplay ? CURRENT_DEX_DISPLAY_PAIR : selectedPair;
  const baseSymbol = priceDisplayInverted ? displayPair[1] : displayPair[0];
  const quoteSymbol = priceDisplayInverted ? displayPair[0] : displayPair[1];
  const marketPrice = marketReference?.status === 'available' ? priceDisplayInverted ? 1/marketReference.price : marketReference.price : null;
  const marketLabel = marketPrice !== null ? `${marketPrice.toLocaleString('en',{maximumSignificantDigits:6})} ${quoteSymbol} per ${baseSymbol}` :
    marketReference?.status === 'loading' ? 'Checking price' : marketReference?.status === 'stale' ? 'Price stale' : 'Price unavailable';
  const sampleAge = marketReference?.status === 'available'
    ? Math.max(0, Math.floor(Date.now() / 1000) - Number(marketReference.sampledAt)) : null;
  const p2pTokenSelect = (side: 'buy' | 'sell', label: string, selection: string, otherSelection: string) => p2pMarket ?
    <label className="trading-market-token-choice">{label}<select aria-label={label} value={selection} disabled={p2pMarket.disabled}
      onChange={event => {
        const option = p2pMarket.tokenOptions.find(item => item.value === event.currentTarget.value);
        if (!p2pMarket.disabled && option && option.value !== otherSelection) p2pMarket.onTokenSelectionChange(side, option.value);
      }}>
      {p2pMarket.tokenOptions.map(option => <option key={option.value} value={option.value} disabled={option.value === otherSelection}
        title={option.addressLabel ?? option.value}>{option.label}{option.kindLabel ? ` · ${option.kindLabel}` : ''}</option>)}
    </select></label> : null;

  return (
    <nav className="trading-product-bar" aria-label="Trading product">
      <div className="trading-market-context">
        <details className="trading-market-pair-picker" onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }}>
          <summary className="trading-market-pair" aria-label={`Selected displayed pair ${baseSymbol} and ${quoteSymbol}`}>
            <span className="trading-market-token trading-market-token-base"><CircleDollarSign size={19} aria-hidden="true" /></span>
            <span className="trading-market-token trading-market-token-quote"><Coins size={18} aria-hidden="true" /></span>
            <strong>{baseSymbol}{activeProduct === 'dex' ? <small>/ {quoteSymbol}</small> : <> / {quoteSymbol}</>}</strong>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="trading-market-token-menu">
            {activeProduct === 'dex' ? <section className="trading-market-catalog trading-market-catalog-single">
              <header><span>{dexDisplay ? 'Current Testnet pairs' : 'Current Testnet pair'}</span><small>Contract-bound tokens</small></header>
              {dexDisplay ? <div className="trading-market-catalog-list">{dexDisplay.pairs.map(({ tokens }) => {
                const pair = [tokens[0].label, tokens[1].label] as const;
                return <button key={pair.join('/')} type="button" aria-pressed={pair[0] === selectedPair[0] && pair[1] === selectedPair[1]}
                  onClick={() => onSelectedPairChange?.(pair)}>{pair.join('/')}</button>;
              })}</div> : null}
              <details className="trading-market-token-details"><summary>Token contracts</summary>
                {(dexDisplay?.tokens ?? CURRENT_DEX_DISPLAY_TOKENS).map(token => <p className="dex-token-identity" key={token.address}><strong>{token.label}</strong><small>{token.address}</small></p>)}
              </details>
            </section> : p2pMarket ? <section className="trading-market-catalog trading-market-catalog-single">
              <header><span>Market pair</span><small>Current network tokens</small></header>
              {p2pTokenSelect('buy', 'Base token', p2pMarket.baseSelection, p2pMarket.quoteSelection)}
              {p2pTokenSelect('sell', 'Quote token', p2pMarket.quoteSelection, p2pMarket.baseSelection)}
            </section> : null}
          </div>
        </details>
        <div className="trading-market-ratio">
          {activeProduct === 'p2p' ? <span>Price ratio</span> : null}
          <div>
            <button
              type="button"
              className="trading-ratio-trigger"
              onClick={() => onPriceDisplayInvertedChange(!priceDisplayInverted)}
              aria-label={`Reverse price display to 1 ${quoteSymbol} priced in ${baseSymbol}`}
              title="Reverse price display"
            >
              <strong
                key={priceDisplayInverted ? 'ratio-inverted' : 'ratio-forward'}
                className="trading-ratio-value"
                aria-live="polite"
                aria-atomic="true"
              >
                {quoteSymbol} <small>per {baseSymbol}</small>
              </strong>
              <ArrowLeftRight size={15} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="trading-market-change" data-price-state={activeProduct === 'dex' ? marketReference?.status ?? 'unavailable' : p2pMarket?.reference ? 'available' : 'unavailable'}>
          <span>{activeProduct === 'dex' ? 'COTI Testnet' : 'Market reference'}</span>
          <strong title={activeProduct === 'dex' ? 'Rounded Pool reference · excludes Limits' : p2pMarket?.reference?.title}>{activeProduct === 'dex' ? marketLabel : p2pMarket?.reference?.label ?? 'Price unavailable'}</strong>
          {activeProduct === 'dex' && sampleAge !== null ? <small aria-label="Market sample age" title="Expires after 120s">{sampleAge}s ago</small> : null}
        </div>
        <div className="trading-product-switch">
          <button
            type="button"
            className={activeProduct === 'dex' ? 'active' : undefined}
            aria-current={activeProduct === 'dex' ? 'page' : undefined}
            onClick={() => onNavigate('dex')}
          >
            DEX
          </button>
          <button
            type="button"
            className={activeProduct === 'p2p' ? 'active' : undefined}
            aria-current={activeProduct === 'p2p' ? 'page' : undefined}
            onClick={() => onNavigate('p2p')}
          >
            P2P
          </button>
        </div>
      </div>
    </nav>
  );
}
