import { AbiCoder, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { CURRENT_DEX_REFERENCE_SOURCE_LAYOUT as layout, hasCurrentReferenceSourceLayout } from './currentDexReferenceSourceLayout';

type Field = Readonly<{ slot: string; offset: number; bytes: number; kind: string }>;
type Value = string | boolean | readonly string[];
export type CurrentReferenceIdentity = Readonly<{sourceGraph:string;chainId:string;source:string;sourceRuntimeHash:string;releaseId:string;market:string;canonicalId:string;token0:string;token1:string;decimals0:number;decimals1:number}>;
export type StoredCurrentReference = Readonly<{priceE18:string;sampledAt:string;sampledBlock:string;revision:string;sourceState:string}>;
const coder=AbiCoder.defaultAbiCoder(),same=(a:unknown,b:unknown)=>String(a).toLowerCase()===String(b).toLowerCase();
const hex=(n:bigint)=>`0x${n.toString(16)}`;
const map=(slot:string|bigint,key:string,type:string)=>BigInt(keccak256(coder.encode([type,'uint256'],[key,slot])));
const reject=():never=>{throw Error('Current reference source storage does not match.');};
const slots=(fields:Readonly<Record<string,Field>>,start:bigint)=>Object.values(fields).flatMap(field=>Array.from({length:Math.ceil(field.bytes/32)},(_,i)=>start+BigInt(field.slot)+BigInt(i)));

// Same RPC trust as the existing pinned getters. These batches do not verify Merkle proofs.
export async function readCurrentReferenceSource({identity,current,pin,rpc}:{
 identity:CurrentReferenceIdentity;current:readonly unknown[];pin:Readonly<{blockHash:string;requireCanonical:true}>;
 rpc:(method:string,params:unknown[])=>Promise<unknown>;
}):Promise<Readonly<{observation:StoredCurrentReference;sourceCurrent:boolean}>>{
 if(!hasCurrentReferenceSourceLayout(identity.sourceGraph))reject();
 const start=map(layout.marketSlot,identity.market,'bytes32')+BigInt(layout.poolSlot),values=new Map<string,string>();
 const observationStart=map(keccak256(toUtf8Bytes('chainwhisper.dex.pool-reference.storage.v1')),identity.market,'bytes32');
 const ids=Array.from({length:7},(_,i)=>start+BigInt(layout.anchorsSlot)+BigInt(i));
 const read=async(wanted:readonly bigint[])=>{
  const keys=[...new Set(wanted.map(String))].filter(key=>!values.has(key));if(!keys.length||keys.length>256)reject();
  const raw=await rpc('eth_getProof',[identity.source,keys.map(key=>hex(BigInt(key))),pin]) as {address?:unknown;codeHash?:unknown;storageProof?:Array<{key:unknown;value:unknown}>}|null;
  if(!raw||!same(raw.address,identity.source)||!same(raw.codeHash,identity.sourceRuntimeHash)||!Array.isArray(raw.storageProof)||raw.storageProof.length!==keys.length)return reject();
  const expected=new Set(keys);
  for(const row of raw.storageProof){
   if(typeof row.key!=='string'||!/^0x[0-9a-f]+$/i.test(row.key)||typeof row.value!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(row.value))reject();
   const key=String(BigInt(row.key as string));if(!expected.delete(key))reject();values.set(key,`0x${BigInt(row.value as string).toString(16).padStart(64,'0')}`);
  }
  if(expected.size)reject();
 };
 const word=(slot:bigint)=>values.get(String(slot))??reject();
 const decode=(field:Field,base:bigint):Value=>{
  const at=base+BigInt(field.slot);if(field.kind==='ciphertext')return[word(at),word(at+1n)];
  const n=(BigInt(word(at))>>BigInt(8*field.offset))&((1n<<BigInt(8*field.bytes))-1n);
  return field.kind==='bool'?n!==0n:field.kind==='address'?`0x${n.toString(16).padStart(40,'0')}`:field.kind==='bytes32'?`0x${n.toString(16).padStart(64,'0')}`:String(n);
 };
 const fields=(definition:Readonly<Record<string,Field>>,base:bigint)=>Object.fromEntries(Object.entries(definition).map(([name,field])=>[name,decode(field,base)]));
 await read([...slots(layout.poolFields,start),...ids,...Array.from({length:5},(_,i)=>observationStart+BigInt(i))]);
 const bases=ids.map(id=>map(start+BigInt(layout.positionsSlot),String(BigInt(word(id))),'uint256'));
 await read(bases.flatMap(base=>slots(layout.anchorFields,base)));
 const p=fields(layout.poolFields,start);
 if(!same(p.marketId,identity.market)||!same(p.releaseId,identity.releaseId)||!same(p.token0,identity.token0)||!same(p.token1,identity.token1))reject();
 let commitment=keccak256(coder.encode(['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','bytes32','bytes32','address','bytes32','address','bytes32','bytes32','address','bytes32'],
  [current[0],current[1],identity.chainId,identity.source,identity.sourceRuntimeHash,p.releaseId,p.marketId,identity.canonicalId,current[9],current[10],p.token0,p.token1,identity.decimals0,identity.decimals1,p.token0Runtime,p.token1Runtime,p.nft,p.nftRuntime,p.terms,p.termsRuntime,p.termsBinding,p.sharedMath,p.sharedMathRuntime]));
 for(let i=0;i<7;i++){
  const a=fields(layout.anchorFields,bases[i]);
  commitment=keccak256(coder.encode(['bytes32','uint256','uint256','uint8','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint8','bool','uint8','(uint256,uint256)','(uint256,uint256)'],
   [commitment,i,String(BigInt(word(ids[i]))),a.status,a.sourceId,a.bucket0Id,a.bucket1Id,a.positionRevision,a.ownershipRevision,a.lifecycleRevision,a.termsRevision,a.mode,a.sharedClaim,a.sharedClassId,a.inventory0,a.inventory1]));
 }
 const observation=Object.freeze({priceE18:String(BigInt(word(observationStart))),sampledAt:String(BigInt(word(observationStart+1n))),sampledBlock:String(BigInt(word(observationStart+2n))),revision:String(BigInt(word(observationStart+3n))),sourceState:word(observationStart+4n)});
 if(![observation.sampledAt,observation.sampledBlock,observation.revision,observation.sourceState].every((value,i)=>same(value,current[16+i])))reject();
 if(current[20]&&(!same(current[15],observation.priceE18)||!same(commitment,observation.sourceState)))reject();
 return{observation,sourceCurrent:same(commitment,observation.sourceState)};
}
