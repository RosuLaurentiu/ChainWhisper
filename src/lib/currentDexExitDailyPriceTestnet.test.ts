import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AbiCoder,keccak256 } from '@coti-io/coti-ethers';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as candidate, STAGED_PREPARED_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE,
  CURRENT_CHEAP_DEX_CANDIDATE, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE, CURRENT_DEX_DAILY_PRICE_CONFIG, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { currentExitDexDailyPriceManifestMatches,currentExitDexDailyPriceConfig,EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from './currentDexExitDailyPriceTestnet';
import { currentNativeDexDailyPriceConfig,NATIVE_TESTNET_DEX_DAILY_PRICE_MANIFEST } from './currentDexNativeDailyPriceTestnet';

// Synthetic deployment fields only; canonical candidate/market/unit fields are real.
function manifest(index:number):CurrentDexDailyPriceManifest{
  const pair=readCurrentDexDisplay(candidate).pairs[index],[a,b]=pair.tokens;
  return{...NATIVE_TESTNET_DEX_DAILY_PRICE_MANIFEST,sourceGraph:candidate.graph,
    recorderArtifact:CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE.recorderArtifact,chainId:candidate.chainId,genesisHash:candidate.genesisHash,
    source:candidate.core,sourceRuntimeHash:candidate.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2],releaseId:candidate.releaseId,
    market:pair.marketId,pair:keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[candidate.chainId,a.address,b.address])),
    canonicalId:candidate.pairs[index].canonicalId,token0:a.address,token1:b.address,decimals0:a.decimals,decimals1:b.decimals,
    token0RuntimeHash:candidate.tokens.find(([address])=>address===a.address)![1],token1RuntimeHash:candidate.tokens.find(([address])=>address===b.address)![1],symbols:[a.label,b.label]};
}
describe('current shared-Core recorder market scope',()=>{
  it.each([0,1,2,3,4,5])('binds canonical market %i in both display orientations',index=>{
    const m=manifest(index);expect(currentExitDexDailyPriceManifestMatches(candidate,m.symbols,m)).toBe(true);
    expect(currentExitDexDailyPriceManifestMatches(candidate,[m.symbols[1],m.symbols[0]],m)).toBe(true);
    expect(currentExitDexDailyPriceManifestMatches(candidate,manifest((index+1)%6).symbols,m)).toBe(false);
    expect(m.decimals0).toBe(6);expect(m.decimals1).toBe(6);
  });
  it.each(['sourceGraph','recorderArtifact','chainId','genesisHash','source','sourceRuntimeHash','releaseId','market','pair','canonicalId','token0','token1','decimals0','decimals1','token0RuntimeHash','token1RuntimeHash','symbols']as const)('rejects changed %s scope',field=>{
    const m=manifest(0),bad={...m,[field]:field==='symbols'?['BCN','HBR']:field==='decimals0'||field==='decimals1'?18:field==='canonicalId'||field==='chainId'?'999':'invalid'};
    expect(currentExitDexDailyPriceManifestMatches(candidate,m.symbols,bad as CurrentDexDailyPriceManifest)).toBe(false);
  });
  it('does not transfer another candidate, changed descriptor or old recorder admission',()=>{
    const m=manifest(0);expect(currentExitDexDailyPriceManifestMatches(STAGED_PREPARED_DEX_CANDIDATE,m.symbols,m)).toBe(false);
    expect(currentExitDexDailyPriceManifestMatches({...candidate,feePpm:candidate.feePpm+1},m.symbols,m)).toBe(false);
    expect(currentExitDexDailyPriceManifestMatches(candidate,m.symbols,NATIVE_TESTNET_DEX_DAILY_PRICE_MANIFEST)).toBe(false);
    expect(currentExitDexDailyPriceManifestMatches(candidate,['HBR','HBR'],m)).toBe(false);
  });
  it('copies and freezes all six exact native exported manifests',()=>{
    const bytes=readFileSync('../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/reference-history/runner-v3/APP_MANIFESTS.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('bbfc6a2aba4df58bd176c3a031ac493ec36d38eb74be654685b5a2978c30a74e');
    expect(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS).toEqual(JSON.parse(bytes.toString()));
    expect(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS).toHaveLength(6);
    expect(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS.map(m=>m.canonicalId).sort()).toEqual(['1','2','3','4','5','6']);
    for(const field of ['market','pair','address'] as const)expect(new Set(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS.map(m=>m[field].toLowerCase())).size).toBe(6);
    expect(Object.isFrozen(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS)).toBe(true);
    expect(Reflect.set(EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS,'0',{})).toBe(false);
    for(const m of EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS){
      const id=m.canonicalId,symbol=m.symbols[0];
      expect(Object.isFrozen(m)).toBe(true);expect(Object.isFrozen(m.symbols)).toBe(true);
      expect(Reflect.set(m,'canonicalId','999')).toBe(false);expect(m.canonicalId).toBe(id);
      expect(Reflect.set(m.symbols,'0','other')).toBe(false);expect(m.symbols[0]).toBe(symbol);
      expect(m.decimals0).toBe(6);expect(m.decimals1).toBe(6);
    }
  });
  it.each([0,1,2,3,4,5])('admits native recorder %i in both display orientations for reads only',index=>{
    const m=EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS[index];
    for(const pair of [m.symbols,[m.symbols[1],m.symbols[0]] as const]){
      const config=currentExitDexDailyPriceConfig(candidate,pair);
      expect(config).toEqual({status:'active',manifest:m,rpcUrl:COTI_TESTNET_NETWORK.rpcUrl,finalityLagBlocks:2});
      expect(currentNativeDexDailyPriceConfig(candidate,pair)).toEqual(config);expect(Object.isFrozen(config)).toBe(true);
      expect(config).not.toHaveProperty('readyToSign');expect(config).not.toHaveProperty('priceE18');
    }
  });
  it.each(['package','core','graph','fee','market','attestation'] as const)('leaves changed %s candidate inactive for the admitted pair',field=>{
    const bad={...candidate,...(field==='fee'?{feePpm:candidate.feePpm+1}:field==='package'?{packageSha256:'changed'}:
      field==='core'?{core:candidate.tokens[0][0]}:field==='graph'?{graph:'changed'}:field==='market'?{marketId:'changed'}:{attestationSha256:'changed'})};
    for(const m of EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS){
      expect(currentExitDexDailyPriceConfig(bad,m.symbols)).toEqual({status:'inactive'});
      expect(currentNativeDexDailyPriceConfig(bad,m.symbols)).toEqual({status:'inactive'});
    }
  });
  it('does not admit omitted/unknown/duplicate pairs, old candidates or signing/default authority',()=>{
    expect(currentExitDexDailyPriceConfig(candidate,undefined as never)).toEqual({status:'inactive'});
    expect(currentNativeDexDailyPriceConfig(candidate)).toEqual({status:'inactive'});
    for(const m of EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS){
      for(const pair of [[m.symbols[0],'unknown'],[m.symbols[0],m.symbols[0]]] as const){
        expect(currentExitDexDailyPriceConfig(candidate,pair)).toEqual({status:'inactive'});
        expect(currentNativeDexDailyPriceConfig(candidate,pair)).toEqual({status:'inactive'});
      }
      for(const old of [STAGED_PREPARED_DEX_CANDIDATE,STAGED_D06_DEX_CANDIDATE])expect(currentExitDexDailyPriceConfig(old,m.symbols)).toEqual({status:'inactive'});
    }
    expect(CURRENT_CHEAP_DEX_CANDIDATE).toEqual(STAGED_D06_DEX_CANDIDATE);
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG).toEqual({status:'inactive'});
    expect(()=>assertCurrentCheapDexNativeAdmission(candidate)).toThrow('native App submission admission is absent');
  });
});
