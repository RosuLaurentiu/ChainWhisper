import TransactionSteps, { type StepsOutcome, type StepState, type TransactionStepsModel } from './TransactionSteps';
export type SwapTransactionStep='next'|'wallet'|'submitted'|'verified';
export type SwapApprovalStep='conditional'|'not-needed'|'needed'|'submitted'|'verified';
export type SwapInputProgress=Readonly<{completed:number;total:number;requesting:boolean}>;
export type CurrentSwapStepInput=Readonly<{
 profile:'fast-pool'|'cheap-async';inputs:SwapInputProgress;restored:boolean;privacyReady:boolean;
 approval:SwapApprovalStep;quote:SwapTransactionStep;accept:SwapTransactionStep;stage:string;
 work?:Readonly<{completed?:number;total:number}>;reviewReady:boolean;delivered:boolean;scopeChanged:boolean;cancelledBeforeQuote?:boolean;
}>;
const ACTIVE_ROW:Record<string,string>={'Private inputs':'Sign','Token approval':'Approve','Request Quote':'Quote','Prepare Quote':'Quote','Review Quote':'Confirm','Accept':'Confirm','Complete swap':'Complete'};
/** Counts and states come from the existing wallet, receipt and private-state callbacks. */
export function currentSwapStepsModel({inputs,restored,privacyReady,approval,quote,accept,stage,work,reviewReady,delivered,scopeChanged,cancelledBeforeQuote}:CurrentSwapStepInput):TransactionStepsModel{
 const stopped=scopeChanged||cancelledBeforeQuote||['error','expired','reverted','released','observed-expired'].includes(stage);
 const active=stopped||delivered||!privacyReady?null:inputs.requesting||stage==='preparing'&&inputs.completed<inputs.total?'Private inputs':
  approval==='needed'||approval==='submitted'?'Token approval':quote==='wallet'||quote==='submitted'?'Request Quote':
   stage==='preparing-quote'?'Prepare Quote':accept==='wallet'||accept==='submitted'?'Accept':stage==='settlement-pending'?'Complete swap':
    reviewReady||stage==='accepting'?'Review Quote':stage==='preparing'?'Request Quote':'Private inputs';
 const idle=!stopped&&!delivered&&(!privacyReady||stage==='idle'&&!restored&&!inputs.requesting&&inputs.completed===0&&quote==='next'&&accept==='next'&&!reviewReady&&approval!=='needed'&&approval!=='submitted');
 const rows=stopped?
  ['Sign',...(delivered?['Complete']:accept!=='next'?['Confirm']:quote!=='next'?['Quote']:approval==='needed'||approval==='submitted'?['Approve']:[])]:
  ['Sign',...(approval!=='not-needed'?['Approve']:[]),'Quote','Confirm',...(delivered||stage==='settlement-pending'?['Complete']:[])];
 const title=scopeChanged?'Wallet or inputs changed':cancelledBeforeQuote?'Cancelled':delivered?(stage==='released'?'Refund confirmed':'Swap complete'):stopped?'Swap stopped':
  active==='Token approval'?'Approve token':active==='Request Quote'?'Getting your quote':active==='Prepare Quote'?'Preparing quote':active==='Review Quote'?'Quote ready':active==='Accept'?'Confirm swap':active==='Complete swap'?'Completing swap':
  inputs.requesting?`Signature ${Math.min(inputs.completed+1,inputs.total)} of ${inputs.total}`:stage==='preparing'?'Preparing quote':restored?'Quote restored':`${inputs.total} signatures · 2 transactions · gas applies even with no fill`;
 // Before the swap starts the title is enough; the track shows the steps.
 const detail=idle||delivered?'':scopeChanged?'Check your wallet and swap status.':cancelledBeforeQuote?'No quote was submitted.':stopped?'Check swap status before continuing.':
  inputs.requesting?'Confirm in your wallet':
  active==='Token approval'?(approval==='submitted'?'Waiting for confirmation.':'1 signature · 1 transaction'):
  active==='Request Quote'?(quote==='wallet'?'Confirm the quote in your wallet.':'Waiting for confirmation.'):
  active==='Prepare Quote'?(work?.completed===undefined?'Waiting for the next step.':`${work.completed} of ${work.total} steps complete.`):
  active==='Review Quote'?'Review the quote before you swap.':active==='Accept'?(accept==='wallet'?'Confirm the swap in your wallet.':'Waiting for confirmation.'):
  active==='Complete swap'?'Waiting for completion.':stage==='preparing'?`${inputs.completed} of ${inputs.total} signatures complete.`:'';
 const outcome:StepsOutcome=delivered?'complete':stopped?'stopped':idle?'idle':'running';
 const current=idle||outcome!=='running'?-1:rows.indexOf(ACTIVE_ROW[active??'']);
 const wallet=(label:string)=>label==='Sign'?inputs.requesting:label==='Approve'?approval==='needed':label==='Quote'?quote==='wallet':label==='Confirm'?accept==='wallet':false;
 const signDone=restored||inputs.total>0&&inputs.completed>=inputs.total&&!inputs.requesting;
 const steps=rows.map((label,index)=>{
  const state:StepState=outcome==='complete'?'done':idle?'next':
   // A stop before every signature finished stops at Sign; later steps were not reached.
   outcome==='stopped'?(label==='Sign'?(signDone?'done':'stopped'):!signDone?'next':index<rows.length-1?'done':'stopped'):
   index<current?'done':index>current?'next':wallet(label)?'wallet':'active';
  return {label,state};
 });
 return {title,detail,outcome,steps};
}
/** `status` is still passed by DexV2Page; the swap status message shows next to the form, so the track does not repeat it. */
export default function CurrentSwapSteps(props:CurrentSwapStepInput&{status?:string|null}){
 return <TransactionSteps label="Swap steps" className="current-swap-steps" model={currentSwapStepsModel(props)} />;
}
