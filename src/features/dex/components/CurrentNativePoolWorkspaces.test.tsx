import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentPoolWorkspace from './CurrentPoolWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import { CURRENT_NATIVE_POOL_PROFILE } from '../../../lib/currentDexNativePoolPolicy';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import type { SharedWalletSession } from '../../../lib/walletSession';

// These lifecycle fixtures use the retained native trial, not live admission.
vi.mock('../../../lib/dexV2Deployment',async original=>{
  const actual=await original<typeof import('../../../lib/dexV2Deployment')>();
  return {...actual,CURRENT_CHEAP_DEX_CANDIDATE:actual.resolveCurrentCheapDexCandidate('cheap-native'),
    resolveCurrentCheapDexCandidate: (key: Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0]) =>
      actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-native' : key)};
});

const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[] as unknown[],refs:[] as {current:unknown}[],
  confirm:vi.fn(async()=>true)}));
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return {...actual,
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;
    return [hooks.states[i],(value:unknown)=>{hooks.states[i]=typeof value==='function'?value(hooks.states[i]):value;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}};});
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,
  requestConfirmation:hooks.confirm,resolveConfirmation:()=>{}})}));
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.confirm.mockReset();hooks.confirm.mockResolvedValue(true);vi.unstubAllGlobals();});
type Element=ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>void}>;
const elements=(node:ReactNode):Element[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<{children?:ReactNode}>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
const hash=`0x${'44'.repeat(32)}`;
const active={positionId:20n,context:`0x${'77'.repeat(32)}`,status:1n,producerKind:'snapshot',
  amounts:{classId:0n,amount0:2n*10n**18n,amount1:3n*10n**18n,shares:10n}};
const setup=(positions:object,sender:object,Workspace=CurrentPoolPositionsWorkspace)=>{
  const getSender=vi.fn(async()=>sender),getPositions=vi.fn(async()=>positions);
  const session={walletAddress:`0x${'22'.repeat(20)}`,chainId:Number(candidate.chainId),browserProvider:{request:vi.fn()},
    actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}} as unknown as SharedWalletSession;
  const render=()=>{hooks.index=0;hooks.refIndex=0;return Workspace({sharedWalletSession:session});};
  const button=(name:string)=>elements(render()).find(x=>x.type==='button'&&text(x.props.children)===name)!;
  render();hooks.states[0]='20';
  return {session,render,button,getSender};
};
const settle=()=>vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
const setupFunding=(sender:object,Workspace=CurrentPoolWorkspace)=>{
  const records=new Map<string,string>();
  vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>records.get(key)??null,
    setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)}});
  const preparePoolCreation=vi.fn(),getSender=vi.fn(async()=>sender);
  const session={walletAddress:`0x${'22'.repeat(20)}`,chainId:Number(candidate.chainId),browserProvider:{request:vi.fn()},
    actions:{getCurrentDexPoolFundingCapability:async()=>({preparePoolCreation}),getCurrentDexSubmissionCapability:getSender}} as unknown as SharedWalletSession;
  const render=()=>{hooks.index=0;hooks.refIndex=0;return Workspace({sharedWalletSession:session});};
  const button=(name:string)=>elements(render()).find(x=>x.type==='button'&&text(x.props.children)===name)!;
  render();return {render,button,preparePoolCreation,getSender,records};
};

describe('retained native Pool UI lifecycle with local capabilities',()=>{
  it('loads only through the explicit producer option and holds unadmitted owner controls',async()=>{
    const readPosition=vi.fn(async()=>active),ui=setup({readPosition},{});
    hooks.states[11]=hash;ui.button('Load private position').props.onClick!();await settle();
    expect(readPosition).toHaveBeenCalledWith(20n,{producerHash:hash});
    expect(text(ui.render())).not.toContain('Withdraw selected shares');
    expect(text(ui.render())).not.toContain('Transfer liquidity NFT');
    expect(text(ui.render())).toContain('awaiting current-candidate validation');
  });
  it('uses the authenticated entitlements as both full-close minimums',async()=>{
    const prepareAction=vi.fn(async()=>null),ui=setup({readPosition:async()=>active,prepareAction},{});
    ui.button('Load private position').props.onClick!();await settle();
    hooks.states[2]='0';hooks.states[3]='0';ui.button('Close and withdraw all').props.onClick!();await settle();
    expect(prepareAction).toHaveBeenCalledWith(expect.objectContaining({action:'close',positionId:20n,
      expectedContext:active.context,minimums:[active.amounts.amount0,active.amounts.amount1]}));
  });
  it('reviews a paid snapshot before submission and cancels without a send',async()=>{
    hooks.confirm.mockResolvedValue(false);
    const prepareSnapshot=vi.fn(async(request:{confirm:(review:object)=>Promise<boolean>})=>{
      await request.confirm({positionId:20n,closed:false,gasCap:30_000_000n});return null;});
    const submitPoolPositionAction=vi.fn(),ui=setup({prepareSnapshot},{submitPoolPositionAction});
    ui.button('Review paid private refresh').props.onClick!();await settle();
    expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({title:'Refresh private liquidity claim',
      summaryRows:expect.arrayContaining([{label:'Maximum network fee',value:'0.0015 Test COTI'}])}));
    expect(submitPoolPositionAction).not.toHaveBeenCalled();
    expect(text(ui.render())).toContain('Private snapshot cancelled.');
  });
  it('keeps a mined close incomplete until the fresh CLOSED snapshot verifies payouts and zero shares',async()=>{
    const closed={...active,status:4n,amounts:null},verified={...active,status:4n,amounts:{...active.amounts,shares:0n}};
    const closeResult={action:'close',positionId:20n,snapshot:closed,payouts:[active.amounts.amount0,active.amounts.amount1],status:'closed-proof-required'};
    const snapshotResult={action:'snapshot',positionId:20n,snapshot:verified,producerHash:hash,status:'closed-proof-verified'};
    const submitPoolPositionAction=vi.fn().mockResolvedValueOnce({transactionHash:hash,recover:async()=>closeResult})
      .mockResolvedValueOnce({transactionHash:hash,recover:async()=>snapshotResult});
    const prepareAction=vi.fn(async()=>({action:'close'})),prepareSnapshot=vi.fn(async()=>({action:'snapshot',closed:true}));
    const ui=setup({readPosition:async()=>active,prepareAction,prepareSnapshot},{submitPoolPositionAction});
    ui.button('Load private position').props.onClick!();await settle();
    ui.button('Close and withdraw all').props.onClick!();await settle();
    ui.button('Check position status').props.onClick!();await settle();
    expect(text(ui.render())).toContain('Close mined and payouts checked');
    expect(text(ui.render())).not.toContain('Close complete');
    expect(ui.button('Close and withdraw all').props.disabled).toBe(true);
    expect(ui.button('Review closed-claim verification').props.disabled).toBe(false);
    ui.button('Review closed-claim verification').props.onClick!();await settle();
    ui.button('Check position status').props.onClick!();await settle();
    expect(text(ui.render())).toContain('Close complete: exact private payouts and zero remaining shares verified.');
    expect(ui.button('Review closed-claim verification').props.disabled).toBe(true);
    expect(ui.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),{nativePoolProfile:CURRENT_NATIVE_POOL_PROFILE});
  });
  it('recovers the original private closure after UI remount before using metadata',async()=>{
    const metadata=vi.fn(),recoverCurrentNativePoolPositionResult=vi.fn(async()=>({action:'close',positionId:20n,
      status:'closed-proof-required',snapshot:{...active,status:4n,amounts:null}}));
    const ui=setup({},{recoverCurrentNativePoolPositionResult,recoverPendingPoolPositionAttempt:metadata});
    ui.button('Check position status').props.onClick!();await settle();
    expect(recoverCurrentNativePoolPositionResult).toHaveBeenCalledOnce();expect(metadata).not.toHaveBeenCalled();
    expect(text(ui.render())).toContain('Close mined and payouts checked');expect(text(ui.render())).not.toContain('Close complete');
  });
  it('does not report a metadata-only mined close as privately complete',async()=>{
    const ui=setup({},{recoverCurrentNativePoolPositionResult:async()=>null,
      recoverPendingPoolPositionAttempt:async()=>({status:'observed-mined'})});
    ui.button('Check position status').props.onClick!();await settle();
    expect(text(ui.render())).toContain('No private payout is confirmed');expect(text(ui.render())).not.toContain('Close complete');
    expect(text(ui.render())).not.toContain('Private shares');
  });
  it('does not expose private results after the selected wallet changes',async()=>{
    let finish:(value:object)=>void=()=>{};
    const recoverCurrentNativePoolPositionResult=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const ui=setup({},{recoverCurrentNativePoolPositionResult});ui.button('Check position status').props.onClick!();
    await vi.waitFor(()=>expect(recoverCurrentNativePoolPositionResult).toHaveBeenCalledOnce());
    ui.session.walletAddress=`0x${'33'.repeat(20)}`;ui.render();
    finish({action:'snapshot',positionId:20n,producerHash:hash,status:'active-snapshot-verified',snapshot:active});await settle();
    expect(text(ui.render())).not.toContain('Private shares');expect(text(ui.render())).not.toContain('Fresh private claim verified.');
  });
  it('cannot replace a retained funding preparation with a new preview',()=>{
    hooks.index=0;hooks.refIndex=0;CurrentPoolWorkspace({});
    hooks.states[10]={value:{},scope:{}};
    hooks.index=0;hooks.refIndex=0;const node=CurrentPoolWorkspace({});
    expect(elements(node).find(x=>x.type==='button'&&text(x.props.children)==='Review deposit')?.props.disabled).toBe(true);
  });
  it('resumes original same-lease funding and exact approvals without requesting a new preview',async()=>{
    const amounts={operation:'add',used0:2n*10n**18n,used1:3n*10n**18n,unused0:98n*10n**18n,
      unused1:97n*10n**18n,mintedShares:10n,ownedShares:10n,toleranceN:1n,toleranceD:200n};
    const funding={amounts},preview={amounts};
    const readCurrentNativePoolResume=vi.fn(async()=>({funding,previewResult:preview,previewHash:hash,
      approvals:[true,false],unfundedFailed:false,completed:false,originalPreviewRetryEligible:false}));
    const metadata=vi.fn(),ui=setupFunding({recoverCurrentNativePoolFundingResult:async()=>null,
      readCurrentNativePoolResume,recoverPendingPoolAttempt:metadata});
    ui.button('Check Pool status').props.onClick!();await settle();
    expect(hooks.states[10]).toEqual({value:funding,scope:hooks.refs[0].current});
    expect(ui.button('Test token 1 approval verified').props.disabled).toBe(true);
    expect(ui.button('Approve exact Test token 0').props.disabled).toBe(false);
    expect(ui.button('Review and fund Pool').props.disabled).toBe(true);
    expect(ui.preparePoolCreation).not.toHaveBeenCalled();expect(metadata).not.toHaveBeenCalled();
  });
  it('reviews the correct canonical token and unequal allowance before approval, with no send on cancel',async()=>{
    const funding={amounts:{used0:2n*10n**18n,used1:3n*10n**18n}};
    const preparePoolApproval=vi.fn(async(original:unknown,index:0|1,review:(values:object)=>Promise<boolean>)=>{
      expect(original).toBe(funding);expect(index).toBe(0);
      await review({amount:funding.amounts.used0,previousAllowance:0n,spender:candidate.core});return null;});
    const submitCurrentTokenFunding=vi.fn(),ui=setupFunding({checkCurrentCheapCandidate:async()=>({chainId:BigInt(candidate.chainId),
      owner:`0x${'22'.repeat(20)}`,graph:candidate.graph,core:candidate.core,packageSha256:candidate.packageSha256,readyToSign:false}),preparePoolApproval,submitCurrentTokenFunding});
    hooks.states[10]={value:funding,scope:hooks.refs[0].current};hooks.confirm.mockResolvedValue(false);
    ui.button('Approve exact Test token 1').props.onClick!();await settle();
    expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({summaryRows:expect.arrayContaining([
      {label:'Token',value:'Test token 1'},{label:'Approval',value:'2.0'},{label:'Previous allowance',value:'0.0'}])}));
    expect(submitCurrentTokenFunding).not.toHaveBeenCalled();expect(ui.preparePoolCreation).not.toHaveBeenCalled();
  });
  it.each([false,true])('stops only a reviewed unsigned deposit and exposes only required zero clears (bothZero=%s)',async bothZero=>{
    const funding={amounts:{used0:2n*10n**18n,used1:3n*10n**18n}},allowances=bothZero?[0n,0n]:[2n*10n**18n,0n];
    const abandonCurrentNativePoolFunding=vi.fn(async(review:(values:object)=>Promise<boolean>)=>{
      if(!await review({allowances,scope:'original-pool',readyToSign:false}))return null;
      return {status:bothZero?'unfunded-allowances-cleared':'unfunded-abandoned',cleanupRequired:[!bothZero,false],readyToSign:false};});
    const submitCurrentTokenFunding=vi.fn(),ui=setupFunding({checkCurrentCheapCandidate:async()=>({chainId:BigInt(candidate.chainId),
      owner:`0x${'22'.repeat(20)}`,graph:candidate.graph,core:candidate.core,packageSha256:candidate.packageSha256,readyToSign:false}),abandonCurrentNativePoolFunding,submitCurrentTokenFunding});
    hooks.states[10]={value:funding,scope:hooks.refs[0].current};hooks.states[19]=true;
    ui.button('Review stop and clear approvals').props.onClick!();await settle();
    expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({title:'Stop this unfunded Pool deposit',
      summaryRows:expect.arrayContaining([{label:'Test token 1 unused approval',value:bothZero?'0.0':'2.0'},
        {label:'Next action',value:'Clear only the remaining approvals. This deposit cannot be funded or restarted.'}])}));
    expect(submitCurrentTokenFunding).not.toHaveBeenCalled();expect(ui.preparePoolCreation).not.toHaveBeenCalled();
    expect(ui.button('Approve exact Test token 0').props.disabled).toBe(true);
    expect(ui.button('Review and fund Pool').props.disabled).toBe(true);
    if(bothZero)expect(text(ui.render())).toContain('Both approvals are zero; no cleanup transaction is required.');
    else{expect(ui.button('Clear Test token 1 approval').props.disabled).toBe(false);expect(ui.button('Clear Test token 0 approval').props.disabled).toBe(true);}
  });
  it('keeps stop disabled until backend eligibility is restored and cancel preserves the original preparation',async()=>{
    const abandonCurrentNativePoolFunding=vi.fn(async(review:(values:object)=>Promise<boolean>)=>{
      await review({allowances:[2n*10n**18n,0n],scope:'original-pool',readyToSign:false});return null;});
    const ui=setupFunding({checkCurrentCheapCandidate:async()=>({chainId:BigInt(candidate.chainId),owner:`0x${'22'.repeat(20)}`,
      graph:candidate.graph,core:candidate.core,packageSha256:candidate.packageSha256,readyToSign:false}),abandonCurrentNativePoolFunding});
    const original={value:{amounts:{}},scope:hooks.refs[0].current};hooks.states[10]=original;
    expect(ui.button('Review stop and clear approvals').props.disabled).toBe(true);
    ui.button('Review stop and clear approvals').props.onClick!();expect(abandonCurrentNativePoolFunding).not.toHaveBeenCalled();
    hooks.states[19]=true;hooks.confirm.mockResolvedValue(false);ui.button('Review stop and clear approvals').props.onClick!();await settle();
    expect(hooks.states[10]).toBe(original);expect(hooks.states[16]).toBe(false);expect(hooks.states[17]).toBe(false);
    expect(text(ui.render())).toContain('Deposit stop cancelled. No approval was changed.');
  });
  it.each(['approval-0','clear-0'])('does not show a reverted %s as verified or cleared',async phase=>{
    const funding={amounts:{}},cleanup=phase==='clear-0';
    const sender={checkCurrentCheapCandidate:async()=>({chainId:BigInt(candidate.chainId),owner:`0x${'22'.repeat(20)}`,
      graph:candidate.graph,core:candidate.core,packageSha256:candidate.packageSha256,readyToSign:false}),readCurrentNativePoolResume:async()=>({funding,
      approvals:cleanup?[true,true]:[false,true],unfundedFailed:true,completed:false,unfundedAbandonEligible:false})};
    const ui=setupFunding(sender);hooks.states[10]={value:funding,scope:hooks.refs[0].current};
    hooks.states[13]={phase,scope:hooks.refs[0].current,recover:async()=>({token:candidate.tokens[1][0],fundingOutcome:'reverted'})};
    ui.button('Check Pool status').props.onClick!();await settle();
    expect(text(ui.render())).toContain('approval transaction reverted. Its allowance was not changed.');
    expect(hooks.states[11]).toEqual(cleanup?[true,true]:[false,true]);expect(hooks.states[12]).toEqual(cleanup?[false,false]:[true,false]);
    expect(hooks.states[17]).toBe(false);expect(text(ui.render())).not.toContain('unused approval cleared.');
  });
  it('recovers the original token closure after remount before metadata and completes only from the same-lease zero proof',async()=>{
    const metadata=vi.fn(),funding={amounts:{}},recoverCurrentNativePoolTokenResult=vi.fn(async()=>({
      token:candidate.tokens[1][0],fundingOutcome:'verified'}));
    const ui=setupFunding({recoverCurrentNativePoolTokenResult,recoverPendingCurrentTokenFunding:metadata,
      readCurrentNativePoolResume:async()=>({funding,approvals:[false,false],unfundedFailed:true,completed:true,unfundedAbandonEligible:false})});
    ui.records.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:String(candidate.chainId),
      owner:`0x${'22'.repeat(20)}`,core:candidate.core,graph:`0x${candidate.graph}`,phase:'token-approve',callHash:hash,nonce:0,txHash:hash}));
    ui.button('Check Pool status').props.onClick!();await settle();
    expect(recoverCurrentNativePoolTokenResult).toHaveBeenCalledOnce();expect(metadata).not.toHaveBeenCalled();
    expect(hooks.states[17]).toBe(true);expect(hooks.states[12]).toEqual([true,true]);
    expect(text(ui.render())).toContain('Both unused approvals are zero. The unfunded Pool attempt is complete.');
  });
});

describe('actual current d06 Pool boundary',()=>{
  it('retains real native submission rejection',async()=>{
    const actual=await vi.importActual<typeof import('../../../lib/dexV2Deployment')>('../../../lib/dexV2Deployment');
    expect(actual.CURRENT_CHEAP_DEX_CANDIDATE).toBe(actual.resolveCurrentCheapDexCandidate('cheap-d06'));
    expect(()=>actual.assertCurrentCheapDexNativeAdmission(actual.CURRENT_CHEAP_DEX_CANDIDATE))
      .toThrow('Successor DEX native App submission admission is absent.');
  });
  it('uses public position metadata without native closure authority or paid refresh',async()=>{
    vi.doMock('../../../lib/dexV2Deployment',()=>vi.importActual('../../../lib/dexV2Deployment'));vi.resetModules();
    const {default:Positions}=await import('./CurrentPoolPositionsWorkspace');
    const native=vi.fn(),metadata=vi.fn(async()=>({status:'observed-mined'})),submit=vi.fn();
    const ui=setup({},{recoverCurrentNativePoolPositionResult:native,recoverPendingPoolPositionAttempt:metadata,
      submitPoolPositionAction:submit},Positions);
    expect(text(ui.render())).not.toContain('Review paid private refresh');
    ui.button('Check position status').props.onClick!();await settle();
    expect(ui.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),undefined);
    expect(metadata).toHaveBeenCalledOnce();expect(native).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
    expect(text(ui.render())).toContain('No private payout is confirmed');
    expect(text(ui.render())).not.toContain('Close complete');expect(text(ui.render())).not.toContain('Private shares');
  });
  it('uses public funding metadata without native resume or token proof authority',async()=>{
    vi.doMock('../../../lib/dexV2Deployment',()=>vi.importActual('../../../lib/dexV2Deployment'));vi.resetModules();
    const {default:Pool}=await import('./CurrentPoolWorkspace');
    const native=vi.fn(),resume=vi.fn(),token=vi.fn(),metadata=vi.fn(async()=>({status:'observed-mined'})),submit=vi.fn();
    const ui=setupFunding({recoverCurrentNativePoolFundingResult:native,readCurrentNativePoolResume:resume,
      recoverCurrentNativePoolTokenResult:token,recoverPendingPoolAttempt:metadata,submitCurrentTokenFunding:submit},Pool);
    expect(text(ui.render())).not.toContain('Review stop and clear approvals');
    ui.button('Check Pool status').props.onClick!();await settle();
    expect(ui.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),undefined);
    expect(metadata).toHaveBeenCalledOnce();expect(native).not.toHaveBeenCalled();expect(resume).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(ui.preparePoolCreation).not.toHaveBeenCalled();
    expect(hooks.states[10]).toBeNull();expect(hooks.states[17]).toBe(false);
    expect(text(ui.render())).toContain('no funding or NFT amount is confirmed');
  });
});
