import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import CurrentPoolPositionsWorkspace,{currentPoolWithdrawalFraction} from './CurrentPoolPositionsWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../../lib/dexV2Deployment';
import { CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY } from '../../../lib/currentDexC1SwapPolicy';
const hooks=vi.hoisted(()=>({enabled:false,index:0,refIndex:0,states:[]as unknown[],refs:[]as {current:unknown}[]}));
// Retained owner-action coverage belongs to the archived admitted profile.
vi.mock('../../../lib/dexV2Deployment',async original=>{const actual=await original<typeof import('../../../lib/dexV2Deployment')>();
  return {...actual,CURRENT_CHEAP_DEX_CANDIDATE:actual.ARCHIVED_CHEAP_DEX_CANDIDATE,
    resolveCurrentCheapDexCandidate:(key:Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0])=>key==='cheap-current'?actual.ARCHIVED_CHEAP_DEX_CANDIDATE:actual.resolveCurrentCheapDexCandidate(key)};});
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return{...actual,
  useState:(initial:unknown)=>{if(!hooks.enabled)return actual.useState(initial);const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{if(!hooks.enabled)return actual.useRef(initial);const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}};});
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:async()=>true,resolveConfirmation:()=>{}})}));
afterEach(()=>{hooks.enabled=false;hooks.states=[];hooks.refs=[];});
const elements=(node:ReactNode):ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>void}>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<{children?:ReactNode}>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
describe('current liquidity NFT controls',()=>{
  it('selects a discovered new-deployment position through the read path while sends remain held',async()=>{
    hooks.enabled=true;const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE;
    const readPosition=vi.fn(async()=>({positionId:43n,status:1n,context:'canonical-owner',amounts:null,marketId:c.pairs[0].marketId,poolTokens:c.pairs[0].tokens}));
    const getPositions=vi.fn(async()=>({readPosition})),getSender=vi.fn(),session={walletAddress:`0x${'22'.repeat(20)}`,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}}as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session,candidateKey:'cheap-history'});};
    const list=elements(render()).find(x=>x.type===CurrentOwnedPoolPositions)as ReactElement<{candidateKey:string;onSelect:(id:bigint)=>void}>;
    expect(list.props.candidateKey).toBe('cheap-history');list.props.onSelect(43n);
    expect(text(render())).toContain('Checking your position');
    await vi.waitFor(()=>expect(readPosition).toHaveBeenCalledWith(43n,undefined));
    expect(getPositions).toHaveBeenCalledWith(BigInt(c.chainId),{candidate:'cheap-history'});expect(getSender).not.toHaveBeenCalled();
    expect(text(render())).not.toContain('then enter its liquidity NFT ID');expect(text(render())).not.toContain('Use an owned claim NFT and its confirmed funding');
  });
  it('admits an engineering owner close for an authenticated prepared position',async()=>{
    hooks.enabled=true;const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE,positionId=52n,context='bound-engineering-owner-context';
    const prepareAction=vi.fn(async()=>null),getPositions=vi.fn(async()=>({prepareAction})),getSender=vi.fn();
    const session={walletAddress:CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},
      actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}}as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session,candidateKey:'cheap-history'});};
    render();hooks.states[0]=positionId.toString();hooks.states[8]={scope:hooks.refs[1].current,value:{positionId,context,status:1n,
      amounts:{classId:1n,amount0:500_000n,amount1:500_000n,shares:20n},poolTokens:c.pairs[0].tokens,block:{number:10n,hash:`0x${'44'.repeat(32)}`}}};
    const button=elements(render()).find(x=>x.type==='button'&&text(x.props.children)==='Close and withdraw all')!;
    expect(button.props.disabled).toBe(false);button.props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(getPositions).toHaveBeenCalledWith(BigInt(c.chainId),{candidate:'cheap-history'});
    expect(prepareAction).toHaveBeenCalledWith(expect.objectContaining({positionId,expectedContext:context,action:'close',minimums:[0n,0n]}));
    expect(getSender).not.toHaveBeenCalled();
  });
  it('keeps fractional percentages exact',()=>{expect(currentPoolWithdrawalFraction('50')).toEqual([1n,2n]);expect(currentPoolWithdrawalFraction('0.01')).toEqual([1n,10000n]);});
  it.each(['0','100','101','-1','1e1'])('rejects %s withdrawal percentage',value=>expect(()=>currentPoolWithdrawalFraction(value)).toThrow());
  it('requires an owner session and an authenticated position before showing payout actions',()=>{
    const html=renderToStaticMarkup(<CurrentPoolPositionsWorkspace/>);expect(html).toMatch(/disabled=""[^>]*>Load private position/);expect(html).toContain('Connect the owner wallet');
    expect(html).not.toContain('Close and withdraw all');expect(html).not.toContain('Transfer liquidity NFT');expect(html).not.toContain('Aggregate');
  });
  it.each(['Withdraw selected shares','Close and withdraw all'])('keeps both exact token payout floors for %s after loading the owner claim',async label=>{
    hooks.enabled=true;const prepareAction=vi.fn(async()=>null),submitPoolPositionAction=vi.fn();
    const value={positionId:9n,context:'bound-owner-context',status:1n,amounts:{classId:1n,amount0:1000000000000000000n,amount1:2000000000000000000n,shares:100n}};
    const getPositions=vi.fn(async()=>({readPosition:vi.fn(async()=>value),prepareAction}));
    const session={walletAddress:`0x${'22'.repeat(20)}`,chainId:Number(candidate.chainId),browserProvider:{request:vi.fn()},actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:vi.fn(async()=>({submitPoolPositionAction}))}}as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session});};
    const button=(name:string)=>elements(render()).find(x=>x.type==='button'&&text(x.props.children)===name)!;
    render();hooks.states[0]='9';button('Load private position').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(render())).toContain('Minimum payouts protect both tokens');expect(text(render())).toContain('EOA wallet');
    hooks.states[2]='0.125';hooks.states[3]='0.25';expect(button(label).props.disabled).toBe(false);button(label).props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(prepareAction).toHaveBeenCalledWith(expect.objectContaining({positionId:9n,expectedContext:'bound-owner-context',action:label==='Withdraw selected shares'?'withdraw':'close',fraction:label==='Withdraw selected shares'?[1n,2n]:undefined,minimums:[125000000000000000n,250000000000000000n]}));expect(submitPoolPositionAction).not.toHaveBeenCalled();
    hooks.states[0]='10';expect(elements(render()).find(x=>x.type==='button'&&text(x.props.children)===label)).toBeUndefined();
  });
});
