import { describe, expect, it } from 'vitest';
import { findRule, HEX, stylesheet } from './cssRuleTestHelpers';

// CW-097. Binds the rules for Portal, Private TVL, Home and the pair picker that the local preview
// measured: every page header is 72 px with 44 px controls (Portal, TVL and Home were 66 px with 32-38 px
// controls), the Portal search is one 44 px field, Token contracts uses the one chevron, and small labels
// use the 12 px text floor.
// CW-158: each rule is looked up in the feature stylesheet that holds it; each bound rule uses token colours only.
const rule = (feature: string, selectorPart: string) => {
  const found = findRule(stylesheet(feature), selectorPart);
  expect(found.text, selectorPart).not.toMatch(HEX);
  return found.text;
};

describe('touch size on every page', () => {
  it('extends the App 44 px rule to the Portal, TVL and Home shells', () => {
    const touch = rule('portal', ':root body .app-shell:is(.app-shell-swap, .app-shell-landing) :is(button,');
    expect(touch).toContain('min-height: 44px;');
    // No min-width on every button: it would undo wider set widths such as the Home Open Chat button.
    expect(touch).not.toContain('min-width');
    expect(rule('shell', '.app-shell:is(.app-shell-swap, .app-shell-landing) .header-icon-btn {')).toContain('min-width: 44px;');
  });

  it('keeps the Portal search input inside one 44 px field with the App field tokens', () => {
    const field = rule('portal', '.app-shell-swap .privacy-token-search {');
    expect(field).toContain('min-height: 44px;');
    expect(field).toContain('border: 1px solid var(--border-default);');
    expect(field).toContain('border-radius: 4px;');
  });
});

describe('pair picker and labels', () => {
  it('gives Token contracts the one chevron that turns when open', () => {
    expect(rule('shell', '.trading-market-token-details > summary {')).toContain('list-style: none;');
    expect(rule('shell', '.trading-market-token-details > summary::after {')).toContain('rotate(45deg)');
    expect(rule('shell', '.trading-market-token-details[open] > summary::after {')).toContain('rotate(225deg)');
  });

  it('uses the 12 px text floor for pair picker, TVL and Portal labels, with token colours only', () => {
    const floor = rule('shell', ':root body .app-shell :is(.trading-market-catalog > header');
    expect(floor).toContain('.treasury-meta-card > span');
    expect(floor).toContain('.privacy-connection-facts small');
    expect(floor).toContain('font-size: .75rem;');
  });
});
