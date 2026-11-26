import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import CurrentPoolPositionsWorkspace,{currentPoolWithdrawalFraction} from './CurrentPoolPositionsWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';
import CurrentPreparedPoolTopUpWorkspace from './CurrentPreparedPoolTopUpWorkspace';
import * as walletDiagnostics from '../../../lib/mobileWalletDiagnostics';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../../lib/dexV2Deployment';
import { CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY } from '../../../lib/currentDexC1SwapPolicy';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
const hooks=vi.hoisted(()=>({enabled:false,index:0,refIndex:0,states:[]as unknown[],refs:[]as {current:unknown}[]}));
// Retained owner-action coverage belongs to the archived admitted profile.
vi.mock('../../../lib/dexV2Deployment',async original=>{const actual=await original<typeof import('../../../lib/dexV2Deployment')>();
  return {...actual,CURRENT_CHEAP_DEX_CANDIDATE:actual.ARCHIVED_CHEAP_DEX_CANDIDATE,
    resolveCurrentCheapDexCandidate:(key:Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0])=>key==='cheap-current'?actual.ARCHIVED_CHEAP_DEX_CANDIDATE:actual.resolveCurrentCheapDexCandidate(key)};});
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return{...actual,
  useEffect:(...args:Parameters<typeof actual.useEffect>)=>{if(!hooks.enabled)return actual.useEffect(...args);},
  useState:(initial:unknown)=>{if(!hooks.enabled)return actual.useState(initial);const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{if(!hooks.enabled)return actual.useRef(initial);const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}};});
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:async()=>true,resolveConfirmation:()=>{}})}));
afterEach(()=>{hooks.enabled=false;hooks.states=[];hooks.refs=[];vi.restoreAllMocks();vi.unstubAllGlobals();});
const elements=(node:ReactNode):ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>void}>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<{children?:ReactNode}>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
describe('current liquidity NFT controls',()=>{
  it('shows the owner review for the exact held preview without loading a position',async()=>{
    hooks.enabled=true;
    const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE,owner='0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
    const saved=JSON.stringify({version:1,chainId:c.chainId,owner,core:c.core,graph:`0x${c.graph}`,
      phase:'pool-preview',callHash:'0x7d97428b902a35aac58e004dc55f6e436d008001883e547dbfc10f8ed19456c0',nonce:508,txHash:null});
    const records=new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY,saved]]);
    vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>records.get(key)??null,
      setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)}});
    const releaseReviewedPoolPreview=vi.fn(async(confirm:()=>Promise<boolean>)=>{
      if(!await confirm())return false;
      records.delete(CURRENT_DEX_PENDING_ATTEMPT_KEY);
      return true;
    });
    const getPositions=vi.fn();
    const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},
      sessionOnboardInfo:{[owner]:{aesKey:'synthetic-only'}},walletAesHealthByAddress:{[owner]:{status:'ready-unverified',updatedAt:0,walletKey:owner}},
      actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:async()=>({releaseReviewedPoolPreview})}
    } as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session,candidateKey:'cheap-history'});};
    const review=elements(render()).find(x=>x.type==='button'&&text(x.props.children)==='Review unsent preview');
    expect(review?.props.disabled).toBe(false);
    expect(releaseReviewedPoolPreview).not.toHaveBeenCalled();
    review!.props.onClick!();
    await vi.waitFor(()=>expect(text(render())).toContain('Failed preview released.'));
    expect(getPositions).not.toHaveBeenCalled();
    expect(releaseReviewedPoolPreview).toHaveBeenCalledOnce();
    expect(text(render())).not.toContain('Review unsent preview');
  });
  it('directs a saved Pool preview to its funding form instead of position recovery',()=>{
    const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE,owner=`0x${'22'.repeat(20)}`;
    const saved=JSON.stringify({version:1,chainId:c.chainId,owner,core:c.core,graph:`0x${c.graph}`,
      phase:'pool-preview',callHash:`0x${'88'.repeat(32)}`,nonce:508,txHash:null});
    const records=new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY,saved]]);
    vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>records.get(key)??null,
      setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)}});
    const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},
      actions:{getCurrentDexPoolPositionCapability:vi.fn(),getCurrentDexSubmissionCapability:vi.fn()}} as unknown as SharedWalletSession;
    const html=renderToStaticMarkup(<CurrentPoolPositionsWorkspace sharedWalletSession={session} candidateKey="cheap-history"/>);
    expect(html).toContain('For a top-up, select its position and open Add liquidity.');
    expect(html).not.toContain('Check position status');
    expect(records.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
  });
  // The snapshot recovery check is admitted for the selected graph (CW-089): its snapshot path is the same contract code
  // as on graph 7bed. The 7bed cases stay in CurrentPoolPositionsSnapshotRecovery.test.tsx.
  it.each(['success','error','missing-latest','other-hold'] as const)('checks the old saved hash with the current discovered snapshot: %s',async fault=>{
    hooks.enabled=true;
    const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE,owner=`0x${'22'.repeat(20)}`,oldHash=`0x${'66'.repeat(32)}`,latestHash=`0x${'77'.repeat(32)}`;
    const saved=JSON.stringify({version:1,chainId:c.chainId,owner,core:c.core,graph:`0x${c.graph}`,phase:'pool-snapshot',
      callHash:`0x${'88'.repeat(32)}`,nonce:439,txHash:oldHash,verificationBlocked:true,verificationFailure:'snapshot-financial-state'});
    const records=new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY,saved]]);
    vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)}});
    const result={action:'snapshot-recovery',status:'superseded-snapshot-recovery-only',positionId:53n,transactionHash:oldHash,latestSnapshotHash:latestHash};
    const verifySupersededPlainSnapshot=vi.fn(async()=>{if(fault==='error')throw new Error('Replacement snapshot proof changed');return result;});
    const verifyPlainSnapshot=vi.fn(async()=>{throw new Error('Old owner envelopes were replaced');});
    const recoverPendingPoolPositionAttempt=vi.fn(async verify=>{const value=await verify(53n,oldHash);
      if(fault!=='other-hold')records.delete(CURRENT_DEX_PENDING_ATTEMPT_KEY);return value;});
    const getPositions=vi.fn(async()=>({verifySupersededPlainSnapshot,verifyPlainSnapshot}));
    const getSender=vi.fn(async()=>({recoverPendingPoolPositionAttempt}));
    const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},
      sessionOnboardInfo:{[owner]:{aesKey:'synthetic-only'}},walletAesHealthByAddress:{[owner]:{status:'ready-unverified',updatedAt:0,walletKey:owner}},
      actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}}as unknown as SharedWalletSession;
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session,candidateKey:'cheap-history'});};
    render();hooks.states[0]='53';hooks.states[10]=latestHash;hooks.states[11]=latestHash;
    if(fault!=='missing-latest')hooks.states[8]={scope:hooks.refs[1].current,value:{positionId:53n,status:1n,context:'current',
      poolTokens:c.pairs[0].tokens,producerHash:latestHash,amounts:{classId:1n,amount0:100n,amount1:200n,shares:10n},block:{number:10n,hash:latestHash}}};
    elements(render()).find(x=>x.type==='button'&&text(x.props.children)==='Check position status')!.props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(hooks.states[10]).toBe(oldHash);
    if(fault==='missing-latest'){
      expect(verifySupersededPlainSnapshot).not.toHaveBeenCalled();expect(verifyPlainSnapshot).toHaveBeenCalledWith(53n,oldHash);
    }else expect(verifySupersededPlainSnapshot).toHaveBeenCalledWith(53n,oldHash,latestHash);
    if(fault==='success'||fault==='other-hold'){
      expect(hooks.states[8]).toBe(null);expect(hooks.states[6]).toBe(fault==='other-hold');
      expect(text(render())).toContain(fault==='other-hold'?'Another saved hold remains':'No prior amounts or accounting were reconstructed');
    }else{
      expect(records.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);expect(hooks.states[6]).toBe(true);
      expect(text(render())).toContain(fault==='error'?'Replacement snapshot proof changed':'Old owner envelopes were replaced');
    }
  });
  it.each(['health','onboarding'] as const)('invalidates a private claim on %s reference replacement without clearing the selected ID',async changed=>{
    hooks.enabled=true;
    const diagnostic=vi.spyOn(walletDiagnostics,'logMobileWalletDiagnostic').mockImplementation(()=>{});
    const c=STAGED_SHARED_HISTORY_DEX_CANDIDATE,owner=`0x${'22'.repeat(20)}`,hash=`0x${'44'.repeat(32)}`;
    const readPosition=vi.fn(async()=>({positionId:53n,status:1n,context:'synthetic-owner-context',producerHash:hash,
      poolTokens:c.pairs[0].tokens,block:{number:10n,hash},amounts:{classId:3n,amount0:100n,amount1:200n,shares:10n}}));
    const getPositions=vi.fn(async()=>({readPosition})),getSender=vi.fn();
    let session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn()},
      sessionOnboardInfo:{[owner]:{aesKey:'synthetic-only'}},walletAesHealthByAddress:{[owner]:{status:'ready-unverified',updatedAt:0,walletKey:owner}},
      actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}} as unknown as SharedWalletSession;
    let inverted=false;const labels=c.pairs[0].tokens.map(address=>readCurrentDexDisplay(c).tokens.find(t=>t.address===address)!.label) as [string,string];
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace({sharedWalletSession:session,candidateKey:'cheap-history',selectedPair:labels,priceDisplayInverted:inverted});};
    const list=(tree:ReactNode)=>elements(tree).find(x=>x.type===CurrentOwnedPoolPositions) as ReactElement<{onSelect:(id:bigint)=>void;selectedId:string}>;
    list(render()).props.onSelect(53n);
    await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    const before=render();
    expect(text(before)).toContain(`2.0 ${labels[1]}/${labels[0]}`);inverted=true;
    expect(text(render())).toContain(`0.5 ${labels[0]}/${labels[1]}`);expect(readPosition).toHaveBeenCalledOnce();
    expect(list(before).props.selectedId).toBe('53');
    expect(elements(before).some(x=>x.type===CurrentPreparedPoolTopUpWorkspace)).toBe(true);
    session=changed==='health'?{...session,walletAesHealthByAddress:{[owner]:{status:'ready',updatedAt:1,walletKey:owner}}}
      :{...session,sessionOnboardInfo:{...session.sessionOnboardInfo}};
    const after=render();
    expect(list(after).props.selectedId).toBe('53');
    expect(text(after)).not.toContain('Select a position to see its details.');
    expect(elements(after).some(x=>x.type===CurrentPreparedPoolTopUpWorkspace)).toBe(false);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith('pool-position-scope-invalidated',{
      phase:'render',fields:[changed==='health'?'health':'onboard'],selected:true});
    expect(readPosition).toHaveBeenCalledTimes(1);expect(getSender).not.toHaveBeenCalled();
  });
  it('shows separate position regions and an empty selection without private values',()=>{
    const html=renderToStaticMarkup(<CurrentPoolPositionsWorkspace/>);
    expect(html).toContain('aria-label="Position list"');expect(html).toContain('aria-label="Position details"');
    expect(html).toContain('Select a position to see its details.');expect(html).not.toContain('Private shares');
  });
  it('keeps saved recovery open in the position detail',()=>{
    vi.stubGlobal('window',{sessionStorage:{getItem:()=> 'invalid'}});
    const html=renderToStaticMarkup(<CurrentPoolPositionsWorkspace/>);expect(html.indexOf('aria-label="Position details"')).toBeLessThan(html.indexOf('Status and recovery'));expect(html).toMatch(/<details class="dex-owner-footer" open=""/);vi.unstubAllGlobals();
  });
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
