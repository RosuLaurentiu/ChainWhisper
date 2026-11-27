import { describe, expect, it } from 'vitest';
import { findRule, stylesheet } from './cssRuleTestHelpers';

// CW-098. The 17 November accessibility audit (APP/reports/accessibility-audit-2026-11-17) measured these rules in the
// built candidate. A component test cannot see the cascade, so these tests bind the CSS that fixes them.
// CW-158: each rule is looked up in the feature stylesheet that holds it, with its @media condition.
const rule = (selectorPart: string, media?: string | null) => findRule(stylesheet('p2p'), selectorPart, media);

describe('P2P tab focus ring (WCAG 2.4.7)', () => {
  it('draws the shared focus outline on the P2P tabs at every width', () => {
    // The trading design sets outline: 0 on these buttons and the owner design sets box-shadow: none, so the
    // shared ring needs a rule that outranks both.
    const ring = rule(':root body .app-shell-trades :is(.p2p-market-tabs, .p2p-create-tabs) .p2p-trade-tabs button:focus-visible {');
    expect(ring.text).toContain('outline: 2px solid var(--ux-focus-ring);');
    expect(ring.text).toContain('outline-offset: -2px;');
    // At every width: the rule is outside every @media block.
    expect(ring.media).toBeNull();
  });
});

describe('P2P Offers reflow at 320 px (WCAG 1.4.10)', () => {
  it('lets the offer list columns shrink below 360 px instead of keeping 296 px of minimum widths', () => {
    const cols = rule(':root body .app-shell-trades :is(.p2p-offers-list-head, .p2p-offer-rate-row) {', '(max-width: 359.98px)');
    expect(cols.media, 'narrow media query').toBe('(max-width: 359.98px)');
    expect(cols.text).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 0.86fr) minmax(0, 0.8fr) 54px;');
    const cells = rule(':root body .app-shell-trades :is(.p2p-offers-list-head, .p2p-offer-rate-row) > * {', '(max-width: 359.98px)');
    expect(cells.text).toContain('min-width: 0;');
  });
});
