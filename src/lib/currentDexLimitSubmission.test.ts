import * as limitCodec from './currentDexLimit';
import { getAddress,toBeHex } from '@coti-io/coti-ethers';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createCurrentLimitSubmissionAdapter } from './currentDexLimitSubmission';
import { createCurrentAttemptBoundary,wasCurrentDexUnsentReleased } from './currentDexSubmission';
import { currentDexNormalUseReloadKey } from './currentDexNativeReload';
import { currentLimitAbi as abi,currentLimitAbiForCandidate,currentLimitOwnerNativeAdmission,currentLimitNftAbi,CurrentLimitProofMismatch } from './currentDexLimit';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key } from './currentDexPendingAttempt';
// Adapter unit test only: issuer brand is mocked. Genuine preparation has separate tests.
const brands=vi.hoisted(()=>new WeakMap<object,object>());
const localSubmissionAuthority=vi.hoisted(()=>({allowed:false,receiptRepair:false}));
// CW-086: only a registered signer has the browser wallet context. Every other signer keeps the engineering path.
const browserContexts=vi.hoisted(()=>new WeakMap<object,{owner:string}>());
vi.mock('../features/wallet/ownerCotiMetaMaskCapability',()=>({hasCurrentDexBrowserSigner:(signer:object|undefined,owner:string)=>
  !!signer&&browserContexts.get(signer)?.owner===owner.toLowerCase()}));
vi.mock('./currentDexC1SwapPolicy',async importOriginal=>{
  const actual=await importOriginal<typeof import('./currentDexC1SwapPolicy')>();
  return {...actual,isCurrentAppLimitTopUpRepair:(...args:Parameters<typeof actual.isCurrentAppLimitTopUpRepair>)=>localSubmissionAuthority.receiptRepair||actual.isCurrentAppLimitTopUpRepair(...args),assertCurrentAppLimitAuthority:(...args:Parameters<typeof actual.assertCurrentAppLimitAuthority>)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentAppLimitAuthority(...args);
  },assertCurrentD06AppAuthority:(graph:string)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentD06AppAuthority(graph);
  }};
});
vi.mock('../features/wallet/currentDexLimitCapability',()=>({assertCurrentLimitPrepared:(p:object,s:object)=>{if(brands.get(p)!==s)throw new Error('Wrong owner session');}}));
const c=resolveCurrentCheapDexCandidate('cheap-history');
// This bypass is local to sender-mechanics tests. The hold stays active by default.
function allowLocalTechnicalSubmission(){localSubmissionAuthority.allowed=true;}
const owner=`0x${'22'.repeat(20)}`,hash=toBeHex(30n,32),txHash=toBeHex(31n,32),chainId=BigInt(c.chainId),signature=`0x${'44'.repeat(65)}`;
function fixture(snapshot=false,candidateKey:CurrentCheapDexCandidateKey='cheap-history',selectedOwner=owner){
  const owner=selectedOwner;
  const c=resolveCurrentCheapDexCandidate(candidateKey),abi=currentLimitAbiForCandidate(candidateKey),pair=resolvePreparedDexScope(candidateKey).candidate.pairs[2];
  const storage=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  const signer={},guard=vi.fn(async()=>{}),small={ciphertext:1n,signature},wide={ciphertext:{ciphertextHigh:1n,ciphertextLow:1n},signature};
  const result={positionId:9n},prepared={from:owner,to:c.core as string,chainId,value:0n as bigint,phase:snapshot?'limit-snapshot':'limit-create',positionId:9n,marketId:pair?.marketId,poolTokens:pair?.tokens,
    data:snapshot?abi.encodeFunctionData('privateOrderSnapshot',[9n]):abi.encodeFunctionData('createPrivateOrder',abi===limitCodec.packedLimitAbi?[pair!.marketId,wide,Array(3).fill(wide)]:[...(pair?[pair.marketId]:[]),wide,small,small,Array(5).fill(small),Array(3).fill(wide)]),
    intent:{sellToken0:true,amount:100n,terms:[3n,1n,1n,1n,2n]},graph:c.graph as string,packageSha256:c.packageSha256 as string,readyToSign:false,assertCurrent:guard,assertAuthority:vi.fn(async()=>{}),readResult:vi.fn(async()=>result)};
  brands.set(prepared,signer);let tx:Record<string,unknown>|null=null;
  const receipt={hash:txHash,status:1,from:owner,to:c.core,blockNumber:10,blockHash:hash,logs:[{address:c.core,...abi.encodeEventLog(abi.getEvent('FixedPositionCreated')!,[9n])},{address:c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])}]};
  const transport={verifyCanonicalInclusion:vi.fn(async()=>{}),assertCurrent:guard,estimateGas:vi.fn(async()=>1n),readHead:vi.fn(async()=>({number:10n,hash,timestamp:100n,gasLimit:120_000_000n})),readNonce:vi.fn(async()=>4),readBlockHash:vi.fn(async()=>hash),
    readNativeResources:vi.fn(async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head:{...head},latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})),
    send:vi.fn(async request=>{tx={...request,hash:txHash,blockNumber:10,blockHash:hash};return{...request,hash:txHash};}),readTransaction:vi.fn(async()=>tx),waitForReceipt:vi.fn(async()=>receipt)};
  const funding=vi.fn(async()=>{}),make=(identity=signer,candidate:CurrentCheapDexCandidateKey=candidateKey)=>createCurrentLimitSubmissionAdapter({candidate,signer:identity,ownerAddress:owner,chainId,transport:transport as never,attest:async()=>{},requireFunding:funding,now:()=>100n});
  return{prepared,receipt,transport,storage,funding,make,tx:()=>tx!};
}
function ownerFixture(action='claim',candidateKey:CurrentCheapDexCandidateKey='cheap-history'){
  const c=resolveCurrentCheapDexCandidate(candidateKey),f=fixture(true,candidateKey);Object.assign(f.prepared,{phase:'limit-owner',action,expectedLifecycleRevision:7n,data:abi.encodeFunctionData(action==='refresh'?'privateOrderSnapshot':action==='claim'?'claimPrivateOrderProceeds':action==='close'?'closePrivateOrder':'managePrivateOrderStatus',action==='pause'||action==='resume'?[9n,7n,action==='pause'?0:1]:[9n])});
  f.receipt.logs=action==='claim'||action==='close'?[{address:c.core,...abi.encodeEventLog(abi.getEvent(action==='claim'?'FixedProceedsClaimed':'FixedPositionClosed')!,[9n])}]:[];
  if(action==='close')f.receipt.logs.push({address:c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,9n])});return f;
}
afterEach(()=>{ localSubmissionAuthority.allowed=false;localSubmissionAuthority.receiptRepair=false;vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('prepared six-market Limit sender shape and authority',()=>{
  it('restores snapshot receipt metadata using the current candidate when old state is pruned',async()=>{
    allowLocalTechnicalSubmission();const f=fixture(true,'cheap-history');await f.make().submitLimit(f.prepared as never);
    const head={number:20n,hash:toBeHex(40n,32),timestamp:100n,gasLimit:120_000_000n};f.transport.readHead.mockResolvedValue(head);
    const attest=vi.fn(async(block:{number:bigint;hash:string})=>{if(block.number===10n)throw new Error('missing trie node');});
    const restored=createCurrentLimitSubmissionAdapter({candidate:'cheap-history',signer:brands.get(f.prepared)!,ownerAddress:owner,chainId,transport:f.transport as never,attest,requireFunding:f.funding,now:()=>100n});
    expect(await restored.recoverPendingLimitAttempt()).toMatchObject({status:'observed-mined',phase:'limit-snapshot',privateAccountingVerified:false,readyToSign:false});
    expect(attest).toHaveBeenCalledOnce();expect(attest).toHaveBeenCalledWith(head);expect(f.storage.has(key)).toBe(false);
    expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('retains saved snapshot metadata if the current candidate cannot be attested',async()=>{
    allowLocalTechnicalSubmission();const f=fixture(true,'cheap-history');await f.make().submitLimit(f.prepared as never);
    const attest=vi.fn(async()=>{throw new Error('Current candidate changed');});
    const restored=createCurrentLimitSubmissionAdapter({candidate:'cheap-history',signer:brands.get(f.prepared)!,ownerAddress:owner,chainId,transport:f.transport as never,attest,requireFunding:f.funding,now:()=>100n});
    await expect(restored.recoverPendingLimitAttempt()).rejects.toThrow('Current candidate changed');expect(f.storage.has(key)).toBe(true);
    expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('reaches current engineering Limit creation through the real App policy',async()=>{
    const engineering='0x8b749251cf1f712d4e39fd048c53394af03e10be';
    const f=fixture(false,'cheap-history',engineering),sent=await f.make().submitLimit(f.prepared as never);
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(sent.request).toMatchObject({from:getAddress(engineering),to:getAddress(resolveCurrentCheapDexCandidate('cheap-history').core),gasLimit:30_000_000n});
    await sent.recover();expect(f.storage.has(key)).toBe(false);
  });
  it.each(['phase','target','calldata','cap','copy','amount'] as const)('rejects engineering Limit boundary %s before nonce or send',async fault=>{
    const engineering=getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'),f=fixture(false,'cheap-history',engineering),c=resolveCurrentCheapDexCandidate('cheap-history');
    if(fault==='amount')f.prepared.intent.amount=1_000_001n;
    const boundary=createCurrentAttemptBoundary({storage:window.sessionStorage,c,core:getAddress(c.core),owner:engineering,chainId,transport:f.transport as never,attest:async()=>{},now:()=>100n});
    const call={chainId,from:engineering,to:fault==='target'?engineering:getAddress(c.core),value:0n as const,data:fault==='calldata'?f.prepared.data+'00':f.prepared.data};
    const prepared=fault==='copy'?{...f.prepared}:f.prepared;
    await expect(boundary.sendCurrent(fault==='phase'?'pool-owner':'limit-create',call,undefined,()=>{},()=>{},undefined,fault==='cap'?29_000_000n:30_000_000n,undefined,undefined,undefined,undefined,undefined,undefined,{prepared:prepared as never,signer:brands.get(f.prepared)!})).rejects.toThrow();
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('rechecks the Limit brand binding after asynchronous signing admission before pending reservation',async()=>{
    const engineering=getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'),f=fixture(false,'cheap-history',engineering),c=resolveCurrentCheapDexCandidate('cheap-history');
    const boundary=createCurrentAttemptBoundary({storage:window.sessionStorage,c,core:getAddress(c.core),owner:engineering,chainId,transport:f.transport as never,attest:async()=>{},now:()=>100n});
    const call={chainId,from:engineering,to:getAddress(c.core),value:0n as const,data:f.prepared.data};
    await expect(boundary.sendCurrent('limit-create',call,undefined,()=>{},()=>{},undefined,30_000_000n,undefined,async()=>{await Promise.resolve();f.prepared.graph='changed';},undefined,undefined,undefined,undefined,{prepared:f.prepared as never,signer:brands.get(f.prepared)!})).rejects.toThrow('candidate');
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('keeps a known Limit private payout mismatch locked after reload',async()=>{
    allowLocalTechnicalSubmission();const f=ownerFixture('claim','cheap-history'),sender=f.make(),sent=await sender.submitLimitOwner(f.prepared as never);
    f.prepared.readResult.mockRejectedValue(new Error('Limit wallet credit or allowance differs from the exact payout.'));
    await expect(sent.recover()).rejects.toThrow('exact payout');
    expect(await f.make().recoverPendingLimitAttempt()).toMatchObject({status:'manual-reconciliation-required',verificationBlocked:true});
    expect(f.storage.size).toBe(1);expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('permits retry of unavailable private evidence and retains typed mismatches as manual reconciliation',async()=>{
    allowLocalTechnicalSubmission();const f=fixture(false,'cheap-history'),sender=f.make(),sent=await sender.submitLimit(f.prepared as never);
    f.prepared.readResult.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(sent.recover()).rejects.toThrow('RPC unavailable');
    expect(JSON.parse(f.storage.get(key)!).verificationBlocked).toBeUndefined();
    f.prepared.readResult.mockRejectedValueOnce(new CurrentLimitProofMismatch('Limit creation debit differs from offered budget.'));
    await expect(sent.recover()).rejects.toThrow('offered budget');
    await expect(sent.recover()).rejects.toThrow('Known Limit verification failure');
    expect(await f.make().recoverPendingLimitAttempt()).toMatchObject({status:'manual-reconciliation-required',verificationBlocked:true});
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('recognizes new Limit creation and snapshot proof but keeps the real wallet hold',async()=>{
    for(const snapshot of [false,true]){const f=fixture(snapshot,'cheap-history');await expect(f.make().submitLimit(f.prepared as never)).rejects.toThrow('Shared-history DEX App signing hold');expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();}
  });
  it.each(['refresh','claim','pause','resume','close']as const)('recognizes new %s proof without transferring wallet authority',async action=>{
    expect(currentLimitOwnerNativeAdmission('cheap-history')).toEqual({refresh:true,claim:true,pause:true,resume:true,close:true,topup:true,reprice:true});
    const f=ownerFixture(action,'cheap-history');await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow('Shared-history DEX App signing hold');expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['market','tokens','selector','suffix']as const)('rejects prepared %s mismatch before native admission',async fault=>{
    const f=fixture(false,'cheap-history');
    if(fault==='market')f.prepared.marketId=resolvePreparedDexScope('cheap-history').candidate.pairs[0].marketId;
    if(fault==='tokens')f.prepared.poolTokens=resolvePreparedDexScope('cheap-history').candidate.pairs[0].tokens;
    if(fault==='selector'){const small={ciphertext:1n,signature},wide={ciphertext:{ciphertextHigh:1n,ciphertextLow:1n},signature};f.prepared.data=abi.encodeFunctionData('createPrivateOrder',[wide,small,small,Array(5).fill(small),Array(3).fill(wide)]);}
    if(fault==='suffix')f.prepared.data+='00';
    await expect(f.make().submitLimit(f.prepared as never)).rejects.toThrow();expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rechecks selected-market creation authority and funding in the transport unit model only',async()=>{
    allowLocalTechnicalSubmission();
    const f=fixture(false,'cheap-history'),sent=await f.make().submitLimit(f.prepared as never);
    expect(f.prepared.assertAuthority).toHaveBeenCalledTimes(2);expect(f.funding).toHaveBeenCalledTimes(2);await sent.recover();expect(f.storage.has(key)).toBe(false);
  });
  it.each(['cheap-history']as const)('sends exact %s owner calls with fresh authority in the local transport model',async candidate=>{
    for(const action of ['refresh','claim','pause','resume','close']as const){
    allowLocalTechnicalSubmission();const f=ownerFixture(action,candidate),sent=await f.make().submitLimitOwner(f.prepared as never);
    expect(f.prepared.assertAuthority).toHaveBeenCalledTimes(2);expect(f.funding).not.toHaveBeenCalled();
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasLimit:action==='claim'||action==='close'?30_000_000n:10_000_000n,to:getAddress(resolveCurrentCheapDexCandidate(candidate).core)}),expect.any(Function));
    await sent.recover();expect(f.prepared.readResult).toHaveBeenCalledWith(txHash);expect(f.storage.has(key)).toBe(false);
    }
  });
});
describe('current Limit shared pending sender (local technical admission)',()=>{
  beforeEach(allowLocalTechnicalSubmission);
  it.each([['refresh',10_000_000n],['claim',30_000_000n],['pause',10_000_000n],['resume',10_000_000n],['close',30_000_000n]]as const)('admits %s only with private owner reconciliation',async(action,cap)=>{
    const f=ownerFixture(action),sender=f.make(),sent=await sender.submitLimitOwner(f.prepared as never);expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasLimit:cap}),expect.any(Function));expect(f.prepared.assertAuthority).toHaveBeenCalledTimes(2);expect(f.funding).not.toHaveBeenCalled();
    await sent.recover();expect(f.prepared.readResult).toHaveBeenCalledWith(txHash);expect(f.storage.has(key)).toBe(false);await expect(sender.submitLimitOwner(f.prepared as never)).rejects.toThrow();
  });
  it.each(['action','lifecycle','state','canonical','private'])('rejects owner %s drift and does not grant private amounts',async fault=>{
    const f=ownerFixture('pause');if(fault==='action')Object.assign(f.prepared,{action:'claim'});if(fault==='lifecycle')Object.assign(f.prepared,{expectedLifecycleRevision:8n});if(fault==='state')f.prepared.assertAuthority.mockRejectedValue(new Error('Changed terms'));
    if(['action','lifecycle','state'].includes(fault)){await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();return;}
    const sent=await f.make().submitLimitOwner(f.prepared as never);if(fault==='canonical')f.transport.readBlockHash.mockResolvedValue(toBeHex(99n,32));else f.prepared.readResult.mockRejectedValue(new Error('Wrong payout'));await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);
  });
  it('canonical public reload releases pending but grants no private amounts; a freshly prepared refresh can follow',async()=>{const f=ownerFixture();await f.make().submitLimitOwner(f.prepared as never);expect(await f.make().recoverPendingLimitAttempt()).toMatchObject({status:'observed-mined',privateAccountingVerified:false});expect(f.storage.has(key)).toBe(false);expect(f.prepared.readResult).not.toHaveBeenCalled();
    const fresh={...f.prepared,data:abi.encodeFunctionData('privateOrderSnapshot',[9n]),action:'refresh'};const signer={};brands.set(fresh,signer);await expect(f.make(signer).submitLimitOwner(fresh as never)).resolves.toMatchObject({status:'limit-pending'});
  });
  it.each(['event','candidate','burn','receipt'])('retains reload pending on wrong %s',async fault=>{
    const f=ownerFixture(fault==='burn'?'close':'claim');await f.make().submitLimitOwner(f.prepared as never);
    if(fault==='event')f.receipt.logs[0]={address:c.core,...abi.encodeEventLog(abi.getEvent('FixedProceedsClaimed')!,[10n])};if(fault==='candidate'){const p=JSON.parse(f.storage.get(key)!);p.graph=`0x${'ff'.repeat(32)}`;f.storage.set(key,JSON.stringify(p));}if(fault==='burn')f.receipt.logs.pop();if(fault==='receipt')f.receipt.blockHash=toBeHex(99n,32);
    await expect(f.make().recoverPendingLimitAttempt()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);
  });
  it.each([false,true])('uses admitted create/snapshot caps with one native fit estimate for snapshot=%s',async snapshot=>{
    const f=fixture(snapshot),sender=f.make(),sent=await sender.submitLimit(f.prepared as never);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasLimit:snapshot?10_000_000n:30_000_000n,nonce:4}),expect.any(Function));expect(f.transport.estimateGas).toHaveBeenCalledOnce();
    if(snapshot){expect(f.funding).not.toHaveBeenCalled();expect(f.prepared.assertAuthority).toHaveBeenCalledTimes(2);}else expect(f.funding).toHaveBeenCalledTimes(2);
    await sent.recover();expect(f.storage.has(key)).toBe(false);await expect(sender.submitLimit(f.prepared as never)).rejects.toThrow('already submitted');
  });
  it.each(['forged','session','graph','package','owner','chain','target','value','method','suffix','headroom','nonce','funding','pending'])('rejects %s before signing',async fault=>{
    const f=fixture();if(fault==='forged')f.prepared={...f.prepared};if(fault==='graph')f.prepared.graph='bad';if(fault==='package')f.prepared.packageSha256='bad';
    if(fault==='owner')f.prepared.from=c.core;if(fault==='chain')f.prepared.chainId=1n;if(fault==='target')f.prepared.to=owner;if(fault==='value')f.prepared.value=1n;
    if(fault==='method')f.prepared.data=abi.encodeFunctionData('privateOrderSnapshot',[9n]);if(fault==='suffix')f.prepared.data+='00';if(fault==='headroom')f.transport.readHead.mockResolvedValue({number:10n,hash,timestamp:100n,gasLimit:30_000_000n});
    if(fault==='nonce')f.transport.readNonce.mockResolvedValueOnce(4).mockResolvedValueOnce(5);if(fault==='funding')f.funding.mockRejectedValue(new Error('Insufficient allowance'));
    if(fault==='pending')f.storage.set(key,JSON.stringify({version:1,chainId:chainId.toString(),owner,core:c.core,graph:`0x${c.graph}`,phase:'pool-fund',callHash:hash,nonce:3,txHash:null}));
    await expect(f.make(fault==='session'?{}:undefined).submitLimit(f.prepared as never)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['private','reorg','nonce','gas','unknown'])('retains pending on %s result failure',async fault=>{
    const f=fixture(),sent=await f.make().submitLimit(f.prepared as never);if(fault==='private')f.prepared.readResult.mockRejectedValue(new Error('Bad terms'));if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(toBeHex(99n,32));
    if(fault==='nonce')f.tx().nonce=5;if(fault==='gas')f.tx().gasLimit=29_000_000n;if(fault==='unknown')f.transport.readTransaction.mockResolvedValue(null);
    await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);
  });
  it('unlocks only canonical status0; public reload result grants no private inventory',async()=>{
    const f=fixture(),sender=f.make();await sender.submitLimit(f.prepared as never);f.receipt.status=0;expect(await sender.recoverPendingLimitAttempt()).toMatchObject({status:'observed-reverted'});
    await sender.submitLimit(f.prepared as never);f.receipt.status=1;expect(await f.make().recoverPendingLimitAttempt()).toMatchObject({status:'observed-mined'});expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
});


it('rejects changed candidate metadata in the retained Limit recovery closure',async()=>{allowLocalTechnicalSubmission();const f=fixture(),sent=await f.make().submitLimit(f.prepared as never),p=JSON.parse(f.storage.get(key)!);f.storage.set(key,JSON.stringify({...p,graph:`0x${'ff'.repeat(32)}`}));await expect(sent.recover()).rejects.toThrow('pending request changed');expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.storage.size).toBe(1);});


describe('native owner canonical completion boundary',()=>{
  it.each(['none','private','block','status','logs','topics','transaction','missing'])('retained closure handles %s after private proof',async fault=>{
    allowLocalTechnicalSubmission();const f=fixture(true), native=c;
    f.receipt.to=native.core; f.receipt.logs=[];
    f.transport.estimateGas.mockResolvedValue(1n);
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    Object.assign(f.transport,{readNativeResources:async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head,latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})});
    const adapter=f.make();
    const sent=await adapter.submitLimit(f.prepared as never);
    f.prepared.readResult.mockImplementationOnce(async()=>{
      if(fault==='private')throw new Error('Private proof failed');
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=0;
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='topics'){if(f.receipt.logs.length)f.receipt.logs[0].topics.push(toBeHex(999n,32));else f.receipt.logs.push({address:native.core,topics:[toBeHex(999n,32)],data:'0x'});}
      if(fault==='transaction')f.tx().nonce=999;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
      return {positionId:9n};
    });
    if(fault==='none'){await expect(sent.recover()).resolves.toEqual({positionId:9n});expect(f.storage.has(key)).toBe(false);}
    else{await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);}
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([0,1].flatMap(status=>['none','logs','block','status','transaction','missing'].map(fault=>[status,fault] as const)))('metadata status %s handles %s at final read',async(status,fault)=>{
    allowLocalTechnicalSubmission();const f=fixture(true), native=c;
    f.receipt.to=native.core; f.receipt.logs=[];
    f.transport.estimateGas.mockResolvedValue(1n);
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    Object.assign(f.transport,{readNativeResources:async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head,latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})});
    const adapter=f.make();
    await adapter.submitLimit(f.prepared as never);f.receipt.status=status;
    let reads=0;f.transport.waitForReceipt.mockImplementation(async()=>{if(++reads===3){
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=status===0?1:0;
      if(fault==='transaction')f.receipt.from=native.core;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
    }return f.receipt;});
    if(fault==='none'){await expect(adapter.recoverPendingLimitAttempt()).resolves.toMatchObject({status:status===0?'observed-reverted':'observed-mined'});expect(f.storage.has(key)).toBe(false);}else{await expect(adapter.recoverPendingLimitAttempt()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);}expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe('current Limit edit sender boundaries',()=>{
  const editFixture=(action:'topup'|'reprice',candidate:CurrentCheapDexCandidateKey='cheap-history')=>{
    const f=fixture(true,candidate),abi=currentLimitAbiForCandidate(candidate),small={ciphertext:1n,signature},wide={ciphertext:{ciphertextHigh:1n,ciphertextLow:1n},signature};
    Object.assign(f.prepared,{phase:'limit-owner',action,expectedTermsRevision:3n,expectedLifecycleRevision:7n,data:abi.encodeFunctionData(action==='topup'?'topUpPrivateOrder':'repricePrivateOrder',action==='topup'?[9n,3n,7n,wide]:abi===limitCodec.packedLimitAbi?[9n,3n,Array(3).fill(wide)]:[9n,3n,Array(5).fill(small),Array(3).fill(wide)])});return f;
  };
  it.each(['topup','reprice']as const)('keeps new candidate %s held before nonce, estimate or send',async action=>{
    expect(currentLimitOwnerNativeAdmission('cheap-history')[action]).toBe(true);
    const f=editFixture(action,'cheap-history');
    await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow('Shared-history DEX App signing hold');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['topup','reprice']as const)('checks %s terms revision before held admission',async action=>{
    const f=editFixture(action);Object.assign(f.prepared,{expectedTermsRevision:4n});await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow('Limit owner action, ID or lifecycle changed.');expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('checks top-up lifecycle and canonical encoding before held admission',async()=>{
    const f=editFixture('topup');Object.assign(f.prepared,{expectedLifecycleRevision:8n});await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow('Limit owner action, ID or lifecycle changed.');
    Object.assign(f.prepared,{expectedLifecycleRevision:7n,data:f.prepared.data+'00'});await expect(f.make().submitLimitOwner(f.prepared as never)).rejects.toThrow('Non-canonical Limit request.');expect(f.transport.send).not.toHaveBeenCalled();
  });
  const blockedTopUp=async()=>{
    allowLocalTechnicalSubmission();const f=editFixture('topup','cheap-history'),sender=f.make(),sent=await sender.submitLimitOwner(f.prepared as never);
    f.prepared.readResult.mockRejectedValueOnce(new CurrentLimitProofMismatch('Limit top-up debit is missing or duplicated.'));await expect(sent.recover()).rejects.toThrow('top-up');
    const result={positionId:9n,owner,closed:false,transactionHash:txHash,block:{number:10n,hash},values:null,amounts:null,refreshRequired:true,readyToSign:false};
    const proof={phase:'limit-topup-reconciliation',from:owner,to:resolveCurrentCheapDexCandidate('cheap-history').core,chainId,graph:f.prepared.graph,packageSha256:f.prepared.packageSha256,data:f.prepared.data,nonce:4,transactionHash:txHash,positionId:9n,topUpAmount:11n,receiptBlock:{number:10n,hash},privateWalletDeltaVerified:true,privateReceiptDebitsVerified:true,result,assertCurrent:f.prepared.assertCurrent,readyToSign:false};
    brands.set(proof,brands.get(f.prepared)!);return{...f,sender,proof};
  };
  it('reconciles a blocked top-up only with a current owner proof and no new send',async()=>{
    const f=await blockedTopUp(),sends=f.transport.send.mock.calls.length,estimates=f.transport.estimateGas.mock.calls.length;
    expect(await f.sender.reconcileMinedTopUp(f.proof as never)).toBe(f.proof.result);expect(f.storage.has(key)).toBe(false);expect(f.transport.send).toHaveBeenCalledTimes(sends);expect(f.transport.estimateGas).toHaveBeenCalledTimes(estimates);
  });
  it('keeps receipt and current-state blocks distinct for an explicitly admitted receipt repair',async()=>{
    // Adapter mechanics only; real transaction pins are tested in the policy suite.
    const f=await blockedTopUp();localSubmissionAuthority.receiptRepair=true;f.proof.privateWalletDeltaVerified=false;f.proof.result.block={number:20n,hash:toBeHex(999n,32)};
    expect(await f.sender.reconcileMinedTopUp(f.proof as never)).toBe(f.proof.result);expect(f.storage.has(key)).toBe(false);expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['brand','hash','nonce','target','phase','result-hash','result-block','receipt-block','unapproved-receipt-only','receipt-proof','inclusion','pending-change']as const)('retains the blocked top-up on reconciliation %s drift',async fault=>{
    const f=await blockedTopUp();
    if(fault==='brand')brands.delete(f.proof);if(fault==='hash')f.proof.transactionHash=toBeHex(999n,32);if(fault==='nonce')f.proof.nonce++;
    if(fault==='target')f.proof.to=owner;if(fault==='phase')f.proof.phase='limit-owner';if(fault==='result-hash')f.proof.result.transactionHash=toBeHex(999n,32);if(fault==='result-block')f.proof.result.block.hash=toBeHex(999n,32);
    if(fault==='receipt-block')f.proof.receiptBlock.hash=toBeHex(999n,32);if(fault==='unapproved-receipt-only')f.proof.privateWalletDeltaVerified=false;if(fault==='receipt-proof')f.proof.privateReceiptDebitsVerified=false;
    if(fault==='inclusion')f.transport.verifyCanonicalInclusion.mockRejectedValueOnce(new Error('Changed block'));
    if(fault==='pending-change')f.proof.assertCurrent=vi.fn(async()=>{const p=JSON.parse(f.storage.get(key)!);p.nonce++;f.storage.set(key,JSON.stringify(p));});
    await expect(f.sender.reconcileMinedTopUp(f.proof as never)).rejects.toThrow();expect(f.storage.has(key)).toBe(true);expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
// Shared by the packed boundary tests and the CW-086 release tests.
const packedFixture=(reprice=false)=>{
    const f=fixture(true,'cheap-history'),candidate=resolvePreparedDexScope('cheap-history').candidate,wide={ciphertext:{ciphertextHigh:1n,ciphertextLow:1n},signature};
    vi.spyOn(limitCodec,'currentLimitAbiForCandidate').mockReturnValue(limitCodec.packedLimitAbi);
    Object.assign(f.prepared,{phase:reprice?'limit-owner':'limit-create',...(reprice?{action:'reprice',expectedTermsRevision:3n,expectedLifecycleRevision:7n}:{}),data:limitCodec.packedLimitAbi.encodeFunctionData(reprice?'repricePrivateOrder':'createPrivateOrder',reprice?[9n,3n,Array(3).fill(wide)]:[candidate.pairs[2].marketId,wide,Array(3).fill(wide)])});
    if(reprice)f.receipt.logs=[{address:candidate.core,...limitCodec.packedLimitAbi.encodeEventLog(limitCodec.packedLimitAbi.getEvent('FixedPositionRepriced')!,[9n,4n])}];
    allowLocalTechnicalSubmission();return f;
  };
describe('packed Limit pending boundary (local ABI selection only)',()=>{
  it.each([false,true])('restores canonical packed pending metadata without resend (reprice=%s)',async reprice=>{
    const f=packedFixture(reprice);await f.make().submitLimit(f.prepared as never);
    expect(await f.make().recoverPendingLimitAttempt()).toMatchObject({status:'observed-mined',privateAccountingVerified:false});
    expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.has(key)).toBe(false);expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each(['suffix','revision','market','identity']as const)('rejects packed %s changes before send',async fault=>{
    const f=packedFixture(fault==='revision');
    if(fault==='suffix')f.prepared.data+='00';if(fault==='revision')Object.assign(f.prepared,{expectedTermsRevision:4n});if(fault==='market')f.prepared.marketId=`0x${'99'.repeat(32)}`;if(fault==='identity')f.prepared.graph='changed';
    await expect(f.make().submitLimit(f.prepared as never)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.has(key)).toBe(false);
  });
  it('holds uncertain packed sends across reload without resend',async()=>{
    const f=packedFixture();f.transport.send.mockImplementationOnce(async()=>{throw new Error('Unknown send');});
    await expect(f.make().submitLimit(f.prepared as never)).rejects.toThrow();expect(f.storage.has(key)).toBe(true);
    const restored=await f.make().recoverPendingLimitAttempt();expect(restored).toMatchObject({status:'manual-reconciliation-required'});expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.has(key)).toBe(true);
  });
});

// CW-086, decision-033: the normal browser App releases a Limit action that the wallet rejected and never sent.
describe('release of a wallet-rejected Limit action in the browser App',()=>{
  type Kind='create'|'snapshot'|'reprice';
  const browser=(kind:Kind='create')=>{
    allowLocalTechnicalSubmission();
    const f=kind==='snapshot'?fixture(true,'cheap-history'):packedFixture(kind==='reprice'),signer=brands.get(f.prepared)!,current=resolveCurrentCheapDexCandidate('cheap-history');
    browserContexts.set(signer,{owner});
    f.storage.set(currentDexNormalUseReloadKey({owner,graph:current.graph,chainId}),JSON.stringify({
      budget:{version:2,owner,candidateGraph:current.graph,start:'1',committedWei:'0',activeSwap:null,charges:[]},authentication:hash}));
    Object.assign(f.transport,{admitOwnerRecord:vi.fn(async()=>{})});
    return f;
  };
  const rejection=()=>Object.assign(new Error('User rejected the request.'),{code:4001});
  it.each(['create','snapshot','reprice']as const)('releases a rejected Limit %s request and permits a new request',async kind=>{
    const f=browser(kind),phase=kind==='create'?'limit-create':kind==='snapshot'?'limit-snapshot':'limit-owner',adapter=f.make(),error=rejection();f.transport.send.mockRejectedValueOnce(error);
    await expect(adapter.submitLimit(f.prepared as never)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);expect(f.storage.has(key)).toBe(false);
    await adapter.submitLimit(f.prepared as never);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase,txHash});
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps a rejected Limit request locked while its nonce is pending, then releases it in recovery and permits it again',async()=>{
    const f=browser(),adapter=f.make(),error=rejection();let pendingNonce=4;
    f.transport.readNativeResources.mockImplementation(async head=>({owner,chainId,head:{...head},latestNonce:4,pendingNonce,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'}));
    f.transport.send.mockImplementationOnce(async()=>{pendingNonce=5;throw error;});
    await expect(adapter.submitLimit(f.prepared as never)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'limit-create',txHash:null,walletRejected:true});
    await expect(adapter.recoverPendingLimitAttempt()).rejects.toThrow('The reserved wallet nonce is used or pending');
    expect(f.storage.has(key)).toBe(true);pendingNonce=4;
    expect(await adapter.recoverPendingLimitAttempt()).toMatchObject({status:'released-unsent',readyToSign:false});
    expect(f.storage.has(key)).toBe(false);
    await adapter.submitLimit(f.prepared as never);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'limit-create',txHash});
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps an unknown wallet result locked',async()=>{
    const f=browser(),adapter=f.make();f.transport.send.mockRejectedValueOnce(new Error('TEST_UNKNOWN_LIMIT_SEND'));
    await expect(adapter.submitLimit(f.prepared as never)).rejects.toThrow('TEST_UNKNOWN_LIMIT_SEND');
    const saved=JSON.parse(f.storage.get(key)!);expect(saved).toMatchObject({phase:'limit-create',txHash:null});expect(saved.walletRejected).toBeUndefined();
    expect(await adapter.recoverPendingLimitAttempt()).toMatchObject({status:'manual-reconciliation-required',readyToSign:false});
    expect(f.storage.has(key)).toBe(true);expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
