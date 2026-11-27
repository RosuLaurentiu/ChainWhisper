import { describe, expect, it } from 'vitest';
import { allStylesheets, findRule, readSource, stylesheet } from './cssRuleTestHelpers';

// CW-095. A component test cannot see layout. These tests bind the style rules that the local
// preview measured: one left and one right edge for the header, the pair bar, the tab menu and
// the panels; one palette in P2P; one side-panel title style.
// CW-158: each rule is looked up in the feature stylesheet that holds it, with its @media condition.
const p2pPage = readSource('features/trading/components/P2PTradingPage.tsx');
const DESKTOP = '(min-width: 920.02px)';
const PHONE = '(max-width: 920px)';
const rule = (feature: string, selectorPart: string, media?: string | null, containing?: string) => {
  const found = findRule(stylesheet(feature), selectorPart, media, containing);
  if (media !== undefined) expect(found.media, selectorPart).toBe(media);
  return found.text;
};
// A rule of the CW-095 edge block: desktop widths only.
const edgeRule = (feature: string, selectorPart: string) => rule(feature, selectorPart, DESKTOP);
const EDGE_MARK = '/* CW-095. One page edge';
const fromMark = (mark: string) => {
  const css = allStylesheets();
  const at = css.indexOf(mark);
  expect(at, mark).toBeGreaterThan(-1);
  return css.slice(at);
};

describe('one page edge on every Trading page', () => {
  it('uses one inset token for the header and the Trading content gutter', () => {
    expect(edgeRule('base', ':root body .app-shell {')).toContain('--app-edge-inset: 24px;');
    expect(rule('dex', ':root body .app-shell:is(.app-shell-dex-v2, .app-shell-trades) {', DESKTOP)).toContain('--trading-content-gutter: var(--app-edge-inset);');
  });

  it('gives the header of every page the same left and right inset', () => {
    expect(edgeRule('shell', ':root body .app-shell > .top-header .top-header-brand {')).toContain('padding-left: var(--app-edge-inset);');
    expect(edgeRule('shell', ':root body .app-shell > .top-header .top-header-right {')).toContain('padding-right: var(--app-edge-inset);');
  });

  it('gives the pair bar the Trading content gutter on both sides', () => {
    expect(edgeRule('shell', ':root body .app-shell:is(.app-shell-dex-v2, .app-shell-trades) > .trading-product-bar {')).toContain('padding-inline: var(--trading-content-gutter);');
  });

  it('gives the Agent page content the tab menu edge', () => {
    const agent = edgeRule('p2p', ':root body .app-shell-trades .p2p-trading-shell > .p2p-agent-section {');
    expect(agent).toContain('padding-inline: var(--trading-content-gutter);');
    expect(agent).toContain('border-inline-width: 0;');
    expect(agent).toContain('scrollbar-gutter: auto;');
  });

  it('keeps every edge rule on desktop widths only', () => {
    expect(fromMark(EDGE_MARK)).toMatch(/^\/\* CW-095\. One page edge[^\n]*\n(?:[^\n]*\n)*?@media \(min-width: 920\.02px\) \{/u);
  });
});

describe('one palette in P2P', () => {
  const p2pTokens = rule('p2p', '.app-shell-trades,\n.app-shell-trades .standalone-trades-shell,\n.app-shell-trades .p2p-trading-shell {');

  it('does not redefine the base color tokens', () => {
    for (const token of ['--bg:', '--bg-elev-1:', '--bg-elev-2:', '--bg-elev-3:', '--border:', '--border-strong:', '--text:', '--muted:', '--accent:', '--accent-soft:']) {
      expect(p2pTokens, token).not.toContain(`\n  ${token}`);
    }
  });

  it('points the neutral P2P tokens at the base tokens', () => {
    expect(p2pTokens).toContain('--p2p-text: var(--text-primary);');
    expect(p2pTokens).toContain('--p2p-muted: var(--text-secondary);');
    expect(p2pTokens).toContain('--p2p-border: var(--border-default);');
    expect(p2pTokens).toContain('--p2p-border-strong: var(--border-strong);');
  });
});

describe('one side-panel title style', () => {
  it('shows the P2P side-panel title without an eyebrow line', () => {
    expect(p2pPage).not.toContain('<p className="landing-eyebrow">P2P</p>');
  });

  it('uses the DEX side-panel title style for P2P side panels', () => {
    const title = edgeRule('p2p', ':root body .app-shell-trades .p2p-trading-shell > :is(.standalone-trade-detail-section, .standalone-trade-create-panel) > .standalone-trades-section-head h2 {');
    expect(title).toContain('font: 700 1.1rem/normal "Inter", "Segoe UI", Arial, sans-serif;');
    expect(title).toContain('color: var(--text-primary);');
  });
});

describe('P2P switch row on small screens', () => {
  const mark = '/* CW-095. P2P switch row on small screens';

  it('gives the P2P switch row the DEX height so the 44 px buttons stay inside it', () => {
    expect(fromMark(mark)).toMatch(/^\/\* CW-095\. P2P switch row on small screens[^\n]*\n(?:[^\n]*\n)*?@media \(max-width: 920px\) \{/u);
    expect(rule('p2p', ':root body .app-shell.app-shell-trades {', PHONE, '--ux-mobile-trading-nav: 52px;')).toContain('--ux-mobile-trading-nav: 52px;');
    expect(rule('shell', ':root body .app-shell-trades .trading-product-switch {', PHONE)).toContain('height: 50px;');
  });

  it('includes the bar padding and border in the P2P bar height so the pair picker stays inside the bar', () => {
    const height = 'calc(var(--ux-mobile-trading-nav) + var(--ux-mobile-pair-context) + 6px)';
    expect(rule('p2p', ':root body .app-shell.app-shell-trades {\n    grid-template-rows', PHONE)).toContain(`grid-template-rows: auto ${height} minmax(0, 1fr);`);
    const bar = rule('shell', ':root body .app-shell.app-shell-trades > .trading-product-bar {', PHONE);
    expect(bar).toContain(`min-height: ${height};`);
    expect(bar).toContain(`height: ${height};`);
  });

  it('keeps no window scrollbar space on small screens, where the 100vw shells fill the window', () => {
    expect(rule('base', ':root {', PHONE, 'scrollbar-gutter: auto;')).toContain('scrollbar-gutter: auto;');
  });
});

describe('Agent section in a short window', () => {
  it('lets the Agent section scroll when its content does not fit, without fixed scrollbar space', () => {
    const agent = edgeRule('p2p', ':root body .app-shell-trades .p2p-trading-shell:not(.p2p-trading-shell-drawer-open) > .p2p-agent-section {');
    expect(agent).toContain('overflow-y: auto;');
    expect(agent).toContain('overflow-x: hidden;');
    expect(edgeRule('p2p', ':root body .app-shell-trades .p2p-trading-shell > .p2p-agent-section {')).toContain('scrollbar-gutter: auto;');
  });
});

describe('Token approvals window buttons', () => {
  const dialog = readSource('features/wallet/TokenApprovalsDialog.tsx');

  it('marks the detail block and the token rows for the window rules', () => {
    expect(dialog).toContain('className="token-approvals-details"');
    expect(dialog).toContain('className="token-approvals-row"');
  });

  it('gives the detail buttons the size of the window Cancel button and spaces the detail lines', () => {
    expect(rule('wallet', ':root body .trade-action-confirm-content > .token-approvals-details {')).toContain('gap: 12px;');
    const button = rule('wallet', ':root body .token-approvals-details .connect-btn {');
    expect(button).toContain('min-height: 44px;');
    expect(button).toContain('padding: 10px 16px;');
    expect(button).toContain('font-size: .875rem;');
  });
});
