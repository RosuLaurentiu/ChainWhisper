import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';
// Historical position fallback awaits the retained native recovery method.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.resolveCurrentCheapDexCandidate('cheap-native') };
});
const hooks = vi.hoisted(() => ({ index:0, refIndex:0, states:[] as unknown[], refs:[] as {current:unknown}[] }));
vi.mock('react', async original => ({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:async()=>false,resolveConfirmation:()=>{}})}));
type Props={children?:ReactNode;onClick?:()=>void;disabled?:boolean;role?:string};
const nodes=(node:ReactNode):ReactElement<Props>[]=>Array.isArray(node)?node.flatMap(nodes):isValidElement<Props>(node)?[node,...nodes(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<Props>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
type Operation='limit-create'|'limit-status'|'limit-snapshot'|'position-issuer'|'position-fallback';
const changes=['owner','provider','onboard','health'] as const;
const owner=`0x${'22'.repeat(20)}`;
function fixture(operation:Operation, Positions=CurrentPoolPositionsWorkspace, publicFallback=false){
  const store=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value),removeItem:(key:string)=>store.delete(key)}});
  const isPosition=operation.startsWith('position');
  const metadata=vi.fn(async()=>null), privateRead=vi.fn(async()=>null), writes=vi.fn(async()=>{throw new Error('Unexpected send');});
  const sender={checkCurrentCheapCandidate:vi.fn(async()=>({...c,owner:session.walletAddress})),recoverPendingLimitAttempt:metadata,
    recoverCurrentNativePoolPositionResult:privateRead,recoverPendingPoolPositionAttempt:metadata,submitLimit:writes,submitLimitOwner:writes,submitPoolPositionAction:writes};
  const capability={prepareLimit:vi.fn(async()=>null)};
  const getSender=vi.fn(async()=>sender),prepareSnapshot=vi.fn(async()=>null);
  const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn(async()=>({number:'0x1',hash:`0x${'11'.repeat(32)}`}))},
    browserWalletId:'metamask',activeSignerSource:'browser',sessionOnboardInfo:{[owner]:{aesKey:'fixture-only'}},walletAesHealthByAddress:{},
    actions:{getCurrentDexSubmissionCapability:getSender,getCurrentDexLimitCapability:vi.fn(async()=>capability),getCurrentDexPoolPositionCapability:vi.fn()}} as unknown as SharedWalletSession;
  const render=()=>{hooks.index=0;hooks.refIndex=0;return isPosition?Positions({sharedWalletSession:session,...(!publicFallback?{candidateKey:'cheap-native' as const}:{})}):CurrentLimitWorkspace({sharedWalletSession:session});};
  render();if(!isPosition){hooks.states[1]='10';hooks.states[2]='1';render();}
  if(operation==='limit-snapshot'){hooks.states[8]={value:{positionId:9n,prepareSnapshot},scope:hooks.refs[0].current};render();}
  const label=operation==='limit-create'?'Review order':operation==='limit-snapshot'?'Refresh private Limit result':isPosition?'Check position status':'Check Limit status';
  const button=()=>nodes(render()).find(node=>node.type==='button'&&text(node.props.children)===label)!;
  const status=()=>text(nodes(render()).find(node=>node.props.role==='status')?.props.children);
  const idle=()=>vi.waitFor(()=>expect(hooks.states[isPosition?5:4]).toBe(false));
  let finish:()=>void=()=>{};
  const startDelayed=async()=>{
    if(operation==='position-fallback'){(publicFallback?metadata:privateRead).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(null);}));}
    else if(operation==='limit-snapshot'){prepareSnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(null);}));}
    else getSender.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(sender);}));
    button().props.onClick!();await vi.waitFor(()=>expect(operation==='position-fallback'?(publicFallback?metadata:privateRead):operation==='limit-snapshot'?prepareSnapshot:getSender).toHaveBeenCalledOnce());
  };
  const change=(kind:typeof changes[number])=>{
    if(kind==='owner')session.walletAddress=`0x${'33'.repeat(20)}`;
    if(kind==='provider')session.browserProvider={request:vi.fn()} as never;
    if(kind==='onboard')session.sessionOnboardInfo={...session.sessionOnboardInfo};
    if(kind==='health')session.walletAesHealthByAddress={};render();
  };
  return{sender,getSender,metadata,privateRead,prepareSnapshot,capability,writes,store,button,status,idle,startDelayed,change,finish:()=>finish()};
}
afterEach(()=>{hooks.states=[];hooks.refs=[];vi.unstubAllGlobals();});
for(const operation of ['limit-create','limit-status','limit-snapshot','position-issuer','position-fallback'] as const)describe(`retained native ${operation}`,()=>{
  it.each(changes)('stops at the awaited boundary after %s changes',async kind=>{
    const f=fixture(operation);await f.startDelayed();f.change(kind);f.finish();await f.idle();
    expect(f.metadata).not.toHaveBeenCalled();expect(f.sender.checkCurrentCheapCandidate).not.toHaveBeenCalled();
    if(operation==='position-issuer')expect(f.privateRead).not.toHaveBeenCalled();
    if(operation==='limit-snapshot')expect(f.getSender).not.toHaveBeenCalled();
    expect(f.status()).toMatch(/session changed|Refresh this position/);expect(f.writes).not.toHaveBeenCalled();expect(f.store.size).toBe(0);
  });
  it('keeps the unchanged-session completion path',async()=>{
    const f=fixture(operation);await f.startDelayed();f.finish();await f.idle();expect(f.writes).not.toHaveBeenCalled();
    if(operation==='limit-create')expect(f.sender.checkCurrentCheapCandidate).toHaveBeenCalledOnce();
    else if(operation==='limit-snapshot'){expect(f.status()).toContain('cancelled');expect(f.getSender).not.toHaveBeenCalled();}
    else{expect(f.metadata).toHaveBeenCalledOnce();expect(f.status()).toContain('No pending');}
  });
});

it.each(changes)('actual current position public fallback stops after %s changes',async kind=>{
  vi.doMock('../../../lib/dexV2Deployment',()=>vi.importActual('../../../lib/dexV2Deployment'));vi.resetModules();
  const {default:Positions}=await import('./CurrentPoolPositionsWorkspace');
  const f=fixture('position-fallback',Positions,true);await f.startDelayed();f.change(kind);f.finish();await f.idle();
  expect(f.metadata).toHaveBeenCalledOnce();expect(f.privateRead).not.toHaveBeenCalled();
  expect(f.getSender).toHaveBeenCalledWith(BigInt(c.chainId),undefined);
  expect(f.status()).toMatch(/session changed|Refresh this position/);expect(f.writes).not.toHaveBeenCalled();expect(f.store.size).toBe(0);
});
