import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-098. The 17 November accessibility audit (APP/reports/accessibility-audit-2026-11-17) measured these rules in the
// built candidate. A component test cannot see the cascade, so these tests bind the CSS that fixes them.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const MARK = '/* CW-098. Accessibility:';
const block = () => {
  const css = read('styles/120-owner-dark-design.css');
  const at = css.indexOf(MARK);
  expect(at, MARK).toBeGreaterThan(-1);
  return css.slice(at);
};
const rule = (selectorPart: string) => {
  const source = block();
  const at = source.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};

describe('P2P tab focus ring (WCAG 2.4.7)', () => {
  it('draws the shared focus outline on the P2P tabs at every width', () => {
    // 110-approved-trading-design.css sets outline: 0 on these buttons and 120 sets box-shadow: none, so the
    // shared ring needs a rule that outranks both.
    const ring = rule(':root body .app-shell-trades :is(.p2p-market-tabs, .p2p-create-tabs) .p2p-trade-tabs button:focus-visible {');
    expect(ring).toContain('outline: 2px solid #c4b5fd;');
    expect(ring).toContain('outline-offset: -2px;');
    const css = block();
    expect(css.lastIndexOf('@media', css.indexOf('.p2p-trade-tabs button:focus-visible'))).toBe(-1);
  });
});

describe('P2P Offers reflow at 320 px (WCAG 1.4.10)', () => {
  it('lets the offer list columns shrink below 360 px instead of keeping 296 px of minimum widths', () => {
    const css = block();
    const media = css.indexOf('@media (max-width: 359.98px) {');
    expect(media, 'narrow media query').toBeGreaterThan(-1);
    const cols = rule(':root body .app-shell-trades :is(.p2p-offers-list-head, .p2p-offer-rate-row) {');
    expect(css.indexOf(':root body .app-shell-trades :is(.p2p-offers-list-head, .p2p-offer-rate-row) {')).toBeGreaterThan(media);
    expect(cols).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 0.86fr) minmax(0, 0.8fr) 54px;');
    expect(rule(':root body .app-shell-trades :is(.p2p-offers-list-head, .p2p-offer-rate-row) > * {')).toContain('min-width: 0;');
  });
});
