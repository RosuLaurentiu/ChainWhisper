import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TESTNET_DEX_DAILY_PRICE_CONFIG, TESTNET_DEX_DAILY_PRICE_MANIFEST as m } from './currentDexDailyPriceTestnet';
import { CURRENT_DEX_DAILY_PRICE_CONFIG } from './currentDexDailyPrice';
import { CURRENT_DEX_DISPLAY_TOKENS } from './currentDexDisplay';

describe('Admitted Testnet daily read configuration', () => {
  it('matches the accepted native recorder and first sample evidence', () => {
    const base = '../ChainWhisper Contracts V2/validation/candidates/daily-price-history-2026-10-03/native-record-1/';
    expect(createHash('sha256').update(readFileSync(base + 'NATIVE_FINAL_SEAL.json')).digest('hex'))
      .toBe('2249051551615c39a5106cfd7227660310e16cb899c68a467a8969fdc57a6c94');
    const { binding: b } = JSON.parse(readFileSync(base + 'record-proof-1.json', 'utf8'));
    for (const key of ['address', 'source', 'sourceGraph', 'chainId', 'genesisHash', 'releaseId', 'market', 'pair', 'canonicalId', 'token0', 'token1', 'deploymentBlock', 'deploymentBlockHash'] as const) {
      expect(m[key]).toBe(b[key]);
    }
    expect(m.runtimeHash).toBe(b.runtime); expect(m.sourceRuntimeHash).toBe(b.sourceRuntime);
    expect(m.decimals0).toBe(Number(b.decimals0)); expect(m.decimals1).toBe(Number(b.decimals1));
  });
  it('binds address labels and leaves the default trading view inactive', () => {
    expect(m.symbols).toEqual([CURRENT_DEX_DISPLAY_TOKENS[1].label, CURRENT_DEX_DISPLAY_TOKENS[0].label]);
    expect(m.token0.toLowerCase()).toBe(CURRENT_DEX_DISPLAY_TOKENS[1].address.toLowerCase());
    expect(m.token1.toLowerCase()).toBe(CURRENT_DEX_DISPLAY_TOKENS[0].address.toLowerCase());
    expect(TESTNET_DEX_DAILY_PRICE_CONFIG.status).toBe('active');
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
  });
});
