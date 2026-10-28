import { getAddress, keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentPoolPositionPrepared, type CurrentPoolPreparedPositionAction, type CurrentPoolPreparedSnapshot, type CurrentPoolPreparedExitPreview } from '../features/wallet/currentDexPoolPositionCapability';
import { decodePoolExitPreviewEvent } from './currentDexPoolExitPreview';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { currentDexPendingStorage, clearCurrentDexPendingAttempt, blockCurrentPoolVerification } from './currentDexPendingAttempt';
import { resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidateKey, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { assertCurrentAppPoolAuthority } from './currentDexC1SwapPolicy';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi, currentPoolOwnerGasCap,
  decodeCurrentPoolNftTransfer, type CurrentPoolOwnerAction } from './currentDexPoolPosition';
import { currentNativePoolSnapshotAbi } from './currentDexNativePoolSnapshot';
import { requireCurrentNativePoolSession, CURRENT_NATIVE_POOL_PROFILE, CURRENT_NATIVE_POOL_LIMITS } from './currentDexNativePoolPolicy';
import { currentNativeSigningBudget, isCurrentNativeSwapCandidate, recordCurrentNativePoolOutcome, completeCurrentNativePoolScope } from './currentDexNativeSwapPolicy';
import { isKnownCurrentPoolProofMismatch } from './currentDexPoolProofError';

// Native ownership and previewed exit: shared-history-pool-{ownership,withdrawal}-2026-10-13/RESULT.json.
// Full Close: native-direct-case; closed snapshot: shared-history-pool-closed-2026-10-14/RESULT.json.
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
  return Object.freeze({submitPoolPositionAction:async(prepared:CurrentPoolPreparedPositionAction|CurrentPoolPreparedSnapshot|CurrentPoolPreparedExitPreview)=>{
    const native=isCurrentNativeSwapCandidate(candidate), snapshot=prepared.action==='snapshot';
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
      {owner,action:prepared.action,positionId:prepared.positionId,recipient:prepared.recipient});}
      if(nativePoolProfile!==CURRENT_NATIVE_POOL_PROFILE||session!.positionId!==prepared.positionId||session!.unfundedFailed||
        (!snapshot&&prepared.action!=='close')||(snapshot&&prepared.closed!==!!session!.closedPayouts))throw new Error('Native Pool owner phase is not admitted.');
    };
    const validate=async()=>{
      assertCurrentPoolPositionPrepared(prepared,signer);await prepared.assertCurrent();
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
    boundary.requireEmptyPending();
    const call=Object.freeze({chainId,from:owner,to:prepared.to,value:0n,data:prepared.data}),key=`${phase}:${keccak256(call.data).toLowerCase()}${snapshot?':'+budgetPhase:''}${snapshot&&prepared.replacementFrom?':'+prepared.replacementFrom:''}`;
    const checkBudget=async()=>{if(!budget)return;admission();budget.check(budgetPhase,key,cap,session!.scope);
      const head=await boundary.currentHead(undefined,cap);if(!transport.readNativeResources)throw new Error('Native Pool exit resources are unavailable.');
      const resources=await transport.readNativeResources(head);if(resources.balance<budget.snapshot().poolRemainingTailWei+CURRENT_NATIVE_POOL_LIMITS.payerReserveWei)throw new Error('Native Pool reserved exit resources are insufficient.');};
    await checkBudget();
    if(keys!.has(key))throw new Error('Position action was already submitted. Recover it instead.');keys!.add(key);
    let signing=false;
    try{
      const sent=await boundary.sendCurrent(phase,call,undefined,async()=>{await validate();admission();await prepared.assertBeforeSend();await validate();admission();await checkBudget();},()=>{signing=true;},undefined,cap,undefined,
        async()=>{await checkBudget();budget?.commit(budgetPhase,key,cap,session!.scope);}, undefined, undefined, undefined, undefined, undefined,
        candidateKey === 'cheap-history' ? { kind: 'position', prepared, signer } : undefined);
      const result=Object.freeze({...sent,status:'position-action-pending' as const,recover:async()=>{
        const pending=boundary.pending();
        if(!pending||pending.chainId!==chainId.toString()||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${candidate.graph}`||pending.phase!==phase||pending.callHash!==keccak256(call.data).toLowerCase()||pending.nonce!==sent.request.nonce)throw new Error('Position pending attempt changed.');
        boundary.requireOwnPending(pending,sent.transactionHash);
        if(pending.verificationBlocked)throw new Error('Known Pool verification failure. Manual reconciliation is required.');
        let canonical:ReturnType<typeof snapshotReceipt>,result:Awaited<ReturnType<typeof prepared.readResult>>;
        try{canonical=snapshotReceipt(await boundary.verifyMinedCall(sent.request,sent.transactionHash));await validate();
          result=await prepared.readResult(sent.transactionHash);await prepared.assertCurrent();
          await recheck(sent.request,sent.transactionHash,canonical);
        }catch(error){if((native||preparedCandidate)&&isKnownCurrentPoolProofMismatch(error))blockCurrentPoolVerification(storage,boundary.requireOwnPending(pending,sent.transactionHash));throw error;}
        if(!result)throw new Error('Private position result is unavailable.');
        if(native){if(!snapshot)recordCurrentNativePoolOutcome(signer,session!.scope,'closed');
          else if(prepared.closed){completeCurrentNativePoolScope(signer,session!.scope);session!.completed=true;}}
        clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(pending,sent.transactionHash));return result;
      }});
      if(native||preparedCandidate){let recoveries=ownerRecoveries.get(signer);if(!recoveries){recoveries=new Map();ownerRecoveries.set(signer,recoveries);}recoveries.set(`${phase}:${keccak256(call.data).toLowerCase()}`,result.recover);}
      return result;
    }catch(error){if(!signing)keys!.delete(key);throw error;}
  },recoverCurrentPreparedPoolPositionResult:async()=>{
    await transport.assertCurrent();const pending=boundary.pending();if(!pending||!preparedCandidate)return null;
    if(pending.chainId!==String(chainId)||!same(pending.owner,owner)||pending.graph!==`0x${candidate.graph}`||!same(pending.core,core)||!['pool-snapshot','pool-owner','pool-transfer'].includes(pending.phase))return null;
    const recover=ownerRecoveries.get(signer)?.get(`${pending.phase}:${pending.callHash}`);
    if(!recover)return null;return recover();
  },recoverCurrentNativePoolPositionResult:async()=>{
    await transport.assertCurrent();const pending=boundary.pending();if(!pending||!isCurrentNativeSwapCandidate(candidate))return null;
    if(pending.chainId!==String(chainId)||!same(pending.owner,owner)||pending.graph!==`0x${candidate.graph}`||!same(pending.core,core)||
      !['pool-owner','pool-snapshot'].includes(pending.phase))return null;
    const recover=ownerRecoveries.get(signer)?.get(`${pending.phase}:${pending.callHash}`);
    if(!recover)return null;return recover();
  },recoverPendingPoolPositionAttempt:async()=>{
    await transport.assertCurrent();const pending=boundary.pending();if(!pending)return null;
    if(pending.chainId!==chainId.toString()||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${candidate.graph}`||
      !['pool-owner','pool-transfer','pool-snapshot'].includes(pending.phase))throw new Error('Pending action belongs to another owner or adapter.');
    if(pending.verificationBlocked)return Object.freeze({status:'manual-reconciliation-required' as const,verificationBlocked:true as const,readyToSign:false as const});
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
    await attest({number:BigInt(canonical.blockNumber!),hash:canonical.blockHash!});await transport.assertCurrent();
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
    clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(pending,pending.txHash));
    const key=`${pending.phase}:${pending.callHash}`;if(canonical.status===0)keys!.delete(key);else keys!.add(key);
    return Object.freeze({status:canonical.status===0?'observed-reverted' as const:'observed-mined' as const,
      transactionHash:pending.txHash,phase:pending.phase,privateAccountingVerified:false as const,readyToSign:false as const});
  }});
};




