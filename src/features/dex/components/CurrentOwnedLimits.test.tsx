import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, EffectCallback, MutableRefObject } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import CurrentOwnedLimits from './CurrentOwnedLimits';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[]as unknown[],refs:[]as MutableRefObject<unknown>[],effect:null as EffectCallback|null}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(v:unknown)=>{hooks.states[i]=typeof v==='function'?v(hooks.states[i]):v;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});},useEffect:(effect:EffectCallback)=>{hooks.effect=effect;}
}));
function fixture(){
  const owner=`0x${'22'.repeat(20)}`,pair=resolvePreparedDexScope('cheap-exit').candidate.pairs[0];
  const read=vi.fn(async()=>({orders:[{positionId:43n,marketId:pair.marketId,poolTokens:pair.tokens,status:0n,closed:false,context:'bound'}],complete:true}));
  const getOrders=vi.fn(async()=>({readOwnedOrders:read}));
  const session={walletAddress:owner,chainId:7082400,browserProvider:{},browserWalletId:'metamask',activeSignerSource:'browser',sessionOnboardInfo:{[owner]:{aesKey:'local-test-only'}},walletAesHealthByAddress:{},actions:{getCurrentDexLimitCapability:getOrders}}as unknown as SharedWalletSession;
  const props:ComponentProps<typeof CurrentOwnedLimits>={session,candidateKey:'cheap-exit',selectedPair:pair.tokens,visible:true,disabled:false,onSelect:vi.fn()};
  const render=()=>{hooks.index=0;hooks.refIndex=0;return renderToStaticMarkup(CurrentOwnedLimits(props));};
  const load=async()=>{render();hooks.effect!();await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));};
  return{read,getOrders,props,session,render,load};
}
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.effect=null;vi.clearAllMocks();});
describe('My Orders current wallet list',()=>{
  it('lists owned orders with their pair and no private amount or routine ID input',async()=>{
    const f=fixture();await f.load();expect(f.render()).toContain('Open Limit NFT 43');
    expect(f.getOrders).toHaveBeenCalledWith(7082400n,{candidate:'cheap-exit',selectedPair:f.props.selectedPair});expect(f.read).toHaveBeenCalledWith();
    expect(f.render()).not.toContain('Private price');expect(f.render()).not.toContain('Claimable');
  });
  it('uses selected candidate display labels and clears prior orders on candidate change',async()=>{
    const f=fixture();await f.load();f.props.candidateKey='cheap-history';
    const historyPair=resolvePreparedDexScope('cheap-history').candidate.pairs[0];
    f.props.selectedPair=historyPair.tokens;
    expect(f.render()).not.toContain('Open Limit NFT 43');hooks.effect!();
    await vi.waitFor(()=>expect(f.getOrders).toHaveBeenLastCalledWith(7082400n,{candidate:'cheap-history',selectedPair:historyPair.tokens}));
    await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));
    const html=f.render();expect(html).toContain(resolvePreparedDexScope('cheap-history').candidate.tokenMetadata[0].symbol);
  });
  it('ignores an old candidate inventory that resolves after the new candidate',async()=>{
    const f=fixture();let resolveOld!:(value:{orders:{positionId:bigint;marketId:string;poolTokens:readonly[string,string];status:bigint;closed:boolean;context:string}[];complete:boolean})=>void;
    const oldInventory=new Promise<{orders:{positionId:bigint;marketId:string;poolTokens:readonly[string,string];status:bigint;closed:boolean;context:string}[];complete:boolean}>(resolve=>{resolveOld=resolve;});
    f.getOrders.mockImplementationOnce(async()=>({readOwnedOrders:vi.fn(async()=>await oldInventory)}));
    f.render();const cleanupOld=hooks.effect!();
    const historyPair=resolvePreparedDexScope('cheap-history').candidate.pairs[0];
    f.props.candidateKey='cheap-history';f.props.selectedPair=historyPair.tokens;f.render();if(typeof cleanupOld==='function')cleanupOld();hooks.effect!();
    await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));
    expect(f.render()).toContain('Open Limit NFT 43');
    resolveOld({orders:[{positionId:99n,marketId:'old',poolTokens:['old-a','old-b'],status:0n,closed:false,context:'old'}],complete:true});await oldInventory;
    await Promise.resolve();expect(f.render()).toContain('Open Limit NFT 43');expect(f.render()).not.toContain('Open Limit NFT 99');
  });
  it('shows closed orders without inferring the reason from their old status',async()=>{
    const f=fixture();const inventory=await f.read();inventory.orders[0].closed=true;f.read.mockResolvedValue(inventory);
    await f.load();const html=f.render();expect(html).toContain('Closed');expect(html).not.toContain(' · Open');expect(html).not.toContain('Filled');expect(html).not.toContain('Cancelled');
  });
  it.each(['wallet','privacy','privacy-key','hidden']as const)('clears displayed orders on %s change',async change=>{
    const f=fixture();await f.load();if(change==='wallet')f.session.walletAddress=`0x${'33'.repeat(20)}`;
    if(change==='privacy')f.session.sessionOnboardInfo={};if(change==='privacy-key')f.session.sessionOnboardInfo![f.session.walletAddress.toLowerCase()].aesKey='new-session-key';if(change==='hidden')f.props.visible=false;
    expect(f.render()).not.toContain('Open Limit NFT 43');
  });
  it('does not read orders while privacy is locked',()=>{
    const f=fixture();f.session.sessionOnboardInfo={};expect(f.render()).toContain('Unlock privacy');hooks.effect!();expect(f.getOrders).not.toHaveBeenCalled();
  });
  it.each(['empty','incomplete','failed']as const)('distinguishes %s inventory',async state=>{
    const f=fixture();if(state==='failed')f.read.mockRejectedValue(Error('private RPC payload'));else f.read.mockResolvedValue({orders:[],complete:state==='empty'});
    f.render();hooks.effect!();await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:state==='failed'?'error':'ready'}));
    const html=f.render();expect(html).toContain(state==='empty'?'No Limit orders':state==='incomplete'?'Order discovery is incomplete':'Could not load orders');
    expect(html).not.toContain('private RPC payload');if(state!=='empty')expect(html).not.toContain('No Limit orders');
  });
});
