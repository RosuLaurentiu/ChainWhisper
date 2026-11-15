// Synthetic local layout only. No wallet, provider requests or signing implementation.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CurrentLimitWorkspace from '../../../src/features/dex/components/CurrentLimitWorkspace';
import CurrentPoolPositionsWorkspace from '../../../src/features/dex/components/CurrentPoolPositionsWorkspace';
import CurrentPoolWorkspace from '../../../src/features/dex/components/CurrentPoolWorkspace';
import CurrentSharedTestTokenControls from '../../../src/features/dex/components/CurrentSharedTestTokenControls';
import { CURRENT_SHARED_DEX_TOKENS, resolveCurrentSharedTokenDistribution } from '../../../src/lib/currentSharedDexTokenDistribution';
import CurrentDexActivity from '../../../src/features/dex/components/CurrentDexActivity';
import AppHeader from '../../../src/app/components/AppHeader';
import { AppHeaderNavigation } from '../../../src/app/components/AppHeaderNavigation';
import useAppNavigation from '../../../src/app/hooks/useAppNavigation';
import type { AppPage } from '../../../src/shell/routing';
import WalletHeaderPanel from '../../../src/features/wallet/components/WalletHeaderPanel';
import DexV2Page, { ModeNavigation } from '../../../src/features/dex/components/DexV2Page';
import { TradeViewTabs } from '../../../src/features/trading/components/TradeDeskTabs';
import TradeMarketOverviewPanel from '../../../src/features/trading/components/TradeMarketOverviewPanel';
import { resolvePreparedDexScope } from '../../../src/lib/currentDexPreparedScope';
import type { SharedWalletSession } from '../../../src/lib/walletSession';
import '../../../src/features/dex/components/CurrentDexOwnerViews.css';
import '../../../src/styles.css';
const owner='0x2222222222222222222222222222222222222222',pair=resolvePreparedDexScope('cheap-history').candidate.pairs[0];
const navigationCheck=new URLSearchParams(location.search).get('navigation')==='1';
const liquidityCheck=new URLSearchParams(location.search).get('liquidity')==='1';
const p2pCheck=new URLSearchParams(location.search).get('p2p');
const compactSwapCheck=new URLSearchParams(location.search).get('compact')==='1';
const poolSignaturesCheck=new URLSearchParams(location.search).get('pool-signatures')==='1';
const poolNavigationCheck=new URLSearchParams(location.search).get('pool-navigation')==='1';
const limitSignaturesCheck=new URLSearchParams(location.search).get('limit-signatures')==='1';
if(navigationCheck||liquidityCheck)window.history.replaceState(null,'',liquidityCheck?'/dex/liquidity':'/dex/activity');
if(compactSwapCheck)window.history.replaceState(null,'','/dex');
if(poolNavigationCheck)window.history.replaceState(null,'','/dex/positions');
const forbidden=async()=>{throw Error('No transaction path exists in this local fixture.');};
function TokenSnapshotFixture(){
 const policy=resolveCurrentSharedTokenDistribution('cheap-history');
 const wallet={walletAddress:owner,chainId:7082400,browserProvider:{request:forbidden},browserWalletId:'metamask',activeSignerSource:'browser',
  sessionOnboardInfo:{[owner]:{aesKey:'synthetic-layout-only'}},walletAesHealthByAddress:{},actions:{
   getCurrentSharedDexTokenFundsCapability:async()=>({read:async()=>({owner,core:policy.core,graph:policy.graph,packageSha256:policy.packageSha256,
    head:{number:12345n,hash:`0x${'11'.repeat(32)}`,timestamp:1791340000n},vault:policy.vault,readyToSign:false,privateFundsVerified:true,
    tokens:CURRENT_SHARED_DEX_TOKENS.map(token=>({...token,balance:123456789n,allowance:0n,encryptionAddress:owner,claimed:true,
     initialClaimAvailability:'claimed',refillAvailability:'cooldown',quota:999000000n,nextClaimAt:1791400000n,initialAmount:policy.initialAmount,refillAmount:policy.refillAmount}))})})
  }} as unknown as SharedWalletSession;
 return <div className="app-shell app-shell-wallet app-shell-dex-v2" style={{display:'block',padding:24}}><h1>Synthetic token snapshot</h1><p>No connected wallet, provider requests or send path.</p>
  <div style={{maxWidth:900}}><CurrentSharedTestTokenControls candidateKey="cheap-history" sharedWalletSession={wallet}/></div></div>;
}
const session={walletAddress:owner,chainId:7082400,browserProvider:{},browserWalletId:'metamask',activeSignerSource:'browser',sessionOnboardInfo:{[owner]:{aesKey:'synthetic-layout-only'}},walletAesHealthByAddress:{},actions:{
  getCurrentDexSubmissionCapability:async()=>({submitLimitOwner:async()=>({transactionHash:'synthetic-refresh-only',recover:async()=>({positionId:52n,context:'fixture',status:0n,closed:false,refreshRequired:false,amounts:{unspent:2000000n,proceeds:999500n,sellToken0:true,priceNumerator:2n,priceDenominator:1n,makerMinimum:0n}})})}),
  getCurrentDexLimitCapability:async()=>({prepareOwnerAction:async({action}:{action:string})=>action==='refresh'?{synthetic:true}:forbidden(),readOwnedOrders:async()=>({orders:[{positionId:52n,poolTokens:pair.tokens,status:0n,closed:false,context:'fixture'},{positionId:54n,poolTokens:pair.tokens,status:0n,closed:true,context:'fixture'}],complete:true})}),
  getCurrentDexPoolPositionCapability:async()=>({readOwnedPositions:async()=>({positions:[{positionId:50n,status:1n},{positionId:49n,status:4n}],complete:true}),readPosition:async(positionId:bigint)=>({positionId,status:positionId===49n?4n:1n,poolTokens:pair.tokens,amounts:{shares:1000000n,amount0:250000000n,amount1:500000000n,classId:3n}})})
}} as unknown as SharedWalletSession;
const lockedLayoutSession={...session,sessionOnboardInfo:{},actions:{...session.actions,getCurrentDexQuoteCapability:forbidden,getCurrentDexReceiptCapability:forbidden,unlockPrivacy:forbidden}} as unknown as SharedWalletSession;
type Actions=NonNullable<SharedWalletSession['actions']>;
type FundingCapability=Awaited<ReturnType<NonNullable<Actions['getCurrentDexPoolFundingCapability']>>>;
type PositionCapability=Awaited<ReturnType<NonNullable<Actions['getCurrentDexPoolPositionCapability']>>>;
type CreateIntent=Parameters<FundingCapability['preparePoolCreation']>[0]['intent'];
type TopUpIntent=Parameters<FundingCapability['preparePoolTopUp']>[0]['intent'];
function PoolNavigationFixture({wallet}:{wallet:SharedWalletSession}){
 const [activePage,setActivePage]=useState<AppPage>('dex');
 const {navigateToInternalAppLink}=useAppNavigation({activePage,setActivePage});
 return <DexV2Page sharedWalletSession={wallet} swapCandidate="cheap-history" selectedPair={['BCN','HBR']}
  onNavigateMode={mode=>navigateToInternalAppLink(mode==='swap'?'/dex':`/dex/${mode}`)}/>;
}
function PoolSignaturesFixture(){
 const [view,setView]=useState('Create'),[stage,setStage]=useState<{label:string;release:()=>void;reject:()=>void}|null>(null);
 const [counts,setCounts]=useState({reviews:0,preparations:0,submissions:0,blockReads:0});
 const [wallet]=useState(()=>{
  const candidate=resolvePreparedDexScope('cheap-history').candidate,hash=`0x${'ab'.repeat(32)}`,context=`0x${'cd'.repeat(32)}`;
  const position={positionId:50n,status:1n,context,producerHash:hash,block:{number:1n,hash},poolTokens:pair.tokens,
   amounts:{shares:1000000n,amount0:250000000n,amount1:500000000n,classId:3n}};
  const count=(key:keyof typeof counts)=>setCounts(value=>({...value,[key]:value[key]+1}));
  const pause=(label:string)=>new Promise<void>((resolve,reject)=>{count('preparations');setStage({label,
   release:()=>{setStage(null);resolve();},reject:()=>{setStage(null);reject(new Error(`Synthetic preparation rejected: ${label}. No wallet request was made.`));}});});
  const amounts={operation:'initialize' as 'initialize'|'add',used0:1000000n,used1:2000000n,unused0:100000n,unused1:200000n,mintedShares:100n,ownedShares:100n,toleranceN:1n,toleranceD:200n};
  const fundingCapability={
   preparePoolCreation:async(request:Parameters<FundingCapability['preparePoolCreation']>[0])=>{
    count('reviews');if(!await request.confirmPrivateInputs({...request.intent,core:candidate.core,principal:owner,chainId:BigInt(candidate.chainId)}))return null;await pause('Create preview inputs');
    return {kind:'create',intent:request.intent};
   },
   preparePoolTopUp:async(request:Parameters<FundingCapability['preparePoolTopUp']>[0])=>{
    count('reviews');if(!await request.confirmPrivateInputs({positionId:50n,ownerContext:context,classId:3n,...request.intent} as never))return null;await pause('Top-up preview inputs');
    return {kind:'top-up',intent:request.intent};
   }
  };
  const preview=(prepared:{intent:CreateIntent|TopUpIntent},topUp=false)=>{
   const tolerance='terms' in prepared.intent?[prepared.intent.terms[8],prepared.intent.terms[9]]:prepared.intent.tolerance;
   const reviewedAmounts={...amounts,operation:topUp?'add' as const:'initialize' as const,toleranceN:tolerance[0],toleranceD:tolerance[1]};
   return {amounts:reviewedAmounts,intent:prepared.intent,
   ...(topUp?{positionId:position.positionId,ownerContext:context}:{}),
   prepareFunding:async(confirm:(value:typeof amounts)=>Promise<boolean>)=>{
    count('reviews');if(!await confirm(reviewedAmounts))return null;
    await pause(topUp?'Top-up funding inputs':'Create funding inputs');return {amounts:reviewedAmounts,intent:prepared.intent};
   }};
  };
  const positionCapability={
   readOwnedPositions:async()=>({positions:[{positionId:50n,status:1n}],complete:true}),readPosition:async()=>position,
   restoreExitPreview:async(request:Parameters<PositionCapability['restoreExitPreview']>[0])=>{
    if(new URLSearchParams(location.search).get('restore-error')==='1')throw new Error('could not coalesce error (error={"message":"missing trie node"}, payload=SYNTHETIC_PRIVATE_PAYLOAD)');
    count('blockReads');return {action:'withdraw',exitPhase:'preview',positionId:50n,transactionHash:hash,status:'exit-preview-verified',
     privateAccountingVerified:false,snapshot:position,preview:{amount0:125000000n,amount1:250000000n,burnedShares:500000n,
      remainingShares:500000n,numerator:request.fraction[0],denominator:request.fraction[1]}};
   },
   prepareExitPreview:async(request:Parameters<PositionCapability['prepareExitPreview']>[0])=>{
    count('reviews');if(!await request.confirm({snapshot:position,fraction:request.fraction,gasCap:100000000n} as never))return null;
    await pause('Withdrawal preview inputs');return {kind:'withdraw-preview',fraction:request.fraction};
   },
   prepareAction:async(request:Parameters<PositionCapability['prepareAction']>[0])=>{
    if(request.action!=='withdraw')return forbidden();
    count('reviews');if(!await request.confirm({snapshot:position,recipient:null,fraction:request.fraction,minimums:request.minimums} as never))return null;
    await pause('Withdrawal inputs');throw new Error('Synthetic review ends before withdrawal submission. No tokens moved.');
   },prepareSnapshot:forbidden
  };
  const sender={
   checkCurrentCheapCandidate:async()=>({chainId:BigInt(candidate.chainId),owner,graph:candidate.graph,core:candidate.core,packageSha256:candidate.packageSha256,readyToSign:false}),
   submitPoolPreview:async(prepared:{intent:CreateIntent})=>{count('submissions');return {transactionHash:hash,recover:async()=>preview(prepared)};},
   submitPoolTopUpPreview:async(prepared:{intent:TopUpIntent})=>{count('submissions');return {transactionHash:hash,recover:async()=>preview(prepared,true)};},
   submitPoolPositionAction:async(prepared:{kind:string;fraction:readonly [bigint,bigint]})=>{
    if(prepared.kind!=='withdraw-preview')return forbidden();count('submissions');return {transactionHash:hash,recover:async()=>({
     action:'withdraw',exitPhase:'preview',positionId:50n,transactionHash:hash,status:'exit-preview-verified',privateAccountingVerified:false,snapshot:position,
     preview:{amount0:125000000n,amount1:250000000n,burnedShares:500000n,remainingShares:500000n,numerator:prepared.fraction[0],denominator:prepared.fraction[1]}})};
   },
   waitForCurrentCheapReceipt:async()=>true,readSharedPoolAllowances:async()=>[false,false],
   prepareSharedPoolApproval:forbidden,submitPoolFunding:forbidden,submitPoolTopUpFunding:forbidden,
   recoverCurrentPreparedPoolFundingResult:async()=>null,recoverPendingPoolAttempt:async()=>null,
   recoverCurrentPreparedPoolPositionResult:async()=>null,recoverPendingPoolPositionAttempt:async()=>null
  };
  return {...session,browserProvider:{request:async({method,params}:{method:string;params:unknown[]})=>{
   if(method!=='eth_getBlockByNumber'||params?.[0]!=='latest'||params?.[1]!==false)throw new Error('Only a synthetic local latest-block read is permitted.');
   count('blockReads');return {number:'0x1',hash};
  }},actions:{getCurrentDexPoolFundingCapability:async()=>fundingCapability,getCurrentDexPoolPositionCapability:async()=>positionCapability,
   getCurrentDexSubmissionCapability:async()=>sender}} as unknown as SharedWalletSession;
 });
 return <main className="dex-v2-page"><p>Synthetic Pool handler fixture. Public sample amounts only. No wallet, signatures, RPC or final accounting proof.</p>
  <nav aria-label="Synthetic Pool views">{['Create','Positions'].map(name=><button key={name} disabled={!!stage} aria-current={view===name?'page':undefined} onClick={()=>setView(name)}>{name}</button>)}</nav>
  <section aria-label="Synthetic boundary controls"><p role="status">{stage?`Synthetic stage: ${stage.label}`:'No synthetic stage is pending.'}</p>
   <button disabled={!stage} onClick={()=>stage?.release()}>Release synthetic stage</button><button disabled={!stage} onClick={()=>stage?.reject()}>Reject synthetic stage</button>
   <output aria-label="Synthetic call counters">{JSON.stringify(counts)}</output></section>
  {poolNavigationCheck?<PoolNavigationFixture wallet={wallet}/>:view==='Create'?<CurrentPoolWorkspace sharedWalletSession={wallet} candidateKey="cheap-history" selectedPair={['BCN','HBR']}/>:<CurrentPoolPositionsWorkspace sharedWalletSession={wallet} candidateKey="cheap-history"/>}
 </main>;
}
function LimitSignaturesFixture(){
 const [view,setView]=useState<'create'|'manage'>('create'),[rejectInputs,setRejectInputs]=useState<(()=>void)|null>(null);
 const [counts,setCounts]=useState({reviews:0,inputStages:0,syntheticRefreshes:0,forbiddenSends:0});
 const [wallet]=useState(()=>{
  type LimitCapability=Awaited<ReturnType<NonNullable<Actions['getCurrentDexLimitCapability']>>>;
  const candidate=resolvePreparedDexScope('cheap-history').candidate,hash=`0x${'ab'.repeat(32)}`;
  const result={positionId:52n,context:'synthetic-limit-context',status:0n,closed:false,refreshRequired:false,
   amounts:{unspent:2000000n,proceeds:100000n,sellToken0:true,priceNumerator:2n,priceDenominator:1n,makerMinimum:0n}};
  const count=(key:keyof typeof counts)=>setCounts(value=>({...value,[key]:value[key]+1}));
  const inputs=()=>new Promise<never>((_resolve,reject)=>{count('inputStages');setRejectInputs(()=>()=>{
   setRejectInputs(null);reject(Object.assign(new Error('action rejected (payload=SYNTHETIC_PRIVATE_PAYLOAD)'),{code:'ACTION_REJECTED'}));
  });});
  const capability={
   readOwnedOrders:async()=>({orders:[{positionId:52n,poolTokens:pair.tokens,status:0n,closed:false,context:result.context}],complete:true}),
   prepareLimit:async(request:Parameters<LimitCapability['prepareLimit']>[0])=>{
    count('reviews');if(!await request.confirm(request.intent as never))return null;return inputs();
   },
   prepareOwnerAction:async(request:Parameters<LimitCapability['prepareOwnerAction']>[0])=>{
    if(request.action!=='refresh'&&request.action!=='reprice')return forbidden();
    count('reviews');if(!await request.confirm({snapshot:result} as never))return null;
    if(request.action==='refresh')return {kind:'synthetic-refresh'};return inputs();
   }
  };
  const sender={
   checkCurrentCheapCandidate:async()=>({graph:candidate.graph,core:candidate.core,owner}),
   submitLimit:async()=>{count('forbiddenSends');return forbidden();},
   submitLimitOwner:async(prepared:{kind:string})=>{
    if(prepared.kind!=='synthetic-refresh'){count('forbiddenSends');return forbidden();}
    count('syntheticRefreshes');return {transactionHash:hash,recover:async()=>result};
   },recoverPendingLimitAttempt:async()=>null,prepareSharedLimitApproval:forbidden
  };
  return {...session,browserProvider:{request:async({method,params}:{method:string;params:unknown[]})=>{
   if(method!=='eth_getBlockByNumber'||params?.[0]!=='latest'||params?.[1]!==false)return forbidden();
   return {number:'0x1',hash};
  }},actions:{getCurrentDexLimitCapability:async()=>capability,getCurrentDexSubmissionCapability:async()=>sender}} as unknown as SharedWalletSession;
 });
 return <main><p>Synthetic Limit review fixture. Public sample amounts only. No wallet, signatures, RPC, funded order or accounting proof.</p>
  <nav aria-label="Synthetic Limit views">{(['create','manage']as const).map(name=><button key={name} disabled={!!rejectInputs} onClick={()=>setView(name)}>{name}</button>)}</nav>
  <button disabled={!rejectInputs} onClick={()=>rejectInputs?.()}>Reject synthetic inputs</button>
  <output aria-label="Synthetic Limit counters">{JSON.stringify(counts)}</output>
  <CurrentLimitWorkspace sharedWalletSession={wallet} candidateKey="cheap-history" selectedPair={['BCN','HBR']} view={view}/>
 </main>;
}
function Fixture(){
 const [view,setView]=useState('Orders'),[locked,setLocked]=useState(false);
 const [p2pView,setP2pView]=useState(p2pCheck||'public');
 const wallet=locked?undefined:session;
 const tabs=<nav className="dex-v2-section-tabs dex-desktop-management-navigation" aria-label="Manage views">{['Orders','Positions','History'].map(name=><button key={name} aria-current={view===name?'page':undefined} onClick={()=>setView(name)}>{name}</button>)}</nav>;
 return <div className={`app-shell app-shell-wallet ${p2pCheck?'app-shell-trades':'app-shell-dex-v2'}`} style={{display:'block',minHeight:'100vh'}}>
  <AppHeader headerRef={{current:null}} mobileLinksOpen={false} isMobileNav={false} onToggleMobileLinksOpen={()=>{}} onCloseMobileLinks={()=>{}} subtitle="Private DEX"
   appNavigationControl={<AppHeaderNavigation activePage="dex" onNavigate={()=>{}}/>}
   walletControl={<WalletHeaderPanel primaryButtonClassName="connect-btn wallet-inline-btn wallet-primary-action p2p-wallet-address" primaryButtonLabel="0x2222…2222" menuOpen={false} modeLabel="" menu={null} onPrimaryAction={()=>{}} onToggleMenu={()=>{}} statusActionLabel="Unlock privacy" onStatusAction={()=>{}}/>}/>
  <p>Local layout fixture · synthetic data · no wallet or RPC <button onClick={()=>setLocked(!locked)}>{locked?'Show synthetic data':'Lock privacy'}</button></p>
  {p2pCheck?<main className={`standalone-trades-shell p2p-trading-shell ${p2pView==='create'?'p2p-trading-shell-create p2p-trading-shell-create-with-offers':p2pView==='mine'?'p2p-trading-shell-mine p2p-trading-shell-drawer-open':'p2p-trading-shell-offers-terminal'}`}>
   <TradeMarketOverviewPanel isComposerRoute={p2pView==='create'} marketOverviewClassView={p2pView} tradeViewTabs={<div className="p2p-product-navigation"><TradeViewTabs routeView={p2pView} routeSurfaceView={p2pView} onNavigateDeskView={path=>setP2pView(path==='/otc/orders'?'mine':path==='/otc/limit'?'create':path==='/otc/agent'?'agent':'public')}/></div>}
    createDeskIdentity={{title:'',copy:''}} tradeDeskIdentity={{title:'',copy:''}} openPublicTradeCount={0} receivedOpenTradeOfferCount={0} myOpenTradeCount={0} walletTradeHistoryCount={0} walletError="" tradeActionError=""/>
   <section className={p2pView==='mine'?'p2p-my-trades-section':'p2p-offers-workspace'} aria-label="Fixture trade list"><h2>{p2pView==='mine'?'My trades':'Offers'}</h2><p>Synthetic layout only. No wallet or trade data.</p></section>
   <section className={p2pView==='create'?'standalone-trade-create-panel p2p-trade-workspace-panel':'standalone-trades-section standalone-trade-detail-section'} aria-label="Fixture trade details"><header className="standalone-trades-section-head"><h2>{p2pView==='create'?'Create offer':'Trade details'}</h2></header><p>Select a trade to view details.</p></section>
  </main>:navigationCheck||liquidityCheck||compactSwapCheck?<DexV2Page sharedWalletSession={compactSwapCheck?lockedLayoutSession:undefined} swapCandidate="cheap-history" selectedPair={['BCN','HBR']}/>:<main className="dex-v2-page dex-v2-manage"><ModeNavigation activeMode={view==='Positions'?'positions':'activity'} onSelect={()=>{}}/><section className="dex-v2-main"><div className="dex-v2-content-grid"><div className="dex-v2-form-column">
   {view==='Orders'?<CurrentLimitWorkspace managementNavigation={tabs} sharedWalletSession={wallet} candidateKey="cheap-history" selectedPair={['BCN','HBR']} view="manage"/>:view==='Positions'?<CurrentPoolPositionsWorkspace managementNavigation={tabs} sharedWalletSession={wallet} candidateKey="cheap-history"/>:<CurrentDexActivity managementNavigation={tabs} candidateKey="cheap-history" visible priceDisplayInverted={false} onInspect={()=>{}}/>}
  </div></div></section></main>}
 </div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('token-snapshot')==='1'?<TokenSnapshotFixture/>:poolSignaturesCheck||poolNavigationCheck?<PoolSignaturesFixture/>:limitSignaturesCheck?<LimitSignaturesFixture/>:<Fixture/>);
