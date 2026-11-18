import { Children, createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradingProductSwitch from './TradingProductSwitch';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from '../../lib/currentDexExitCandidate';
// The selected current candidate. The descriptor in lib/currentDexHistoryCandidate is an earlier record that the App does not select.
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../lib/dexV2Deployment';
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
      expect(markup).toContain('aria-label="Market check age"');expect(markup).toContain('title="Valid for 120s after the last check">25s ago');expect(markup).not.toContain('999s ago');
    }finally{clock.mockRestore();}
  });
  it('uses the new deployment token labels and all six markets without a market-price substitute',()=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{activeProduct:'dex',dexCandidate:STAGED_SHARED_HISTORY_DEX_CANDIDATE,
      onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},priceDisplayInverted:false,onPriceDisplayInvertedChange:()=>{}}));
    expect(markup).toContain('BCN');expect(markup).toContain('HBR');expect(markup).toContain('ORBT/EMBR');
    expect(markup).toContain('Price unavailable');expect(markup).not.toContain('Test token 0');
  });
  it.each([false, true])('binds current-candidate labels and reference units with inversion=%s', inverted => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
        activeProduct: 'dex', dexCandidate: STAGED_EXIT_PREVIEW_DEX_CANDIDATE,
        onNavigate: () => {}, selectedPair: ['BCN', 'ORBT'], onSelectedPairChange: () => {},
        priceDisplayInverted: inverted, onPriceDisplayInvertedChange: () => {},
        marketReference: { status: 'available', price: 2, sampledAt: '975', revision: '1' }
      }));
      expect(markup).toContain(inverted ? '0.5 BCN/ORBT' : '2 ORBT/BCN');
      expect(markup).toContain('Rounded Pool reference · excludes Limits');
      expect(markup).toContain('COTI Testnet · Live Pool reference');
      expect(markup).toContain('title="Expires after 120s">25s ago');
      expect(markup).toContain('Select a pair');
      expect(markup).not.toContain('Test token 0');
    } finally { clock.mockRestore(); }
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])('keeps selected units despite an obsolete input-side override (selected=%s, obsolete=%s)', (globalInverted, referenceInverted) => {
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'dex', dexCandidate: STAGED_EXIT_PREVIEW_DEX_CANDIDATE,
      onNavigate: () => {}, selectedPair: ['BCN', 'ORBT'], onSelectedPairChange: () => {},
      priceDisplayInverted: globalInverted, referenceDisplayInverted: referenceInverted, onPriceDisplayInvertedChange: () => {},
      marketReference: { status: 'available', price: 2, sampledAt: '1', revision: '1' }
    } as ComponentProps<typeof TradingProductSwitch>));
    expect(markup).toContain(globalInverted ? 'Selected displayed pair ORBT and BCN' : 'Selected displayed pair BCN and ORBT');
    expect(markup).toContain(globalInverted ? '0.5 BCN/ORBT' : '2 ORBT/BCN');
  });
  // Owner decision 2026-11-18: the pair selector marks the current Pool in either token order, shows each row the way
  // the button will show it, keeps the current orientation on a click of the current row and selects another Pool once.
  it.each([false, true])('marks the current Pool and matches the button order (inverted=%s)', inverted => {
    const change = vi.fn();
    const props = { activeProduct: 'dex' as const, dexCandidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE, onNavigate: vi.fn(),
      selectedPair: ['BCN', 'HBR'] as const, onSelectedPairChange: change, priceDisplayInverted: inverted, onPriceDisplayInvertedChange: vi.fn() };
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, props));
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain(inverted ? 'aria-pressed="true" aria-label="HBR/BCN"' : 'aria-pressed="true" aria-label="BCN/HBR"');
    expect(markup).toContain(inverted ? 'aria-label="BCN/EMBR"' : 'aria-label="EMBR/BCN"');
    expect(markup).toContain('data-token-tone="bcn"'); expect(markup).toContain('data-token-tone="orbt"');
    const rows = controls(TradingProductSwitch(props)).filter(element => (element.props as { className?: string }).className === 'trading-market-pair-option');
    expect(rows).toHaveLength(6);
    rows[0].props.onClick!(); expect(change).not.toHaveBeenCalled();
    rows[1].props.onClick!(); expect(change).toHaveBeenCalledExactlyOnceWith(['EMBR', 'BCN']);
  });

  it('rejects a pair outside the explicitly selected candidate', () => {
    expect(() => renderToStaticMarkup(createElement(TradingProductSwitch, {
      activeProduct: 'dex', dexCandidate: STAGED_EXIT_PREVIEW_DEX_CANDIDATE,
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
    expect(markup).toContain(inverted?'0.5 Test token 0/Test token 1':'2 Test token 1/Test token 0');
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
      activeProduct:'dex',dexCandidate:STAGED_EXIT_PREVIEW_DEX_CANDIDATE,onNavigate:()=>{},selectedPair:['BCN','ORBT'],onSelectedPairChange:()=>{},
      priceDisplayInverted:inverted,onPriceDisplayInvertedChange:()=>{},marketReference:{status:'last-known',price:2,sampledAt:'1000',revision:'1'}
    }));
    expect(markup).toContain(inverted?'0.5 BCN/ORBT':'2 ORBT/BCN');
    expect(markup).toContain('Last Pool price');expect(markup).toContain('Recorded ');
    expect(markup).not.toContain('Live Pool reference');expect(markup).not.toContain('Price unavailable');
    // A recent record shows its age, like the live state does. An old record shows its date. The exact time stays in the title.
    const clock=vi.spyOn(Date,'now').mockReturnValue(1_000_000_000);
    try{
      const recorded=(sampledAt:string)=>renderToStaticMarkup(createElement(TradingProductSwitch,{
        activeProduct:'dex',dexCandidate:STAGED_EXIT_PREVIEW_DEX_CANDIDATE,onNavigate:()=>{},selectedPair:['BCN','ORBT'],onSelectedPairChange:()=>{},
        priceDisplayInverted:inverted,onPriceDisplayInvertedChange:()=>{},marketReference:{status:'last-known',price:2,sampledAt,revision:'1'}}));
      expect(recorded('999955')).toContain('>Recorded 45s ago<');expect(recorded('999400')).toContain('>Recorded 10m ago<');
      expect(recorded('996401')).toContain('>Recorded 59m ago<');
      const old=recorded('996400');expect(old).toMatch(/>Recorded \d{1,2} \w{3} \d{4}, \d{2}:\d{2}</);expect(old).not.toMatch(/Recorded \d+[sm] ago/);
      expect(recorded('999955')).toMatch(/title="\d{1,2} \w{3} \d{4}, \d{2}:\d{2} · Last recorded public Pool price\. Current market price is not verified\."/);
    }finally{clock.mockRestore();}
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
    expect(markup).toContain('trading-market-catalog-p2p');
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

    expect(markup).toContain('Selected displayed pair Test token 1 and Test token 0');
    expect(markup).toContain('Test token 0/Test token 1');
    expect(markup).toContain('Reverse price display to 1 Test token 0 priced in Test token 1');
    expect(markup).toContain('Price unavailable');
    expect(markup).not.toContain('0.2500');
    expect(markup).not.toContain('ORBT');
    expect(markup).toContain('aria-current="page">DEX</button>');
  });
});
