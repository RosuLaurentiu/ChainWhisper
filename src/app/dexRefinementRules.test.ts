import { describe, expect, it } from 'vitest';
import { allStylesheets, findRule, HEX, readSource, stylesheet } from './cssRuleTestHelpers';

// CW-097. A component test cannot see layout. These tests bind the DEX refinement rules that the local
// preview measured: one disclosure chevron, the Limit entry box and main button, compact Liquidity fields,
// token-colour test-token rows and four equal mobile bottom tabs.
// CW-158: each rule is looked up in the feature stylesheet that holds it, with its @media condition where the
// rule binds one. "No new hex values in the block" is checked on each bound rule of that block.
const rule = (feature: string, selectorPart: string, media?: string | null) => findRule(stylesheet(feature), selectorPart, media).text;
// A rule of the CW-097 DEX block or of a later owner block that uses token colours only.
const tokenRule = (feature: string, selectorPart: string, media?: string | null) => {
  const text = rule(feature, selectorPart, media);
  expect(text, selectorPart).not.toMatch(HEX);
  return text;
};
const PHONE = '(max-width: 920px)';

describe('one disclosure marker on DEX pages', () => {
  it('removes the plus and the browser triangle', () => {
    expect(tokenRule('dex', '.dex-v2-setup) details) > summary::before {')).toContain('content: none;');
    expect(tokenRule('dex', '.dex-v2-setup) details) > summary::-webkit-details-marker {')).toContain('display: none;');
    expect(tokenRule('dex', '.dex-market-history-data, :is(.dex-v2-token-funding, .dex-history-row, .dex-market-chart, .dex-v2-setup) details) > summary {'))
      .toContain('list-style: none;');
  });

  it('draws one chevron on the right that turns when open, and keeps an existing lucide chevron', () => {
    const chevron = tokenRule('dex', '> summary:not(:has(svg.lucide-chevron-down))::after {');
    expect(chevron).toContain('margin: 0 4px 0 auto;');
    expect(chevron).toContain('transform: translateY(-2px) rotate(45deg);');
    expect(tokenRule('dex', '[open] > summary:not(:has(svg.lucide-chevron-down))::after {')).toContain('rotate(225deg)');
  });

  it('uses token colours and keeps the danger colour of close actions', () => {
    expect(tokenRule('shared', ':not(.dex-owner-danger) > summary {')).toContain('color: var(--text-secondary);');
    expect(tokenRule('dex', ':not(.dex-owner-danger)[open] > summary {')).toContain('color: var(--text-primary);');
  });
});

describe('Limit entry and main button', () => {
  it('puts amount and price in one box with a hairline, as the Swap amount box', () => {
    expect(tokenRule('dex', '.dex-v2-limit-entry {')).toContain('border: 1px solid var(--border-default);');
    expect(tokenRule('dex', '.dex-v2-limit-entry {')).toContain('border-radius: 6px;');
    expect(tokenRule('dex', '.dex-v2-limit-entry > .dex-v2-limit-price-field {')).toContain('border-top: 1px solid var(--border-subtle);');
    expect(tokenRule('dex', '.dex-v2-limit-entry input {')).toContain('font-size: 1.75rem;');
  });

  it('keeps the primary fill on the Limit main button: the secondary rule skips .dex-v2-review-button', () => {
    const secondary = rule('p2p', ':root body .app-shell :is(.standalone-trade-secondary-btn');
    expect(secondary).toContain('.dex-owner-workspace button:not(.dex-owner-danger):not([aria-pressed="true"]):not(.privacy-locked-notice > button):not(.dex-v2-review-button)');
  });
});

describe('compact Liquidity panel', () => {
  // The CW-097 compact Pool form (owner decision 2026-11-21) replaced the CW-095 12 px rhythm with 10 px.
  it('uses one frame per amount field and the 10 px compact section rhythm', () => {
    const field = tokenRule('dex', '.dex-v2-pool-amounts-section .dex-v2-current-fields label {');
    expect(field).toContain('padding: 0;');
    expect(field).toContain('border: 0;');
    expect(tokenRule('dex', 'section.dex-v2-current-pool .dex-v2-pool-section {')).toContain('padding: 10px 0;');
    expect(tokenRule('dex', 'section.dex-v2-current-pool .dex-v2-composer-heading h2 {')).toContain('font-size: 1.1rem;');
  });

  it('gives recovery buttons with no class the secondary style at the 44 px touch size', () => {
    const button = tokenRule('dex', 'section.dex-v2-current-pool :is(.dex-v2-setup, .dex-v2-current-fields) button:not([class]) {');
    expect(button).toContain('min-height: 44px;');
    expect(button).toContain('border: 1px solid var(--border-default);');
  });
});

describe('test-token rows', () => {
  it('shows one row per token and hides an empty status line', () => {
    expect(tokenRule('dex', ':root body .app-shell-dex-v2 .dex-v2-beta-token-card {')).toContain('grid-template-columns: minmax(72px, auto) minmax(0, 1fr) auto;');
    expect(tokenRule('dex', '.dex-v2-beta-token-card > .dex-v2-beta-token-status:empty {')).toContain('display: none;');
  });

  it('uses token colours, with no new hex values in the DEX block', () => {
    expect(tokenRule('dex', '.dex-v2-token-funding button:not(.dex-v2-review-button) {')).toContain('background: var(--surface-base);');
  });
});

describe('DEX column divider', () => {
  it('removes the vertical line left of the Trade, Limit and Liquidity column (owner decision 2026-11-18)', () => {
    expect(rule('dex', ':root body .app-shell-dex-v2 .dex-v2-content-grid > .dex-v2-form-column {')).toContain('border-left: 0;');
  });

  it('removes the line right of the live price block in the market bar (owner decision 2026-11-18)', () => {
    expect(rule('shell', ':root body .app-shell .trading-product-bar .trading-market-change {')).toContain('border-right: 0;');
  });
});

describe('pair selector', () => {
  it('puts Base and Quote side by side at 44 px with token-colour circles (owner decision 2026-11-18)', () => {
    expect(rule('shell', ':root body .app-shell .trading-market-catalog.trading-market-catalog-pair {')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(rule('shell', ':root body .app-shell .trading-market-catalog-pair .trading-market-token-choice select {')).toContain('min-height: 44px;');
    expect(rule('base', ':root body .app-shell [data-token-tone="bcn"] {')).toContain('var(--info)');
    expect(rule('shell', ':root body .app-shell .trading-token-mark {')).not.toMatch(HEX);
  });
});

describe('mobile refinement (owner decision 2026-11-18, audit items 1-5)', () => {
  // A rule of the mobile refinement: phone layout only, token colours only, and not the bottom navigation.
  const mobileRule = (feature: string, selectorPart: string) => {
    const found = findRule(stylesheet(feature), selectorPart, PHONE);
    expect(found.media, selectorPart).toBe(PHONE);
    expect(found.text, selectorPart).not.toMatch(HEX);
    expect(found.text, selectorPart).not.toMatch(/p2p-secondary-nav|dex-view-navigation/u);
    return found.text;
  };

  it('is phone-only and leaves the bottom navigation unchanged', () => {
    expect(stylesheet('shell')).toContain('/* CW-097. Mobile refinement:');
    mobileRule('shell', ':root body .app-shell-dex-v2 .trading-market-change:not([data-price-state="last-known"]) .trading-market-change-detail {');
    mobileRule('shell', '.p2p-offers-list-head span');
    mobileRule('p2p', ':root body .app-shell .p2p-agent-composer {');
    mobileRule('p2p', 'details.p2p-offers-chart) { border-style: solid; }');
    mobileRule('dex', ':root body .app-shell-dex-v2 .dex-owner-detail:has(> .dex-owner-selection-empty) > :is(.dex-owner-heading, .dex-owner-selection-empty) {');
  });

  it('keeps the market line in one row and keeps the Last Pool price detail', () => {
    expect(mobileRule('shell', ':root body .app-shell-dex-v2 .trading-market-change:not([data-price-state="last-known"]) .trading-market-change-detail {')).toContain('display: none;');
  });

  it('sets the 12 px floor, keeps the Agent prompt in view and makes P2P frames solid', () => {
    expect(mobileRule('shell', '.p2p-offers-list-head span')).toContain('font-size: .75rem;');
    expect(mobileRule('p2p', ':root body .app-shell .p2p-agent-composer {')).toContain('position: sticky; bottom: 0;');
    expect(mobileRule('p2p', 'details.p2p-offers-chart) { border-style: solid; }')).toContain('border-style: solid;');
  });

  it('item 7: hides only the empty Manage heading and placeholder, never the recovery disclosure', () => {
    const hide = mobileRule('dex', ':root body .app-shell-dex-v2 .dex-owner-detail:has(> .dex-owner-selection-empty) > :is(.dex-owner-heading, .dex-owner-selection-empty) {');
    expect(hide).toContain('display: none;');
    expect(hide).not.toContain('dex-owner-footer');
  });
});

describe('Pool form compact (owner decision 2026-11-21)', () => {
  const pool = () => readSource('features/dex/components/CurrentPoolWorkspace.tsx');

  it('keeps the full rows, with the funding tolerance, in the funding review window', () => {
    expect(pool()).toContain("{ label: 'Funding tolerance', value: `${a.toleranceN}/${a.toleranceD}` }");
    expect(pool()).toMatch(/confirm\(values\.operation === 'initialize' \? 'Initialize this Pool' : 'Add to this Pool', \[\.\.\.rows\(values\)/u);
  });

  it('uses the compact rows only in the preview card', () => {
    expect(pool()).toContain('<dl>{cardRows(preview.value.amounts).map(row =>');
    expect(pool()).toContain("...(a.unused0 > 0n ?");
  });

  it('frames the spread select, aligns helpers left and shows a full-width card', () => {
    expect(stylesheet('dex')).toContain('/* CW-097. Pool form compact:');
    expect(tokenRule('dex', 'select[aria-label="Pool spread"] { border: 1px solid var(--border-default);')).toBeTruthy();
    expect(tokenRule('dex', '.dex-v2-pool-amounts-section .dex-v2-activation-note { text-align: left; }')).toBeTruthy();
    expect(tokenRule('dex', '> aside.dex-v2-strategy-preview { align-self: stretch; width: 100%;')).toBeTruthy();
  });
});

describe('mobile Trading shell on DEX pages', () => {
  const mobile = (feature: string, selectorPart: string) => {
    const found = findRule(stylesheet(feature), selectorPart, PHONE);
    expect(found.media, selectorPart).toBe(PHONE);
    return found.text;
  };

  it('keeps the three-row DEX bar on the DEX Agent page, which also has the P2P shell class', () => {
    expect(mobile('dex', ':root body .app-shell.app-shell-dex-v2.app-shell-trades {'))
      .toContain('calc(var(--ux-mobile-trading-nav) + var(--ux-mobile-pair-context) + 44px)');
    expect(mobile('shell', '.app-shell-dex-v2.app-shell-trades > .trading-product-bar {')).toContain('+ 44px);');
  });

  it('shows four equal bottom tabs with the 12 px text floor and the 44 px touch size', () => {
    expect(mobile('p2p', '.dex-view-navigation:has(> .dex-agent-link) > nav {')).toContain('flex: 3 1 0;');
    const agent = mobile('dex', '.dex-view-navigation > .dex-agent-link {');
    expect(agent).toContain('flex: 1 1 0;');
    expect(agent).toContain('min-height: 44px;');
    expect(agent).toContain('font-size: .75rem;');
  });

  it('starts at the mobile breakpoint used by the App', () => {
    expect(stylesheet('dex')).toContain('@media (min-width: 920.02px) and (max-height: 700px)');
    expect(allStylesheets()).not.toContain('min-width: 921px');
  });
});
