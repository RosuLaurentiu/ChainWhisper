import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AbiCoder,keccak256 } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate,STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit } from './dexV2Deployment';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT } from './currentDexHistoryDailyPriceArtifact';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE,type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { currentHistoryDexDailyPriceManifestMatches,currentHistoryDexDailyPriceConfig,HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from './currentDexHistoryDailyPriceTestnet';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';

// Synthetic deployment fields exercise scope matching only; this is not a live manifest.
const fixture=(index:number):CurrentDexDailyPriceManifest=>{
  const display=readCurrentDexDisplay(candidate).pairs[index],[token0,token1]=display.tokens;
  return {sourceGraph:candidate.graph,recorderArtifact:CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,chainId:candidate.chainId,genesisHash:candidate.genesisHash,
    address:'0x0000000000000000000000000000000000001234',runtimeHash:`0x${'11'.repeat(32)}`,deployer:'0x0000000000000000000000000000000000005678',deploymentBlock:'1',deploymentBlockHash:`0x${'22'.repeat(32)}`,deploymentTransactionHash:`0x${'33'.repeat(32)}`,
    source:candidate.core,sourceRuntimeHash:candidate.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2],releaseId:candidate.releaseId,market:display.marketId,canonicalId:candidate.pairs[index].canonicalId,
    pair:keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[candidate.chainId,token0.address,token1.address])),token0:token0.address,token1:token1.address,decimals0:6,decimals1:6,
    token0RuntimeHash:candidate.tokens.find(([address])=>address===token0.address)![1],token1RuntimeHash:candidate.tokens.find(([address])=>address===token1.address)![1],symbols:[token0.label,token1.label]};
};
describe('current history recorder admission boundary',()=>{
  it('matches each current market in both display orientations',()=>{
    for(let i=0;i<6;i++){const m=fixture(i);expect(currentHistoryDexDailyPriceManifestMatches(candidate,m.symbols,m)).toBe(true);expect(currentHistoryDexDailyPriceManifestMatches(candidate,[m.symbols[1],m.symbols[0]],m)).toBe(true);}
  });
  it('admits the six canonical recorder exports through the existing dispatcher',()=>{
    expect(HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS).toHaveLength(6);
    expect(Object.isFrozen(HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS)).toBe(true);
    const root='../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/primary-price-native-2026-10-14/';
    for(let i=0;i<6;i++){
      const path=i===0?'create-export-1/':'market-'+(i+1)+'/create-export-1/';
      const exported=JSON.parse(readFileSync(root+path+'stdout.log','utf8'));
      const m=HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS[i];
      expect(m).toEqual(exported.manifest);expect(exported.status).toBe('CURRENT_RECORDER_CANONICAL_EXPORT');
      expect(currentHistoryDexDailyPriceConfig(candidate,m.symbols)).toMatchObject({status:'active',manifest:m});
      expect(currentNativeDexDailyPriceConfig(candidate,[m.symbols[1],m.symbols[0]])).toMatchObject({status:'active',manifest:m});
    }
    expect(currentHistoryDexDailyPriceConfig(exit,['HBR','BCN'])).toEqual({status:'inactive'});
    expect(currentHistoryDexDailyPriceConfig(candidate,['HBR','wrong'])).toEqual({status:'inactive'});
  });
  it('rejects old/changed candidate, units, pair, source and artifact identity',()=>{
    const m=fixture(0);expect(currentHistoryDexDailyPriceManifestMatches(exit,m.symbols,m)).toBe(false);
    expect(currentHistoryDexDailyPriceManifestMatches({...candidate,core:exit.core},m.symbols,m)).toBe(false);
    expect(currentHistoryDexDailyPriceManifestMatches(candidate,['HBR','wrong'],m)).toBe(false);
    for(const patch of [{source:exit.core},{sourceRuntimeHash:`0x${'44'.repeat(32)}`},{sourceGraph:exit.graph},{recorderArtifact:'00'.repeat(32)},{decimals0:18},{pair:`0x${'44'.repeat(32)}`},{symbols:['BCN','HBR'] as const}])expect(currentHistoryDexDailyPriceManifestMatches(candidate,m.symbols,{...m,...patch})).toBe(false);
  });
  it('binds the exact graph-only compiled recorder artifact',()=>{
    const dir='../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/recorder-build/build-1/';
    const raw=readFileSync(dir+'ChainWhisperDailyPoolPrice.json'),artifact=JSON.parse(raw.toString()),identity=JSON.parse(readFileSync(dir+'identity.json','utf8'));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE.recorderArtifact);expect(identity.sourceGraphOnlyChange).toBe(true);
    expect(CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.abi).toEqual(artifact.abi);expect(CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode).toBe(artifact.deployedBytecode);
  });
});
