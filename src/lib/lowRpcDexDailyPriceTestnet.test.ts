import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STAGED_LOW_RPC_DEX_CANDIDATE as trial } from './lowRpcDexTrialCandidate';
import { LOW_RPC_DEX_DAILY_PRICE_ARTIFACT } from './lowRpcDexDailyPriceArtifact';
import { LOW_RPC_DEX_DAILY_PRICE_SOURCE } from '../../tests/fixtures/historicalDailyPriceSources';
import { LOW_RPC_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from '../../tests/fixtures/lowRpcDexDailyPriceTestnet';
import { currentHistoryDexDailyPriceConfig, currentHistoryDexDailyPriceManifestMatches } from './currentDexHistoryDailyPriceTestnet';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';

describe('low-RPC recorder binding', () => {
  it('binds the exact compiler artifact and immutable ranges', () => {
    const root = '../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/recorder-build/build-low-rpc-1/';
    const raw = readFileSync(root + 'ChainWhisperDailyPoolPrice.json');
    const compiled = JSON.parse(raw.toString());
    const output = JSON.parse(readFileSync(root + 'output.json', 'utf8'));
    const ranges = Object.values(output.contracts['ChainWhisperDailyPoolPrice.sol'].ChainWhisperDailyPoolPrice.evm.deployedBytecode.immutableReferences).flat();
    expect(createHash('sha256').update(raw).digest('hex')).toBe(LOW_RPC_DEX_DAILY_PRICE_SOURCE.recorderArtifact);
    expect(LOW_RPC_DEX_DAILY_PRICE_ARTIFACT.abi).toEqual(compiled.abi);
    expect(LOW_RPC_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(LOW_RPC_DEX_DAILY_PRICE_ARTIFACT.immutableReferences).toEqual(ranges);
  });
  it('uses only the selected candidate and six exact canonical exports', () => {
    const active = false;
    expect(LOW_RPC_TESTNET_DEX_DAILY_PRICE_MANIFESTS).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const exported = JSON.parse(readFileSync(`reports/low-rpc-trial-2026-11-05/recorder-public-constructor/recorder-${i + 1}-export.json`, 'utf8'));
      const m = LOW_RPC_TESTNET_DEX_DAILY_PRICE_MANIFESTS[i];
      expect(exported.status).toBe('CURRENT_RECORDER_CANONICAL_EXPORT');
      expect(m).toEqual(exported.manifest);
      expect(currentHistoryDexDailyPriceManifestMatches(trial, m.symbols, m)).toBe(active);
      expect(currentNativeDexDailyPriceConfig(trial, m.symbols).status).toBe('inactive');
      expect(currentHistoryDexDailyPriceConfig(trial, m.symbols).status).toBe(active ? 'active' : 'inactive');
      for (const patch of [{sourceGraph:'00'.repeat(32)}, {recorderArtifact:'00'.repeat(32)}, {source:m.token0}, {pair:m.market}, {canonicalId:'99'}, {decimals0:18}])
        expect(currentHistoryDexDailyPriceManifestMatches(trial, m.symbols, {...m, ...patch})).toBe(false);
    }
  });
});
