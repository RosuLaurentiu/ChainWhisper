import { describe, expect, it } from 'vitest';
import { findRule, HEX, stylesheet } from './cssRuleTestHelpers';

// CW-097. A component test cannot see layout. These tests bind the P2P refinement rules that the local
// preview measured: the CW-096 segmented style in Create, one disabled look for main buttons, one
// disclosure chevron, the CW-095 title on My trades, the neutral wallet note and the recovery row that
// My trades no longer covers.
// CW-158: each rule is looked up in the P2P stylesheet, with its @media condition where the rule binds one;
// each bound rule uses token colours only.
const rule = (selectorPart: string, media?: string | null) => {
  const found = findRule(stylesheet('p2p'), selectorPart, media);
  expect(found.text, selectorPart).not.toMatch(HEX);
  return found;
};
const TABS = '.standalone-trade-create-panel .trade-compose-direction-control > [role="tablist"]';

describe('P2P Create Buy / Sell', () => {
  it('uses the CW-096 segmented style with the 6 px corner and 44 px buttons', () => {
    expect(rule(`${TABS} {`).text).toContain('border-radius: 6px;');
    expect(rule(`${TABS} > button {`).text).toContain('min-height: 44px;');
    const selected = rule(`${TABS} > button[aria-selected="true"] {`).text;
    expect(selected).toContain('background: var(--surface-interactive);');
    expect(selected).toContain('box-shadow: inset 0 -2px var(--brand-strong);');
  });

  it('shows a disabled main button as DEX does', () => {
    expect(rule(':root body .app-shell .trade-compose-send:disabled {').text).toContain('opacity: .68;');
  });
});

describe('P2P disclosures and titles', () => {
  it('gives plain-text summaries one chevron that turns when open', () => {
    expect(rule('.p2p-trading-shell details > summary:not(:has(*)) {').text).toContain('list-style: none;');
    expect(rule('.p2p-trading-shell details > summary:not(:has(*))::after {').text).toContain('rotate(45deg)');
    expect(rule('.p2p-trading-shell details[open] > summary:not(:has(*))::after {').text).toContain('rotate(225deg)');
  });

  it('uses the CW-095 panel title on My trades', () => {
    expect(rule('.p2p-my-trades-section > .standalone-trades-section-head h2 {').text).toContain('font: 700 1.1rem/normal "Inter"');
  });
});

describe('P2P states and layout', () => {
  it('shows the missing wallet session as a neutral note, not in the error colour', () => {
    expect(rule('.p2p-market-status.p2p-market-status-note {').text).toContain('color: var(--text-secondary);');
    expect(rule('.p2p-offers-empty.is-note {').text).toContain('border-color: var(--border-default);');
  });

  it('lets My trades fit its grid row on desktop so the strategy recovery row below stays clickable', () => {
    const mine = rule(':root body .app-shell-trades .p2p-trading-shell-mine > .p2p-my-trades-section {', '(min-width: 920.02px)');
    expect(mine.media).toBe('(min-width: 920.02px)');
    expect(mine.text).toContain('min-height: 0;');
  });

  it('keeps the token field label for screen readers only on small screens', () => {
    const label = rule(':root body .app-shell-trades .standalone-trade-create-panel .trade-compose-asset-field > .trade-compose-field-head {', '(max-width: 920px)');
    expect(label.media).toBe('(max-width: 920px)');
    expect(label.text).toContain('clip-path: inset(50%);');
  });

  it('gives the token picker meta text the grey text token at the 12 px floor (was a lavender literal)', () => {
    const meta = rule(':root body .app-shell-trades :is(.trade-token-select-trigger-copy small, .trade-token-select-state span').text;
    expect(meta).toContain('.trade-token-select-state a');
    expect(meta).toContain('color: var(--text-tertiary);');
    expect(meta).toContain('font-size: .75rem;');
    expect(meta).not.toContain('217, 211, 255');
  });

  it('draws no fill behind the contract link row: only the picker trigger has a box', () => {
    expect(rule('.p2p-trading-shell .trade-compose-section :is(.trade-compose-asset-field, .trade-token-select) {').text).toContain('background: transparent;');
  });

  it('uses the 12 px text floor in the offer filter and no new hex values', () => {
    expect(rule('.p2p-offers-filter-heading > span').text).toContain('font-size: .75rem;');
  });
});
