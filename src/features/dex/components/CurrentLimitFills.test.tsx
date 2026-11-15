import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,describe,expect,it,vi } from 'vitest';
import type { ComponentProps,EffectCallback,MutableRefObject,ReactElement } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import CurrentLimitFills from './CurrentLimitFills';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[]as unknown[],refs:[]as MutableRefObject<unknown>[],effects:[]as EffectCallback[]}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(v:unknown)=>{hooks.states[i]=typeof v==='function'?v(hooks.states[i]):v;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});},useEffect:(effect:EffectCallback)=>{hooks.effects.push(effect);}
}));
function fixture(){
  const owner=`0x${'22'.repeat(20)}`,pair=resolvePreparedDexScope('cheap-history').candidate.pairs[0];
  const fill={engine:pair.engine,record:35n,positionId:52n,blockNumber:10n,blockHash:`0x${'aa'.repeat(32)}`,timestamp:100n,soldToken:pair.tokens[0],receivedToken:pair.tokens[1],sold:100n,received:200n,readyToSign:false as const,nativeAdmission:false as const};
  const page={fills:[fill],head:{number:20n,hash:`0x${'bb'.repeat(32)}`,timestamp:200n},count:70n,nextBefore:38n,complete:false,readyToSign:false as const,nativeAdmission:false as const};
  const read=vi.fn(async()=>page),getLimit=vi.fn(async()=>({readFills:read}));
  const session={walletAddress:owner,chainId:7082400,browserProvider:{},browserWalletId:'metamask',activeSignerSource:'browser',sessionOnboardInfo:{[owner]:{aesKey:'test-only'}},walletAesHealthByAddress:{},actions:{getCurrentDexLimitCapability:getLimit}}as unknown as SharedWalletSession;
  const props:ComponentProps<typeof CurrentLimitFills>={session,candidateKey:'cheap-history',selectedPair:pair.tokens,positionId:52n,visible:true,refreshToken:'20:hash',baseToken:pair.tokens[0]};
  const tree=()=>{hooks.index=0;hooks.refIndex=0;hooks.effects=[];return CurrentLimitFills(props);};
  const render=()=>renderToStaticMarkup(tree());
  const effect=()=>hooks.effects[hooks.effects.length-1]!();
  const load=async()=>{render();effect();await vi.waitFor(()=>expect(hooks.states[0]).toMatchObject({state:'ready'}));};
  const click=(label:string)=>{const find=(node:unknown):ReactElement<{onClick:()=>void}>|undefined=>{if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.map(find).find(Boolean);const element=node as ReactElement<{children?:unknown;onClick:()=>void}>;if(element.type==='button'&&element.props.children===label)return element;return find(element.props?.children);};find(tree())!.props.onClick();};
  return{read,getLimit,props,session,render,effect,load,click,page};
}
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.effects=[];vi.clearAllMocks();});
describe('selected order fills',()=>{
  it('shows private sold/proceeds and price without inventing a transaction',async()=>{const f=fixture();await f.load();const html=f.render();expect(html).toContain('Sold');expect(html).toContain('Added to proceeds');expect(html).toContain('Average execution price');expect(html).toContain('Block 10');expect(html).not.toContain('Transaction');expect(f.read).toHaveBeenCalledWith({positionId:52n,before:undefined,assertCurrent:expect.any(Function)});});
  it('loads one older page only on an explicit action',async()=>{const f=fixture();await f.load();f.render();f.effect();expect(f.read).toHaveBeenCalledTimes(1);f.click('Load older fills');await vi.waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({before:38n}));});
  it('changes display price ratio without another read',async()=>{const f=fixture();await f.load();const first=f.render();f.props.baseToken=f.props.selectedPair[1];const second=f.render();f.effect();expect(second).not.toBe(first);expect(f.read).toHaveBeenCalledTimes(1);});
  it.each(['wallet','privacy','key','order','pair']as const)('clears private rows synchronously on %s change',async change=>{const f=fixture();await f.load();if(change==='wallet')f.session.walletAddress=`0x${'33'.repeat(20)}`;if(change==='privacy')f.session.sessionOnboardInfo={};if(change==='key')f.session.sessionOnboardInfo![f.session.walletAddress].aesKey='replaced';if(change==='order')f.props.positionId=99n;if(change==='pair')f.props.selectedPair=resolvePreparedDexScope('cheap-history').candidate.pairs[1].tokens;expect(f.render()).not.toContain('Block 10');});
  it.each([false,true])('distinguishes exhausted empty history from an empty partial page %s',async complete=>{const f=fixture();f.read.mockResolvedValue({...f.page,fills:[],complete});await f.load();expect(f.render()).toContain(complete?'No fills for this order.':'Older fills may exist.');});
  it('keeps rows stale on failure and never retries after hide/show',async()=>{const f=fixture();await f.load();f.read.mockRejectedValue(Error('private payload'));f.click('Refresh fills');await vi.waitFor(()=>expect(hooks.states[0]).toMatchObject({state:'error'}));expect(f.render()).toContain('Saved rows are stale');expect(f.render()).toContain('Block 10');f.props.visible=false;f.render();f.effect();f.props.visible=true;f.render();f.effect();expect(f.read).toHaveBeenCalledTimes(2);expect(f.render()).not.toContain('private payload');});
  it('shows a failed first page as unavailable and retains no false empty claim',async()=>{const f=fixture();f.read.mockRejectedValue(Error('RPC'));f.render();f.effect();await vi.waitFor(()=>expect(hooks.states[0]).toMatchObject({state:'error'}));const html=f.render();expect(html).toContain('Fill history is unavailable');expect(html).not.toContain('No fills');});
  it('ignores late private results from a previous order',async()=>{const f=fixture();let resolve!:(value:typeof f.page)=>void;f.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));f.render();f.effect();await vi.waitFor(()=>expect(f.read).toHaveBeenCalledTimes(1));f.props.positionId=99n;f.render();resolve(f.page);await Promise.resolve();await Promise.resolve();expect(f.render()).not.toContain('Block 10');});
});

it('does not cancel or duplicate the first page during StrictMode effect replay',async()=>{
  const f=fixture();f.render();const cleanup=hooks.effects[0]();f.effect();if(typeof cleanup==='function')cleanup();hooks.effects[0]();f.effect();
  await vi.waitFor(()=>expect(hooks.states[0]).toMatchObject({state:'ready'}));expect(f.read).toHaveBeenCalledTimes(1);expect(f.render()).toContain('Block 10');
});
it('reads a new verified refresh token after an earlier page finishes',async()=>{
  const f=fixture();let resolve!:(value:typeof f.page)=>void;f.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  f.render();f.effect();await vi.waitFor(()=>expect(f.read).toHaveBeenCalledTimes(1));f.props.refreshToken='new-head';f.render();f.effect();expect(f.read).toHaveBeenCalledTimes(1);
  resolve(f.page);await vi.waitFor(()=>expect(hooks.states[0]).toMatchObject({state:'ready'}));f.render();f.effect();await vi.waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));
});
