import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allStylesheets, findRule, mediaAt, stylesheet } from './cssRuleTestHelpers';

// CW-097. The owner approved six remove-or-move items on 2026-11-16 ("All yes"). These tests bind each one to
// its source, so a later edit cannot bring a development panel back into the published App by accident.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');

describe('owner-approved removals (CW-097)', () => {
  it('1: shows the Swap timing panel only on the Vite development server', () => {
    const page = (read('features/dex/components/DexV2Page.tsx') + read('features/dex/components/CurrentSwapWorkspace.tsx'));
    expect(page).toContain('{import.meta.env.DEV && activeJourney && !walletChanged ? <details aria-label="Local trial timing">');
  });

  it('2: removes Trial token addresses (the pair picker lists the same addresses)', () => {
    expect((read('features/dex/components/DexV2Page.tsx') + read('features/dex/components/CurrentSwapWorkspace.tsx'))).not.toContain('Trial token addresses');
  });

  it('3: no longer mounts the hidden P2P Testnet tools and keeps their source files', () => {
    const page = read('features/trading/components/P2PTradingPage.tsx');
    expect(page).not.toContain('p2p-advanced-tools');
    expect(page).not.toMatch(/import Testnet(TokenAdmissionPanel|TokenFaucetPanel|QaChecklist) from/u);
    for (const file of ['TestnetTokenAdmissionPanel.tsx', 'TestnetTokenFaucetPanel.tsx', 'TestnetQaChecklist.tsx']) {
      expect(existsSync(join(SRC_ROOT, 'features/trading/components', file)), file).toBe(true);
    }
  });

  it('4: shows the simulated incoming message button only on the Vite development server', () => {
    expect(read('App.tsx')).toContain("import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('debug') ? (");
  });

  it('5: replaces the DEX Agent preview cards and text with one line', () => {
    const panel = read('features/trading/components/TradeAgentPanel.tsx');
    expect(panel).not.toContain('DEX action coming soon');
    expect(panel).not.toContain('preview-only for now');
    expect(panel).not.toContain('will unlock when their integrations are ready');
    expect(panel).toContain("{actionsAvailable ? readiness.message : 'DEX trade actions are not available in the agent yet.'}");
    expect(panel).toContain('{actionsAvailable ? <div className="p2p-agent-quick-actions p2p-agent-quick-action-grid"');
  });

  it('6: hides the duplicate private trade link button on desktop and keeps it on small screens', () => {
    // CW-158: the rule is looked up in the P2P stylesheet, with its @media condition.
    const hide = findRule(stylesheet('p2p'), ':root body .app-shell-trades .p2p-offers-private-link-tool { display: none; }', '(min-width: 920.02px)');
    expect(hide.media).toBe('(min-width: 920.02px)');
    // Small screens keep the button: no phone rule in any stylesheet hides it (the 2026-11-18 mobile rules only give
    // it a solid frame).
    const css = allStylesheets();
    for (let at = css.indexOf('p2p-offers-private-link-tool'); at > -1; at = css.indexOf('p2p-offers-private-link-tool', at + 1)) {
      if (mediaAt(css, at) !== '(max-width: 920px)') continue;
      expect(css.slice(at, css.indexOf('}', at))).not.toMatch(/^[^{]*\{[^}]*display:\s*none/u);
    }
  });
});

describe("DEX Agent wording (CW-097)", () => {
  it("does not show the P2P wallet note on the DEX product", () => {
    expect(read("features/trading/components/P2PTradingPage.tsx")).toContain("|| (isDexProduct && isP2PWalletRequiredMessage(otcV2SetupError || tradeActionError)) ? '' : (otcV2SetupError || tradeActionError)}");
  });
});
