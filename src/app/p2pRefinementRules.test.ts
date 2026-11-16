import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-097. A component test cannot see layout. These tests bind the P2P refinement rules that the local
// preview measured: the CW-096 segmented style in Create, one disabled look for main buttons, one
// disclosure chevron, the CW-095 title on My trades, the neutral wallet note and the recovery row that
// My trades no longer covers.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const MARK = '/* CW-097. P2P:';
const block = () => {
  const css = read('styles/120-owner-dark-design.css');
  const at = css.indexOf(MARK);
  expect(at, MARK).toBeGreaterThan(-1);
  return css.slice(at);
};
const rule = (selectorPart: string, source = block()) => {
  const at = source.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};
const TABS = ':is(.standalone-trade-create-panel, .p2p-counter-panel) .trade-compose-direction-control > [role="tablist"]';

describe('P2P Create Buy / Sell', () => {
  it('uses the CW-096 segmented style with the 6 px corner and 44 px buttons', () => {
    expect(rule(`${TABS} {`)).toContain('border-radius: 6px;');
    expect(rule(`${TABS} > button {`)).toContain('min-height: 44px;');
    const selected = rule(`${TABS} > button[aria-selected="true"] {`);
    expect(selected).toContain('background: var(--surface-interactive);');
    expect(selected).toContain('box-shadow: inset 0 -2px var(--brand-strong);');
  });

  it('shows a disabled main button as DEX does', () => {
    expect(rule('.trade-compose-send:disabled {')).toContain('opacity: .68;');
  });
});

describe('P2P disclosures and titles', () => {
  it('gives plain-text summaries one chevron that turns when open', () => {
    expect(rule('.p2p-trading-shell details > summary:not(:has(*)) {')).toContain('list-style: none;');
    expect(rule('.p2p-trading-shell details > summary:not(:has(*))::after {')).toContain('rotate(45deg)');
    expect(rule('.p2p-trading-shell details[open] > summary:not(:has(*))::after {')).toContain('rotate(225deg)');
  });

  it('uses the CW-095 panel title on My trades', () => {
    expect(rule('.p2p-my-trades-section > .standalone-trades-section-head h2 {')).toContain('font: 700 1.1rem/normal "Inter"');
  });
});

describe('P2P states and layout', () => {
  it('shows the missing wallet session as a neutral note, not in the error colour', () => {
    expect(rule('.p2p-market-status.p2p-market-status-note {')).toContain('color: var(--text-secondary);');
    expect(rule('.p2p-offers-empty.is-note {')).toContain('border-color: var(--border-default);');
  });

  it('lets My trades fit its grid row on desktop so the strategy recovery row below stays clickable', () => {
    const desktop = block().slice(block().indexOf('@media (min-width: 920.02px)'));
    expect(rule('.p2p-trading-shell-mine > .p2p-my-trades-section {', desktop)).toContain('min-height: 0;');
  });

  it('keeps the token field label for screen readers only on small screens', () => {
    const mobile = block().slice(block().indexOf('@media (max-width: 920px)'));
    expect(rule('.trade-compose-asset-field > .trade-compose-field-head {', mobile)).toContain('clip-path: inset(50%);');
  });

  it('uses the 12 px text floor in the offer filter and no new hex values', () => {
    expect(rule('.p2p-offers-filter-heading > span')).toContain('font-size: .75rem;');
    expect(block()).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});
