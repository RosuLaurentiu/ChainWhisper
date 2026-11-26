import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, EffectCallback, MutableRefObject } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';

const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[] as unknown[],refs:[] as MutableRefObject<unknown>[],effect:null as EffectCallback|null}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const index=hooks.index++;if(!(index in hooks.states))hooks.states[index]=initial;return[hooks.states[index],(value:unknown)=>{hooks.states[index]=typeof value==='function'?value(hooks.states[index]):value;}];},
  useRef:(initial:unknown)=>{const index=hooks.refIndex++;return hooks.refs[index]??(hooks.refs[index]={current:initial});},
  useEffect:(effect:EffectCallback)=>{hooks.effect=effect;}
}));
function fixture(){
  const owner=`0x${'22'.repeat(20)}`, read=vi.fn(async()=>({positions:[{positionId:43n,status:1n,context:'bound'},{positionId:44n,status:3n,context:'received'}],complete:true}));
  const getPositions=vi.fn(async()=>({readOwnedPositions:read}));
  const session={walletAddress:owner,chainId:7082400,browserProvider:{},browserWalletId:'metamask',activeSignerSource:'browser',
    sessionOnboardInfo:{[owner]:{aesKey:'local-fixture-only'}},walletAesHealthByAddress:{},actions:{getCurrentDexPoolPositionCapability:getPositions}} as unknown as SharedWalletSession;
  const props:ComponentProps<typeof CurrentOwnedPoolPositions>={session,candidateKey:'cheap-history',visible:true,disabled:false,onSelect:vi.fn()};
  const render=()=>{hooks.index=0;hooks.refIndex=0;return renderToStaticMarkup(CurrentOwnedPoolPositions(props));};
  const load=async()=>{render();const cleanup=hooks.effect!();await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));return cleanup;};
  return{props,session,read,getPositions,render,load};
}
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.effect=null;vi.clearAllMocks();});
describe('Your Positions automatic owner list',()=>{
  it('places management navigation between the toolbar and items',async()=>{
    const f=fixture();f.props.managementNavigation=<nav>Manage navigation</nav>;await f.load();const html=f.render();
    expect(html).toContain('<h2>Manage</h2>');expect(html).toContain('Orders, positions and activity');
    expect(html.indexOf('Refresh ')).toBeLessThan(html.indexOf('Manage navigation'));expect(html.indexOf('Manage navigation')).toBeLessThan(html.indexOf('dex-owner-list-items'));
  });
  it('loads current-owned and received claims without an NFT ID or producer input',async()=>{
    const f=fixture();await f.load();const html=f.render();
    expect(html).toContain('Open liquidity NFT 43');expect(html).toContain('Open liquidity NFT 44');expect(html).toContain('Needs privacy activation');
    expect(f.getPositions).toHaveBeenCalledWith(7082400n,{candidate:'cheap-history'});expect(f.read).toHaveBeenCalledWith();
    expect(html).not.toContain('Private shares');expect(html).not.toContain('Pool spread');
  });
  it('ignores an old candidate inventory that resolves after the new candidate',async()=>{
    const f=fixture();let resolveOld!:(value:{positions:{positionId:bigint;status:bigint;context:string}[];complete:boolean})=>void;
    const oldInventory=new Promise<{positions:{positionId:bigint;status:bigint;context:string}[];complete:boolean}>(resolve=>{resolveOld=resolve;});
    f.getPositions.mockImplementationOnce(async()=>({readOwnedPositions:vi.fn(async()=>await oldInventory)}));
    f.render();const cleanupOld=hooks.effect!();
    f.props.candidateKey='cheap-history';f.render();if(typeof cleanupOld==='function')cleanupOld();hooks.effect!();
    await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));
    expect(f.render()).toContain('Open liquidity NFT 43');
    resolveOld({positions:[{positionId:99n,status:1n,context:'old'}],complete:true});await oldInventory;
    await Promise.resolve();expect(f.render()).toContain('Open liquidity NFT 43');expect(f.render()).not.toContain('Open liquidity NFT 99');
  });
  it.each(['wallet','privacy','hidden'] as const)('revokes the visible list on %s change',async fault=>{
    const f=fixture();await f.load();
    if(fault==='wallet')f.session.walletAddress=`0x${'33'.repeat(20)}`;
    if(fault==='privacy')f.session.sessionOnboardInfo={};
    if(fault==='hidden')f.props.visible=false;
    expect(f.render()).not.toContain('Open liquidity NFT 43');
  });
  it('does not request a capability in the locked or hidden view',()=>{
    const f=fixture();f.session.sessionOnboardInfo={};expect(f.render()).toContain('Unlock privacy');hooks.effect!();expect(f.getPositions).not.toHaveBeenCalled();
    f.props.visible=false;f.render();hooks.effect!();expect(f.getPositions).not.toHaveBeenCalled();
  });
  it('gives the unlock action in the locked list instead of a pointer to the header',()=>{
    const f=fixture();f.session.sessionOnboardInfo={};(f.session.actions as unknown as Record<string,unknown>).unlockPrivacy=vi.fn(async()=>undefined);
    const html=f.render();expect(html).toContain('privacy-locked-notice');expect(html).toContain('Your positions are locked.');expect(html).toContain('>Unlock privacy</button>');expect(html).not.toContain('in the header');
  });
  it.each(['empty','incomplete','failed'] as const)('distinguishes %s discovery',async state=>{
    const f=fixture();
    if(state==='failed')f.read.mockRejectedValue(new Error('sensitive RPC payload'));
    else f.read.mockResolvedValue({positions:[],complete:state==='empty'});
    f.render();hooks.effect!();await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:state==='failed'?'error':'ready'}));
    const html=f.render();expect(html).toContain(state==='empty'?'No liquidity positions':state==='incomplete'?'Position discovery is incomplete':'Could not load positions');
    expect(html).not.toContain('sensitive RPC payload');if(state!=='empty')expect(html).not.toContain('No liquidity positions');
  });
});
