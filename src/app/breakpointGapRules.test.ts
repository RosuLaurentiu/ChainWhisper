import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMobileNavViewport, MOBILE_NAV_QUERY } from './hooks/useMobileHeaderLinks';

// CW-095. With display scaling (110-150 %) the page width can be fractional, for example 920.9 px.
// The mobile rules end at max-width 920px; the desktop rules must start right after it, or a width
// between 920 and 921 px gets neither (measured: a 984 px header in a 921 px frame).
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
const allCss = cssFiles(SRC_ROOT).map((path) => ({ path, css: readFileSync(path, 'utf8') }));

describe('mobile and desktop breakpoints leave no gap', () => {
  it('starts every desktop rule at 920.02px, directly after the 920px mobile limit', () => {
    const desktopStarts = allCss.flatMap(({ path, css }) =>
      [...css.matchAll(/min-width:\s*(92\d(?:\.\d+)?)px/gu)].map((match) => `${path.slice(SRC_ROOT.length)} ${match[1]}`));
    expect(desktopStarts.length).toBeGreaterThan(25);
    expect(desktopStarts.filter((entry) => !entry.endsWith(' 920.02'))).toEqual([]);
    const mobileEnds = allCss.flatMap(({ css }) => [...css.matchAll(/max-width:\s*(92\d(?:\.\d+)?)px/gu)].map((match) => match[1]));
    expect(new Set(mobileEnds)).toEqual(new Set(['920']));
  });

  it('decides the mobile header with the same media query as the styles, not the rounded window width', () => {
    expect(MOBILE_NAV_QUERY).toBe('(max-width: 920px)');
    // A 920.4 px page reports innerWidth 920; a 920.6 px page reports 921. The styles decide by the exact width.
    const viewport = (innerWidth: number, mobile: boolean) => ({
      innerWidth,
      matchMedia: (query: string) => ({ matches: query === MOBILE_NAV_QUERY && mobile }) as MediaQueryList,
    });
    expect(isMobileNavViewport(viewport(920, false))).toBe(false);
    expect(isMobileNavViewport(viewport(921, true))).toBe(true);
  });

  it('follows the media query change event, because a sub-pixel resize can cross the limit without a resize event', () => {
    const hook = readFileSync(join(SRC_ROOT, 'app/hooks/useMobileHeaderLinks.ts'), 'utf8');
    expect(hook).toContain("mobileQuery?.addEventListener('change', handleResize);");
    expect(hook).toContain("mobileQuery?.removeEventListener('change', handleResize);");
  });

  it('falls back to the window width where matchMedia does not exist', () => {
    expect(isMobileNavViewport({ innerWidth: 920 })).toBe(true);
    expect(isMobileNavViewport({ innerWidth: 921 })).toBe(false);
  });
});
