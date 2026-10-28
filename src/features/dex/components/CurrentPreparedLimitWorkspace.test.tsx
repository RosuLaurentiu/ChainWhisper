import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import CurrentOwnedLimits from './CurrentOwnedLimits';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import type { SharedWalletSession } from '../../../lib/walletSession';

const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[]as unknown[],refs:[]as {current:unknown}[],confirm:vi.fn(async()=>true),allowNative:false,forceSwapAdmission:false}));
// Only local UI wiring tests pass the hold. The hold test uses the real admission.
vi.mock('../../../lib/dexV2Deployment',async original=>{
  const actual=await original<typeof import('../../../lib/dexV2Deployment')>();
  return {...actual,assertCurrentCheapDexNativeAdmission:(value:Parameters<typeof actual.assertCurrentCheapDexNativeAdmission>[0])=>{
    if(hooks.forceSwapAdmission||!hooks.allowNative)actual.assertCurrentCheapDexNativeAdmission(value);
  }};
});
vi.mock('../../../lib/currentDexC1SwapPolicy',async original=>{
  const actual=await original<typeof import('../../../lib/currentDexC1SwapPolicy')>();
  return {...actual,assertCurrentAppLimitAuthority:(...args:Parameters<typeof actual.assertCurrentAppLimitAuthority>)=>{if(!hooks.allowNative)actual.assertCurrentAppLimitAuthority(...args);},assertCurrentD06AppAuthority:(graph:string)=>{if(!hooks.allowNative)actual.assertCurrentD06AppAuthority(graph);}};
});
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:hooks.confirm,resolveConfirmation:vi.fn()})}));
type Props={children?:ReactNode;disabled?:boolean;onClick?:()=>void;'aria-label'?:string};
const elements=(node:ReactNode):ReactElement<Props>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<Props>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<Props>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
const owner=`0x${'22'.repeat(20)}`;
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.allowNative=false;hooks.forceSwapAdmission=false;vi.clearAllMocks();vi.unstubAllGlobals();});

describe.each(['cheap-prepared','cheap-exit']as const)('%s selected Limit market',key=>{
  const candidate=resolveCurrentCheapDexCandidate(key),pairs=readCurrentDexDisplay(candidate).pairs;
  function fixture(index=0,candidateKey:CurrentCheapDexCandidateKey=key){
    const activeCandidate=resolveCurrentCheapDexCandidate(candidateKey),activePairs=readCurrentDexDisplay(activeCandidate).pairs;
    const store=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value),removeItem:(key:string)=>store.delete(key)}});
    const prepareLimit=vi.fn(async(input:{intent:unknown;confirm:(value:unknown)=>Promise<boolean>})=>{
      await input.confirm(input.intent);return null;
    }),prepareOwnerAction=vi.fn(async()=>null),submitLimit=vi.fn(),submitLimitOwner=vi.fn();
    const sender={checkCurrentCheapCandidate:vi.fn(async()=>({graph:activeCandidate.graph,core:activeCandidate.core,owner})),submitLimit,submitLimitOwner,submitSharedLimitApproval:vi.fn(),recoverPendingLimitAttempt:vi.fn(async()=>null)};
    const getLimit=vi.fn(async()=>({prepareLimit,prepareOwnerAction})),getSender=vi.fn(async()=>sender),request=vi.fn(async()=>({number:'0x1',hash:`0x${'11'.repeat(32)}`}));
    const props={candidateKey:candidateKey,selectedPair:activePairs[index].tokens.map(token=>token.label)as[string,string],priceDisplayInverted:false,view:'create'as'create'|'manage',
      sharedWalletSession:{walletAddress:owner,chainId:Number(activeCandidate.chainId),browserProvider:{request},sessionOnboardInfo:{[owner]:{aesKey:'session-only'}},walletAesHealthByAddress:{},actions:{getCurrentDexLimitCapability:getLimit,getCurrentDexSubmissionCapability:getSender}}as unknown as SharedWalletSession};
    const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentLimitWorkspace(props);};
    const button=(label:string)=>elements(render()).find(element=>element.type==='button'&&text(element.props.children)===label)!;
    render();return{props,render,button,prepareLimit,prepareOwnerAction,getLimit,getSender,request,sender,store};
  }
  it.runIf(key==='cheap-exit')('verifies a saved top-up through a fresh owner capability without sending it again',async()=>{
    const f=fixture(),transactionHash=`0x${'55'.repeat(32)}`,proof={result:{positionId:55n,refreshRequired:true}};
    f.sender.recoverPendingLimitAttempt.mockResolvedValueOnce({status:'manual-reconciliation-required',verificationBlocked:true,readyToSign:false,topUp:{positionId:55n,transactionHash}}as never);
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(text(f.render())).toContain('Verify existing top-up');hooks.states[19]='0.25';
    const verifyMinedTopUp=vi.fn(async()=>proof),reconcileMinedTopUp=vi.fn(async()=>proof.result);
    f.getLimit.mockResolvedValue({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,verifyMinedTopUp}as never);Object.assign(f.sender,{reconcileMinedTopUp});
    f.button('Verify existing top-up').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(verifyMinedTopUp).toHaveBeenCalledWith({transactionHash,positionId:55n,expectedAmount:250000n});expect(reconcileMinedTopUp).toHaveBeenCalledWith(proof);
    expect(f.sender.submitLimit).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();expect(f.prepareOwnerAction).not.toHaveBeenCalled();
    expect(text(f.render())).toContain('Existing top-up debit and remaining allowance verified');
  });
  it.each(pairs.map((_,index)=>index))('uses selected pair %i for both directions and price orientations',async index=>{
    hooks.allowNative=true;const f=fixture(index),pair=pairs[index];
    for(const reversed of [false,true])for(const inverted of [false,true])for(const sellToken0 of [false,true]){
      f.props.selectedPair=(reversed?[pair.tokens[1].label,pair.tokens[0].label]:pair.tokens.map(token=>token.label))as[string,string];
      f.props.priceDisplayInverted=inverted;hooks.states[0]=sellToken0;hooks.states[1]='1.234567';hooks.states[2]='2';hooks.states[3]='0.000001';
      const base=(reversed!==inverted)?pair.tokens[1]:pair.tokens[0],quote=base===pair.tokens[0]?pair.tokens[1]:pair.tokens[0];
      const view=text(f.render());expect(view).toContain(`Amount (${pair.tokens[sellToken0?0:1].label})`);expect(view).toContain(`${quote.label} per ${base.label}`);
      expect(view).toContain(`You receive ${pair.tokens[sellToken0?1:0].label}`);
      expect(view).toContain(`${sellToken0===(base===pair.tokens[0])?'Sell':'Buy'} ${base.label}`);
      f.button('Review order').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
      const terms=base===pair.tokens[0]?[1n,2n,1n,1n,0n]:[2n,1n,1n,1n,1n];
      expect(f.prepareLimit).toHaveBeenLastCalledWith(expect.objectContaining({intent:{sellToken0,amount:1234567n,terms}}));
      expect(f.getLimit).toHaveBeenLastCalledWith(BigInt(candidate.chainId),{candidate:key,selectedPair:pair.tokens.map(token=>token.address)});
      expect(f.getSender).toHaveBeenLastCalledWith(BigInt(candidate.chainId),{candidate:key});
      expect(hooks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({message:expect.stringContaining('Post-only'),summaryRows:expect.arrayContaining([
        {label:'Offered budget',value:'1.234567'},{label:`Maker minimum (${pair.tokens[sellToken0?0:1].label})`,value:'0.000001'}
      ])}));
    }
    expect(f.sender.submitLimit).not.toHaveBeenCalled();
  });
  it.each(['1.0000001','1e3','-1'])('rejects inexact or invalid token budget %s before capability reads',async amount=>{
    hooks.allowNative=true;const f=fixture();hooks.states[1]=amount;hooks.states[2]='2';f.button('Review order').props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(f.getSender).not.toHaveBeenCalled();expect(f.getLimit).not.toHaveBeenCalled();expect(text(f.render())).toContain('at most 6 decimal places');
  });
  it('rejects an inexact maker minimum in offered-token units',async()=>{
    hooks.allowNative=true;const f=fixture();hooks.states[1]='1';hooks.states[2]='2';hooks.states[3]='0.0000001';f.button('Review order').props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(f.getSender).not.toHaveBeenCalled();expect(text(f.render())).toContain('at most 6 decimal places');
  });
  it.each([undefined,['EMBR','EMBR'],['unknown','ORBT']].map(selectedPair=>({selectedPair})))('requires a valid explicit selected pair $selectedPair',({selectedPair})=>{
    const f=fixture();f.props.selectedPair=selectedPair as[string,string];expect(()=>f.render()).toThrow();expect(f.getLimit).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();
  });
  it.each(['Review order','Load private order'])('holds real candidate before wallet calls for %s',async label=>{
    const f=fixture();hooks.states[1]='1';hooks.states[2]='2';hooks.states[10]='9';f.props.view=label==='Load private order'?'manage':'create';
    expect(f.button(label).props.disabled).toBeFalsy();f.button(label).props.onClick!();
    await vi.waitFor(()=>expect(text(f.render())).toContain(key==='cheap-exit'&&label==='Load private order'?'connected App-wallet hold remains active':'native App submission admission is absent'));
    expect(f.getLimit).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();expect(hooks.confirm).not.toHaveBeenCalled();
    expect(f.sender.submitLimit).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();
  });
  function privateOwnerFixture(){
    const f=fixture();f.props.view='manage';hooks.states[10]='9';f.render();
    const result={positionId:9n,context:'test-only-context',status:0n,closed:false,refreshRequired:false,amounts:{unspent:1234567n,proceeds:2345678n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}};
    const capability={prepareOwnerAction:vi.fn(async()=>null)};
    hooks.states[11]={value:result,capability,scope:hooks.refs[0].current};return{...f,result,capability};
  }
  it.each([true,false])('reviews exact owner edits in offered-token units (sellToken0=%s)',async sellToken0=>{
    if(key!=='cheap-exit')return;
    hooks.allowNative=true;const f=privateOwnerFixture();f.result.amounts.sellToken0=sellToken0;
    hooks.states[14]='1.234567';hooks.states[15]='2';hooks.states[16]='0.000001';
    expect(text(f.render())).toContain('Top-up amount');expect(text(f.render())).toContain(`${pairs[0].tokens[1].label} per ${pairs[0].tokens[0].label}`);
    f.button('Review top-up').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.capability.prepareOwnerAction).toHaveBeenLastCalledWith(expect.objectContaining({action:'topup',topUpAmount:1234567n,snapshot:f.result,expectedContext:f.result.context}));
    f.button('Review new price').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.capability.prepareOwnerAction).toHaveBeenLastCalledWith(expect.objectContaining({action:'reprice',newTerms:[1n,2n,1n,1n,0n],snapshot:f.result}));
    expect(text(f.render())).toContain('1.234567');
  });
  it.each(['topup','reprice']as const)('rejects %s input drift during preparation before review',async action=>{
    if(key!=='cheap-exit')return;hooks.allowNative=true;const f=privateOwnerFixture();hooks.states[14]='1';hooks.states[15]='2';
    const prepare=vi.fn(async(input:{confirm:(review:unknown)=>Promise<boolean>})=>{
      hooks.states[action==='topup'?14:15]='3';f.render();await input.confirm({snapshot:f.result});return{};
    });Object.assign(f.capability,{prepareOwnerAction:prepare});
    f.button(action==='topup'?'Review top-up':'Review new price').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(hooks.confirm).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(text(f.render())).toContain('Limit edit inputs changed');expect(text(f.render())).not.toContain('1.234567');
  });
  it.each(['topup','reprice','allowance']as const)('clears private authority after stale source during %s preparation',async action=>{
    if(key!=='cheap-exit')return;hooks.allowNative=true;const f=privateOwnerFixture();hooks.states[14]='1';hooks.states[15]='2';
    const prepare=vi.fn(async()=>{throw Error('Limit source or wallet changed');});Object.assign(f.capability,action==='allowance'?{prepareFundingReview:prepare}:{prepareOwnerAction:prepare});
    f.button(action==='allowance'?'Review exact top-up allowance':action==='topup'?'Review top-up':'Review new price').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(prepare).toHaveBeenCalledOnce();expect(hooks.states[11]).toBeNull();expect(text(f.render())).not.toContain('1.234567');expect(text(f.render())).toContain('Limit source or wallet changed');expect(f.getSender).not.toHaveBeenCalled();
  });
  it('retains the authenticated snapshot for a local minimum uint128 error',async()=>{
    if(key!=='cheap-exit')return;hooks.allowNative=true;const f=privateOwnerFixture();hooks.states[15]='2';hooks.states[16]=(1n<<128n).toString();
    f.button('Review new price').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.capability.prepareOwnerAction).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(text(f.render())).toContain('Maker minimum must fit uint128');expect(text(f.render())).toContain('1.234567');
  });
  it.each(['Review top-up','Review new price','Review exact top-up allowance','Review exact order allowance'])('holds %s before wallet preparation',async label=>{
    if(key!=='cheap-exit')return;const f=privateOwnerFixture();if(label==='Review exact order allowance')hooks.states[1]='1';hooks.states[14]='1';hooks.states[15]='2';
    f.button(label).props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.capability.prepareOwnerAction).not.toHaveBeenCalled();expect(f.getLimit).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(hooks.confirm).not.toHaveBeenCalled();
    expect(text(f.render())).toContain(label==='Review exact order allowance'?'native App submission admission is absent':'connected App-wallet hold remains active');
  });
  it('uses the authenticated management market for edits after the trade pair changes',async()=>{
    if(key!=='cheap-exit')return;hooks.allowNative=true;const f=privateOwnerFixture();hooks.states[13]=pairs[1].tokens.map(token=>token.address);f.render();
    hooks.states[11]={value:f.result,capability:f.capability,scope:hooks.refs[0].current};hooks.states[14]='1.234567';hooks.states[15]='2';hooks.states[16]='0.000001';
    expect(text(f.render())).toContain(`Top-up amount (${pairs[1].tokens[0].label})`);
    f.button('Review new price').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(f.capability.prepareOwnerAction).toHaveBeenCalledWith(expect.objectContaining({action:'reprice',newTerms:[1n,2n,1n,1n,0n]}));
  });
  it.each(['create','topup']as const)('checks exact %s allowance separately and prepares the Core action again',async kind=>{
    if(key!=='cheap-exit')return;hooks.allowNative=true;const f=privateOwnerFixture();hooks.states[1]='1.25';hooks.states[2]='2';hooks.states[14]='1.25';f.render();hooks.states[11]={value:f.result,capability:f.capability,scope:hooks.refs[0].current};
    const funding={review:true},prepareFundingReview=vi.fn(async()=>funding),recover=vi.fn(async()=>({fundingOutcome:'verified',privateAccountingVerified:true}));
    Object.assign(f.capability,{prepareFundingReview});f.getLimit.mockImplementation(async()=>({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,prepareFundingReview}));
    const prepareSharedLimitApproval=vi.fn(async(input:{funding:unknown;confirm:(review:unknown)=>Promise<boolean>})=>{
      await input.confirm({token:pairs[0].tokens[0].address,amount:1250000n,previousAllowance:0n,spender:candidate.core});return{approval:true};
    }),submitSharedLimitApproval=vi.fn(async()=>({transactionHash:'approval-hash',recover}));Object.assign(f.sender,{prepareSharedLimitApproval,submitSharedLimitApproval});
    f.button(kind==='create'?'Review exact order allowance':'Review exact top-up allowance').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(prepareFundingReview).toHaveBeenCalledWith(kind==='create'?{kind,sellToken0:true,amount:1250000n}:expect.objectContaining({kind,positionId:9n,snapshot:f.result,amount:1250000n}));
    expect(f.prepareLimit).not.toHaveBeenCalled();expect(f.capability.prepareOwnerAction).not.toHaveBeenCalled();expect(submitSharedLimitApproval).toHaveBeenCalledOnce();
    expect(hooks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({summaryRows:expect.arrayContaining([{label:'Exact allowance',value:'1.25'},{label:'Previous allowance',value:'0.0'},{label:'Core spender',value:candidate.core}])}));
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(recover).toHaveBeenCalledOnce();expect(hooks.states[5]).toBe(false);expect(text(f.render())).toContain('Exact private Limit allowance verified');expect(text(f.render())).toContain('1.234567');
    f.button(kind==='create'?'Review order':'Review top-up').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(kind==='create'?f.prepareLimit:f.capability.prepareOwnerAction).toHaveBeenCalledOnce();
  });
  it.each(['create','topup']as const)('allows cheap-history %s allowance without swap admission',async kind=>{
    if(key!=='cheap-prepared')return;
    hooks.allowNative=true;hooks.forceSwapAdmission=true;
    const historyCandidate=resolveCurrentCheapDexCandidate('cheap-history'),historyPairs=readCurrentDexDisplay(historyCandidate).pairs,f=fixture(0,'cheap-history');let snapshot:unknown;
    const funding={review:true},prepareFundingReview=vi.fn(async()=>funding);
    if(kind==='topup'){
      f.props.view='manage';hooks.states[10]='9';f.render();
      snapshot={positionId:9n,context:'test-only-context',status:0n,closed:false,refreshRequired:false,amounts:{unspent:1234567n,proceeds:2345678n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}};
      hooks.states[11]={value:snapshot,capability:{prepareOwnerAction:vi.fn(async()=>null),prepareFundingReview},scope:hooks.refs[0].current};
      hooks.states[14]='1.25';
    } else { hooks.states[1]='1.25';hooks.states[2]='2'; }
    if(kind==='create')f.getLimit.mockImplementation(async()=>({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,prepareFundingReview}) as never);
    const prepareSharedLimitApproval=vi.fn(async(input:{confirm:(review:unknown)=>Promise<boolean>})=>{
      await input.confirm({token:historyPairs[0].tokens[0].address,amount:1250000n,previousAllowance:0n,spender:historyCandidate.core});return null;
    });Object.assign(f.sender,{prepareSharedLimitApproval});
    f.button(kind==='create'?'Review exact order allowance':'Review exact top-up allowance').props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(prepareFundingReview).toHaveBeenCalledOnce();
    expect(prepareFundingReview).toHaveBeenCalledWith(kind==='create'?{kind,sellToken0:true,amount:1250000n}:{kind,positionId:9n,snapshot,expectedContext:'test-only-context',amount:1250000n});
    if(kind==='create')expect(f.getLimit).toHaveBeenCalledWith(BigInt(historyCandidate.chainId),{candidate:'cheap-history',selectedPair:historyPairs[0].tokens.map(token=>token.address)});
    expect(prepareSharedLimitApproval).toHaveBeenCalledWith(expect.objectContaining({funding,confirm:expect.any(Function)}));
    expect(hooks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({summaryRows:expect.arrayContaining([{label:'Exact allowance',value:'1.25'},{label:'Core spender',value:historyCandidate.core}])}));
    expect(prepareSharedLimitApproval).toHaveBeenCalledOnce();
    expect(f.sender.submitSharedLimitApproval).not.toHaveBeenCalled();expect(f.sender.submitLimit).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();
  });
  it.each(['create','topup']as const)('keeps cheap-history %s allowance behind the real App signing hold',async kind=>{
    if(key!=='cheap-prepared')return;
    const f=fixture(0,'cheap-history');
    const prepareFundingReview=vi.fn(async()=>({review:true}));
    if(kind==='create'){
      hooks.states[1]='1.25';hooks.states[2]='2';
      f.getLimit.mockImplementation(async()=>({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,prepareFundingReview}) as never);
    }else{
      f.props.view='manage';hooks.states[10]='9';f.render();
      const snapshot={positionId:9n,context:'test-only-context',status:0n,closed:false,refreshRequired:false,amounts:{unspent:1234567n,proceeds:2345678n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}};
      hooks.states[11]={value:snapshot,capability:{prepareOwnerAction:vi.fn(async()=>null),prepareFundingReview},scope:hooks.refs[0].current};hooks.states[14]='1.25';
    }
    f.button(kind==='create'?'Review exact order allowance':'Review exact top-up allowance').props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(text(f.render())).toContain('Shared-history DEX App signing hold remains active');
    expect(prepareFundingReview).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(f.getLimit).not.toHaveBeenCalled();
    expect(hooks.confirm).not.toHaveBeenCalled();expect(f.sender.submitSharedLimitApproval).not.toHaveBeenCalled();
    expect(f.sender.submitLimit).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();
  });
  it('allows cheap-exit top-up allowance without swap admission',async()=>{
    if(key!=='cheap-exit')return;
    hooks.allowNative=true;hooks.forceSwapAdmission=true;
    const f=fixture(0,'cheap-exit');f.props.view='manage';hooks.states[10]='9';f.render();
    const snapshot={positionId:9n,context:'test-only-context',status:0n,closed:false,refreshRequired:false,amounts:{unspent:1234567n,proceeds:2345678n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}};
    const prepareFundingReview=vi.fn(async()=>({review:true}));
    hooks.states[11]={value:snapshot,capability:{prepareOwnerAction:vi.fn(async()=>null),prepareFundingReview},scope:hooks.refs[0].current};hooks.states[14]='1.25';
    const funding={review:true};prepareFundingReview.mockResolvedValue(funding);
    f.getLimit.mockImplementation(async()=>({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,prepareFundingReview}) as never);
    const prepareSharedLimitApproval=vi.fn(async(input:{confirm:(review:unknown)=>Promise<boolean>})=>{
      await input.confirm({token:pairs[0].tokens[0].address,amount:1250000n,previousAllowance:0n,spender:candidate.core});return null;
    });Object.assign(f.sender,{prepareSharedLimitApproval});
    f.button('Review exact top-up allowance').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(prepareFundingReview).toHaveBeenCalledOnce();expect(prepareFundingReview).toHaveBeenCalledWith({kind:'topup',positionId:9n,snapshot,expectedContext:snapshot.context,amount:1250000n});
    expect(prepareSharedLimitApproval).toHaveBeenCalledOnce();
    expect(prepareSharedLimitApproval).toHaveBeenCalledWith(expect.objectContaining({funding,confirm:expect.any(Function)}));
    expect(hooks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({summaryRows:expect.arrayContaining([{label:'Exact allowance',value:'1.25'},{label:'Core spender',value:candidate.core}])}));
    expect(f.sender.submitSharedLimitApproval).not.toHaveBeenCalled();expect(f.sender.submitLimit).not.toHaveBeenCalled();expect(f.sender.submitLimitOwner).not.toHaveBeenCalled();
  });
  it.each(['verified','reverted','bad-accounting']as const)('handles separate allowance recovery outcome %s',async outcome=>{
    if(key!=='cheap-exit')return;const f=privateOwnerFixture(),recover=vi.fn(async()=>({fundingOutcome:outcome,privateAccountingVerified:outcome!=='bad-accounting'}));
    hooks.states[12]={recover,phase:'limit-approval',scope:hooks.refs[0].current};hooks.states[5]=true;
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(recover).toHaveBeenCalledOnce();expect(f.sender.recoverPendingLimitAttempt).not.toHaveBeenCalled();expect(hooks.states[5]).toBe(outcome==='bad-accounting');
    expect(text(f.render())).toContain(outcome==='verified'?'Exact private Limit allowance verified':outcome==='reverted'?'Limit allowance reverted':'Exact Limit allowance accounting is unavailable');expect(text(f.render())).toContain('1.234567');
  });
  it.each(['observed-mined','awaiting-chain-confirmation']as const)('reconciles saved allowance status %s without private delta authority',async status=>{
    if(key!=='cheap-exit')return;const f=fixture(),recoverPendingSharedLimitApproval=vi.fn(async()=>({status,privateAccountingVerified:false}));Object.assign(f.sender,{recoverPendingSharedLimitApproval});
    const record={version:1,owner,chainId:candidate.chainId.toString(),core:candidate.core,graph:`0x${candidate.graph}`,phase:'token-approve',callHash:`0x${'11'.repeat(32)}`,nonce:1,txHash:`0x${'12'.repeat(32)}`};
    vi.stubGlobal('window',{sessionStorage:{getItem:()=>JSON.stringify(record),setItem:vi.fn(),removeItem:vi.fn()}});
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(recoverPendingSharedLimitApproval).toHaveBeenCalledOnce();expect(f.sender.recoverPendingLimitAttempt).not.toHaveBeenCalled();expect(hooks.states[5]).toBe(status!=='observed-mined');expect(text(f.render())).not.toContain('Exact private Limit allowance verified');
  });
  it('selects an owned order in another market and binds its exact pair before refresh',async()=>{
    if(key!=='cheap-exit')return;
    const f=fixture();f.props.view='manage';hooks.allowNative=true;
    const list=elements(f.render()).find(element=>element.type===CurrentOwnedLimits);expect(list).toBeDefined();
    const pair=pairs[1],tokens=pair.tokens.map(token=>token.address)as[string,string];
    (list!.props as unknown as {onSelect:(order:unknown)=>void}).onSelect({positionId:55n,marketId:pair.marketId,poolTokens:tokens,status:0n,closed:false,context:'public-only'});
    f.render();expect(hooks.states[10]).toBe('55');f.button('Load private order').props.onClick!();
    await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));expect(f.getLimit).toHaveBeenCalledWith(7082400n,{candidate:'cheap-exit',selectedPair:tokens});
  });
  function closedOwnerFixture(){
    const f=fixture();f.props.view='manage';const pair=pairs[1],tokens=pair.tokens.map(token=>token.address)as[string,string];
    const result={positionId:55n,context:'closed-discovery',transactionHash:null,status:0n,closed:true,refreshRequired:false,amounts:{unspent:0n,proceeds:0n,sellToken0:true,priceNumerator:3n,priceDenominator:1n,makerMinimum:1n}};
    const readClosedOrder=vi.fn(async()=>result);f.getLimit.mockResolvedValue({prepareLimit:f.prepareLimit,prepareOwnerAction:f.prepareOwnerAction,readClosedOrder}as never);
    hooks.states[7]='previous-order-transaction';const list=elements(f.render()).find(element=>element.type===CurrentOwnedLimits)!;
    (list.props as unknown as {onSelect:(order:unknown)=>void}).onSelect({positionId:55n,marketId:pair.marketId,poolTokens:tokens,status:0n,closed:true,context:'closed-discovery'});
    f.render();return{...f,tokens,result,readClosedOrder};
  }
  it('loads a selected closed order without write admission, sender, or confirmation',async()=>{
    if(key!=='cheap-exit')return;const f=closedOwnerFixture();
    expect(f.button('Load private order').props.disabled).toBeFalsy();f.button('Load private order').props.onClick!();
    await vi.waitFor(()=>expect(f.readClosedOrder).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(f.getLimit).toHaveBeenCalledWith(7082400n,{candidate:'cheap-exit',selectedPair:f.tokens});
    expect(f.readClosedOrder).toHaveBeenCalledWith({positionId:55n,expectedContext:'closed-discovery'});
    expect(text(f.render())).toContain('Closed Limit');expect(text(f.render())).toContain('Private price');expect(text(f.render())).toContain('1/3');
    expect(text(f.render())).not.toContain('previous-order-transaction');
    expect(f.getSender).not.toHaveBeenCalled();expect(f.prepareOwnerAction).not.toHaveBeenCalled();expect(hooks.confirm).not.toHaveBeenCalled();
    for(const label of ['Claim Limit proceeds','Pause Limit','Resume Limit','Close Limit and return funds']){expect(f.button(label).props.disabled).toBe(true);f.button(label).props.onClick!();}
    expect(f.button('Review top-up')).toBeUndefined();expect(f.button('Review new price')).toBeUndefined();
    expect(f.prepareOwnerAction).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();
  });
  it.each(['owner','pair','privacy-key','privacy-health']as const)('rejects a late closed read after %s changes',async change=>{
    if(key!=='cheap-exit')return;const f=closedOwnerFixture();let resolve!:(value:typeof f.result)=>void;
    f.readClosedOrder.mockImplementation(()=>new Promise(done=>{resolve=done;}));f.button('Load private order').props.onClick!();await vi.waitFor(()=>expect(resolve).toBeDefined());
    if(change==='owner')f.props.sharedWalletSession.walletAddress=`0x${'33'.repeat(20)}`;
    if(change==='pair')f.props.selectedPair=pairs[1].tokens.map(token=>token.label)as[string,string];
    if(change==='privacy-key')f.props.sharedWalletSession.sessionOnboardInfo![owner].aesKey='changed-in-place';
    if(change==='privacy-health')f.props.sharedWalletSession.walletAesHealthByAddress![owner]={status:'key-mismatch'}as never;
    f.render();resolve(f.result);await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(hooks.states[11]).toBeNull();expect(text(f.render())).not.toContain('Private price');expect(f.getSender).not.toHaveBeenCalled();
  });
  it('keeps closed reads blocked while an action needs reconciliation',()=>{
    if(key!=='cheap-exit')return;const f=closedOwnerFixture();hooks.states[5]=true;
    expect(f.button('Load private order').props.disabled).toBe(true);f.button('Load private order').props.onClick!();expect(f.readClosedOrder).not.toHaveBeenCalled();
  });
  it.each(['wrong-id','wrong-context','active','refresh-required','missing-amounts']as const)('rejects an invalid closed read result: %s',async invalid=>{
    if(key!=='cheap-exit')return;const f=closedOwnerFixture();f.readClosedOrder.mockResolvedValue({...f.result,
      ...(invalid==='wrong-id'?{positionId:56n}:invalid==='wrong-context'?{context:'other-closed-context'}:invalid==='active'?{closed:false}:invalid==='refresh-required'?{refreshRequired:true}:{amounts:null})}as never);
    f.button('Load private order').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(hooks.states[11]).toBeNull();expect(text(f.render())).toContain('Closed Limit private state is unavailable');expect(f.getSender).not.toHaveBeenCalled();
  });
  it.each(['candidate','pair','pair-order','owner','privacy-key','privacy-health']as const)('hides private snapshot after %s changes',change=>{
    const f=privateOwnerFixture();expect(text(f.render())).toContain('1.234567');expect(text(f.render())).toContain('2.345678');
    expect(f.button('Resume Limit').props.disabled).toBe(true);
    if(change==='candidate')f.props.candidateKey=key==='cheap-exit'?'cheap-prepared':'cheap-exit';
    if(change==='pair')f.props.selectedPair=pairs[1].tokens.map(token=>token.label)as[string,string];
    if(change==='pair-order')f.props.selectedPair=[f.props.selectedPair[1],f.props.selectedPair[0]];
    if(change==='owner')f.props.sharedWalletSession={...f.props.sharedWalletSession,walletAddress:`0x${'33'.repeat(20)}`};
    if(change==='privacy-key')f.props.sharedWalletSession.sessionOnboardInfo![owner].aesKey='changed-in-place';
    if(change==='privacy-health')f.props.sharedWalletSession.walletAesHealthByAddress![owner]={status:'key-mismatch'}as never;
    const view=text(f.render());expect(view).not.toContain('1.234567');expect(view).not.toContain('2.345678');expect(f.button('Claim Limit proceeds')).toBeUndefined();
  });
  it.each(['pair','privacy-key']as const)('keeps a pending accounting checker blocked after %s changes',async change=>{
    const f=privateOwnerFixture(),recover=vi.fn(async()=>{throw Error('Wrong private payout');});
    hooks.states[12]={recover,phase:'limit-owner',scope:hooks.refs[0].current,ownerCapability:f.capability};hooks.states[5]=true;
    if(change==='pair')f.props.selectedPair=pairs[1].tokens.map(token=>token.label)as[string,string];
    else f.props.sharedWalletSession.sessionOnboardInfo![owner].aesKey='changed-in-place';
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(recover).not.toHaveBeenCalled();expect(f.sender.recoverPendingLimitAttempt).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();
    expect(hooks.states[5]).toBe(true);expect(text(f.render())).toContain('Reload and reconcile');
  });
  it('keeps exact accounting failure blocked and does not downgrade to public recovery',async()=>{
    const f=privateOwnerFixture(),recover=vi.fn(async()=>{throw Error('Wrong private payout');});
    hooks.states[12]={recover,phase:'limit-owner',scope:hooks.refs[0].current,ownerCapability:f.capability};hooks.states[5]=true;
    f.button('Check Limit status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[4]).toBe(false));
    expect(recover).toHaveBeenCalledOnce();expect(f.sender.recoverPendingLimitAttempt).not.toHaveBeenCalled();expect(hooks.states[5]).toBe(true);
    expect(text(f.render())).toContain('Wrong private payout');expect(f.button('Load private order').props.disabled).toBe(true);
  });
});
