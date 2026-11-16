import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-095. A component test cannot see layout. These tests bind the style rules that the local
// preview measured: one left and one right edge for the header, the pair bar, the tab menu and
// the panels; one palette in P2P; one side-panel title style.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const last = read('styles/120-owner-dark-design.css');
const responsive = read('styles/90-responsive-overrides.css');
const p2pPage = read('features/trading/components/P2PTradingPage.tsx');
const rule = (css: string, selectorPart: string) => {
  const at = css.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};
const EDGE_MARK = '/* CW-095. One page edge';
const edgeBlock = () => {
  const at = last.indexOf(EDGE_MARK);
  expect(at, EDGE_MARK).toBeGreaterThan(-1);
  return last.slice(at);
};

describe('one page edge on every Trading page', () => {
  it('uses one inset token for the header and the Trading content gutter', () => {
    expect(rule(edgeBlock(), ':root body .app-shell {')).toContain('--app-edge-inset: 24px;');
    expect(rule(last, ':root body .app-shell:is(.app-shell-dex-v2, .app-shell-trades) {')).toContain('--trading-content-gutter: var(--app-edge-inset);');
  });

  it('gives the header of every page the same left and right inset', () => {
    expect(rule(edgeBlock(), ':root body .app-shell > .top-header .top-header-brand {')).toContain('padding-left: var(--app-edge-inset);');
    expect(rule(edgeBlock(), ':root body .app-shell > .top-header .top-header-right {')).toContain('padding-right: var(--app-edge-inset);');
  });

  it('gives the pair bar the Trading content gutter on both sides', () => {
    expect(rule(edgeBlock(), ':root body .app-shell:is(.app-shell-dex-v2, .app-shell-trades) > .trading-product-bar {')).toContain('padding-inline: var(--trading-content-gutter);');
  });

  it('gives the Agent page content the tab menu edge', () => {
    const agent = rule(edgeBlock(), ':root body .app-shell-trades .p2p-trading-shell > .p2p-agent-section {');
    expect(agent).toContain('padding-inline: var(--trading-content-gutter);');
    expect(agent).toContain('border-inline-width: 0;');
    expect(agent).toContain('scrollbar-gutter: auto;');
  });

  it('keeps every edge rule on desktop widths only', () => {
    expect(edgeBlock()).toMatch(/^\/\* CW-095\. One page edge[^\n]*\n(?:[^\n]*\n)*?@media \(min-width: 920\.02px\) \{/u);
  });
});

describe('one palette in P2P', () => {
  const p2pTokens = rule(responsive, '.app-shell-trades,\n.app-shell-trades .standalone-trades-shell,\n.app-shell-trades .p2p-trading-shell {');

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
    const title = rule(edgeBlock(), ':root body .app-shell-trades .p2p-trading-shell > :is(.standalone-trade-detail-section, .standalone-trade-create-panel) > .standalone-trades-section-head h2 {');
    expect(title).toContain('font: 700 1.1rem/normal "Inter", "Segoe UI", Arial, sans-serif;');
    expect(title).toContain('color: var(--text-primary);');
  });
});

describe('P2P switch row on small screens', () => {
  const mobileBlock = () => {
    const mark = '/* CW-095. P2P switch row on small screens';
    const at = last.indexOf(mark);
    expect(at, mark).toBeGreaterThan(-1);
    return last.slice(at);
  };

  it('gives the P2P switch row the DEX height so the 44 px buttons stay inside it', () => {
    expect(mobileBlock()).toMatch(/^\/\* CW-095\. P2P switch row on small screens[^\n]*\n(?:[^\n]*\n)*?@media \(max-width: 920px\) \{/u);
    expect(rule(mobileBlock(), ':root body .app-shell.app-shell-trades {')).toContain('--ux-mobile-trading-nav: 52px;');
    expect(rule(mobileBlock(), ':root body .app-shell-trades .trading-product-switch {')).toContain('height: 50px;');
  });
});
