import { AbiCoder, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { PREPARED_POOL_LAYOUT, type PreparedPoolBlock } from './currentDexPreparedPoolSnapshot';

export const readCurrentDexOwnedPositionIds = async ({candidate,owner,block,rpc,assertCurrent}: {
  candidate:'cheap-exit'|'cheap-history'; owner:string; block:PreparedPoolBlock;
  rpc:(method:string,params:readonly unknown[])=>Promise<unknown>; assertCurrent:()=>void|Promise<void>;
}) => {
  if((candidate!=='cheap-exit'&&candidate!=='cheap-history')||!/^0x[0-9a-f]{40}$/i.test(owner)||BigInt(owner)===0n||typeof block.number!=='bigint'||block.number<0n||
    !/^0x[0-9a-f]{64}$/i.test(block.hash)||BigInt(block.hash)===0n)throw new Error('Invalid owner position read scope.');
  const prepared=resolvePreparedDexScope(candidate).candidate,nft=prepared.companions.find(([name])=>name==='ChainWhisperDexPositionNFT')![1];
  const mapping=(key:bigint|string,root:bigint,type='uint256')=>keccak256(AbiCoder.defaultAbiCoder().encode([type,'uint256'],[key,root]));
  const word=async(address:string,slot:string)=>{
    await assertCurrent();const value=await rpc('eth_getStorageAt',[address,slot,{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();
    if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw new Error('Owner position storage is unavailable.');
    return BigInt(value);
  };
  const [counter,balance]=await Promise.all([word(prepared.core,toBeHex(PREPARED_POOL_LAYOUT.counter)),word(nft,mapping(owner,3n,'address'))]);
  if(balance>counter)throw new Error('Owner NFT balance exceeds the allocated inventory.');
  // shortcut: the admitted layout covers 128 allocated IDs; extend only with a verified successor layout.
  if(counter<42n||counter>PREPARED_POOL_LAYOUT.maximumPositionId)return Object.freeze({positionIds:Object.freeze([] as bigint[]),complete:false,block,readyToSign:false as const});
  const positionIds:bigint[]=[];
  if(balance>0n)for(let first=1n;first<=counter;first+=8n){
    const ids=Array.from({length:Number(counter-first+1n<8n?counter-first+1n:8n)},(_,index)=>first+BigInt(index));
    const owners=await Promise.all(ids.map(id=>word(nft,mapping(id,PREPARED_POOL_LAYOUT.nftOwners))));
    owners.forEach((value,index)=>{
      if(value>=1n<<160n)throw new Error('Invalid position NFT owner word.');
      if(value===BigInt(owner))positionIds.push(ids[index]);
    });
  }
  if(BigInt(positionIds.length)!==balance)throw new Error('Owner position inventory is incomplete. Refresh positions.');
  await assertCurrent();return Object.freeze({positionIds:Object.freeze(positionIds),complete:true,block,readyToSign:false as const});
};
