import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Interface } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { currentLimitAbi,preparedLimitAbi,exitLimitAbi,currentLimitAbiForCandidate,currentLimitOwnerNativeAdmission,resolveCurrentLimitScope,CURRENT_LIMIT_MARKET_FOR_POSITION,CURRENT_LIMIT_LAYOUT as l,CURRENT_LIMIT_OWNER_LAYOUT as ol,currentLimitTokens,decodeCurrentLimitMint,decodeCurrentLimitOwnerEvent,currentLimitNftAbi,currentLimitContext,checkCurrentLimitOwnerValues,checkCurrentLimitOwnerTransition,type CurrentLimitOwnerState } from './currentDexLimit';
import { CURRENT_CHEAP_DEX_CANDIDATE as c, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, resolveCurrentCheapDexCandidate } from './dexV2Deployment';
const native=createRequire(resolve('../ChainWhisper Contracts V2/validation/package.json'));
const binding=native('./candidates/direct-limit-match-2026-09-30/current-integration/candidate-binding.cjs');

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

describe('frozen b2aa plain Limit codec and layout',()=>{
  it('matches the full creation/owner ABI and exact source/snapshot/market roots in the deployed build',()=>{
    const f=native('./candidates/shared-core-exit-preview-2026-10-07/candidate.cjs').frozen(),abi=new Interface(f.artifacts.ChainWhisperDexCore.abi);
    expect(f.manifest.binding.graphSha256).toBe(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph);
    for(const row of preparedLimitAbi.fragments){const name=(row as unknown as {name:string}).name,expected=row.type==='function'?abi.getFunction(name):abi.getEvent(name);expect(row.format('full')).toBe(expected!.format('full'));}
    const roots={ChainWhisperDexCore:{_marketForPosition:CURRENT_LIMIT_MARKET_FOR_POSITION,_sourceIdForPosition:l.coreMapping,_sources:l.coreSources},ChainWhisperFixedEngine:{_sourceIdForPosition:l.engineMapping,_sources:l.engineSources,_ownerStatus:l.engineStatus,_rangeOwnerSnapshot:l.engineSnapshots,_closeOwner:ol.engineCloseOwner,_registeredSourceIds:ol.engineDirectory,_slotEpochs:ol.engineEpochs}};
    for(const [name,fields]of Object.entries(roots)){
      const a=f.artifacts[name],layout=f.info.output.contracts[a.sourceName][name].storageLayout;
      for(const [field,want]of Object.entries(fields))expect(BigInt(layout.storage.find((x:{label:string})=>x.label===field).slot)).toBe(want);
      const source=layout.storage.find((x:{label:string})=>x.label==='_sources'),shape=layout.types[layout.types[source.type].value];expect(Number(shape.numberOfBytes)/32).toBe(name==='ChainWhisperDexCore'?36:39);
      for(const [index,field]of ['slotIndex','slotEpoch','positionId','sourceId','sourceEpoch','sourceOrdinal','outputBucketId','proceedsBucketId','termsRevision','ownershipRevision','lifecycleRevision'].entries())expect(BigInt(shape.members.find((x:{label:string})=>x.label===field).slot)).toBe(BigInt(index+1));
      if(name==='ChainWhisperFixedEngine'){const snapshot=layout.storage.find((x:{label:string})=>x.label==='_rangeOwnerSnapshot'),array=layout.types[layout.types[snapshot.type].value],envelope=layout.types[array.base];expect(array.numberOfBytes).toBe('1024');expect(envelope.numberOfBytes).toBe('128');expect(envelope.members.find((x:{label:string})=>x.label==='userCiphertext').slot).toBe('2');}
    }
    expect(preparedLimitAbi.getFunction('createPrivateOrder')!.selector).not.toBe(currentLimitAbi.getFunction('createPrivateOrder')!.selector);
  },30000);
  it.each(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs)('resolves canonical selected pair $canonicalId in either presentation order',pair=>{
    for(const tokens of [pair.tokens,[pair.tokens[1],pair.tokens[0]]]as const){const scope=resolveCurrentLimitScope('cheap-exit',tokens);expect(scope).toMatchObject({marketId:pair.marketId,engine:pair.engine,poolTokens:pair.tokens});expect(currentLimitTokens(true,STAGED_EXIT_PREVIEW_DEX_CANDIDATE,tokens)).toEqual(pair.tokens);expect(currentLimitTokens(false,STAGED_EXIT_PREVIEW_DEX_CANDIDATE,tokens)).toEqual([pair.tokens[1],pair.tokens[0]]);}
  });
});
describe('frozen current plain Limit codec',()=>{
  it('matches exact frozen ABI and public storage layout, not a generic reader',()=>{
    const f=binding.loadCandidate(),abi=new Interface(f.artifact('ChainWhisperDexCore').abi);
    for(const row of currentLimitAbi.fragments){const name=(row as unknown as {name:string}).name;const expected=row.type==='function'?abi.getFunction(name):abi.getEvent(name);expect(row.format('full')).toBe(expected!.format('full'));}
    for(const [name,fields]of [['ChainWhisperDexCore',[['_sourceIdForPosition',l.coreMapping],['_sources',l.coreSources]]],['ChainWhisperFixedEngine',[['_sourceIdForPosition',l.engineMapping],['_sources',l.engineSources],['_ownerStatus',l.engineStatus],['_rangeOwnerSnapshot',l.engineSnapshots]]]]as const){
      const layout=f.compiled(name).storageLayout;for(const [field,slot]of fields)expect(BigInt(layout.storage.find((x:{label:string})=>x.label===field).slot)).toBe(slot);
      const source=layout.storage.find((x:{label:string})=>x.label==='_sources'),members=layout.types[layout.types[source.type].value].members;
      for(const [index,field]of ['slotIndex','slotEpoch','positionId','sourceId','sourceEpoch','sourceOrdinal','outputBucketId','proceedsBucketId','termsRevision','ownershipRevision','lifecycleRevision'].entries())expect(BigInt(members.find((x:{label:string})=>x.label===field).slot)).toBe(BigInt(index+1));
      if(name==='ChainWhisperFixedEngine'){
        const snapshot=layout.storage.find((x:{label:string})=>x.label==='_rangeOwnerSnapshot');
        const array=layout.types[layout.types[snapshot.type].value],envelope=layout.types[array.base];
        expect(array.numberOfBytes).toBe('1024');expect(envelope.numberOfBytes).toBe('128');
        expect(envelope.members.find((x:{label:string})=>x.label==='userCiphertext').slot).toBe('2');
        expect(envelope.members.find((x:{label:string})=>x.label==='ciphertext').slot).toBe('0');
      }
    }
  });
  it('offers canonical A for true, canonical B for false',()=>{expect(currentLimitTokens(true)).toEqual([c.tokens[1][0],c.tokens[0][0]]);expect(currentLimitTokens(false)).toEqual([c.tokens[0][0],c.tokens[1][0]]);});
  it('binds owner layout and snapshot mux to frozen source, not creation defaults',()=>{
    const f=binding.loadCandidate(),layout=f.compiled('ChainWhisperFixedEngine').storageLayout;
    for(const [name,index]of [['_closeOwner',ol.engineCloseOwner],['_registeredSourceIds',ol.engineDirectory],['_slotEpochs',ol.engineEpochs]]as const)expect(BigInt(layout.storage.find((x:{label:string})=>x.label===name).slot)).toBe(index);
    const nft=f.compiled('ChainWhisperDexPositionNFT').storageLayout;for(const [name,index]of [['_owners',ol.nftOwners],['_balances',ol.nftBalances],['_tokenApprovals',ol.nftApprovals]]as const)expect(BigInt(nft.storage.find((x:{label:string})=>x.label===name).slot)).toBe(index);
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
});


describe('selected candidate Limit event provenance',()=>{
  const selected=resolveCurrentCheapDexCandidate('cheap-native'),archived=resolveCurrentCheapDexCandidate('cheap-archived'),owner=`0x${'22'.repeat(20)}`,nft=selected.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
  it('uses exact selected Core and NFT for creation and rejects other candidate identities',()=>{
    const logs=[{address:selected.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[9n])},{address:nft,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])}];
    expect(decodeCurrentLimitMint(logs,owner,selected)).toBe(9n);expect(()=>decodeCurrentLimitMint(logs,owner)).toThrow();expect(()=>decodeCurrentLimitMint(logs,owner,archived)).toThrow();
    const oldNft=archived.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];expect(()=>decodeCurrentLimitMint([logs[0],{...logs[1],address:oldNft}],owner,selected)).toThrow();
  });
  it.each(['claim','close']as const)('checks selected Core %s events',action=>{
    const event={address:selected.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent(action==='claim'?'FixedProceedsClaimed':'FixedPositionClosed')!,[9n])};
    expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n,selected)).not.toThrow();expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n)).toThrow();expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n,archived)).toThrow();expect(()=>decodeCurrentLimitOwnerEvent([{...event,address:archived.core}],action,9n,selected)).toThrow();
  });
  it('binds the default mint decoder to the actual current Core and NFT',()=>{
    const currentNft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    const logs=[{address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[9n])},{address:currentNft,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])}];
    expect(decodeCurrentLimitMint(logs,owner)).toBe(9n);expect(()=>decodeCurrentLimitMint(logs,owner,selected)).toThrow();
    expect(()=>decodeCurrentLimitMint([{...logs[0],address:selected.core},logs[1]],owner)).toThrow();expect(()=>decodeCurrentLimitMint([logs[0],{...logs[1],address:nft}],owner)).toThrow();
  });
  it.each(['claim','close']as const)('binds default %s events to the actual current Core',action=>{
    const event={address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent(action==='claim'?'FixedProceedsClaimed':'FixedPositionClosed')!,[9n])};
    expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n)).not.toThrow();expect(()=>decodeCurrentLimitOwnerEvent([event],action,9n,selected)).toThrow();expect(()=>decodeCurrentLimitOwnerEvent([{...event,address:selected.core}],action,9n)).toThrow();
  });
});

describe('native candidate owner layout and token/context binding',()=>{
  it('checks exact fa71 compiled storage roots, source offsets and owner envelopes against the retained decoder',()=>{
    type Field={label:string;slot:string;type:string;offset:number};type Layout={storage:Field[];types:Record<string,{label:string;numberOfBytes:string;encoding?:string;value?:string;base?:string;members?:Field[]}>};
    const fresh=native('./candidates/estimate-compatible-operations-2026-10-04/native-automatic-1/binding.cjs').local(),retained=binding.loadCandidate();
    expect(fresh.identity.graph).toBe(resolveCurrentCheapDexCandidate('cheap-native').graph);expect(fresh.identity.package).toBe(resolveCurrentCheapDexCandidate('cheap-native').packageSha256);
    const roots={ChainWhisperDexCore:{_sourceIdForPosition:l.coreMapping,_sources:l.coreSources},ChainWhisperFixedEngine:{_sourceIdForPosition:l.engineMapping,_sources:l.engineSources,_ownerStatus:l.engineStatus,_rangeOwnerSnapshot:l.engineSnapshots,_closeOwner:ol.engineCloseOwner,_registeredSourceIds:ol.engineDirectory,_slotEpochs:ol.engineEpochs},ChainWhisperDexPositionNFT:{_owners:ol.nftOwners,_balances:ol.nftBalances,_tokenApprovals:ol.nftApprovals}};
    for(const [name,fields]of Object.entries(roots)){
      const current=fresh.layouts[name]as Layout,old=retained.compiled(name).storageLayout as Layout;
      for(const [label,want]of Object.entries(fields)){const field=current.storage.find(x=>x.label===label);expect(field,`${name}.${label}`).toBeTruthy();expect(BigInt(field!.slot),`${name}.${label}`).toBe(want);const previous=old.storage.find(x=>x.label===label)!;expect(field!.offset).toBe(previous.offset);
        const map=current.types[field!.type],oldMap=old.types[previous.type];expect(map.encoding).toBe(oldMap.encoding);
        if(label==='_sources'){const shape=(layout:Layout,type:string)=>layout.types[type].members!.map(x=>({label:x.label,slot:x.slot,offset:x.offset,type:layout.types[x.type].label,bytes:layout.types[x.type].numberOfBytes}));expect(shape(current,map.value!)).toEqual(shape(old,oldMap.value!));}
      }
      if(name==='ChainWhisperFixedEngine'){
        const snapshot=current.storage.find(x=>x.label==='_rangeOwnerSnapshot')!,array=current.types[current.types[snapshot.type].value!],envelope=current.types[array.base!];expect(array.numberOfBytes).toBe('1024');expect(envelope.numberOfBytes).toBe('128');expect(envelope.members!.find(x=>x.label==='userCiphertext')!.slot).toBe('2');expect(current.storage.find(x=>x.label==='_registeredSourceCount')!.slot).toBe('3');
      }
    }
  },30000);
  it('uses sorted selected tokens and selected context domain without changing default order',()=>{
    const selected=resolveCurrentCheapDexCandidate('cheap-native'),tokens=[...selected.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1);expect(currentLimitTokens(true,selected)).toEqual([tokens[0][0],tokens[1][0]]);expect(currentLimitTokens(false,selected)).toEqual([tokens[1][0],tokens[0][0]]);
    const engine=selected.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1],owner=`0x${'22'.repeat(20)}`,bind=`0x${'44'.repeat(32)}`;
    expect(currentLimitContext(engine,bind,9n,24n,owner,undefined,selected)).toBe(currentLimitContext(engine,bind,9n,24n,owner));expect(currentLimitContext(engine,bind,9n,24n,owner,undefined,{...selected,chainId:selected.chainId+1})).not.toBe(currentLimitContext(engine,bind,9n,24n,owner,undefined,selected));
  });
});


describe('current Limit top-up and reprice boundaries',()=>{
  it('matches the frozen b2aa methods and event index flags; historical ABIs do not gain them',()=>{
    const frozen=native('./candidates/shared-core-exit-preview-2026-10-07/candidate.cjs').frozen(),exact=new Interface(frozen.artifacts.ChainWhisperDexCore.abi);
    for(const name of ['topUpPrivateOrder','repricePrivateOrder']){
      expect(exitLimitAbi.getFunction(name)!.format('sighash')).toBe(exact.getFunction(name)!.format('sighash'));
      expect(currentLimitAbiForCandidate('cheap-prepared').getFunction(name)).toBeNull();expect(currentLimitAbi.getFunction(name)).toBeNull();
    }
    for(const name of ['FixedPositionToppedUp','FixedPositionRepriced'])expect(exitLimitAbi.getEvent(name)!.format('full')).toBe(exact.getEvent(name)!.format('full'));
    for(const key of ['cheap-current','cheap-prepared','cheap-exit','cheap-native','cheap-archived']as const){expect(currentLimitOwnerNativeAdmission(key).topup).toBe(key==='cheap-exit');expect(currentLimitOwnerNativeAdmission(key).reprice).toBe(key==='cheap-exit');}
  },30000);
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
    const c=resolveCurrentCheapDexCandidate('cheap-exit'),row={address:c.core,...exitLimitAbi.encodeEventLog(exitLimitAbi.getEvent('FixedPositionRepriced')!,[9n,2n])};
    expect(()=>decodeCurrentLimitOwnerEvent([row],'reprice',9n,c,1n)).not.toThrow();expect(()=>decodeCurrentLimitOwnerEvent([row],'reprice',9n,c,2n)).toThrow();expect(()=>decodeCurrentLimitOwnerEvent([{...row,data:row.data+'00'}],'reprice',9n,c,1n)).toThrow();
  });
});
