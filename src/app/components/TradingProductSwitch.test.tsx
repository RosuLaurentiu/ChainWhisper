import { Children, createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradingProductSwitch, { RECENT_POOL_PRICE_MAX_AGE_S } from './TradingProductSwitch';
// The selected current candidate (build 13).
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../lib/dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR as P } from '../../lib/currentDexDisplay';
import type { P2PTradingHeaderContext } from '../../features/trading/components/P2PTradingPage.helpers';

const p2pMarket = (): P2PTradingHeaderContext => ({
  baseSelection: `0x${'11'.repeat(20)}`, quoteSelection: `0x${'22'.repeat(20)}`,
  baseToken: { kind: 'private-erc20', tokenAddress: `0x${'11'.repeat(20)}`, symbol: 'cwTPB', decimals: 6 },
  quoteToken: { kind: 'private-erc20', tokenAddress: `0x${'22'.repeat(20)}`, symbol: 'cwTPQ', decimals: 6 },
  tokenOptions: [
    { value: `0x${'11'.repeat(20)}`, label: 'cwTPB', kindLabel: 'Private' },
    { value: `0x${'22'.repeat(20)}`, label: 'cwTPQ', kindLabel: 'Private' },
    { value: `0x${'33'.repeat(20)}`, label: 'cwPTA', kindLabel: 'Public' }
  ],
  onTokenSelectionChange: vi.fn(), disabled: false, reference: null
});
type ControlProps = { children?: ReactNode; 'aria-label'?: string; disabled?: boolean;
  onChange?: (event: { currentTarget: { value: string } }) => void; onClick?: () => void };
const controls = (node: ReactNode): ReactElement<ControlProps>[] => Children.toArray(node).flatMap(child =>
  isValidElement<ControlProps>(child) ? [child, ...controls(child.props.children)] : []);

describe('TradingProductSwitch', () => {
  it('labels current-source check age separately from the original sample age',()=>{
    const clock=vi.spyOn(Date,'now').mockReturnValue(1_000_000);
    try{
      const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{activeProduct:'dex',dexCandidate:STAGED_SHARED_HISTORY_DEX_CANDIDATE,onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},priceDisplayInverted:false,onPriceDisplayInvertedChange:()=>{},marketReference:{status:'available',price:2,sampledAt:'1',checkedAt:'975',revision:'3'}}));
      expect(markup).toContain('aria-label="Market check age"');expect(markup).toContain('aria-description="Valid for 120s after the last check">25s ago');expect(markup).not.toContain('999s ago');
    }finally{clock.mockRestore();}
  });
  it('uses the new deployment token labels and all six markets without a market-price substitute',()=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{activeProduct:'dex',dexCandidate:STAGED_SHARED_HISTORY_DEX_CANDIDATE,
      onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},priceDisplayInverted:false,onPriceDisplayInvertedChange:()=>{}}));
    expect(markup).toContain('BCN');expect(markup).toContain('HBR');
    for(const symbol of ['BCN','HBR','EMBR','ORBT'])expect(markup.match(new RegExp(`>${symbol}</option>`,'g'))).toHaveLength(2);
    expect(markup).toContain('Price unavailable');expect(markup).not.toContain('Test token 0');
  });
  it.each([false, true])('binds current-candidate labels and reference units with inversion=%s', inverted => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
        activeProduct: 'dex', dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE,
        onNavigate: () => {}, selectedPair: ['BCN', 'ORBT'], onSelectedPairChange: () => {},
        priceDisplayInverted: inverted, onPriceDisplayInvertedChange: () => {},
        marketReference: { status: 'available', price: 2, sampledAt: '975', revision: '1' }
      }));
      expect(markup).toContain(inverted ? '0.5 BCN/ORBT' : '2 ORBT/BCN');
      expect(markup).toContain('Rounded Pool reference · excludes Limits');
      expect(markup).toContain('COTI Testnet<span class="trading-market-change-detail"> · Live Pool reference</span>');
      expect(markup).toContain('aria-description="Expires after 120s">25s ago');
      expect(markup).toContain('Market pair');
      expect(markup).not.toContain('Test token 0');
    } finally { clock.mockRestore(); }
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])('keeps selected units despite an obsolete input-side override (selected=%s, obsolete=%s)', (globalInverted, referenceInverted) => {
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'dex', dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE,
      onNavigate: () => {}, selectedPair: ['BCN', 'ORBT'], onSelectedPairChange: () => {},
      priceDisplayInverted: globalInverted, referenceDisplayInverted: referenceInverted, onPriceDisplayInvertedChange: () => {},
      marketReference: { status: 'available', price: 2, sampledAt: '1', revision: '1' }
    } as ComponentProps<typeof TradingProductSwitch>));
    expect(markup).toContain(globalInverted ? 'Selected displayed pair ORBT and BCN' : 'Selected displayed pair BCN and ORBT');
    expect(markup).toContain(globalInverted ? '0.5 BCN/ORBT' : '2 ORBT/BCN');
  });
  // Owner decision 2026-11-18: the DEX picker uses Base and Quote dropdowns like P2P. Each side offers only tokens that
  // form a listed Pool with the other side, and a choice outside the candidate is refused.
  it('selects the DEX pair with Base and Quote dropdowns inside the candidate', () => {
    const change = vi.fn();
    const props = { activeProduct: 'dex' as const, dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE, onNavigate: vi.fn(),
      selectedPair: ['BCN', 'HBR'] as const, onSelectedPairChange: change, priceDisplayInverted: false, onPriceDisplayInvertedChange: vi.fn() };
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, props));
    expect(markup).toContain('>BCN / HBR</strong>');
    expect(markup).toContain('data-token-tone="bcn"'); expect(markup).toContain('data-token-tone="hbr"');
    expect(markup).toMatch(/<option value="HBR" disabled="">HBR<\/option>/);
    const selects = controls(TradingProductSwitch(props)).filter(element => element.type === 'select');
    expect(selects.map(select => select.props['aria-label'])).toEqual(['Base token', 'Quote token']);
    selects[1].props.onChange!({ currentTarget: { value: 'BCN' } });
    selects[1].props.onChange!({ currentTarget: { value: 'unknown' } });
    expect(change).not.toHaveBeenCalled();
    selects[1].props.onChange!({ currentTarget: { value: 'ORBT' } });
    expect(change).toHaveBeenCalledExactlyOnceWith(['BCN', 'ORBT']);
    selects[0].props.onChange!({ currentTarget: { value: 'EMBR' } });
    expect(change).toHaveBeenLastCalledWith(['EMBR', 'HBR']);
  });

  it('rejects a pair outside the explicitly selected candidate', () => {
    expect(() => renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'dex', dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE,
      onNavigate: () => {}, selectedPair: ['BCN', 'unknown'], onSelectedPairChange: () => {},
      priceDisplayInverted: false, onPriceDisplayInvertedChange: () => {}
    }))).toThrow('Displayed pair is outside the selected DEX candidate.');
  });
  it.each([false,true])('shows an authenticated public reference with inversion=%s',inverted=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{
      activeProduct:'dex',onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},
      priceDisplayInverted:inverted,onPriceDisplayInvertedChange:()=>{},
      marketReference:{status:'available',price:2,sampledAt:'1',revision:'1'}
    }));
    expect(markup).toContain(inverted?`0.5 ${P[0]}/${P[1]}`:`2 ${P[1]}/${P[0]}`);
    expect(markup).not.toContain('Price unavailable');
  });
  it.each(['loading','stale','unavailable'] as const)('shows %s without a substituted seed price',status=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{
      activeProduct:'dex',onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},
      priceDisplayInverted:false,onPriceDisplayInvertedChange:()=>{},marketReference:{status}
    }));
    expect(markup).toContain(status==='loading'?'Checking price':status==='stale'?'Price stale':'Price unavailable');
  });
  it.each([false,true])('keeps the last Pool price and recorded time in the selected units (inverted=%s)',inverted=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{
      activeProduct:'dex',dexCandidate:STAGED_SHARED_HISTORY_DEX_CANDIDATE,onNavigate:()=>{},selectedPair:['BCN','ORBT'],onSelectedPairChange:()=>{},
      priceDisplayInverted:inverted,onPriceDisplayInvertedChange:()=>{},marketReference:{status:'last-known',price:2,sampledAt:'1000',revision:'1'}
    }));
    expect(markup).toContain(inverted?'0.5 BCN/ORBT':'2 ORBT/BCN');
    expect(markup).toContain('Last Pool price');expect(markup).toContain('Recorded ');
    expect(markup).not.toContain('Live Pool reference');expect(markup).not.toContain('Price unavailable');
    // A recent record shows its age, like the live state does. An old record shows its date. The exact time stays in the hint.
    const clock=vi.spyOn(Date,'now').mockReturnValue(1_000_000_000);
    try{
      const recorded=(sampledAt:string)=>renderToStaticMarkup(createElement(TradingProductSwitch,{
        activeProduct:'dex',dexCandidate:STAGED_SHARED_HISTORY_DEX_CANDIDATE,onNavigate:()=>{},selectedPair:['BCN','ORBT'],onSelectedPairChange:()=>{},
        priceDisplayInverted:inverted,onPriceDisplayInvertedChange:()=>{},marketReference:{status:'last-known',price:2,sampledAt,revision:'1'}}));
      expect(recorded('999400')).toContain('>Recorded 10m ago<');
      expect(recorded('996401')).toContain('>Recorded 59m ago<');
      const old=recorded('996400');expect(old).toMatch(/>Recorded \d{1,2} \w{3} \d{4}, \d{2}:\d{2}</);expect(old).not.toMatch(/Recorded \d+[sm] ago/);
      expect(recorded('999400')).toMatch(/aria-description="\d{1,2} \w{3} \d{4}, \d{2}:\d{2} · Last recorded public Pool price\. Current market price is not verified\."/);
    }finally{clock.mockRestore();}
  });
  // Owner plan 2026-11-28 (CW-168): a price published less than RECENT_POOL_PRICE_MAX_AGE_S ago reads as current.
  describe('recent published Pool price', () => {
    const now = 1_000_000_000;
    const render = (marketReference?: ComponentProps<typeof TradingProductSwitch>['marketReference']) => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
      try {
        return renderToStaticMarkup(createElement(TradingProductSwitch, { activeProduct: 'dex', dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE,
          onNavigate: () => {}, selectedPair: ['BCN', 'ORBT'], onSelectedPairChange: () => {}, priceDisplayInverted: false,
          onPriceDisplayInvertedChange: () => {}, marketReference }));
      } finally { clock.mockRestore(); }
    };
    const lastKnown = (age: number) => render({ status: 'last-known', price: 2, sampledAt: String(now - age), revision: '1' });
    it('is one limit of the 300 s publish rule plus a margin', () => {
      expect(RECENT_POOL_PRICE_MAX_AGE_S).toBeGreaterThan(300);
      expect(RECENT_POOL_PRICE_MAX_AGE_S).toBeLessThanOrEqual(480);
    });
    it.each([[0, '0s ago'], [45, '45s ago'], [330, '5m ago'], [RECENT_POOL_PRICE_MAX_AGE_S - 1, `${Math.floor((RECENT_POOL_PRICE_MAX_AGE_S - 1) / 60)}m ago`]])(
      'shows a price %is old as live with an updating hint', (age, label) => {
        const markup = lastKnown(age);
        expect(markup).toContain('data-price-state="updating"');
        expect(markup).toContain('2 ORBT/BCN');
        expect(markup).toContain('COTI Testnet<span class="trading-market-change-detail"> · Live Pool reference</span>');
        expect(markup).toContain('aria-label="Pool price updating"'); expect(markup).toContain(`>Updating · ${label}</small>`);
        expect(markup).toContain(`aria-description="Pool price confirmed ${label}. Pools are changing; the price service publishes a new price at most every 5 minutes."`);
        expect(markup).not.toContain('Last Pool price'); expect(markup).not.toContain('Recorded '); expect(markup).not.toContain(' title=');
      });
    it.each([RECENT_POOL_PRICE_MAX_AGE_S, 600, 7200])('shows a price %is old as the last Pool price', age => {
      const markup = lastKnown(age);
      expect(markup).toContain('data-price-state="last-known"');
      expect(markup).toContain(' · Last Pool price'); expect(markup).toContain('>Recorded ');
      expect(markup).not.toContain('Updating'); expect(markup).not.toContain('Live Pool reference');
    });
    it('counts the age from the last read that found the price current', () => {
      const markup = render({ status: 'last-known', price: 2, sampledAt: String(now - 5000), checkedAt: String(now - 90), revision: '1' });
      expect(markup).toContain('data-price-state="updating"'); expect(markup).toContain('>Updating · 1m ago</small>');
      const old = render({ status: 'last-known', price: 2, sampledAt: String(now - 5000), checkedAt: String(now - RECENT_POOL_PRICE_MAX_AGE_S), revision: '1' });
      expect(old).toContain('data-price-state="last-known"'); expect(old).toContain('>Recorded ');
    });
    it.each([undefined, { status: 'unavailable' as const }])('keeps the unavailable state when no price was read (%o)', reference => {
      const markup = render(reference);
      expect(markup).toContain('data-price-state="unavailable"'); expect(markup).toContain('Price unavailable');
      expect(markup).not.toContain('Updating'); expect(markup).not.toContain('Recorded ');
      expect(markup).not.toContain('2 ORBT/BCN');
    });
    it('keeps a live reference live without the updating hint', () => {
      const markup = render({ status: 'available', price: 2, sampledAt: String(now - 600), checkedAt: String(now - 10), revision: '1' });
      expect(markup).toContain('data-price-state="available"'); expect(markup).toContain('>10s ago</small>');
      expect(markup).not.toContain('Updating');
    });
  });
  it('presents DEX and P2P as one local trading choice', () => {
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'p2p',
      onNavigate: () => undefined,
      p2pMarket: p2pMarket(),
      priceDisplayInverted: false,
      onPriceDisplayInvertedChange: () => undefined
    }));

    expect(markup).toContain('Trading product');
    expect(markup).toContain('DEX');
    expect(markup).toContain('P2P');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('cwTPB / cwTPQ');
    expect(markup).toContain('cwTPQ/cwTPB');
    expect(markup).toContain('Price unavailable');
    expect(markup).toMatch(new RegExp(`<option value="0x${'11'.repeat(20)}"[^>]* selected=""`));
    expect(markup).toMatch(new RegExp(`<option value="0x${'22'.repeat(20)}"[^>]* selected=""`));
    expect(markup).not.toContain('BCN');
    expect(markup).not.toContain('Testnet seed');
  });

  it.each([false, true])('uses actual P2P identities and reference labels with inversion=%s', inverted => {
    const market = { ...p2pMarket(), reference: { label: inverted ? '4 cwTPB' : '0.25 cwTPQ', title: 'Carbon market reference', basisLabel: inverted ? 'cwTPB/cwTPQ' : 'cwTPQ/cwTPB' } };
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, { activeProduct: 'p2p', p2pMarket: market,
      onNavigate: vi.fn(), priceDisplayInverted: inverted,
      onPriceDisplayInvertedChange: vi.fn() }));
    expect(markup).toContain(inverted ? 'Selected displayed pair cwTPQ and cwTPB' : 'Selected displayed pair cwTPB and cwTPQ');
    expect(markup).toContain(market.reference.label);
    expect(markup).toContain('Carbon market reference');
    expect(markup).not.toContain('2.0000');
    expect(market.onTokenSelectionChange).not.toHaveBeenCalled();
  });

  it('selects exact token keys, rejects unknown/same-token choices and keeps inversion display-only', () => {
    const market = p2pMarket(), inverted = vi.fn();
    const elements = controls(TradingProductSwitch({ activeProduct: 'p2p', p2pMarket: market, onNavigate: vi.fn(),
      priceDisplayInverted: false, onPriceDisplayInvertedChange: inverted }));
    const base = elements.find(element => element.props['aria-label'] === 'Base token')!;
    base.props.onChange!({ currentTarget: { value: market.tokenOptions[2].value } });
    expect(market.onTokenSelectionChange).toHaveBeenCalledExactlyOnceWith('buy', market.tokenOptions[2].value);
    base.props.onChange!({ currentTarget: { value: 'cwTPB' } });
    base.props.onChange!({ currentTarget: { value: market.quoteSelection } });
    expect(market.onTokenSelectionChange).toHaveBeenCalledTimes(1);
    elements.find(element => element.props['aria-label'] === 'Reverse price display to 1 cwTPQ priced in cwTPB')!.props.onClick!();
    expect(inverted).toHaveBeenCalledExactlyOnceWith(true);
    expect(market.onTokenSelectionChange).toHaveBeenCalledTimes(1);
    expect(market.baseSelection).toBe(`0x${'11'.repeat(20)}`);
    expect(market.quoteSelection).toBe(`0x${'22'.repeat(20)}`);
  });

  // Owner decision 2026-11-18: private tokens show only the symbol; a public or native token keeps its kind.
  it('shows plain private symbols and keeps the public and native kinds in the P2P picker', () => {
    const market = { ...p2pMarket(), tokenOptions: [
      { value: `0x${'11'.repeat(20)}`, label: '✓ BCN (private)', kindLabel: 'Private' as const },
      { value: `0x${'22'.repeat(20)}`, label: 'HBR (ecosystem)', kindLabel: 'Private' as const },
      { value: `0x${'33'.repeat(20)}`, label: 'cwPTA', kindLabel: 'Public' as const },
      { value: 'native', label: 'COTI (native)', kindLabel: 'Native' as const }] };
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, { activeProduct: 'p2p', p2pMarket: market,
      onNavigate: vi.fn(), priceDisplayInverted: false, onPriceDisplayInvertedChange: vi.fn() }));
    expect(markup).not.toMatch(/Private|\(private\)|✓/u);
    expect(markup).toMatch(/>BCN<\/option>/); expect(markup).toMatch(/>HBR<\/option>/);
    expect(markup).toContain('>cwPTA · Public</option>'); expect(markup).toContain('>COTI · Native</option>');
    expect(markup).toContain('trading-market-catalog-pair');
  });

  it('keeps pair changes disabled during a reviewed or pending action', () => {
    const market = { ...p2pMarket(), disabled: true };
    const elements = controls(TradingProductSwitch({ activeProduct: 'p2p', p2pMarket: market, onNavigate: vi.fn(),
      priceDisplayInverted: true, onPriceDisplayInvertedChange: vi.fn() }));
    const selects = elements.filter(element => element.type === 'select');
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.props.disabled).toBe(true);
      select.props.onChange!({ currentTarget: { value: market.tokenOptions[2].value } });
    }
    expect(market.onTokenSelectionChange).not.toHaveBeenCalled();
  });

  it('renders the reversed display orientation without changing the active product', () => {
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'dex',
      onNavigate: () => undefined,
      selectedPair: ['EMBR', 'ORBT'],
      onSelectedPairChange: () => undefined,
      priceDisplayInverted: true,
      onPriceDisplayInvertedChange: () => undefined
    }));

    expect(markup).toContain(`Selected displayed pair ${P[1]} and ${P[0]}`);
    expect(markup).toContain(`${P[0]}/${P[1]}`);
    expect(markup).toContain(`Reverse price display to 1 ${P[0]} priced in ${P[1]}`);
    expect(markup).toContain('Price unavailable');
    expect(markup).not.toContain('0.2500');
    expect(markup).not.toContain('Selected displayed pair ORBT and EMBR');
    expect(markup).toContain('aria-current="page">DEX</button>');
  });
});
