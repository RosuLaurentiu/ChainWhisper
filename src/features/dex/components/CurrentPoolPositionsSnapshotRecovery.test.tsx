import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../../lib/dexV2Deployment';
import { STAGED_LIMIT_INPUT_DEX_CANDIDATE } from '../../../lib/currentDexLimitInputCandidate';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
// The App selects the gap graph; this file keeps the same checks for the earlier admitted graph 7bed.
// Evidence: APP/reports/pool-snapshot-verification-2026-11-14.
vi.mock('../../../lib/selectedCurrentDexCandidate',async original=>{const actual=await original<typeof import('../../../lib/selectedCurrentDexCandidate')>();
  const current=await import('../../../lib/currentDexLimitInputCandidate');return{...actual,STAGED_SHARED_HISTORY_DEX_CANDIDATE:current.STAGED_LIMIT_INPUT_DEX_CANDIDATE};});
const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[]as unknown[],refs:[]as {current:unknown}[]}));
// Position effects only write wallet diagnostics; these tests do not check them.
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return{...actual,useEffect:()=>{},
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}};});
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:async()=>true,resolveConfirmation:()=>{}})}));
afterEach(()=>{hooks.states=[];hooks.refs=[];vi.restoreAllMocks();vi.unstubAllGlobals();});
const elements=(node:ReactNode):ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>void}>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<{children?:ReactNode}>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
describe('retained 7bed graph snapshot recovery (saved hold of 14 November)',()=>{
  it('selects the 7bed graph for this module graph',()=>{expect(STAGED_SHARED_HISTORY_DEX_CANDIDATE).toBe(STAGED_LIMIT_INPUT_DEX_CANDIDATE);});
  it.each(['success','error','missing-latest','other-hold'] as const)('checks the old saved hash with the current discovered snapshot: %s',async fault=>{
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
});
