import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import TransactionSteps,{type TransactionStepsModel} from './TransactionSteps';
import {currentSwapStepsModel,type CurrentSwapStepInput} from './CurrentSwapSteps';

const swap=(overrides:Partial<CurrentSwapStepInput>={})=>currentSwapStepsModel({
 profile:'fast-pool',inputs:{completed:0,total:4,requesting:false},restored:false,privacyReady:true,
 approval:'conditional',quote:'next',accept:'next',stage:'idle',reviewReady:false,delivered:false,scopeChanged:false,...overrides});
const states=(model:TransactionStepsModel)=>model.steps.map(step=>`${step.label}:${step.state}`);
const html=(model:TransactionStepsModel)=>renderToStaticMarkup(<TransactionSteps label="Swap steps" model={model} />);

describe('Swap steps model',()=>{
 it('shows every step as upcoming and only the title before the swap starts',()=>{
  const model=swap();
  expect(model.outcome).toBe('idle');expect(model.title).toBe('4 signatures · 2 transactions');expect(model.detail).toBe('');
  expect(states(model)).toEqual(['Sign:next','Approve:next','Quote:next','Confirm:next']);
 });
 it('marks the signature request as the step that waits for the wallet',()=>{
  const model=swap({stage:'preparing',inputs:{completed:1,total:4,requesting:true}});
  expect(model.outcome).toBe('running');expect(model.title).toBe('Signature 2 of 4');expect(model.detail).toBe('Confirm in your wallet');
  expect(states(model)).toEqual(['Sign:wallet','Approve:next','Quote:next','Confirm:next']);
 });
 it('completes earlier steps when the quote waits for the wallet',()=>{
  expect(states(swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'wallet'})))
   .toEqual(['Sign:done','Approve:done','Quote:wallet','Confirm:next']);
 });
 it('shows a waiting step that needs no wallet action as active',()=>{
  const model=swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'submitted'});
  expect(states(model)).toEqual(['Sign:done','Quote:active','Confirm:next']);expect(model.detail).toBe('Waiting for confirmation.');
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
  expect(JSON.stringify(model)).not.toContain('onfirm in');
 });
 it('keeps completed signatures done when a later step stops',()=>{
  expect(states(swap({stage:'error',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'submitted'}))).toEqual(['Sign:done','Quote:stopped']);
 });
 it('keeps the reported pre-Quote failure to the completed signatures and approval only',()=>{
  expect(states(swap({profile:'cheap-async',stage:'error',inputs:{completed:4,total:4,requesting:false},approval:'needed'}))).toEqual(['Sign:done','Approve:stopped']);
 });
 it('stops at Sign when the review is cancelled before any signature',()=>{
  const model=swap({profile:'cheap-async',stage:'idle',cancelledBeforeQuote:true,inputs:{completed:0,total:4,requesting:false},approval:'needed'});
  expect(model.title).toBe('Cancelled');expect(states(model)).toEqual(['Sign:stopped','Approve:next']);
 });
 it('shows a confirmed refund as a finished swap without unreached steps',()=>{
  const model=swap({profile:'cheap-async',stage:'released',quote:'verified',work:{completed:0,total:4},delivered:true});
  expect(model.outcome).toBe('complete');expect(model.title).toBe('Refund confirmed');expect(states(model)).toEqual(['Sign:done','Complete:done']);
 });
 it('leaves out the approval step when no approval is needed',()=>{
  expect(states(swap({approval:'not-needed'}))).toEqual(['Sign:next','Quote:next','Confirm:next']);
 });
 it('does not start a run while privacy is locked and shows no extra text',()=>{
  const model=swap({privacyReady:false});expect(model.outcome).toBe('idle');expect(model.detail).toBe('');
 });
});

describe('Inline step track',()=>{
 it('renders the title and the track only, with no window or control',()=>{
  const out=html(swap());
  expect(out).toContain('4 signatures · 2 transactions');expect(out).not.toContain('Approval if needed');
  expect(out).not.toContain('<button');expect(out).not.toContain('role="dialog"');
  expect(out.match(/<li /g)).toHaveLength(4);expect(out).not.toContain('aria-current');
  expect(out).toContain('<span class="tx-steps-label">Quote</span>');
 });
 it('names the current step and its state for screen readers',()=>{
  const out=html(swap({stage:'preparing',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'wallet'}));
  expect(out.match(/aria-current="step"/g)).toHaveLength(1);expect(out).toContain('data-state="wallet"');
  expect(out).toContain('Waiting for your wallet');expect(out).toContain('Confirm the quote in your wallet.');
 });
 it('shows the short detail while the flow runs',()=>{
  const out=html(swap({profile:'cheap-async',stage:'preparing-quote',inputs:{completed:4,total:4,requesting:false},approval:'not-needed',quote:'verified',work:{completed:2,total:4}}));
  expect(out).toContain('Preparing quote');expect(out).toContain('2 of 4 steps complete.');
 });
});
