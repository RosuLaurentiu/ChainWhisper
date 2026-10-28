import { useEffect, useRef, useState } from 'react';
import { resolveBrowserWalletPrivacyState, type SharedWalletSession } from '../../../lib/walletSession';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import type { CurrentOwnedLimit } from '../../../lib/currentDexOwnedLimits';
type Capability=Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexLimitCapability']>>>;
type Inventory=Awaited<ReturnType<Capability['readOwnedOrders']>>;
export default function CurrentOwnedLimits({session,candidateKey='cheap-exit',selectedPair,visible,disabled=false,refreshToken='',selectedId,onSelect}:{
  session?:SharedWalletSession;candidateKey?:CurrentCheapDexCandidateKey;selectedPair:readonly[string,string];visible:boolean;disabled?:boolean;refreshToken?:string;selectedId?:string;onSelect:(order:CurrentOwnedLimit)=>void;
}){
  const candidate=resolveCurrentCheapDexCandidate(candidateKey),display=readCurrentDexDisplay(candidate);
  const privacy=session?resolveBrowserWalletPrivacyState({browserWalletAddress:session.walletAddress,sessionOnboardInfo:session.sessionOnboardInfo??{},walletAesHealthByAddress:session.walletAesHealthByAddress}):null;
  const privacyReady=privacy?.ownerAesReady??false;
  const getOrders=session?.actions?.getCurrentDexLimitCapability;
  const context={owner:session?.walletAddress.toLowerCase(),chain:session?.chainId,provider:session?.browserProvider,candidateKey,graph:candidate.graph,core:candidate.core,walletId:session?.browserWalletId,
    source:session?.activeSignerSource,onboard:session?.sessionOnboardInfo,health:session?.walletAesHealthByAddress,getOrders,privacyReady,privacyKey:privacy?.ownerAesKey,pair:selectedPair.join(':')};
  const ref=useRef(context);if((Object.keys(context)as(keyof typeof context)[]).some(k=>context[k]!==ref.current[k]))ref.current=context;
  const scope=ref.current,[refresh,setRefresh]=useState(0),[view,setView]=useState<{scope:typeof scope;state:'loading'|'ready'|'error';inventory?:Inventory}|null>(null);
  const connected=Boolean(context.owner&&context.chain===7082400&&context.provider&&getOrders);
  useEffect(()=>{
    if(!visible||!connected||!scope.privacyReady){setView(null);return;}
    let active=true;const guard=()=>{if(!active||ref.current!==scope)throw Error('Order wallet or privacy session changed.');};
    setView({scope,state:'loading'});
    void(async()=>{const capability=await scope.getOrders!(7082400n,{candidate:scope.candidateKey,selectedPair:scope.pair.split(':')as[string,string]});guard();
      const inventory=await capability.readOwnedOrders();guard();setView({scope,state:'ready',inventory});
    })().catch(()=>{if(active&&ref.current===scope)setView({scope,state:'error'});});
    return()=>{active=false;};
  },[scope,visible,connected,refresh,refreshToken]);
  const current=visible&&privacyReady&&view?.scope===scope?view:null;
  return<section className="dex-owner-list" aria-label="Owned Limit orders" aria-busy={current?.state==='loading'}>
    <div className="dex-owner-list-toolbar"><span>{current?.inventory ? `${current.inventory.orders.length} orders` : null}</span>
    <button type="button" aria-label="Refresh owned Limit orders" disabled={!connected||!privacyReady||disabled||current?.state==='loading'} onClick={()=>setRefresh(v=>v+1)}>{current?.state==='loading'?'Loading…':'Refresh orders'}</button></div>
    {!connected?<p>Connect your wallet on COTI Testnet to see your orders.</p>:!privacyReady?<p>Unlock privacy to see your orders.</p>:
      current?.state==='loading'?<p role="status">Loading your orders…</p>:current?.state==='error'?<p role="alert">Could not load orders. Refresh to try again.</p>:null}
    <div className="dex-owner-list-items">{current?.inventory?.orders.map(order=><button type="button" className="dex-owner-item" key={order.positionId.toString()} aria-label={`Open Limit NFT ${order.positionId}`} aria-pressed={selectedId===order.positionId.toString()} disabled={disabled} onClick={()=>onSelect(order)}>
      <span className="dex-owner-item-title">{order.poolTokens.map(address=>display.tokens.find(t=>t.address===address)?.label??'Unknown token').join(' / ')}</span><span className="dex-owner-item-meta">Order #{order.positionId.toString()}</span><span className="dex-owner-status" data-state={order.closed?'closed':order.status===0n?'active':order.status===1n?'paused':'pending'}>{order.closed?'Closed':['Open','Paused','Needs privacy activation'][Number(order.status)]}</span>
    </button>)}</div>
    {current?.inventory&&!current.inventory.complete?<p role="alert">Order discovery is incomplete. Use manual lookup if your order is missing.</p>:current?.inventory?.orders.length===0?<p className="dex-owner-empty">No Limit orders. Create an order from Trade → Limit.</p>:null}
  </section>;
}
