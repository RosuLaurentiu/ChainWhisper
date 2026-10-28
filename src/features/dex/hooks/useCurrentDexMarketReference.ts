import { useCallback, useEffect, useRef, useState } from 'react';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidate } from '../../../lib/dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR } from '../../../lib/currentDexDisplay';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';
import { createPrivateLiquidityHttpProvider } from '../../../lib/privateLiquidityRpc';
import { CurrentDexDailyPriceError, readCurrentDexPublicReference, type CurrentDexDailyPriceView, type CurrentDexPublicReferenceView } from '../../../lib/currentDexDailyPrice';
import { currentNativeDexDailyPriceConfig } from '../../../lib/currentDexNativeDailyPriceTestnet';
import { currentDexMarketReference } from '../../../lib/currentDexMarketReference';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import useCurrentDexDailyPrice from './useCurrentDexDailyPrice';

type ReferenceView = CurrentDexDailyPriceView | CurrentDexPublicReferenceView;
export async function loadCurrentDexMarketReference({candidate,pair,provider,assertCurrent=()=>{}}:{
  candidate:CurrentCheapDexCandidate;pair:readonly[string,string];provider?:Pick<Eip1193Provider,'request'>;
  assertCurrent?:()=>void|Promise<void>;
}):Promise<ReferenceView>{
  try {
    const snapshot=await readCurrentDexPublicReference({candidate,pair,assertCurrent,
      provider:provider??createPrivateLiquidityHttpProvider({rpcUrl:COTI_TESTNET_NETWORK.rpcUrl,maxAttempts:1})});
    return {status:'reference',snapshot};
  } catch(error) {
    return {status:'error',kind:error instanceof CurrentDexDailyPriceError?error.kind:'rpc',
      message:error instanceof Error?error.message:'Market reference read failed.'};
  }
}

export default function useCurrentDexMarketReference(active: boolean,candidate:CurrentCheapDexCandidate=CURRENT_CHEAP_DEX_CANDIDATE,pair:readonly[string,string]=CURRENT_DEX_DISPLAY_PAIR) {
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
    if(!active||!direct)return;
    let pending=true;
    const capturedPair=[base,quote] as const;
    const assertCurrent=()=>{const c=current.current;
      if(!pending||!c.active||c.candidate!==candidate||c.pair[0]!==capturedPair[0]||c.pair[1]!==capturedPair[1])throw Error('Market reference request was superseded.');};
    void loadCurrentDexMarketReference({candidate,pair:capturedPair,assertCurrent}).then(view=>{
      if(pending)setSettled({candidate,pair:capturedPair,epoch,view});
    });
    return()=>{pending=false;};
  },[active,direct,candidate,base,quote,epoch]);
  const [now,setNow] = useState(() => BigInt(Math.floor(Date.now()/1000)));
  useEffect(() => {
    if (!active) return;
    const expiry = window.setInterval(() => setNow(BigInt(Math.floor(Date.now()/1000))),1000);
    const read = window.setInterval(refresh,30000);
    return () => { window.clearInterval(expiry); window.clearInterval(read); };
  },[active,refresh]);
  const view:ReferenceView=!active?{status:'unconfigured'}:direct?
    settled?.candidate===candidate&&settled.epoch===epoch&&settled.pair[0]===pair[0]&&settled.pair[1]===pair[1]?settled.view:{status:'loading'}:dailyView;
  return currentDexMarketReference(view,pair,now);
}
