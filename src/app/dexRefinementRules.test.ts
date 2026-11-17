import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-097. A component test cannot see layout. These tests bind the DEX refinement rules that the local
// preview measured: one disclosure chevron, the Limit entry box and main button, compact Liquidity fields,
// token-colour test-token rows and four equal mobile bottom tabs.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const MARK = '/* CW-097. DEX:';
const css = () => read('styles/120-owner-dark-design.css');
const block = () => {
  const all = css();
  const at = all.indexOf(MARK);
  expect(at, MARK).toBeGreaterThan(-1);
  return all.slice(at);
};
const rule = (selectorPart: string, source = block()) => {
  const at = source.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};
const HEX = /#[0-9a-f]{3,8}\b/iu;

describe('one disclosure marker on DEX pages', () => {
  it('removes the plus and the browser triangle', () => {
    expect(rule('> summary::before {')).toContain('content: none;');
    expect(rule('> summary::-webkit-details-marker {')).toContain('display: none;');
    expect(rule('.dex-market-history-data, :is(.dex-v2-token-funding, .dex-history-row, .dex-market-chart, .dex-v2-setup) details) > summary {'))
      .toContain('list-style: none;');
  });

  it('draws one chevron on the right that turns when open, and keeps an existing lucide chevron', () => {
    const chevron = rule('> summary:not(:has(svg.lucide-chevron-down))::after {');
    expect(chevron).toContain('margin: 0 4px 0 auto;');
    expect(chevron).toContain('transform: translateY(-2px) rotate(45deg);');
    expect(rule('[open] > summary:not(:has(svg.lucide-chevron-down))::after {')).toContain('rotate(225deg)');
  });

  it('uses token colours and keeps the danger colour of close actions', () => {
    expect(rule(':not(.dex-owner-danger) > summary {')).toContain('color: var(--text-secondary);');
    expect(rule(':not(.dex-owner-danger)[open] > summary {')).toContain('color: var(--text-primary);');
  });
});

describe('Limit entry and main button', () => {
  it('puts amount and price in one box with a hairline, as the Swap amount box', () => {
    expect(rule('.dex-v2-limit-entry {')).toContain('border: 1px solid var(--border-default);');
    expect(rule('.dex-v2-limit-entry {')).toContain('border-radius: 6px;');
    expect(rule('.dex-v2-limit-entry > .dex-v2-limit-price-field {')).toContain('border-top: 1px solid var(--border-subtle);');
    expect(rule('.dex-v2-limit-entry input {')).toContain('font-size: 1.75rem;');
  });

  it('keeps the primary fill on the Limit main button: the secondary rule skips .dex-v2-review-button', () => {
    const secondary = rule(':root body .app-shell :is(.standalone-trade-secondary-btn', css());
    expect(secondary).toContain('.dex-owner-workspace button:not(.dex-owner-danger):not([aria-pressed="true"]):not(.privacy-locked-notice > button):not(.dex-v2-review-button)');
  });
});

describe('compact Liquidity panel', () => {
  it('uses one frame per amount field and a 12 px section rhythm', () => {
    const field = rule('.dex-v2-pool-amounts-section .dex-v2-current-fields label {');
    expect(field).toContain('padding: 0;');
    expect(field).toContain('border: 0;');
    expect(rule('section.dex-v2-current-pool .dex-v2-pool-section {')).toContain('padding: 12px 0;');
    expect(rule('section.dex-v2-current-pool .dex-v2-composer-heading h2 {')).toContain('font-size: 1.1rem;');
  });

  it('gives recovery buttons with no class the secondary style at the 44 px touch size', () => {
    const button = rule('section.dex-v2-current-pool :is(.dex-v2-setup, .dex-v2-current-fields) button:not([class]) {');
    expect(button).toContain('min-height: 44px;');
    expect(button).toContain('border: 1px solid var(--border-default);');
  });
});

describe('test-token rows', () => {
  it('shows one row per token and hides an empty status line', () => {
    expect(rule('.dex-v2-beta-token-card {')).toContain('grid-template-columns: minmax(72px, auto) minmax(0, 1fr) auto;');
    expect(rule('.dex-v2-beta-token-card > .dex-v2-beta-token-status:empty {')).toContain('display: none;');
  });

  it('uses token colours, with no new hex values in the DEX block', () => {
    expect(rule('.dex-v2-token-funding button:not(.dex-v2-review-button) {')).toContain('background: var(--surface-base);');
    expect(block().slice(0, block().indexOf('@media (max-width: 920px)'))).not.toMatch(HEX);
  });
});

describe('DEX column divider', () => {
  it('removes the vertical line left of the Trade, Limit and Liquidity column (owner decision 2026-11-18)', () => {
    expect(rule(':root body .app-shell-dex-v2 .dex-v2-content-grid > .dex-v2-form-column {')).toContain('border-left: 0;');
  });
});

describe('mobile Trading shell on DEX pages', () => {
  const mobile = () => block().slice(block().indexOf('@media (max-width: 920px)'));

  it('keeps the three-row DEX bar on the DEX Agent page, which also has the P2P shell class', () => {
    expect(rule(':root body .app-shell.app-shell-dex-v2.app-shell-trades {', mobile()))
      .toContain('calc(var(--ux-mobile-trading-nav) + var(--ux-mobile-pair-context) + 44px)');
    expect(rule('.app-shell-dex-v2.app-shell-trades > .trading-product-bar {', mobile())).toContain('+ 44px);');
  });

  it('shows four equal bottom tabs with the 12 px text floor and the 44 px touch size', () => {
    expect(rule('.dex-view-navigation:has(> .dex-agent-link) > nav {', mobile())).toContain('flex: 3 1 0;');
    const agent = rule('.dex-view-navigation > .dex-agent-link {', mobile());
    expect(agent).toContain('flex: 1 1 0;');
    expect(agent).toContain('min-height: 44px;');
    expect(agent).toContain('font-size: .75rem;');
  });

  it('starts at the mobile breakpoint used by the App', () => {
    expect(block()).toContain('@media (min-width: 920.02px) and (max-height: 700px)');
    expect(block()).not.toContain('min-width: 921px');
  });
});
