import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT as artifact } from './currentDexExitDailyPriceArtifact';
import { readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE as source } from '../../tests/fixtures/historicalDailyPriceSources';
import { makeHistoryFixture } from '../../tests/fixtures/history.fixture';

// Historical compile evidence is retained; the replacement reader rejects this graph.
describe('retained exit recorder evidence',()=>{
  it('uses the exact graph-only recorder derivative and unchanged ABI/storage settings',()=>{
    const root='../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/reference-history/recorder-build/';
    const bytes=readFileSync(root+'build-1/ChainWhisperDailyPoolPrice.json'),compiled=JSON.parse(bytes.toString()),identity=JSON.parse(readFileSync(root+'build-1/identity.json','utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.artifactSha256);
    expect(artifact.abi).toEqual(compiled.abi);expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(identity).toMatchObject({graph:source.graph,abiUnchanged:true,storageUnchanged:true,settingsUnchanged:true,sourceGraphOnlyChange:true,runtimeBytes:5676,initWithArgumentsBytes:8159,nativeAdmission:false});
  });

  it('rejects this historical graph before RPC',async()=>{
    const f=makeHistoryFixture();let calls=0;
    const provider={request:async()=>{calls++;throw Error('MUST_NOT_READ');}};
    await expect(readCurrentDexDailyPrice({provider,manifest:{...f.manifest,sourceGraph:source.graph,recorderArtifact:artifact.artifactSha256}})).rejects.toThrow('candidate');expect(calls).toBe(0);
  });
});
