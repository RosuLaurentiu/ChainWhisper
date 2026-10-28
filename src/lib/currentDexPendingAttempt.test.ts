import {describe,it,expect} from 'vitest';
import {reserveCurrentDexPendingAttempt,readCurrentDexPendingAttempt,blockCurrentPoolVerification,blockCurrentLimitVerification,blockCurrentTokenFundingVerification,recordCurrentDexPendingHash,type CurrentDexPendingAttempt} from './currentDexPendingAttempt';
import { CURRENT_DEX_OPERATION_LOOKUPS_KEY, recordCurrentDexOperationLookup, readCurrentDexOperationLookups,
  blockCurrentDexOperationVerification, clearCurrentDexOperationLookup, type CurrentDexOperationLookup } from './currentDexPendingAttempt';
import { CURRENT_DEX_NATIVE_RELOAD_KEY, readCurrentDexNativeReload, writeCurrentDexNativeReload, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';
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
