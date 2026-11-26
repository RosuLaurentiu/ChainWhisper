import {describe,it,expect} from 'vitest';
import {reserveCurrentDexPendingAttempt,readCurrentDexPendingAttempt,blockCurrentPoolVerification,blockCurrentLimitVerification,blockCurrentTokenFundingVerification,recordCurrentDexPendingHash,type CurrentDexPendingAttempt} from './currentDexPendingAttempt';
import { CURRENT_DEX_OPERATION_LOOKUPS_KEY, recordCurrentDexOperationLookup, readCurrentDexOperationLookups,
  blockCurrentDexOperationVerification, clearCurrentDexOperationLookup, type CurrentDexOperationLookup } from './currentDexPendingAttempt';
import { CURRENT_DEX_NATIVE_RELOAD_KEY, readCurrentDexNativeReload, writeCurrentDexNativeReload, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, advanceCurrentPoolTopUpAttempt } from './currentDexPendingAttempt';
import { CURRENT_POOL_REFRESH_ATTEMPT_KEY, currentPoolRefreshStorage, clearCurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { currentDexOwnerRecovery } from './currentDexPendingAttempt';

describe('owner recovery routing',()=>{
  const saved:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:`0x${'11'.repeat(20)}`,core:`0x${'22'.repeat(20)}`,graph:`0x${'33'.repeat(32)}`,phase:'pool-snapshot',nonce:4,txHash:null,callHash:`0x${'44'.repeat(32)}`};
  it.each(['pool-owner','pool-transfer','pool-snapshot','pool-preview','pool-fund','limit-create','limit-snapshot','limit-owner'] as const)('selects the existing view for %s without requiring or clearing a hash',phase=>{
    const attempt={...saved,phase};
    const route=currentDexOwnerRecovery(attempt,saved)!;
    expect(route.view).toBe(phase.startsWith('limit-')?'activity':['pool-preview','pool-fund'].includes(phase)?'liquidity':'positions');
    // CW-140.02: plain wording; every route still states that nothing is resent.
    expect(route.message).toMatch(/needs your attention\..*Nothing is resent\.$/);expect(attempt.txHash).toBeNull();
  });
  it('uses the existing funding marker for top-ups and offers both origins for an unmarked preview',()=>{
    expect(currentDexOwnerRecovery({...saved,phase:'pool-fund',poolTopUpHash:null},saved)?.view).toBe('positions');
    expect(currentDexOwnerRecovery({...saved,phase:'pool-preview'},saved)).toMatchObject({view:'liquidity',alternateView:'positions'});
  });
  it.each(['owner','chainId','core','graph'] as const)('rejects a different %s before routing',field=>{
    expect(()=>currentDexOwnerRecovery(saved,{...saved,[field]:'changed'})).toThrow('another wallet, network or contract');
  });
  it.each(['quote','accept','cancel','recover','token-faucet','token-refill','token-approve'] as const)('does not reinterpret %s as a Pool or Limit action',phase=>{
    expect(currentDexOwnerRecovery({...saved,phase},saved)).toBeNull();
  });
});

describe('independent snapshot storage',()=>{
  const held:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:`0x${'11'.repeat(20)}`,core:`0x${'22'.repeat(20)}`,graph:`0x${'33'.repeat(32)}`,phase:'pool-snapshot',nonce:394,txHash:`0x${'44'.repeat(32)}`,callHash:`0x${'55'.repeat(32)}`,verificationBlocked:true};
  const fixture=()=>{const saved=JSON.stringify(held),values=new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY,saved]]),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
    return {saved,values,storage,slot:currentPoolRefreshStorage(storage,held,held.callHash)};};
  it('binds a different-position refresh through reload and preserves the original record',()=>{
    const f=fixture(),callHash=`0x${'77'.repeat(32)}`,next={...held,callHash,nonce:395,txHash:null};
    const slot=currentPoolRefreshStorage(f.storage,held,callHash);
    reserveCurrentDexPendingAttempt(slot,next);
    recordCurrentDexPendingHash(slot,next,`0x${'66'.repeat(32)}`);
    const reloaded=currentPoolRefreshStorage(f.storage,held),pending=readCurrentDexPendingAttempt(reloaded)!;
    expect(pending.callHash).toBe(callHash);expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(f.saved);
    const refresh=f.values.get(CURRENT_POOL_REFRESH_ATTEMPT_KEY)!;
    expect(()=>readCurrentDexPendingAttempt(currentPoolRefreshStorage(f.storage,held,held.callHash))).toThrow();
    expect(()=>reserveCurrentDexPendingAttempt(slot,{...next,callHash:held.callHash})).toThrow();
    f.values.set(CURRENT_POOL_REFRESH_ATTEMPT_KEY,JSON.stringify({original:f.saved,attempt:JSON.stringify({...pending,callHash:held.callHash})}));
    expect(()=>readCurrentDexPendingAttempt(reloaded)).toThrow();
    f.values.set(CURRENT_POOL_REFRESH_ATTEMPT_KEY,refresh);
    clearCurrentDexPendingAttempt(reloaded,pending);
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(f.saved);expect(f.values.has(CURRENT_POOL_REFRESH_ATTEMPT_KEY)).toBe(false);
  });
  it('retains original bytes through reservation, reload, proof failure and completion of the new slot',()=>{
    const f=fixture(),next={...held,verificationBlocked:undefined,nonce:395,txHash:null};delete next.verificationBlocked;
    reserveCurrentDexPendingAttempt(f.slot,next);recordCurrentDexPendingHash(f.slot,next,`0x${'66'.repeat(32)}`);
    const reloaded=currentPoolRefreshStorage(f.storage,held),pending=readCurrentDexPendingAttempt(reloaded)!;
    expect(pending.nonce).toBe(395);expect(readCurrentDexPendingAttempt(f.storage)).toEqual(held);
    blockCurrentPoolVerification(reloaded,pending,new Error('private test value must not persist'));
    expect(f.values.get(CURRENT_POOL_REFRESH_ATTEMPT_KEY)).not.toContain('private test value');
    expect(readCurrentDexPendingAttempt(reloaded)?.verificationBlocked).toBe(true);
    clearCurrentDexPendingAttempt(reloaded,readCurrentDexPendingAttempt(reloaded)!);
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(f.saved);expect(f.values.has(CURRENT_POOL_REFRESH_ATTEMPT_KEY)).toBe(false);
  });
  it.each(['nonce','callHash','owner','phase','topup','corrupt','anchor','missing-original'] as const)('stops on invalid %s without deleting records',fault=>{
    const f=fixture(),next={...held,nonce:395,txHash:null};
    if(fault==='corrupt')f.values.set(CURRENT_POOL_REFRESH_ATTEMPT_KEY,'{bad');
    else if(fault==='anchor'){reserveCurrentDexPendingAttempt(f.slot,next);f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,f.saved+' ');}
    else if(fault==='missing-original'){reserveCurrentDexPendingAttempt(f.slot,next);f.values.delete(CURRENT_DEX_PENDING_ATTEMPT_KEY);}
    else {if(fault==='nonce')next.nonce=394;if(fault==='callHash')next.callHash=`0x${'77'.repeat(32)}`;if(fault==='owner')next.owner=held.core;
      if(fault==='phase')next.phase='pool-owner';if(fault==='topup')Object.assign(next,{poolTopUpHash:held.txHash});}
    const before=[...f.values];
    expect(()=>fault==='missing-original'?readCurrentDexPendingAttempt(f.storage):fault==='corrupt'||fault==='anchor'?readCurrentDexPendingAttempt(f.slot):reserveCurrentDexPendingAttempt(f.slot,next)).toThrow();
    expect([...f.values]).toEqual(before);
  });
});

describe('durable top-up handoff',()=>{
  it.each(['none','blocked','other-owner','stale-nonce','wrong-hash','plain-snapshot','storage'] as const)('advances only the exact funding record: %s',fault=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:()=>{throw new Error('Must not clear between phases');}};
    const funding:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:`0x${'11'.repeat(20)}`,core:`0x${'22'.repeat(20)}`,graph:`0x${'33'.repeat(32)}`,phase:'pool-fund',nonce:394,txHash:`0x${'44'.repeat(32)}`,callHash:`0x${'55'.repeat(32)}`,poolTopUpHash:null};
    if(fault==='blocked')Object.assign(funding,{verificationBlocked:true});
    if(fault==='plain-snapshot'){Object.assign(funding,{phase:'pool-snapshot'});delete (funding as {poolTopUpHash?:string|null}).poolTopUpHash;}
    reserveCurrentDexPendingAttempt(storage,funding);const saved=values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    const snapshot={...funding,phase:'pool-snapshot' as const,nonce:395,txHash:null,callHash:`0x${'66'.repeat(32)}`,poolTopUpHash:funding.txHash!};
    if(fault==='other-owner')snapshot.owner=`0x${'77'.repeat(20)}`;
    if(fault==='stale-nonce')snapshot.nonce=394;
    if(fault==='wrong-hash')snapshot.poolTopUpHash=`0x${'88'.repeat(32)}`;
    if(fault==='storage')storage.setItem=()=>{throw new Error('Storage unavailable');};
    if(fault==='none'){
      advanceCurrentPoolTopUpAttempt(storage,funding,snapshot);expect(readCurrentDexPendingAttempt(storage)).toEqual(snapshot);
      recordCurrentDexPendingHash(storage,snapshot,`0x${'99'.repeat(32)}`);expect(readCurrentDexPendingAttempt(storage)?.poolTopUpHash).toBe(funding.txHash);
    }else{expect(()=>advanceCurrentPoolTopUpAttempt(storage,funding,snapshot)).toThrow();expect(values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);}
  });
  it.each([{phase:'pool-snapshot',poolTopUpHash:null},{phase:'quote',poolTopUpHash:`0x${'44'.repeat(32)}`},{phase:'pool-fund',poolTopUpHash:'secret'}])('rejects malformed phase markers without changing storage',bad=>{
    const raw=JSON.stringify({version:1,chainId:'7082400',owner:`0x${'11'.repeat(20)}`,core:`0x${'22'.repeat(20)}`,graph:`0x${'33'.repeat(32)}`,nonce:394,txHash:null,callHash:`0x${'55'.repeat(32)}`,...bad});
    const storage={getItem:()=>raw,setItem:()=>{throw new Error('Unexpected write');},removeItem:()=>{throw new Error('Unexpected clear');}};
    expect(()=>readCurrentDexPendingAttempt(storage)).toThrow('invalid');expect(storage.getItem()).toBe(raw);
  });
});
describe('native reload reservation storage boundary',()=>{
  it('keeps malformed records and fails when the pre-signing reservation cannot persist',()=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
    values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    expect(()=>readCurrentDexNativeReload(storage)).toThrow('invalid');expect(values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe('{bad');
    const record={budget:{},authentication:`0x${'11'.repeat(32)}`} as CurrentDexNativeReloadRecord;
    expect(()=>writeCurrentDexNativeReload({...storage,setItem:()=>{throw new Error('private external text');}},record)).toThrow('Native reload reservation could not be saved.');
    expect(values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe('{bad');
    expect(()=>writeCurrentDexNativeReload({...storage,setItem:()=>{}},record)).toThrow('invalid');
    expect(()=>readCurrentDexNativeReload({...storage,getItem:()=>{throw new Error('private external text');}})).toThrow('Native reload storage is unavailable.');
  });
});
describe('current Pool known verification holds',()=>{
  it.each(['limit-create','limit-snapshot','limit-owner'] as const)('%s retains a known proof failure without accepting another phase',phase=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
    const pending:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:'0x'+'11'.repeat(20),core:'0x'+'22'.repeat(20),graph:'0x'+'33'.repeat(32),phase,callHash:'0x'+'44'.repeat(32),nonce:7,txHash:'0x'+'55'.repeat(32)};
    reserveCurrentDexPendingAttempt(storage,pending);
    expect(()=>blockCurrentLimitVerification(storage,{...pending,phase:'pool-owner'})).toThrow('changed');
    blockCurrentLimitVerification(storage,pending);
    expect(readCurrentDexPendingAttempt(storage)).toEqual({...pending,verificationBlocked:true});
  });
  it('preserves legacy records and binds optional funding target through hash and failure updates',()=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>{values.delete(k);}};
    const p:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:'0x'+'11'.repeat(20),core:'0x'+'22'.repeat(20),graph:'0x'+'33'.repeat(32),phase:'token-faucet',callHash:'0x'+'44'.repeat(32),nonce:7,txHash:null,target:'0x'+'66'.repeat(20)};
    reserveCurrentDexPendingAttempt(storage,p);
    expect(()=>recordCurrentDexPendingHash(storage,{...p,target:'0x'+'77'.repeat(20)},'0x'+'55'.repeat(32))).toThrow('changed');
    recordCurrentDexPendingHash(storage,p,'0x'+'55'.repeat(32));
    const hashed=readCurrentDexPendingAttempt(storage)!;blockCurrentTokenFundingVerification(storage,hashed);
    expect(readCurrentDexPendingAttempt(storage)).toEqual({...p,txHash:'0x'+'55'.repeat(32),verificationBlocked:true});
  });
  it.each(['snapshot-financial-state', 'pool-proof', undefined] as const)('preserves the first safe verification reason %s',reason=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
    const p:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:'0x'+'11'.repeat(20),core:'0x'+'22'.repeat(20),graph:'0x'+'33'.repeat(32),phase:'pool-snapshot',callHash:'0x'+'44'.repeat(32),nonce:7,txHash:'0x'+'55'.repeat(32)};
    reserveCurrentDexPendingAttempt(storage,p);
    blockCurrentPoolVerification(storage,p,reason==='snapshot-financial-state'?new Error('Prepared snapshot changed financial state.'):reason==='pool-proof'?new Error('private SDK content 123'):undefined);
    const held=readCurrentDexPendingAttempt(storage)!;expect(held.verificationFailure).toBe(reason);
    const saved=[...values.values()][0];expect(saved).not.toContain('private SDK');
    blockCurrentPoolVerification(storage,held,new Error('Prepared snapshot changed wallet balances/allowances.'));
    expect([...values.values()][0]).toBe(saved);
    for(const invalid of [{...held,verificationFailure:'private secret'},{...held,verificationBlocked:false,verificationFailure:'pool-proof'},{...held,phase:'quote',verificationFailure:'pool-proof'}]){
      const entry=[...values.keys()][0];values.set(entry,JSON.stringify(invalid));
      expect(()=>readCurrentDexPendingAttempt(storage)).toThrow('invalid');expect(values.get(entry)).toBe(JSON.stringify(invalid));
    }
  });
  it.each(['pool-owner','pool-snapshot'] as const)('%s stays valid public manual metadata after a proved mismatch',phase=>{
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
    const pending:CurrentDexPendingAttempt={version:1,chainId:'7082400',owner:'0x'+'11'.repeat(20),core:'0x'+'22'.repeat(20),graph:'0x'+'33'.repeat(32),phase,callHash:'0x'+'44'.repeat(32),nonce:7,txHash:'0x'+'55'.repeat(32)};
    reserveCurrentDexPendingAttempt(storage,pending);blockCurrentPoolVerification(storage,pending);
    expect(readCurrentDexPendingAttempt(storage)).toEqual({...pending,verificationBlocked:true});expect(values.size).toBe(1);
  });
});
describe('public async operation lookup storage', () => {
  const fixture = () => {
    const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const entry: CurrentDexOperationLookup = { attempt: { version: 1, chainId: '7082400', owner: `0x${'11'.repeat(20)}`,
      core: `0x${'22'.repeat(20)}`, graph: `0x${'33'.repeat(32)}`, phase: 'accept', callHash: `0x${'44'.repeat(32)}`,
      nonce: 7, txHash: `0x${'55'.repeat(32)}` }, operationId: '7', contextHash: `0x${'66'.repeat(32)}`, deadline: '200',
      origin: { number: 10, hash: `0x${'77'.repeat(32)}` } };
    return { values, storage, entry };
  };
  it('keeps public tracking separate from a new pending sender and preserves the private hold', () => {
    const f = fixture(); recordCurrentDexOperationLookup(f.storage, f.entry);
    reserveCurrentDexPendingAttempt(f.storage, { ...f.entry.attempt, phase: 'quote', txHash: null });
    blockCurrentDexOperationVerification(f.storage, f.entry);
    const blocked = readCurrentDexOperationLookups(f.storage)[0];
    expect(blocked.attempt.verificationBlocked).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)?.phase).toBe('quote');
    expect(() => recordCurrentDexOperationLookup(f.storage, f.entry)).toThrow('changed');
    expect(() => clearCurrentDexOperationLookup(f.storage, f.entry)).toThrow('changed');
    clearCurrentDexOperationLookup(f.storage, blocked);
    expect(readCurrentDexPendingAttempt(f.storage)?.phase).toBe('quote');
  });
  it('never evicts unresolved operations at the storage bound', () => {
    const f = fixture();
    for (let i = 1; i <= 32; i++) recordCurrentDexOperationLookup(f.storage, { ...f.entry,
      attempt: { ...f.entry.attempt, txHash: `0x${i.toString(16).padStart(64, '0')}` } });
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    expect(() => recordCurrentDexOperationLookup(f.storage, f.entry)).toThrow('limit reached');
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved);
  });
  it.each(['malformed', 'private-field', 'bad-origin'] as const)('retains %s metadata and refuses it', fault => {
    const f = fixture();
    f.storage.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, fault === 'malformed' ? '{bad' : JSON.stringify([
      fault === 'private-field' ? { ...f.entry, maximumInput: '20' } : { ...f.entry, origin: { number: -1, hash: f.entry.origin.hash } }
    ]));
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    expect(() => readCurrentDexOperationLookups(f.storage)).toThrow('invalid');
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved);
  });
});
