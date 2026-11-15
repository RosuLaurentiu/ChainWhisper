import './CurrentSwapSteps.css';
import { ChevronDown } from 'lucide-react';
export type SwapTransactionStep='next'|'wallet'|'submitted'|'verified';
export type SwapApprovalStep='conditional'|'not-needed'|'needed'|'submitted'|'verified';
export type SwapInputProgress=Readonly<{completed:number;total:number;requesting:boolean}>;
/** Counts and states come from the existing wallet, receipt and private-state callbacks. */
export default function CurrentSwapSteps({profile,inputs,restored,privacyReady,approval,quote,accept,stage,work,reviewReady,delivered,scopeChanged,cancelledBeforeQuote}:{
 profile:'fast-pool'|'cheap-async';inputs:SwapInputProgress;restored:boolean;privacyReady:boolean;
 approval:SwapApprovalStep;quote:SwapTransactionStep;accept:SwapTransactionStep;stage:string;
 work?:Readonly<{completed?:number;total:number}>;reviewReady:boolean;delivered:boolean;scopeChanged:boolean;cancelledBeforeQuote?:boolean;
}){
 const cancelled=stage==='released'||cancelledBeforeQuote;
 const stopped=scopeChanged||cancelledBeforeQuote||['error','expired','reverted','released','observed-expired'].includes(stage);
 const active=stopped||delivered||!privacyReady?null:inputs.requesting||stage==='preparing'&&inputs.completed<inputs.total?'Private inputs':
  approval==='needed'||approval==='submitted'?'Token approval':quote==='wallet'||quote==='submitted'?'Request Quote':
   stage==='preparing-quote'?'Prepare Quote':accept==='wallet'||accept==='submitted'?'Accept':stage==='settlement-pending'?'Complete swap':
    reviewReady||stage==='accepting'?'Review Quote':stage==='preparing'?'Request Quote':'Private inputs';
 const transaction=(state:SwapTransactionStep)=>state==='wallet'?stopped?'Stopped':'Confirm in wallet':state==='submitted'?stopped?'Submitted':'Waiting for confirmation':state==='verified'?'Confirmed':cancelled?'Not reached':'Next';
 const sign=['Sign',scopeChanged?'Wallet or inputs changed':restored?'No new signatures':`${inputs.completed}/${inputs.total} signatures${inputs.requesting&&!stopped?' - confirm in wallet':''}`];
 const approve=['Approve',approval==='conditional'?'If needed':approval==='needed'?stopped?'Needed':'Confirm in wallet':'Submitted'];
 const quoteRow=['Quote',profile==='cheap-async'&&quote==='verified'&&stage==='preparing-quote'?(work?.completed===undefined?'Preparing':`${work.completed}/${work.total} steps complete`):transaction(quote)];
 const confirm=['Confirm',accept!=='next'?transaction(accept):reviewReady?'Ready to review':'Next'];
 const complete=['Complete',delivered?stage==='released'?'Refund confirmed':'Swap complete':'Waiting for completion'];
 const rows=stopped?
  [sign,...(delivered?[complete]:accept!=='next'?[confirm]:quote!=='next'?[quoteRow]:approval==='needed'||approval==='submitted'?[approve]:[])]:
  [sign,...(approval==='conditional'||approval==='needed'||approval==='submitted'?[approve]:[]),quoteRow,confirm,...(delivered||stage==='settlement-pending'?[complete]:[])];
 const compactTitle=scopeChanged?'Wallet or inputs changed':cancelledBeforeQuote?'Cancelled':delivered?(stage==='released'?'Refund confirmed':'Swap complete'):stopped?'Swap stopped':
  active==='Token approval'?'Approve token':active==='Request Quote'?'Getting your quote':active==='Prepare Quote'?'Preparing quote':active==='Review Quote'?'Quote ready':active==='Accept'?'Confirm swap':active==='Complete swap'?'Completing swap':
  inputs.requesting?`Signature ${Math.min(inputs.completed+1,inputs.total)} of ${inputs.total}`:stage==='preparing'?'Preparing quote':restored?'Quote restored':`${inputs.total} signatures · 2 transactions`;
 const compactDetail=scopeChanged?'Check your wallet and swap status.':cancelledBeforeQuote?'No quote was submitted.':delivered?'':stopped?'Check swap status before continuing.':!privacyReady?'Approval if needed: +1 signature, +1 transaction':
  inputs.requesting?'Confirm in your wallet':
  active==='Token approval'?(approval==='submitted'?'Waiting for confirmation.':'1 signature · 1 transaction'):
  active==='Request Quote'?(quote==='wallet'?'Confirm the quote in your wallet.':'Waiting for confirmation.'):
  active==='Prepare Quote'?(work?.completed===undefined?'Waiting for the next step.':`${work.completed} of ${work.total} steps complete.`):
  active==='Review Quote'?'Review the quote before you swap.':active==='Accept'?(accept==='wallet'?'Confirm the swap in your wallet.':'Waiting for confirmation.'):
  active==='Complete swap'?'Waiting for completion.':stage==='preparing'?`${inputs.completed} of ${inputs.total} signatures complete.`:'Approval if needed: +1 signature, +1 transaction';
 return <section className="current-swap-steps" aria-label="Swap steps">
  <details><summary className="current-swap-steps-summary" aria-current={active?'step':undefined}><span><strong aria-live="polite">{compactTitle}</strong>{compactDetail?<small>{compactDetail}</small>:null}</span><ChevronDown size={16} aria-hidden="true" /></summary>
  <div className="current-swap-steps-details">
  {!privacyReady?<p>Privacy unlock is separate.</p>:null}
  <ol>{rows.map(([label,detail])=><li key={label}><span>{label}</span><strong>{detail}</strong></li>)}</ol>
  </div>
  </details>
 </section>;
}
