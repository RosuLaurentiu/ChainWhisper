import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { toBeHex } from '@coti-io/coti-ethers';
import { CURRENT_NATIVE_POOL_LAYOUT as layout,
  checkCurrentPoolFinancialTransition,checkCurrentPoolSnapshotOnlyChange,checkCurrentPoolUnfundedCleanupState,type CurrentPoolStoredState } from './currentDexNativePoolSnapshot';
const word=(v:bigint|number)=>toBeHex(v,32),owner='0x1111111111111111111111111111111111111111';
const empty=()=>Array.from({length:64},()=>word(0));
const state=():CurrentPoolStoredState=>({market:Array.from({length:71},()=>word(0)),anchors:Array.from({length:7},empty),
  protectedClaim:empty(),protectedOwner:owner,protectedStatus:1n,existingClaims:{19:empty()},claim:empty(),core:Array.from({length:50},()=>word(0)),engine:Array.from({length:46},()=>word(0)),
  ledgers:[Array.from({length:12},()=>word(0)),Array.from({length:12},()=>word(0))],escrows:[empty().slice(0,2),empty().slice(0,2)],limitDirectory:empty().slice(0,8),counter:20n,operation:9n});
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
