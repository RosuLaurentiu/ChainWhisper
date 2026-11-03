import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DexViewTabs, TradeEntryModeTabs, TradeProductTabs, TradeViewTabs } from './TradeDeskTabs';

describe('shared Trading navigation', () => {
  it('keeps product switching concise', () => {
    const markup = renderToStaticMarkup(createElement(TradeProductTabs, {
      activeProduct: 'dex',
      onNavigate: () => undefined
    }));

    expect(markup).toContain('<span>DEX</span>');
    expect(markup).toContain('<span>P2P</span>');
  });

  it('exposes Agent as a DEX workspace destination', () => {
    const markup = renderToStaticMarkup(createElement(DexViewTabs, {
      activeView: 'agent',
      onSelect: () => undefined
    }));

    const positions = ['<span>Trade</span>', '<span>Liquidity</span>', '<span>Manage</span>', '>Agent</button>']
      .map(label => markup.indexOf(label));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markup).toContain('aria-current="page"');
  });

  it.each(['positions', 'activity'] as const)('opens the same Manage area for %s', activeView => {
    const markup = renderToStaticMarkup(createElement(DexViewTabs, { activeView, onSelect: () => undefined }));
    expect(markup).toMatch(/aria-current="page"[^>]*><span>Manage<\/span>/);
    expect(markup).not.toContain('<span>Activity</span>');
  });

  it('exposes Agent beside the primary P2P journey', () => {
    const markup = renderToStaticMarkup(createElement(TradeViewTabs, {
      routeSurfaceView: 'agent',
      routeView: 'agent',
      onNavigateDeskView: () => undefined
    }));

    expect(markup).toContain('Offers');
    expect(markup).toContain('Create');
    expect(markup).toContain('My trades');
    expect(markup).toContain('Agent');
    expect(markup).toContain('aria-current="page"');
  });

  it.each([['public', 'Offers'], ['swap', 'Offers'], ['create', 'Create'], ['mine', 'My trades']] as const)(
    'keeps %s orders within the existing %s section', (view, label) => {
    const navigation = TradeViewTabs({
      routeSurfaceView: view,
      routeView: view,
      onNavigateDeskView: () => undefined
    });
    const markup = renderToStaticMarkup(navigation);
    expect(markup).not.toContain('Private Liquidity');
    expect(markup).not.toContain('Bid/ask');
    expect(markup).not.toContain('Hidden limit');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`aria-current="page"[^>]*><span>${label}</span>`));
  });

  it('keeps Swap and recurring creation out of the Create workspace', () => {
    const markup = renderToStaticMarkup(createElement(TradeEntryModeTabs, {
      activeTradeMode: 'limit',
      createOnly: true,
      onOpenTradeEntryMode: () => undefined
    }));

    expect(markup).toContain('One-off');
    expect(markup).not.toContain('Recurring');
    expect(markup).not.toContain('Swap');
    expect(markup).not.toContain('>Limit<');
  });

  it('does not offer a recurring entry in the retained trade-mode control', () => {
    const markup = renderToStaticMarkup(createElement(TradeEntryModeTabs, {
      activeTradeMode: 'limit',
      onOpenTradeEntryMode: () => undefined
    }));

    expect(markup).toContain('Swap');
    expect(markup).toContain('Limit');
    expect(markup).not.toContain('Recurring');
  });
});
