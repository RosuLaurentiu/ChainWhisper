import { ArrowLeftRight, Check, ChevronDown } from 'lucide-react';
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

// Owner decision 2026-11-18: one lettered circle per token in its own colour (CSS tones), on the pair button and in
// each pair row. Other symbols (P2P tokens) use the neutral tone.
const TOKEN_TONES: Readonly<Record<string, string>> = Object.freeze({ BCN: 'bcn', HBR: 'hbr', EMBR: 'embr', ORBT: 'orbt' });
const TokenMark = ({ symbol, className }: { symbol: string; className?: string }) =>
  <span className={className ? `trading-token-mark ${className}` : 'trading-token-mark'} data-token-tone={TOKEN_TONES[symbol] ?? 'other'}
    aria-hidden="true">{symbol.slice(0, 1).toUpperCase()}</span>;
const samePool = (a: TradingPair, b: TradingPair) => a[0] === b[0] && a[1] === b[1] || a[0] === b[1] && a[1] === b[0];
// Owner decision 2026-11-18: the P2P market picker shows the plain symbol. Private is the normal case and needs no
// text; a public or native token keeps its kind so a public leg stays visible. The shared option labels are unchanged.
const p2pOptionLabel = (option: { label: string; kindLabel?: string }) => {
  const symbol = option.label.replace(/^✓\s*/u, '').replace(/\s*\((?:private|ecosystem|public|native)\)\s*$/iu, '').trim();
  return option.kindLabel && option.kindLabel !== 'Private' ? `${symbol} · ${option.kindLabel}` : symbol;
};

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
  const rateInverted = priceDisplayInverted;
  const rateBaseSymbol = rateInverted ? displayPair[1] : displayPair[0];
  const rateQuoteSymbol = rateInverted ? displayPair[0] : displayPair[1];
  const hasPrice = marketReference?.status === 'available' || marketReference?.status === 'last-known';
  const marketPrice = hasPrice ? rateInverted ? 1/marketReference.price : marketReference.price : null;
  const marketLabel = marketPrice !== null ? `${marketPrice.toLocaleString('en',{maximumSignificantDigits:6})} ${rateQuoteSymbol}/${rateBaseSymbol}` :
    marketReference?.status === 'loading' ? 'Checking price' : marketReference?.status === 'stale' ? 'Price stale' : 'Price unavailable';
  const lastKnown = marketReference?.status === 'last-known';
  const sampleAge = hasPrice
    ? Math.max(0, Math.floor(Date.now() / 1000) - Number(marketReference.status==='available'?marketReference.checkedAt??marketReference.sampledAt:marketReference.sampledAt)) : null;
  const lastSampleTime = lastKnown ? new Date(Number(marketReference.sampledAt)*1000).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}) : null;
  // A recent record shows its age, like the live state. An older record shows its date and time.
  const lastSampleLabel = !lastKnown || sampleAge === null ? null : sampleAge < 60 ? `${sampleAge}s ago` : sampleAge < 3600 ? `${Math.floor(sampleAge / 60)}m ago` : lastSampleTime;
  const p2pTokenSelect = (side: 'buy' | 'sell', label: string, selection: string, otherSelection: string) => p2pMarket ?
    <label className="trading-market-token-choice">{label}<select aria-label={label} value={selection} disabled={p2pMarket.disabled}
      onChange={event => {
        const option = p2pMarket.tokenOptions.find(item => item.value === event.currentTarget.value);
        if (!p2pMarket.disabled && option && option.value !== otherSelection) p2pMarket.onTokenSelectionChange(side, option.value);
      }}>
      {p2pMarket.tokenOptions.map(option => <option key={option.value} value={option.value} disabled={option.value === otherSelection}
        title={option.addressLabel ?? option.value}>{p2pOptionLabel(option)}</option>)}
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
            <TokenMark symbol={baseSymbol} className="trading-market-token trading-market-token-base" />
            <TokenMark symbol={quoteSymbol} className="trading-market-token trading-market-token-quote" />
            <strong>{baseSymbol}{activeProduct === 'dex' ? <small>/ {quoteSymbol}</small> : <> / {quoteSymbol}</>}</strong>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="trading-market-token-menu">
            {activeProduct === 'dex' ? <section className="trading-market-catalog trading-market-catalog-single">
              <header><span>{dexDisplay ? 'Select a pair' : 'Current Testnet pair'}</span><small>COTI Testnet</small></header>
              {dexDisplay ? <div className="trading-market-catalog-list">{dexDisplay.pairs.map(({ tokens }) => {
                // The current Pool keeps its orientation; another Pool is selected in its listed order. Each row shows the
                // pair the way the button will show it after the choice (display inversion included).
                const listed = [tokens[0].label, tokens[1].label] as const;
                const selected = samePool(listed, selectedPair);
                const choice: TradingPair = selected ? selectedPair : listed;
                const shown = priceDisplayInverted ? [choice[1], choice[0]] : [choice[0], choice[1]];
                return <button key={listed.join('/')} type="button" className="trading-market-pair-option" aria-pressed={selected}
                  aria-label={`${shown[0]}/${shown[1]}`}
                  onClick={event => {
                    if (!selected) onSelectedPairChange?.(choice);
                    event?.currentTarget?.closest('details')?.removeAttribute('open');
                  }}>
                  <span className="trading-token-marks"><TokenMark symbol={shown[0]} /><TokenMark symbol={shown[1]} /></span>
                  <span className="trading-market-pair-option-name"><strong>{shown[0]}</strong><small>/ {shown[1]}</small></span>
                  {selected ? <Check size={16} aria-hidden="true" className="trading-market-pair-option-check" /> : null}
                </button>;
              })}</div> : null}
              <details className="trading-market-token-details"><summary>Token contracts</summary>
                {(dexDisplay?.tokens ?? CURRENT_DEX_DISPLAY_TOKENS).map(token => <p className="dex-token-identity" key={token.address}><strong>{token.label}</strong><small>{token.address}</small></p>)}
              </details>
            </section> : p2pMarket ? <section className="trading-market-catalog trading-market-catalog-single trading-market-catalog-p2p">
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
              aria-label={`Reverse price display to 1 ${rateQuoteSymbol} priced in ${rateBaseSymbol}`}
              title="Reverse price display"
            >
              <strong
                key={rateInverted ? 'ratio-inverted' : 'ratio-forward'}
                className="trading-ratio-value"
                aria-live="polite"
                aria-atomic="true"
              >
                {rateQuoteSymbol}/{rateBaseSymbol}
              </strong>
              <ArrowLeftRight size={15} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="trading-market-change" data-price-state={activeProduct === 'dex' ? marketReference?.status ?? 'unavailable' : p2pMarket?.reference ? 'available' : 'unavailable'}>
          <span>{activeProduct === 'dex' ? lastKnown ? 'COTI Testnet · Last Pool price' : 'COTI Testnet · Live Pool reference' : 'Market reference'}</span>
          <strong title={activeProduct === 'dex' ? 'Rounded Pool reference · excludes Limits' : p2pMarket?.reference?.title}>{activeProduct === 'dex' ? marketLabel : p2pMarket?.reference?.label ?? 'Price unavailable'}</strong>
          {activeProduct === 'dex' && lastSampleTime ? <small title={`${lastSampleTime} · Last recorded public Pool price. Current market price is not verified.`}>{`Recorded ${lastSampleLabel}`}</small> : activeProduct === 'dex' && sampleAge !== null ? <small aria-label={marketReference?.status==='available'&&marketReference.checkedAt?'Market check age':'Market sample age'} title={marketReference?.status==='available'&&marketReference.checkedAt?'Valid for 120s after the last check':'Expires after 120s'}>{sampleAge}s ago</small> : null}
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
