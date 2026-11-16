import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-097. Binds the rules for Portal, Private TVL, Home and the pair picker that the local preview
// measured: every page header is 72 px with 44 px controls (Portal, TVL and Home were 66 px with 32-38 px
// controls), the Portal search is one 44 px field, Token contracts uses the one chevron, and small labels
// use the 12 px text floor.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const MARK = '/* CW-097. Portal, Private TVL, Home and the pair picker:';
const block = () => {
  const css = read('styles/120-owner-dark-design.css');
  const at = css.indexOf(MARK);
  expect(at, MARK).toBeGreaterThan(-1);
  return css.slice(at);
};
const rule = (selectorPart: string) => {
  const css = block();
  const at = css.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('touch size on every page', () => {
  it('extends the App 44 px rule to the Portal, TVL and Home shells', () => {
    const touch = rule(':root body .app-shell:is(.app-shell-swap, .app-shell-landing) :is(button,');
    expect(touch).toContain('min-width: 44px;');
    expect(touch).toContain('min-height: 44px;');
  });

  it('keeps the Portal search input inside one 44 px field with the App field tokens', () => {
    const field = rule('.app-shell-swap .privacy-token-search {');
    expect(field).toContain('min-height: 44px;');
    expect(field).toContain('border: 1px solid var(--border-default);');
    expect(field).toContain('border-radius: 4px;');
  });
});

describe('pair picker and labels', () => {
  it('gives Token contracts the one chevron that turns when open', () => {
    expect(rule('.trading-market-token-details > summary {')).toContain('list-style: none;');
    expect(rule('.trading-market-token-details > summary::after {')).toContain('rotate(45deg)');
    expect(rule('.trading-market-token-details[open] > summary::after {')).toContain('rotate(225deg)');
  });

  it('uses the 12 px text floor for pair picker, TVL and Portal labels, with token colours only', () => {
    const floor = rule(':root body .app-shell :is(.trading-market-catalog > header');
    expect(floor).toContain('.treasury-meta-card > span');
    expect(floor).toContain('.privacy-connection-facts small');
    expect(floor).toContain('font-size: .75rem;');
    expect(block()).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});
