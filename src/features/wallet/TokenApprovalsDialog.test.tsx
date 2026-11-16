import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import TokenApprovalsDialog from './TokenApprovalsDialog';
import TokenApprovalChoice, { useTokenApprovalMode } from './TokenApprovalChoice';
import type { SharedWalletSession } from '../../lib/walletSession';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from '../../lib/dexV2Deployment';
import { MAX_TOKEN_ALLOWANCE } from '../../lib/tokenAllowance';

const hooks=vi.hoisted(()=>({index:0,values:[] as unknown[]}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.values))hooks.values[i]=initial;return[hooks.values[i],(value:unknown)=>{hooks.values[i]=value;}];},
  useRef:(initial:unknown)=>{const i=hooks.index++;return hooks.values[i]??=( {current:initial});},
  useEffect:(effect:()=>void,deps:unknown[])=>{const i=hooks.index++,prior=hooks.values[i] as unknown[]|undefined;
    if(!prior||deps.some((value,n)=>value!==prior[n])){hooks.values[i]=deps;effect();}},
  useMemo:(create:()=>unknown,deps:unknown[])=>{const i=hooks.index++,prior=hooks.values[i] as {deps:unknown[];value:unknown}|undefined;
    if(!prior||deps.some((value,n)=>value!==prior.deps[n]))hooks.values[i]={deps,value:create()};return(hooks.values[i] as {value:unknown}).value;}
}));
type ElementProps={children?:ReactNode;onClick?:()=>void;disabled?:boolean};
const nodes=(value:ReactNode):ReactElement<ElementProps>[]=>Array.isArray(value)?value.flatMap(nodes):isValidElement<ElementProps>(value)?[value,...nodes(value.props.children)]:[];
const text=(value:ReactNode):string=>Array.isArray(value)?value.map(text).join(''):isValidElement<ElementProps>(value)?text(value.props.children):typeof value==='string'?value:'';
afterEach(()=>{hooks.index=0;hooks.values=[];vi.clearAllMocks();});
function fixture(){
  const token=candidate.tokens[0][0],funds={tokens:[{address:token,symbol:'TOKEN',allowance:MAX_TOKEN_ALLOWANCE}]};
  const recover=vi.fn(async()=>({privateAccountingVerified:true,fundingOutcome:'verified'}));
  const cap={reconcilePendingSharedTokenApproval:vi.fn(async()=>null as {privateAccountingVerified:boolean}|null),readSharedTokenFunding:vi.fn(async()=>funds),prepareSharedPoolAllowanceCleanup:vi.fn(async()=>({})),submitSharedPoolApproval:vi.fn(async()=>({recover}))};
  const session={walletAddress:'0x1111111111111111111111111111111111111111',chainId:7082400,browserWalletId:'test',browserProvider:{},sessionOnboardInfo:{['0x1111111111111111111111111111111111111111']:{aesKey:'fixture-only'}},actions:{getCurrentDexSubmissionCapability:vi.fn(async()=>cap)}} as unknown as SharedWalletSession;
  const close=vi.fn(),render=()=>{hooks.index=0;return TokenApprovalsDialog({session,onClose:close});};
  const button=(label:string)=>nodes(render().props.details).find(node=>node.type==='button'&&text(node.props.children)===label)!;
  const check=async()=>{button('Check approvals').props.onClick!();await vi.waitFor(()=>expect(text(render().props.details)).toContain('Unlimited'));};
  return{session,cap,recover,render,button,check,close};
}
it('does not read or send until requested and reviews one token/spender before revocation',async()=>{
  const f=fixture();f.render();expect(f.cap.readSharedTokenFunding).not.toHaveBeenCalled();expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
  await f.check();f.button('Revoke TOKEN').props.onClick!();
  expect(f.render().props.confirmation?.message).toContain(candidate.core);
  expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
  f.render().props.onConfirm();await vi.waitFor(()=>expect(f.recover).toHaveBeenCalledOnce());
  expect(f.cap.submitSharedPoolApproval).toHaveBeenCalledOnce();
});
it('shows only Close while nothing is selected, and Cancel with Revoke after a selection',async()=>{
  const f=fixture();
  expect(f.render().props.confirmation).toMatchObject({primaryLabel:'Close',secondaryLabel:null});
  await f.check();f.button('Revoke TOKEN').props.onClick!();
  const selected=f.render().props.confirmation!;expect(selected.primaryLabel).toBe('Revoke selected approval');expect(selected.secondaryLabel).toBeUndefined();
  f.render().props.onCancel();expect(f.close).not.toHaveBeenCalled();expect(f.render().props.confirmation).toMatchObject({primaryLabel:'Close',secondaryLabel:null});
});
it('uses the App button style for the actions inside the window',async()=>{
  const f=fixture();expect((f.button('Check approvals').props as {className?:string}).className).toBe('connect-btn');
  await f.check();expect((f.button('Revoke TOKEN').props as {className?:string}).className).toBe('connect-btn');
});
it('holds revocation when the capability reports an active operation',async()=>{
  const f=fixture();await f.check();f.cap.prepareSharedPoolAllowanceCleanup.mockRejectedValue(new Error('Active swap'));
  f.button('Revoke TOKEN').props.onClick!();f.render().props.onConfirm();
  await vi.waitFor(()=>expect(f.cap.prepareSharedPoolAllowanceCleanup).toHaveBeenCalledOnce());
  expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
});
it('keeps a sent revocation for reconciliation without another send',async()=>{
  const f=fixture();await f.check();f.recover.mockRejectedValueOnce(new Error('Receipt unavailable'));
  f.button('Revoke TOKEN').props.onClick!();const review=f.render();review.props.onConfirm();review.props.onConfirm();
  await vi.waitFor(()=>expect(f.render().props.confirmation?.message).toContain('Receipt unavailable'));
  f.button('Check submitted revocation').props.onClick!();await vi.waitFor(()=>expect(f.recover).toHaveBeenCalledTimes(2));
  expect(f.cap.submitSharedPoolApproval).toHaveBeenCalledOnce();
});
it('hides private values and the selected revocation after a privacy-session change',async()=>{
  const f=fixture();await f.check();f.button('Revoke TOKEN').props.onClick!();
  f.session.sessionOnboardInfo={};const next=f.render();
  expect(text(next.props.details)).not.toContain('Unlimited');expect(next.props.confirmation?.summaryRows).toEqual([]);
  expect(hooks.values.some(value => value && typeof value === 'object' && (Object.prototype.hasOwnProperty.call(value, 'values') || Object.prototype.hasOwnProperty.call(value, 'row')))).toBe(false);
  expect(hooks.values.some(value => value && typeof value === 'object' && 'current' in value && (value as {current?:{cap?:unknown}}).current?.cap)).toBe(false);
  next.props.onConfirm();expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
});
it('defaults each token/spender scope to exact and states the unlimited permission',()=>{
  let [mode,setMode]=useTokenApprovalMode('owner:chain:token:spender');expect(mode).toBe('exact');setMode('unlimited');
  hooks.index=0;[mode,setMode]=useTokenApprovalMode('owner:chain:token:spender');expect(mode).toBe('unlimited');
  const choice=TokenApprovalChoice({token:'TOKEN',spender:candidate.core,value:mode,onChange:setMode});
  expect(text(choice)).toContain('future spending');expect(text(choice)).toContain('visible on-chain');
  hooks.index=0;expect(useTokenApprovalMode('owner:chain:other-token:spender')[0]).toBe('exact');
});

it('uses a compact keyboard-accessible switch for the explicit unlimited choice',()=>{
  const change=vi.fn();
  const choice=TokenApprovalChoice({token:'BCN',spender:candidate.core,value:'exact',onChange:change});
  const toggle=nodes(choice).find(node=>node.type==='button')!;
  expect(toggle.props).toMatchObject({role:'switch','aria-checked':false,'aria-label':'Unlimited BCN approval'});
  toggle.props.onClick!();expect(change).toHaveBeenCalledWith('unlimited');
  const selected=TokenApprovalChoice({token:'BCN',spender:candidate.core,value:'unlimited',onChange:change,disabled:true});
  expect(nodes(selected).find(node=>node.type==='button')!.props).toMatchObject({'aria-checked':true,disabled:true});
  expect(nodes(choice).some(node=>node.type==='select')).toBe(false);
});

it('reads the switch choice after an async confirmation without a stale render value',async()=>{
  const [initial,change,read]=useTokenApprovalMode('owner:token:spender');
  expect(initial).toBe('exact');
  await Promise.resolve().then(()=>change('unlimited'));expect(read()).toBe('unlimited');
});

it('checks durable approval recovery after reload before it enables revocation',async()=>{
  const f=fixture();f.cap.reconcilePendingSharedTokenApproval.mockResolvedValue({privateAccountingVerified:false});
  f.button('Check approvals').props.onClick!();await vi.waitFor(()=>expect(f.render().props.confirmation?.message).toContain('Do not resend'));
  expect(f.cap.readSharedTokenFunding).not.toHaveBeenCalled();expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
  f.cap.reconcilePendingSharedTokenApproval.mockResolvedValue({privateAccountingVerified:true});
  await f.check();expect(f.render().props.confirmation?.message).toContain('original reviewed amount is unavailable');
});

it('hides cached approvals on key mismatch and allows closing while the durable journal remains',async()=>{
  const f=fixture();await f.check();f.session.walletAesHealthByAddress={[f.session.walletAddress]:{status:'key-mismatch'} as never};
  expect(text(f.render().props.details)).not.toContain('Unlimited');f.render().props.onCancel();expect(f.close).toHaveBeenCalledOnce();
  expect(f.cap.submitSharedPoolApproval).not.toHaveBeenCalled();
});
