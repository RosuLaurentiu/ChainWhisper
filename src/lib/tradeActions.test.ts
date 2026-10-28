import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const productionWriterPath = fileURLToPath(new URL('./tradeActions.ts', import.meta.url));
const activeTradingHooks = [
  '../features/trading/hooks/useP2PTradeActions.ts',
  '../features/trading/hooks/useP2PTradeComposerActions.ts',
  '../features/trading/hooks/useP2PRecurringOrderActions.ts'
];

describe('legacy OTC write retirement', () => {
  it('keeps V1 transaction helpers out of the production trading surface', () => {
    expect(existsSync(productionWriterPath)).toBe(false);

    for (const relativePath of activeTradingHooks) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source).not.toContain('tradeActions');
      expect(source).not.toMatch(/(?:create|edit|fill|update).*OnChain/);
    }
  });
});
