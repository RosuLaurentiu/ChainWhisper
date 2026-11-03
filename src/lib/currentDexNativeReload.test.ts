import { describe, expect, it } from 'vitest';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload, CURRENT_DEX_NATIVE_RELOAD_KEY, CURRENT_DEX_NORMAL_USE_RELOAD_KEY, currentDexNormalUseReloadKey, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';

describe('owner App reload storage', () => {
  it('keeps normal-use records separate from the retained trial record', () => {
    const values = new Map<string,string>(), storage = {getItem:(key:string)=>values.get(key)??null,
      setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    const budget = {version:2 as const,owner:`0x${'d'.repeat(40)}`,candidateGraph:'e'.repeat(64),
      start:'2000000000',activeSwap:null,committedWei:'0',charges:[]};
    const normal = {budget,authentication:`0x${'c'.repeat(64)}`};
    const legacy = {...normal,budget:{...budget,version:1 as const}};
    writeCurrentDexNativeReload(storage,legacy);
    const retained = values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    writeCurrentDexNativeReload(storage,normal);
    expect(readCurrentDexNativeReload(storage,true)).toEqual(normal);
    expect(values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(retained);
    expect(readCurrentDexNativeReload(storage)).toEqual(legacy);
  });
  it('scopes normal records by wallet, chain and graph while retaining foreign closed evidence',()=>{
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:()=>{}};
    const scope={owner:`0x${'dd'.repeat(20)}`,graph:'e'.repeat(64),chainId:7082400n},other={...scope,owner:`0x${'cc'.repeat(20)}`};
    const record=(owner:string):CurrentDexNativeReloadRecord=>({authentication:`0x${'a'.repeat(64)}`,budget:{version:2,owner,candidateGraph:scope.graph,start:'2000000000',activeSwap:null,committedWei:'0',charges:[]}});
    writeCurrentDexNativeReload(storage,record(other.owner));
    const retained=values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    expect(readCurrentDexNativeReload(storage,scope)).toBeNull();
    writeCurrentDexNativeReload(storage,record(scope.owner),scope);
    writeCurrentDexNativeReload(storage,record(other.owner),other);
    expect(currentDexNormalUseReloadKey(scope)).not.toBe(currentDexNormalUseReloadKey(other));
    expect(readCurrentDexNativeReload(storage,scope)?.budget.owner).toBe(scope.owner);
    expect(readCurrentDexNativeReload(storage,other)?.budget.owner).toBe(other.owner);
    expect(values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(retained);
    expect(()=>currentDexNormalUseReloadKey({...scope,chainId:1n})).toThrow();
    values.set(currentDexNormalUseReloadKey(scope),'{malformed');
    expect(()=>writeCurrentDexNativeReload(storage,record(scope.owner),scope)).toThrow('invalid');
    expect(values.get(currentDexNormalUseReloadKey(scope))).toBe('{malformed');
  });
  it.each(['malformed','unknown','active','foreign-unknown','foreign-active'] as const)('does not turn retained %s records into a clean wallet session',fault=>{
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:()=>{}};
    const scope={owner:`0x${'dd'.repeat(20)}`,graph:'e'.repeat(64),chainId:7082400n},quote=`quote:0x${'b'.repeat(64)}`;
    const record={authentication:`0x${'a'.repeat(64)}`,budget:{version:2 as const,owner:fault.startsWith('foreign')?`0x${'cc'.repeat(20)}`:scope.owner,candidateGraph:scope.graph,start:'2000000000',activeSwap:quote,committedWei:'5500000000000000',charges:[{phase:'quote' as const,scope:quote,key:quote,gasCap:'110000000',gasPrice:'50000000',nonce:0,hash:fault.includes('unknown')?null:`0x${'a'.repeat(64)}`} ]}};
    const bytes=fault==='malformed'?'{bad':JSON.stringify(record);values.set(CURRENT_DEX_NORMAL_USE_RELOAD_KEY,bytes);
    if(fault.startsWith('foreign')||fault==='malformed')expect(()=>readCurrentDexNativeReload(storage,scope)).toThrow();
    else expect(readCurrentDexNativeReload(storage,scope)?.budget.activeSwap).toBe(quote);
    expect(values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(bytes);
    expect(values.has(currentDexNormalUseReloadKey(scope))).toBe(false);
  });
  it('retains records beyond the old trial envelope and preserves them on storage failure', () => {
    const values=new Map<string,string>(), storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    const scope=`quote:0x${'a'.repeat(64)}`;
    // Longest charge representation; financial scope validation remains in the native policy.
    const charges=Array.from({length:240},(_,i)=>({phase:'token-funding' as const,scope,
      key:`token-funding:${scope}:0x${i.toString(16).padStart(64,'f')}`,gasCap:'5000000',gasPrice:'50000000',nonce:220+i,hash:`0x${'b'.repeat(64)}`}));
    const record:CurrentDexNativeReloadRecord={authentication:`0x${'c'.repeat(64)}`,budget:{version:1,owner:`0x${'d'.repeat(40)}`,candidateGraph:'e'.repeat(64),
      start:'1792198683',windowStart:'1792441436',activeSwap:scope,committedWei:'550000000000000000',charges}};
    expect(JSON.stringify(record).length).toBeGreaterThan(65536);
    writeCurrentDexNativeReload(storage,record);
    expect(readCurrentDexNativeReload(storage)).toEqual(record);
    const saved=values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    expect(()=>writeCurrentDexNativeReload({...storage,setItem:()=>{throw new Error('QuotaExceededError');}},record)).toThrow('could not be saved');
    expect(values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(saved);
    values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify({...record,authentication:'invalid'}));
    expect(()=>readCurrentDexNativeReload(storage)).toThrow('invalid');
    expect(values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toContain('invalid');
  });
});
