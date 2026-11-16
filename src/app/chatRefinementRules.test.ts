import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-097. Binds the Chat refinement rule: error details under a discovery message use the one
// disclosure chevron of the Trading pages at the 44 px touch size.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');
const MARK = '/* CW-097. Chat:';
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
    expect(block()).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});
