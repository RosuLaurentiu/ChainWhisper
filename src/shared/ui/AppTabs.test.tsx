import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppTab, AppTabList } from './AppTabs';

const render = (value: 'buy' | 'sell', sellDisabled = false) =>
  renderToStaticMarkup(
    <AppTabList value={value} onChange={vi.fn()} label="Trade direction" className="p2p-swap-side-switch">
      <AppTab value="buy" data-swap-mode="buy">Buy</AppTab>
      <AppTab value="sell" className="sell" disabled={sellDisabled}>Sell</AppTab>
    </AppTabList>
  );

describe('AppTabList', () => {
  it('renders one tab list with the App classes and no wrapper element', () => {
    const markup = render('buy');

    expect(markup.startsWith('<div')).toBe(true);
    expect(markup.match(/<div/g)).toHaveLength(1);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Trade direction"');
    expect(markup).toContain('class="app-ui p2p-swap-side-switch"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('data-swap-mode="buy"');
  });

  it('marks the selected tab and gives it the only tab stop', () => {
    const markup = render('sell');
    const [buy, sell] = markup.split('<button').slice(1);

    expect(buy).toContain('aria-selected="false"');
    expect(buy).toContain('tabindex="-1"');
    expect(buy).toContain('class="app-ui"');
    expect(sell).toContain('aria-selected="true"');
    expect(sell).toContain('tabindex="0"');
    expect(sell).toContain('class="app-ui sell active"');
  });

  it('marks a disabled tab', () => {
    const [, sell] = render('buy', true).split('<button').slice(1);

    expect(sell).toMatch(/aria-disabled="true"|disabled=""/);
  });
});
