import { useRef,useState } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import type { CurrentLimitCreationResult,CurrentLimitOwnerResult,issueCurrentDexLimitCapability } from '../../wallet/currentDexLimitCapability';
import { currentLimitOwnerNativeAdmission,assertCurrentLimitNativeAdmission,type CurrentLimitOwnerAction } from '../../../lib/currentDexLimit';
import { assertCurrentAppLimitAuthority } from '../../../lib/currentDexC1SwapPolicy';
import { parseCurrentTrialAtoms,parseCurrentTrialPriceLimit,currentPoolFractionWitness } from './CurrentPoolWorkspace';
import { CURRENT_DEX_POOL_LABELS, formatCurrentDexTokenAmount, parseCurrentDexTokenAmount, hasCurrentDexPendingAction,
  readCurrentDexDisplay, currentDexDisplayPair, formatDexCandidateTokenAmount, parseDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { resolveCanonicalTradeActionSide, resolveDisplayedTradeActionSide } from '../../../lib/tradePerspective';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import './CurrentPoolPositionsWorkspace.css';
import CurrentOwnedLimits from './CurrentOwnedLimits';
import { currentDexPendingStorage,readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
export const currentLimitIntent=(sellToken0:boolean,amount:string,price:string,minimum:string)=>{
  const p=parseCurrentTrialPriceLimit(price),w=currentPoolFractionWitness(p.numerator,p.denominator),m=parseCurrentTrialAtoms(minimum);
  if(m>=1n<<128n)throw new Error('Maker minimum must fit uint128.');
  return{sellToken0,amount:parseCurrentTrialAtoms(amount,true),terms:[w[0],w[1],m,w[2],w[3]]as const};
};
export default function CurrentLimitWorkspace({sharedWalletSession,view='create',priceDisplayInverted=false,candidateKey='cheap-current',selectedPair}:{sharedWalletSession?:SharedWalletSession;view?:'create'|'manage';priceDisplayInverted?:boolean;candidateKey?:CurrentCheapDexCandidateKey;selectedPair?:readonly[string,string]}){
  const preparedScope=candidateKey==='cheap-prepared'||candidateKey==='cheap-exit'||candidateKey==='cheap-history'?resolvePreparedDexScope(candidateKey):null;
  const ownedDiscovery=candidateKey==='cheap-exit'||candidateKey==='cheap-history';
  const c=preparedScope?.candidate??resolveCurrentCheapDexCandidate(candidateKey),preparedCandidate=preparedScope!==null;
  const display=preparedCandidate?readCurrentDexDisplay(c):null;
  const selectedTokens=display&&selectedPair?.map(label=>display.tokens.find(token=>token.label===label));
  const pair=preparedCandidate?(()=>{
    if(!selectedTokens||selectedTokens.length!==2||!selectedTokens[0]||!selectedTokens[1])throw new Error('Select the prepared Limit pair.');
    return currentDexDisplayPair(c,selectedTokens[0].address,selectedTokens[1].address);
  })():null;
  const tokenLabels=pair?pair.tokens.map(token=>token.label):CURRENT_DEX_POOL_LABELS;
  const format=(value:bigint,index:0|1=0)=>pair?formatDexCandidateTokenAmount(c,pair.tokens[index].address,value):formatCurrentDexTokenAmount(value);
  const parse=(value:string,index:0|1,positive=false)=>pair?parseDexCandidateTokenAmount(c,pair.tokens[index].address,value,tokenLabels[index],positive):parseCurrentDexTokenAmount(value,tokenLabels[index],positive);
  const ownerAdmission=currentLimitOwnerNativeAdmission(candidateKey);
  const [sellToken0,setDirection]=useState(true),[amount,setAmount]=useState(''),[price,setPrice]=useState(''),[minimum,setMinimum]=useState('0');
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState<{text:string;scope:object}|null>(null),[hash,setHash]=useState('');
  const [creation,setCreation]=useState<{value:CurrentLimitCreationResult;scope:object}|null>(null),[verified,setVerified]=useState<{id:bigint;scope:object}|null>(null);
  const [ownerId,setOwnerId]=useState(''),[ownerResult,setOwnerResult]=useState<{value:CurrentLimitOwnerResult;capability:Awaited<ReturnType<typeof issueCurrentDexLimitCapability>>;scope:object}|null>(null);
  const [pending,setPending]=useState<{recover:()=>Promise<unknown>;phase:string;scope:object;ownerCapability?:Awaited<ReturnType<typeof issueCurrentDexLimitCapability>>}|null>(null);
  const [ownerPair,setOwnerPair]=useState<readonly[string,string]|null>(null);
  const [topUp,setTopUp]=useState(''),[editPrice,setEditPrice]=useState(''),[editMinimum,setEditMinimum]=useState('0');
  const [selectedOrder,setSelectedOrder]=useState<{id:bigint;closed:boolean;context:string}|null>(null);
  const [topUpRecovery,setTopUpRecovery]=useState<{positionId:bigint;transactionHash:string;scope:object}|null>(null),[recoveryAmount,setRecoveryAmount]=useState('');
  const ownedMarket=ownerPair&&preparedScope?.candidate.pairs.find(market=>market.tokens.every(address=>ownerPair.includes(address)));
  const managementPair=ownedMarket?currentDexDisplayPair(c,ownedMarket.tokens[0],ownedMarket.tokens[1]):pair;
  const ownerTokens=managementPair?managementPair.tokens.map(token=>token.label):tokenLabels;
  const formatOwner=(value:bigint,index:0|1=0)=>managementPair?formatDexCandidateTokenAmount(c,managementPair.tokens[index].address,value):format(value,index);
  const parseOwner=(value:string,index:0|1,positive=false)=>managementPair?parseDexCandidateTokenAmount(c,managementPair.tokens[index].address,value,ownerTokens[index],positive):parse(value,index,positive);
  const getLimit=sharedWalletSession?.actions?.getCurrentDexLimitCapability,getSender=sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyState=sharedWalletSession?resolveBrowserWalletPrivacyState({browserWalletAddress:sharedWalletSession.walletAddress,sessionOnboardInfo:sharedWalletSession.sessionOnboardInfo??{},walletAesHealthByAddress:sharedWalletSession.walletAesHealthByAddress}):null;
  const privacyReady=privacyState?.ownerAesReady??false;
  const state={terms:[sellToken0,amount,price,minimum,priceDisplayInverted].join(':'),owner:sharedWalletSession?.walletAddress.toLowerCase(),chain:sharedWalletSession?.chainId,
    candidateKey,graph:c.graph,core:c.core,marketId:pair?.marketId??c.marketId,pair:pair?[pair.tokenIn.address,pair.tokenOut.address].join(':'):undefined,privacyKey:privacyState?.ownerAesKey,
    provider:sharedWalletSession?.browserProvider,walletId:sharedWalletSession?.browserWalletId,source:sharedWalletSession?.activeSignerSource,getLimit,getSender,ownerId,privacyReady,
    onboard:sharedWalletSession?.sessionOnboardInfo,health:sharedWalletSession?.walletAesHealthByAddress,ownerPair:managementPair?.marketId,selectedOrder};
  const scope=useRef(state);if((Object.keys(state)as(keyof typeof state)[]).some(key=>state[key]!==scope.current[key]))scope.current=state;
  const inFlight=useRef(false);
  const editInput=useRef('');editInput.current=[topUp,editPrice,editMinimum].join(':');
  const {confirmation,requestConfirmation,resolveConfirmation}=useTradeActionConfirmationState(scope.current);
  const connected=Boolean(state.owner&&state.chain===Number(c.chainId)&&state.provider&&getLimit&&getSender);
  const savedActionPending=hasCurrentDexPendingAction();
  const savedAttempt=readCurrentDexPendingAttempt(currentDexPendingStorage());
  const recoveryTarget=topUpRecovery?.scope===scope.current?topUpRecovery:(savedAttempt?.verificationBlocked&&savedAttempt.phase==='limit-owner'&&savedAttempt.txHash&&message?.scope===scope.current&&/Limit top-up/.test(message.text)&&/^\d+$/.test(ownerId)&&BigInt(ownerId)>=8n?{positionId:BigInt(ownerId),transactionHash:savedAttempt.txHash}:null);
  const baseIndex:0|1=pair?(pair.tokens[0].address===(priceDisplayInverted?pair.tokenOut:pair.tokenIn).address?0:1):(priceDisplayInverted?0:1);
  const priceTermsInverted=baseIndex===0;
  const displayedSide=pair?(sellToken0===(baseIndex===0)?'sell':'buy'):resolveDisplayedTradeActionSide(sellToken0?'buy':'sell',priceDisplayInverted);
  const displayedBase=tokenLabels[baseIndex];
  const displayedQuote=tokenLabels[baseIndex===0?1:0];
  const assertScope=(captured:object)=>{if(captured!==scope.current)throw new Error('Limit terms or owner session changed. Review again.');};
  const notice=(text:string)=>setMessage({text,scope:scope.current});
  const fail=(error:unknown,captured:object)=>notice(captured!==scope.current
    ?'Limit terms or owner session changed. Review again.'
    :error instanceof Error?error.message:'Limit action failed. Reconcile before retrying.');
  const sold=tokenLabels[sellToken0?0:1],received=tokenLabels[sellToken0?1:0];
  const confirm=(title:string,rows:{label:string;value:string}[])=>requestConfirmation({title,primaryLabel:'Continue',fundingMoves:[],summaryRows:rows,stats:[],
    message:'Post-only creation funds the resting order. It does not execute a swap. A separate owner snapshot transaction confirms its private result. Network gas applies.'});
  const create=async()=>{
    if(!connected||inFlight.current||busy||blocked||savedActionPending)return;const captured=scope.current;inFlight.current = true; setBusy(true);setCreation(null);setVerified(null);
    try{const exactAmount=parse(amount,sellToken0?0:1,true);
      if(preparedCandidate){assertCurrentLimitNativeAdmission(candidateKey,'limit-create');assertCurrentAppLimitAuthority(c.graph,{owner:state.owner!,action:'create',amount:exactAmount});}
      const raw=currentLimitIntent(sellToken0,exactAmount.toString(),price,parse(minimum,sellToken0?0:1).toString());
      // Fixed terms always store sorted token0/token1, for either sell direction.
      const w=currentPoolFractionWitness(raw.terms[priceTermsInverted?1:0],raw.terms[priceTermsInverted?0:1]);
      const intent={...raw,terms:[w[0],w[1],raw.terms[2],w[2],w[3]]as const};
      const sender=await (preparedCandidate?getSender!(BigInt(c.chainId),{candidate:candidateKey}):getSender!(BigInt(c.chainId)));assertScope(captured);
      const candidate=await sender.checkCurrentCheapCandidate();assertScope(captured);
      if(candidate.graph!==c.graph||candidate.core.toLowerCase()!==c.core.toLowerCase()||candidate.owner.toLowerCase()!==state.owner)throw new Error('Limit candidate or owner changed.');
      const head=await state.provider!.request({method:'eth_getBlockByNumber',params:['latest',false]})as{number:string;hash:string};assertScope(captured);
      const capability=await (preparedCandidate?getLimit!(BigInt(c.chainId),{candidate:candidateKey,selectedPair:pair!.tokens.map(token=>token.address)as[string,string]}):getLimit!(BigInt(c.chainId)));assertScope(captured);
      const prepared=await capability.prepareLimit({graph:{number:BigInt(head.number),hash:head.hash,expectedGraph:c.graph,expectedPackageSha256:c.packageSha256},intent,
        confirm:async review=>{assertScope(captured);const accepted=await confirm('Create private plain Limit',[
          {label:'You sell',value:sold},{label:'You receive',value:received},{label:'Offered budget',value:format(review.amount,sellToken0?0:1)},
          {label:`Price (${displayedQuote} per ${displayedBase})`,value:`${review.terms[priceTermsInverted?1:0]}/${review.terms[priceTermsInverted?0:1]}`},{label:`Maker minimum (${sold})`,value:format(review.terms[2],sellToken0?0:1)}]);assertScope(captured);return accepted;}});
      assertScope(captured);if(!prepared){notice('Limit creation cancelled.');return;}setBlocked(true);
      const sent=await sender.submitLimit(prepared);setPending({recover:sent.recover,phase:'limit-create',scope:captured});setHash(sent.transactionHash);notice('Limit creation submitted. Check its canonical result before another request.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const snapshot=async()=>{
    if(!creation||creation.scope!==scope.current||!connected||inFlight.current||busy||blocked||savedActionPending)return;const captured=scope.current;inFlight.current = true; setBusy(true);
    try{if(preparedCandidate){assertCurrentLimitNativeAdmission(candidateKey,'limit-snapshot');assertCurrentAppLimitAuthority(c.graph,{owner:state.owner!,action:'snapshot'});}
      const prepared=await creation.value.prepareSnapshot(async()=>{assertScope(captured);const accepted=await confirm('Refresh private Limit result',[{label:'Position NFT',value:creation.value.positionId.toString()},{label:'Action',value:'Owner-only snapshot; no token funding'}]);assertScope(captured);return accepted;});
      assertScope(captured);
      if(!prepared){notice('Limit snapshot cancelled.');return;}const sender=await (preparedCandidate?getSender!(BigInt(c.chainId),{candidate:candidateKey}):getSender!(BigInt(c.chainId)));assertScope(captured);setBlocked(true);
      const sent=await sender.submitLimit(prepared);setPending({recover:sent.recover,phase:'limit-snapshot',scope:captured});setHash(sent.transactionHash);notice('Owner snapshot submitted. Check its private result.');
    }catch(error){fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const currentOwner=ownerResult?.scope===scope.current&&ownerResult.value.positionId.toString()===ownerId&&privacyReady?ownerResult:null;
  const loadClosed=async()=>{
    if(!selectedOrder?.closed||selectedOrder.id.toString()!==ownerId||!connected||!privacyReady||inFlight.current||busy||blocked||savedActionPending)return;
    const captured=scope.current;inFlight.current=true;setBusy(true);setOwnerResult(null);
    try{
      const capability=await getLimit!(BigInt(c.chainId),{candidate:candidateKey,selectedPair:managementPair!.tokens.map(token=>token.address)as[string,string]});assertScope(captured);
      const result=await capability.readClosedOrder({positionId:selectedOrder.id,expectedContext:selectedOrder.context});assertScope(captured);
      if(result.positionId!==selectedOrder.id||result.context!==selectedOrder.context||!result.closed||result.refreshRequired||!result.amounts)throw new Error('Closed Limit private state is unavailable. Refresh orders and try again.');
      setOwnerResult({value:result,capability,scope:captured});notice('Closed Limit private state loaded. Current unspent inventory and proceeds are zero; private terms are preserved.');
    }catch(error){fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  const approve=async(kind:'create'|'topup')=>{
    if(!ownedDiscovery||!connected||!privacyReady||inFlight.current||busy||blocked||savedActionPending)return;
    const captured=scope.current,capturedEdit=editInput.current;inFlight.current=true;setBusy(true);
    let fundingPreparationStarted=false;
    const assertReview=()=>{assertScope(captured);if(kind==='topup'&&capturedEdit!==editInput.current)throw new Error('Limit edit inputs changed. Review again.');};
    try{
      const index:0|1=kind==='create'?(sellToken0?0:1):(currentOwner?.value.amounts?.sellToken0?0:1);
      const exact=kind==='create'?parse(amount,index,true):parseOwner(topUp,index,true);
      assertCurrentLimitNativeAdmission(candidateKey,kind==='create'?'limit-create':'limit-owner',kind==='topup'?'topup':undefined);
      assertCurrentAppLimitAuthority(c.graph,{owner:state.owner!,action:kind==='create'?'approve-create':'approve-topup',amount:exact});
      if(kind==='topup'&&(!currentOwner?.value.amounts||currentOwner.value.closed||currentOwner.value.refreshRequired))throw new Error('Refresh this Limit privately before funding it.');
      const capability=kind==='topup'?currentOwner!.capability:await getLimit!(BigInt(c.chainId),{candidate:candidateKey,selectedPair:pair!.tokens.map(token=>token.address)as[string,string]});assertReview();
      fundingPreparationStarted=true;const funding=await capability.prepareFundingReview(kind==='create'?{kind,sellToken0,amount:exact}:{kind,positionId:currentOwner!.value.positionId,snapshot:currentOwner!.value,expectedContext:currentOwner!.value.context,amount:exact});assertReview();
      const sender=await getSender!(BigInt(c.chainId),{candidate:candidateKey});assertReview();
      const prepared=await sender.prepareSharedLimitApproval({funding,confirm:async review=>{
        assertReview();const accepted=await requestConfirmation({title:'Approve exact Limit allowance',primaryLabel:'Approve',fundingMoves:[],stats:[],summaryRows:[
          {label:'Token',value:review.token},{label:'Exact allowance',value:kind==='create'?format(review.amount,index):formatOwner(review.amount,index)},
          {label:'Previous allowance',value:kind==='create'?format(review.previousAllowance,index):formatOwner(review.previousAllowance,index)},{label:'Core spender',value:review.spender}],
          message:'This separate transaction sets the exact private allowance. It does not create or top up an order. Check its result, then review the order again.'});assertReview();return accepted;
      }});assertReview();if(!prepared){notice('Limit allowance cancelled.');return;}
      setBlocked(true);const sent=await sender.submitSharedLimitApproval(prepared);setPending({recover:sent.recover,phase:'limit-approval',scope:captured});setHash(sent.transactionHash);notice('Limit allowance submitted. Check its exact result before reviewing the order.');
    }catch(error){if(kind==='topup'&&fundingPreparationStarted)setOwnerResult(null);fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  const ownerAction=async(action:CurrentLimitOwnerAction)=>{
    if(!connected||inFlight.current||busy||blocked||savedActionPending||!privacyReady||selectedOrder?.closed||currentOwner?.value.closed||(action==='resume'&&!ownerAdmission.resume))return;const captured=scope.current,capturedEdit=editInput.current;inFlight.current = true; setBusy(true);
    const assertReview=()=>{assertScope(captured);if((action==='topup'||action==='reprice')&&capturedEdit!==editInput.current)throw new Error('Limit edit inputs changed. Review again.');};
    let ownerPreparationStarted=false;
    try{
      const offeredIndex:0|1=currentOwner?.value.amounts?.sellToken0?0:1;
      const topUpAmount=action==='topup'?parseOwner(topUp,offeredIndex,true):undefined;
      if(preparedCandidate){
      assertCurrentLimitNativeAdmission(candidateKey,'limit-owner',action);
      assertCurrentAppLimitAuthority(c.graph,{owner:state.owner!,action,...(topUpAmount!==undefined?{amount:topUpAmount}:{})});
    }
      const id=parseCurrentTrialAtoms(ownerId,true),capability=action==='refresh'?await (preparedCandidate?getLimit!(BigInt(c.chainId),{candidate:candidateKey,selectedPair:managementPair!.tokens.map(token=>token.address)as[string,string]}):getLimit!(BigInt(c.chainId))):currentOwner?.capability;assertScope(captured);if(!capability)throw new Error('Refresh this Limit privately before an owner action.');
      const p=action==='reprice'?parseCurrentTrialPriceLimit(editPrice):null,w=p?currentPoolFractionWitness(p.denominator,p.numerator):null;
      const newTerms=w?[w[0],w[1],parseOwner(editMinimum,offeredIndex),w[2],w[3]]as const:undefined;
      if(newTerms&&newTerms[2]>=1n<<128n)throw new Error('Maker minimum must fit uint128.');
      ownerPreparationStarted=true;const prepared=await capability.prepareOwnerAction({positionId:id,action,snapshot:action==='refresh'?undefined:currentOwner?.value,expectedContext:currentOwner?.value.context,
        ...(topUpAmount!==undefined?{topUpAmount}:{}),...(newTerms?{newTerms}:{}),
        confirm:async review=>{assertReview();const accepted=await requestConfirmation({title:action==='topup'?'Top up plain Limit':action==='reprice'?'Edit plain Limit price':action==='refresh'?'Refresh private Limit':action==='close'?'Close plain Limit':action==='claim'?'Claim Limit proceeds':action==='pause'?'Pause plain Limit':'Resume plain Limit',primaryLabel:'Continue',fundingMoves:[],stats:[],
          summaryRows:[{label:'Position NFT',value:id.toString()},{label:'Action',value:action},...(topUpAmount!==undefined?[{label:`Top-up (${ownerTokens[offeredIndex]})`,value:formatOwner(topUpAmount,offeredIndex)}]:[]),...(newTerms?[{label:`New price (${ownerTokens[1]} per ${ownerTokens[0]})`,value:`${newTerms[1]}/${newTerms[0]}`},{label:`Maker minimum (${ownerTokens[offeredIndex]})`,value:formatOwner(newTerms[2],offeredIndex)}]:[]),...(review.snapshot?.amounts?[{label:'Unspent offered inventory',value:formatOwner(review.snapshot.amounts.unspent,review.snapshot.amounts.sellToken0?0:1)},{label:'Claimable received proceeds',value:formatOwner(review.snapshot.amounts.proceeds,review.snapshot.amounts.sellToken0?1:0)}]:[])],
          message:action==='refresh'?'This explicit owner snapshot transaction authenticates private amounts. It does not fund or trade.':action==='close'?'Close pays exact proceeds and unspent inventory, then burns only this Limit NFT.':action==='claim'?'Claim pays exact proceeds only. Unspent inventory remains in the resting order. Refresh again after the claim.':'This owner change requires a new private refresh afterward. Network gas applies.'});assertReview();return accepted;}});
      assertReview();if(!prepared){notice('Limit owner action cancelled.');return;}const sender=await (preparedCandidate?getSender!(BigInt(c.chainId),{candidate:candidateKey}):getSender!(BigInt(c.chainId)));assertReview();setBlocked(true);
      const sent=await sender.submitLimitOwner(prepared);setOwnerResult(null);setTopUp('');setEditPrice('');setEditMinimum('0');setPending({recover:sent.recover,phase:'limit-owner',scope:captured,ownerCapability:capability});setHash(sent.transactionHash);notice('Limit owner action submitted. Check its exact canonical result before another request.');
    }catch(error){if(ownerPreparationStarted||action!=='topup'&&action!=='reprice')setOwnerResult(null);fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const refresh=async()=>{
    if(!getSender||inFlight.current||busy||state.chain!==Number(c.chainId))return;inFlight.current = true; setBusy(true);const captured=scope.current;
    try{
      if(pending&&pending.scope!==captured)throw new Error('Pending Limit session changed. Reload and reconcile the saved attempt before another request.');
      if(pending&&pending.scope===captured){try{
        if(pending.phase==='limit-approval'){
          const approval=await pending.recover()as{fundingOutcome:string;privateAccountingVerified:boolean};assertScope(captured);
          if(!approval.privateAccountingVerified||!['verified','reverted'].includes(approval.fundingOutcome))throw new Error('Exact Limit allowance accounting is unavailable. Reconcile before retrying.');
          setPending(null);setBlocked(false);notice(approval.fundingOutcome==='reverted'?'Limit allowance reverted. Review a fresh allowance.':'Exact private Limit allowance verified. Review the order again with fresh funding checks.');return;
        }
        const result=await pending.recover()as CurrentLimitCreationResult|CurrentLimitOwnerResult;assertScope(captured);setPending(null);setBlocked(false);
        if(pending.phase==='limit-owner'){const owner=result as CurrentLimitOwnerResult;if(!pending.ownerCapability)throw new Error('Limit owner capability is unavailable.');setOwnerResult({value:owner,capability:pending.ownerCapability,scope:captured});notice(owner.closed?'Limit proceeds and unspent inventory verified; NFT burn and closed owner tombstone verified.':owner.refreshRequired?'Limit owner action verified. Private amount authority is cleared. Refresh again.':'Limit owner snapshot authenticated at its canonical receipt block.');return;}
        if(pending.phase==='limit-create'){setCreation({value:result as CurrentLimitCreationResult,scope:captured});notice(`Limit NFT ${result.positionId} mint and offered debit verified. Refresh its private result.`);}
        else{setVerified({id:result.positionId,scope:captured});setCreation(null);notice(`Limit NFT ${result.positionId} private offered inventory, price, maker minimum and direction verified.`);}return;
      }catch(error){
        // Do not downgrade a known private accounting failure to metadata-only success.
        // Reload recovery is for a lost session, not a bypass for this session's checker.
        setBlocked(true);if(pending.phase==='limit-owner')setOwnerResult(null);fail(error,captured);return;
      }}
      const sender=await (preparedCandidate?getSender(BigInt(c.chainId),{candidate:candidateKey}):getSender(BigInt(c.chainId)));assertScope(captured);
      if(readCurrentDexPendingAttempt(currentDexPendingStorage())?.phase==='token-approve'){
        const approval=await sender.recoverPendingSharedLimitApproval();assertScope(captured);
        if(!approval||approval.status==='observed-mined'||approval.status==='observed-reverted'){setPending(null);setBlocked(false);notice(approval?.status==='observed-reverted'?'Limit allowance reverted. Review a fresh allowance.':'Limit allowance receipt reconciled. Review the order again with fresh funding checks.');}
        else{setBlocked(true);notice('Limit allowance is pending or uncertain. Do not resend.');}return;
      }
      const observed=await sender.recoverPendingLimitAttempt();assertScope(captured);
      if(!observed){setBlocked(false);notice('No pending Limit attempt found.');return;}
      if(observed.status==='observed-mined'||observed.status==='observed-reverted'){setPending(null);setBlocked(false);setCreation(null);setVerified(null);
        setOwnerResult(null);notice(observed.status==='observed-reverted'?'Limit transaction reverted. Review a fresh request.':observed.phase==='limit-owner'?'Limit owner transaction and public events verified. Private accounting was not restored. Refresh an active owned Limit explicitly before managing it.':'Limit transaction mined. This session has no authenticated private creation result.');}
      else{
        setBlocked(true);const topUp='topUp'in observed?observed.topUp:null;
        if(topUp&&typeof topUp==='object'&&'positionId'in topUp&&typeof topUp.positionId==='bigint'&&'transactionHash'in topUp&&typeof topUp.transactionHash==='string'){
          setTopUpRecovery({positionId:topUp.positionId,transactionHash:topUp.transactionHash,scope:captured});notice('Private verification stopped. Verify the existing top-up before continuing.');
        }else notice('Limit transaction is pending or uncertain. Do not resend.');
      }
    }catch(error){setBlocked(true);fail(error,captured);}finally{inFlight.current = false; setBusy(false);}
  };
  const reconcileTopUp=async()=>{
    if(!recoveryTarget||!getLimit||!getSender||!connected||!privacyReady||busy||inFlight.current||!managementPair)return;
    const captured=scope.current,target=recoveryTarget;inFlight.current=true;setBusy(true);
    try{
      const expectedAmount=parseOwner(recoveryAmount,0,true);
      if(!await requestConfirmation({title:'Verify existing top-up',primaryLabel:'Verify',fundingMoves:[],stats:[],summaryRows:[{label:'Position NFT',value:target.positionId.toString()},{label:'Expected top-up',value:recoveryAmount},{label:'Transaction',value:target.transactionHash}],message:'Read-only verification of the existing deposit. This does not send another transaction.'})){assertScope(captured);return;}
      assertScope(captured);const capability=await getLimit(BigInt(c.chainId),{candidate:candidateKey,selectedPair:managementPair.tokens.map(token=>token.address)as[string,string]});assertScope(captured);
      const proof=await capability.verifyMinedTopUp({positionId:target.positionId,transactionHash:target.transactionHash,expectedAmount});assertScope(captured);
      const sender=await getSender(BigInt(c.chainId),{candidate:candidateKey});assertScope(captured);
      const result=await sender.reconcileMinedTopUp(proof);assertScope(captured);
      setPending(null);setBlocked(false);setTopUpRecovery(null);setRecoveryAmount('');setOwnerResult({value:result,capability,scope:captured});
      notice(proof.privateWalletDeltaVerified===false?'Existing top-up receipt debit and remaining allowance verified. Historical wallet delta is unverified. Refresh private amounts before continuing.':'Existing top-up debit and remaining allowance verified. Refresh private amounts to continue.');
    }catch(error){setBlocked(true);fail(error,captured);}finally{inFlight.current=false;setBusy(false);}
  };
  return<section className="dex-v2-test-form dex-v2-current-pool-positions dex-v2-current-limit dex-owner-workspace" aria-busy={busy} aria-label={view==='create'?'Create limit order':'Manage limit orders'}>
    <div className="dex-v2-panel-fields" hidden={view!=='create'}>
    <header><h2>{displayedSide==='buy'?'Buy':'Sell'} {displayedBase}</h2><p>Limit order · waits for a match at your private price</p></header>
    <div className="dex-v2-current-side-toggle" role="group" aria-label="Limit side">
      {(['buy','sell']as const).map(side=><button key={side} type="button" aria-pressed={displayedSide===side} disabled={busy||blocked||savedActionPending} onClick={()=>setDirection(pair?(side==='sell'?baseIndex===0:baseIndex!==0):resolveCanonicalTradeActionSide(side,priceDisplayInverted)==='buy')}>{side==='buy'?'Buy':'Sell'}</button>)}
    </div>
    <label>Amount ({sold})<input aria-label="Limit offered budget" inputMode="decimal" placeholder="0" value={amount} disabled={busy||blocked} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Limit price<input aria-label="Limit exact price" inputMode="decimal" value={price} disabled={busy||blocked} onChange={e=>setPrice(e.target.value)}/><small>{displayedQuote} per {displayedBase}</small></label>
    <p>You receive {received} when the order fills.</p>
    <details className="dex-v2-setup"><summary>Advanced order settings</summary><div>
      <label>Minimum fill ({sold})<input aria-label="Limit maker minimum" inputMode="decimal" value={minimum} disabled={busy||blocked} onChange={e=>setMinimum(e.target.value)}/></label>
      <p>A smaller fill is allowed only if it uses all remaining inventory. Proceeds stay claimable; they do not fund a reverse order.</p>
    </div></details>
    <button className="dex-v2-review-button" type="button" disabled={!connected||busy||blocked||savedActionPending} onClick={()=>{void create();}}>Review order</button>
    {ownedDiscovery?<button type="button" disabled={!connected||!privacyReady||busy||blocked||savedActionPending} onClick={()=>{void approve('create');}}>Review exact order allowance</button>:null}
    {creation?.scope===scope.current?<><p>Minted NFT {creation.value.positionId.toString()}. Private terms verification is pending.</p><button type="button" disabled={busy||blocked} onClick={()=>{void snapshot();}}>Refresh private Limit result</button></>:null}
    {verified?.scope===scope.current?<p>Verified plain Limit NFT {verified.id.toString()}</p>:null}
    </div>
    <div className="dex-v2-panel-fields" hidden={view!=='manage'}>
    <header className="dex-owner-heading"><div><h2>My orders</h2></div></header>
    {ownedDiscovery?<CurrentOwnedLimits session={sharedWalletSession} candidateKey={candidateKey} selectedPair={pair!.tokens.map(token=>token.address)as[string,string]} visible={view==='manage'} disabled={busy||blocked||savedActionPending}
      selectedId={ownerId} refreshToken={`${hash}:${ownerResult?.value.context??''}:${creation?.value.positionId??''}`} onSelect={order=>{setOwnerId(order.positionId.toString());setOwnerPair(order.poolTokens);setSelectedOrder({id:order.positionId,closed:order.closed,context:order.context});setOwnerResult(null);setMessage(null);setHash('');setTopUp('');setEditPrice('');setEditMinimum('0');}}/>:null}
    <details className="dex-owner-footer" open={!ownedDiscovery}><summary>Manual order lookup</summary><label>Limit position NFT<input aria-label="Limit owner NFT ID" value={ownerId} disabled={busy||blocked} onChange={e=>{setOwnerId(e.target.value);setOwnerPair(null);setSelectedOrder(null);setOwnerResult(null);setTopUp('');setEditPrice('');setEditMinimum('0');}}/></label></details>
    {ownerId?<p>NFT {ownerId}{managementPair?` · ${ownerTokens.join('/')}`:''}{selectedOrder?.closed||currentOwner?.value.closed?' · Closed Limit':''}</p>:null}
    {(!ownedDiscovery||ownerId)?<button type="button" disabled={!connected||!privacyReady||busy||blocked||savedActionPending||!ownerId||currentOwner?.value.closed} onClick={()=>{void (selectedOrder?.closed?loadClosed():ownerAction('refresh'));}}>Load private order</button>:null}
    {currentOwner?.value.amounts?<dl className="dex-v2-current-facts"><div><dt>Unspent {ownerTokens[currentOwner.value.amounts.sellToken0?0:1]}</dt><dd>{formatOwner(currentOwner.value.amounts.unspent,currentOwner.value.amounts.sellToken0?0:1)}</dd></div><div><dt>Claimable {ownerTokens[currentOwner.value.amounts.sellToken0?1:0]}</dt><dd>{formatOwner(currentOwner.value.amounts.proceeds,currentOwner.value.amounts.sellToken0?1:0)}</dd></div><div><dt>Private price ({ownerTokens[1]} per {ownerTokens[0]})</dt><dd>{currentOwner.value.amounts.priceDenominator.toString()}/{currentOwner.value.amounts.priceNumerator.toString()}</dd></div><div><dt>Maker minimum</dt><dd>{formatOwner(currentOwner.value.amounts.makerMinimum,currentOwner.value.amounts.sellToken0?0:1)}</dd></div></dl>:null}
    {currentOwner ? <fieldset className="dex-v2-panel-fields dex-owner-actions" disabled={busy||blocked||savedActionPending}>
    {ownedDiscovery&&currentOwner.value.amounts&&!currentOwner.value.closed&&!currentOwner.value.refreshRequired?<>
      <details className="dex-owner-action" name="limit-owner-actions"><summary>Add funds</summary><div className="dex-v2-panel-fields"><label>Top-up amount ({ownerTokens[currentOwner.value.amounts.sellToken0?0:1]})<input aria-label="Limit top-up amount" inputMode="decimal" value={topUp} disabled={busy||blocked||savedActionPending} onChange={e=>setTopUp(e.target.value)}/></label>
      <button type="button" disabled={busy||blocked||savedActionPending} onClick={()=>{void approve('topup');}}>Review exact top-up allowance</button>
      <button type="button" disabled={busy||blocked||savedActionPending} onClick={()=>{void ownerAction('topup');}}>Review top-up</button></div></details>
      <details className="dex-owner-action" name="limit-owner-actions"><summary>Edit price</summary><div className="dex-v2-panel-fields"><label>New price ({ownerTokens[1]} per {ownerTokens[0]})<input aria-label="Limit new exact price" inputMode="decimal" value={editPrice} disabled={busy||blocked||savedActionPending} onChange={e=>setEditPrice(e.target.value)}/></label>
      <label>New minimum fill ({ownerTokens[currentOwner.value.amounts.sellToken0?0:1]})<input aria-label="Limit new maker minimum" inputMode="decimal" value={editMinimum} disabled={busy||blocked||savedActionPending} onChange={e=>setEditMinimum(e.target.value)}/></label>
      <button type="button" disabled={busy||blocked||savedActionPending} onClick={()=>{void ownerAction('reprice');}}>Review new price</button></div></details>
    </>:null}
    <details className="dex-owner-action" name="limit-owner-actions"><summary>Claim proceeds and manage</summary><div className="dex-v2-panel-fields"><button type="button" disabled={!currentOwner||currentOwner.value.closed||currentOwner.value.refreshRequired||busy||blocked} onClick={()=>{void ownerAction('claim');}}>Claim Limit proceeds</button>
    <button type="button" disabled={!currentOwner||currentOwner.value.closed||currentOwner.value.refreshRequired||currentOwner.value.status!==0n||busy||blocked} onClick={()=>{void ownerAction('pause');}}>Pause Limit</button>
    <button type="button" disabled={!ownerAdmission.resume||!currentOwner||currentOwner.value.closed||currentOwner.value.refreshRequired||currentOwner.value.status!==1n||busy||blocked} onClick={()=>{void ownerAction('resume');}}>Resume Limit</button>
    {!currentOwner.value.closed?<p>Refresh private amounts after each action.</p>:null}
    </div></details><details className="dex-owner-action dex-owner-danger" name="limit-owner-actions"><summary>Close order</summary><div className="dex-v2-panel-fields"><button type="button" disabled={!currentOwner||currentOwner.value.closed||currentOwner.value.refreshRequired||busy||blocked} onClick={()=>{void ownerAction('close');}}>Close Limit and return funds</button></div></details>
    </fieldset> : null}
    </div>
    {busy?<p className="dex-owner-progress" role="status">Checking your order… If MetaMask opens, complete its request there. Keep this attempt open.</p>:null}
    {!busy?<p className="dex-owner-progress" role="status">{message?.scope===scope.current?(/another owner adapter/.test(message.text)?'Another DEX action needs a status check. Open History for its recovery.':message.text):''}</p>:null}
    <details className="dex-owner-footer" open={blocked||savedActionPending||undefined}><summary>Status and recovery</summary>
    {savedActionPending ? <p role="alert">A saved action needs reconciliation. Check its status before a new request.</p> : null}
    {connected ? <button type="button" disabled={!getSender||busy||state.chain!==Number(c.chainId)} onClick={()=>{void refresh();}}>Check Limit status</button> : null}
    {recoveryTarget?<div className="dex-v2-panel-fields"><label>Expected top-up amount<input aria-label="Expected submitted Limit top-up amount" inputMode="decimal" value={recoveryAmount} disabled={busy} onChange={event=>setRecoveryAmount(event.target.value)}/></label><button type="button" disabled={!privacyReady||busy||!recoveryAmount} onClick={()=>{void reconcileTopUp();}}>Verify existing top-up</button></div>:null}
    {message?.scope===scope.current&&/another owner adapter/.test(message.text)?<p>{message.text}</p>:null}
    {hash&&message?.scope===scope.current?<p style={{overflowWrap:'anywhere'}}>Transaction {hash}</p>:null}
    </details><TradeActionConfirmModal confirmation={confirmation} onCancel={()=>resolveConfirmation(false)} onConfirm={()=>resolveConfirmation(true)}/>
  </section>;
}
