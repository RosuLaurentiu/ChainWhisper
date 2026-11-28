import { useCallback, useEffect, useRef, useState } from 'react';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidate } from '../../../lib/dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR } from '../../../lib/currentDexDisplay';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';
import { CurrentDexDailyPriceError, getCurrentDexPriceReadProvider, isVerifiedCurrentDexPublicReference, readCurrentDexPublicReference, type CurrentDexDailyPriceView, type CurrentDexPublicReferenceView } from '../../../lib/currentDexDailyPrice';
import { currentNativeDexDailyPriceConfig } from '../../../lib/currentDexNativeDailyPriceTestnet';
import { currentDexMarketReference, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { resumeCotiReadsAfterTransientStop } from '../../../lib/appShared/core';
import useCurrentDexDailyPrice from './useCurrentDexDailyPrice';

// The price service publishes at most every 5 minutes per market; a new price shows within a minute while the user is active.
export const MARKET_POLL_MS=60_000;
export const MARKET_IDLE_AFTER_MS=10*60_000;
const ACTIVITY_EVENTS=['pointerdown','pointermove','keydown','wheel','touchstart','focus'] as const;
type ReferenceView = CurrentDexDailyPriceView | CurrentDexPublicReferenceView;
export async function loadCurrentDexMarketReference({candidate,pair,provider,assertCurrent=()=>{}}:{
  candidate:CurrentCheapDexCandidate;pair:readonly[string,string];provider?:Pick<Eip1193Provider,'request'>;
  assertCurrent?:()=>void|Promise<void>;
}):Promise<ReferenceView>{
  try {
    const snapshot=await readCurrentDexPublicReference({candidate,pair,assertCurrent,
      provider:provider??getCurrentDexPriceReadProvider(COTI_TESTNET_NETWORK.rpcUrl)});
    return {status:'reference',snapshot};
  } catch(error) {
    return {status:'error',kind:error instanceof CurrentDexDailyPriceError?error.kind:'rpc',
      message:error instanceof Error?error.message:'Market reference read failed.'};
  }
}

export default function useCurrentDexMarketReference(active: boolean,candidate:CurrentCheapDexCandidate=STAGED_SHARED_HISTORY_DEX_CANDIDATE,pair:readonly[string,string]=CURRENT_DEX_DISPLAY_PAIR) {
  let direct=false;
  if(candidate.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph){
    try{direct=resolvePreparedDexScope(candidate).key==='cheap-history';}catch{/* A changed descriptor cannot reuse a settled reference. */}
  }
  const [base,quote]=pair;
  const { view:dailyView, refresh:dailyRefresh } = useCurrentDexDailyPrice({pair,count:1,
    config:active&&!direct?currentNativeDexDailyPriceConfig(candidate,pair):{status:'inactive'}});
  const [epoch,setEpoch]=useState(0);
  const current=useRef({active,candidate,pair});current.current={active,candidate,pair};
  const [settled,setSettled]=useState<{candidate:CurrentCheapDexCandidate;pair:readonly[string,string];epoch:number;view:ReferenceView}|null>(null);
  const refresh=useCallback(()=>{if(direct)setEpoch(v=>v+1);else dailyRefresh();},[direct,dailyRefresh]);
  useEffect(()=>{
    if(!active||!direct){setSettled(null);return;}
    setSettled(previous=>previous?.candidate===candidate&&previous.pair[0]===base&&previous.pair[1]===quote?previous:null);
    let pending=true;
    const capturedPair=[base,quote] as const;
    const assertCurrent=()=>{const c=current.current;
      if(!pending||!c.active||c.candidate!==candidate||c.pair[0]!==capturedPair[0]||c.pair[1]!==capturedPair[1])throw Error('Market reference request was superseded.');};
    void loadCurrentDexMarketReference({candidate,pair:capturedPair,assertCurrent}).then(view=>{
      if(pending)setSettled({candidate,pair:capturedPair,epoch,view});
    });
    return()=>{pending=false;};
  },[active,direct,candidate,base,quote,epoch]);
  const sameScope=settled?.candidate===candidate&&settled.pair[0]===base&&settled.pair[1]===quote;
  const view:ReferenceView=!active?{status:'unconfigured'}:direct?
    sameScope&&(settled.epoch===epoch||settled.view.status==='reference'&&isVerifiedCurrentDexPublicReference(settled.view.snapshot))?settled.view:{status:'loading'}:dailyView;
  const readPending=useRef(false);readPending.current=direct?!sameScope||settled.epoch!==epoch:dailyView.status==='loading';
  const [now,setNow] = useState(() => BigInt(Math.floor(Date.now()/1000)));
  useEffect(() => {
    if (!active) return;
    // Owner request 2026-11-26 (CW-141): read the price only while the user is active. Opening the page counts as activity.
    let lastInput=Date.now(),lastRead=Date.now();
    const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
    const idle=()=>!visible()||Date.now()-lastInput>=MARKET_IDLE_AFTER_MS;
    const poll=()=>{
      // A slow read must finish before an automatic refresh replaces it.
      if(readPending.current||idle()||Date.now()-lastRead<MARKET_POLL_MS)return;
      lastRead=Date.now();refresh();
    };
    const wake=()=>{
      const wasIdle=idle();lastInput=Date.now();
      // A timeout or connection stop ends on user activity; HTTP 403/429 stays stopped until reload.
      if(resumeCotiReadsAfterTransientStop()||wasIdle)lastRead=0;
      poll();
    };
    const expiry = window.setInterval(() => { setNow(BigInt(Math.floor(Date.now()/1000))); poll(); },1000);
    const target=typeof window.addEventListener==='function'?window:null;
    for(const event of ACTIVITY_EVENTS)target?.addEventListener(event,wake,{passive:true});
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',wake);
    return () => {
      window.clearInterval(expiry);
      for(const event of ACTIVITY_EVENTS)target?.removeEventListener(event,wake);
      if(typeof document!=='undefined')document.removeEventListener('visibilitychange',wake);
    };
  },[active,refresh]);
  const reference=currentDexMarketReference(view,pair,now);
  const last=useRef<{candidate:CurrentCheapDexCandidate;pair:readonly[string,string];reference:Extract<CurrentDexMarketReference,{status:'available'|'last-known'}>}|null>(null);
  if(!active||last.current&&(last.current.candidate!==candidate||last.current.pair[0]!==base||last.current.pair[1]!==quote))last.current=null;
  if(reference.status==='available'||reference.status==='last-known'){
    // CW-168: a last-known price of the same sample keeps the time at which the App last read it as current.
    const previous=last.current?.reference;
    const checkedAt=reference.status==='last-known'&&!reference.checkedAt&&previous?.checkedAt&&
      previous.sampledAt===reference.sampledAt&&previous.revision===reference.revision?previous.checkedAt:undefined;
    const kept=checkedAt?Object.freeze({...reference,checkedAt}):reference;
    last.current={candidate,pair:[base,quote],reference:kept};
    return kept;
  }
  if(last.current&&now>=BigInt(last.current.reference.sampledAt)){
    const {price,sampledAt,checkedAt,revision}=last.current.reference;
    return {status:'last-known' as const,price,sampledAt,...(checkedAt?{checkedAt}:{}),revision,pair:last.current.pair};
  }
  return reference;
}
