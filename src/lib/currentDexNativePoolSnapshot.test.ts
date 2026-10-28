import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AbiCoder,Interface,keccak256,toBeHex } from '@coti-io/coti-ethers';
import { STAGED_NATIVE_DEX_CANDIDATE as candidate } from './dexV2Deployment';
import { CURRENT_NATIVE_POOL_LAYOUT as layout,currentPoolCanonicalTokenMap,currentPoolPositionStorageBase,
  currentPoolStoredEnvelopes,currentNativePoolSnapshotAbi,createCurrentNativePoolSnapshotReader,
  checkCurrentPoolFinancialTransition,checkCurrentPoolSnapshotOnlyChange,checkCurrentPoolUnfundedCleanupState,type CurrentPoolStoredState } from './currentDexNativePoolSnapshot';
const word=(v:bigint|number)=>toBeHex(v,32),owner='0x1111111111111111111111111111111111111111',hash=word(77),block={number:100n,hash:word(100)};
const empty=()=>Array.from({length:64},()=>word(0));
const state=():CurrentPoolStoredState=>({market:Array.from({length:71},()=>word(0)),anchors:Array.from({length:7},empty),
  protectedClaim:empty(),protectedOwner:owner,protectedStatus:1n,existingClaims:{19:empty()},claim:empty(),core:Array.from({length:50},()=>word(0)),engine:Array.from({length:46},()=>word(0)),
  ledgers:[Array.from({length:12},()=>word(0)),Array.from({length:12},()=>word(0))],escrows:[empty().slice(0,2),empty().slice(0,2)],limitDirectory:empty().slice(0,8),counter:20n,operation:9n});
const fixture=(closed=false)=>{
  const slots=new Map<bigint,string>(),engineSlots=new Map<bigint,string>(),marketId=word(6),marketBase=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[marketId,1n]))),signer={};
  slots.set(6n,marketId);slots.set(11n,word(21));slots.set(12n,word(9));
  const setMarket=(i:number,v:string)=>slots.set(marketBase+BigInt(i),v);
  setMarket(2,word(BigInt(candidate.tokens[1][0])));setMarket(3,word(BigInt(candidate.tokens[0][0])));
  const math='0x2222222222222222222222222222222222222222',mathAbi=new Interface(['function core() view returns(address)']);
  setMarket(16,word(BigInt(math)));setMarket(17,keccak256('0x01'));for(let i=0;i<7;i++)setMarket(18+i,word(i+1));
  const base=currentPoolPositionStorageBase(marketBase,21n),claim=empty(),context=word(44),values=[200n,101n,closed?0n:50n,100n,0n,0n,0n,0n,0n,0n];claim[13]=context;
  for(let i=0;i<10;i++){claim[14+i*4+2]=word(i);claim[14+i*4+3]=word(values[i]);}for(let i=0;i<64;i++)slots.set(base+BigInt(i),claim[i]);
  const event=currentNativePoolSnapshotAbi.encodeEventLog(currentNativePoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[21n,context,currentPoolStoredEnvelopes(claim)]);
  const canonical={block,data:currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[21n]),logs:[{address:candidate.core,...event}]};
  let revoked=false,wrongOwner=false;
  const reader=createCurrentNativePoolSnapshotReader({signer,owner,candidate,guard:async()=>{if(revoked)throw Error('lease revoked');},attest:async()=>{},
    rpc:async(method,params)=>{if(method==='eth_getStorageAt')return (String(params[0]).toLowerCase()===candidate.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1].toLowerCase()?engineSlots:slots).get(BigInt(params[1] as string))??word(0);
      if(method==='eth_getCode')return '0x01';if(method==='eth_call')return mathAbi.encodeFunctionResult('core',[candidate.core]);throw Error(method);},
    readPublic:async(id)=>({status:id===19n?1n:closed?4n:1n,context}),readOwner:async()=>wrongOwner?math:owner,
    canonical:async()=>canonical,decrypt:v=>BigInt(v.ciphertextLow)});
  return{reader,signer,slots,engineSlots,base,marketBase,canonical,revoke:()=>{revoked=true;},wrongOwner:()=>{wrongOwner=true;}};
};
describe('native Pool compiled storage and signed producer',()=>{
  it('binds actual compiled layout and accepted native evidence source',()=>{
    const bytes=readFileSync('../ChainWhisper Contracts V2/validation/candidates/estimate-compatible-dex-2026-10-04/graph-build-4/snapshot/build-info/graph.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('0f49df36d325e946dfbbec002408e6b5ee1edc726f728623b86c9aa7678bfd0a');
    const compiled=JSON.parse(bytes.toString()).output.contracts['contracts/dex/ChainWhisperDexCore.sol'].ChainWhisperDexCore.storageLayout;
    const position=Object.values(compiled.types).find((v:unknown)=>(v as {label:string}).label==='struct ChainWhisperPoolOwner.Position') as {numberOfBytes:string;members:{label:string;slot:string}[]};
    expect(Number(position.numberOfBytes)/32).toBe(layout.positionWords);for(const [key,label]of [['context','snapshotContext'],['snapshot','snapshot'],['shares','shares'],['closeOwner','closeOwner']]as const)expect(BigInt(position.members.find(v=>v.label===label)!.slot)).toBe(BigInt(layout[key]));
    const nft=JSON.parse(bytes.toString()).output.contracts['contracts/dex/ChainWhisperDexPositionNFT.sol'].ChainWhisperDexPositionNFT.storageLayout.storage;
    expect(nft.find((v:{label:string})=>v.label==='_owners').slot).toBe('2');
    const acceptance=readFileSync('../ChainWhisper Contracts V2/validation/candidates/next-dex-pool-join-2026-10-05/ROOT_POOL_JOIN_CLOSE_ACCEPTANCE.json');
    expect(createHash('sha256').update(acceptance).digest('hex')).toBe('425a4eda035002242aef8194b5fdbeec73ccf0837a712cb2921ee05610668953');
  });
  it('uses actual reverse pair and rejects copied/reduced candidate identity',()=>{
    const market=empty();market[2]=word(BigInt(candidate.tokens[1][0]));market[3]=word(BigInt(candidate.tokens[0][0]));
    expect(currentPoolCanonicalTokenMap(candidate,market)).toEqual([1,0]);expect(()=>currentPoolCanonicalTokenMap({...candidate,core:owner},market)).toThrow();
    [market[2],market[3]]=[market[3],market[2]];expect(()=>currentPoolCanonicalTokenMap(candidate,market)).toThrow();
  });
  for(const closed of [false,true])it(`issues fresh ${closed?'closed':'active'} signed producer and rejects a copied brand`,async()=>{
    const f=fixture(closed),producer=await f.reader.issue(21n,'snapshot',hash);expect(producer.amounts).toMatchObject({amount0:200n,amount1:101n,shares:closed?0n:50n,classId:0n});
    await expect(f.reader.current(producer,block)).resolves.toBe(producer);await expect(f.reader.current({...producer},block)).rejects.toThrow('issued');
  });
  it('issues the internally produced new-claim fund snapshot only for its real selector and canonical creation event',async()=>{
    const f=fixture(),abi=new Interface(['function createPoolPosition(bytes32,bytes)']);
    f.canonical.data=abi.encodeFunctionData('createPoolPosition',[word(44),'0x00']);
    f.canonical.logs=[{address:candidate.core,...currentNativePoolSnapshotAbi.encodeEventLog(currentNativePoolSnapshotAbi.getEvent('SharedClaimCreated')!,[21n])}];
    const p=await f.reader.issue(21n,'fund',hash);expect(p.kind).toBe('fund');await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('Only a verified active');
    f.canonical.data='0x00000000';await expect(f.reader.issue(21n,'fund',hash)).rejects.toThrow('call');
  });
  for(const drift of ['anchor','total','claim','envelope','protected'])it(`rejects ${drift} drift despite same context`,async()=>{
    const f=fixture(),producer=await f.reader.issue(21n,'snapshot',hash);
    const slot=drift==='anchor'?currentPoolPositionStorageBase(f.marketBase,7n)+8n:drift==='total'?f.marketBase+38n:drift==='claim'?f.base+4n:drift==='envelope'?f.base+16n:currentPoolPositionStorageBase(f.marketBase,19n)+60n;
    f.slots.set(slot,word(999));await expect(f.reader.current(producer,block)).rejects.toThrow('stale');
  });
  it('wrong owner and revoked privacy lease do not issue authority',async()=>{
    const a=fixture();a.wrongOwner();await expect(a.reader.issue(21n,'snapshot',hash)).rejects.toThrow('owner');
    const b=fixture();b.revoke();await expect(b.reader.issue(21n,'snapshot',hash)).rejects.toThrow('lease');
  });
  it('permits replacement only for shared financial drift from a successful canonical producer',async()=>{
    const f=fixture(),p=await f.reader.issue(21n,'snapshot',hash);
    await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('only proved');
    f.slots.set(currentPoolPositionStorageBase(f.marketBase,7n)+8n,word(123));
    await expect(f.reader.proveSharedStale(p,block)).resolves.toBe(hash);
    f.slots.set(f.base+60n,word(999));await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('mismatch');
  });
  it('RPC outage or canonical mismatch never grants stale replacement eligibility',async()=>{
    const f=fixture(),p=await f.reader.issue(21n,'snapshot',hash);f.canonical.data='0x00';
    await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('canonical');
    const g=fixture(),q=await g.reader.issue(21n,'snapshot',hash);g.revoke();await expect(g.reader.proveSharedStale(q,block)).rejects.toThrow('lease');
  });
  for(const direction of [0,1])it(`permits source-bound Fast ledger drift in direction ${direction} but protects selected escrow/fixed fields/Engine`,async()=>{
    const f=fixture(),p=await f.reader.issue(21n,'snapshot',hash);
    const bases=candidate.tokens.map(([token])=>BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[token,22n]))));
    for(const index of [0,1,9,10])f.slots.set(bases[direction]+BigInt(index),word(123));
    for(const index of [6,7,9,10])f.slots.set(bases[1-direction]+BigInt(index),word(123));
    await expect(f.reader.proveSharedStale(p,block)).resolves.toBe(hash);
    for(const offset of [2,3,4,5,11]){f.slots.set(bases[0]+BigInt(offset),word(99));
      await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('mismatch');f.slots.delete(bases[0]+BigInt(offset));}
    const escrow=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[owner,bases[0]+8n])));
    f.slots.set(escrow,word(77));await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('mismatch');f.slots.delete(escrow);
    f.engineSlots.set(24n,word(1));await expect(f.reader.proveSharedStale(p,block)).rejects.toThrow('mismatch');
  });
  it('stale event/cached owner words and wrong system share correspondence fail closed',async()=>{
    const a=fixture(true);a.slots.set(a.base+24n,word(1));await expect(a.reader.issue(21n,'snapshot',hash)).rejects.toThrow('envelopes');
    const b=fixture(true);b.slots.set(b.base+60n,word(1));await expect(b.reader.issue(21n,'snapshot',hash)).rejects.toThrow('system');
  });
  it('unfunded cleanup accepts unrelated Fast storage but rejects selected custody, claims and unsupported Engine drift',()=>{
    const before=state(),after=structuredClone(before);(after as {operation:bigint}).operation=10n;(after.core as string[])[12]=word(10);
    (after.anchors[0] as string[])[8]=word(99);(after.ledgers[0] as string[])[6]=word(11);
    expect(()=>checkCurrentPoolUnfundedCleanupState(before,after)).not.toThrow();
    for(const target of [after.escrows[0],after.protectedClaim,after.claim,after.engine,after.ledgers[0]]){
      const i=target===after.ledgers[0]?4:0,prior=target[i];(target as string[])[i]=word(1);
      expect(()=>checkCurrentPoolUnfundedCleanupState(before,after)).toThrow();(target as string[])[i]=prior;}
  });
  it('only closed user envelope words may change; active signed Refresh may replace system snapshot words',()=>{
    const before=state(),after=structuredClone(before);(after.claim as string[])[16]=word(1);expect(()=>checkCurrentPoolSnapshotOnlyChange(before,after)).not.toThrow();
    (after.claim as string[])[14]=word(1);expect(()=>checkCurrentPoolSnapshotOnlyChange(before,after)).toThrow();expect(()=>checkCurrentPoolSnapshotOnlyChange(before,after,false)).not.toThrow();
    (after.ledgers[0]as string[])[9]=word(1);expect(()=>checkCurrentPoolSnapshotOnlyChange(before,after,false)).toThrow();
  });
  it('source-bound fund/close preserve static count, old claims and non-Pool ledger fields',()=>{
    const before=state(),after=structuredClone(before);(after as {counter:bigint}).counter=21n;for(const a of after.anchors)(a as string[])[4]=word(1);
    expect(()=>checkCurrentPoolFinancialTransition(before,after,'fund')).not.toThrow();
    (after.market as string[])[40]=word(1);expect(()=>checkCurrentPoolFinancialTransition(before,after,'fund')).toThrow();(after.market as string[])[40]=word(0);
    (after.ledgers[0]as string[])[6]=word(1);expect(()=>checkCurrentPoolFinancialTransition(before,after,'fund')).toThrow();
  });
});
