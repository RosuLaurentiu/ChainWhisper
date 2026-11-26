import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
const hooks = vi.hoisted(() => ({ index:0, refIndex:0, states:[] as unknown[], refs:[] as {current:unknown}[] }));
vi.mock('react', async original => ({...await original<typeof import('react')>(),
  useEffect:vi.fn(),
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
    recoverCurrentNativePoolPositionResult:privateRead,recoverCurrentPreparedPoolPositionResult:privateRead,recoverPendingPoolPositionAttempt:metadata,submitLimit:writes,submitLimitOwner:writes,submitPoolPositionAction:writes};
  const capability={prepareLimit:vi.fn(async()=>null)};
  const getSender=vi.fn(async()=>sender),prepareSnapshot=vi.fn(async()=>null);
  const session={walletAddress:owner,chainId:Number(c.chainId),browserProvider:{request:vi.fn(async()=>({number:'0x1',hash:`0x${'11'.repeat(32)}`}))},
    browserWalletId:'metamask',activeSignerSource:'browser',sessionOnboardInfo:{[owner]:{aesKey:'fixture-only'}},walletAesHealthByAddress:{},
    actions:{getCurrentDexSubmissionCapability:getSender,getCurrentDexLimitCapability:vi.fn(async()=>capability),getCurrentDexPoolPositionCapability:vi.fn()}} as unknown as SharedWalletSession;
  const render=()=>{hooks.index=0;hooks.refIndex=0;return isPosition?Positions({sharedWalletSession:session,...(!publicFallback?{candidateKey:'cheap-history' as const}:{})}):CurrentLimitWorkspace({sharedWalletSession:session,selectedPair:['HBR','BCN']});};
  render();if(!isPosition){hooks.states[1]='10';hooks.states[2]='1';render();}
  // Limit states after index 3 and refs moved by one for the approval-mode hook; busy is state 5 in both panels.
  if(operation==='limit-snapshot'){hooks.states[9]={value:{positionId:9n,prepareSnapshot},scope:hooks.refs[1].current};render();}
  const label=operation==='limit-create'?'Review order':operation==='limit-snapshot'?'Refresh private Limit result':isPosition?'Check position status':'Check Limit status';
  const button=()=>nodes(render()).find(node=>node.type==='button'&&text(node.props.children)===label)!;
  const status=()=>text(nodes(render()).find(node=>node.props.role==='status')?.props.children);
  const idle=()=>vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
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
it.each(['RPC stopped','Prepared snapshot changed financial state.'])('does not hide a retained recovery error or continue reads: %s',async message=>{
  const f=fixture('position-issuer'),recover=vi.fn(async()=>{throw new Error(message);});
  hooks.states[9]={recover,scope:hooks.refs[1].current,snapshot:true};
  await f.button().props.onClick!();await f.idle();
  expect(f.status()).toBe(message);expect(f.getSender).not.toHaveBeenCalled();expect(f.metadata).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
});
it.each(['snapshot','top-up'] as const)('shows a mined %s hold with no signing authority',async kind=>{
  const f=fixture('position-issuer');
  f.metadata.mockResolvedValue({status:'observed-mined-verification-held',transactionHash:`0x${'77'.repeat(32)}`,...(kind==='snapshot'?{verificationFailure:'snapshot-financial-state'}:{poolTopUpHash:`0x${'88'.repeat(32)}`}),privateAccountingVerified:false,readyToSign:false} as never);
  await f.button().props.onClick!();await f.idle();
  expect(f.status()).toContain('mined');expect(f.status()).toContain(kind==='snapshot'?'Prepared snapshot changed financial state.':'Final top-up accounting has not completed.');expect(f.status()).toContain('Do not resend');expect(hooks.states[6]).toBe(true);expect(f.writes).not.toHaveBeenCalled();
});
it('inspects an already-held snapshot without invoking its retained private recovery',async()=>{
  const f=fixture('position-issuer'),recover=vi.fn(async()=>{throw new Error('Known Pool verification failure.');});
  hooks.states[9]={recover,scope:hooks.refs[1].current,snapshot:true};
  const saved=JSON.stringify({version:1,chainId:c.chainId,owner,core:c.core.toLowerCase(),graph:`0x${c.graph}`,phase:'pool-snapshot',nonce:394,txHash:`0x${'77'.repeat(32)}`,callHash:`0x${'88'.repeat(32)}`,verificationBlocked:true});
  f.store.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,saved);
  f.metadata.mockResolvedValue({status:'observed-mined-verification-held',transactionHash:`0x${'77'.repeat(32)}`,privateAccountingVerified:false,readyToSign:false} as never);
  await f.button().props.onClick!();await f.idle();
  expect(recover).not.toHaveBeenCalled();expect(f.privateRead).not.toHaveBeenCalled();expect(f.metadata).toHaveBeenCalledOnce();
  expect(f.status()).toContain('mined');expect(f.status()).toContain('original verification reason was not retained');
  expect(f.store.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);expect(hooks.states[6]).toBe(true);expect(f.writes).not.toHaveBeenCalled();
});
for(const operation of ['limit-create','limit-status','limit-snapshot','position-issuer','position-fallback'] as const)describe(`retained current ${operation}`,()=>{
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
