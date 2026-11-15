import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT as artifact } from './packedInputDexDailyPriceArtifact';
import { PACKED_INPUT_DEX_DAILY_PRICE_SOURCE as source } from './currentDexDailyPrice';

// This check reads the exact compiled recorder in ChainWhisper Contracts V2.
// The App repository alone does not contain it, so `npm run test:ci` excludes this file. `npm test` runs it.
describe('packed-input current chart: compiled recorder evidence',()=>{
  it('binds the generated artifact to the exact compiled recorder',()=>{
    const raw=readFileSync('../ChainWhisper Contracts V2/validation/candidates/c1-gap-aware-sizing-2026-11-15/adoption/recorder-build-1/ChainWhisperDailyPoolPrice.json');
    const compiled=JSON.parse(raw.toString());
    expect(createHash('sha256').update(raw).digest('hex')).toBe(source.recorderArtifact);
    expect(artifact.abi).toEqual(compiled.abi);expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
  });
});
