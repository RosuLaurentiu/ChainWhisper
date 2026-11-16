import './CurrentSwapSteps.css';
import { useRef } from 'react';
import TransactionGuide, { TransactionGuideLauncher, useTransactionGuide, type GuideOutcome, type GuideStepState, type TransactionGuideModel } from './TransactionGuide';
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
export function currentSwapGuideModel({profile,inputs,restored,privacyReady,approval,quote,accept,stage,work,reviewReady,delivered,scopeChanged,cancelledBeforeQuote}:CurrentSwapStepInput):TransactionGuideModel{
 const cancelled=stage==='released'||cancelledBeforeQuote;
 const stopped=scopeChanged||cancelledBeforeQuote||['error','expired','reverted','released','observed-expired'].includes(stage);
 const active=stopped||delivered||!privacyReady?null:inputs.requesting||stage==='preparing'&&inputs.completed<inputs.total?'Private inputs':
  approval==='needed'||approval==='submitted'?'Token approval':quote==='wallet'||quote==='submitted'?'Request Quote':
   stage==='preparing-quote'?'Prepare Quote':accept==='wallet'||accept==='submitted'?'Accept':stage==='settlement-pending'?'Complete swap':
    reviewReady||stage==='accepting'?'Review Quote':stage==='preparing'?'Request Quote':'Private inputs';
 const idle=!stopped&&!delivered&&(!privacyReady||stage==='idle'&&!restored&&!inputs.requesting&&inputs.completed===0&&quote==='next'&&accept==='next'&&!reviewReady&&approval!=='needed'&&approval!=='submitted');
 const transaction=(state:SwapTransactionStep)=>state==='wallet'?stopped?'Stopped':'Confirm in wallet':state==='submitted'?stopped?'Submitted':'Waiting for confirmation':state==='verified'?'Confirmed':cancelled?'Not reached':'Next';
 const sign=['Sign',scopeChanged?'Wallet or inputs changed':restored?'No new signatures':`${inputs.completed}/${inputs.total} signatures${inputs.requesting&&!stopped?' - confirm in wallet':''}`] as const;
 const approve=['Approve',approval==='conditional'?'If needed':approval==='needed'?stopped?'Needed':'Confirm in wallet':approval==='verified'?'Confirmed':'Submitted'] as const;
 const quoteRow=['Quote',profile==='cheap-async'&&quote==='verified'&&stage==='preparing-quote'?(work?.completed===undefined?'Preparing':`${work.completed}/${work.total} steps complete`):transaction(quote)] as const;
 const confirm=['Confirm',accept!=='next'?transaction(accept):reviewReady?'Ready to review':'Next'] as const;
 const complete=['Complete',delivered?stage==='released'?'Refund confirmed':'Swap complete':'Waiting for completion'] as const;
 const rows=stopped?
  [sign,...(delivered?[complete]:accept!=='next'?[confirm]:quote!=='next'?[quoteRow]:approval==='needed'||approval==='submitted'?[approve]:[])]:
  [sign,...(approval!=='not-needed'?[approve]:[]),quoteRow,confirm,...(delivered||stage==='settlement-pending'?[complete]:[])];
 const title=scopeChanged?'Wallet or inputs changed':cancelledBeforeQuote?'Cancelled':delivered?(stage==='released'?'Refund confirmed':'Swap complete'):stopped?'Swap stopped':
  active==='Token approval'?'Approve token':active==='Request Quote'?'Getting your quote':active==='Prepare Quote'?'Preparing quote':active==='Review Quote'?'Quote ready':active==='Accept'?'Confirm swap':active==='Complete swap'?'Completing swap':
  inputs.requesting?`Signature ${Math.min(inputs.completed+1,inputs.total)} of ${inputs.total}`:stage==='preparing'?'Preparing quote':restored?'Quote restored':`${inputs.total} signatures · 2 transactions`;
 const detail=scopeChanged?'Check your wallet and swap status.':cancelledBeforeQuote?'No quote was submitted.':delivered?'':stopped?'Check swap status before continuing.':!privacyReady?'Approval if needed: +1 signature, +1 transaction':
  inputs.requesting?'Confirm in your wallet':
  active==='Token approval'?(approval==='submitted'?'Waiting for confirmation.':'1 signature · 1 transaction'):
  active==='Request Quote'?(quote==='wallet'?'Confirm the quote in your wallet.':'Waiting for confirmation.'):
  active==='Prepare Quote'?(work?.completed===undefined?'Waiting for the next step.':`${work.completed} of ${work.total} steps complete.`):
  active==='Review Quote'?'Review the quote before you swap.':active==='Accept'?(accept==='wallet'?'Confirm the swap in your wallet.':'Waiting for confirmation.'):
  active==='Complete swap'?'Waiting for completion.':stage==='preparing'?`${inputs.completed} of ${inputs.total} signatures complete.`:'Approval if needed: +1 signature, +1 transaction';
 const outcome:GuideOutcome=delivered?'complete':stopped?'stopped':idle?'idle':'running';
 const current=idle||outcome!=='running'?-1:rows.findIndex(([label])=>label===ACTIVE_ROW[active??'']);
 const wallet=(label:string)=>label==='Sign'?inputs.requesting:label==='Approve'?approval==='needed':label==='Quote'?quote==='wallet':label==='Confirm'?accept==='wallet':false;
 const signDone=restored||inputs.total>0&&inputs.completed>=inputs.total&&!inputs.requesting;
 const steps=rows.map(([label,text],index)=>{
  const state:GuideStepState=outcome==='complete'?'done':idle?'next':
   outcome==='stopped'?(index<rows.length-1||label==='Sign'&&signDone?'done':'stopped'):
   index<current?'done':index>current?'next':wallet(label)?'wallet':'active';
  return {label,detail:text,state};
 });
 return {title,detail,outcome,steps};
}
/** The launcher keeps the short status in the form; the guide window shows every step. */
export default function CurrentSwapSteps({status,...input}:CurrentSwapStepInput&{status?:string|null}){
 const model=currentSwapGuideModel(input);
 const [open,setOpen]=useTransactionGuide(model.outcome);
 const launcher=useRef<HTMLButtonElement>(null);
 return <section className="current-swap-steps" aria-label="Swap steps">
  <TransactionGuideLauncher flow="Swap" model={model} open={open} onToggle={()=>setOpen(value=>!value)} buttonRef={launcher} />
  <TransactionGuide flow="Swap" model={model} open={open} onClose={()=>setOpen(false)} status={status} returnFocus={launcher} />
 </section>;
}
