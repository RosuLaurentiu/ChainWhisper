import { describe, expect, it } from 'vitest';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload, CURRENT_DEX_NATIVE_RELOAD_KEY, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';

describe('owner App reload storage', () => {
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
