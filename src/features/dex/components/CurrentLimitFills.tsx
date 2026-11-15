import { useEffect,useRef,useState } from 'react';
import { resolveBrowserWalletPrivacyState,type SharedWalletSession } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate,type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay,formatDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import { formatCurrentDexAveragePrice } from '../../../lib/currentDexPriceImpact';
import type { issueCurrentDexLimitCapability } from '../../wallet/currentDexLimitCapability';

type Page=Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexLimitCapability>>['readFills']>>;
export default function CurrentLimitFills({session,candidateKey,selectedPair,positionId,visible,refreshToken,baseToken}:{
  session?:SharedWalletSession;candidateKey:CurrentCheapDexCandidateKey;selectedPair:readonly[string,string];positionId:bigint;visible:boolean;refreshToken:string;baseToken:string;
}){
  const candidate=resolveCurrentCheapDexCandidate(candidateKey),tokens=readCurrentDexDisplay(candidate).tokens;
  const privacy=session?resolveBrowserWalletPrivacyState({browserWalletAddress:session.walletAddress,sessionOnboardInfo:session.sessionOnboardInfo??{},walletAesHealthByAddress:session.walletAesHealthByAddress}):null;
  const context={owner:session?.walletAddress.toLowerCase(),chain:session?.chainId,provider:session?.browserProvider,walletId:session?.browserWalletId,source:session?.activeSignerSource,
    onboard:session?.sessionOnboardInfo,health:session?.walletAesHealthByAddress,privacyKey:privacy?.ownerAesKey,privacyReady:privacy?.ownerAesReady??false,
    getLimit:session?.actions?.getCurrentDexLimitCapability,candidateKey,pair:selectedPair.join(':'),positionId};
  const scopeRef=useRef(context);if((Object.keys(context)as(keyof typeof context)[]).some(key=>context[key]!==scopeRef.current[key]))scopeRef.current=context;
  const scope=scopeRef.current,connected=Boolean(scope.owner&&scope.chain===Number(candidate.chainId)&&scope.provider&&scope.getLimit);
  type View={scope:typeof scope;state:'loading'|'ready'|'error';page?:Page;stale?:boolean};
  const [view,setView]=useState<View|null>(null),viewRef=useRef(view);viewRef.current=view;
  const attemptRef=useRef<object|null>(null),autoRef=useRef<{scope:typeof scope;refreshToken:string}|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=async(older=false)=>{
    if(!visible||!connected||!scope.privacyReady||viewRef.current?.scope===scope&&viewRef.current.state==='loading')return;
    const prior=viewRef.current?.scope===scope?viewRef.current.page:undefined;
    if(older&&(!prior||prior.complete))return;
    const attempt={};attemptRef.current=attempt;
    const guard=()=>{if(!mounted.current||scopeRef.current!==scope||attemptRef.current!==attempt)throw new Error('Limit fill owner or privacy session changed.');};
    setView({scope,state:'loading',page:prior,stale:Boolean(prior)});
    try{
      const capability=await scope.getLimit!(BigInt(candidate.chainId),{candidate:candidateKey,selectedPair:scope.pair.split(':')as[string,string]});guard();
      const page=await capability.readFills({positionId,before:older?prior!.nextBefore:undefined,assertCurrent:guard});guard();
      const rows=new Map((older?prior!.fills:[]).map(row=>[`${row.engine}:${row.record}`,row]));
      page.fills.forEach(row=>rows.set(`${row.engine}:${row.record}`,row));
      setView({scope,state:'ready',page:{...page,fills:[...rows.values()]}});
    }catch{
      if(mounted.current&&scopeRef.current===scope&&attemptRef.current===attempt)setView({scope,state:'error',page:prior,stale:Boolean(prior)});
    }
  };
  useEffect(()=>{
    if(!visible||!connected||!scope.privacyReady||viewRef.current?.scope===scope&&viewRef.current.state==='loading'||autoRef.current?.scope===scope&&autoRef.current.refreshToken===refreshToken)return;
    autoRef.current={scope,refreshToken};void load();
  },[scope,visible,connected,refreshToken,view?.state]);
  const current=visible&&scope.privacyReady&&view?.scope===scope?view:null;
  const busy=current?.state==='loading';
  const base=tokens.find(token=>token.address.toLowerCase()===baseToken.toLowerCase()),quote=tokens.find(token=>selectedPair.some(address=>address.toLowerCase()===token.address.toLowerCase())&&token.address.toLowerCase()!==baseToken.toLowerCase());
  const price=(row:Page['fills'][number])=>base&&quote?formatCurrentDexAveragePrice({baseAmount:(row.soldToken.toLowerCase()===base.address.toLowerCase()?row.sold:row.received)*10n**BigInt(quote.decimals),
    quoteAmount:(row.soldToken.toLowerCase()===quote.address.toLowerCase()?row.sold:row.received)*10n**BigInt(base.decimals),baseToken:base.label,quoteToken:quote.label}):'Unavailable';
  return <section className="dex-owner-list" aria-label="Selected order fills" aria-busy={busy}>
    <h3>Order fills</h3><p>Filled amounts are added to order proceeds. Claim proceeds to receive them in your wallet.</p>
    <button type="button" disabled={!visible||!connected||!scope.privacyReady||busy} onClick={()=>{void load();}}>Refresh fills</button>
    {!scope.privacyReady?<p>Unlock privacy to read order fills.</p>:busy?<p role="status">Loading order fills…</p>:null}
    {current?.state==='error'?<p role="alert">Could not load fills. {current.page?'Saved rows are stale; history is incomplete.':'Fill history is unavailable.'} Use Refresh fills to try again.</p>:null}
    {current?.page?.fills.map(row=><div className="dex-owner-item" key={`${row.engine}:${row.record}`}>
      <time dateTime={new Date(Number(row.timestamp)*1000).toISOString()}>{new Date(Number(row.timestamp)*1000).toLocaleString()}</time>
      <dl className="dex-v2-current-facts"><div><dt>Sold</dt><dd>{formatDexCandidateTokenAmount(candidate,row.soldToken,row.sold)} {tokens.find(token=>token.address.toLowerCase()===row.soldToken.toLowerCase())?.label}</dd></div>
        <div><dt>Added to proceeds</dt><dd>{formatDexCandidateTokenAmount(candidate,row.receivedToken,row.received)} {tokens.find(token=>token.address.toLowerCase()===row.receivedToken.toLowerCase())?.label}</dd></div>
        <div><dt>Average execution price</dt><dd>{price(row)}</dd></div></dl><small>Block {row.blockNumber.toString()}</small>
    </div>)}
    {current?.page&&!current.page.fills.length?<p>{current.page.complete?'No fills for this order.':'No fills for this order in this page. Older fills may exist.'}</p>:null}
    {current?.page&&!current.page.complete?<><p>Fill history is incomplete.</p><button type="button" disabled={busy} onClick={()=>{void load(true);}}>Load older fills</button></>:null}
  </section>;
}
