import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_DEX_REFERENCE_SOURCE_LAYOUT as layout } from './currentDexReferenceSourceLayout';
import { readCurrentReferenceSource } from './currentDexReferenceSource';
import { STAGED_GAP_DEX_CANDIDATE as candidate } from './currentDexGapCandidate';
import { readCurrentDexPublicReference } from './currentDexDailyPrice';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, REFERENCE_DEX_DAILY_PRICE_SOURCE } from '../../tests/fixtures/historicalDailyPriceSources';
import { currentDexMarketReference, currentDexEstimatedReceive } from './currentDexMarketReference';
import { currentDexPriceImpact } from './currentDexPriceImpact';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { makeCurrentReferenceStorage } from '../../tests/fixtures/currentReferenceSource.fixture';
import { buildCurrentDexChartLivePoint } from '../features/dex/components/DexMarketChart';
const hashes=vi.hoisted(()=>new Map<string,string>());
vi.mock('@coti-io/coti-ethers',async original=>{const actual=await original<typeof import('@coti-io/coti-ethers')>();return{...actual,keccak256:(value:string)=>hashes.get(value)??actual.keccak256(value)};});
vi.mock('./selectedCurrentDexCandidate',async original=>{const actual=await original<typeof import('./selectedCurrentDexCandidate')>();const current=await import('./currentDexGapCandidate');return{...actual,STAGED_SHARED_HISTORY_DEX_CANDIDATE:current.STAGED_GAP_DEX_CANDIDATE};});
afterEach(()=>vi.restoreAllMocks());
const coder=AbiCoder.defaultAbiCoder(),types=['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','uint256','uint256','uint256','uint256','bytes32','bool'];
function fixture(){
 const now=1_800_000_000n,sampledAt=now-1000n,market=candidate.pairs[0],display=readCurrentDexDisplay(candidate).pairs.find(x=>x.marketId===market.marketId)!,[token0,token1]=display.tokens,core=candidate.runtimes.find(([name])=>name==='ChainWhisperDexCore')!;
 hashes.set('0x6001',core[2]);hashes.set('0x6002',candidate.tokens[0][1]);vi.spyOn(Date,'now').mockReturnValue(Number(now)*1000);
 const identity={sourceGraph:candidate.graph,chainId:candidate.chainId,source:candidate.core,sourceRuntimeHash:core[2],releaseId:candidate.releaseId,market:market.marketId,canonicalId:market.canonicalId,token0:token0.address,token1:token1.address,decimals0:token0.decimals,decimals1:token1.decimals};
 const current:unknown[]=[CURRENT_DEX_DAILY_PRICE_SOURCE.schema,REFERENCE_DEX_DAILY_PRICE_SOURCE.policy,candidate.chainId,candidate.core,core[2],candidate.releaseId,market.marketId,keccak256(coder.encode(['uint256','address','address'],[candidate.chainId,token0.address,token1.address])),market.canonicalId,7,1,token0.address,token1.address,token0.decimals,token1.decimals,2n*10n**18n,sampledAt,100,3,'0x'+'11'.repeat(32),false];
 const storage=makeCurrentReferenceStorage(identity,current);current[15]=0n;current[19]=storage.commitment;
 const api=new Interface(['function poolReference(bytes32) view returns(bytes)']),headHash='0x'+'88'.repeat(32),pin={blockHash:headHash,requireCanonical:true as const};let headReads=0,reorg=false,rpcFailure=false;
 const requests:Array<{method:string;params:unknown[]}>=[];
 const request=async({method,params=[]}:{method:string;params?:unknown[]}):Promise<unknown>=>{
  requests.push({method,params});if(rpcFailure)throw Error('Synthetic RPC failure');
  if(method==='eth_chainId')return`0x${BigInt(candidate.chainId).toString(16)}`;
  if(method==='eth_getBlockByNumber'){
   const n=params[0]==='latest'?200n:BigInt(String(params[0]));if(n===200n)headReads++;
   return{number:`0x${n.toString(16)}`,hash:n===0n?candidate.genesisHash:n===100n?'0x'+'77'.repeat(32):reorg&&headReads>2?'0x'+'99'.repeat(32):headHash,timestamp:`0x${(n===100n?sampledAt:now).toString(16)}`};
  }
  if(method==='eth_getCode')return String(params[0]).toLowerCase()===candidate.core?'0x6001':'0x6002';
  if(method==='eth_call')return api.encodeFunctionResult('poolReference',[coder.encode(types,current)]);
  return storage.rpc(method,params);
 };
 return{now,sampledAt,identity,current,storage,pin,requests,provider:{request},read:()=>readCurrentDexPublicReference({provider:{request},candidate,pair:display.tokens.map(t=>t.label) as[string,string],finalityLagBlocks:0}),pair:display.tokens.map(t=>t.label) as[string,string],reorg:()=>{reorg=true;},rpcFailure:()=>{rpcFailure=true;}};
}
describe('unchanged current-source price verification',()=>{
 it('accepts an old unchanged positive sample after checking complete current state without changing Core availability',async()=>{
  const f=fixture(),snapshot=await f.read(),observation=snapshot.currentObservation!;
  expect(f.current[20]).toBe(false);expect(f.current[15]).toBe(0n);expect(observation).toMatchObject({priceE18:'2000000000000000000',sampledAt:String(f.sampledAt),sampledBlock:'100',checkedAt:String(f.now),checkedBlock:'200',coreAvailable:false});
  const reference=currentDexMarketReference({status:'reference',snapshot},f.pair,f.now);expect(reference.status).toBe('available');
  expect(currentDexEstimatedReceive({reference,pair:f.pair,inputIndex:0,input:1_000_000n,inputDecimals:6,outputDecimals:6,now:f.now})).toBe('2.0');
  expect(currentDexMarketReference({status:'reference',snapshot},f.pair,f.now+121n).status).toBe('last-known');
  expect(currentDexEstimatedReceive({reference,pair:f.pair,inputIndex:0,input:1_000_000n,inputDecimals:6,outputDecimals:6,now:f.now+121n})).toBeNull();
  const model={title:'Quote',primaryLabel:'Accept',fundingMoves:[],stats:[],message:'',summaryRows:[{label:'You pay',value:`10 ${f.pair[0]}`},{label:'You receive',value:`18 ${f.pair[1]}`}]};
  expect(currentDexPriceImpact({model,reference,pair:f.pair,inputIndex:0,now:f.now})).toBe('≈ 10.00% worse');
  expect(currentDexPriceImpact({model,reference,pair:f.pair,inputIndex:0,now:f.now+121n})).toBe('Unavailable');
  expect(buildCurrentDexChartLivePoint(reference,f.pair,false,Number(f.now-500n),Number(f.now))).toEqual({price:2,timestamp:Number(f.now)});
  expect(buildCurrentDexChartLivePoint(reference,f.pair,false,Number(f.now-500n),Number(f.now+121n))).toBeNull();
  expect(f.requests.filter(x=>x.method==='eth_getProof')).toHaveLength(2);expect(f.requests.filter(x=>x.method==='eth_getProof').every(x=>JSON.stringify(x.params[2])===JSON.stringify(f.pin))).toBe(true);
 });
 it('rejects a changed opaque source commitment',async()=>{
  const f=fixture(),slot=f.storage.anchorBases[0]+BigInt(layout.anchorFields.inventory0.slot);f.storage.values.set(String(slot),123n);
  const snapshot=await f.read();expect(snapshot.currentReference).toBe('suppressed-or-changed');expect(snapshot.currentObservation).toBeUndefined();
 });
 it('keeps the verified last public price after a trade changes the source, for display only',async()=>{
  const f=fixture(),slot=f.storage.anchorBases[0]+BigInt(layout.anchorFields.inventory0.slot);f.storage.values.set(String(slot),123n);
  const snapshot=await f.read();
  const reference=currentDexMarketReference({status:'reference',snapshot},f.pair,f.now);
  expect(reference).toMatchObject({status:'last-known',price:2,sampledAt:String(f.sampledAt)});
  expect(currentDexMarketReference({status:'reference',snapshot},[f.pair[1],f.pair[0]],f.now)).toMatchObject({status:'last-known',price:0.5});
  expect(currentDexEstimatedReceive({reference,pair:f.pair,inputIndex:0,input:1_000_000n,inputDecimals:6,outputDecimals:6,now:f.now})).toBeNull();
  expect(buildCurrentDexChartLivePoint(reference,f.pair,false,Number(f.now-500n),Number(f.now))).toBeNull();
 });
 it.each(['reorg','rpcFailure'] as const)('rejects %s without issuing a verified snapshot',async fault=>{const f=fixture();f[fault]();await expect(f.read()).rejects.toThrow();});
 it('rejects an old checked head even with an unchanged source',async()=>{const f=fixture();vi.spyOn(Date,'now').mockReturnValue(Number(f.now+121n)*1000);await expect(f.read()).rejects.toThrow('checked head is stale');});
 it('rejects unsupported source graphs before any storage read',async()=>{
  const f=fixture(),rpc=vi.fn();await expect(readCurrentReferenceSource({identity:{...f.identity,sourceGraph:'00'.repeat(32)},current:f.current,pin:f.pin,rpc})).rejects.toThrow('source storage does not match');expect(rpc).not.toHaveBeenCalled();
 });
 it('rejects incomplete storage batches and mismatched sample metadata',async()=>{
  const f=fixture();await expect(readCurrentReferenceSource({identity:f.identity,current:f.current,pin:f.pin,rpc:async()=>({address:f.identity.source,codeHash:f.identity.sourceRuntimeHash,storageProof:[]})})).rejects.toThrow();
  f.current[18]=4;await expect(f.read()).rejects.toThrow();
 });
});

it('rejects historical source layout before any RPC',async()=>{
 const f=fixture();let calls=0;
 await expect(readCurrentReferenceSource({identity:{...f.identity,sourceGraph:layout.graph},current:f.current,pin:f.pin,rpc:async()=>{calls++;throw Error('MUST_NOT_READ');}})).rejects.toThrow('storage does not match');expect(calls).toBe(0);
});
