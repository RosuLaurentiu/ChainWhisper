import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentDexOwnedLimits } from './currentDexOwnedLimits';
import { resolvePreparedDexScope } from './currentDexPreparedScope';

const owner=`0x${'22'.repeat(20)}`,hash=toBeHex(100n,32);
const slot=(key:bigint|string,root:bigint,type='uint256')=>keccak256(AbiCoder.defaultAbiCoder().encode([type,'uint256'],[key,root]));
function fixture(key:'cheap-exit'|'cheap-history'='cheap-exit'){
  const c=resolvePreparedDexScope(key).candidate,nft=c.companions.find(([name])=>name==='ChainWhisperDexPositionNFT')![1];
  const words=new Map<string,string>(),set=(host:string,index:string,value:bigint)=>words.set(`${host}:${index}`,toBeHex(value,32));
  set(c.core,toBeHex(11n),45n);set(nft,slot(owner,3n,'address'),3n);
  for(const id of [43n,44n,45n])set(nft,slot(id,2n),BigInt(owner));
  for(const [id,source,pair,status] of [[43n,24n,c.pairs[0],0n],[45n,25n,c.pairs[1],1n]]as const){
    set(c.core,slot(id,19n),source);set(c.core,slot(id,18n),BigInt(pair.marketId));set(pair.engine,slot(id,4n),source);
    const publicWords=[1n,id-43n,1n,id,source,1n,1n,40n,41n,1n,1n,1n];
    for(const [host,root]of [[c.core,20n],[pair.engine,9n]]as const)publicWords.forEach((v,i)=>set(host,toBeHex(BigInt(slot(source,root))+BigInt(i)),v));
    set(pair.engine,slot(source,2n),status);
  }
  const abi=new Interface(['function bindingCommitment() view returns(bytes32)']);
  const rpc=vi.fn(async(method:string,params:readonly unknown[])=>{
    expect(params[params.length-1]).toEqual({blockHash:hash,requireCanonical:true});
    if(method==='eth_call')return abi.encodeFunctionResult('bindingCommitment',[toBeHex(77n,32)]);
    expect(method).toBe('eth_getStorageAt');return words.get(`${params[0]}:${params[1]}`)??toBeHex(0n,32);
  }),assertCurrent=vi.fn();
  const read=()=>readCurrentDexOwnedLimits({candidate:key,owner,block:{number:10n,hash},rpc,assertCurrent});
  return{c,nft,words,set,rpc,assertCurrent,read};
}
describe('current owner Limit inventory',()=>{
  const closed=(f:ReturnType<typeof fixture>,id=46n,closeOwner=owner)=>{
    const source=id+10n,pair=f.c.pairs[2];f.set(f.c.core,toBeHex(11n),id);
    f.set(f.c.core,slot(id,19n),source);f.set(f.c.core,slot(id,18n),BigInt(pair.marketId));f.set(pair.engine,slot(id,4n),source);
    f.set(pair.engine,slot(id,0n),BigInt(closeOwner));
    [257n,0n,1n,id,source,1n,1n,70n,71n,1n,1n,2n].forEach((v,i)=>{for(const [host,root]of [[f.c.core,20n],[pair.engine,9n]]as const)f.set(host,toBeHex(BigInt(slot(source,root))+BigInt(i)),v);});
    return{pair,source,id};
  };
  it.each(['cheap-exit','cheap-history']as const)('restores burned %s orders across markets without local history or private amount reads',async key=>{
    const f=fixture(key),entry=closed(f),r=await f.read();expect(r.complete).toBe(true);
    expect(r.orders.map(x=>x.positionId)).toEqual([43n,45n,46n]);
    expect(r.orders[2]).toMatchObject({positionId:46n,closed:true,marketId:entry.pair.marketId,poolTokens:entry.pair.tokens,status:0n});
    expect(r.orders[0]).toMatchObject({closed:false});expect(Object.keys(r.orders[2])).not.toContain('amounts');
  });
  it('finds closed orders when the owner has no live NFTs and excludes another closing owner',async()=>{
    const f=fixture();f.set(f.nft,slot(owner,3n,'address'),0n);closed(f);closed(f,47n,`0x${'33'.repeat(20)}`);
    expect((await f.read()).orders.map(x=>x.positionId)).toEqual([46n]);
  });
  it.each(['burn','approval','flag','mapping']as const)('rejects a closed owner %s mismatch',async fault=>{
    const f=fixture(),{id,source,pair}=closed(f);
    if(fault==='burn')f.set(f.nft,slot(id,2n),1n);
    if(fault==='approval')f.set(f.nft,slot(id,4n),1n);
    if(fault==='flag')for(const [host,root]of [[f.c.core,20n],[pair.engine,9n]]as const)f.set(host,slot(source,root),1n);
    if(fault==='mapping')f.set(pair.engine,slot(id,4n),source+1n);
    await expect(f.read()).rejects.toThrow();
  });
  it('finds orders across markets and excludes Pool NFTs without decoding private amounts',async()=>{
    const f=fixture(),r=await f.read();expect(r.complete).toBe(true);expect(r.orders.map(x=>x.positionId)).toEqual([43n,45n]);
    expect(r.orders[0]).toMatchObject({marketId:f.c.pairs[0].marketId,poolTokens:f.c.pairs[0].tokens,status:0n});
    expect(r.orders[1]).toMatchObject({marketId:f.c.pairs[1].marketId,poolTokens:f.c.pairs[1].tokens,status:1n});
    expect(r.readyToSign).toBe(false);expect(Object.keys(r.orders[0])).not.toContain('amounts');
  });
  it('keeps an empty owner inventory distinct from an unsupported discovery bound',async()=>{
    const f=fixture();f.set(f.nft,slot(owner,3n,'address'),0n);expect(await f.read()).toMatchObject({orders:[],complete:true});
    f.set(f.c.core,toBeHex(11n),129n);expect(await f.read()).toMatchObject({orders:[],complete:false});
  });
  it.each(['market','mapping','authority','status','binding','owner','lease']as const)('rejects %s drift instead of showing empty orders',async fault=>{
    const f=fixture(),pair=f.c.pairs[0];
    if(fault==='market')f.set(f.c.core,slot(43n,18n),999n);
    if(fault==='mapping')f.set(pair.engine,slot(43n,4n),99n);
    if(fault==='authority')f.set(pair.engine,toBeHex(BigInt(slot(24n,9n))+3n),45n);
    if(fault==='status')f.set(pair.engine,slot(24n,2n),3n);
    if(fault==='binding'){const original=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(method,params)=>method==='eth_call'?'0x':original(method,params));}
    if(fault==='owner')f.set(f.nft,slot(43n,2n),0n);
    if(fault==='lease')f.assertCurrent.mockImplementation(()=>{throw Error('Revoked');});
    await expect(f.read()).rejects.toThrow();
  });
});
