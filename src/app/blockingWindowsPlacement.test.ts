import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CW-092. Both defects were layout or placement faults that a component test cannot see,
// so these tests bind the source shape that the local preview check confirmed.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
// CW-158: the P2P side panel rule is in the P2P stylesheet.
const tradingCss = readFileSync(join(SRC_ROOT, 'styles/p2p.css'), 'utf8').replace(/\r\n/gu, '\n');

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  expect(from, start).toBeGreaterThan(-1);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from, to);
};

describe('Token approvals window placement', () => {
  it('is rendered with the header of every page, not inside the Chat workspace', () => {
    const header = between(app, 'const renderAppHeader = (', 'const chatRealtimeReconnecting =');
    const chat = between(app, 'const chatWorkspace = (', "if (activePage === 'home')");
    expect(header).toContain('{tokenApprovalsDialog}');
    expect(chat).not.toContain('TokenApprovalsDialog');
    expect(chat).not.toContain('tokenApprovalsDialog');
    expect(app.match(/<TokenApprovalsDialog\b/gu)).toHaveLength(1);
  });
});

describe('P2P side panels in the desktop Trading shell', () => {
  it('cannot grow past their grid row, so their own scroll reaches the last control', () => {
    const rule = between(tradingCss, '.p2p-trading-shell-create-with-offers > .standalone-trade-create-panel,\n    .p2p-trading-shell-mine > .standalone-trade-detail-section\n  ) {', '}');
    expect(rule).toContain('align-self: start;');
    expect(rule).toContain('margin: 0 14px 34px auto;');
    expect(rule).toContain('max-height: calc(100% - 34px);');
  });
});
