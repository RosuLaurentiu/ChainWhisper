import { AbiCoder,keccak256 } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { STAGED_BUILD13_DEX_CANDIDATE as candidate } from './currentDexBuild13Candidate';
import { PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT } from './packedInputDexDailyPriceArtifact';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { currentHistoryDexDailyPriceManifestMatches,currentHistoryDexDailyPriceConfig,HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from './currentDexHistoryDailyPriceTestnet';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';

// decision-034: the selected build 13 candidate. The 9c2c gap and b2aa descriptors and the gap recorder evidence checks
// were removed; a changed identity stands for any other candidate.
const exit={...candidate,graph:'11'.repeat(32),packageSha256:'22'.repeat(32),core:`0x${'33'.repeat(20)}`};
// Synthetic deployment fields exercise scope matching only; this is not a live manifest.
const fixture=(index:number):CurrentDexDailyPriceManifest=>{
  const display=readCurrentDexDisplay(candidate).pairs[index],[token0,token1]=display.tokens;
  return {sourceGraph:candidate.graph,recorderArtifact:PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,chainId:candidate.chainId,genesisHash:candidate.genesisHash,
    address:'0x0000000000000000000000000000000000001234',runtimeHash:`0x${'11'.repeat(32)}`,deployer:'0x0000000000000000000000000000000000005678',deploymentBlock:'1',deploymentBlockHash:`0x${'22'.repeat(32)}`,deploymentTransactionHash:`0x${'33'.repeat(32)}`,
    source:candidate.core,sourceRuntimeHash:candidate.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2],releaseId:candidate.releaseId,market:display.marketId,canonicalId:candidate.pairs[index].canonicalId,
    pair:keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[candidate.chainId,token0.address,token1.address])),token0:token0.address,token1:token1.address,decimals0:6,decimals1:6,
    token0RuntimeHash:candidate.tokens.find(([address])=>address===token0.address)![1],token1RuntimeHash:candidate.tokens.find(([address])=>address===token1.address)![1],symbols:[token0.label,token1.label]};
};
describe('current history recorder admission boundary',()=>{
  it('matches each current market in both display orientations',()=>{
    for(let i=0;i<6;i++){const m=fixture(i);expect(currentHistoryDexDailyPriceManifestMatches(candidate,m.symbols,m)).toBe(true);expect(currentHistoryDexDailyPriceManifestMatches(candidate,[m.symbols[1],m.symbols[0]],m)).toBe(true);}
  });
  it('admits the six canonical build 13 recorder manifests through the existing dispatcher',()=>{
    expect(HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS).toHaveLength(6);
    expect(Object.isFrozen(HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS)).toBe(true);
    for(const m of HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS){
      expect(m.sourceGraph).toBe(candidate.graph);
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
});
