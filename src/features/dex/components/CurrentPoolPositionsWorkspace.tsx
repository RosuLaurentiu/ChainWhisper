import { useRef, useState } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, STAGED_NATIVE_DEX_CANDIDATE, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { CURRENT_NATIVE_POOL_PROFILE } from '../../../lib/currentDexNativePoolPolicy';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import type { issueCurrentDexPoolPositionCapability } from '../../wallet/currentDexPoolPositionCapability';
import type { CurrentPoolOwnerAction } from '../../../lib/currentDexPoolPosition';
import { assertCurrentPoolPositionNativeAdmission } from '../../../lib/currentDexPoolPositionSubmission';
import { assertCurrentAppPoolAuthority } from '../../../lib/currentDexC1SwapPolicy';
import { parseCurrentTrialAtoms, parseCurrentTrialPriceLimit, CURRENT_POOL_SPREADS } from './CurrentPoolWorkspace';
import { CURRENT_DEX_POOL_LABELS, formatCurrentDexTokenAmount, parseCurrentDexTokenAmount, hasCurrentDexPendingAction, readCurrentDexDisplay, formatDexCandidateTokenAmount, parseDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import './CurrentPoolPositionsWorkspace.css';
import CurrentPreparedPoolTopUpWorkspace from './CurrentPreparedPoolTopUpWorkspace';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';
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
export default function CurrentPoolPositionsWorkspace({sharedWalletSession,candidateKey='cheap-current',visible=true}:{sharedWalletSession?:SharedWalletSession;candidateKey?:CurrentCheapDexCandidateKey;visible?:boolean}){
  const preparedScope=candidateKey==='cheap-prepared'||candidateKey==='cheap-exit'||candidateKey==='cheap-history'?resolvePreparedDexScope(candidateKey):null;
  const candidate=preparedScope?.candidate??resolveCurrentCheapDexCandidate(candidateKey),nativeTrial=candidate.graph===STAGED_NATIVE_DEX_CANDIDATE.graph;
  const preparedCandidate=preparedScope!==null,signedSnapshot=nativeTrial||preparedCandidate;
  const exitCandidate=preparedScope?.key==='cheap-exit'||preparedScope?.key==='cheap-history';
  const ownedDiscovery=exitCandidate;
  const [id,setId]=useState(''),[percentage,setPercentage]=useState('50'),[minimum0,setMinimum0]=useState('0'),[minimum1,setMinimum1]=useState('0'),[recipient,setRecipient]=useState('');
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setStoredMessage]=useState('');
  const messageScope=useRef<object|null>(null);
  const [snapshot,setSnapshot]=useState<{value:Snapshot;scope:object}|null>(null);
  const [pending,setPending]=useState<{recover:()=>Promise<PositionResult>;scope:object}|null>(null);
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
  if((Object.keys(context)as(keyof typeof context)[]).some(key=>context[key]!==scope.current[key]))scope.current=context;
  const {confirmation,requestConfirmation,resolveConfirmation}=useTradeActionConfirmationState(scope.current);
  const setMessage=(text:string)=>{messageScope.current=scope.current;setStoredMessage(text);};
  const current=snapshot?.scope===scope.current&&snapshot.value.positionId.toString()===id;
  const connected=Boolean(context.owner&&context.chain===Number(candidate.chainId)&&getPositions&&getSender&&context.provider);
  const savedActionPending=hasCurrentDexPendingAction();
  const topUpOpen=topUpManagement?.scope===scope.current&&topUpManagement.id===id;
  const assertScope=(captured:object)=>{if(captured!==scope.current)throw new Error('Position owner or wallet session changed. Refresh this position.');};
  const actionTerms=useRef('');actionTerms.current=[id,percentage,minimum0,minimum1,recipient,producerHash].join(':');
  const fail=(error:unknown,captured:object)=>setMessage(captured!==scope.current
    ?'Position owner or wallet session changed. Refresh this position.'
    :error instanceof Error?error.message:'Position action failed. Check its status before another request.');
  const read=async(selectedId?:bigint)=>{
    if(!connected||inFlight.current||busy||blocked||topUpOpen)return;inFlight.current = true; setBusy(true);setSnapshot(null);const captured=scope.current;
    try{
      const capability=preparedCandidate?await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key}):await getPositions!(BigInt(candidate.chainId));assertScope(captured);
      const value=await capability.readPosition(selectedId??parseCurrentTrialAtoms(id,true),selectedId?undefined:
        signedSnapshot&&producerHash.trim()?{producerHash:producerHash.trim()}:undefined);assertScope(captured);
      if('producerHash'in value&&typeof value.producerHash==='string')setProducerHash(value.producerHash);
      setSnapshot({value,scope:captured});setMessage(value.status===3n?'Activate privacy to manage this received position.':
        value.amounts?'Owner private claim verified at the canonical block.':'Refresh private state to see your amounts.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const produceSnapshot=async()=>{
    if(!signedSnapshot||!connected||inFlight.current||busy||blocked||savedActionPending||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current;inFlight.current = true; setBusy(true);
    try{
      if(preparedCandidate){assertCurrentPoolPositionNativeAdmission(candidate,'snapshot',snapshot?.value.status===4n);
        assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action:'snapshot',positionId:parseCurrentTrialAtoms(id,true)});}
      const capability=preparedCandidate?await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key}):await getPositions!(BigInt(candidate.chainId));assertScope(captured);
      const prepared=await capability.prepareSnapshot({positionId:parseCurrentTrialAtoms(id,true),confirm:async review=>{
        assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed. Review them again.');
        const accepted=await requestConfirmation({title:review.closed?'Verify closed liquidity claim':'Refresh private liquidity claim',primaryLabel:'Continue',fundingMoves:[],
          summaryRows:[{label:'Position NFT',value:review.positionId.toString()},{label:'Maximum network fee',value:`${formatCurrentDexTokenAmount(review.gasCap*50_000_000n)} Test COTI`}],
          stats:[],message:review.closed?'This paid snapshot verifies the exact payouts and zero remaining shares. It does not close or pay the claim again.':
            'This paid snapshot updates your private claim. It does not move token funds.'});
        assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed during review.');return accepted;
      }});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed.');
      if(!prepared){setMessage('Private snapshot cancelled.');return;}
      const sender=await getSender!(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:{nativePoolProfile:CURRENT_NATIVE_POOL_PROFILE});assertScope(captured);setBlocked(true);
      const sent=await sender.submitPoolPositionAction(prepared);
      setPending({recover:sent.recover,scope:captured});setTransactionHash(sent.transactionHash);
      setMessage('Private snapshot submitted. Check its authenticated result.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const previewWithdrawal=async()=>{
    if(!exitCandidate||!connected||inFlight.current||busy||blocked||savedActionPending||!current||!snapshot||topUpOpen)return;
    const captured=scope.current,terms=actionTerms.current,before=snapshot.value;inFlight.current=true;setBusy(true);
    try{
      assertCurrentPoolPositionNativeAdmission(candidate,'withdraw',false,'preview');
      assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action:'withdraw',positionId:before.positionId});
      const fraction=currentPoolWithdrawalFraction(percentage);
      const capability=await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
      const prepared=await capability.prepareExitPreview({positionId:before.positionId,expectedContext:before.context,fraction,
        ...(producerHash.trim()?{producerHash:producerHash.trim()}:{}),confirm:async review=>{
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed. Review them again.');
          const accepted=await requestConfirmation({title:'Preview partial liquidity withdrawal',primaryLabel:'Continue',fundingMoves:[],
            summaryRows:[{label:'Position NFT',value:before.positionId.toString()},
              {label:'Share fraction',value:`${review.fraction[0]}/${review.fraction[1]}`},
              {label:'Maximum network fee',value:`${formatCurrentDexTokenAmount(review.gasCap*50_000_000n)} Test COTI`}],stats:[],
            message:'This paid preview gives your private payouts and remaining shares. It does not withdraw tokens. Review withdrawal separately after checking its result.'});
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position inputs changed during review.');return accepted;
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
        assertCurrentAppPoolAuthority(candidate.graph,{owner:context.owner!,action,positionId:before.positionId,...(action==='transfer'?{recipient}:{})});
        if(action!=='close'&&!(exitCandidate&&['withdraw','transfer','activate','resume'].includes(action)))throw new Error('This prepared Pool action is awaiting integration.');}
      if(exitCandidate&&action==='withdraw'&&!validExitPreview)throw new Error('Check a private preview for this position and withdrawal percentage first.');
      if(nativeTrial&&action!=='close')throw new Error('Only full exit of the admitted new Testnet claim is available.');
      const minimums=nativeTrial&&action==='close'&&before.amounts?[before.amounts.amount0,before.amounts.amount1]as const:
        action==='close'||action==='withdraw'?(preparedCandidate&&before.poolTokens?
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
              ...(review.minimums?[{label:`${labels[0]} minimum payout`,value:format(review.minimums[0],0)},{label:`${labels[1]} minimum payout`,value:format(review.minimums[1],1)}]:[])],
            stats:[],message:action==='transfer'?'The recipient receives this claim, not a token payout. The recipient must activate privacy.':
              action==='close'?`Close returns only this claim and burns its NFT. Both minimum payouts apply.${preparedCandidate?' A separate paid snapshot verifies the final private claim.':''}`:
                exitCandidate&&action==='withdraw'?'Withdraw the exact previewed share fraction. Both minimum payouts apply. A separate paid snapshot verifies remaining shares.':'This is one owner transaction. Network gas can apply.'});
          assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position action inputs changed during review.');return accepted;
        }});
      assertScope(captured);if(actionTerms.current!==terms)throw new Error('Position action inputs changed.');
      if(!prepared){setMessage('Position action cancelled.');return;}
      const sender:Sender=await getSender!(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:nativeTrial?{nativePoolProfile:CURRENT_NATIVE_POOL_PROFILE}:undefined);assertScope(captured);setBlocked(true);
      const sent=await sender.submitPoolPositionAction(prepared);
      setPending({recover:sent.recover,scope:captured});setTransactionHash(sent.transactionHash);setMessage('Position action submitted. Check its authenticated result before another action.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const acceptPrivateResult=(result:PositionResult|null,captured:object)=>{
    if(!result)return false;
    assertScope(captured);setPending(null);setBlocked(false);
    if('snapshot' in result&&result.snapshot)setSnapshot({value:result.snapshot,scope:captured});else setSnapshot(null);
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
  const refresh=async()=>{
    if(!getSender||inFlight.current||busy||topUpOpen||context.chain!==Number(candidate.chainId))return;inFlight.current = true; setBusy(true);const captured=scope.current;
    try{
      if(pending&&pending.scope===scope.current){
        try{const result=await pending.recover();
          if(!result)throw new Error('Private position result is not available yet.');
          acceptPrivateResult(result,pending.scope);return;
        }catch{/* Canonical public recovery grants no private result or action authority. */}
      }
      const sender=await getSender(BigInt(candidate.chainId),preparedCandidate?{candidate:preparedScope!.key}:nativeTrial?{nativePoolProfile:CURRENT_NATIVE_POOL_PROFILE}:undefined);assertScope(captured);
      if(preparedCandidate){const result=await sender.recoverCurrentPreparedPoolPositionResult();assertScope(captured);if(acceptPrivateResult(result,captured))return;}
      if(nativeTrial){const result=await sender.recoverCurrentNativePoolPositionResult();assertScope(captured);if(acceptPrivateResult(result,captured))return;}
      const observed=await sender.recoverPendingPoolPositionAttempt();assertScope(captured);
      if(!observed){setBlocked(false);setMessage('No pending position attempt was found.');return;}
      if(observed.status==='observed-mined'||observed.status==='observed-reverted'){
        setBlocked(false);setPending(null);setSnapshot(null);setMessage(observed.status==='observed-reverted'?'Position transaction reverted. Refresh before another action.':
          'Position transaction mined. No private payout is confirmed in this session. Refresh the owner claim.');
      }else{setBlocked(true);setMessage('Position transaction is pending or needs manual reconciliation. Do not resend.');}
    }catch(error){setBlocked(true);fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const value=current?snapshot?.value:null;
  const validExitPreview=exitPreview?.scope===scope.current&&value?.positionId===exitPreview.value.positionId&&
    value.context===exitPreview.value.snapshot.context&&(()=>{try{const fraction=currentPoolWithdrawalFraction(percentage);
      return fraction[0]===exitPreview.value.preview.numerator&&fraction[1]===exitPreview.value.preview.denominator;}catch{return false;}})();
  const tokens=preparedCandidate&&value&&'poolTokens'in value?value.poolTokens as readonly string[]:null;
  const labels=tokens?tokens.map(token=>readCurrentDexDisplay(candidate).tokens.find(item=>item.address===token)?.label??'Unknown token'):CURRENT_DEX_POOL_LABELS;
  const format=(amount:bigint,index:number)=>tokens?formatDexCandidateTokenAmount(candidate,tokens[index],amount):formatCurrentDexTokenAmount(amount);
  return <section className="dex-v2-test-form dex-v2-current-pool-positions dex-owner-workspace" aria-busy={busy} aria-label="Current liquidity NFT positions">
    <header className="dex-owner-heading"><div><h2>Your positions</h2></div>{!ownedDiscovery?<p>Load a position by NFT ID.</p>:null}</header>
    {!connected&&!ownedDiscovery?<p>Connect the owner wallet on COTI Testnet to see your positions.</p>:null}
    {ownedDiscovery?<CurrentOwnedPoolPositions session={sharedWalletSession} candidateKey={candidateKey} visible={visible} refreshToken={ownedRefresh} selectedId={id} disabled={busy||blocked||topUpOpen||savedActionPending}
      onSelect={positionId=>{setId(positionId.toString());setProducerHash('');setSnapshot(null);setExitPreview(null);void read(positionId);}}/>:null}
    <details className="dex-owner-footer" open={!ownedDiscovery}><summary>Manual position lookup</summary><label>Position NFT ID<input aria-label="Liquidity NFT ID" inputMode="numeric" value={id} disabled={busy||blocked||topUpOpen} onChange={event=>setId(event.target.value)}/></label>
      {signedSnapshot?<label>Verified funding or snapshot transaction (optional)<input aria-label="Liquidity snapshot transaction" value={producerHash} disabled={busy||blocked||topUpOpen} onChange={event=>setProducerHash(event.target.value)}/></label>:null}
      <button type="button" disabled={!connected||busy||blocked||topUpOpen} onClick={()=>{void read();}}>Load private position</button></details>
    {signedSnapshot&&(!ownedDiscovery||id)?<>{!ownedDiscovery?<p>{preparedCandidate?'Use an owned claim NFT and its confirmed funding or snapshot transaction. Private reads require its current owner proof.':'Use the new NFT ID from Add liquidity. Only that admitted claim can refresh or exit in this trial.'}</p>:null}
      <button type="button" disabled={!connected||busy||blocked||savedActionPending||topUpOpen||!id||(current&&(snapshot?.value.status===3n||snapshot?.value.status===4n&&!!snapshot.value.amounts))} onClick={()=>{void produceSnapshot();}}>
        {current&&snapshot?.value.status===4n?'Review closed-claim verification':exitCandidate&&current&&snapshot?.value.status===1n&&!snapshot.value.amounts?'Review remaining-share verification':'Review paid private refresh'}</button></>:null}
    {value&&!topUpOpen?<aside className="dex-v2-strategy-preview dex-owner-summary" aria-label="Owner private liquidity claim"><header><h2>Position #{value.positionId.toString()}</h2></header>
      <dl><div><dt>Status</dt><dd>{['None','Active','Paused','Awaiting privacy activation','Closed'][Number(value.status)]}</dd></div>
        {value.amounts?<><div><dt>Pool spread</dt><dd>{CURRENT_POOL_SPREADS[Number(value.amounts.classId)]}%</dd></div>
          <div><dt>{labels[0]} {value.status===4n?'paid out':'entitlement'}</dt><dd>{format(value.amounts.amount0,0)}</dd></div><div><dt>{labels[1]} {value.status===4n?'paid out':'entitlement'}</dt><dd>{format(value.amounts.amount1,1)}</dd></div>
          </>:null}</dl>{value.amounts?<details className="dex-owner-footer"><summary>Position details</summary><p>Private shares: {value.amounts.shares.toString()}</p></details>:null}</aside>:null}
    {value&&preparedCandidate&&!exitCandidate?<p>{
      'Partial withdrawal and transfer integration is incomplete.'} Close and top-up require exact accounting checks and a separate paid snapshot.</p>:null}
    {value&&preparedCandidate&&value.status===1n&&value.amounts&&producerHash&&value.poolTokens&&sharedWalletSession?<details className="dex-owner-action" name="pool-owner-actions" open={topUpOpen||undefined}><summary>Add liquidity</summary><CurrentPreparedPoolTopUpWorkspace
      session={sharedWalletSession} candidateKey={preparedScope!.key} position={{positionId:value.positionId,context:value.context,producerHash,poolTokens:value.poolTokens,block:value.block}}
      disabled={busy||blocked||savedActionPending}
      onBegin={()=>setTopUpManagement({scope:scope.current,id,managed:false})}
      onReleased={()=>setTopUpManagement(null)}
      onManaged={()=>setTopUpManagement({scope:scope.current,id,managed:true})}
      onVerified={async hash=>{const captured=scope.current;
        const cap=await getPositions!(BigInt(candidate.chainId),{candidate:preparedScope!.key});assertScope(captured);
        const fresh=await cap.readPosition(value.positionId,{producerHash:hash});assertScope(captured);
        setProducerHash(hash);setSnapshot({value:fresh,scope:captured});setTopUpManagement(null);
        setMessage('Top-up complete. Exact private debits and fresh position shares verified.');}}/></details>:null}
    {topUpOpen?<p>{topUpManagement?.managed?'Top-up debits are checked. Use its verification snapshot before another position action.':
      'Top-up is in progress. Complete it, or stop and clear its approvals before another position action.'}</p>:null}
    {value ? <fieldset className="dex-v2-panel-fields dex-owner-actions" disabled={busy||blocked||savedActionPending||topUpOpen}><details className="dex-owner-action" name="pool-owner-actions"><summary>Withdraw liquidity</summary><div className="dex-v2-panel-fields">
    {!nativeTrial?<>{!preparedCandidate||exitCandidate?<label>Withdrawal (%)<input aria-label="Liquidity withdrawal percentage" inputMode="decimal" value={percentage} disabled={busy||blocked} onChange={event=>setPercentage(event.target.value)}/></label>:null}
    <details className="dex-v2-setup"><summary>Minimum payouts</summary><div>
      <label>{labels[0]}<input aria-label={preparedCandidate?`${labels[0]} minimum payout`:'Test token 1 minimum payout'} inputMode="decimal" value={minimum0} disabled={busy||blocked} onChange={event=>setMinimum0(event.target.value)}/></label>
      <label>{labels[1]}<input aria-label={preparedCandidate?`${labels[1]} minimum payout`:'Test token 0 minimum payout'} inputMode="decimal" value={minimum1} disabled={busy||blocked} onChange={event=>setMinimum1(event.target.value)}/></label>
    </div></details>
    <p>Minimum payouts protect both tokens. A 100% withdrawal uses Close. Changing spread requires Close and a new deposit.</p>
    {exitCandidate?<><button type="button" disabled={!connected||busy||blocked||value.status!==1n||!value.amounts||value.amounts.shares===0n} onClick={()=>{void previewWithdrawal();}}>Review private withdrawal preview</button>
      {validExitPreview&&exitPreview?<aside aria-label="Private withdrawal preview"><dl>
        <div><dt>{labels[0]} payout</dt><dd>{format(exitPreview.value.preview.amount0,0)}</dd></div>
        <div><dt>{labels[1]} payout</dt><dd>{format(exitPreview.value.preview.amount1,1)}</dd></div>
        <div><dt>Remaining private shares</dt><dd>{exitPreview.value.preview.remainingShares.toString()}</dd></div>
      </dl></aside>:null}
      <button type="button" disabled={!connected||busy||blocked||!validExitPreview||value.status!==1n||!value.amounts} onClick={()=>{void action('withdraw');}}>Withdraw previewed shares</button></>:null}
    {!preparedCandidate?<button type="button" disabled={!connected||busy||blocked||value?.status!==1n||!value.amounts||value.amounts.shares===0n} onClick={()=>{void action('withdraw');}}>Withdraw selected shares</button>:null}</>:
      <p>Refresh the private claim before exit. Its exact token entitlements are the minimum payouts. A changed Pool needs a new refresh.</p>}
    </div></details><details className="dex-owner-action dex-owner-danger" name="pool-owner-actions"><summary>Close position</summary><div className="dex-v2-panel-fields"><p>Withdraw all remaining liquidity and close this position.</p><button type="button" disabled={!connected||busy||blocked||!value||!value.amounts||value.status===4n||(nativeTrial&&value.producerKind!=='snapshot')} onClick={()=>{void action('close');}}>Close and withdraw all</button></div></details>
    {!nativeTrial&&(!preparedCandidate||exitCandidate)?<><details className="dex-v2-setup dex-owner-action" name="pool-owner-actions"><summary>Transfer position</summary><div>
    <p>The recipient must be an EOA wallet and must activate claim privacy, then resume liquidity.</p>
    <label>NFT recipient<input aria-label="Liquidity NFT recipient" value={recipient} disabled={busy||blocked} onChange={event=>setRecipient(event.target.value)}/></label>
    <button type="button" disabled={!connected||busy||blocked||!value||value.status===4n||(!value.amounts&&value.status!==3n)} onClick={()=>{void action('transfer');}}>Transfer liquidity NFT</button>
    </div></details>
    {value?.status===3n?<button type="button" disabled={!connected||busy||blocked} onClick={()=>{void action('activate');}}>Activate claim privacy</button>:null}
    {value?.status===2n?<button type="button" disabled={!connected||busy||blocked} onClick={()=>{void action('resume');}}>Resume liquidity claim</button>:null}</>:
      <p>Partial withdrawal, NFT transfer and activation are awaiting current-candidate validation.</p>}
    </fieldset> : null}
    {busy?<p role="status" className="dex-owner-progress">Checking your position… If MetaMask opens, complete its request there. Keep this attempt open.</p>:null}
    {!busy?<p role="status" className="dex-owner-progress">{message&&messageScope.current===scope.current?(/another owner or adapter/.test(message)?'Another DEX action needs a status check. Open History for its recovery.':message):''}</p>:null}
    <details className="dex-owner-footer" open={blocked||undefined}><summary>Status and recovery</summary>
    {connected ? <button type="button" disabled={!getSender||busy||topUpOpen||context.chain!==Number(candidate.chainId)} onClick={()=>{void refresh();}}>Check position status</button> : null}
    {message&&messageScope.current===scope.current&&/another owner or adapter/.test(message)?<p>{message}</p>:null}
    {transactionHash?<p style={{overflowWrap:'anywhere'}}>Transaction {transactionHash}</p>:null}
    </details><TradeActionConfirmModal confirmation={confirmation} onCancel={()=>resolveConfirmation(false)} onConfirm={()=>resolveConfirmation(true)}/>
  </section>;
}
