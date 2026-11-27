import { describe, expect, it } from 'vitest';
import { findRule, stylesheet } from './cssRuleTestHelpers';

// CW-096. A component test cannot see layout. These tests bind the Swap form rules that the local
// preview measured: one segmented style, one amount box with the switch on its divider, one settings row.
// CW-158: each rule is looked up in the DEX stylesheet, with its @media condition where the rule binds one.
const rule = (selectorPart: string, media?: string | null) => findRule(stylesheet('dex'), selectorPart, media);
const SEGMENTED = ':is(.dex-v2-section-tabs, .dex-v2-current-side-toggle, .dex-v2-swap-mode-toggle, .dex-v2-setting-presets)';

describe('one segmented style in the Swap form', () => {
  it('marks the selected choice with the chart period style, not the main button fill', () => {
    const selected = rule(`${SEGMENTED} button:is([aria-pressed="true"], [aria-current="page"]) {`).text;
    expect(selected).toContain('background: var(--surface-interactive);');
    expect(selected).toContain('box-shadow: inset 0 -2px var(--brand-strong);');
    expect(selected).not.toContain('#6137a5');
  });

  it('keeps every segmented button at the 44 px touch size', () => {
    expect(rule(`${SEGMENTED} button {`).text).toContain('min-height: 44px;');
  });
});

describe('one amount box', () => {
  it('draws one border around You send and Estimated receive with a divider between them', () => {
    expect(rule('.dex-v2-current-swap .dex-v2-current-amounts {').text).toContain('border: 1px solid var(--border-default);');
    expect(rule('.dex-v2-current-amounts > .dex-v2-quote-output {').text).toContain('border-top: 1px solid var(--border-subtle);');
  });

  it('centers the 44 px Buy/Sell switch on the divider', () => {
    const button = rule('.dex-v2-current-amounts > .dex-v2-current-direction {').text;
    expect(button).toContain('height: 44px;');
    expect(button).toContain('margin: -22px 0;');
    expect(button).toContain('transform: none;');
  });
});

describe('one settings row', () => {
  it('shares one row between the swap mode and Slippage, and gives open settings the full width', () => {
    expect(rule('.dex-v2-current-swap .dex-v2-swap-settings {').text).toContain('align-items: flex-start;');
    expect(rule('.dex-v2-swap-settings > .dex-v2-execution-choice {').text).toContain('flex: 1 1 0;');
    expect(rule('.dex-v2-swap-settings > .dex-v2-current-advanced[open] {').text).toContain('flex-basis: 100%;');
  });

  // Owner decision 2026-11-18: a mode change must not move the layout. The hint stays inline on desktop and takes one
  // line under the toggle on a phone, in both modes.
  it('keeps the mode hint inline on desktop and on its own line on a phone, in both modes', () => {
    expect(rule('.dex-v2-swap-settings > .dex-v2-execution-choice {').text).toContain('flex-wrap: nowrap;');
    expect(rule('.dex-v2-execution-choice > .dex-v2-swap-mode-toggle {').text).toContain('grid-template-columns: auto auto;');
    const css = stylesheet('dex');
    expect(css).toContain('/* On a phone the row has no room beside the toggle');
    const hint = rule(':root body .app-shell-dex-v2 .dex-v2-current-swap .dex-v2-swap-settings > .dex-v2-execution-choice > span {', '(max-width: 920px)');
    expect(hint.media).toBe('(max-width: 920px)');
    expect(hint.text).toContain('flex-basis: 100%;');
  });

  it('gives the Slippage summary the segmented control height', () => {
    expect(rule('.dex-v2-swap-settings > .dex-v2-current-advanced > summary {').text).toContain('height: 50px;');
  });
});
