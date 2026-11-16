import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-094. A component test cannot see layout. These tests bind the style rules that the
// local preview measured: one tab menu position on every DEX and P2P page, and one inset in P2P Create.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const last = read('styles/120-owner-dark-design.css');
const trading = read('styles/110-approved-trading-design.css');
const rule = (css: string, selectorPart: string) => {
  const at = css.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('Trading tab menu position', () => {
  it('keeps the DEX page scrollbar space and gives it back in the right inset', () => {
    const page = rule(last, ':root body .app-shell-dex-v2 .dex-v2-page {');
    expect(page).toContain('scrollbar-gutter: stable;');
    expect(page).toContain('--dex-page-end-inset: calc(var(--trading-content-gutter) - (100vw - 100%) / 2);');
    expect(rule(last, ':root body .app-shell-dex-v2 .dex-v2-main {')).toContain('padding: 0 var(--dex-page-end-inset) 24px var(--trading-content-gutter);');
    expect(rule(last, ':root body .app-shell-dex-v2 .dex-v2-page > .dex-v2-mode-nav {')).toContain('padding: 8px var(--dex-page-end-inset) 8px var(--trading-content-gutter);');
  });

  it('gives both Agent pages the page gutter and the four-column tab grid', () => {
    expect(rule(last, ':root body .app-shell-trades .p2p-trading-shell > .p2p-market-overview-agent {')).toContain('padding-inline: var(--trading-content-gutter);');
    const grid = last.slice(last.indexOf(':root body .app-shell-dex-v2 .dex-v2-page .dex-v2-mode-nav .dex-view-navigation,'));
    const selectors = grid.slice(0, grid.indexOf('{'));
    expect(selectors).toContain(':root body .app-shell-trades :is(.p2p-market-tabs, .p2p-create-tabs) .dex-view-navigation,');
    expect(grid.slice(0, grid.indexOf('}'))).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
  });
});

describe('P2P Create window', () => {
  const panel = ':root body .app-shell-trades .p2p-trading-shell-create-with-offers > .standalone-trade-create-panel';

  it('uses one inset for the title and the sections', () => {
    expect(rule(last, `${panel} > .standalone-trades-section-head {`)).toContain('padding: 14px 16px 6px;');
    expect(rule(last, `${panel} > .trade-compose-panel {`)).toContain('padding: 0 16px;');
    expect(rule(last, `${panel} :is(.trade-compose-settings-slot-primary, .p2p-trade-access-settings, .standalone-trade-visibility, .p2p-create-terms) {`)).toContain('padding: 0;');
  });

  it('uses the DEX numeral size and keeps the submit area in view', () => {
    const numerals = rule(last, `${panel} .trade-compose-panel :is(.trade-compose-limit-price, .trade-compose-section-sell, .trade-compose-section-buy)`);
    expect(numerals).toContain('font-size: 1.75rem;');
    const dock = rule(last, `${panel} .trade-compose-quote-dock {`);
    expect(dock).toContain('position: sticky;');
    expect(dock).toContain('bottom: 0;');
  });

  it('keeps the token picker label for screen readers without an empty box', () => {
    const label = rule(last, `${panel} .trade-compose-asset-field > .trade-compose-field-head {`);
    expect(label).toContain('clip-path: inset(50%);');
    expect(label).not.toContain('display: none');
  });
});

describe('small alignment rules', () => {
  it('puts the arrow of every wallet menu row in the last column', () => {
    expect(rule(trading, '.wallet-utility-row > svg:last-child {')).toContain('grid-column: -2 / -1;');
  });

  it('uses the window text style for every text line of a review window', () => {
    expect(last).toContain(':root body .trade-action-confirm-content .modal-copy {');
  });
});
