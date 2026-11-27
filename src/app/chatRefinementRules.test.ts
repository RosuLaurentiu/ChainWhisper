import { describe, expect, it } from 'vitest';
import { findRule, HEX, stylesheet } from './cssRuleTestHelpers';

// CW-097. Binds the Chat refinement rule: error details under a discovery message use the one
// disclosure chevron of the Trading pages at the 44 px touch size.
// CW-158: each rule is looked up in the Chat stylesheet; each bound rule uses token colours only.
const rule = (selectorPart: string) => {
  const found = findRule(stylesheet('chat'), selectorPart);
  expect(found.text, selectorPart).not.toMatch(HEX);
  return found.text;
};

describe('Chat error details disclosure', () => {
  it('hides the browser triangle and keeps the 44 px touch size', () => {
    const summary = rule('.app-shell-chat .contacts-empty-state details > summary {');
    expect(summary).toContain('list-style: none;');
    expect(summary).toContain('min-height: 44px;');
    expect(rule('.contacts-empty-state details > summary::-webkit-details-marker {')).toContain('display: none;');
  });

  it('draws the one chevron on the right that turns when open, with token colours only', () => {
    expect(rule('.contacts-empty-state details > summary::after {')).toContain('margin: 0 4px 0 auto;');
    expect(rule('.contacts-empty-state details[open] > summary::after {')).toContain('rotate(225deg)');
  });
});
