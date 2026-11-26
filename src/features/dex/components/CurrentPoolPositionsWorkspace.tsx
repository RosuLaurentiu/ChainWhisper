import { wasCurrentDexUnsentReleased } from '../../../lib/currentDexSendBoundary';
import { CURRENT_UNSENT_RELEASED_MESSAGE, currentDexRecordScope } from '../../../lib/currentDexDisplay';
import { formatCurrentDexAveragePrice } from '../../../lib/currentDexPriceImpact';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { logMobileWalletDiagnostic } from '../../../lib/mobileWalletDiagnostics';
import { getProviderErrorMessage, isProviderActionRejected } from '../../../lib/appShared/core';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import type { issueCurrentDexPoolPositionCapability } from '../../wallet/currentDexPoolPositionCapability';
import type { CurrentPoolOwnerAction } from '../../../lib/currentDexPoolPosition';
import { assertCurrentPoolPositionNativeAdmission } from '../../../lib/currentDexPoolPositionSubmission';
import { usesPackedPoolInputs } from '../../../lib/currentDexPoolFunding';
import { assertCurrentAppPoolAuthority } from '../../../lib/currentDexC1SwapPolicy';
import { parseCurrentTrialAtoms, parseCurrentTrialPriceLimit, CURRENT_POOL_SPREADS } from './CurrentPoolWorkspace';
import { CURRENT_DEX_POOL_LABELS, formatCurrentDexTokenAmount, parseCurrentDexTokenAmount, hasCurrentDexPendingAction, readCurrentDexDisplay, formatDexCandidateTokenAmount, parseDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import './CurrentPoolPositionsWorkspace.css';
import CurrentPreparedPoolTopUpWorkspace from './CurrentPreparedPoolTopUpWorkspace';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';
import { currentPoolVerificationMessage, isReviewableTopUpFailure } from '../../../lib/currentDexPoolProofError';
import { currentPositionReviewFor, readCurrentPositionReviews } from '../../../lib/currentDexPositionReview';
import { usesTransactionScopedPoolSnapshots } from '../../../lib/currentDexSnapshotAdmission';
import { currentDexPendingStorage, readCurrentDexPendingAttempt, heldPoolSnapshotRefreshEligible, isReviewedPoolPreview, CURRENT_POOL_REFRESH_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
type Capability=Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>;
type Sender=Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type PositionResult=Awaited<ReturnType<Awaited<ReturnType<Sender['submitPoolPositionAction']>>['recover']>>;
type ExitPreviewResult=Extract<NonNullable<PositionResult>,{status:'exit-preview-verified'}>;
type ResultSnapshot<T>=T extends {snapshot:infer S}?S:never;
type Snapshot=Awaited<ReturnType<Capability['readPosition']>>|ResultSnapshot<NonNullable<PositionResult>>;
export const currentPoolWithdrawalFraction=(percentage:string):readonly [bigint,bigint]=>{
  const {numerator,denominator}=parseCurrentTrialPriceLimit(percentage);
  if(numerator>=denominator*100n)throw new Error('Use Close for a full withdrawal. Enter less than 100%.');
  let n=numerator,d=denominator*100n,a=n,b=d;
  while(b!==0n)[a,b]=[b,a%b];n/=a;d/=a;
  if(d>=1n<<128n)throw new Error('Withdrawal percentage is outside the supported range.');return[n,d];
};
export default function CurrentPoolPositionsWorkspace({sharedWalletSession,candidateKey='cheap-history',visible=true,managementNavigation,selectedPair,priceDisplayInverted=false}:{selectedPair?:readonly[string,string];priceDisplayInverted?:boolean;sharedWalletSession?:SharedWalletSession;candidateKey?:CurrentCheapDexCandidateKey;visible?:boolean;managementNavigation?:ReactNode}){
  const preparedScope=resolvePreparedDexScope(candidateKey);
  const candidate=preparedScope?.candidate??resolveCurrentCheapDexCandidate(candidateKey);
  const recordScope=currentDexRecordScope(candidate,sharedWalletSession?.walletAddress);
  const preparedCandidate=preparedScope!==null,signedSnapshot=preparedCandidate;
  const exitCandidate=true;
  const ownedDiscovery=exitCandidate;
  const [id,setId]=useState(''),[percentage,setPercentage]=useState('50'),[minimum0,setMinimum0]=useState('0'),[minimum1,setMinimum1]=useState('0'),[recipient,setRecipient]=useState('');
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setStoredMessage]=useState('');
  const messageScope=useRef<object|null>(null);
  const [snapshot,setSnapshot]=useState<{value:Snapshot;scope:object;closePayoutVerified?:boolean}|null>(null);
  const [pending,setPending]=useState<{recover:()=>Promise<PositionResult>;scope:object;snapshot?:boolean}|null>(null);
  const [transactionHash,setTransactionHash]=useState('');
  const [producerHash,setProducerHash]=useState('');
  const [topUpManagement,setTopUpManagement]=useState<{scope:object;id:string;managed:boolean}|null>(null);
  const [exitPreview,setExitPreview]=useState<{scope:object;value:ExitPreviewResult}|null>(null);
  const [ownedRefresh,setOwnedRefresh]=useState('');
  const getPositions=sharedWalletSession?.actions?.getCurrentDexPoolPositionCapability,getSender=sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyReady=sharedWalletSession?resolveBrowserWalletPrivacyState({browserWalletAddress:sharedWalletSession.walletAddress,
    sessionOnboardInfo:sharedWalletSession.sessionOnboardInfo??{},walletAesHealthByAddress:sharedWalletSession.walletAesHealthByAddress}).ownerAesReady:false;
  const context={candidateKey,graph:candidate.graph,packageSha256:candidate.packageSha256,owner:sharedWalletSession?.walletAddress.toLowerCase(),chain:sharedWalletSession?.chainId,
    provider:sharedWalletSession?.browserProvider,walletId:sharedWalletSession?.browserWalletId,source:sharedWalletSession?.activeSignerSource,getPositions,getSender,
    privacyReady,onboard:sharedWalletSession?.sessionOnboardInfo,health:sharedWalletSession?.walletAesHealthByAddress};
  const scope=useRef(context);
  const inFlight=useRef(false);
  const changedScopeFields=(Object.keys(context)as(keyof typeof context)[]).filter(key=>context[key]!==scope.current[key]);
  if(changedScopeFields.length){
    logMobileWalletDiagnostic('pool-position-scope-invalidated',{phase:'render',fields:changedScopeFields,selected:Boolean(id)});
    scope.current=context;
  }
  useEffect(()=>{
    logMobileWalletDiagnostic('pool-positions-mounted');
    return()=>logMobileWalletDiagnostic('pool-positions-unmounted');
  },[]);
  useEffect(()=>{logMobileWalletDiagnostic('pool-position-selection',{selected:Boolean(id)});},[id]);
  const {confirmation,requestConfirmation,resolveConfirmation}=useTradeActionConfirmationState(scope.current);
  const setMessage=(text:string)=>{messageScope.current=scope.current;setStoredMessage(text);};
  const current=snapshot?.scope===scope.current&&snapshot.value.positionId.toString()===id;
  const connected=Boolean(context.owner&&context.chain===Number(candidate.chainId)&&getPositions&&getSender&&context.provider);
  const savedActionPending=hasCurrentDexPendingAction(recordScope);
  const topUpOpen=topUpManagement?.scope===scope.current&&topUpManagement.id===id;
  const savedFunding=(()=>{
    if(!preparedCandidate||!savedActionPending)return null;
    try{
      const saved=readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      return saved?.phase==='pool-preview'||saved?.phase==='pool-fund'?saved:null;
    }catch{return null;}
  })();
  const poolFundingPending=!!savedFunding;
  // CW-135: both top-up transactions are mined, but the last check of the App stopped.
  // CW-140.02: the release review accepts only some hold reasons; every other reason keeps manual reconciliation.
  const heldTopUp=(()=>{
    if(!preparedCandidate||!savedActionPending)return null;
    try{
      const saved=readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      if(!(saved?.phase==='pool-snapshot'&&saved.verificationBlocked===true&&typeof saved.poolTopUpHash==='string'&&!!saved.txHash))return null;
      return {reviewable:isReviewableTopUpFailure(saved.verificationFailure),failure:saved.verificationFailure};
    }catch{return null;}
  })();
  // CW-140.02: mined top-ups that wait for the owner's review lock only their own position.
  const positionReviews=(()=>{
    if(!preparedCandidate||!context.owner)return [];
    try{return readCurrentPositionReviews(currentDexPendingStorage(recordScope),{chainId:String(candidate.chainId),owner:context.owner,core:candidate.core});}
    catch{return [];}
  })();
  const selectedReview=currentPositionReviewFor(positionReviews,id);
  const reviewablePreview=isReviewedPoolPreview(savedFunding);
  const independentRefresh=(()=>{try{
    const storage=currentDexPendingStorage(recordScope);
    return candidateKey==='cheap-history'&&current&&snapshot.value.status===1n&&
      storage?.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY)===null&&
      heldPoolSnapshotRefreshEligible(readCurrentDexPendingAttempt(storage),{chainId:String(candidate.chainId),owner:context.owner??'',core:candidate.core,
        graph:`0x${candidate.graph}`});
  }catch{return false;}})();
  const assertScope=(captured:object)=>{if(captured!==scope.current)throw new Error('Position owner or wallet session changed. Refresh this position.');};
  const actionTerms=useRef('');actionTerms.current=[id,percentage,minimum0,minimum1,recipient,producerHash].join(':');
  const released=(error:unknown,captured:object)=>{if(captured!==scope.current||!wasCurrentDexUnsentReleased(error))return false;setBlocked(hasCurrentDexPendingAction(recordScope));return true;};
  const fail=(error:unknown,captured:object)=>setMessage(released(error,captured)?CURRENT_UNSENT_RELEASED_MESSAGE:captured!==scope.current
    ?'Position owner or wallet session changed. Refresh this position.'
    :isProviderActionRejected(error)?'The wallet request was rejected.'
    :getProviderErrorMessage(error,'Position action failed. Check its status before another request.'));
  const read=async(selectedId?:bigint)=>{
    if(!connected||inFlight.current||busy||topUpOpen)return;inFlight.current = true; setBusy(true);setSnapshot(null);const captured=scope.current;
    try{
      const capability=preparedCandidate?await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key}):await getPositions!(BigInt(candidate.chainId));assertScope(captured);
      const value=await capability.readPosition(selectedId??parseCurrentTrialAtoms(id,true),selectedId?undefined:
        signedSnapshot&&producerHash.trim()?{producerHash:producerHash.trim()}:undefined);assertScope(captured);
      if('producerHash'in value&&typeof value.producerHash==='string')setProducerHash(value.producerHash);
      setSnapshot({value,scope:captured});setMessage(value.status===4n?'Position closed.':value.status===3n?'Activate privacy to manage this received position.':
        value.amounts?'Owner private claim verified at the canonical block.':'Refresh private state to see your amounts.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const produceSnapshot=async()=>{
    if(!signedSnapshot||!connected||inFlight.current||busy||(blocked||savedActionPending)&&!independentRefresh||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current;inFlight.current = true; setBusy(true);
    try{
      if(preparedCandidate){assertCurrentPoolPositionNativeAdmission(candidate,'snapshot',snapshot?.value.status===4n);
        if(candidateKey!=='cheap-history')assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action:'snapshot',positionId:parseCurrentTrialAtoms(id,true)});}
      const capability=preparedCandidate?await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key}):await getPositions!(BigInt(candidate.chainId));assertScope(captured);
      const prepared=await capability.prepareSnapshot({positionId:parseCurrentTrialAtoms(id,true),confirm:async review=>{
        assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed. Review them again.');
        const accepted=await requestConfirmation({title:review.closed?'Verify closed liquidity claim':'Refresh private liquidity claim',primaryLabel:'Continue',fundingMoves:[],
          summaryRows:[{label:'Position NFT',value:review.positionId.toString()},{label:'Maximum network fee',value:`${formatCurrentDexTokenAmount(review.gasCap*50_000_000n)} Test COTI`}],
          stats:[],message:review.closed?'This paid snapshot verifies the exact payouts and zero remaining shares. It does not close or pay the claim again.':
            independentRefresh?'This is a new paid refresh. The old failed check and its saved record stay unchanged. Spending actions remain locked. It does not move token funds.':'This paid snapshot updates your private claim. It does not move token funds.'});
        assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed during review.');return accepted;
      }});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed.');
      if(!prepared){setMessage('Private snapshot cancelled.');return;}
      const sender=await getSender!(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:undefined);assertScope(captured);setBlocked(true);
      const sent=independentRefresh?await sender.submitPoolPositionAction(prepared,undefined,{refreshHeldSnapshot:true}):await sender.submitPoolPositionAction(prepared);assertScope(captured);
      setPending({recover:sent.recover,scope:captured,snapshot:true});setTransactionHash(sent.transactionHash);
      assertScope(captured);setMessage('Private snapshot submitted. Checking its authenticated result.');
      const confirmed=await sender.waitForCurrentCheapReceipt(sent.transactionHash);assertScope(captured);
      if(!confirmed){setMessage('Private snapshot confirmation is pending. Check position status before another action.');return;}
      const result=await sent.recover();assertScope(captured);
      if(!result)throw new Error('Private snapshot result is not available yet. Check position status before another action.');
      acceptPrivateResult(result,captured);
      if(independentRefresh)setMessage('Fresh private claim verified. The old verification hold remains; spending actions stay locked.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const restoreWithdrawal=async()=>{
    if(!exitCandidate||!connected||inFlight.current||busy||blocked||savedActionPending||!current||!snapshot||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current,before=snapshot.value;inFlight.current=true;setBusy(true);setExitPreview(null);
    try{
      const fraction=currentPoolWithdrawalFraction(percentage);
      const capability=await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
      const result=await capability.restoreExitPreview({positionId:before.positionId,expectedContext:before.context,fraction,
        ...(producerHash.trim()?{producerHash:producerHash.trim()}:{} )});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed. Restore the preview again.');
      if(!acceptPrivateResult(result,captured))setMessage('No completed withdrawal preview was found for this position.');
    }catch(error){fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  const previewWithdrawal=async()=>{
    if(!exitCandidate||!connected||inFlight.current||busy||blocked||savedActionPending||!current||!snapshot||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current,before=snapshot.value;inFlight.current=true;setBusy(true);
    try{
      assertCurrentPoolPositionNativeAdmission(candidate,'withdraw',false,'preview');
      if(candidateKey!=='cheap-history')assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action:'withdraw',positionId:before.positionId});
      const fraction=currentPoolWithdrawalFraction(percentage);
      const capability=await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
      const prepared=await capability.prepareExitPreview({positionId:before.positionId,expectedContext:before.context,fraction,
        ...(producerHash.trim()?{producerHash:producerHash.trim()}:{}),confirm:async review=>{
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed. Review them again.');
          const accepted=await requestConfirmation({title:'Preview partial liquidity withdrawal',primaryLabel:'Continue',fundingMoves:[],
            summaryRows:[{label:'Position NFT',value:before.positionId.toString()},
              {label:'Share fraction',value:`${review.fraction[0]}/${review.fraction[1]}`},
              {label:'Private-input signatures for preview',value:String(usesPackedPoolInputs(candidate)?1:2)},
              {label:'Maximum network fee',value:`${formatCurrentDexTokenAmount(review.gasCap*50_000_000n)} Test COTI`}],stats:[],
            message:'This paid preview gives your private payouts and remaining shares. It does not withdraw tokens. Review withdrawal separately after checking its result.'});
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed during review.');
          if(accepted)setMessage(`Complete ${usesPackedPoolInputs(candidate)?1:2} private-input signatures for this preview. The transaction request follows separately.`);
          return accepted;
        }});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed.');
      if(!prepared){setMessage('Private withdrawal preview cancelled.');return;}
      const sender=await getSender!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);setBlocked(true);setExitPreview(null);
      const sent=await sender.submitPoolPositionAction(prepared);
      setPending({recover:sent.recover,scope:captured});setTransactionHash(sent.transactionHash);
      setMessage('Private withdrawal preview submitted. Check its result before reviewing withdrawal.');
    }catch(error){fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  const action=async(action:CurrentPoolOwnerAction)=>{
    if(!connected||inFlight.current||busy||blocked||savedActionPending||!current||!snapshot||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current,before=snapshot.value;inFlight.current = true; setBusy(true);
    try{
      if(preparedCandidate){assertCurrentPoolPositionNativeAdmission(candidate,action,false,action==='withdraw'&&exitCandidate?'withdrawal':undefined);
        if(candidateKey!=='cheap-history')assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action,positionId:before.positionId,...(action==='transfer'?{recipient}:{})});
        if(action!=='close'&&!(exitCandidate&&['withdraw','transfer','activate','resume'].includes(action)))throw new Error('This prepared Pool action is awaiting integration.');}
      if(exitCandidate&&action==='withdraw'&&!validExitPreview)throw new Error('Check a private preview for this position and withdrawal percentage first.');
      const minimums=action==='close'||action==='withdraw'?(preparedCandidate&&before.poolTokens?
          [parseDexCandidateTokenAmount(candidate,before.poolTokens[0],minimum0,'Minimum payout'),parseDexCandidateTokenAmount(candidate,before.poolTokens[1],minimum1,'Minimum payout')]as const:
          [parseCurrentDexTokenAmount(minimum0,'Minimum payout'),parseCurrentDexTokenAmount(minimum1,'Minimum payout')]as const):undefined;
      const fraction=action==='withdraw'?currentPoolWithdrawalFraction(percentage):undefined;
      const capability=preparedCandidate?await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key}):await getPositions!(BigInt(candidate.chainId));assertScope(captured);
      const prepared=await capability.prepareAction({positionId:before.positionId,expectedContext:before.context,action,fraction,minimums,
        ...(action==='transfer'?{recipient}:{}),
        ...(preparedCandidate&&producerHash.trim()?{producerHash:producerHash.trim()}:{}),
        confirm:async review=>{
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position action inputs changed. Review them again.');
          const accepted=await requestConfirmation({title:action==='transfer'?'Transfer liquidity NFT':action==='close'?'Close liquidity claim':
            action==='withdraw'?'Withdraw liquidity':action==='activate'?'Activate claim privacy':'Resume liquidity claim',primaryLabel:'Continue',fundingMoves:[],
            summaryRows:[{label:'Position NFT',value:before.positionId.toString()},{label:'Action',value:action},
              ...(review.recipient?[{label:'Recipient',value:review.recipient}]:[]),
              ...(review.fraction?[{label:'Share fraction',value:`${review.fraction[0]}/${review.fraction[1]}`}]:[]),
              ...(review.minimums?[{label:`${labels[0]} minimum payout`,value:format(review.minimums[0],0)},{label:`${labels[1]} minimum payout`,value:format(review.minimums[1],1)}]:[]),
              ...(exitCandidate&&action==='withdraw'?[{label:'Private-input signatures for withdrawal',value:'2; the previewed fraction is reused'},
                {label:'Withdrawal and remaining-share snapshot',value:'2 transactions; network fees apply'}]:[])],
            stats:[],message:action==='transfer'?'The recipient receives this claim, not a token payout. The recipient must activate privacy.':
              action==='close'?`Close returns only this claim and burns its NFT. Both minimum payouts apply.${preparedCandidate?' A separate paid snapshot verifies the final private claim.':''}`:
                exitCandidate&&action==='withdraw'?'Withdraw the exact previewed share fraction. Both minimum payouts apply. A separate paid snapshot verifies remaining shares.':'This is one owner transaction. Network gas can apply.'});
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position action inputs changed during review.');return accepted;
        }});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position action inputs changed.');
      if(!prepared){setMessage('Position action cancelled.');return;}
      const sender:Sender=await getSender!(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:undefined);assertScope(captured);setBlocked(true);
      const sent=await sender.submitPoolPositionAction(prepared);
      assertScope(captured);
      setPending({recover:sent.recover,scope:captured});setTransactionHash(sent.transactionHash);setMessage('Position action submitted. Check its authenticated result before another action.');
      if(action==='close'&&preparedCandidate){
        setMessage('Close submitted. Checking confirmation.');
        const mined=await sender.waitForCurrentCheapReceipt(sent.transactionHash);assertScope(captured);
        if(!mined){setMessage('Close confirmation is pending. Check position status.');return;}
        const metadata=await capability.readPosition(before.positionId,{metadataOnly:true});assertScope(captured);
        if(metadata.status===4n){
          setSnapshot({value:metadata,scope:captured});setOwnedRefresh(sent.transactionHash);setProducerHash('');
        }
        const result=await sent.recover();assertScope(captured);
        if(!acceptPrivateResult(result,captured))setMessage('Check position status to finish verifying the transaction.');
      }
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const acceptPrivateResult=(result:PositionResult|null,captured:object)=>{
    if(!result)return false;
    assertScope(captured);setPending(null);setBlocked(false);
    if('snapshot' in result&&result.snapshot)setSnapshot({value:result.snapshot,scope:captured,closePayoutVerified:'status' in result&&result.status==='closed-proof-verified'});else setSnapshot(null);
    setId(result.positionId.toString());
    if(result.action==='close')setOwnedRefresh(result.transactionHash);
    if('status' in result&&result.status==='exit-preview-verified'){
      setExitPreview({scope:captured,value:result});
      setMessage('Private withdrawal preview verified. Review both payouts and minimums before withdrawal. No tokens have moved.');return true;
    }
    setExitPreview(null);
    if(result.action==='transfer'||result.action==='activate'||result.action==='resume'){
      setOwnedRefresh(result.transactionHash);setProducerHash(result.action==='transfer'?'':result.transactionHash);
      setMessage(result.action==='transfer'?'Position transferred. The recipient must activate privacy, then resume.':
        result.action==='activate'?'Privacy activated. Resume to make this position active.':'Position resumed.');return true;
    }
    if(result.action==='snapshot'){
      setProducerHash(result.producerHash);
      if(readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope))?.verificationBlocked){
        setMessage('Fresh private claim verified. The old verification hold remains; spending actions stay locked.');return true;
      }
      setMessage(result.status==='closed-proof-verified'?'Close complete: exact private payouts and zero remaining shares verified.':
        result.status==='closed-snapshot-verified'?'Closed owner snapshot verified. This session has no independent verification of the original payout.':
        exitCandidate&&'privateAccountingVerified' in result&&result.privateAccountingVerified?'Withdrawal complete: exact private payouts and remaining shares verified.':
        preparedCandidate?'Fresh private claim verified. Review Close to exit this position.':
          'Fresh private claim verified. Full exit uses these exact amounts as minimum payouts.');return true;
    }
    if('status' in result&&result.status==='remaining-proof-required'){
      setProducerHash('');setMessage('Withdrawal mined and payouts checked. Review the paid remaining-share snapshot to finish verification.');return true;
    }
    if('status' in result&&result.status==='closed-proof-required'){
      setProducerHash('');setMessage('Close mined and payouts checked. Review the paid closed-claim snapshot to verify zero remaining shares and finish this attempt.');return true;
    }
    setMessage('payouts' in result&&result.payouts?.length?`Private payouts verified: ${CURRENT_DEX_POOL_LABELS[0]} ${formatCurrentDexTokenAmount(result.payouts[0])}; ${CURRENT_DEX_POOL_LABELS[1]} ${formatCurrentDexTokenAmount(result.payouts[1])}.`:
        `Position ${result.action} verified. Refresh before another action.`);return true;
  };
  const reviewFailedPreview=async()=>{
    if(!reviewablePreview||!privacyReady||!connected||!getSender||inFlight.current||busy)return;
    const captured=scope.current;
    inFlight.current=true;setBusy(true);setMessage('');
    try{
      const sender=await getSender(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
      const released=await sender.releaseReviewedPoolPreview(async()=>{
        assertScope(captured);
        const confirmed=await requestConfirmation({
          title:'Release the unsent Pool preview',primaryLabel:'Release saved preview',fundingMoves:[],stats:[],
          summaryRows:[{label:'Wallet nonce',value:String(savedFunding!.nonce)}],
          message:'Continue only if your wallet shows Failed or Rejected with no transaction hash. The App checks the wallet nonce again and preserves the original record. A preview moves no tokens. Release sends no transaction. A late wallet broadcast is still possible until this nonce is used.'
        });
        assertScope(captured);
        return confirmed;
      });
      assertScope(captured);
      if(released){
        setBlocked(hasCurrentDexPendingAction(recordScope));setTopUpManagement(null);
        setMessage('Failed preview released. The original record is preserved. No transaction was sent.');
      }
    }catch(error){fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  // CW-140.02: the snapshot verifier and the top-up confirmation are shared by the saved-action check and the review list.
  const snapshotVerifier=(captured:object)=>privacyReady&&getPositions&&usesTransactionScopedPoolSnapshots(candidate)?
    async(positionId:bigint,hash:string)=>{assertScope(captured);setTransactionHash(hash);
      const capability=await getPositions(BigInt(candidate.chainId),{candidate:candidateKey});assertScope(captured);
      const latestHash=current&&snapshot.value.positionId===positionId?producerHash.trim():'';
      const result=latestHash&&latestHash.toLowerCase()!==hash.toLowerCase()
        ?await capability.verifySupersededPlainSnapshot(positionId,hash,latestHash):await capability.verifyPlainSnapshot(positionId,hash);
      assertScope(captured);return result;}:undefined;
  const topUpReview=(captured:object)=>async(facts:{positionId:bigint;fundingHash:string;snapshotHash:string;shares:bigint;totalShares:bigint})=>{
    assertScope(captured);
    const confirmed=await requestConfirmation({
      title:'Confirm your top-up',primaryLabel:'Confirm and unlock',fundingMoves:[],stats:[],
      summaryRows:[{label:'Position',value:`#${facts.positionId}`},{label:'Your shares now',value:facts.shares.toString()},
        {label:'Pool total shares',value:facts.totalShares.toString()},{label:'Top-up transaction',value:facts.fundingHash},
        {label:'Snapshot transaction',value:facts.snapshotHash}],
      message:'Both transactions are mined. Your shares were read with your key. Confirm if they look right. This sends no transaction.'
    });
    assertScope(captured);
    return confirmed;
  };
  // CW-140.09: a mined top-up leaves the review list after a receipt check; no dialog, no old-state read.
  const releaseReview=async(txHash:string)=>{
    if(!getSender||inFlight.current||busy||topUpOpen||context.chain!==Number(candidate.chainId))return;
    const captured=scope.current;inFlight.current=true;setBusy(true);
    try{
      const sender=await getSender(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
      await sender.releasePositionReview(txHash);assertScope(captured);
      setBlocked(hasCurrentDexPendingAction(recordScope));setMessage('');
    }catch(error){fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  const refresh=async()=>{
    if(!getSender||inFlight.current||busy||topUpOpen||context.chain!==Number(candidate.chainId))return;inFlight.current = true; setBusy(true);const captured=scope.current;
    try{
      const saved=readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      if(preparedCandidate&&(saved?.phase==='pool-preview'||saved?.phase==='pool-fund')){
        setMessage('Check the saved liquidity attempt in the form where you started it.');return;
      }
      if(saved?.txHash)setTransactionHash(saved.txHash);
      const snapshotHeld=saved?.phase==='pool-snapshot'&&saved.verificationBlocked===true&&currentDexPendingStorage(recordScope)?.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY)===null;
      const ownerHeld=saved?.phase==='pool-owner'&&saved.verificationBlocked===true;
      if(!snapshotHeld&&!ownerHeld&&pending&&pending.scope===scope.current){
        const result=await pending.recover();
        if(!result)throw new Error('Private position result is not available yet.');
        acceptPrivateResult(result,pending.scope);return;
      }
      const sender=await getSender(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:undefined);assertScope(captured);
      if(!snapshotHeld&&!ownerHeld&&preparedCandidate){const result=await sender.recoverCurrentPreparedPoolPositionResult();assertScope(captured);if(acceptPrivateResult(result,captured))return;}
      const verifySnapshot=snapshotVerifier(captured),reviewTopUpHold=topUpReview(captured);
      const observed=await sender.recoverPendingPoolPositionAttempt(verifySnapshot,reviewTopUpHold);assertScope(captured);
      if(observed?.status==='released-unsent'){setPending(null);setBlocked(hasCurrentDexPendingAction(recordScope));setMessage(CURRENT_UNSENT_RELEASED_MESSAGE);return;}
      // CW-140.02: the mined top-up moved to its position's review list; the rest of the DEX is free again.
      if(observed?.status==='moved-to-position-review'){
        setTransactionHash(observed.transactionHash);setPending(null);setBlocked(hasCurrentDexPendingAction(recordScope));setId(observed.positionId.toString());
        setMessage(`Your top-up went through. Swaps and other positions are unlocked. Position #${observed.positionId} waits for your review.`);return;
      }
      if(observed?.status==='superseded-snapshot-recovery-only'){
        setTransactionHash(observed.transactionHash);setPending(null);setSnapshot(null);setExitPreview(null);setProducerHash(observed.latestSnapshotHash);
        const held=hasCurrentDexPendingAction(recordScope);setBlocked(held);
        setMessage(held?'Saved snapshot verified for recovery only. Another saved hold remains. No prior amounts or accounting were reconstructed.':
          'Saved snapshot hold cleared with the later verified snapshot. No prior amounts or accounting were reconstructed. Load the position before another action.');return;
      }
      if(observed&&'action'in observed){if(acceptPrivateResult(observed,captured))return;}
      if(!observed){setBlocked(false);setMessage('No pending position attempt was found.');return;}
      if('transactionHash' in observed&&observed.transactionHash)setTransactionHash(observed.transactionHash);
      if(observed.status==='manual-reconciliation-required'&&'verificationBlocked' in observed&&observed.verificationBlocked){
        setBlocked(true);setMessage(`Private accounting needs manual reconciliation before a new deposit. ${currentPoolVerificationMessage(saved?.verificationFailure)}`);return;
      }
      if('closedPositionId' in observed&&observed.closedPositionId!==undefined&&getPositions&&preparedScope){
        const positionId=observed.closedPositionId;
        const held=observed.status==='observed-mined-verification-held';
        setId(positionId.toString());setOwnedRefresh(observed.transactionHash);setPending(null);setBlocked(held);setProducerHash('');setSnapshot(null);
        const capability=await getPositions(BigInt(candidate.chainId),{candidate:preparedScope.key});assertScope(captured);
        const closed=await capability.readPosition(positionId,{metadataOnly:true});assertScope(captured);
        if(closed.status!==4n)throw new Error('Close receipt and current position status differ.');
        setSnapshot({value:closed,scope:captured});
        setMessage(held?'Position closed. An earlier verification failure still needs reconciliation.':'Position closed. The original private payout has not been independently verified in this session.');
        return;
      }
      if(observed.status==='observed-mined-verification-held'||observed.status==='observed-reverted-verification-held'){
        setBlocked(true);
        if(observed.independentRefresh){setMessage('The new refresh needs private verification. Both saved records remain. Do not resend or request another refresh.');return;}
setMessage(`Position transaction ${observed.status==='observed-mined-verification-held'?'mined':'reverted'}, but verification remains on hold. ${observed.poolTopUpHash&&!observed.verificationFailure?'Final top-up accounting has not completed.':currentPoolVerificationMessage(observed.verificationFailure)} Keep the saved record. Do not resend.`);return;
      }
      if(observed.status==='observed-mined'||observed.status==='observed-reverted'){
        setBlocked(false);setPending(null);setSnapshot(null);setMessage(observed.status==='observed-reverted'?'Position transaction reverted. Refresh before another action.':
          'Position transaction mined. No private payout is confirmed in this session. Refresh the owner claim.');
      }else{setBlocked(true);setMessage('Position transaction is pending or needs a status check. Do not resend.');}
    }catch(error){setBlocked(true);fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  // CW-140.02: a held top-up is checked once by itself when privacy is unlocked. The check is read-only; it opens the
  // existing release confirmation when the mined state allows it. It never signs, sends or releases on its own.
  // The saved-action check needs no privacy: without it, a mined top-up moves to its position's review list.
  const autoChecked=useRef('');
  const autoCheckKey=heldTopUp&&connected&&!topUpOpen&&context.chain===Number(candidate.chainId)?
    `${context.owner}:${candidateKey}:${privacyReady?'private':'public'}`:'';
  useEffect(()=>{
    if(!autoCheckKey||autoChecked.current===autoCheckKey||busy||inFlight.current)return;
    autoChecked.current=autoCheckKey;void refresh();
  // refresh reads the current render's scope; the key alone decides when the single check runs.
  },[autoCheckKey,busy]);
  // A reviewable position opens its share confirmation once, after privacy is unlocked.
  const autoReviewed=useRef('');
  const nextReview=positionReviews.find(row=>row.reviewable);
  const autoReviewKey=nextReview&&connected&&!topUpOpen&&!heldTopUp&&context.chain===Number(candidate.chainId)?
    `${context.owner}:${nextReview.txHash}`:'';
  useEffect(()=>{
    if(!autoReviewKey||autoReviewed.current===autoReviewKey||busy||inFlight.current)return;
    autoReviewed.current=autoReviewKey;void releaseReview(nextReview!.txHash);
  },[autoReviewKey,busy]);
  const value=current?snapshot?.value:null;
  const validExitPreview=exitPreview?.scope===scope.current&&value?.positionId===exitPreview.value.positionId&&
    value.context===exitPreview.value.snapshot.context&&(()=>{try{const fraction=currentPoolWithdrawalFraction(percentage);
      return fraction[0]===exitPreview.value.preview.numerator&&fraction[1]===exitPreview.value.preview.denominator;}catch{return false;}})();
  const tokens=preparedCandidate&&value&&'poolTokens'in value?value.poolTokens as readonly string[]:null;
  const labels=tokens?tokens.map(token=>readCurrentDexDisplay(candidate).tokens.find(item=>item.address===token)?.label??'Unknown token'):CURRENT_DEX_POOL_LABELS;
  const format=(amount:bigint,index:number)=>tokens?formatDexCandidateTokenAmount(candidate,tokens[index],amount):formatCurrentDexTokenAmount(amount);
  const token0=tokens&&readCurrentDexDisplay(candidate).tokens.find(item=>item.address===tokens[0]);
  const token1=tokens&&readCurrentDexDisplay(candidate).tokens.find(item=>item.address===tokens[1]);
  const baseLabel=selectedPair&&selectedPair.every(label=>labels.includes(label))?selectedPair[priceDisplayInverted?1:0]:labels[priceDisplayInverted?1:0];
  const baseIndex=labels.indexOf(baseLabel)===1?1:0;
  const rate=value?.amounts&&tokens&&token0&&token1&&value.status!==4n&&value.amounts.shares>0n&&value.amounts.amount0>0n&&value.amounts.amount1>0n?
    formatCurrentDexAveragePrice({baseAmount:(baseIndex===0?value.amounts.amount0:value.amounts.amount1)*10n**BigInt(baseIndex===0?token1.decimals:token0.decimals),
      quoteAmount:(baseIndex===0?value.amounts.amount1:value.amounts.amount0)*10n**BigInt(baseIndex===0?token0.decimals:token1.decimals),baseToken:labels[baseIndex],quoteToken:labels[1-baseIndex]}):null;
  return <section className="dex-v2-test-form dex-v2-current-pool-positions dex-owner-workspace" aria-busy={busy} aria-label="Current liquidity NFT positions">
    <div className="dex-owner-split"><section className="dex-owner-index" aria-label="Position list">
    {!managementNavigation?<header className="dex-owner-heading"><h2>Your positions</h2><p>Select a position to view and manage it.</p></header>:null}
    {!connected&&!ownedDiscovery?<p>Connect the owner wallet on COTI Testnet to see your positions.</p>:null}
    {ownedDiscovery?<CurrentOwnedPoolPositions managementNavigation={managementNavigation} session={sharedWalletSession} candidateKey={candidateKey} visible={visible} refreshToken={ownedRefresh} selectedId={id} disabled={busy||topUpOpen}
      onSelect={positionId=>{setId(positionId.toString());setProducerHash('');setSnapshot(null);setExitPreview(null);void read(positionId);}}/>:null}
    <details className="dex-owner-footer" open={!ownedDiscovery}><summary>Find a position by ID</summary><label>Position NFT ID<input aria-label="Liquidity NFT ID" inputMode="numeric" value={id} disabled={busy||topUpOpen} onChange={event=>setId(event.target.value)}/></label>
      {signedSnapshot?<label>Verified funding or snapshot transaction (optional)<input aria-label="Liquidity snapshot transaction" value={producerHash} disabled={busy||topUpOpen} onChange={event=>setProducerHash(event.target.value)}/></label>:null}
      <button type="button" disabled={!connected||busy||topUpOpen} onClick={()=>{void read();}}>Load private position</button></details>
    </section><section className="dex-owner-detail" aria-label="Position details">
    <header className="dex-owner-heading"><h2>{current?`Position #${id}`:'Position details'}</h2></header>
    {selectedReview&&!selectedReview.reviewable&&!topUpOpen?<p className="dex-owner-progress dex-needs-attention" role="status">
      <strong>This position needs manual reconciliation.</strong> {currentPoolVerificationMessage(selectedReview.verificationFailure)}</p>:null}
    {heldTopUp&&!heldTopUp.reviewable&&!topUpOpen?<p className="dex-owner-progress dex-needs-attention" role="status">
      <strong>Your top-up went through, but one check needs manual reconciliation.</strong> {currentPoolVerificationMessage(heldTopUp.failure)}</p>:null}
    {reviewablePreview?<div className="dex-owner-progress">
      <p>{privacyReady?'If your wallet shows this request as Failed or Rejected with no transaction hash, you can review and release the saved Pool preview.':'Unlock privacy to review the saved Pool preview.'}</p>
      <button type="button" disabled={!connected||!privacyReady||busy} onClick={()=>{void reviewFailedPreview();}}>Review unsent preview</button>
    </div>:null}
    {poolFundingPending&&!topUpOpen?<p className="dex-owner-progress" role="note">A saved liquidity attempt needs a status check. For a top-up, select its position and open Add liquidity. For a new position, return to the pool creation form.</p>:
      (blocked||savedActionPending)&&!topUpOpen?<p role="note">{value?.status===4n?'Position closed. Use Check position status to reconcile the outstanding transaction before another verification request.':independentRefresh?'The old verification hold remains. You may review a new paid private refresh; spending actions stay locked. The old transaction will not be resent.':'A transaction is pending or needs verification. Actions remain locked. Do not resend.'}</p>:null}
    {!id?<p className="dex-owner-selection-empty">Select a position to see its details.</p>:null}
    {signedSnapshot&&(!ownedDiscovery||id)?<>{!ownedDiscovery?<p>{preparedCandidate?'Use an owned claim NFT and its confirmed funding or snapshot transaction. Private reads require its current owner proof.':'Use the new NFT ID from Add liquidity. Only that admitted claim can refresh or exit in this trial.'}</p>:null}
      <button type="button" disabled={!connected||busy||(blocked||savedActionPending)&&!independentRefresh||topUpOpen||!id||(current&&(snapshot?.value.status===3n||snapshot?.value.status===4n&&!!snapshot.value.amounts))} onClick={()=>{void produceSnapshot();}}>
        {current&&snapshot?.value.status===4n?'Review closed-claim verification':exitCandidate&&current&&snapshot?.value.status===1n&&!snapshot.value.amounts?'Review private amount verification':'Refresh this position'}</button></>:null}
    {value?<aside className="dex-v2-strategy-preview dex-owner-summary" aria-label="Owner private liquidity claim">
      {topUpOpen&&value.amounts?<p>Amounts from the last verified snapshot</p>:null}
      <dl>{tokens?<div><dt>Token pair</dt><dd>{labels[0]} / {labels[1]}</dd></div>:null}
        <div><dt>Status</dt><dd>{['None','Active','Paused','Awaiting privacy activation','Closed'][Number(value.status)]}</dd></div>
        {value.status===4n?<div><dt>Private verification</dt><dd>{!value.amounts?'Closed-claim snapshot pending':snapshot?.closePayoutVerified?'Payout and zero remaining shares verified':'Closed snapshot verified. Original payout not independently verified in this session.'}</dd></div>:null}
        {value.amounts?<><div><dt>Pool spread</dt><dd>{CURRENT_POOL_SPREADS[Number(value.amounts.classId)]}%</dd></div>
          <div><dt>Private shares</dt><dd>{value.amounts.shares.toString()}</dd></div>
          <div><dt>{labels[0]} {value.status===4n?'paid out':'entitlement'}</dt><dd>{format(value.amounts.amount0,0)}</dd></div><div><dt>{labels[1]} {value.status===4n?'paid out':'entitlement'}</dt><dd>{format(value.amounts.amount1,1)}</dd></div>
          {rate!==null?<div><dt>Approximate Pool rate (snapshot)</dt><dd>{rate}</dd></div>:null}
          </>:null}</dl>{rate!==null?<p>Derived from your private entitlements at the last verified snapshot. Integer rounding can affect this rate. It excludes spread, fees and price impact and is not a live quote.</p>:null}{!value.amounts?<p>{pending?.scope===scope.current&&pending.snapshot?'The submitted snapshot is pending verification. Do not request another.':value.status===4n?'Private verification is pending. A separate paid snapshot checks the closed claim and zero remaining shares. It does not withdraw funds again.':value.status===3n?'Activate claim privacy to continue.':'Private amounts are unavailable. Review a paid private refresh to verify them.'}</p>:null}</aside>:null}
    {value&&preparedCandidate&&!exitCandidate?<p>{
      'Partial withdrawal and transfer integration is incomplete.'} Close and top-up require exact accounting checks and a separate paid snapshot.</p>:null}
    {value&&preparedCandidate&&value.status===1n&&value.amounts&&producerHash&&value.poolTokens&&sharedWalletSession?<details className="dex-owner-action" name="pool-owner-actions" open={topUpOpen||undefined}><summary>Add liquidity</summary><CurrentPreparedPoolTopUpWorkspace
      session={sharedWalletSession} candidateKey={preparedScope!.key} position={{positionId:value.positionId,context:value.context,producerHash,poolTokens:value.poolTokens,block:value.block}}
      disabled={busy||blocked||!!selectedReview||savedActionPending&&!topUpOpen}
      onBegin={()=>setTopUpManagement({scope:scope.current,id,managed:false})}
      onReleased={()=>setTopUpManagement(null)}
      onManaged={()=>setTopUpManagement({scope:scope.current,id,managed:true})}
      onVerified={async hash=>{const captured=scope.current;
        const cap=await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
        const fresh=await cap.readPosition(value.positionId,{producerHash:hash});assertScope(captured);
        setProducerHash(hash);setSnapshot({value:fresh,scope:captured});setTopUpManagement(null);
        setMessage('Top-up complete. Exact private debits and fresh position shares verified.');}}/></details>:null}
    {topUpOpen&&!savedActionPending?<p>{topUpManagement?.managed?'Top-up debits are checked. Use its verification snapshot before another position action.':
      'Top-up is in progress. Complete it, or stop and clear its approvals before another position action.'}</p>:null}
    {value ? <fieldset className="dex-v2-panel-fields dex-owner-actions" disabled={busy||blocked||savedActionPending||topUpOpen||!!selectedReview}><details className="dex-owner-action" name="pool-owner-actions"><summary>Withdraw liquidity</summary><div className="dex-v2-panel-fields">
    <>{!preparedCandidate||exitCandidate?<label>Withdrawal (%)<input aria-label="Liquidity withdrawal percentage" inputMode="decimal" value={percentage} disabled={busy||blocked} onChange={event=>setPercentage(event.target.value)}/></label>:null}
    <details className="dex-v2-setup"><summary>Minimum payouts</summary><div>
      <label>{labels[0]}<input aria-label={preparedCandidate?`${labels[0]} minimum payout`:'Test token 1 minimum payout'} inputMode="decimal" value={minimum0} disabled={busy||blocked} onChange={event=>setMinimum0(event.target.value)}/></label>
      <label>{labels[1]}<input aria-label={preparedCandidate?`${labels[1]} minimum payout`:'Test token 0 minimum payout'} inputMode="decimal" value={minimum1} disabled={busy||blocked} onChange={event=>setMinimum1(event.target.value)}/></label>
    </div></details>
    <p>Minimum payouts protect both tokens. A 100% withdrawal uses Close. Changing spread requires Close and a new deposit.</p>
    {exitCandidate?<><button type="button" disabled={!connected||busy||blocked||value.status!==1n||!value.amounts||value.amounts.shares===0n} onClick={()=>{void restoreWithdrawal();}}>Restore completed withdrawal preview</button>
      <p>Restore checks the latest completed preview for the selected percentage. It needs no signature or transaction.</p>
      <button type="button" disabled={!connected||busy||blocked||value.status!==1n||!value.amounts||value.amounts.shares===0n} onClick={()=>{void previewWithdrawal();}}>Review private withdrawal preview</button>
      {validExitPreview&&exitPreview?<aside aria-label="Private withdrawal preview"><dl>
        <div><dt>{labels[0]} payout</dt><dd>{format(exitPreview.value.preview.amount0,0)}</dd></div>
        <div><dt>{labels[1]} payout</dt><dd>{format(exitPreview.value.preview.amount1,1)}</dd></div>
        <div><dt>Remaining private shares</dt><dd>{exitPreview.value.preview.remainingShares.toString()}</dd></div>
      </dl></aside>:null}
      <button type="button" disabled={!connected||busy||blocked||!validExitPreview||value.status!==1n||!value.amounts} onClick={()=>{void action('withdraw');}}>Withdraw previewed shares</button></>:null}
    {!preparedCandidate?<button type="button" disabled={!connected||busy||blocked||value?.status!==1n||!value.amounts||value.amounts.shares===0n} onClick={()=>{void action('withdraw');}}>Withdraw selected shares</button>:null}</>
    </div></details><details className="dex-owner-action dex-owner-danger" name="pool-owner-actions"><summary>Close position</summary><div className="dex-v2-panel-fields"><p>Withdraw all remaining liquidity and close this position.</p><button type="button" disabled={!connected||busy||blocked||!value||!value.amounts||value.status===4n} onClick={()=>{void action('close');}}>Close and withdraw all</button></div></details>
    {(!preparedCandidate||exitCandidate)?<><details className="dex-v2-setup dex-owner-action" name="pool-owner-actions"><summary>Transfer position</summary><div>
    <p>The recipient must be an EOA wallet and must activate claim privacy, then resume liquidity.</p>
    <label>NFT recipient<input aria-label="Liquidity NFT recipient" value={recipient} disabled={busy||blocked} onChange={event=>setRecipient(event.target.value)}/></label>
    <button type="button" disabled={!connected||busy||blocked||!value||value.status===4n||(!value.amounts&&value.status!==3n)} onClick={()=>{void action('transfer');}}>Transfer liquidity NFT</button>
    </div></details>
    {value?.status===3n?<button type="button" disabled={!connected||busy||blocked} onClick={()=>{void action('activate');}}>Activate claim privacy</button>:null}
    {value?.status===2n?<button type="button" disabled={!connected||busy||blocked} onClick={()=>{void action('resume');}}>Resume liquidity claim</button>:null}</>:
      <p>Partial withdrawal, NFT transfer and activation are not available yet.</p>}
    </fieldset> : null}
    {busy?<p role="status" className="dex-owner-progress">{pending?'Checking the submitted position transaction and private result. No new request is being sent.':'Checking your position…'}</p>:null}
    {!busy?<p role="status" className="dex-owner-progress">{message&&messageScope.current===scope.current?(/another owner or adapter/.test(message)?'Another DEX action needs a status check. Open History for its recovery.':message):''}</p>:null}
    {!topUpOpen&&!poolFundingPending?<details className="dex-owner-footer" open={blocked||savedActionPending||!!pending||undefined}><summary>Status and recovery</summary>
    {connected ? <button type="button" disabled={!getSender||busy||topUpOpen||context.chain!==Number(candidate.chainId)} onClick={()=>{void refresh();}}>Check position status</button> : null}
    {message&&messageScope.current===scope.current&&/another owner or adapter/.test(message)?<p>{message}</p>:null}
    {transactionHash?<p style={{overflowWrap:'anywhere'}}>Transaction {transactionHash}</p>:null}
    </details>:null}    </section></div>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={()=>resolveConfirmation(false)} onConfirm={()=>resolveConfirmation(true)}/>
  </section>;
}
