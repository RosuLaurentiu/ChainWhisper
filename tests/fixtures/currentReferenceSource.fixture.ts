// Synthetic opaque storage only. No network or wallet state.
import { AbiCoder, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { CURRENT_DEX_REFERENCE_SOURCE_LAYOUT as l } from '../../src/lib/currentDexReferenceSourceLayout';
import type { CurrentReferenceIdentity } from '../../src/lib/currentDexReferenceSource';
const coder=AbiCoder.defaultAbiCoder(),id=(s:string)=>keccak256(toUtf8Bytes(s)),map=(slot:string|bigint,key:string,type:string)=>BigInt(keccak256(coder.encode([type,'uint256'],[key,slot])));
export function makeCurrentReferenceStorage(identity:CurrentReferenceIdentity,current:readonly unknown[]){
 const values=new Map<string,bigint>(),start=map(l.marketSlot,identity.market,'bytes32')+BigInt(l.poolSlot);
 const p:Record<string,string>={releaseId:identity.releaseId,marketId:identity.market,token0:identity.token0,token1:identity.token1};
 for(const [name,field]of Object.entries(l.poolFields))if(!(name in p))p[name]=field.kind==='address'?`0x${'55'.repeat(20)}`:id(name);
 const store=(definition:Readonly<Record<string,{slot:string;offset:number;bytes:number;kind:string}>>,base:bigint,data:Record<string,unknown>)=>{
  for(const [name,field]of Object.entries(definition)){
   const at=base+BigInt(field.slot),key=String(at),v=data[name];
   if(field.kind==='ciphertext'){const pair=v as string[];values.set(key,BigInt(pair[0]));values.set(String(at+1n),BigInt(pair[1]));}
   else values.set(key,(values.get(key)??0n)|(BigInt(v===true?1:v===false?0:String(v))<<BigInt(field.offset*8)));
  }
 };
 store(l.poolFields,start,p);
 let commitment=keccak256(coder.encode(['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','bytes32','bytes32','address','bytes32','address','bytes32','bytes32','address','bytes32'],
  [current[0],current[1],identity.chainId,identity.source,identity.sourceRuntimeHash,p.releaseId,p.marketId,identity.canonicalId,current[9],current[10],p.token0,p.token1,identity.decimals0,identity.decimals1,p.token0Runtime,p.token1Runtime,p.nft,p.nftRuntime,p.terms,p.termsRuntime,p.termsBinding,p.sharedMath,p.sharedMathRuntime]));
 const anchorBases:bigint[]=[];
 for(let i=0;i<7;i++){
  const n=String(i+1),base=map(start+BigInt(l.positionsSlot),n,'uint256'),a=Object.fromEntries(Object.entries(l.anchorFields).map(([name,field])=>[name,field.kind==='ciphertext'?[id(`${i}-${name}-high`),id(`${i}-${name}-low`)]:field.kind==='bool'?true:'1']));
  anchorBases.push(base);values.set(String(start+BigInt(l.anchorsSlot)+BigInt(i)),BigInt(n));store(l.anchorFields,base,a);
  commitment=keccak256(coder.encode(['bytes32','uint256','uint256','uint8','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint8','bool','uint8','(uint256,uint256)','(uint256,uint256)'],[commitment,i,n,a.status,a.sourceId,a.bucket0Id,a.bucket1Id,a.positionRevision,a.ownershipRevision,a.lifecycleRevision,a.termsRevision,a.mode,a.sharedClaim,a.sharedClassId,a.inventory0,a.inventory1]));
 }
 const observationStart=map(id('chainwhisper.dex.pool-reference.storage.v1'),identity.market,'bytes32');
 [current[15],current[16],current[17],current[18],commitment].forEach((v,i)=>values.set(String(observationStart+BigInt(i)),BigInt(String(v))));
 const rpc=async(method:string,params:unknown[])=>{
  if(method!=='eth_getProof')throw Error(`Unexpected source read ${method}`);
  return{address:identity.source,codeHash:identity.sourceRuntimeHash,storageProof:(params[1] as string[]).map(key=>({key,value:`0x${(values.get(String(BigInt(key)))??0n).toString(16)}`}))};
 };
 return{values,commitment,rpc,observationStart,anchorBases};
}
