import { describe, expect, it } from 'vitest';
import { findRule, stylesheet } from './cssRuleTestHelpers';

// CW-094. A component test cannot see layout. These tests bind the style rules that the
// local preview measured: one tab menu position on every DEX and P2P page, and one inset in P2P Create.
// CW-158: each rule is looked up in the feature stylesheet that holds it, with its @media condition.
const DESKTOP = '(min-width: 920.02px)';
const rule = (feature: string, selectorPart: string, media?: string | null) => {
  const found = findRule(stylesheet(feature), selectorPart, media);
  if (media !== undefined) expect(found.media, selectorPart).toBe(media);
  return found.text;
};

describe('Trading tab menu position', () => {
  it('keeps the DEX page scrollbar space and gives it back in the right inset', () => {
    const page = rule('dex', ':root body .app-shell-dex-v2 .dex-v2-page {', DESKTOP);
    expect(page).toContain('scrollbar-gutter: stable;');
    expect(page).toContain('--dex-page-end-inset: calc(var(--trading-content-gutter) - (100vw - 100%) / 2);');
    expect(rule('dex', ':root body .app-shell-dex-v2 .dex-v2-main {', DESKTOP)).toContain('padding: 0 var(--dex-page-end-inset) 24px var(--trading-content-gutter);');
    expect(rule('dex', ':root body .app-shell-dex-v2 .dex-v2-page > .dex-v2-mode-nav {', DESKTOP)).toContain('padding: 8px var(--dex-page-end-inset) 8px var(--trading-content-gutter);');
  });

  it('gives both Agent pages the page gutter and the four-column tab grid', () => {
    expect(rule('p2p', ':root body .app-shell-trades .p2p-trading-shell > .p2p-market-overview-agent {', DESKTOP)).toContain('padding-inline: var(--trading-content-gutter);');
    const p2p = stylesheet('p2p');
    const grid = p2p.slice(p2p.indexOf(':root body .app-shell-dex-v2 .dex-v2-page .dex-v2-mode-nav .dex-view-navigation,'));
    const selectors = grid.slice(0, grid.indexOf('{'));
    expect(selectors).toContain(':root body .app-shell-trades :is(.p2p-market-tabs, .p2p-create-tabs) .dex-view-navigation,');
    expect(grid.slice(0, grid.indexOf('}'))).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(findRule(p2p, ':root body .app-shell-dex-v2 .dex-v2-page .dex-v2-mode-nav .dex-view-navigation,').media).toBe(DESKTOP);
  });
});

describe('P2P Create window', () => {
  const panel = ':root body .app-shell-trades .p2p-trading-shell-create-with-offers > .standalone-trade-create-panel';

  it('uses one inset for the title and the sections', () => {
    expect(rule('p2p', `${panel} > .standalone-trades-section-head {`, DESKTOP)).toContain('padding: 14px 16px 6px;');
    expect(rule('p2p', `${panel} > .trade-compose-panel {`, DESKTOP)).toContain('padding: 0 16px;');
    expect(rule('p2p', `${panel} :is(.trade-compose-settings-slot-primary, .p2p-trade-access-settings, .standalone-trade-visibility, .p2p-create-terms) {`, DESKTOP)).toContain('padding: 0;');
  });

  it('uses the DEX numeral size and keeps the submit area in view', () => {
    const numerals = rule('p2p', `${panel} .trade-compose-panel :is(.trade-compose-limit-price, .trade-compose-section-sell, .trade-compose-section-buy)`, DESKTOP);
    expect(numerals).toContain('font-size: 1.75rem;');
    const dock = rule('p2p', `${panel} .trade-compose-quote-dock {`, DESKTOP);
    expect(dock).toContain('position: sticky;');
    expect(dock).toContain('bottom: 0;');
  });

  it('keeps the token picker label for screen readers without an empty box', () => {
    const label = rule('p2p', `${panel} .trade-compose-asset-field > .trade-compose-field-head {`, DESKTOP);
    expect(label).toContain('clip-path: inset(50%);');
    expect(label).not.toContain('display: none');
  });
});

describe('small alignment rules', () => {
  it('puts the arrow of every wallet menu row in the last column', () => {
    expect(rule('wallet', '.wallet-utility-row > svg:last-child {')).toContain('grid-column: -2 / -1;');
  });

  it('uses the window text style for every text line of a review window', () => {
    expect(stylesheet('p2p')).toContain(':root body .trade-action-confirm-content .modal-copy {');
  });
});
