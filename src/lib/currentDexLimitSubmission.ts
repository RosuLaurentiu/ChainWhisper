import { getAddress,keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentLimitPrepared,type CurrentLimitPrepared,type CurrentLimitPreparedSnapshot,type CurrentLimitPreparedOwner,type CurrentLimitReconciledTopUp } from '../features/wallet/currentDexLimitCapability';
import { createCurrentAttemptBoundary,type CurrentTransport } from './currentDexSubmission';
import { currentDexPendingStorage,clearCurrentDexPendingAttempt,blockCurrentLimitVerification } from './currentDexPendingAttempt';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { currentLimitAbiForCandidate,resolveCurrentLimitScope,CURRENT_LIMIT_CREATE_GAS_CAP,CURRENT_LIMIT_SNAPSHOT_GAS_CAP,decodeCurrentLimitMint,decodeCurrentLimitOwnerEvent,CURRENT_LIMIT_OWNER_GAS_CAPS,currentLimitOwnerNativeAdmission,assertCurrentLimitNativeAdmission,currentLimitOwnerMethod,isKnownCurrentLimitProofMismatch,type CurrentLimitOwnerAction } from './currentDexLimit';
import { decodeCurrentPoolNftTransfer } from './currentDexPoolPosition';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentSwapFixedGasPrice } from './currentDexExitSwapPolicy';
import { isCurrentAppLimitTopUpRepair } from './currentDexC1SwapPolicy';
// Keep the canonical baseline independent of mutable provider receipt objects.
const snapshotReceipt = (receipt: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => {
  const logs = receipt.logs?.map(log => {
    const topics = [...log.topics]; Object.freeze(topics);
    return Object.freeze({ ...log, topics });
  });
  if (logs) Object.freeze(logs);
  return Object.freeze({ ...receipt, logs });
};
const reservations=new WeakMap<object,Set<string>>();
const ownerReservations=new WeakMap<object,WeakSet<object>>();
const same=(a:string|null,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
type Prepared=CurrentLimitPrepared|CurrentLimitPreparedSnapshot|CurrentLimitPreparedOwner;
export const createCurrentLimitSubmissionAdapter=({signer,ownerAddress,chainId,transport,attest,requireFunding,candidate='cheap-current',now=()=>BigInt(Math.floor(Date.now()/1000))}:{
  signer:object;ownerAddress:string;chainId:bigint;transport:CurrentTransport;attest:(head:{number:bigint;hash:string})=>Promise<void>;
  requireFunding:(prepared:CurrentLimitPrepared,head:{number:bigint;hash:string})=>Promise<void>;now?:()=>bigint;candidate?:CurrentCheapDexCandidateKey;
})=>{
  const c=resolveCurrentCheapDexCandidate(candidate);
  const abi=currentLimitAbiForCandidate(candidate),preparedMarket=candidate==='cheap-prepared'||candidate==='cheap-exit'||candidate==='cheap-history';
  const owner=getAddress(ownerAddress),core=getAddress(c.core),storage=currentDexPendingStorage();
  if(chainId!==BigInt(c.chainId)||BigInt(owner)===0n)throw new Error('Wrong Limit owner or chain.');
  const boundary=createCurrentAttemptBoundary({storage,c,core,owner,chainId,transport,attest,now,historical:false});
  let keys=reservations.get(signer);if(!keys){keys=new Set();reservations.set(signer,keys);}
  let ownerKeys=ownerReservations.get(signer);if(!ownerKeys){ownerKeys=new WeakSet();ownerReservations.set(signer,ownerKeys);}
  const ownerAction=(data:string):CurrentLimitOwnerAction=>{const call=abi.parseTransaction({data});if(!call)throw new Error('Invalid Limit owner call.');const action=call.name==='topUpPrivateOrder'?'topup':call.name==='repricePrivateOrder'?'reprice':call.name==='privateOrderSnapshot'?'refresh':call.name==='claimPrivateOrderProceeds'?'claim':call.name==='closePrivateOrder'?'close':call.name==='managePrivateOrderStatus'&&call.args[2]===0n?'pause':call.name==='managePrivateOrderStatus'&&call.args[2]===1n?'resume':null;if(!action)throw new Error('Unsupported Limit owner call.');return action;};
  const shape=(phase:string,data:string)=>{const method=phase==='limit-create'?'createPrivateOrder':phase==='limit-owner'?currentLimitOwnerMethod(ownerAction(data)):'privateOrderSnapshot';const decoded=abi.decodeFunctionData(method,data);
    if(!same(abi.encodeFunctionData(method,decoded),data)||(phase!=='limit-create'&&decoded[0]<8n)||(['managePrivateOrderStatus','topUpPrivateOrder','repricePrivateOrder'].includes(method)&&decoded[1]===0n)||(method==='topUpPrivateOrder'&&decoded[2]===0n))throw new Error('Non-canonical Limit request.');
    if(preparedMarket&&phase==='limit-create'){
      const selected=resolveCurrentLimitScope(candidate,resolveCurrentLimitScopeForMarket(decoded[0]));
      if(selected.marketId!==decoded[0])throw new Error('Limit creation market changed.');
    }
    return decoded;};
  const resolveCurrentLimitScopeForMarket=(market:string)=>{
    const pairs=resolvePreparedDexScope(candidate).candidate.pairs,pair=pairs.find(pair=>pair.marketId===market);
    if(!pair)throw new Error('Limit creation market is outside its candidate.');return pair.tokens;
  };
  const submitLimit=async(prepared:Prepared)=>{
    const phase=prepared.phase,action=phase==='limit-owner'?prepared.action:null,cap=action?CURRENT_LIMIT_OWNER_GAS_CAPS[action]:phase==='limit-create'?CURRENT_LIMIT_CREATE_GAS_CAP:CURRENT_LIMIT_SNAPSHOT_GAS_CAP;
    // The owner preparation brand and selected market are checked before this.
    // Only proven candidate phases pass this gate. The attempt boundary
    // still enforces the separate connected-App hold and fresh signing authority.
    const admission=()=>assertCurrentLimitNativeAdmission(candidate,phase,action??undefined);
    const validate=async(head?:{number:bigint;hash:string})=>{
      assertCurrentLimitPrepared(prepared,signer);await prepared.assertCurrent();
      if(!['limit-create','limit-snapshot','limit-owner'].includes(phase)||prepared.chainId!==chainId||!same(prepared.from,owner)||!same(prepared.to,core)||prepared.value!==0n||prepared.graph!==c.graph||prepared.packageSha256!==c.packageSha256||prepared.readyToSign!==false)throw new Error('Limit request differs from its owner candidate.');
      const decoded=shape(phase,prepared.data);if(phase==='limit-snapshot'&&('positionId'in prepared?decoded[0]!==prepared.positionId:true))throw new Error('Limit snapshot ID changed.');
      if(preparedMarket){const selected=resolveCurrentLimitScope(candidate,prepared.poolTokens);if(prepared.marketId!==selected.marketId||!prepared.poolTokens?.every((token,index)=>token===selected.poolTokens[index])||phase==='limit-create'&&decoded[0]!==prepared.marketId)throw new Error('Limit request differs from its selected market.');}
      if(phase==='limit-owner'){
        if(!action||ownerAction(prepared.data)!==action||decoded[0]!==prepared.positionId||(action==='pause'||action==='resume')&&decoded[1]!==prepared.expectedLifecycleRevision||(action==='topup'||action==='reprice')&&decoded[1]!==prepared.expectedTermsRevision||action==='topup'&&decoded[2]!==prepared.expectedLifecycleRevision)throw new Error('Limit owner action, ID or lifecycle changed.');
        if(!currentLimitOwnerNativeAdmission(candidate)[action])throw new Error('Limit owner action awaits exact candidate native App submission admission. No transaction was sent.');
        if(head)await prepared.assertAuthority(head);
      }
      if(phase==='limit-create'&&head){if(preparedMarket)await (prepared as CurrentLimitPrepared).assertAuthority(head);await requireFunding(prepared as CurrentLimitPrepared,head);}
      if(phase==='limit-snapshot'&&head)await (prepared as CurrentLimitPreparedSnapshot).assertAuthority(head);
    };
    await validate();admission();boundary.requireEmptyPending();const key=`${phase}:${keccak256(prepared.data).toLowerCase()}`;
    if(phase==='limit-owner'?ownerKeys!.has(prepared):keys!.has(key))throw new Error('Limit request was already submitted. Reconcile it.');if(phase==='limit-owner')ownerKeys!.add(prepared);else keys!.add(key);let signing=false;
    const call=Object.freeze({chainId,from:owner,to:core,value:0n as const,data:prepared.data});
    try{const sent=await boundary.sendCurrent(phase,call,undefined,async()=>{admission();await validate(await boundary.currentHead(undefined,cap));admission();},()=>{signing=true;},undefined,cap,undefined,undefined,undefined,undefined,undefined,undefined,candidate==='cheap-history'?{prepared,signer}:undefined);
      return Object.freeze({...sent,status:'limit-pending' as const,recover:async()=>{
        const pending=boundary.pending();if(!pending||pending.chainId!==chainId.toString()||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${c.graph}`||pending.phase!==phase||pending.callHash!==keccak256(call.data).toLowerCase()||pending.nonce!==sent.request.nonce)throw new Error('Limit pending request changed.');boundary.requireOwnPending(pending,sent.transactionHash);
        if(pending.verificationBlocked)throw new Error('Known Limit verification failure. Manual reconciliation is required.');
        try{
          const canonical=snapshotReceipt(await boundary.verifyMinedCall(sent.request,sent.transactionHash));await validate();const result=await prepared.readResult(sent.transactionHash);await prepared.assertCurrent();if(!result)throw new Error('Limit authenticated result is unavailable.');await boundary.recheckMinedCall(sent.request,sent.transactionHash,canonical);clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(pending,sent.transactionHash));return result;
        }catch(error){if(isKnownCurrentLimitProofMismatch(error))blockCurrentLimitVerification(storage,boundary.requireOwnPending(pending,sent.transactionHash));throw error;}
      }});
    }catch(error){if(!signing){if(phase==='limit-owner')ownerKeys!.delete(prepared);else keys!.delete(key);}throw error;}
  };
  const reconcileMinedTopUp=async(proof:CurrentLimitReconciledTopUp)=>{
    assertCurrentLimitPrepared(proof,signer);await proof.assertCurrent();await transport.assertCurrent();const p=boundary.pending();
    if(!p||!p.verificationBlocked||p.phase!=='limit-owner'||p.chainId!==chainId.toString()||!same(p.owner,owner)||!same(p.core,core)||p.graph!==`0x${c.graph}`||!p.txHash||
      proof.phase!=='limit-topup-reconciliation'||proof.readyToSign!==false||proof.chainId!==chainId||!same(proof.from,owner)||!same(proof.to,core)||proof.graph!==c.graph||proof.packageSha256!==c.packageSha256||
      !same(proof.transactionHash,p.txHash)||proof.nonce!==p.nonce||keccak256(proof.data).toLowerCase()!==p.callHash||typeof proof.topUpAmount!=='bigint'||proof.topUpAmount<=0n)throw new Error('Top-up reconciliation differs from the blocked owner transaction.');
    const decoded=shape(p.phase,proof.data),result=proof.result;
    if(ownerAction(proof.data)!=='topup'||decoded[0]!==proof.positionId||result.positionId!==proof.positionId||!same(result.owner,owner)||!same(result.transactionHash,p.txHash)||result.closed||!result.refreshRequired||result.values!==null||result.amounts!==null||proof.privateReceiptDebitsVerified!==true||typeof proof.privateWalletDeltaVerified!=='boolean')throw new Error('Top-up reconciliation has another action or result.');
    const request={chainId,from:owner,to:core,value:0n as const,data:proof.data,nonce:p.nonce,gasLimit:CURRENT_LIMIT_OWNER_GAS_CAPS.topup,gasPrice:currentSwapFixedGasPrice(c)};
    const canonical=snapshotReceipt(await boundary.verifyMinedCall(request,p.txHash));
    if(BigInt(canonical.blockNumber!)!==proof.receiptBlock.number||!same(canonical.blockHash??null,proof.receiptBlock.hash))throw new Error('Top-up reconciliation receipt block changed.');
    if(proof.privateWalletDeltaVerified){
      if(result.block.number!==proof.receiptBlock.number||!same(result.block.hash,proof.receiptBlock.hash))throw new Error('Top-up reconciliation result block changed.');
    }else if(!isCurrentAppLimitTopUpRepair({graph:c.graph,owner,core,hash:p.txHash,nonce:p.nonce,blockNumber:canonical.blockNumber!,blockHash:canonical.blockHash!,positionId:proof.positionId,amount:proof.topUpAmount}))throw new Error('Receipt-only top-up repair has no owner authority.');
    await proof.assertCurrent();await transport.assertCurrent();await boundary.recheckMinedCall(request,p.txHash,canonical);
    clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(p,p.txHash));return result;
  };
  return Object.freeze({submitLimit,submitLimitOwner:(prepared:CurrentLimitPreparedOwner)=>submitLimit(prepared),reconcileMinedTopUp,recoverPendingLimitAttempt:async()=>{
    await transport.assertCurrent();const p=boundary.pending();if(!p)return null;
    if(p.chainId!==chainId.toString()||!same(p.owner,owner)||!same(p.core,core)||p.graph!==`0x${c.graph}`||!['limit-create','limit-snapshot','limit-owner'].includes(p.phase))throw new Error('Pending attempt belongs to another owner adapter.');
    if(p.verificationBlocked){
      const tx=p.phase==='limit-owner'&&p.txHash?await transport.readTransaction(p.txHash):null;await transport.assertCurrent();
      if(tx&&tx.chainId===chainId&&same(tx.from,owner)&&same(tx.to,core)&&tx.value===0n&&tx.nonce===p.nonce&&keccak256(tx.data).toLowerCase()===p.callHash&&ownerAction(tx.data)==='topup'){
        const decoded=shape(p.phase,tx.data);return Object.freeze({status:'manual-reconciliation-required' as const,verificationBlocked:true as const,readyToSign:false as const,topUp:Object.freeze({positionId:decoded[0]as bigint,transactionHash:p.txHash!})});
      }
      return Object.freeze({status:'manual-reconciliation-required' as const,verificationBlocked:true as const,readyToSign:false as const});
    }
    if(!p.txHash)return Object.freeze({status:'manual-reconciliation-required' as const,readyToSign:false as const});
    const tx=await transport.readTransaction(p.txHash),receipt=await transport.waitForReceipt(p.txHash);await transport.assertCurrent();if(!tx||!receipt)return Object.freeze({status:'awaiting-chain-confirmation' as const,readyToSign:false as const});
    if(keccak256(tx.data).toLowerCase()!==p.callHash)throw new Error('Limit pending calldata changed.');const decoded=shape(p.phase,tx.data);
    const cap=p.phase==='limit-owner'?CURRENT_LIMIT_OWNER_GAS_CAPS[ownerAction(tx.data)]:p.phase==='limit-create'?CURRENT_LIMIT_CREATE_GAS_CAP:CURRENT_LIMIT_SNAPSHOT_GAS_CAP;
    const request=Object.freeze({chainId,from:owner,to:core,value:0n,data:tx.data,nonce:p.nonce,gasLimit:cap});
    const canonical=snapshotReceipt(await boundary.verifyMinedCall(request,p.txHash,true));
    // Receipt-only reload recovery grants no private authority and needs no archive state.
    await attest(await transport.readHead());await transport.assertCurrent();
    if(canonical.status===1&&p.phase==='limit-create')decodeCurrentLimitMint(canonical.logs??[],owner,c);
    if(canonical.status===1&&p.phase==='limit-owner'){
      const action=ownerAction(tx.data),logs=canonical.logs??[],nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];decodeCurrentLimitOwnerEvent(logs,action,decoded[0],c,action==='reprice'?decoded[1]:undefined);
      const nftRows=logs.filter(x=>same(x.address,nft));if(action==='close'){if(nftRows.length!==1)throw new Error('Unexpected Limit NFT burn events.');decodeCurrentPoolNftTransfer(nftRows,nft,owner,'0x0000000000000000000000000000000000000000',decoded[0]);}else if(nftRows.length)throw new Error('Unexpected Limit NFT movement.');
    }
    await transport.assertCurrent();
    await boundary.recheckMinedCall(request,p.txHash,canonical,true);
    clearCurrentDexPendingAttempt(storage,boundary.requireOwnPending(p,p.txHash));const key=`${p.phase}:${p.callHash}`;if(canonical.status===0)keys!.delete(key);else keys!.add(key);
    // Metadata-only reload recovery releases the nonce lock, not private amount authority.
    return Object.freeze({status:canonical.status===0?'observed-reverted' as const:'observed-mined' as const,transactionHash:p.txHash,phase:p.phase,privateAccountingVerified:false as const,readyToSign:false as const});
  }});
};




