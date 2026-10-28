import { toBeHex } from '@coti-io/coti-ethers';
import { readCurrentDexOwnedPositionIds } from './currentDexOwnedPositions';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { PREPARED_POOL_LAYOUT } from './currentDexPreparedPoolSnapshot';
import { CURRENT_LIMIT_LAYOUT as layout, CURRENT_LIMIT_OWNER_LAYOUT as ownerLayout, CURRENT_LIMIT_MARKET_FOR_POSITION, currentLimitBindingAbi,
  currentLimitContext, currentLimitMappingSlot as slot } from './currentDexLimit';

export type CurrentOwnedLimit=Readonly<{positionId:bigint;marketId:string;poolTokens:readonly[string,string];status:bigint;closed:boolean;context:string}>;
/** Public identity only. The capability must attest the registry and recheck the canonical block. */
export const readCurrentDexOwnedLimits=async (args:Parameters<typeof readCurrentDexOwnedPositionIds>[0])=>{
  const {candidate,owner,block,rpc,assertCurrent}=args,c=resolvePreparedDexScope(candidate).candidate;
  const inventory=await readCurrentDexOwnedPositionIds(args),orders:CurrentOwnedLimit[]=[];
  const word=async(host:string,index:bigint)=>{
    await assertCurrent();const raw=await rpc('eth_getStorageAt',[host,toBeHex(index),{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();
    if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw))throw new Error('Limit inventory storage is unavailable.');return BigInt(raw);
  };
  if(!inventory.complete)return Object.freeze({orders:Object.freeze(orders),complete:false,block,readyToSign:false as const});
  const nft=c.companions.find(([name])=>name==='ChainWhisperDexPositionNFT')![1];
  const counter=await word(c.core,PREPARED_POOL_LAYOUT.counter);
  if(counter<42n||counter>PREPARED_POOL_LAYOUT.maximumPositionId)throw new Error('Limit inventory allocation bound changed.');
  const read=async(positionId:bigint,closed:boolean)=>{
    const source=await word(c.core,slot(positionId,layout.coreMapping));
    if(source===0n)return;
    const market=await word(c.core,slot(positionId,CURRENT_LIMIT_MARKET_FOR_POSITION)),pair=c.pairs.find(p=>BigInt(p.marketId)===market);
    if(!pair)throw new Error('Owned Limit market is unsupported.');
    if(closed){
      const closeOwner=await word(pair.engine,slot(positionId,ownerLayout.engineCloseOwner));
      if(closeOwner!==BigInt(owner))return;
      const [nftOwner,approval]=await Promise.all([word(nft,slot(positionId,ownerLayout.nftOwners)),word(nft,slot(positionId,ownerLayout.nftApprovals))]);
      if(nftOwner!==0n||approval!==0n)throw new Error('Closed Limit NFT burn or approval changed.');
    }
    const [mapped,status,core,engine]=await Promise.all([word(pair.engine,slot(positionId,layout.engineMapping)),word(pair.engine,slot(source,layout.engineStatus)),
      Promise.all(Array.from({length:12},(_,i)=>word(c.core,slot(source,layout.coreSources)+BigInt(i)))),
      Promise.all(Array.from({length:12},(_,i)=>word(pair.engine,slot(source,layout.engineSources)+BigInt(i))))]);
    if(positionId<8n||mapped!==source||status>2n||core.some((v,i)=>v!==engine[i])||core[0]!==(closed?257n:1n)||core[3]!==positionId||core[4]!==source||
      core.slice(2,12).some(v=>v===0n)||core[7]===core[8])throw new Error('Owned Limit source or status changed.');
    await assertCurrent();const raw=await rpc('eth_call',[{from:owner,to:pair.engine,data:currentLimitBindingAbi.encodeFunctionData('bindingCommitment',[])},{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();
    if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw)||BigInt(raw)===0n)throw new Error('Limit inventory binding is unavailable.');
    const context=currentLimitContext(pair.engine,raw,positionId,source,owner,{terms:core[9],ownership:core[10],lifecycle:core[11],closed},c);
    orders.push(Object.freeze({positionId,marketId:pair.marketId,poolTokens:pair.tokens,status,closed,context}));
  };
  for(const id of inventory.positionIds)await read(id,false);
  // Burned orders retain an immutable closing owner; reuse the admitted 128-ID bound.
  for(let first=8n;first<=counter;first+=8n){
    const ids=Array.from({length:Number(counter-first+1n<8n?counter-first+1n:8n)},(_,i)=>first+BigInt(i));
    await Promise.all(ids.filter(id=>!inventory.positionIds.includes(id)).map(id=>read(id,true)));
  }
  orders.sort((a,b)=>a.positionId<b.positionId?-1:a.positionId>b.positionId?1:0);
  await assertCurrent();return Object.freeze({orders:Object.freeze(orders),complete:inventory.complete,block,readyToSign:false as const});
};
