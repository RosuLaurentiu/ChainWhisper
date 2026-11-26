import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOW_RPC_DEX_DAILY_PRICE_ARTIFACT } from './lowRpcDexDailyPriceArtifact';
import { LOW_RPC_DEX_DAILY_PRICE_SOURCE } from '../../tests/fixtures/historicalDailyPriceSources';

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
});
