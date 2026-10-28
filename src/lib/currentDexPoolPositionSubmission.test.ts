
import { toBeHex, keccak256, Interface } from '@coti-io/coti-ethers';
import { POOL_EXIT_PREVIEW_ABI } from './currentDexPoolExitPreview';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentPoolPositionSubmissionAdapter, assertCurrentPoolPositionNativeAdmission } from './currentDexPoolPositionSubmission';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi } from './currentDexPoolPosition';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as c, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key } from './currentDexPendingAttempt';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { currentNativePoolSnapshotAbi } from './currentDexNativePoolSnapshot';
const preparedAdmission=vi.hoisted(()=>({allowed:false}));
const localSubmissionAuthority=vi.hoisted(()=>({allowed:false}));
vi.mock('./currentDexC1SwapPolicy',async importOriginal=>{
  const actual=await importOriginal<typeof import('./currentDexC1SwapPolicy')>();
  return {...actual,assertCurrentAppPoolAuthority:(...args:Parameters<typeof actual.assertCurrentAppPoolAuthority>)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentAppPoolAuthority(...args);
  },assertCurrentD06AppAuthority:(graph:string)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentD06AppAuthority(graph);
  }};
});
vi.mock('./dexV2Deployment',async importOriginal=>{
  const actual=await importOriginal<typeof import('./dexV2Deployment')>();
  return {...actual,assertCurrentCheapDexNativeAdmission:(candidate:typeof actual.ARCHIVED_CHEAP_DEX_CANDIDATE)=>{
    if(candidate.graph===actual.ARCHIVED_CHEAP_DEX_CANDIDATE.graph)return;
    if(preparedAdmission.allowed&&(candidate.graph===actual.STAGED_PREPARED_DEX_CANDIDATE.graph||candidate.graph===actual.STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph||candidate.graph===actual.STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph))return;
    actual.assertCurrentCheapDexNativeAdmission(candidate);
  }};
});
// Adapter-only brand mock. Genuine issuer/result checks are in the owner capability tests.
const brands=vi.hoisted(()=>new WeakMap<object,object>());
vi.mock('../features/wallet/currentDexPoolPositionCapability',()=>({assertCurrentPoolPositionPrepared:(value:object,signer:object)=>{
  if(brands.get(value)!==signer)throw new Error('Wrong owner session');
}}));
const owner=`0x${'22'.repeat(20)}`,hash=toBeHex(30n,32),txHash=toBeHex(31n,32),context=toBeHex(32n,32),chainId=BigInt(c.chainId);
describe('shared-history scoped ownership admission',()=>{
  it.each(['snapshot','transfer','activate','resume','close']as const)('admits only the exact native-qualified %s phase',action=>{
    expect(()=>assertCurrentPoolPositionNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'),action)).not.toThrow();
  });
  it.each(['withdraw']as const)('keeps unqualified %s on its separate gate',action=>{
    expect(()=>assertCurrentPoolPositionNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'),action)).toThrow('admission');
  });
  it.each(['preview','withdrawal']as const)('admits the exact previewed withdrawal %s phase',phase=>{
    expect(()=>assertCurrentPoolPositionNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'),'withdraw',false,phase)).not.toThrow();
  });
  it('admits the separately qualified closed snapshot',()=>{
    expect(()=>assertCurrentPoolPositionNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'),'snapshot',true)).not.toThrow();
  });
  it.each(['core','packageSha256','chainId','companions']as const)('rejects changed %s descriptor before phase admission',field=>{
    const expected=resolveCurrentCheapDexCandidate('cheap-history'),changed={...expected,[field]:field==='companions'?[]:'changed'};
    expect(()=>assertCurrentPoolPositionNativeAdmission(changed as never,'transfer')).toThrow();
  });
});
function fixture(selectedOwner=owner){
  const owner=selectedOwner;
  const storage=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  const signer={},guard=vi.fn(async()=>{}),result={action:'close',positionId:8n,payouts:[200n,100n]};
  const prepared={chainId,from:owner,to:c.core as string,value:0n as bigint,data:abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']),graph:c.graph as string,
    packageSha256:c.packageSha256 as string,positionId:8n,action:'close' as string,recipient:null as string|null,readyToSign:false,assertCurrent:guard,assertBeforeSend:guard,readResult:vi.fn(async()=>result)};
  brands.set(prepared,signer);
  let tx:Record<string,unknown>|null=null;
  const receipt={hash:txHash,status:1,from:owner,to:c.core as string,blockNumber:10,blockHash:hash,logs:[{address:c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],
    ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,8n])}]as{address:string;topics:string[];data:string}[]};
  const transport={verifyCanonicalInclusion:vi.fn(async()=>{}),assertCurrent:guard,estimateGas:vi.fn(async()=>1n),readHead:vi.fn(async()=>({number:10n,hash,timestamp:100n,gasLimit:120_000_000n})),
    readNativeResources:vi.fn(async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head:{...head},latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})),
    readNonce:vi.fn(async()=>4),readBlockHash:vi.fn(async()=>hash),send:vi.fn(async request=>{tx={...request,hash:txHash,blockNumber:10,blockHash:hash};return {...request,hash:txHash};}),
    readTransaction:vi.fn(async()=>tx),waitForReceipt:vi.fn(async()=>receipt)};
  const make=(identity=signer,candidate:CurrentCheapDexCandidateKey='cheap-archived')=>createCurrentPoolPositionSubmissionAdapter({candidate,signer:identity,chainId,ownerAddress:owner,transport:transport as never,attest:async()=>{},now:()=>100n});
  return{prepared,storage,transport,receipt,make,result,tx:()=>tx!};
}
// Only local sender-mechanics tests may bypass the connected-App hold.
// The real hold stays active in admission-boundary tests and by default.
function allowLocalTechnicalSubmission(){localSubmissionAuthority.allowed=true;}

// Synthetic sender wiring only. The real prepared admission remains held.
function preparedFixture(candidateKey:CurrentCheapDexCandidateKey='cheap-prepared',selectedOwner=owner){
  const f=fixture(selectedOwner),candidate=resolveCurrentCheapDexCandidate(candidateKey);
  Object.assign(f.prepared,{graph:candidate.graph,packageSha256:candidate.packageSha256,to:candidate.core,
    action:'snapshot',positionId:8n,closed:false,replacementFrom:undefined,data:currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[8n])});
  f.receipt.to=candidate.core;f.receipt.logs=[{address:candidate.core,
    ...currentNativePoolSnapshotAbi.encodeEventLog(currentNativePoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[8n,context,
      Array.from({length:10},()=>({ciphertextHigh:1n,ciphertextLow:2n}))])}];
  f.transport.estimateGas.mockResolvedValue(1n);
  return{...f,candidate,adapter:f.make(undefined,candidateKey)};
}

describe.each(['cheap-prepared','cheap-exit','cheap-history'] as const)('%s owner snapshot sender boundary',candidateKey=>{
  it.skipIf(candidateKey!=='cheap-history')('joins a real engineering owner snapshot to the shared sender',async()=>{
    const f=preparedFixture(candidateKey,'0x8b749251cf1f712d4e39fd048c53394af03e10be');
    const sent=await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(sent.transactionHash).toBe(txHash);expect(f.transport.send).toHaveBeenCalledOnce();
    expect(String(f.tx().from).toLowerCase()).toBe(f.prepared.from.toLowerCase());
    expect(f.tx()).toMatchObject({to:f.candidate.core,gasLimit:30_000_000n});
  });
  it('keeps real admission held before estimation or send',async()=>{
    const f=preparedFixture(candidateKey);await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(candidateKey==='cheap-history'?'App signing hold remains active':'admission is absent');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('rejects unsupported prepared management without a historical fallback',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;f.prepared.action='withdraw';
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('action integration is incomplete');expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps prepared Close held before estimate/send',async()=>{
    const f=preparedFixture(candidateKey);f.prepared.action='close';f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(candidateKey==='cheap-history'?'App signing hold remains active':'admission is absent');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.skipIf(candidateKey==='cheap-prepared')('keeps the real connected-App hold after prepared admission',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(candidateKey==='cheap-history'?'Shared-history DEX App signing hold':'connected App-wallet hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains prepared Close recovery until the financial result is checked',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;if(candidateKey!=='cheap-prepared')allowLocalTechnicalSubmission();f.prepared.action='close';f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']);
    f.receipt.logs=[{address:f.candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],
      ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,8n])}];
    f.prepared.readResult.mockResolvedValue({...f.result,status:'closed-proof-required',privateAccountingVerified:false} as never);
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(await f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).toMatchObject({status:'closed-proof-required',privateAccountingVerified:false});
    expect(f.transport.send).toHaveBeenCalledOnce();expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('retains same-session authenticated recovery without repeating the send',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;if(candidateKey!=='cheap-prepared')allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    await expect(f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).resolves.toEqual(f.result);
    expect(f.prepared.readResult).toHaveBeenCalledOnce();expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
  });
  it('allows the next snapshot source while blocking a repeat of the same source',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;if(candidateKey!=='cheap-prepared')allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{replacementFrom:toBeHex(40n,32)});
    const first=await f.adapter.submitPoolPositionAction(f.prepared as never);await first.recover();
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('already submitted');
    Object.assign(f.prepared,{replacementFrom:toBeHex(41n,32)});
    f.transport.readNonce.mockResolvedValue(5);
    const resources=f.transport.readNativeResources.getMockImplementation()!;
    f.transport.readNativeResources.mockImplementation(async head=>({...await resources(head),latestNonce:5,pendingNonce:5}));
    const next=await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(next.request.nonce).toBe(5);expect(f.transport.send).toHaveBeenCalledTimes(2);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it.each(['private','block','logs','topics','transaction','inclusion'])('keeps pending after %s fails during authenticated proof',async fault=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;if(candidateKey!=='cheap-prepared')allowLocalTechnicalSubmission();const sent=await f.adapter.submitPoolPositionAction(f.prepared as never);
    f.prepared.readResult.mockImplementationOnce(async()=>{
      if(fault==='private')throw new CurrentPoolProofMismatch('Private snapshot changed.');
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='logs')f.receipt.logs.push({address:f.candidate.core,topics:[],data:'0x'});
      if(fault==='topics')f.receipt.logs[0].topics.push(toBeHex(999n,32));
      if(fault==='transaction')f.tx().nonce=999;
      if(fault==='inclusion')f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('Missing canonical inclusion'));
      return f.result;
    });
    await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);expect(f.transport.send).toHaveBeenCalledOnce();
    if(fault==='private'){
      expect(JSON.parse(f.storage.get(key)!).verificationBlocked).toBe(true);
      await expect(f.make(undefined,candidateKey).recoverPendingPoolPositionAttempt()).resolves.toMatchObject({status:'manual-reconciliation-required'});
    }
  });
  it('requires canonical inclusion and returns only metadata after signer reload',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;if(candidateKey!=='cheap-prepared')allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    const fresh=f.make({},candidateKey);expect(await fresh.recoverCurrentPreparedPoolPositionResult()).toBeNull();
    expect(await fresh.recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-mined',privateAccountingVerified:false,readyToSign:false});
    expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled();expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe.each(['cheap-exit','cheap-history']as const)('%s exit action sender uses the shared canonical boundary', candidateKey => {
  const exitFixture = (phase: 'preview' | 'withdrawal') => {
    const f = preparedFixture(candidateKey), action = phase === 'preview' ? 11n : 12n;
    Object.assign(f.prepared, { action: 'withdraw', exitPhase: phase, data: abi.encodeFunctionData('managePoolPosition', [8n, context, action, '0x']) });
    const host = new Interface(POOL_EXIT_PREVIEW_ABI);
    f.receipt.logs = phase === 'preview' ? [{ address: f.candidate.core,
      ...host.encodeEventLog(host.getEvent('PoolExitPreviewed')!, [8n, context, [1n, 2n, 3n, 4n, 5n, 6n].map(v => [1n, v])]) }] : [];
    return f;
  };
  it.each(['preview', 'withdrawal'] as const)('keeps %s admission held before estimate or send', async phase => {
    const f = exitFixture(phase); await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(candidateKey==='cheap-history'?'App signing hold remains active':'admission is absent');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['preview', 'withdrawal'] as const)('retains %s private recovery and its 100M fit cap without a second send', async phase => {
    const f = exitFixture(phase); preparedAdmission.allowed = true; allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(f.transport.send.mock.calls[0][0].gasLimit).toBe(100_000_000n);
    expect(await f.make(undefined, candidateKey).recoverCurrentPreparedPoolPositionResult()).toEqual(f.result);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['preview', 'withdrawal'] as const)('returns only %s metadata after a signer reload', async phase => {
    const f = exitFixture(phase); preparedAdmission.allowed = true; allowLocalTechnicalSubmission(); await f.adapter.submitPoolPositionAction(f.prepared as never);
    const fresh = f.make({}, candidateKey); expect(await fresh.recoverCurrentPreparedPoolPositionResult()).toBeNull();
    expect(await fresh.recoverPendingPoolPositionAttempt()).toMatchObject({ status: 'observed-mined', privateAccountingVerified: false });
    expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each(['legacy', 'phase', 'headroom', 'identity'] as const)('refuses %s before sending exit action', async fault => {
    const f = exitFixture('withdrawal'); preparedAdmission.allowed = true;
    if (fault === 'legacy') f.prepared.data = abi.encodeFunctionData('managePoolPosition', [8n, context, 1n, '0x']);
    if (fault === 'phase') f.prepared.data = abi.encodeFunctionData('managePoolPosition', [8n, context, 11n, '0x']);
    if (fault === 'headroom') f.transport.readHead.mockResolvedValue({ number: 10n, hash, timestamp: 100n, gasLimit: 110_000_000n });
    const adapter = fault === 'identity' ? f.make(undefined, 'cheap-prepared') : f.adapter;
    await expect(adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['preview', 'withdrawal'] as const)('keeps %s pending on a known financial proof failure', async phase => {
    const f = exitFixture(phase); preparedAdmission.allowed = true; allowLocalTechnicalSubmission(); const sent = await f.adapter.submitPoolPositionAction(f.prepared as never);
    f.prepared.readResult.mockRejectedValue(new CurrentPoolProofMismatch('Financial proof failed'));
    await expect(sent.recover()).rejects.toThrow('Financial proof failed'); expect(JSON.parse(f.storage.get(key)!).verificationBlocked).toBe(true);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe.each(['cheap-exit','cheap-history']as const)('%s prepared ownership sender',candidateKey=>{
  it.each(['transfer','activate','resume'] as const)('keeps authenticated %s recovery in the same signer without another send',async action=>{
    const f=preparedFixture(candidateKey),recipient=`0x${'33'.repeat(20)}`,nft=f.candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    Object.assign(f.prepared,{action,to:action==='transfer'?nft:f.candidate.core,recipient:action==='transfer'?recipient:null,
      data:action==='transfer'?nftAbi.encodeFunctionData('safeTransferFrom',[owner,recipient,8n]):abi.encodeFunctionData('managePoolPosition',[8n,context,action==='activate'?6n:5n,'0x'])});
    f.receipt.to=f.prepared.to;f.receipt.logs=action==='transfer'?[{address:nft,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,8n])}]:[];
    const result={action,positionId:8n,status:'owner-action-verified',privateAccountingVerified:true};f.prepared.readResult.mockResolvedValue(result as never);
    preparedAdmission.allowed=true;allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(await f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).toEqual(result);
    expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
  });
  it('rejects encrypted or extra inputs to Activate before signing',async()=>{
    const f=preparedFixture(candidateKey);preparedAdmission.allowed=true;allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{action:'activate',data:abi.encodeFunctionData('managePoolPosition',[8n,context,6n,'0x11'])});
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('Invalid current');expect(f.transport.send).not.toHaveBeenCalled();
  });
});
afterEach(()=>{ preparedAdmission.allowed=false;localSubmissionAuthority.allowed=false;vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('current liquidity owner coordinated sender',()=>{
  it('sends one Close with30M cap and clears only after authenticated private result',async()=>{
    const f=fixture(),sender=f.make(),sent=await sender.submitPoolPositionAction(f.prepared as never);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasLimit:30_000_000n,nonce:4,data:f.prepared.data}),expect.any(Function));expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'pool-owner',nonce:4});expect(await sent.recover()).toBe(f.result);expect(f.storage.has(key)).toBe(false);
    await expect(sender.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('already submitted');
  });
  it.each(['forged','session','graph','package','owner','chain','target','value','method','id','suffix'])('rejects %s before send',async fault=>{
    const f=fixture();if(fault==='forged')f.prepared={...f.prepared};if(fault==='graph')f.prepared.graph='00'.repeat(32);if(fault==='package')f.prepared.packageSha256='00'.repeat(32);
    if(fault==='owner')f.prepared.from=c.core;if(fault==='chain')f.prepared.chainId=1n;if(fault==='target')f.prepared.to=owner;if(fault==='value')f.prepared.value=1n;
    if(fault==='method')f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,1n,'0x']);if(fault==='id')f.prepared.positionId=9n;if(fault==='suffix')f.prepared.data+='00';
    await expect(f.make(fault==='session'?{}:undefined).submitPoolPositionAction(f.prepared as never)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['withdraw','transfer','activate','resume'])('sends %s at its source-bound native cap and reconciles reload metadata only',async action=>{
    const f=fixture();f.prepared.action=action;
    if(action==='transfer'){f.prepared.recipient=`0x${'33'.repeat(20)}`;f.prepared.to=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];f.prepared.data=nftAbi.encodeFunctionData('safeTransferFrom',[owner,f.prepared.recipient,8n]);}
    else f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,{withdraw:1n,activate:6n,resume:5n}[action], '0x']);
    const cap=action==='withdraw'?100_000_000n:action==='transfer'?10_000_000n:30_000_000n;
    if(action==='transfer'){f.receipt.to=f.prepared.to;f.receipt.logs=[{address:f.prepared.to,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,f.prepared.recipient,8n])}];}
    const sent=await f.make().submitPoolPositionAction(f.prepared as never);expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasLimit:cap}),expect.any(Function));
    expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(sent.request.gasLimit).toBe(cap);
    const observed=await f.make().recoverPendingPoolPositionAttempt();expect(observed).toMatchObject({status:'observed-mined'});expect(observed).not.toHaveProperty('payouts');expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each([['withdraw',110_000_000n],['transfer',11_000_000n],['activate',33_333_333n],['resume',33_333_333n]]as const)('requires fresh headroom for %s cap',async(action,gasLimit)=>{
    const f=fixture();f.prepared.action=action;
    if(action==='transfer'){f.prepared.recipient=`0x${'33'.repeat(20)}`;f.prepared.to=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];f.prepared.data=nftAbi.encodeFunctionData('safeTransferFrom',[owner,f.prepared.recipient,8n]);}
    else f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,{withdraw:1n,activate:6n,resume:5n}[action],'0x']);
    f.transport.readHead.mockResolvedValue({number:10n,hash,timestamp:100n,gasLimit});
    await expect(f.make().submitPoolPositionAction(f.prepared as never)).rejects.toThrow('headroom');expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['headroom','nonce','wallet','pending'])('blocks %s signing changes',async fault=>{
    const f=fixture();if(fault==='headroom')f.transport.readHead.mockResolvedValue({number:10n,hash,timestamp:100n,gasLimit:33_333_333n});
    if(fault==='nonce')f.transport.readNonce.mockResolvedValueOnce(4).mockResolvedValueOnce(5);if(fault==='wallet')f.prepared.assertBeforeSend.mockRejectedValue(new Error('Revoked'));
    if(fault==='pending')f.storage.set(key,JSON.stringify({version:1,chainId:chainId.toString(),owner,core:c.core,graph:`0x${c.graph}`,phase:'quote',callHash:context,nonce:3,txHash:null}));
    await expect(f.make().submitPoolPositionAction(f.prepared as never)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['private','reorg','nonce','gas','unknown'])('retains pending metadata on %s result failure',async fault=>{
    const f=fixture(),sent=await f.make().submitPoolPositionAction(f.prepared as never);
    if(fault==='private')f.prepared.readResult.mockRejectedValue(new Error('Bad private payout'));if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(context);
    if(fault==='nonce')f.tx().nonce=5;if(fault==='gas')f.tx().gasLimit=29_000_000n;if(fault==='unknown')f.transport.readTransaction.mockResolvedValue(null);
    await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);
  });
  it('canonical status0 permits only a new safe attempt; reload status1 returns metadata only',async()=>{
    const f=fixture(),sender=f.make();await sender.submitPoolPositionAction(f.prepared as never);f.receipt.status=0;
    expect(await sender.recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-reverted'});expect(f.storage.has(key)).toBe(false);
    await sender.submitPoolPositionAction(f.prepared as never);f.receipt.status=1;
    const publicResult=await f.make().recoverPendingPoolPositionAttempt();expect(publicResult).toMatchObject({status:'observed-mined'});expect(publicResult).not.toHaveProperty('payouts');expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
});


describe('selected Pool position submission candidate',()=>{
  it('rejects cross-candidate preparation',async()=>{const f=fixture();await expect(f.make(undefined,'cheap-native').submitPoolPositionAction(f.prepared as never)).rejects.toThrow('owner candidate');expect(f.transport.send).not.toHaveBeenCalled();});
  it('uses the selected NFT destination check before the native write hold',async()=>{
    const f=fixture(),selected=resolveCurrentCheapDexCandidate('cheap-native'),selectedNft=selected.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    Object.assign(f.prepared,{to:selectedNft,graph:selected.graph,packageSha256:selected.packageSha256,action:'transfer',recipient:`0x${'33'.repeat(20)}`,data:nftAbi.encodeFunctionData('safeTransferFrom',[owner,`0x${'33'.repeat(20)}`,8n])});
    await expect(f.make(undefined,'cheap-native').submitPoolPositionAction(f.prepared as never)).rejects.toThrow('issued current native Pool session');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
    f.prepared.to=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];await expect(f.make(undefined,'cheap-native').submitPoolPositionAction(f.prepared as never)).rejects.toThrow('issued current native Pool session');
  });
  it('keeps archived recovery separate from selected native recovery',async()=>{const f=fixture();await f.make().submitPoolPositionAction(f.prepared as never);await expect(f.make(undefined,'cheap-native').recoverPendingPoolPositionAttempt()).rejects.toThrow('another owner');expect(f.storage.size).toBe(1);expect(await f.make(undefined,'cheap-archived').recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-mined'});});
  it('proves selected native transfer logs and destination during read-only recovery',async()=>{
    const f=fixture(),selected=resolveCurrentCheapDexCandidate('cheap-native'),nft=selected.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],recipient=`0x${'33'.repeat(20)}`;
    await f.make().submitPoolPositionAction(f.prepared as never);const data=nftAbi.encodeFunctionData('safeTransferFrom',[owner,recipient,8n]),p=JSON.parse(f.storage.get(key)!);
    f.storage.set(key,JSON.stringify({...p,core:selected.core.toLowerCase(),graph:`0x${selected.graph}`,phase:'pool-transfer',callHash:keccak256(data).toLowerCase()}));Object.assign(f.tx(),{to:nft,data,gasLimit:10_000_000n});f.receipt.to=nft;f.receipt.logs=[{address:nft,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,8n])}];
    expect(await f.make(undefined,'cheap-native').recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-mined'});expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
});


it('rejects changed candidate metadata in the retained position recovery closure',async()=>{const f=fixture(),sent=await f.make().submitPoolPositionAction(f.prepared as never),p=JSON.parse(f.storage.get(key)!);f.storage.set(key,JSON.stringify({...p,graph:`0x${resolveCurrentCheapDexCandidate('cheap-native').graph}`}));await expect(sent.recover()).rejects.toThrow('pending attempt changed');expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.storage.size).toBe(1);});


describe('archived owner canonical completion boundary',()=>{
  it.each(['close','transfer'].flatMap(action=>['none','private','block','status','logs','topics','transaction','missing'].map(fault=>[action,fault])))('retained %s closure handles %s after private proof',async(action,fault)=>{
    const f=fixture(), native=resolveCurrentCheapDexCandidate('cheap-archived');
    // Archived adapter boundary only; no native admission bypass.

    Object.assign(f.prepared,{to:native.core,graph:native.graph,packageSha256:native.packageSha256});
    f.receipt.to=native.core; f.receipt.logs[0].address=native.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    f.transport.estimateGas.mockResolvedValue(1n);
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    Object.assign(f.transport,{readNativeResources:async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head,latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})});
    const adapter=f.make(undefined,'cheap-archived');
    if(action==='transfer'){
      const nft=native.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],recipient=`0x${'33'.repeat(20)}`;
      Object.assign(f.prepared,{action:'transfer',recipient,to:nft,data:nftAbi.encodeFunctionData('safeTransferFrom',[owner,recipient,8n])});f.receipt.to=nft;
      f.receipt.logs=[{address:nft,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,8n])}];
    }
    const sent=await adapter.submitPoolPositionAction(f.prepared as never);
    f.prepared.readResult.mockImplementationOnce(async()=>{
      if(fault==='private')throw new Error('Private proof failed');
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=0;
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='topics'){if(f.receipt.logs.length)f.receipt.logs[0].topics.push(toBeHex(999n,32));else f.receipt.logs.push({address:native.core,topics:[toBeHex(999n,32)],data:'0x'});}
      if(fault==='transaction')f.tx().nonce=999;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
      return f.result;
    });
    if(fault==='none'){await expect(sent.recover()).resolves.toEqual(f.result);expect(f.storage.has(key)).toBe(false);}
    else{await expect(sent.recover()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);}
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([0,1].flatMap(status=>['none','logs','block','status','transaction','missing'].map(fault=>[status,fault] as const)))('metadata status %s handles %s at final read',async(status,fault)=>{
    const f=fixture(), native=resolveCurrentCheapDexCandidate('cheap-archived');
    // Archived adapter boundary only; no native admission bypass.

    Object.assign(f.prepared,{to:native.core,graph:native.graph,packageSha256:native.packageSha256});
    f.receipt.to=native.core; f.receipt.logs[0].address=native.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    f.transport.estimateGas.mockResolvedValue(1n);
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    Object.assign(f.transport,{readNativeResources:async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head,latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})});
    const adapter=f.make(undefined,'cheap-archived');
    await adapter.submitPoolPositionAction(f.prepared as never);f.receipt.status=status;
    let reads=0;f.transport.waitForReceipt.mockImplementation(async()=>{if(++reads===3){
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=status===0?1:0;
      if(fault==='transaction')f.receipt.from=native.core;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
    }return f.receipt;});
    if(fault==='none'){await expect(adapter.recoverPendingPoolPositionAttempt()).resolves.toMatchObject({status:status===0?'observed-reverted':'observed-mined'});expect(f.storage.has(key)).toBe(false);}else{await expect(adapter.recoverPendingPoolPositionAttempt()).rejects.toThrow();expect(f.storage.has(key)).toBe(true);}expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
