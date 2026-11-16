import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import TransactionGuide,{TransactionGuideLauncher,currentPoolGuideModel,nextGuideOpen,type TransactionGuideModel} from './TransactionGuide';
import {currentSwapGuideModel,type CurrentSwapStepInput} from './CurrentSwapSteps';

const swap=(overrides:Partial<CurrentSwapStepInput>={})=>currentSwapGuideModel({
 profile:'fast-pool',inputs:{completed:0,total:4,requesting:false},restored:false,privacyReady:true,
 approval:'conditional',quote:'next',accept:'next',stage:'idle',reviewReady:false,delivered:false,scopeChanged:false,...overrides});
const states=(model:TransactionGuideModel)=>model.steps.map(step=>`${step.label}:${step.state}`);
const pool=(overrides:Partial<Parameters<typeof currentPoolGuideModel>[0]>={})=>currentPoolGuideModel({
 step:0,approvalCount:0,ready:false,stopped:false,blocked:false,pendingPhase:null,tokenLabels:['HBR','BCN'],...overrides});

describe('Swap guide model',()=>{
 it('shows every step as upcoming before the swap starts',()=>{
  const model=swap();
  expect(model.outcome).toBe('idle');expect(model.title).toBe('4 signatures · 2 transactions');
  expect(states(model)).toEqual(['Sign:next','Approve:next','Quote:next','Confirm:next']);
 });
 it('marks the signature request as the step that waits for the wallet',()=>{
  const model=swap({stage:'preparing',inputs:{completed:1,total:4,requesting:true}});
  expect(model.outcome).toBe('running');expect(model.title).toBe('Signature 2 of 4');expect(model.detail).toBe('Confirm in your wallet');
  expect(states(model)).toEqual(['Sign:wallet','Approve:next','Quote:next','Confirm:next']);
  expect(model.steps[0].detail).toBe('1/4 signatures - confirm in wallet');
 });
 it('completes earlier steps when the quote waits for the wallet',()=>{
  const model=swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'wallet'});
  expect(states(model)).toEqual(['Sign:done','Approve:done','Quote:wallet','Confirm:next']);
 });
 it('shows a waiting step that needs no wallet action as active',()=>{
  const model=swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'submitted'});
  expect(states(model)).toEqual(['Sign:done','Quote:active','Confirm:next']);
  expect(model.steps[1].detail).toBe('Waiting for confirmation');
 });
 it('shows the ready quote as the current step for the user',()=>{
  const model=swap({stage:'ready',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'verified',reviewReady:true});
  expect(model.title).toBe('Quote ready');expect(states(model)).toEqual(['Sign:done','Quote:done','Confirm:active']);
 });
 it('shows the verified multi-source work count',()=>{
  const model=swap({profile:'cheap-async',stage:'preparing-quote',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'verified',work:{completed:2,total:4}});
  expect(model.detail).toBe('2 of 4 steps complete.');expect(states(model)).toEqual(['Sign:done','Quote:active','Confirm:next']);
 });
 it('completes every step only after verified delivery',()=>{
  expect(swap({stage:'settlement-pending',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'verified',accept:'verified'}).outcome).toBe('running');
  const model=swap({stage:'settled',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'verified',accept:'verified',delivered:true});
  expect(model.outcome).toBe('complete');expect(model.title).toBe('Swap complete');
  expect(model.steps.every(step=>step.state==='done')).toBe(true);
 });
 it.each(['error','expired','reverted'])('stops at the last reached step after %s and keeps no wallet prompt',stage=>{
  const model=swap({stage,inputs:{completed:1,total:4,requesting:true}});
  expect(model.outcome).toBe('stopped');expect(states(model)).toEqual(['Sign:stopped']);
  expect(JSON.stringify(model)).not.toContain('confirm in wallet');
 });
 it('keeps completed signatures done when a later step stops',()=>{
  const model=swap({stage:'error',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'submitted'});
  expect(states(model)).toEqual(['Sign:done','Quote:stopped']);expect(model.steps[1].detail).toBe('Submitted');
 });
 it('shows a confirmed refund as a finished swap',()=>{
  const model=swap({profile:'cheap-async',stage:'released',quote:'verified',work:{completed:0,total:4},delivered:true});
  expect(model.outcome).toBe('complete');expect(model.title).toBe('Refund confirmed');
 });
 it('does not start a run while privacy is locked',()=>{
  expect(swap({privacyReady:false}).outcome).toBe('idle');
 });
});

describe('Pool creation guide model',()=>{
 it('shows the four steps as upcoming before the preview',()=>{
  const model=pool();
  expect(model.outcome).toBe('idle');expect(states(model)).toEqual(['Preview:next','Approve:next','Deposit:next','Done:next']);
 });
 it('marks the preview request as the step that waits for the wallet',()=>{
  const model=pool({pendingPhase:'preview'});
  expect(model.outcome).toBe('running');expect(states(model)).toEqual(['Preview:wallet','Approve:next','Deposit:next','Done:next']);
  expect(model.detail).toBe('Confirm in your wallet if asked, then wait for confirmation.');
 });
 it('names the token of the pending approval and counts approvals',()=>{
  const model=pool({step:1,approvalCount:1,pendingPhase:'approval-1'});
  expect(model.steps[1].label).toBe('Approve (1/2)');expect(model.steps[1].state).toBe('wallet');
  expect(model.title).toBe('Approve BCN');
 });
 it('asks for the deposit after both approvals',()=>{
  const model=pool({step:2,approvalCount:2});
  expect(states(model)).toEqual(['Preview:done','Approve:done','Deposit:active','Done:next']);
  expect(model.detail).toBe('Press Review and fund Pool to continue.');
 });
 it('completes every step when the position exists',()=>{
  const model=pool({step:3,approvalCount:2,ready:true});
  expect(model.outcome).toBe('complete');expect(model.steps.every(step=>step.state==='done')).toBe(true);
 });
 it('shows a stopped deposit and a held deposit as stopped',()=>{
  expect(pool({step:-1,stopped:true}).outcome).toBe('stopped');
  const held=pool({step:2,approvalCount:2,blocked:true});
  expect(held.outcome).toBe('stopped');expect(states(held)).toEqual(['Preview:done','Approve:done','Deposit:stopped','Done:next']);
  expect(held.detail).toBe('Check Pool status before you continue. Do not resend.');
 });
});

describe('Guide open state',()=>{
 it('opens once when a flow starts and keeps the user choice after that',()=>{
  expect(nextGuideOpen('idle','running',false)).toBe(true);
  expect(nextGuideOpen('running','running',false)).toBe(false);
  expect(nextGuideOpen('running','complete',true)).toBe(true);
  expect(nextGuideOpen('running','complete',false)).toBe(false);
  expect(nextGuideOpen('complete','idle',true)).toBe(false);
 });
});

describe('Guide window',()=>{
 const model=swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'wallet'});
 it('renders nothing while closed',()=>{
  expect(renderToStaticMarkup(<TransactionGuide flow="Swap" model={model} open={false} onClose={()=>{}} />)).toBe('');
 });
 it('renders a non-modal window with every step and the current position',()=>{
  const html=renderToStaticMarkup(<TransactionGuide flow="Swap" model={model} open onClose={()=>{}} status="Waiting for the wallet" />);
  expect(html).toContain('role="dialog"');expect(html).toContain('aria-modal="false"');
  expect(html).toContain('Step 3 of 4');expect(html).toContain('aria-label="Close swap steps"');
  expect(html.match(/<li /g)).toHaveLength(4);expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  expect(html).toContain('data-state="wallet"');expect(html).toContain('Waiting for the wallet');
  expect(html).toContain('Closing this window stops nothing. Open it again from the form.');
 });
 it('labels finished and stopped flows without a step position',()=>{
  const done=renderToStaticMarkup(<TransactionGuide flow="Swap" model={swap({stage:'settled',quote:'verified',accept:'verified',delivered:true})} open onClose={()=>{}} />);
  expect(done).toContain('All steps complete');expect(done).not.toContain('aria-current');
  const stopped=renderToStaticMarkup(<TransactionGuide flow="Swap" model={swap({stage:'error'})} open onClose={()=>{}} />);
  expect(stopped).toContain('Stopped');
 });
 it('renders a launcher that reports the open state and progress',()=>{
  const html=renderToStaticMarkup(<TransactionGuideLauncher flow="Swap" model={model} open={false} onToggle={()=>{}} />);
  expect(html).toContain('aria-expanded="false"');expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('Show swap steps');expect(html.match(/data-state=/g)).toHaveLength(4);
  expect(html).toContain('Getting your quote');
 });
 it('shows a compact step track in the form row and names the current step for screen readers',()=>{
  const html=renderToStaticMarkup(<TransactionGuideLauncher flow="Swap" model={model} open={false} onToggle={()=>{}} />);
  expect(html.match(/class="tx-guide-track-step"/g)).toHaveLength(4);
  expect(html).toContain('<span class="tx-guide-track-label">Quote</span>');
  expect(html).toContain('Step 3 of 4: Quote. Show swap steps');
  expect(html).not.toContain('Confirm in wallet');
 });
 it('omits the track where the form already shows its own stepper',()=>{
  const html=renderToStaticMarkup(<TransactionGuideLauncher flow="Add liquidity" model={pool({pendingPhase:'preview'})} open={false} onToggle={()=>{}} track={false} />);
  expect(html).not.toContain('tx-guide-track');expect(html).toContain('Show add liquidity steps');
 });
});
