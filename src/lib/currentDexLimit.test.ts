import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Interface } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { exitLimitAbi,currentLimitOwnerNativeAdmission,resolveCurrentLimitScope,currentLimitAbi,currentLimitTokens,decodeCurrentLimitMint,decodeCurrentLimitOwnerEvent,currentLimitNftAbi,currentLimitContext,checkCurrentLimitOwnerValues,checkCurrentLimitOwnerTransition,type CurrentLimitOwnerState } from './currentDexLimit';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as c } from './dexV2Deployment';
const native=createRequire(resolve('../ChainWhisper Contracts V2/validation/package.json'));

describe('current Limit owner source transition',()=>{
  const state=():CurrentLimitOwnerState=>({positionId:9n,sourceId:24n,status:0n,context:'0x',terms:1n,ownership:1n,lifecycle:1n,closed:false,marketRevision:1n,registryRevision:1n,coreWords:Array(36).fill(1n),engineWords:Array(39).fill(1n),directory:Array(8).fill(0n),epochs:Array(8).fill(0n),snapshot:Array(32).fill(0n),registeredCount:1n,nftBalance:1n,approval:0n} as unknown as CurrentLimitOwnerState);
  it('rejects source terms, lifecycle, directory and NFT accounting changes',()=>{
    const before=state();
    expect(()=>checkCurrentLimitOwnerTransition({action:'claim',before,after:{...before,terms:2n}})).toThrow('Limit result lifecycle or terms changed.');
    expect(()=>checkCurrentLimitOwnerTransition({action:'pause',before,after:{...before,status:1n,lifecycle:2n,coreWords:before.coreWords.map((v,i)=>i===5||i===11?2n:v),engineWords:before.engineWords.map((v,i)=>i===11?2n:v)}})).toThrow('Unrelated Limit source fields changed.');
    expect(()=>checkCurrentLimitOwnerTransition({action:'close',before,after:{...before,status:0n,lifecycle:2n,closed:true,directory:Array(8).fill(0n),registeredCount:0n,nftBalance:0n,approval:0n}})).not.toThrow();
    expect(()=>checkCurrentLimitOwnerTransition({action:'close',before,after:{...before,lifecycle:2n,directory:Array(8).fill(0n),registeredCount:1n,nftBalance:0n,approval:0n}})).toThrow('Limit directory or NFT accounting changed.');
  });
});

describe('current plain Limit pair scope',()=>{
  it.each(c.pairs)('resolves canonical selected pair $canonicalId in either presentation order',pair=>{
    for(const tokens of [pair.tokens,[pair.tokens[1],pair.tokens[0]]]as const){const scope=resolveCurrentLimitScope('cheap-history',tokens);expect(scope).toMatchObject({marketId:pair.marketId,engine:pair.engine,poolTokens:pair.tokens});expect(currentLimitTokens(true,c,tokens)).toEqual(pair.tokens);expect(currentLimitTokens(false,c,tokens)).toEqual([pair.tokens[1],pair.tokens[0]]);}
  });
});
describe('current plain Limit owner values and provenance',()=>{
  it('checks owner values and binds context to every revision',()=>{
    const values=[10n,7n,3n,1n,1n,10n,1n,0n];expect(checkCurrentLimitOwnerValues(values)).toMatchObject({unspent:10n,proceeds:7n});expect(()=>checkCurrentLimitOwnerValues([...values.slice(0,5),100n,1n,0n])).toThrow();
    const engine=c.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1],owner=`0x${'22'.repeat(20)}`,bindingHash=`0x${'44'.repeat(32)}`;
    const original=currentLimitContext(engine,bindingHash,9n,24n,owner);for(const revisions of [{terms:2n,ownership:1n,lifecycle:1n,closed:false},{terms:1n,ownership:2n,lifecycle:1n,closed:false},{terms:1n,ownership:1n,lifecycle:2n,closed:false},{terms:1n,ownership:1n,lifecycle:1n,closed:true}])expect(currentLimitContext(engine,bindingHash,9n,24n,owner,revisions)).not.toBe(original);
  });
  it.each(['missing','duplicate','wrongNFT','wrongOwner','suffix'])('rejects %s mint provenance',fault=>{
    const owner=`0x${'22'.repeat(20)}`,nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    const event={address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[9n])};
    const mint={address:nft as string,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])};
    if(fault==='wrongNFT')mint.address=c.core;if(fault==='wrongOwner')mint.topics[2]=mint.topics[1];if(fault==='suffix')event.data+='00';
    const logs=fault==='missing'?[mint]:fault==='duplicate'?[event,event,mint]:[event,mint];expect(()=>decodeCurrentLimitMint(logs,owner)).toThrow();
  });
  it('binds the default mint decoder to the actual current Core and NFT',()=>{
    const owner=`0x${'22'.repeat(20)}`,other=`0x${'55'.repeat(20)}`,currentNft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    const logs=[{address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[9n])},{address:currentNft,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])}];
    expect(decodeCurrentLimitMint(logs,owner)).toBe(9n);
    expect(()=>decodeCurrentLimitMint([{...logs[0],address:other},logs[1]],owner)).toThrow();expect(()=>decodeCurrentLimitMint([logs[0],{...logs[1],address:other}],owner)).toThrow();
  });
  it.each(['claim','close']as const)('binds default %s events to the actual current Core',action=>{
    const event={address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent(action==='claim'?'FixedProceedsClaimed':'FixedPositionClosed')!,[9n])};
    expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n)).not.toThrow();expect(()=>decodeCurrentLimitOwnerEvent([{...event,address:`0x${'55'.repeat(20)}`}],action,9n)).toThrow();
  });
  it('binds context to the selected candidate chain',()=>{
    const engine=c.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1],owner=`0x${'22'.repeat(20)}`,bind=`0x${'44'.repeat(32)}`;
    expect(currentLimitContext(engine,bind,9n,24n,owner,undefined,c)).toBe(currentLimitContext(engine,bind,9n,24n,owner));expect(currentLimitContext(engine,bind,9n,24n,owner,undefined,{...c,chainId:c.chainId+1})).not.toBe(currentLimitContext(engine,bind,9n,24n,owner,undefined,c));
  });
});

describe('current Limit top-up and reprice boundaries',()=>{
  it('admits current native top-up and reprice owner actions',()=>{
    expect(currentLimitOwnerNativeAdmission('cheap-history')).toMatchObject({topup:true,reprice:true});
  });
  it('allows only exact b2aa ciphertext slots and terms revision for edits',()=>{
    const before={positionId:9n,sourceId:24n,status:1n,context:'0x',terms:1n,ownership:1n,lifecycle:1n,closed:false,marketRevision:1n,registryRevision:1n,coreWords:Array(36).fill(1n),engineWords:Array(39).fill(1n),directory:Array(8).fill(0n),epochs:Array(8).fill(0n),snapshot:Array(32).fill(0n),registeredCount:1n,nftBalance:1n,approval:0n}as unknown as CurrentLimitOwnerState;
    for(const action of ['topup','reprice']as const){
      const core=action==='topup'?[13,14,15,16]:[9],engine=action==='topup'?[16,17,18,19,21,22]:[9,13,14,15,21,22,23,24,25,26,27,28];
      const after={...before,terms:action==='reprice'?2n:1n,coreWords:before.coreWords.map((v,i)=>core.includes(i)?2n:v),engineWords:before.engineWords.map((v,i)=>engine.includes(i)?2n:v)};
      expect(()=>checkCurrentLimitOwnerTransition({action,before,after})).not.toThrow();
      for(let i=0;i<36;i++)if(!core.includes(i))expect(()=>checkCurrentLimitOwnerTransition({action,before,after:{...after,coreWords:after.coreWords.map((v,j)=>i===j?3n:v)}})).toThrow();
      for(let i=0;i<39;i++)if(!engine.includes(i))expect(()=>checkCurrentLimitOwnerTransition({action,before,after:{...after,engineWords:after.engineWords.map((v,j)=>i===j?3n:v)}})).toThrow();
      expect(()=>checkCurrentLimitOwnerTransition({action,before,after:{...after,lifecycle:2n}})).toThrow();
    }
  });
  it('requires exact canonical repricing revision in the receipt',()=>{
    const row={address:c.core,...exitLimitAbi.encodeEventLog(exitLimitAbi.getEvent('FixedPositionRepriced')!,[9n,2n])};
    expect(()=>decodeCurrentLimitOwnerEvent([row],'reprice',9n,c,1n)).not.toThrow();expect(()=>decodeCurrentLimitOwnerEvent([row],'reprice',9n,c,2n)).toThrow();expect(()=>decodeCurrentLimitOwnerEvent([{...row,data:row.data+'00'}],'reprice',9n,c,1n)).toThrow();
  });
});
import { packCurrentLimitTerms, packedLimitAbi, PACKED_LIMIT_INPUT_GRAPH, usesPackedLimitInputs } from './currentDexLimit';
import { usesPackedPoolInputs } from './currentDexPoolFunding';

describe('packed plain Limit terms',()=>{
  const mask=(1n<<128n)-1n;
  it('binds the two new selectors to the exact frozen derivative and no other graph',()=>{
    // Build 13 (graph 5045070b) is the frozen derivative the App binds since CW-120.
    const f=native('./candidates/c1-band-sizing-2026-11-21/sizing-candidate.cjs').frozen(),compiled=new Interface(f.artifacts.ChainWhisperDexCore.abi);
    expect(f.manifest.binding.graphSha256).toBe(PACKED_LIMIT_INPUT_GRAPH);
    expect(usesPackedLimitInputs({graph:PACKED_LIMIT_INPUT_GRAPH})).toBe(true);
    expect(usesPackedPoolInputs({graph:PACKED_LIMIT_INPUT_GRAPH})).toBe(true);
    expect(usesPackedLimitInputs({graph:'00'.repeat(32)})).toBe(false);
    for(const row of packedLimitAbi.fragments){const name=(row as unknown as {name:string}).name,actual=row.type==='function'?compiled.getFunction(name):compiled.getEvent(name);expect(row.format('sighash')).toBe(actual!.format('sighash'));}
    expect(packedLimitAbi.getFunction('createPrivateOrder')!.selector).toBe('0x10f95a7c');
    expect(packedLimitAbi.getFunction('repricePrivateOrder')!.selector).toBe('0xf0927f97');
  });
  it('encodes full funding and binds distinct create/reprice selectors with four/three signed inputs',()=>{
    const wide=(n:bigint)=>({ciphertext:{ciphertextHigh:1n,ciphertextLow:n},signature:`0x${'44'.repeat(65)}`});
    const funding=(1n<<256n)-1n,market=`0x${'11'.repeat(32)}`,pairs=packCurrentLimitTerms([3n,1n,0n,1n,2n],true).map(wide);
    const created=packedLimitAbi.decodeFunctionData('createPrivateOrder',packedLimitAbi.encodeFunctionData('createPrivateOrder',[market,wide(funding),pairs]));
    expect(created).toHaveLength(3);expect(created[1].ciphertext.ciphertextLow).toBe(funding);expect(created[2]).toHaveLength(3);
    const repriced=packedLimitAbi.decodeFunctionData('repricePrivateOrder',packedLimitAbi.encodeFunctionData('repricePrivateOrder',[9n,2n,packCurrentLimitTerms([3n,1n,0n,1n,2n]).map(wide)]));
    expect(repriced).toHaveLength(3);expect(repriced[2]).toHaveLength(3);expect(repriced[2][2].ciphertext.ciphertextLow&mask).toBe(0n);
    for(const name of ['createPrivateOrder','repricePrivateOrder'])expect(packedLimitAbi.getFunction(name)!.selector).not.toBe(exitLimitAbi.getFunction(name)!.selector);
  });
  it('keeps five full-width terms and a Boolean lane in their exact order',()=>{
    const terms=[mask,mask-1n,mask,1n,1n] as const;
    expect(packCurrentLimitTerms(terms,true)).toEqual([(mask<<128n)|(mask-1n),(mask<<128n)|1n,(1n<<128n)|1n]);
    expect(packCurrentLimitTerms(terms,false)[2]).toBe(1n<<128n);
    expect(packCurrentLimitTerms(terms)[2]).toBe(1n<<128n);
  });
  it('rejects invalid widths, witnesses, lengths and direction before signing',()=>{
    const valid=[3n,1n,0n,1n,2n] as const;
    for(const terms of [[0n,1n,0n,1n,0n],[3n,1n,0n,1n,1n],[3n,1n,-1n,1n,2n],[3n,1n,1n<<128n,1n,2n],[3n,1n,0n,1n]])
      expect(()=>packCurrentLimitTerms(terms)).toThrow();
    expect(()=>packCurrentLimitTerms(valid,2 as never)).toThrow();
    expect(()=>packCurrentLimitTerms(valid,1n as never)).toThrow();
  });
});
