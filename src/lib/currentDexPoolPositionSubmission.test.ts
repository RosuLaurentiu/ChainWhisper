
import { toBeHex, Interface } from '@coti-io/coti-ethers';
import { POOL_EXIT_PREVIEW_ABI } from './currentDexPoolExitPreview';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentPoolPositionSubmissionAdapter, assertCurrentPoolPositionNativeAdmission } from './currentDexPoolPositionSubmission';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi } from './currentDexPoolPosition';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as c, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key, CURRENT_POOL_REFRESH_ATTEMPT_KEY } from './currentDexPendingAttempt';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { currentNativePoolSnapshotAbi } from './currentDexNativePoolSnapshot';
import { STAGED_GAP_DEX_CANDIDATE as currentGap } from './currentDexGapCandidate';
import { wasCurrentDexUnsentReleased } from './currentDexSendBoundary';
import { currentDexNormalUseReloadKey } from './currentDexNativeReload';
// CW-086: only a registered signer has the browser wallet context. Every other signer keeps the engineering path.
const browserContexts=vi.hoisted(()=>new WeakMap<object,{owner:string}>());
vi.mock('../features/wallet/ownerCotiMetaMaskCapability',()=>({hasCurrentDexBrowserSigner:(signer:object|undefined,owner:string)=>
  !!signer&&browserContexts.get(signer)?.owner===owner.toLowerCase()}));
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
// Adapter-only brand mock. Genuine issuer/result checks are in the owner capability tests.
const brands=vi.hoisted(()=>new WeakMap<object,object>());
vi.mock('../features/wallet/currentDexPoolPositionCapability',()=>({assertCurrentPoolPositionPrepared:(value:object,signer:object)=>{
  if(brands.get(value)!==signer)throw new Error('Wrong owner session');
},assertVerifiedCurrentPoolSnapshot:(value:object,signer:object)=>{
  if(brands.get(value)!==signer)throw new Error('Unverified snapshot result');
},assertVerifiedSupersededPoolSnapshot:(value:object,signer:object)=>{
  if(brands.get(value)!==signer)throw new Error('Unverified recovery result');
}}));
vi.mock('../features/wallet/currentDexPoolFundingCapability',()=>({assertCurrentPoolFundingPrepared:(value:object,signer:object)=>{
  if(brands.get(value)!==signer)throw new Error('Wrong top-up owner session');
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
  const make=(identity=signer,candidate:CurrentCheapDexCandidateKey='cheap-history',attest:(head:{number:bigint;hash:string})=>Promise<void>=async()=>{})=>createCurrentPoolPositionSubmissionAdapter({candidate,signer:identity,chainId,ownerAddress:owner,transport:transport as never,attest,now:()=>100n});
  return{prepared,storage,transport,receipt,make,result,signer,tx:()=>tx!};
}
// Only local sender-mechanics tests may bypass the connected-App hold.
// The real hold stays active in admission-boundary tests and by default.
function allowLocalTechnicalSubmission(){localSubmissionAuthority.allowed=true;}

// Synthetic sender wiring only. The real prepared admission remains held.
function preparedFixture(candidateKey:CurrentCheapDexCandidateKey='cheap-history',selectedOwner=owner){
  const f=fixture(selectedOwner),candidate=resolveCurrentCheapDexCandidate(candidateKey);
  Object.assign(f.prepared,{graph:candidate.graph,packageSha256:candidate.packageSha256,to:candidate.core,
    action:'snapshot',positionId:8n,closed:false,replacementFrom:undefined,data:currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[8n])});
  f.receipt.to=candidate.core;f.receipt.logs=[{address:candidate.core,
    ...currentNativePoolSnapshotAbi.encodeEventLog(currentNativePoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[8n,context,
      Array.from({length:10},()=>({ciphertextHigh:1n,ciphertextLow:2n}))])}];
  f.transport.estimateGas.mockResolvedValue(1n);
  return{...f,candidate,adapter:f.make(undefined,candidateKey)};
}

describe('held top-up snapshot release after owner review (CW-135)',()=>{
  it.each(['approved','declined','no-review','accounting-failure','funding-missing','other-position','not-top-up','funding-reverted','funding-after','superseded','forged','closed','changed-record'] as const)(
    'releases only a proved and reviewed record: %s',async fault=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const fundingHash=toBeHex(77n,32),snapshotTx=f.tx();
    const pending={...JSON.parse(f.storage.get(key)!),verificationBlocked:true,poolTopUpHash:fundingHash,
      verificationFailure:fault==='accounting-failure'?'top-up-accounting':'pool-proof'};
    const original=JSON.stringify(pending);f.storage.set(key,original);
    const fundingTx={chainId,from:owner,to:f.candidate.core,value:0n,nonce:3,gasLimit:100_000_000n,hash:fundingHash,blockNumber:fault==='funding-after'?10:9,blockHash:toBeHex(29n,32),
      data:abi.encodeFunctionData('managePoolPosition',[fault==='other-position'?9n:8n,context,fault==='not-top-up'?7n:0n,'0x'])};
    const fundingReceipt={hash:fundingHash,status:fault==='funding-reverted'?0:1,from:owner,to:f.candidate.core,blockNumber:fundingTx.blockNumber,blockHash:fundingTx.blockHash,logs:[]};
    f.transport.readTransaction.mockImplementation((async(h:string)=>h===fundingHash?fault==='funding-missing'?null:fundingTx:snapshotTx) as never);
    f.transport.waitForReceipt.mockImplementation((async(h:string)=>h===fundingHash?fundingReceipt:f.receipt) as never);
    f.transport.readBlockHash.mockImplementation((async(n:number)=>n===fundingTx.blockNumber&&fault!=='funding-after'?fundingTx.blockHash:hash) as never);
    const proof={action:'snapshot',positionId:8n,transactionHash:txHash,producerHash:txHash,
      status:fault==='superseded'?'superseded-snapshot-recovery-only':'active-snapshot-verified',privateAccountingVerified:false,readyToSign:false,
      producer:{status:fault==='closed'?4n:1n,revisions:[2n,1n,1n,1n],amounts:{shares:150n,totalShares:1000n}},
      snapshot:{chainId,owner,core:f.candidate.core,graph:f.candidate.graph,packageSha256:f.candidate.packageSha256}};
    if(fault!=='forged')brands.set(proof,f.signer);
    const verify=vi.fn(async()=>{if(fault==='changed-record')f.storage.set(key,JSON.stringify({...pending,nonce:8}));return proof;});
    const review=vi.fn(async()=>fault!=='declined');
    const run=()=>f.adapter.recoverPendingPoolPositionAttempt(verify as never,fault==='no-review'?undefined:review);
    if(fault==='approved'){
      expect(await run()).toBe(proof);
      expect(review).toHaveBeenCalledWith({positionId:8n,fundingHash,snapshotHash:txHash,shares:150n,totalShares:1000n});
      expect(f.storage.has(key)).toBe(false);
      const archives=[...f.storage.entries()].filter(([k])=>k.startsWith('chainwhisper:dex:reviewed-top-up-snapshot:v1:'));
      expect(archives).toHaveLength(1);
      expect(JSON.parse(archives[0][1])).toEqual({original,verification:'owner-reviewed-top-up-snapshot-current-state',blockHash:hash,
        fundingBlockHash:fundingTx.blockHash,intervalAccounting:'not-reconstructed'});
      expect(archives[0][1]).not.toContain('150');
    }else if(['declined','no-review','accounting-failure'].includes(fault)){
      // CW-140.02: the mined top-up moves to the review list of its position; the saved-action record is free.
      const reviewable=fault!=='accounting-failure';
      expect(await run()).toMatchObject({status:'moved-to-position-review',positionId:8n,reviewable});
      expect(f.storage.has(key)).toBe(false);
      const reviews=[...f.storage.entries()].filter(([k])=>k.startsWith('chainwhisper:dex:position-review:v1:'));
      expect(reviews).toHaveLength(1);
      expect(JSON.parse(reviews[0][1])).toEqual([expect.objectContaining({positionId:'8',original,reviewable,
        fundingBlockHash:reviewable?fundingTx.blockHash:null,verificationFailure:reviewable?'pool-proof':'top-up-accounting'})]);
      if(fault!=='declined'){expect(verify).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();}
      if(reviewable){
        // CW-140.09: receipts alone release it (old state can be pruned); no dialog and no old-state read.
        verify.mockClear();review.mockClear();
        expect(await f.adapter.releasePositionReview(txHash)).toEqual({status:'released',positionId:8n,transactionHash:txHash});
        expect(verify).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
        expect([...f.storage.keys()].some(k=>k.startsWith('chainwhisper:dex:position-review:v1:'))).toBe(false);
        const archived=[...f.storage.entries()].filter(([k])=>k.startsWith('chainwhisper:dex:reviewed-position:v1:'));
        expect(archived).toHaveLength(1);expect(JSON.parse(archived[0][1])).toEqual({original,verification:'mined-top-up-receipts-rechecked',
          blockHash:hash,fundingBlockHash:fundingTx.blockHash,intervalAccounting:'not-reconstructed'});
        expect(await f.adapter.releasePositionReview(txHash)).toBeNull();
      }else await expect(f.adapter.releasePositionReview(txHash)).rejects.toThrow('manual reconciliation');
    }else{
      await expect(run()).rejects.toThrow();
      expect(f.storage.has(key)).toBe(true);expect(review).not.toHaveBeenCalled();
      expect([...f.storage.keys()].some(k=>k.startsWith('chainwhisper:dex:reviewed-top-up-snapshot:'))).toBe(false);
    }
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
describe.runIf(resolveCurrentCheapDexCandidate('cheap-history').graph===currentGap.graph)('initial-claim snapshot hold recovery',()=>{
  for(const recoveryOnly of [false,true])it.each(['success','independent','revision','closed','forged','wrong-owner','wrong-hash','wrong-chain','wrong-core','wrong-graph','wrong-package',
    'top-up','target','operation','other-failure','reverted','changed-record','storage-failure','archive-readback','slot-after-archive','reorg'] as const)(`retains ${recoveryOnly?'superseded':'current'} proof and never resends: %s`,async fault=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const pending={...JSON.parse(f.storage.get(key)!),verificationBlocked:true,verificationFailure:'snapshot-financial-state',
      ...(fault==='top-up'?{poolTopUpHash:toBeHex(99n,32)}:{}),...(fault==='target'?{target:toBeHex(99n,20)}:{}),
      ...(fault==='operation'?{operationId:'99'}:{}),...(fault==='other-failure'?{verificationFailure:'snapshot-envelope'}:{})};
    const original=JSON.stringify(pending);f.storage.set(key,original);
    if(fault==='independent'){
      const held=JSON.stringify({...pending,nonce:3,txHash:toBeHex(98n,32)});
      f.storage.set(key,held);f.storage.set(CURRENT_POOL_REFRESH_ATTEMPT_KEY,JSON.stringify({original:held,attempt:original}));
    }
    if(fault==='reverted')f.receipt.status=0;
    const currentProof={action:'snapshot',positionId:8n,transactionHash:fault==='wrong-hash'?toBeHex(99n,32):txHash,producerHash:txHash,
      status:'active-snapshot-verified',privateAccountingVerified:false,readyToSign:false,
      producer:{status:fault==='closed'?4n:1n,revisions:[fault==='revision'?2n:1n,1n,1n,1n]},
      snapshot:{chainId:fault==='wrong-chain'?1n:chainId,owner:fault==='wrong-owner'?toBeHex(1n,20):owner,core:fault==='wrong-core'?toBeHex(1n,20):f.candidate.core,
        graph:fault==='wrong-graph'?'changed':f.candidate.graph,packageSha256:fault==='wrong-package'?'changed':f.candidate.packageSha256}};
    const proof=recoveryOnly?{...currentProof.snapshot,action:'snapshot-recovery',positionId:8n,transactionHash:currentProof.transactionHash,
      status:'superseded-snapshot-recovery-only',claimStatus:currentProof.producer.status,revisions:currentProof.producer.revisions,
      latestSnapshotHash:toBeHex(80n,32),latestSnapshotBlock:{number:11n,hash:toBeHex(81n,32)},block:{number:12n,hash:toBeHex(82n,32)},
      privateAccountingVerified:false,readyToSign:false}:currentProof;
    if(fault!=='forged')brands.set(proof,f.signer);
    const verify=vi.fn(async()=>{
      if(fault==='changed-record')f.storage.set(key,JSON.stringify({...pending,nonce:8}));
      if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(toBeHex(999n,32));
      if(fault==='storage-failure')vi.spyOn(window.sessionStorage,'setItem').mockImplementation(()=>{throw new Error('Storage failed');});
      if(fault==='archive-readback')vi.spyOn(window.sessionStorage,'setItem').mockImplementation(()=>{});
      if(fault==='slot-after-archive')vi.spyOn(window.sessionStorage,'setItem').mockImplementation((name,value)=>{
        f.storage.set(name,value);f.storage.set(key,JSON.stringify({...pending,nonce:8}));
      });
      return proof;
    });
    if(['success','independent'].includes(fault)){
      expect(await f.adapter.recoverPendingPoolPositionAttempt(verify as never)).toBe(proof);
      expect(f.storage.has(fault==='independent'?CURRENT_POOL_REFRESH_ATTEMPT_KEY:key)).toBe(false);
      const archives=[...f.storage.entries()].filter(([k])=>k.startsWith('chainwhisper:dex:verified-pool-snapshot:'));
      expect(archives).toHaveLength(1);expect(JSON.parse(archives[0][1])).toMatchObject({original,intervalAccounting:'not-reconstructed'});
      if(recoveryOnly)expect(JSON.parse(archives[0][1])).toMatchObject({verification:'7bed-superseded-initial-claim-snapshot-recovery-only',latestSnapshotHash:toBeHex(80n,32)});
      if(fault==='independent')expect(f.storage.has(key)).toBe(true);
    }else if(['top-up','other-failure','reverted'].includes(fault)){
      expect(await f.adapter.recoverPendingPoolPositionAttempt(verify as never)).toMatchObject({verificationBlocked:true});
      expect(verify).not.toHaveBeenCalled();expect(f.storage.get(key)).toBe(original);
    }else{
      await expect(f.adapter.recoverPendingPoolPositionAttempt(verify as never)).rejects.toThrow();
      expect(f.storage.has(key)).toBe(true);
      if(fault==='target'||fault==='operation')expect(verify).not.toHaveBeenCalled();
    }
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe('current snapshot final signing baseline',()=>{
  it('checks the full baseline once, after fit and before reserving the send',async()=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{captureBaselineAtSigning:true});
    const phases:string[]=[];
    f.transport.estimateGas.mockImplementation(async()=>{phases.push('fit');return 1n;});
    f.prepared.assertBeforeSend=vi.fn(async()=>{expect(f.storage.has(key)).toBe(false);phases.push('baseline');});
    const send=f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async request=>{phases.push('wallet');return send(request);});
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(f.prepared.assertBeforeSend).toHaveBeenCalledOnce();
    expect(phases).toEqual(['fit','baseline','wallet']);
  });
  it('stops a failed final baseline before sealing, journaling or opening the wallet',async()=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    const sealBeforeSend=vi.fn();
    Object.assign(f.prepared,{captureBaselineAtSigning:true,sealBeforeSend});
    f.prepared.assertBeforeSend=vi.fn(async()=>{throw new Error('Snapshot baseline changed.');});
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('Snapshot baseline changed.');
    expect(f.prepared.assertBeforeSend).toHaveBeenCalledOnce();
    expect(sealBeforeSend).not.toHaveBeenCalled();expect(f.storage.has(key)).toBe(false);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps both sender checks for snapshots without the fresh-baseline flag',async()=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    f.prepared.assertBeforeSend=vi.fn(async()=>{});
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(f.prepared.assertBeforeSend).toHaveBeenCalledTimes(2);
  });
});

describe('independent private refresh under a retained snapshot hold',()=>{
  async function heldFixture(positionId=8n,originalId=8n){
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    const selectPosition=(id:bigint)=>{Object.assign(f.prepared,{positionId:id,data:currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[id])});
      f.receipt.logs=[{address:f.candidate.core,...currentNativePoolSnapshotAbi.encodeEventLog(currentNativePoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[id,context,Array.from({length:10},()=>({ciphertextHigh:1n,ciphertextLow:2n}))])}];};
    selectPosition(originalId);
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const oldTx={...f.tx()},oldReceipt=structuredClone(f.receipt);
    selectPosition(positionId);
    const saved=JSON.stringify({...JSON.parse(f.storage.get(key)!),verificationBlocked:true});f.storage.set(key,saved);
    const freshHash=toBeHex(99n,32);let freshTx:Record<string,unknown>|null=null;
    f.transport.readNonce.mockResolvedValue(5);
    f.transport.readNativeResources.mockImplementation(async head=>({owner,chainId,head:{...head},latestNonce:5,pendingNonce:5,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'}));
    f.transport.readTransaction.mockImplementation(async (...args:unknown[])=>args[0]===txHash?oldTx:freshTx);
    f.transport.waitForReceipt.mockImplementation(async (...args:unknown[])=>args[0]===txHash?oldReceipt:{...f.receipt,hash:freshHash});
    f.transport.send.mockImplementation(async request=>{freshTx={...request,hash:freshHash,blockNumber:10,blockHash:hash};return {...request,hash:freshHash};});
    f.prepared.readResult.mockResolvedValue({action:'snapshot',positionId,producerHash:freshHash,status:'active-snapshot-verified'} as never);
    f.transport.send.mockClear();
    return {...f,saved,freshHash,adapter:f.make({},'cheap-history'),oldReceipt};
  }
  it.each([49n,54n])('refreshes position %s while retaining the position49 record and blocking duplicate sends',async positionId=>{
    const f=await heldFixture(positionId,49n),adapter=f.make(undefined,'cheap-history');
    const sent=await adapter.submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true});
    expect(f.transport.send).toHaveBeenCalledOnce();expect(sent.request.nonce).toBe(5);
    expect(f.storage.get(key)).toBe(f.saved);
    await expect(adapter.submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true})).rejects.toThrow();
    expect(await sent.recover()).toMatchObject({action:'snapshot',positionId,status:'active-snapshot-verified'});
    expect(f.storage.get(key)).toBe(f.saved);expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['nonce','receipt','rpc','top-up','record-change','old-event','new-owner'] as const)('stops independent refresh on %s without a send',async fault=>{
    const f=await heldFixture(54n,49n);
    if(fault==='nonce')f.transport.readNonce.mockResolvedValue(4);
    if(fault==='receipt')f.oldReceipt.status=0;
    if(fault==='rpc')f.transport.readTransaction.mockRejectedValue(new Error('RPC stopped'));
    if(fault==='top-up')f.storage.set(key,JSON.stringify({...JSON.parse(f.saved),poolTopUpHash:hash}));
    if(fault==='record-change')f.prepared.assertBeforeSend.mockImplementation(async()=>{f.storage.set(key,f.saved+' ');});
    if(fault==='old-event')f.oldReceipt.logs=structuredClone(f.receipt.logs);
    if(fault==='new-owner')f.prepared.from=`0x${'23'.repeat(20)}`;
    const retained=f.storage.get(key);
    await expect(f.make(undefined,'cheap-history').submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true})).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.storage.get(key)).toBe(fault==='record-change'?f.saved+' ':retained);
  });
  it.each(['pending','unknown-send','private-proof','reload','original-removed','reorg'] as const)('keeps both records and no-resend after %s',async fault=>{
    const f=await heldFixture(54n,49n),adapter=f.make(undefined,'cheap-history');
    if(fault==='unknown-send')f.transport.send.mockRejectedValue(new Error('Unknown send'));
    if(fault==='unknown-send')await expect(adapter.submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true})).rejects.toThrow('Unknown send');
    else {
      const sent=await adapter.submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true});
      if(fault==='private-proof')f.prepared.readResult.mockRejectedValue(new CurrentPoolProofMismatch('Private snapshot mismatch'));
      if(fault==='original-removed')f.storage.delete(key);
      if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(toBeHex(777n,32));
      if(['private-proof','original-removed','reorg'].includes(fault))await expect(sent.recover()).rejects.toThrow();
      if(fault==='reload'){
        const fresh=f.make({},'cheap-history');expect(await fresh.recoverCurrentPreparedPoolPositionResult()).toBeNull();
        expect(await fresh.recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-mined-verification-held',independentRefresh:true,positionId:54n,transactionHash:f.freshHash,privateAccountingVerified:false});
      }
    }
    expect(f.storage.has(CURRENT_POOL_REFRESH_ATTEMPT_KEY)).toBe(true);
    if(fault!=='original-removed')expect(f.storage.get(key)).toBe(f.saved);
    await expect(adapter.submitPoolPositionAction(f.prepared as never,undefined,{refreshHeldSnapshot:true})).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['closed','changed-position-data','ordinary-send','owner-action'] as const)('does not extend the exception to %s',async fault=>{
    const f=await heldFixture(54n,49n);
    if(fault==='closed')Object.assign(f.prepared,{closed:true});
    if(fault==='changed-position-data')Object.assign(f.prepared,{data:currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[9n])});
    if(fault==='owner-action')Object.assign(f.prepared,{action:'close',data:abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x'])});
    await expect(f.make(undefined,'cheap-history').submitPoolPositionAction(f.prepared as never,undefined,fault==='ordinary-send'?undefined:{refreshHeldSnapshot:true})).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.get(key)).toBe(f.saved);
  });
});

describe.each(['cheap-history'] as const)('%s owner snapshot sender boundary',candidateKey=>{
  it('inspects an old held receipt using current candidate state without requesting pruned state',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const saved=JSON.stringify({...JSON.parse(f.storage.get(key)!),verificationBlocked:true});f.storage.set(key,saved);
    const head={number:20n,hash:toBeHex(40n,32),timestamp:110n,gasLimit:120_000_000n};
    f.transport.readHead.mockResolvedValue(head);f.transport.readHead.mockClear();
    const attest=vi.fn(async(block:{number:bigint;hash:string})=>{
      if(block.hash===hash)throw new Error('missing trie node: receipt-block state is unavailable');
      expect(block).toMatchObject({number:head.number,hash:head.hash});
    });
    const observed=await f.make({},candidateKey,attest).recoverPendingPoolPositionAttempt();
    expect(observed).toMatchObject({status:'observed-mined-verification-held',transactionHash:txHash,privateAccountingVerified:false,readyToSign:false});
    expect(f.transport.readHead).toHaveBeenCalledOnce();expect(attest).toHaveBeenCalledOnce();
    expect(f.transport.readBlockHash).toHaveBeenCalledTimes(2);expect(f.transport.readBlockHash).toHaveBeenNthCalledWith(1,10);expect(f.transport.readBlockHash).toHaveBeenNthCalledWith(2,10);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2);
    expect(f.storage.get(key)).toBe(saved);expect(f.transport.send).toHaveBeenCalledOnce();expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each(['head-rpc','attestation-rpc','candidate-mismatch','receipt-reorg'] as const)('stops public recovery and preserves the held record on %s',async fault=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const saved=JSON.stringify({...JSON.parse(f.storage.get(key)!),verificationBlocked:true});f.storage.set(key,saved);
    const head={number:20n,hash:toBeHex(40n,32),timestamp:110n,gasLimit:120_000_000n};
    f.transport.readHead.mockResolvedValue(head);f.transport.readHead.mockClear();
    if(fault==='head-rpc')f.transport.readHead.mockRejectedValueOnce(new Error('Head RPC stopped'));
    const attest=vi.fn(async()=>{
      if(fault==='attestation-rpc')throw new Error('Attestation RPC stopped');
      if(fault==='candidate-mismatch')throw new Error('Current-mode graph changed.');
      if(fault==='receipt-reorg')f.transport.readBlockHash.mockResolvedValueOnce(toBeHex(99n,32));
    });
    await expect(f.make({},candidateKey,attest).recoverPendingPoolPositionAttempt()).rejects.toThrow();
    expect(f.transport.readHead).toHaveBeenCalledOnce();expect(attest).toHaveBeenCalledTimes(fault==='head-rpc'?0:1);
    expect(f.transport.readBlockHash).toHaveBeenCalledTimes(fault==='receipt-reorg'?2:1);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledOnce();
    expect(f.storage.get(key)).toBe(saved);expect(f.transport.send).toHaveBeenCalledOnce();expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each(['success','rpc','accounting','reload','unverified','final-receipt','funding-after-recheck','reverted','storage','uncertain-send','wrong-owner','wrong-market','unbranded'] as const)('keeps top-up accounting inside the durable snapshot boundary: %s',async outcome=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{marketId:hash});f.result.action='snapshot';
    let fundingChanged=false;
    const fundingHash=toBeHex(90n,32),topUp={chainId,from:owner,to:f.candidate.core,graph:f.candidate.graph,packageSha256:f.candidate.packageSha256,positionId:8n,transactionHash:fundingHash,expectation:{action:'top-up',marketId:hash},assertCurrent:vi.fn(async()=>{if(fundingChanged)throw new CurrentPoolProofMismatch('Pool top-up management receipt changed before snapshot acceptance.');}),
      verifySnapshot:vi.fn(async()=>{
        expect(JSON.parse(f.storage.get(key)!)).toMatchObject({poolTopUpHash:fundingHash,txHash});
        if(outcome==='rpc')throw new Error('RPC stopped');
        if(outcome==='accounting')throw new CurrentPoolProofMismatch('Prepared management snapshot accounting changed.');
        if(outcome==='final-receipt')f.receipt.blockHash=toBeHex(99n,32);
        if(outcome==='funding-after-recheck')f.transport.waitForReceipt.mockImplementationOnce(async()=>{fundingChanged=true;return f.receipt;});
        return {privateAccountingVerified:outcome!=='unverified',producerHash:txHash,positionId:8n};
      })};brands.set(topUp,f.signer);
    f.storage.set(key,JSON.stringify({version:1,chainId:String(chainId),owner,core:f.candidate.core.toLowerCase(),graph:`0x${f.candidate.graph}`,phase:'pool-fund',nonce:3,txHash:fundingHash,callHash:hash,poolTopUpHash:null}));
    const send=f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async request=>{expect(JSON.parse(f.storage.get(key)!)).toMatchObject({poolTopUpHash:fundingHash,txHash:null});return send(request);});
    const before=f.storage.get(key);
    if(outcome==='storage')window.sessionStorage.setItem=()=>{throw new Error('Storage stopped');};
    if(outcome==='uncertain-send')f.transport.send.mockRejectedValueOnce(new Error('Wallet response unavailable'));
    if(outcome==='wrong-owner')topUp.from=`0x${'77'.repeat(20)}`;
    if(outcome==='wrong-market')topUp.expectation.marketId=toBeHex(91n,32);
    if(outcome==='unbranded')brands.delete(topUp);
    if(['storage','uncertain-send','wrong-owner','wrong-market','unbranded'].includes(outcome)){
      await expect(f.adapter.submitPoolPositionAction(f.prepared as never,topUp as never)).rejects.toThrow();
      if(outcome==='uncertain-send')expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'pool-snapshot',poolTopUpHash:fundingHash,txHash:null});
      else expect(f.storage.get(key)).toBe(before);
      expect(f.transport.send).toHaveBeenCalledTimes(outcome==='uncertain-send'?1:0);expect(topUp.verifySnapshot).not.toHaveBeenCalled();return;
    }
    const sent=await f.adapter.submitPoolPositionAction(f.prepared as never,topUp as never);
    if(outcome==='reverted')f.receipt.status=0;
    if(outcome==='success'){
      expect(await sent.recover()).toMatchObject({privateAccountingVerified:true,poolTopUpHash:fundingHash});expect(f.storage.has(key)).toBe(false);
    }else{
      if(outcome!=='reload'&&outcome!=='reverted')await expect(sent.recover()).rejects.toThrow();
      const saved=f.storage.get(key)!;
      if(outcome==='final-receipt')f.receipt.blockHash=hash;
      const observed=await f.make({},candidateKey).recoverPendingPoolPositionAttempt();
      if(candidateKey==='cheap-history'&&['accounting','unverified','final-receipt','funding-after-recheck'].includes(outcome)){
        // CW-140.02: a mined, verification-held top-up moves to its position's review list; the position stays locked.
        expect(observed).toMatchObject({status:'moved-to-position-review',positionId:8n,reviewable:false,privateAccountingVerified:false,readyToSign:false});
        expect(f.storage.has(key)).toBe(false);
        expect([...f.storage.entries()].filter(([k])=>k.startsWith('chainwhisper:dex:position-review:v1:')).map(([,v])=>JSON.parse(v)[0]))
          .toEqual([expect.objectContaining({positionId:'8',original:saved,reviewable:false})]);
        await expect(f.make({},candidateKey).submitPoolPositionAction(f.prepared as never,topUp as never)).rejects.toThrow('waits for your review');
      }else{
        expect(observed).toMatchObject({status:outcome==='reverted'?'observed-reverted-verification-held':'observed-mined-verification-held',poolTopUpHash:fundingHash,privateAccountingVerified:false,readyToSign:false});
        expect(f.storage.get(key)).toBe(saved);
        await expect(f.make({},candidateKey).submitPoolPositionAction(f.prepared as never,topUp as never)).rejects.toThrow();
      }
    }
    expect(topUp.verifySnapshot).toHaveBeenCalledTimes(outcome==='reload'||outcome==='reverted'?0:1);expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('retains the exact safe snapshot failure and inspects a mined hold without clearing or resending',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    const sent=await f.adapter.submitPoolPositionAction(f.prepared as never);
    f.prepared.readResult.mockRejectedValueOnce(new CurrentPoolProofMismatch('Prepared snapshot changed financial state.'));
    await expect(sent.recover()).rejects.toThrow('financial state');
    const saved=f.storage.get(key)!;
    expect(JSON.parse(saved)).toMatchObject({verificationBlocked:true,verificationFailure:'snapshot-financial-state'});
    const observed=await f.make({},candidateKey).recoverPendingPoolPositionAttempt();
    expect(observed).toMatchObject({status:'observed-mined-verification-held',transactionHash:txHash,verificationFailure:'snapshot-financial-state',privateAccountingVerified:false,readyToSign:false});
    expect(f.storage.get(key)).toBe(saved);expect(f.transport.send).toHaveBeenCalledOnce();expect(f.prepared.readResult).toHaveBeenCalledOnce();
  });
  it('keeps an old reasonless snapshot hold byte-for-byte and stops when its receipt read fails',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const saved=JSON.stringify({...JSON.parse(f.storage.get(key)!),verificationBlocked:true});f.storage.set(key,saved);
    f.transport.waitForReceipt.mockRejectedValueOnce(new Error('RPC stopped'));
    await expect(f.make({},candidateKey).recoverPendingPoolPositionAttempt()).rejects.toThrow('RPC stopped');
    expect(f.storage.get(key)).toBe(saved);expect(f.transport.verifyCanonicalInclusion).not.toHaveBeenCalled();expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['legacy-mined','reverted','event','final-receipt'] as const)('preserves a snapshot hold during public inspection: %s',async fault=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    const saved=JSON.stringify({...JSON.parse(f.storage.get(key)!),verificationBlocked:true});f.storage.set(key,saved);
    if(fault==='reverted')f.receipt.status=0;
    if(fault==='event')f.receipt.logs=[];
    if(fault==='final-receipt'){
      let reads=0;f.transport.waitForReceipt.mockImplementation(async()=>{if(++reads===3)f.receipt.blockHash=toBeHex(999n,32);return f.receipt;});
    }
    const result=f.make({},candidateKey).recoverPendingPoolPositionAttempt();
    if(fault==='event'||fault==='final-receipt')await expect(result).rejects.toThrow();
    else expect(await result).toMatchObject({status:fault==='reverted'?'observed-reverted-verification-held':'observed-mined-verification-held',verificationBlocked:true,privateAccountingVerified:false,readyToSign:false});
    expect(f.storage.get(key)).toBe(saved);expect(f.transport.send).toHaveBeenCalledOnce();expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it('joins a real engineering owner snapshot to the shared sender',async()=>{
    const f=preparedFixture(candidateKey,'0x8b749251cf1f712d4e39fd048c53394af03e10be');
    const sent=await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(sent.transactionHash).toBe(txHash);expect(f.transport.send).toHaveBeenCalledOnce();
    expect(String(f.tx().from).toLowerCase()).toBe(f.prepared.from.toLowerCase());
    expect(f.tx()).toMatchObject({to:f.candidate.core,gasLimit:30_000_000n});
  });
  it('keeps real admission held before estimation or send',async()=>{
    const f=preparedFixture(candidateKey);await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('App signing hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('rejects unsupported prepared management without a historical fallback',async()=>{
    const f=preparedFixture(candidateKey);f.prepared.action='withdraw';
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('action integration is incomplete');expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps prepared Close held before estimate/send',async()=>{
    const f=preparedFixture(candidateKey);f.prepared.action='close';f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('App signing hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps the real connected-App hold after prepared admission',async()=>{
    const f=preparedFixture(candidateKey);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('Shared-history DEX App signing hold');
    expect(f.transport.readNonce).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains prepared Close recovery until the financial result is checked',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();f.prepared.action='close';f.prepared.data=abi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']);
    f.receipt.logs=[{address:f.candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],
      ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,8n])}];
    f.prepared.readResult.mockResolvedValue({...f.result,status:'closed-proof-required',privateAccountingVerified:false} as never);
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(await f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).toMatchObject({status:'closed-proof-required',privateAccountingVerified:false});
    expect(f.transport.send).toHaveBeenCalledOnce();expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('retains same-session authenticated recovery without repeating the send',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    await expect(f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).resolves.toEqual(f.result);
    expect(f.prepared.readResult).toHaveBeenCalledOnce();expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
  });
  it('allows a new funded top-up snapshot after a completed snapshot with the same position source',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{marketId:hash,replacementFrom:toBeHex(40n,32)});f.result.action='snapshot';
    const first=await f.adapter.submitPoolPositionAction(f.prepared as never);await first.recover();
    const fundingHash=toBeHex(90n,32),snapshotHash=toBeHex(91n,32);
    const topUp={chainId,from:owner,to:f.candidate.core,graph:f.candidate.graph,packageSha256:f.candidate.packageSha256,
      positionId:8n,transactionHash:fundingHash,expectation:{action:'top-up',marketId:hash},assertCurrent:vi.fn(async()=>{}),
      verifySnapshot:vi.fn(async()=>({privateAccountingVerified:true,producerHash:snapshotHash,positionId:8n}))};
    brands.set(topUp,f.signer);
    const fundingRecord=JSON.stringify({version:1,chainId:String(chainId),owner,core:f.candidate.core.toLowerCase(),graph:`0x${f.candidate.graph}`,
      phase:'pool-fund',nonce:5,txHash:fundingHash,callHash:hash,poolTopUpHash:null});
    f.storage.set(key,fundingRecord);f.transport.readNonce.mockResolvedValue(6);
    const resources=f.transport.readNativeResources.getMockImplementation()!;
    f.transport.readNativeResources.mockImplementation(async head=>({...await resources(head),latestNonce:6,pendingNonce:6}));
    const send=f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async request=>{const sent=await send(request);f.tx().hash=snapshotHash;f.receipt.hash=snapshotHash;return {...sent,hash:snapshotHash};});
    const next=await f.adapter.submitPoolPositionAction(f.prepared as never,topUp as never);
    expect(next.request.nonce).toBe(6);expect(f.transport.send).toHaveBeenCalledTimes(2);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never,topUp as never)).rejects.toThrow();
    expect(await next.recover()).toMatchObject({privateAccountingVerified:true,poolTopUpHash:fundingHash});
    expect(topUp.verifySnapshot).toHaveBeenCalledWith(snapshotHash);expect(f.storage.size).toBe(0);
    f.storage.set(key,fundingRecord);
    Object.assign(f.prepared,{replacementFrom:toBeHex(41n,32)});
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never,topUp as never)).rejects.toThrow('already submitted');
    expect(f.transport.send).toHaveBeenCalledTimes(2);expect(f.storage.get(key)).toBe(fundingRecord);
  });
  it('allows the next snapshot source while blocking a repeat of the same source',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
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
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();const sent=await f.adapter.submitPoolPositionAction(f.prepared as never);
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
      await expect(f.make(undefined,candidateKey).recoverPendingPoolPositionAttempt()).resolves.toMatchObject({status:'observed-mined-verification-held'});
    }
  });
  it('requires canonical inclusion and returns only metadata after signer reload',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    const fresh=f.make({},candidateKey);expect(await fresh.recoverCurrentPreparedPoolPositionResult()).toBeNull();
    expect(await fresh.recoverPendingPoolPositionAttempt()).toMatchObject({status:'observed-mined',privateAccountingVerified:false,readyToSign:false});
    expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled();expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe.each(['cheap-history']as const)('%s exit action sender uses the shared canonical boundary', candidateKey => {
  const exitFixture = (phase: 'preview' | 'withdrawal') => {
    const f = preparedFixture(candidateKey), action = phase === 'preview' ? 11n : 12n;
    Object.assign(f.prepared, { action: 'withdraw', exitPhase: phase, data: abi.encodeFunctionData('managePoolPosition', [8n, context, action, '0x']) });
    const host = new Interface(POOL_EXIT_PREVIEW_ABI);
    f.receipt.logs = phase === 'preview' ? [{ address: f.candidate.core,
      ...host.encodeEventLog(host.getEvent('PoolExitPreviewed')!, [8n, context, [1n, 2n, 3n, 4n, 5n, 6n].map(v => [1n, v])]) }] : [];
    return f;
  };
  it.each(['preview', 'withdrawal'] as const)('keeps %s admission held before estimate or send', async phase => {
    const f = exitFixture(phase); await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('App signing hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['preview', 'withdrawal'] as const)('retains %s private recovery and its 100M fit cap without a second send', async phase => {
    const f = exitFixture(phase); allowLocalTechnicalSubmission();
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(f.transport.send.mock.calls[0][0].gasLimit).toBe(100_000_000n);
    expect(await f.make(undefined, candidateKey).recoverCurrentPreparedPoolPositionResult()).toEqual(f.result);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['preview', 'withdrawal'] as const)('returns only %s metadata after a signer reload', async phase => {
    const f = exitFixture(phase); allowLocalTechnicalSubmission(); await f.adapter.submitPoolPositionAction(f.prepared as never);
    const fresh = f.make({}, candidateKey); expect(await fresh.recoverCurrentPreparedPoolPositionResult()).toBeNull();
    expect(await fresh.recoverPendingPoolPositionAttempt()).toMatchObject({ status: 'observed-mined', privateAccountingVerified: false });
    expect(f.prepared.readResult).not.toHaveBeenCalled();
  });
  it.each(['legacy', 'phase', 'headroom'] as const)('refuses %s before sending exit action', async fault => {
    const f = exitFixture('withdrawal'); 
    if (fault === 'legacy') f.prepared.data = abi.encodeFunctionData('managePoolPosition', [8n, context, 1n, '0x']);
    if (fault === 'phase') f.prepared.data = abi.encodeFunctionData('managePoolPosition', [8n, context, 11n, '0x']);
    if (fault === 'headroom') f.transport.readHead.mockResolvedValue({ number: 10n, hash, timestamp: 100n, gasLimit: 110_000_000n });
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['preview', 'withdrawal'] as const)('keeps %s pending on a known financial proof failure', async phase => {
    const f = exitFixture(phase); allowLocalTechnicalSubmission(); const sent = await f.adapter.submitPoolPositionAction(f.prepared as never);
    f.prepared.readResult.mockRejectedValue(new CurrentPoolProofMismatch('Financial proof failed'));
    await expect(sent.recover()).rejects.toThrow('Financial proof failed'); expect(JSON.parse(f.storage.get(key)!).verificationBlocked).toBe(true);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe.each(['cheap-history']as const)('%s prepared ownership sender',candidateKey=>{
  it.each(['transfer','activate','resume'] as const)('keeps authenticated %s recovery in the same signer without another send',async action=>{
    const f=preparedFixture(candidateKey),recipient=`0x${'33'.repeat(20)}`,nft=f.candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    Object.assign(f.prepared,{action,to:action==='transfer'?nft:f.candidate.core,recipient:action==='transfer'?recipient:null,
      data:action==='transfer'?nftAbi.encodeFunctionData('safeTransferFrom',[owner,recipient,8n]):abi.encodeFunctionData('managePoolPosition',[8n,context,action==='activate'?6n:5n,'0x'])});
    f.receipt.to=f.prepared.to;f.receipt.logs=action==='transfer'?[{address:nft,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,8n])}]:[];
    const result={action,positionId:8n,status:'owner-action-verified',privateAccountingVerified:true};f.prepared.readResult.mockResolvedValue(result as never);
    allowLocalTechnicalSubmission();await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(await f.make(undefined,candidateKey).recoverCurrentPreparedPoolPositionResult()).toEqual(result);
    expect(f.transport.send).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
  });
  it('rejects encrypted or extra inputs to Activate before signing',async()=>{
    const f=preparedFixture(candidateKey);allowLocalTechnicalSubmission();
    Object.assign(f.prepared,{action:'activate',data:abi.encodeFunctionData('managePoolPosition',[8n,context,6n,'0x11'])});
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('Invalid current');expect(f.transport.send).not.toHaveBeenCalled();
  });
});
afterEach(()=>{localSubmissionAuthority.allowed=false;vi.unstubAllGlobals(); vi.restoreAllMocks(); });


it('rejects changed candidate metadata in the retained position recovery closure',async()=>{const f=preparedFixture();allowLocalTechnicalSubmission();const sent=await f.adapter.submitPoolPositionAction(f.prepared as never),p=JSON.parse(f.storage.get(key)!);f.storage.set(key,JSON.stringify({...p,graph:`0x${'ab'.repeat(32)}`}));await expect(sent.recover()).rejects.toThrow('pending attempt changed');expect(f.prepared.readResult).not.toHaveBeenCalled();expect(f.storage.size).toBe(1);});


// CW-086, decision-033: the normal browser App releases a position action that the wallet rejected and never sent.
describe('release of a wallet-rejected Pool position action in the browser App',()=>{
  const browser=()=>{
    const f=preparedFixture('cheap-history');allowLocalTechnicalSubmission();
    browserContexts.set(f.signer,{owner});
    f.storage.set(currentDexNormalUseReloadKey({owner,graph:f.candidate.graph,chainId}),JSON.stringify({
      budget:{version:2,owner,candidateGraph:f.candidate.graph,start:'1',committedWei:'0',activeSwap:null,charges:[]},authentication:hash}));
    Object.assign(f.transport,{admitOwnerRecord:vi.fn(async()=>{})});
    return f;
  };
  const rejection=()=>Object.assign(new Error('User rejected the request.'),{code:4001});
  it('releases a rejected snapshot and permits the same snapshot again',async()=>{
    const f=browser(),error=rejection();f.transport.send.mockRejectedValueOnce(error);
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);expect(f.storage.has(key)).toBe(false);
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'pool-snapshot',txHash});
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps a rejected snapshot locked while its nonce is pending, then releases it in recovery and permits it again',async()=>{
    const f=browser(),error=rejection();let pendingNonce=4;
    f.transport.readNativeResources.mockImplementation(async head=>({owner,chainId,head:{...head},latestNonce:4,pendingNonce,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'}));
    f.transport.send.mockImplementationOnce(async()=>{pendingNonce=5;throw error;});
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'pool-snapshot',txHash:null,walletRejected:true});
    await expect(f.adapter.recoverPendingPoolPositionAttempt()).rejects.toThrow('The reserved wallet nonce is used or pending');
    expect(f.storage.has(key)).toBe(true);pendingNonce=4;
    expect(await f.adapter.recoverPendingPoolPositionAttempt()).toMatchObject({status:'released-unsent',readyToSign:false});
    expect(f.storage.has(key)).toBe(false);
    await f.adapter.submitPoolPositionAction(f.prepared as never);
    expect(JSON.parse(f.storage.get(key)!)).toMatchObject({phase:'pool-snapshot',txHash});
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps an unknown wallet result locked',async()=>{
    const f=browser();f.transport.send.mockRejectedValueOnce(new Error('TEST_UNKNOWN_POSITION_SEND'));
    await expect(f.adapter.submitPoolPositionAction(f.prepared as never)).rejects.toThrow('TEST_UNKNOWN_POSITION_SEND');
    const saved=JSON.parse(f.storage.get(key)!);expect(saved).toMatchObject({phase:'pool-snapshot',txHash:null});expect(saved.walletRejected).toBeUndefined();
    expect(await f.adapter.recoverPendingPoolPositionAttempt()).toMatchObject({status:'manual-reconciliation-required',readyToSign:false});
    expect(f.storage.has(key)).toBe(true);expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
