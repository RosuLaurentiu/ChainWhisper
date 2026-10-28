import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradingProductSwitch from './TradingProductSwitch';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from '../../lib/currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../lib/currentDexHistoryCandidate';
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
      expect(markup).toContain(inverted ? '0.5 BCN per ORBT' : '2 ORBT per BCN');
      expect(markup).toContain('Rounded Pool reference · excludes Limits');
      expect(markup).toContain('title="Expires after 120s">25s ago');
      expect(markup).toContain('Current Testnet pairs');
      expect(markup).not.toContain('Test token 0');
    } finally { clock.mockRestore(); }
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
    expect(markup).toContain(inverted?'0.5 Test token 0 per Test token 1':'2 Test token 1 per Test token 0');
    expect(markup).not.toContain('Price unavailable');
  });
  it.each(['loading','stale','unavailable'] as const)('shows %s without a substituted seed price',status=>{
    const markup=renderToStaticMarkup(createElement(TradingProductSwitch,{
      activeProduct:'dex',onNavigate:()=>{},selectedPair:['BCN','HBR'],onSelectedPairChange:()=>{},
      priceDisplayInverted:false,onPriceDisplayInvertedChange:()=>{},marketReference:{status}
    }));
    expect(markup).toContain(status==='loading'?'Checking price':status==='stale'?'Price stale':'Price unavailable');
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
    expect(markup).toContain('cwTPQ <small>per cwTPB</small>');
    expect(markup).toContain('Price unavailable');
    expect(markup).toMatch(new RegExp(`<option value="0x${'11'.repeat(20)}"[^>]* selected=""`));
    expect(markup).toMatch(new RegExp(`<option value="0x${'22'.repeat(20)}"[^>]* selected=""`));
    expect(markup).not.toContain('BCN');
    expect(markup).not.toContain('Testnet seed');
  });

  it.each([false, true])('uses actual P2P identities and reference labels with inversion=%s', inverted => {
    const market = { ...p2pMarket(), reference: { label: inverted ? '4 cwTPB' : '0.25 cwTPQ', title: 'Carbon market reference', basisLabel: inverted ? 'cwTPB/cwTPQ' : 'cwTPQ/cwTPB' } };
    const markup = renderToStaticMarkup(createElement(TradingProductSwitch, { activeProduct: 'p2p', p2pMarket: market,
      onNavigate: vi.fn(), priceDisplayInverted: inverted, onPriceDisplayInvertedChange: vi.fn() }));
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
    expect(markup).toContain('Test token 0 <small>per Test token 1</small>');
    expect(markup).toContain('Reverse price display to 1 Test token 0 priced in Test token 1');
    expect(markup).toContain('Price unavailable');
    expect(markup).not.toContain('0.2500');
    expect(markup).not.toContain('ORBT');
    expect(markup).toContain('aria-current="page">DEX</button>');
  });
});
