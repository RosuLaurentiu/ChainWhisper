import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {ComponentProps} from 'react';
import CurrentSwapSteps,{currentSwapStepsModel} from './CurrentSwapSteps';
import CurrentSwapProgress from './CurrentSwapProgress';
type Input=Partial<ComponentProps<typeof CurrentSwapSteps>>;
const base={profile:'fast-pool',inputs:{completed:0,total:4,requesting:false},restored:false,privacyReady:true,
 approval:'conditional',quote:'next',accept:'next',stage:'idle',reviewReady:false,delivered:false,scopeChanged:false} as const;
const render=(overrides:Input={})=>renderToStaticMarkup(<CurrentSwapSteps {...base} {...overrides}/>);
const summary=(html:string)=>html.match(/<p class="tx-steps-summary"[^>]*>([\s\S]*?)<\/p>/)?.[1]??'';
describe('Inline swap steps',()=>{
 it('shows a short upfront summary and the step track inline',()=>{
  const html=render(),visible=summary(html);
  expect(visible).toContain('4 signatures · 2 transactions');expect(html).not.toContain('Approval if needed');
  expect(html).toContain('class="tx-steps current-swap-steps"');expect(html).not.toContain('<button');expect(html).not.toContain('role="dialog"');
  expect(html.match(/<li /g)).toHaveLength(4);expect(html).not.toContain('keeper');
 });
 it('shows the exact extra approval requests when approval is needed',()=>{
  const visible=summary(render({stage:'preparing',approval:'needed',inputs:{completed:4,total:4,requesting:false}}));
  expect(visible).toContain('Approve token');expect(visible).toContain('1 signature · 1 transaction');
 });
 it('shows the real signature request as one current step',()=>{
  const html=render({stage:'preparing',inputs:{completed:1,total:4,requesting:true}});
  expect(summary(html)).toContain('Signature 2 of 4');expect(summary(html)).toContain('Confirm in your wallet');
  expect(html.match(/aria-current="step"/g)).toHaveLength(1);
 });
 it('shows verified multi-source work without adding a Fast work stage',()=>{
  expect(summary(render({profile:'cheap-async',stage:'preparing-quote',quote:'verified',work:{completed:2,total:4}}))).toContain('2 of 4 steps complete.');
  expect(render()).not.toContain('keeper work steps');
 });
 it('does not announce new quote work for a restored quote',()=>{
  const visible=summary(render({restored:true,inputs:{completed:0,total:0,requesting:false},quote:'verified',stage:'ready',reviewReady:true}));
  expect(visible).toContain('Quote ready');expect(visible).not.toContain('2 transactions');expect(visible).not.toContain('4 signatures');
 });
 it.each(['error','expired','reverted'])('does not keep a wallet prompt active after %s',stage=>{
  const html=render({stage,inputs:{completed:1,total:4,requesting:true}});
  expect(summary(html)).toContain('Swap stopped');expect(html).not.toContain('onfirm in');expect(html).not.toContain('aria-current="step"');
  expect(html.match(/<li /g)).toHaveLength(1);
 });
 it('keeps the privacy prerequisite out of the summary',()=>{
  expect(summary(render({privacyReady:false}))).not.toContain('Unlock privacy');
  expect(currentSwapStepsModel({...base,privacyReady:false}).outcome).toBe('idle');
 });
 it('flattens only the idle check row and retains pending recovery status',()=>{
  const idle=renderToStaticMarkup(<CurrentSwapProgress visible status={null}><button>Check current state</button></CurrentSwapProgress>);
  expect(idle).toContain('dex-v2-current-progress is-idle');expect(idle).toContain('Check current state');
  const pending=renderToStaticMarkup(<CurrentSwapProgress visible status="Pending" fundingRecovery><button>Recover</button></CurrentSwapProgress>);
  expect(pending).not.toContain('is-idle');expect(pending).toContain('role="alert"');expect(pending).toContain('Recover');
 });
 it('shows completion only when delivery is verified',()=>{
  expect(summary(render({stage:'settlement-pending'}))).not.toContain('Swap complete');
  expect(summary(render({stage:'settled',delivered:true}))).toContain('Swap complete');
  expect(summary(render({stage:'released',delivered:true}))).toContain('Refund confirmed');
 });
});
