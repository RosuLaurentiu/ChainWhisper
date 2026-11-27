import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

// CW-158. The App stylesheets are split by feature; src/styles.css imports them in cascade order. A CSS rule test
// looks each bound rule up in the feature stylesheet that holds it, together with the @media condition around it.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const HEX = /#[0-9a-f]{3,8}\b/iu;

export const readSource = (file: string) => readFileSync(join(SRC_ROOT, file), 'utf8').replace(/\r\n/gu, '\n');

// One feature stylesheet, for example stylesheet('dex') for src/styles/dex.css.
export const stylesheet = (feature: string) => readSource(`styles/${feature}.css`);

// Every stylesheet that src/styles.css imports, in cascade order.
export const allStylesheets = () => [...readSource('styles.css').matchAll(/@import '\.\/(styles\/[^']+)';/gu)]
  .map((match) => readSource(match[1]))
  .join('\n');

// The condition of the innermost @media block that contains position `at`, or null at the top level.
export const mediaAt = (css: string, at: number): string | null => {
  const stack: (string | null)[] = [];
  for (let i = 0; i < at; i += 1) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '"' || ch === "'") { i = css.indexOf(ch, i + 1); continue; }
    if (ch === '{') {
      const start = Math.max(css.lastIndexOf('}', i - 1), css.lastIndexOf('{', i - 1), css.lastIndexOf('*/', i - 1) + 1, css.lastIndexOf(';', i - 1)) + 1;
      const head = css.slice(start, i).trim();
      stack.push(head.startsWith('@media') ? head.slice('@media'.length).trim() : null);
    }
    if (ch === '}') stack.pop();
  }
  for (let k = stack.length - 1; k >= 0; k -= 1) if (stack[k] !== null) return stack[k];
  return null;
};

export interface BoundRule {
  text: string;
  media: string | null;
}

// The rule at the first place where `selectorPart` occurs: its text from `selectorPart` to the next closing brace,
// and its @media condition. `media` keeps only places inside that condition (null: outside every @media).
// `containing` keeps only rules whose text has that declaration, for two rules with one selector and condition.
export const findRule = (css: string, selectorPart: string, media?: string | null, containing?: string): BoundRule => {
  const fits = (at: number) => (media === undefined || mediaAt(css, at) === media)
    && (containing === undefined || css.slice(at, css.indexOf('}', at)).includes(containing));
  let at = css.indexOf(selectorPart);
  while (at > -1 && !fits(at)) at = css.indexOf(selectorPart, at + 1);
  expect(at, `${selectorPart}${media === undefined ? '' : ` in @media ${media}`}${containing ? ` with ${containing}` : ''}`).toBeGreaterThan(-1);
  return { text: css.slice(at, css.indexOf('}', at)), media: mediaAt(css, at) };
};
