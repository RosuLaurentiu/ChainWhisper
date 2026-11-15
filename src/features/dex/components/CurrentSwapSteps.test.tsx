import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {ComponentProps} from 'react';
import CurrentSwapSteps from './CurrentSwapSteps';
import CurrentSwapProgress from './CurrentSwapProgress';
const render=(overrides:Partial<ComponentProps<typeof CurrentSwapSteps>>={})=>renderToStaticMarkup(<CurrentSwapSteps
 profile="fast-pool" inputs={{completed:0,total:4,requesting:false}} restored={false} privacyReady={true}
 approval="conditional" quote="next" accept="next" stage="idle" reviewReady={false} delivered={false} scopeChanged={false} {...overrides}/>);
const compact=(html:string)=>html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]??'';
describe('Compact swap steps',()=>{
 it('shows a short upfront summary and keeps the full list closed',()=>{
  const html=render(),visible=compact(html);
  expect(visible).toContain('4 signatures · 2 transactions');expect(visible).toContain('Approval if needed: +1 signature, +1 transaction');
  expect(visible).not.toContain('Private inputs');expect(visible).not.toContain('Conditional');expect(visible).not.toContain('Waiting for verified delivery');
  expect(html).toContain('<details><summary class="current-swap-steps-summary"');expect(html).not.toContain('<details open');
  expect(html.match(/<summary/g)).toHaveLength(1);
  expect(html.match(/<li>/g)).toHaveLength(4);
  expect(html).toContain('Approve</span><strong>If needed');
  expect(html).not.toContain('keeper');
 });
 it('shows the exact extra approval requests when approval is needed',()=>{
  const visible=compact(render({stage:'preparing',approval:'needed',inputs:{completed:4,total:4,requesting:false}}));
  expect(visible).toContain('Approve token');expect(visible).toContain('1 signature · 1 transaction');
 });
 it('shows the real signature request as one current step',()=>{
  const html=render({stage:'preparing',inputs:{completed:1,total:4,requesting:true}}),visible=compact(html);
  expect(visible).toContain('Signature 2 of 4');expect(visible).toContain('Confirm in your wallet');
  expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  expect(html).toContain('1/4 signatures - confirm in wallet');
 });
 it('shows verified multi-source work without adding a Fast work stage',()=>{
  expect(compact(render({profile:'cheap-async',stage:'preparing-quote',quote:'verified',work:{completed:2,total:4}}))).toContain('2 of 4 steps complete.');
  expect(render()).not.toContain('keeper work steps');
 });
 it('does not announce new quote work for a restored quote',()=>{
  const visible=compact(render({restored:true,inputs:{completed:0,total:0,requesting:false},quote:'verified',stage:'ready',reviewReady:true}));
  expect(visible).toContain('Quote ready');expect(visible).not.toContain('2 transactions');expect(visible).not.toContain('4 signatures');
 });
 it.each(['error','expired','reverted'])('does not keep a wallet prompt active after %s',stage=>{
  const html=render({stage,inputs:{completed:1,total:4,requesting:true}}),visible=compact(html);
  expect(visible).toContain('Swap stopped');expect(visible).not.toContain('Confirm signature');expect(html).not.toContain('aria-current="step"');
  expect(html).not.toContain('confirm in wallet');expect(html).not.toContain('>Next<');
  expect(html.match(/<li>/g)).toHaveLength(1);
 });
 it('marks unvisited stages after cancellation without losing verified recovery',()=>{
  const html=render({profile:'cheap-async',stage:'released',quote:'verified',work:{completed:0,total:4},delivered:true});
  expect(html).not.toContain('>Next<');expect(html).not.toContain('Confirm</span>');
  expect(html).not.toContain('aria-current="step"');expect(html).toContain('Refund confirmed');
 });
 it('keeps the reported pre-Quote failure to the completed signatures and approval only',()=>{
  const html=render({profile:'cheap-async',stage:'error',inputs:{completed:4,total:4,requesting:false},approval:'needed'});
  expect(html.match(/<li>/g)).toHaveLength(2);expect(html).toContain('4/4 signatures');expect(html).toContain('Needed');
  expect(html).not.toContain('>Next<');expect(html).not.toContain('Quote</span>');expect(html).not.toContain('Keep pending recovery checks');
 });
 it('shows an applicable approval and stopped submitted quote only',()=>{
  expect(render({approval:'not-needed'})).not.toContain('Approve</span>');
  const html=render({stage:'error',inputs:{completed:4,total:4,requesting:false},approval:'verified',quote:'submitted'});
  expect(html).toContain('Quote</span><strong>Submitted');expect(html).not.toContain('Confirm</span>');
 });
 it('keeps the privacy prerequisite in the expanded details',()=>{
  const html=render({privacyReady:false});expect(compact(html)).not.toContain('Unlock privacy');expect(html).toContain('Privacy unlock is separate.');
 });
 it('flattens only the idle check row and retains pending recovery status',()=>{
  const idle=renderToStaticMarkup(<CurrentSwapProgress visible status={null}><button>Check current state</button></CurrentSwapProgress>);
  expect(idle).toContain('dex-v2-current-progress is-idle');expect(idle).toContain('Check current state');
  const pending=renderToStaticMarkup(<CurrentSwapProgress visible status="Pending" fundingRecovery><button>Recover</button></CurrentSwapProgress>);
  expect(pending).not.toContain('is-idle');expect(pending).toContain('role="alert"');expect(pending).toContain('Recover');
 });
 it('shows completion only when delivery is verified',()=>{
  expect(compact(render({stage:'settlement-pending'}))).not.toContain('Swap complete');
  expect(compact(render({stage:'settled',delivered:true}))).toContain('Swap complete');
  expect(compact(render({stage:'released',delivered:true}))).toContain('Refund confirmed');
 });
});
