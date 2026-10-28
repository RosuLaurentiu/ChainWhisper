import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement,type ReactElement,type ReactNode } from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import CurrentLimitWorkspace,{currentLimitIntent} from './CurrentLimitWorkspace';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c,resolveCurrentCheapDexCandidate } from '../../../lib/dexV2Deployment';
import CurrentOwnedLimits from './CurrentOwnedLimits';
const hooks=vi.hoisted(()=>({enabled:false,index:0,refIndex:0,states:[]as unknown[],refs:[]as {current:unknown}[]}));
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return{...actual,
  useState:(initial:unknown)=>{if(!hooks.enabled)return actual.useState(initial);const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{if(!hooks.enabled)return actual.useRef(initial);const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}};});
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:async()=>true,resolveConfirmation:()=>{}})}));
beforeEach(()=>{
  const values=new Map<string,string>();
  const sessionStorage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),
    removeItem:(key:string)=>values.delete(key),clear:()=>values.clear(),key:(index:number)=>[...values.keys()][index]??null,get length(){return values.size;}};
  vi.stubGlobal('window',{sessionStorage});
});
afterEach(()=>{hooks.enabled=false;hooks.states=[];hooks.refs=[];vi.unstubAllGlobals();});
const elements=(node:ReactNode):ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>void}>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<{children?:ReactNode}>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
function ownerView(candidateKey:'cheap-current'|'cheap-history'='cheap-current',owner=`0x${'22'.repeat(20)}`,view:'create'|'manage'='manage'){
  hooks.states=[];hooks.refs=[];hooks.index=0;hooks.refIndex=0;
  hooks.enabled=true;const active=resolveCurrentCheapDexCandidate(candidateKey),result={positionId:9n,context:'context',status:0n,closed:false,refreshRequired:false,amounts:{unspent:100n,proceeds:7n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}},capability={prepareOwnerAction:vi.fn(async()=>({data:'call'}))},recover=vi.fn(async()=>({...result,amounts:null,values:null,refreshRequired:true})),sender={submitLimitOwner:vi.fn(async()=>({transactionHash:'hash',recover})),recoverPendingLimitAttempt:vi.fn(async()=>null),checkCurrentCheapCandidate:vi.fn(async()=>({graph:active.graph,core:active.core,owner})),prepareSharedLimitApproval:vi.fn(async()=>null)};
  const limitCapability={...capability,prepareLimit:vi.fn(async()=>null),prepareFundingReview:vi.fn(async()=>({funding:true}))};
  const session={walletAddress:owner,chainId:Number(active.chainId),browserProvider:{request:vi.fn(async()=>({number:'0x1',hash:`0x${'11'.repeat(32)}`}))},sessionOnboardInfo:{[owner]:{aesKey:'session-only'}},walletAesHealthByAddress:{},actions:{getCurrentDexLimitCapability:vi.fn(async()=>limitCapability),getCurrentDexSubmissionCapability:vi.fn(async()=>sender)}}as unknown as SharedWalletSession;
  const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentLimitWorkspace({sharedWalletSession:session,view,candidateKey,...(candidateKey==='cheap-history'?{selectedPair:['HBR','BCN']as[string,string]}:{})});};render();hooks.states[10]='9';render();hooks.states[11]={value:result,capability:limitCapability,scope:hooks.refs[0].current};
  const button=(name:string)=>elements(render()).find(x=>x.type==='button'&&text(x.props.children)===name)!;
  return{session,render,button,capability:limitCapability,recover,sender,result};
}
describe('current exact Limit form',()=>{
  it.each(['Load private order','Pause Limit'])('keeps new %s behind the wallet hold before preparation or send',async label=>{
    const f=ownerView('cheap-history');f.button(label).props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.capability.prepareOwnerAction).not.toHaveBeenCalled();expect(f.session.actions!.getCurrentDexLimitCapability).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();expect(text(f.render())).toContain('Shared-history DEX App signing hold');
  });
  it('forwards the new deployment to My Orders and keeps manual lookup collapsed',()=>{
    hooks.enabled=true;hooks.index=0;hooks.refIndex=0;
    const tree=CurrentLimitWorkspace({candidateKey:'cheap-history',selectedPair:['HBR','BCN'],view:'manage'}),list=elements(tree).find(x=>x.type===CurrentOwnedLimits)as ReactElement<{candidateKey:string}>;
    expect(list.props.candidateKey).toBe('cheap-history');
    const lookup=elements(tree).find(x=>x.type==='details'&&text(x.props.children).includes('Manual order lookup'))as ReactElement<{open:boolean}>;
    expect(lookup.props.open).toBe(false);
  });
  it('uses exact atoms and price witness in both directions',()=>{
    for(const direction of [true,false])expect(currentLimitIntent(direction,'9007199254740993','0.3','1')).toEqual({sellToken0:direction,amount:9007199254740993n,terms:[3n,10n,1n,7n,2n]});
  });
  it('admits the engineering owner through create, allowance, refresh and top-up form guards',async()=>{
    const owner='0x8b749251cf1f712d4e39fd048c53394af03e10be';
    const create=ownerView('cheap-history',owner,'create');hooks.states[1]='1';hooks.states[2]='2';create.button('Review order').props.onClick!();await vi.waitFor(()=>expect(create.capability.prepareLimit).toHaveBeenCalledOnce());
    expect(create.sender.checkCurrentCheapCandidate).toHaveBeenCalledOnce();expect(create.capability.prepareLimit).toHaveBeenCalledOnce();
    create.button('Review exact order allowance').props.onClick!();await vi.waitFor(()=>expect(create.capability.prepareFundingReview).toHaveBeenCalledOnce());
    const manage=ownerView('cheap-history',owner);manage.button('Load private order').props.onClick!();await vi.waitFor(()=>expect(manage.capability.prepareOwnerAction).toHaveBeenCalledOnce());expect(manage.capability.prepareOwnerAction).toHaveBeenCalledWith(expect.objectContaining({action:'refresh'}));
    const topup=ownerView('cheap-history',owner);hooks.states[14]='1';topup.button('Review top-up').props.onClick!();await vi.waitFor(()=>expect(topup.capability.prepareOwnerAction).toHaveBeenCalledOnce());expect(topup.capability.prepareOwnerAction).toHaveBeenCalledWith(expect.objectContaining({action:'topup',topUpAmount:1_000_000n}));
  });
  it('rejects a held owner and an over-limit engineering budget before capability access',async()=>{
    const held=ownerView('cheap-history',`0x${'22'.repeat(20)}`,'create');hooks.states[1]='1';hooks.states[2]='2';held.button('Review order').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(held.session.actions!.getCurrentDexLimitCapability).not.toHaveBeenCalled();expect(held.sender.checkCurrentCheapCandidate).not.toHaveBeenCalled();
    const over=ownerView('cheap-history','0x8b749251cf1f712d4e39fd048c53394af03e10be','create');hooks.states[1]='1.000001';hooks.states[2]='2';over.button('Review order').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(over.session.actions!.getCurrentDexLimitCapability).not.toHaveBeenCalled();expect(over.sender.checkCurrentCheapCandidate).not.toHaveBeenCalled();
  });
  it.each(['0','1e3','-1','1.5',''])('rejects invalid offered budget %s',amount=>expect(()=>currentLimitIntent(true,amount,'1','0')).toThrow());
  it('does not enable a legacy writer without an owner session',()=>{const html=renderToStaticMarkup(<CurrentLimitWorkspace/>);expect(html).toContain('waits for a match at your private price');expect(html).toContain('Minimum fill');expect(html).toMatch(/disabled=""[^>]*>Review order/);expect(html).not.toContain('lot size');});
  it.each(['Claim Limit proceeds','Pause Limit'])('%s clears private amounts and requires explicit refresh',async label=>{
    const f=ownerView();expect(f.button(label).props.disabled).toBe(false);f.button(label).props.onClick!();expect(text(f.render())).toContain('Checking your order');await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.sender.submitLimitOwner).toHaveBeenCalledTimes(1);expect(text(f.render())).not.toContain('Unspent Test token 10.0000000000000001');f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.recover).toHaveBeenCalledTimes(1);expect(f.button('Claim Limit proceeds').props.disabled).toBe(true);expect(f.button('Load private order').props.disabled).toBeFalsy();expect(text(f.render())).toContain('Private amount authority is cleared');
  });
  it('hides authenticated amounts and actions on NFT selection change and permits Resume only from an authenticated paused snapshot',()=>{const f=ownerView();expect(text(f.render())).toContain('Unspent Test token 10.0000000000000001');expect(f.button('Resume Limit').props.disabled).toBe(true);f.result.status=1n;expect(f.button('Resume Limit').props.disabled).toBe(false);hooks.states[10]='10';expect(text(f.render())).not.toContain('Unspent Test token 10.0000000000000001');expect(f.button('Close Limit and return funds')).toBeUndefined();});
  it('shows verified closed amounts without enabling further owner actions',async()=>{const f=ownerView();f.recover.mockResolvedValue({...f.result,closed:true,refreshRequired:false,amounts:{...f.result.amounts,unspent:0n,proceeds:0n},values:null}as never);f.button('Close Limit and return funds').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(text(f.render())).toContain('closed owner tombstone verified');expect(f.button('Close Limit and return funds').props.disabled).toBe(true);});
  it('does not replace a known private accounting failure with public reload success',async()=>{const f=ownerView();f.recover.mockRejectedValue(new Error('Wrong private payout'));f.button('Claim Limit proceeds').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(f.sender.recoverPendingLimitAttempt).not.toHaveBeenCalled();expect(hooks.states[5]).toBe(true);expect(f.button('Load private order').props.disabled).toBe(true);expect(text(f.render())).toContain('Wrong private payout');});
  it.each([[true,false],[false,false],[true,true],[false,true]])('converts displayed amounts exactly with side %s and inversion %s before preparing a Limit',async(sellToken0,priceDisplayInverted)=>{
    hooks.enabled=true;const owner=`0x${'22'.repeat(20)}`,prepareLimit=vi.fn(async()=>null),submitLimit=vi.fn();
    const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn(async()=>({number:'0x1',hash:`0x${'11'.repeat(32)}`}))},actions:{getCurrentDexLimitCapability:vi.fn(async()=>({prepareLimit})),getCurrentDexSubmissionCapability:vi.fn(async()=>({checkCurrentCheapCandidate:async()=>({graph:c.graph,core:c.core,owner}),submitLimit}))}}as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentLimitWorkspace({sharedWalletSession:session,priceDisplayInverted});};render();hooks.states[0]=sellToken0;hooks.states[1]='1.25';hooks.states[2]='2';hooks.states[3]='0.1';
    const button=elements(render()).find(x=>x.type==='button'&&text(x.props.children)==='Review order')!;expect(button.props.disabled).toBe(false);button.props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(prepareLimit).toHaveBeenCalledWith(expect.objectContaining({intent:{sellToken0,amount:1250000000000000000n,terms:priceDisplayInverted?[1n,2n,100000000000000000n,1n,0n]:[2n,1n,100000000000000000n,1n,1n]}}));expect(submitLimit).not.toHaveBeenCalled();
  });
});
