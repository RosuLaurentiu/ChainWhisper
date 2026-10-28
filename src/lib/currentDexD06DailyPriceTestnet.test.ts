import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STAGED_D06_DEX_CANDIDATE as candidate, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT as artifact } from './currentDexD06DailyPriceArtifact';
import { D06_TESTNET_DEX_DAILY_PRICE_MANIFEST as manifest } from './currentDexD06DailyPriceTestnet';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';
import { assertCurrentD06AppAuthority } from './currentDexC1SwapPolicy';

describe('d06 native public history binding', () => {
  it('binds the exact compiled artifact and verified native deployment manifest', () => {
    const root='../ChainWhisper Contracts V2/validation/candidates/core-advance-boundary-2026-10-06/reference-history/';
    expect(manifest).toEqual(JSON.parse(readFileSync(root+'app-history-manifest.json','utf8')));
    const bytes=readFileSync(root+'history-build-1/ChainWhisperDailyPoolPrice.json'),compiled=JSON.parse(bytes.toString());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.artifactSha256);
    expect(artifact.abi).toEqual(compiled.abi);expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(Object.isFrozen(manifest.symbols)).toBe(true);
  });
  it('activates only public reads and keeps the connected App-wallet hold', () => {
    const config=currentNativeDexDailyPriceConfig(candidate);
    expect(config.status).toBe('active');if(config.status!=='active')throw Error('Missing history binding');
    expect(config.manifest).toBe(manifest);expect(config).not.toHaveProperty('readyToSign');
    expect(()=>assertCurrentD06AppAuthority(candidate.graph)).toThrow('connected App-wallet hold');
  });
  it.each(['graph','package','core','market','release','chain','genesis','token','token-runtime','companion','runtime','attestation'] as const)('refuses changed %s candidate identity', fault => {
    let patch:Partial<CurrentCheapDexCandidate>={};
    if(fault==='graph')patch={graph:'00'.repeat(32)};
    if(fault==='package')patch={packageSha256:'00'.repeat(32)};
    if(fault==='core')patch={core:candidate.tokens[0][0]};
    if(fault==='market')patch={marketId:`0x${'44'.repeat(32)}`};
    if(fault==='release')patch={releaseId:`0x${'44'.repeat(32)}`};
    if(fault==='chain')patch={chainId:'1'};
    if(fault==='genesis')patch={genesisHash:`0x${'44'.repeat(32)}`};
    if(fault==='token')patch={tokens:[candidate.tokens[0],candidate.tokens[0]]};
    if(fault==='token-runtime')patch={tokens:candidate.tokens.map(([address],i)=>[address,i?candidate.tokens[i][1]:`0x${'44'.repeat(32)}`] as const)};
    if(fault==='companion')patch={companions:candidate.companions.slice(1)};
    if(fault==='runtime')patch={runtimes:candidate.runtimes.slice(1)};
    if(fault==='attestation')patch={attestationSha256:'00'.repeat(32)};
    expect(currentNativeDexDailyPriceConfig({...candidate,...patch}).status).toBe('inactive');
  });
});
