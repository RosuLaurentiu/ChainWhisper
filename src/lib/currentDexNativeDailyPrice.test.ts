import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT as artifact } from './currentDexNativeDailyPriceArtifact';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT as oldArtifact } from './currentDexDailyPriceArtifact';
import { CURRENT_DEX_DAILY_PRICE_CONFIG, readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE as source } from '../../tests/fixtures/historicalDailyPriceSources';
import { makeHistoryFixture } from '../../tests/fixtures/history.fixture';

// Historical compile evidence is retained; the replacement reader rejects this graph.
describe('retained native recorder evidence',()=>{
  it('binds the generated artifact to the exact completed local compile and keeps feed inactive', () => {
    const bytes = readFileSync('../ChainWhisper Contracts V2/validation/candidates/next-dex-history-2026-10-04/build-2/ChainWhisperDailyPoolPrice.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.artifactSha256);
    const compiled = JSON.parse(bytes.toString()); expect(artifact.abi).toEqual(compiled.abi); expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(artifact.abi).toEqual(oldArtifact.abi); expect(artifact.deployedBytecode).not.toBe(oldArtifact.deployedBytecode);
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
  });

  it('rejects this historical graph before RPC',async()=>{
    const f=makeHistoryFixture();let calls=0;
    const provider={request:async()=>{calls++;throw Error('MUST_NOT_READ');}};
    await expect(readCurrentDexDailyPrice({provider,manifest:{...f.manifest,sourceGraph:source.graph,recorderArtifact:artifact.artifactSha256}})).rejects.toThrow('candidate');expect(calls).toBe(0);
  });
});
