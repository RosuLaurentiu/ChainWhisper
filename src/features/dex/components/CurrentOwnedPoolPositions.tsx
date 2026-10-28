import { useEffect, useRef, useState } from 'react';
import { resolveBrowserWalletPrivacyState, type SharedWalletSession } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';

type Capability=Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexPoolPositionCapability']>>>;
type Inventory=Awaited<ReturnType<Capability['readOwnedPositions']>>;
export default function CurrentOwnedPoolPositions({session,candidateKey='cheap-exit',visible,disabled=false,refreshToken='',selectedId,onSelect}: {
  session?:SharedWalletSession;candidateKey?:CurrentCheapDexCandidateKey;visible:boolean;disabled?:boolean;refreshToken?:string;selectedId?:string;onSelect:(id:bigint)=>void;
}) {
  const candidate=resolveCurrentCheapDexCandidate(candidateKey);
  const privacyReady=session?resolveBrowserWalletPrivacyState({browserWalletAddress:session.walletAddress,
    sessionOnboardInfo:session.sessionOnboardInfo??{},walletAesHealthByAddress:session.walletAesHealthByAddress}).ownerAesReady:false;
  const getPositions=session?.actions?.getCurrentDexPoolPositionCapability;
  const context={owner:session?.walletAddress.toLowerCase(),chain:session?.chainId,provider:session?.browserProvider,candidateKey,graph:candidate.graph,core:candidate.core,
    walletId:session?.browserWalletId,source:session?.activeSignerSource,onboard:session?.sessionOnboardInfo,
    health:session?.walletAesHealthByAddress,getPositions,privacyReady};
  const scopeRef=useRef(context);
  if((Object.keys(context)as(keyof typeof context)[]).some(key=>context[key]!==scopeRef.current[key]))scopeRef.current=context;
  const scope=scopeRef.current,[refresh,setRefresh]=useState(0);
  const [view,setView]=useState<{scope:typeof scope;state:'loading'|'ready'|'error';inventory?:Inventory}|null>(null);
  const connected=Boolean(context.owner&&context.chain===7082400&&context.provider&&getPositions);
  useEffect(()=>{
    if(!visible||!connected||!scope.privacyReady){setView(null);return;}
    let active=true;
    const assertCurrent=()=>{if(!active||scopeRef.current!==scope)throw new Error('Position wallet or privacy session changed.');};
    setView({scope,state:'loading'});
    void(async()=>{
      const capability=await scope.getPositions!(7082400n,{candidate:scope.candidateKey});assertCurrent();
      const inventory=await capability.readOwnedPositions();assertCurrent();setView({scope,state:'ready',inventory});
    })().catch(()=>{if(active&&scopeRef.current===scope)setView({scope,state:'error'});});
    return()=>{active=false;};
  },[scope,visible,connected,refresh,refreshToken]);
  const current=visible&&privacyReady&&view?.scope===scope?view:null;
  return <section className="dex-owner-list" aria-label="Owned liquidity positions" aria-busy={current?.state==='loading'}>
    <div className="dex-owner-list-toolbar"><span>{current?.inventory ? `${current.inventory.positions.length} positions` : null}</span>
    <button type="button" aria-label="Refresh owned liquidity positions" disabled={!connected||!privacyReady||disabled||current?.state==='loading'} onClick={()=>setRefresh(value=>value+1)}>{current?.state==='loading'?'Loading…':'Refresh positions'}</button></div>
    {!connected?<p>Connect your wallet on COTI Testnet to see your positions.</p>:!privacyReady?<p>Unlock privacy to see your positions.</p>:
      current?.state==='loading'?<p role="status">Loading your positions…</p>:current?.state==='error'?<p role="alert">Could not load positions. Refresh to try again.</p>:null}
    <div className="dex-owner-list-items">{current?.inventory?.positions.map(position=><button type="button" className="dex-owner-item" key={position.positionId.toString()} aria-label={`Open liquidity NFT ${position.positionId}`}
      aria-pressed={selectedId===position.positionId.toString()} disabled={disabled} onClick={()=>onSelect(position.positionId)}><span className="dex-owner-item-title">Position #{position.positionId.toString()}</span><span className="dex-owner-item-meta">Liquidity position</span><span className="dex-owner-status" data-state={['pending','active','paused','pending','closed'][Number(position.status)]}>{['None','Active','Paused','Needs privacy activation','Closed'][Number(position.status)]}</span></button>)}</div>
    {current?.inventory&&!current.inventory.complete?<p role="alert">Position discovery is incomplete. Use manual lookup if your position is missing.</p>:
      current?.inventory?.positions.length===0?<p className="dex-owner-empty">No liquidity positions. Add liquidity to create your first position.</p>:null}
  </section>;
}
