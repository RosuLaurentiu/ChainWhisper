import { getAddress, keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentPoolPositionPrepared, assertVerifiedCurrentPoolSnapshot, assertVerifiedSupersededPoolSnapshot, type CurrentPoolPreparedPositionAction, type CurrentPoolPreparedSnapshot, type CurrentPoolPreparedExitPreview, type issueCurrentDexPoolPositionCapability } from '../features/wallet/currentDexPoolPositionCapability';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as currentCandidate } from './selectedCurrentDexCandidate';
import { decodePoolExitPreviewEvent } from './currentDexPoolExitPreview';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { currentDexPendingStorage, clearCurrentDexPendingAttempt, blockCurrentPoolVerification, currentPoolRefreshStorage, readCurrentDexPendingAttempt, heldPoolSnapshotRefreshEligible, CURRENT_POOL_REFRESH_ATTEMPT_KEY, CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';
import { resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidateKey, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { assertCurrentAppPoolAuthority } from './currentDexC1SwapPolicy';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi, currentPoolOwnerGasCap,
  decodeCurrentPoolNftTransfer, type CurrentPoolOwnerAction } from './currentDexPoolPosition';
import { currentNativePoolSnapshotAbi } from './currentDexNativePoolSnapshot';
import { requireCurrentNativePoolSession, CURRENT_NATIVE_POOL_PROFILE, CURRENT_NATIVE_POOL_LIMITS } from './currentDexNativePoolPolicy';
import { currentNativeSigningBudget, isCurrentNativeSwapCandidate, recordCurrentNativePoolOutcome, completeCurrentNativePoolScope } from './currentDexNativeSwapPolicy';
import { isKnownCurrentPoolProofMismatch, CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { assertCurrentPoolFundingPrepared, type CurrentPoolTopUpResult } from '../features/wallet/currentDexPoolFundingCapability';

// Native ownership and previewed exit: shared-history-pool-{ownership,withdrawal}-2026-10-13/RESULT.json.
// Full Close: native-direct-case; closed snapshot: shared-history-pool-closed-2026-10-14/RESULT.json.
// Packed preview/withdrawal: reports/pool-input-signatures-2026-11-12/WITHDRAW_NATIVE_RESULT.json.
// This admits the proved phases only; connected-wallet authority stays separate.
export const assertCurrentPoolPositionNativeAdmission=(candidate:CurrentCheapDexCandidate,action:'snapshot'|CurrentPoolOwnerAction,closed=false,exitPhase?:'preview'|'withdrawal')=>{
  if(candidate.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&resolvePreparedDexScope(candidate).key==='cheap-history'&&
      (action==='snapshot'&&!closed||action==='snapshot'&&closed||['transfer','activate','resume','close'].includes(action)||action==='withdraw'&&(exitPhase==='preview'||exitPhase==='withdrawal')))return;
  assertCurrentCheapDexNativeAdmission(candidate);
};

// Keep the canonical baseline independent of mutable provider receipt objects.
const snapshotReceipt = (receipt: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => {
  const logs = receipt.logs?.map(log => {
    const topics = [...log.topics]; Object.freeze(topics);
    return Object.freeze({ ...log, topics });
  });
  if (logs) Object.freeze(logs);
  return Object.freeze({ ...receipt, logs });
};
const submitted=new WeakMap<object,Set<string>>();
type NativeOwnerResult=Awaited<ReturnType<CurrentPoolPreparedPositionAction['readResult']>>|Awaited<ReturnType<CurrentPoolPreparedSnapshot['readResult']>>|Awaited<ReturnType<CurrentPoolPreparedExitPreview['readResult']>>;
type SnapshotCapability = Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>;
type SnapshotVerifier = (id: bigint, hash: string) => Promise<Awaited<ReturnType<SnapshotCapability['verifyPlainSnapshot'] | SnapshotCapability['verifySupersededPlainSnapshot']>>>;
const ownerRecoveries=new WeakMap<object,Map<string,()=>Promise<NativeOwnerResult>>>();
const same=(a:string|null,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
const shape=(phase:string,data:string,owner:string,preparedCandidate=false,exitCandidate=false)=>{
  if(phase==='pool-snapshot') { const values=currentNativePoolSnapshotAbi.decodeFunctionData('poolSnapshot',data);
    if(values[0]<(preparedCandidate?8n:20n)||currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',values).toLowerCase()!==data.toLowerCase())throw new Error('Non-canonical native Pool snapshot.');return values; }
  const host=phase==='pool-transfer'?nftAbi:abi,method=phase==='pool-transfer'?'safeTransferFrom':'managePoolPosition';
  const values=host.decodeFunctionData(method,data);
  if (!same(host.encodeFunctionData(method,values),data)) throw new Error('Non-canonical position calldata.');
  if (phase==='pool-transfer') {
    if (!same(values[0],owner)||BigInt(values[1])===0n||same(values[1],owner)||values[2]<8n) throw new Error('Invalid owner NFT transfer.');
  } else if (values[0]<8n||BigInt(values[1])===0n||!(exitCandidate?[5n,6n,7n,11n,12n]:[1n,5n,6n,7n]).includes(values[2])||
    ([5n,6n].includes(values[2])&&values[3]!=='0x')) throw new Error('Invalid current Pool owner action.');
  return values;
};
export const createCurrentPoolPositionSubmissionAdapter=({signer,ownerAddress,chainId,transport,attest,candidate: candidateKey='cheap-current',
  nativePoolProfile,now=()=>BigInt(Math.floor(Date.now()/1000))}:{signer:object;ownerAddress:string;chainId:bigint;transport:CurrentTransport;
  nativePoolProfile?:typeof CURRENT_NATIVE_POOL_PROFILE;
  attest:(head:{number:bigint;hash:string})=>Promise<void>;now?:()=>bigint;candidate?:CurrentCheapDexCandidateKey})=>{
  const candidate=resolveCurrentCheapDexCandidate(candidateKey),nft=candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
  const owner=getAddress(ownerAddress),core=getAddress(candidate.core),storage=currentDexPendingStorage();
  if (chainId!==BigInt(candidate.chainId)||BigInt(owner)===0n) throw new Error('Wrong position owner or chain.');
  const preparedCandidate=!!(candidateKey==='cheap-prepared'||candidateKey==='cheap-exit'||candidateKey==='cheap-history'?resolvePreparedDexScope(candidate):null);
  const exitCandidate=preparedCandidate&&(candidateKey==='cheap-exit'||candidateKey==='cheap-history');
  const boundary=createCurrentAttemptBoundary({storage,c:candidate,core,owner,chainId,transport,attest,now,historical:false,canonicalIndexProof:preparedCandidate});
  const recheck=async(request:Parameters<typeof boundary.recheckMinedCall>[0],hash:string,before:ReturnType<typeof snapshotReceipt>,failed=false)=>{
    if(isCurrentNativeSwapCandidate(candidate)||preparedCandidate)return boundary.recheckMinedCall(request,hash,before,failed);
    const after=snapshotReceipt(await boundary.verifyMinedCall(request,hash,failed));
    if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Pool canonical receipt changed after private proof.');
    if(transport.verifyCanonicalInclusion){const tx=await transport.readTransaction(hash);if(!tx)throw new Error('Pool canonical transaction is unavailable.');
      await transport.verifyCanonicalInclusion(tx,after);await transport.assertCurrent();}
  };
  let keys=submitted.get(signer);if(!keys){keys=new Set();submitted.set(signer,keys);}
  const submitPoolPositionAction=async(prepared:CurrentPoolPreparedPositionAction|CurrentPoolPreparedSnapshot|CurrentPoolPreparedExitPreview,topUp?:CurrentPoolTopUpResult,options?:{refreshHeldSnapshot:true})=>{
    let sendStorage=storage,sendBoundary=boundary;
    const held=options?.refreshHeldSnapshot?boundary.pending():null;
    if(options){
      if(candidateKey!=='cheap-history'||topUp||prepared.action!=='snapshot'||prepared.closed||
        !heldPoolSnapshotRefreshEligible(held,{chainId:String(chainId),owner,core,graph:`0x${candidate.graph}`}))
        throw new Error('Only a new active-position snapshot may use the retained hold.');
      sendStorage=currentPoolRefreshStorage(storage,held!,keccak256(prepared.data));
      const refreshTransport={...transport,readNonce:async()=>{const nonce=await transport.readNonce();if(nonce<=held!.nonce)throw new Error('Independent snapshot needs a newer nonce.');return nonce;}};
      sendBoundary=createCurrentAttemptBoundary({storage:sendStorage,c:candidate,core,owner,chainId,transport:refreshTransport,attest,now,historical:false,canonicalIndexProof:true,heldSnapshot:held!});
    }
    const native=isCurrentNativeSwapCandidate(candidate), snapshot=prepared.action==='snapshot';
    const finalSnapshotBaseline=candidateKey==='cheap-history'&&snapshot&&'captureBaselineAtSigning'in prepared&&prepared.captureBaselineAtSigning===true;
    const exitPhase='exitPhase' in prepared?prepared.exitPhase:undefined;
    const phase=snapshot?'pool-snapshot':prepared.action==='transfer'?'pool-transfer':'pool-owner';
    const cap=snapshot?CURRENT_NATIVE_POOL_LIMITS.snapshotCap:native?CURRENT_NATIVE_POOL_LIMITS.closeCap:currentPoolOwnerGasCap(prepared.action as CurrentPoolPreparedPositionAction['action']);
    // Reject forged/cross-candidate objects before accessing live financial authority.
    assertCurrentPoolPositionPrepared(prepared,signer);await prepared.assertCurrent();
    if(prepared.graph!==candidate.graph||prepared.packageSha256!==candidate.packageSha256)throw new Error('Position preparation differs from this owner candidate.');
    if(preparedCandidate&&!snapshot&&prepared.action!=='close'&&!(exitCandidate&&
      (['transfer','activate','resume'].includes(prepared.action)||prepared.action==='withdraw'&&
        (exitPhase==='preview'||exitPhase==='withdrawal'))))throw new Error('Prepared Pool action integration is incomplete.');
    const session=native?requireCurrentNativePoolSession(signer,owner,candidate):null;
    const budget=native?currentNativeSigningBudget(signer,owner,now):null;
    const budgetPhase=snapshot?(prepared.closed?'pool-closed-snapshot':'pool-active-snapshot'):'pool-close';
    const admission=()=>{if(!native){assertCurrentPoolPositionNativeAdmission(candidate,prepared.action,snapshot&&prepared.closed,exitPhase);return assertCurrentAppPoolAuthority(candidate.graph,
      {owner,action:prepared.action,positionId:prepared.positionId,recipient:prepared.recipient},signer);}
      if(nativePoolProfile!==CURRENT_NATIVE_POOL_PROFILE||session!.positionId!==prepared.positionId||session!.unfundedFailed||
        (!snapshot&&prepared.action!=='close')||(snapshot&&prepared.closed!==!!session!.closedPayouts))throw new Error('Native Pool owner phase is not admitted.');
    };
    const validate=async()=>{
      assertCurrentPoolPositionPrepared(prepared,signer);await prepared.assertCurrent();
      if(topUp){
        assertCurrentPoolFundingPrepared(topUp,signer);await topUp.assertCurrent();
        if(!preparedCandidate||!snapshot||!('marketId' in prepared)||topUp.expectation.action!=='top-up'||topUp.expectation.marketId!==prepared.marketId||topUp.positionId!==prepared.positionId||topUp.chainId!==chainId||!same(topUp.from,owner)||!same(topUp.to,core)||
          topUp.graph!==candidate.graph||topUp.packageSha256!==candidate.packageSha256||!/^0x[0-9a-fA-F]{64}$/.test(topUp.transactionHash)||BigInt(topUp.transactionHash)===0n)
          throw new Error('Top-up snapshot owner, position or candidate changed.');
      }
      if(prepared.chainId!==chainId||!same(prepared.from,owner)||!same(prepared.to,phase==='pool-transfer'?nft:core)||prepared.value!==0n||
        prepared.graph!==candidate.graph||prepared.packageSha256!==candidate.packageSha256||prepared.readyToSign!==false) throw new Error('Position preparation differs from this owner candidate.');
      const decoded=shape(phase,prepared.data,owner,preparedCandidate,exitCandidate);
      if(snapshot?decoded[0]!==prepared.positionId:phase==='pool-transfer' ? decoded[2]!==prepared.positionId||!prepared.recipient||!same(decoded[1],prepared.recipient) :
        decoded[0]!==prepared.positionId||decoded[2]!==(exitCandidate&&exitPhase?(exitPhase==='preview'?11n:12n):
          ({withdraw:1n,close:7n,activate:6n,resume:5n} as Record<string,bigint>)[prepared.action])) {
        throw new Error('Position calldata differs from its prepared action.');
      }
    };
    await validate();admission();
    const checkHeld=async()=>{if(!held)return;
      sendBoundary.pending();
      const result=await inspectPending(boundary,storage);
      if(result?.status!=='observed-mined-verification-held'||result.transactionHash!==held.txHash)throw new Error('Original snapshot is not confirmed for this owner.');
      sendBoundary.pending();
    };
    await checkHeld();
    if(topUp)sendBoundary.requirePoolTopUpHandoff(topUp.transactionHash.toLowerCase());else sendBoundary.requireEmptyPending();
    // A funded top-up needs its own snapshot even when the position reader retains an earlier source.
    const snapshotSource=snapshot&&topUp?`:top-up:${topUp.transactionHash.toLowerCase()}`:snapshot&&prepared.replacementFrom?`:${prepared.replacementFrom}`:'';
    const call=Object.freeze({chainId,from:owner,to:prepared.to,value:0n,data:prepared.data}),key=`${held?'refresh:':''}${phase}:${keccak256(call.data).toLowerCase()}${snapshot?':'+budgetPhase:''}${snapshotSource}`;
    const checkBudget=async()=>{if(!budget)return;admission();budget.check(budgetPhase,key,cap,session!.scope);
      const head=await sendBoundary.currentHead(undefined,cap);if(!transport.readNativeResources)throw new Error('Native Pool exit resources are unavailable.');
      const resources=await transport.readNativeResources(head);if(resources.balance<budget.snapshot().poolRemainingTailWei+CURRENT_NATIVE_POOL_LIMITS.payerReserveWei)throw new Error('Native Pool reserved exit resources are insufficient.');};
    await checkBudget();
    if(keys!.has(key))throw new Error('Position action was already submitted. Recover it instead.');keys!.add(key);
    let signing=false;
    try{
      const sent=await sendBoundary.sendCurrent(phase,call,undefined,async()=>{await validate();admission();if(!finalSnapshotBaseline)await prepared.assertBeforeSend();await checkHeld();await validate();admission();await checkBudget();},()=>{
        if(snapshot&&'sealBeforeSend' in prepared)prepared.sealBeforeSend();signing=true;
      },undefined,cap,undefined,
        async()=>{
          if(finalSnapshotBaseline){await prepared.assertBeforeSend();await checkHeld();await validate();admission();}
          await checkBudget();budget?.commit(budgetPhase,key,cap,session!.scope);
        }, undefined, undefined, undefined, undefined, undefined,
        candidateKey === 'cheap-history' ? { kind: 'position', prepared, signer } : undefined, topUp?.transactionHash.toLowerCase());
      const result=Object.freeze({...sent,status:'position-action-pending' as const,recover:async()=>{
        const pending=sendBoundary.pending();
        if(!pending||pending.chainId!==chainId.toString()||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${candidate.graph}`||pending.phase!==phase||pending.callHash!==keccak256(call.data).toLowerCase()||pending.nonce!==sent.request.nonce)throw new Error('Position pending attempt changed.');
        sendBoundary.requireOwnPending(pending,sent.transactionHash);
        if(pending.poolTopUpHash!==topUp?.transactionHash.toLowerCase())throw new Error('Top-up snapshot journal binding changed.');
        if(pending.verificationBlocked)throw new Error('Known Pool verification failure. Manual reconciliation is required.');
        let canonical:ReturnType<typeof snapshotReceipt>,result:Awaited<ReturnType<typeof prepared.readResult>>;
        try{canonical=snapshotReceipt(await sendBoundary.verifyMinedCall(sent.request,sent.transactionHash));await validate();
          result=await prepared.readResult(sent.transactionHash);await prepared.assertCurrent();
          if(topUp){
            if(!result||result.action!=='snapshot')throw new CurrentPoolProofMismatch('Top-up final private accounting is unavailable.');
            const verified=await topUp.verifySnapshot(sent.transactionHash);await validate();
            if(verified.privateAccountingVerified!==true||verified.positionId!==prepared.positionId||!same(verified.producerHash,sent.transactionHash))
              throw new CurrentPoolProofMismatch('Top-up final private accounting is unavailable.');
          }
          await recheck(sent.request,sent.transactionHash,canonical);
          if(topUp)await topUp.assertCurrent();
        }catch(error){if((native||preparedCandidate)&&isKnownCurrentPoolProofMismatch(error))blockCurrentPoolVerification(sendStorage,sendBoundary.requireOwnPending(pending,sent.transactionHash),error);throw error;}
        if(!result)throw new Error('Private position result is unavailable.');
        if(native){if(!snapshot)recordCurrentNativePoolOutcome(signer,session!.scope,'closed');
          else if(prepared.closed){completeCurrentNativePoolScope(signer,session!.scope);session!.completed=true;}}
        clearCurrentDexPendingAttempt(sendStorage,sendBoundary.requireOwnPending(pending,sent.transactionHash));
        return topUp&&result.action==='snapshot'?Object.freeze({...result,privateAccountingVerified:true as const,poolTopUpHash:topUp.transactionHash.toLowerCase()}):result;
      }});
      if(native||preparedCandidate){let recoveries=ownerRecoveries.get(signer);if(!recoveries){recoveries=new Map();ownerRecoveries.set(signer,recoveries);}recoveries.set(`${held?'refresh:':''}${phase}:${keccak256(call.data).toLowerCase()}`,result.recover);}
      return result;
    }catch(error){if(!signing)keys!.delete(key);throw error;}
  };
  const recoverCurrentPreparedPoolPositionResult=async()=>{
    await transport.assertCurrent();const held=boundary.pending(),refresh=!!held&&storage?.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY)!==null;
    const pending=refresh?readCurrentDexPendingAttempt(currentPoolRefreshStorage(storage,held!)):held;if(!pending||!preparedCandidate)return null;
    if(pending.chainId!==String(chainId)||!same(pending.owner,owner)||pending.graph!==`0x${candidate.graph}`||!same(pending.core,core)||!['pool-snapshot','pool-owner','pool-transfer'].includes(pending.phase))return null;
    const recover=ownerRecoveries.get(signer)?.get(`${refresh?'refresh:':''}${pending.phase}:${pending.callHash}`);
    if(!recover)return null;return recover();
  };
  const recoverCurrentNativePoolPositionResult=async()=>{
    await transport.assertCurrent();const pending=boundary.pending();if(!pending||!isCurrentNativeSwapCandidate(candidate))return null;
    if(pending.chainId!==String(chainId)||!same(pending.owner,owner)||pending.graph!==`0x${candidate.graph}`||!same(pending.core,core)||
      !['pool-owner','pool-snapshot'].includes(pending.phase))return null;
    const recover=ownerRecoveries.get(signer)?.get(`${pending.phase}:${pending.callHash}`);
    if(!recover)return null;return recover();
  };
  const inspectPending=async(boundary:ReturnType<typeof createCurrentAttemptBoundary>,storage:ReturnType<typeof currentDexPendingStorage>,retain=false,verifySnapshot?:SnapshotVerifier)=>{
    await transport.assertCurrent();const pending=boundary.pending();if(!pending)return null;
    if(pending.chainId!==chainId.toString()||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${candidate.graph}`||
      !['pool-owner','pool-transfer','pool-snapshot'].includes(pending.phase))throw new Error('Pending action belongs to another owner or adapter.');
    if(pending.verificationBlocked&&pending.phase!=='pool-snapshot')return Object.freeze({status:'manual-reconciliation-required' as const,transactionHash:pending.txHash,verificationFailure:pending.verificationFailure,verificationBlocked:true as const,readyToSign:false as const});
    if(!pending.txHash)return Object.freeze({status:'manual-reconciliation-required' as const,readyToSign:false as const});
    const tx=await transport.readTransaction(pending.txHash),receipt=await transport.waitForReceipt(pending.txHash);await transport.assertCurrent();
    if(!tx||!receipt)return Object.freeze({status:'awaiting-chain-confirmation' as const,readyToSign:false as const});
    if(keccak256(tx.data).toLowerCase()!==pending.callHash)throw new Error('Pending position calldata changed.');
    const decoded=shape(pending.phase,tx.data,owner,preparedCandidate,exitCandidate);
    const action=pending.phase==='pool-snapshot'?'snapshot':pending.phase==='pool-transfer'?'transfer':({1:'withdraw',5:'resume',6:'activate',7:'close',11:'withdraw',12:'withdraw'} as const)[Number(decoded[2]) as 1|5|6|7|11|12];
    const cap=action==='snapshot'?30_000_000n:isCurrentNativeSwapCandidate(candidate)&&action==='close'?70_000_000n:currentPoolOwnerGasCap(action);
    const request=Object.freeze({chainId,from:owner,to:pending.phase==='pool-transfer'?nft:core,value:0n,
      data:tx.data,nonce:pending.nonce,gasLimit:cap});
    const canonical=snapshotReceipt(await boundary.verifyMinedCall(request,pending.txHash,true));
    // Receipt inclusion is historical; public status does not need the old state trie.
    await attest(await transport.readHead());await transport.assertCurrent();
    if(canonical.status===1&&pending.phase==='pool-transfer')decodeCurrentPoolNftTransfer(canonical.logs??[],nft,owner,decoded[1],decoded[2]);
    if(canonical.status===1&&pending.phase==='pool-owner'&&decoded[2]===7n)decodeCurrentPoolNftTransfer(canonical.logs??[],nft,owner,'0x0000000000000000000000000000000000000000',decoded[0]);
    if(canonical.status===1&&pending.phase==='pool-owner'&&decoded[2]===11n)decodePoolExitPreviewEvent(canonical.logs??[],core,decoded[0]);
    if(canonical.status===1&&pending.phase==='pool-snapshot'){
      const logs=canonical.logs??[],log=logs[0],event=log&&currentNativePoolSnapshotAbi.parseLog({...log,topics:[...log.topics]});
      if(logs.length!==1||!same(log.address,core)||event?.name!=='PoolSnapshotRefreshed'||event.args.positionId!==decoded[0])throw new Error('Snapshot metadata event changed.');
      const encoded=currentNativePoolSnapshotAbi.encodeEventLog(event.fragment,event.args);
      if(!same(encoded.data,log.data)||encoded.topics.length!==log.topics.length||encoded.topics.some((v,i)=>!same(v,log.topics[i])))throw new Error('Snapshot metadata event is non-canonical.');
    }
    await recheck(request,pending.txHash,canonical,true);
    if(verifySnapshot&&candidateKey==='cheap-history'&&candidate.graph===currentCandidate.graph&&
      candidate.packageSha256===currentCandidate.packageSha256&&canonical.status===1&&
      pending.phase==='pool-snapshot'&&pending.verificationFailure==='snapshot-financial-state'&&
      pending.poolTopUpHash===undefined&&pending.target===undefined&&pending.operationId===undefined){
      const result=await verifySnapshot(decoded[0],pending.txHash);
      const recoveryOnly=result.status==='superseded-snapshot-recovery-only';
      if(recoveryOnly)assertVerifiedSupersededPoolSnapshot(result,signer);else assertVerifiedCurrentPoolSnapshot(result,signer);
      await transport.assertCurrent();
      const view=recoveryOnly?result:result.snapshot;
      const status=recoveryOnly?result.claimStatus:result.producer.status, revisions=recoveryOnly?result.revisions:result.producer.revisions;
      if(result.positionId!==decoded[0]||!same(result.transactionHash,pending.txHash)||view.chainId!==chainId||
        !same(view.owner,owner)||!same(view.core,core)||view.graph!==candidate.graph||view.packageSha256!==candidate.packageSha256)
        throw new Error('Verified snapshot differs from the saved operation.');
      // Initial revisions exclude a lost withdrawal/Close verifier; those actions always advance the pinned contract's counters.
      if(status!==1n||revisions.length!==4||revisions.some(v=>v!==1n))
        throw new Error('This snapshot has prior owner management. Keep its original accounting hold.');
      await recheck(request,pending.txHash,canonical);
      boundary.requireOwnPending(pending,pending.txHash);
      const original=storage!.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
      const archiveKey=`chainwhisper:dex:verified-pool-snapshot:v1:${chainId}:${owner.toLowerCase()}:${core.toLowerCase()}:${pending.txHash}`;
      const record=JSON.stringify({original,verification:recoveryOnly?'7bed-superseded-initial-claim-snapshot-recovery-only':'7bed-initial-claim-snapshot',
        blockHash:canonical.blockHash,...(recoveryOnly?{latestSnapshotHash:result.latestSnapshotHash,latestSnapshotBlock:result.latestSnapshotBlock,
          currentBlock:result.block,revisions:result.revisions.map(String)}:{}),intervalAccounting:'not-reconstructed'},(_,v)=>typeof v==='bigint'?String(v):v);
      const existing=storage!.getItem(archiveKey);
      if(existing!==null&&existing!==record)throw new Error('Saved snapshot verification record changed. Keep the hold.');
      storage!.setItem(archiveKey,record);
      if(storage!.getItem(archiveKey)!==record)throw new Error('Snapshot verification record was not retained. Keep the hold.');
      clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(pending,pending.txHash));
      return result;
    }
    // A public receipt cannot clear a prior private-proof failure or recreate its baseline.
    if(retain||pending.verificationBlocked||pending.poolTopUpHash)return Object.freeze({status:canonical.status===0?'observed-reverted-verification-held' as const:'observed-mined-verification-held' as const,
      transactionHash:pending.txHash,positionId:decoded[0] as bigint,independentRefresh:retain,phase:pending.phase,poolTopUpHash:pending.poolTopUpHash,verificationFailure:pending.verificationFailure,verificationBlocked:true as const,privateAccountingVerified:false as const,readyToSign:false as const});
    clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(pending,pending.txHash));
    const key=`${pending.phase}:${pending.callHash}`;if(canonical.status===0)keys!.delete(key);else keys!.add(key);
    return Object.freeze({status:canonical.status===0?'observed-reverted' as const:'observed-mined' as const,
      transactionHash:pending.txHash,phase:pending.phase,privateAccountingVerified:false as const,readyToSign:false as const});
  };
  return Object.freeze({submitPoolPositionAction,recoverCurrentPreparedPoolPositionResult,recoverCurrentNativePoolPositionResult,
    recoverPendingPoolPositionAttempt:async(verifySnapshot?:SnapshotVerifier)=>{
      const held=boundary.pending();
      if(held&&storage?.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY)!==null){
        const refreshStorage=currentPoolRefreshStorage(storage,held);
        const refreshBoundary=createCurrentAttemptBoundary({storage:refreshStorage,c:candidate,core,owner,chainId,transport,attest,now,historical:false,canonicalIndexProof:true});
        return inspectPending(refreshBoundary,refreshStorage,true,verifySnapshot);
      }
      return inspectPending(boundary,storage,false,verifySnapshot);
    }});
};




