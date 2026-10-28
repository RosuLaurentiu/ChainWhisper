import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentPreparedPoolTopUpWorkspace from './CurrentPreparedPoolTopUpWorkspace';
import CurrentOwnedPoolPositions from './CurrentOwnedPoolPositions';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { issueCurrentDexPoolPositionCapability } from '../../wallet/currentDexPoolPositionCapability';

const hooks=vi.hoisted(()=>({index:0,refIndex:0,states:[] as unknown[],refs:[] as {current:unknown}[],allowNative:false,confirm:vi.fn(async()=>true)}));
vi.mock('../../../lib/dexV2Deployment',async original=>{
  const actual=await original<typeof import('../../../lib/dexV2Deployment')>();
  return{...actual,assertCurrentCheapDexNativeAdmission:(value:Parameters<typeof actual.assertCurrentCheapDexNativeAdmission>[0])=>{
    if(!hooks.allowNative)actual.assertCurrentCheapDexNativeAdmission(value);
  }};
});
// Explicit UI-mechanics fixtures may simulate authority; real-hold cases keep it off.
vi.mock('../../../lib/currentDexC1SwapPolicy',async original=>{
  const actual=await original<typeof import('../../../lib/currentDexC1SwapPolicy')>();
  return {...actual,assertCurrentD06AppAuthority:(graph:string)=>{if(!hooks.allowNative)actual.assertCurrentD06AppAuthority(graph);},
    assertCurrentAppPoolAuthority:(...args:Parameters<typeof actual.assertCurrentAppPoolAuthority>)=>{if(!hooks.allowNative)actual.assertCurrentAppPoolAuthority(...args);}};
});
vi.mock('../../../lib/currentDexPoolPositionSubmission',async original=>{
  const actual=await original<typeof import('../../../lib/currentDexPoolPositionSubmission')>();
  return {...actual,assertCurrentPoolPositionNativeAdmission:(...args:Parameters<typeof actual.assertCurrentPoolPositionNativeAdmission>)=>{
    if(!hooks.allowNative)actual.assertCurrentPoolPositionNativeAdmission(...args);
  }};
});
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(value:unknown)=>{hooks.states[i]=value;}];},
  useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});}
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState',()=>({default:()=>({confirmation:null,requestConfirmation:hooks.confirm,resolveConfirmation:vi.fn()})}));
type Props={children?:ReactNode;disabled?:boolean;onClick?:()=>void};
const elements=(node:ReactNode):ReactElement<Props>[]=>Array.isArray(node)?node.flatMap(elements):isValidElement<Props>(node)?[node,...elements(node.props.children)]:[];
const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<Props>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
const owner=`0x${'22'.repeat(20)}`,hash=`0x${'33'.repeat(32)}`;
describe.each(['cheap-prepared', 'cheap-exit','cheap-history'] as const)('%s prepared consumers', key => {
const candidate = resolveCurrentCheapDexCandidate(key);
function fixture(pairIndex=0){
  vi.stubGlobal('window',{sessionStorage:{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()}});
  const pair=readCurrentDexDisplay(candidate).pairs[pairIndex];
  const value={positionId:52n,context:hash,status:1n,marketId:pair.marketId,poolTokens:pair.tokens.map(t=>t.address),producerKind:'snapshot',
    amounts:{classId:1n,amount0:1_234_567n,amount1:2_345_678n,shares:100n}};
  const readPosition=vi.fn(async()=>value),prepareSnapshot=vi.fn(async(request:Parameters<Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>['prepareSnapshot']>[0])=>{void request;return null as {action:string}|null;}),prepareAction=vi.fn();
  const prepareExitPreview=vi.fn();
  const getPositions=vi.fn(async()=>({readPosition,prepareSnapshot,prepareAction,prepareExitPreview})),getSender=vi.fn(),request=vi.fn();
  const session={walletAddress:owner,chainId:Number(candidate.chainId),browserProvider:{request},
    actions:{getCurrentDexPoolPositionCapability:getPositions,getCurrentDexSubmissionCapability:getSender}} as unknown as SharedWalletSession;
  const props={sharedWalletSession:session,candidateKey:key as CurrentCheapDexCandidateKey};
  const render=()=>{hooks.index=0;hooks.refIndex=0;return CurrentPoolPositionsWorkspace(props);};
  const button=(label:string)=>elements(render()).find(x=>x.type==='button'&&text(x.props.children)===label)!;
  render();hooks.states[0]='52';
  const load=async()=>{button('Load private position').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));};
  return{props,render,button,load,value,pair,getPositions,getSender,request,readPosition,prepareSnapshot,prepareAction,prepareExitPreview};
}
afterEach(()=>{hooks.states=[];hooks.refs=[];hooks.allowNative=false;vi.clearAllMocks();vi.unstubAllGlobals();});

describe('prepared Positions owner snapshot view',()=>{
  if(key!=='cheap-prepared')it('reveals a selected position and opens its controls without manual lookup',async()=>{
    const f=fixture();hooks.allowNative=true;
    f.readPosition.mockResolvedValue({...f.value,positionId:43n,producerHash:hash} as never);
    const list=elements(f.render()).find(item=>item.type===CurrentOwnedPoolPositions)!;
    (list.props as unknown as {onSelect:(id:bigint)=>void}).onSelect(43n);
    await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.readPosition).toHaveBeenCalledWith(43n,undefined);
    expect(hooks.states[11]).toBe(hash);expect(text(f.render())).toContain('1.234567');
    expect(text(f.render())).toContain('Add liquidity');
    expect(f.getSender).not.toHaveBeenCalled();expect(f.prepareSnapshot).not.toHaveBeenCalled();
  });
  if(key!=='cheap-prepared')it('opens a discovered NFT without keeping the previous claim or producer',async()=>{
    const f=fixture();hooks.allowNative=true;hooks.states[11]=hash;await f.load();
    expect(text(f.render())).toContain('1.234567');
    const list=elements(f.render()).find(item=>item.type===CurrentOwnedPoolPositions)!;
    f.readPosition.mockResolvedValue({...f.value,positionId:43n,amounts:null} as never);
    (list.props as unknown as {onSelect:(id:bigint)=>void}).onSelect(43n);
    expect(hooks.states[0]).toBe('43');expect(hooks.states[11]).toBe('');
    expect(text(f.render())).not.toContain('1.234567');
    await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.readPosition).toHaveBeenLastCalledWith(43n,undefined);
    expect(f.button('Review remaining-share verification').props.disabled).toBe(false);
    expect(f.prepareSnapshot).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();
  });
  if(key!=='cheap-prepared')it('opens a received NFT, activates privacy, then resumes without an extra refresh transaction',async()=>{
    const f=fixture();hooks.allowNative=true;
    const pending={...f.value,positionId:43n,status:3n,amounts:null};f.readPosition.mockResolvedValue(pending as never);
    const list=elements(f.render()).find(item=>item.type===CurrentOwnedPoolPositions)!;
    (list.props as unknown as {onSelect:(id:bigint)=>void}).onSelect(43n);
    await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.button('Activate claim privacy').props.disabled).toBe(false);expect(f.button('Review paid private refresh').props.disabled).toBe(true);
    expect(f.button('Close and withdraw all').props.disabled).toBe(true);expect(text(f.render())).not.toContain('1.234567');
    let result={action:'activate',positionId:43n,transactionHash:hash,status:'owner-action-verified',privateAccountingVerified:true,
      snapshot:{...f.value,positionId:43n,status:2n}};
    const recover=vi.fn(async()=>result),submit=vi.fn(async()=>({transactionHash:hash,recover}));
    f.getSender.mockResolvedValue({submitPoolPositionAction:submit});
    f.prepareAction.mockImplementation(async request=>{expect(request.recipient).toBeUndefined();expect(request.minimums).toBeUndefined();expect(request.fraction).toBeUndefined();
      expect(await request.confirm({snapshot:pending,recipient:null})).toBe(true);return {action:request.action};});
    f.button('Activate claim privacy').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.prepareAction).toHaveBeenLastCalledWith(expect.objectContaining({positionId:43n,action:'activate'}));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(hooks.states[11]).toBe(hash);expect(f.button('Resume liquidity claim').props.disabled).toBe(false);
    result={...result,action:'resume',snapshot:{...result.snapshot,status:1n}};
    f.button('Resume liquidity claim').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('Position resumed');expect(submit).toHaveBeenCalledTimes(2);expect(f.prepareSnapshot).not.toHaveBeenCalled();
  });
  it('locks position controls and their recovery while a top-up owns the journal',async()=>{
    const f=fixture();hooks.allowNative=true;hooks.states[11]=hash;await f.load();
    const child=elements(f.render()).find(item=>item.type===CurrentPreparedPoolTopUpWorkspace)!;
    expect((child.props as unknown as {candidateKey:string}).candidateKey).toBe(key);
    (child.props as unknown as {onBegin:()=>void}).onBegin();
    expect(f.button('Check position status').props.disabled).toBe(true);
    expect(f.button('Load private position').props.disabled).toBe(true);
    expect(f.button('Review paid private refresh').props.disabled).toBe(true);
    expect(text(f.render())).not.toContain('1.234567');
    f.button('Check position status').props.onClick!();await Promise.resolve();
    expect(f.getSender).not.toHaveBeenCalled();
    (child.props as unknown as {onReleased:()=>void}).onReleased();
    expect(f.button('Check position status').props.disabled).toBe(false);
  });
  it('keeps real hold before paid refresh touches a wallet',async()=>{
    const f=fixture();f.button('Review paid private refresh').props.onClick!();await vi.waitFor(()=>expect(text(f.render())).toContain(key==='cheap-history'?'App signing hold remains active':'native App submission admission is absent'));
    expect(f.getPositions).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it.each([0,1,2,3,4,5])('uses authenticated market %i token labels and six decimals',async index=>{
    const f=fixture(index);hooks.allowNative=true;hooks.states[11]=hash;await f.load();
    expect(f.getPositions).toHaveBeenCalledWith(BigInt(candidate.chainId),{candidate:key});
    expect(f.readPosition).toHaveBeenCalledWith(52n,{producerHash:hash});
    const rendered=text(f.render());expect(rendered).toContain(`${f.pair.tokens[0].label} entitlement1.234567`);
    expect(rendered).toContain(`${f.pair.tokens[1].label} entitlement2.345678`);
    if(key==='cheap-prepared')expect(rendered).toContain('integration is incomplete');
    else expect(f.button('Transfer liquidity NFT').props.disabled).toBe(false);
    expect(f.button('Close and withdraw all').props.disabled).toBe(false);expect(f.prepareAction).not.toHaveBeenCalled();
  });
  it.each(['candidate','owner','position'])('hides private amounts when %s changes',async changed=>{
    const f=fixture();hooks.allowNative=true;await f.load();expect(text(f.render())).toContain('1.234567');
    if(changed==='candidate')f.props.candidateKey='cheap-current';
    if(changed==='owner')f.props.sharedWalletSession={...f.props.sharedWalletSession,walletAddress:`0x${'44'.repeat(20)}`};
    if(changed==='position')hooks.states[0]='53';
    expect(text(f.render())).not.toContain('1.234567');
  });
  it('shows only public metadata after reload recovery',async()=>{
    const f=fixture(),recover=vi.fn(async()=>null),metadata=vi.fn(async()=>({status:'observed-mined',privateAccountingVerified:false}));
    f.getSender.mockResolvedValue({recoverCurrentPreparedPoolPositionResult:recover,recoverPendingPoolPositionAttempt:metadata});
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),{candidate:key});
    expect(text(f.render())).toContain('No private payout is confirmed');expect(text(f.render())).not.toContain('1.234567');expect(f.getPositions).not.toHaveBeenCalled();
  });
  it('binds a paid refresh and its retained recovery to the explicit prepared candidate',async()=>{
    const f=fixture();hooks.allowNative=true;
    const prepared={action:'snapshot'},recover=vi.fn(async()=>({action:'snapshot',positionId:52n,producerHash:hash,
      status:'active-snapshot-verified',snapshot:f.value}));
    f.prepareSnapshot.mockImplementation(async request=>{
      expect(await request.confirm({positionId:52n,closed:false,gasCap:30_000_000n})).toBe(true);return prepared;
    });
    const submit=vi.fn(async()=>({transactionHash:hash,recover}));f.getSender.mockResolvedValue({submitPoolPositionAction:submit});
    f.button('Review paid private refresh').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.getPositions).toHaveBeenCalledWith(BigInt(candidate.chainId),{candidate:key});
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),{candidate:key});expect(submit).toHaveBeenCalledWith(prepared);
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(recover).toHaveBeenCalledOnce();expect(text(f.render())).toContain('1.234567');expect(submit).toHaveBeenCalledOnce();
  });
  it('does not submit a cancelled paid refresh',async()=>{
    const f=fixture();hooks.allowNative=true;f.button('Review paid private refresh').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.getSender).not.toHaveBeenCalled();expect(text(f.render())).toContain('Private snapshot cancelled');
  });
  it('keeps Close held before acquiring a wallet capability',async()=>{
    const f=fixture();hooks.allowNative=true;await f.load();hooks.allowNative=false;f.getPositions.mockClear();
    f.button('Close and withdraw all').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain(key==='cheap-history'?'App signing hold remains active':'admission is absent');expect(f.getPositions).not.toHaveBeenCalled();expect(f.getSender).not.toHaveBeenCalled();
  });
  it('binds exact six-decimal minimums, producer and close-to-snapshot recovery',async()=>{
    const f=fixture(4);hooks.allowNative=true;hooks.states[11]=hash;await f.load();hooks.states[2]='1.000001';hooks.states[3]='2.000002';
    const prepared={action:'close'},closeRecover=vi.fn(async()=>({action:'close',positionId:52n,transactionHash:hash,status:'closed-proof-required',
      privateAccountingVerified:false,snapshot:{...f.value,status:4n,amounts:null}}));
    f.prepareAction.mockImplementation(async request=>{
      expect(request).toMatchObject({action:'close',producerHash:hash,minimums:[1_000_001n,2_000_002n]});
      expect(await request.confirm({recipient:null,minimums:request.minimums})).toBe(true);return prepared;
    });
    const submit=vi.fn(async()=>({transactionHash:hash,recover:closeRecover}));f.getSender.mockResolvedValue({submitPoolPositionAction:submit});
    f.button('Close and withdraw all').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),{candidate:key});
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('Close mined and payouts checked');expect(text(f.render())).not.toContain('Close complete');
    if(key!=='cheap-prepared'){
      const list=elements(f.render()).find(item=>item.type===CurrentOwnedPoolPositions)!;
      expect((list.props as unknown as {refreshToken:string}).refreshToken).toBe(hash);
    }
    expect(f.button('Review closed-claim verification')).toBeDefined();expect(closeRecover).toHaveBeenCalledOnce();
    const snapRecover=vi.fn(async()=>({action:'snapshot',positionId:52n,producerHash:hash,status:'closed-proof-verified',
      privateAccountingVerified:true,snapshot:{...f.value,status:4n,amounts:{...f.value.amounts,shares:0n}}}));
    f.prepareSnapshot.mockResolvedValue({action:'snapshot'});f.getSender.mockResolvedValue({submitPoolPositionAction:vi.fn(async()=>({transactionHash:hash,recover:snapRecover}))});
    f.button('Review closed-claim verification').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('Close complete');expect(submit).toHaveBeenCalledOnce();expect(snapRecover).toHaveBeenCalledOnce();
  });
  it('does not label a closed snapshot without payout proof as a completed Close',async()=>{
    const f=fixture();hooks.allowNative=true;
    f.prepareSnapshot.mockResolvedValue({action:'snapshot'});f.getSender.mockResolvedValue({submitPoolPositionAction:async()=>({transactionHash:hash,
      recover:async()=>({action:'snapshot',positionId:52n,producerHash:hash,status:'closed-snapshot-verified',privateAccountingVerified:false,
        snapshot:{...f.value,status:4n,amounts:{...f.value.amounts,shares:0n}}})})});
    f.button('Review paid private refresh').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('no independent verification of the original payout');expect(text(f.render())).not.toContain('Close complete');
  });
});

if(key!=='cheap-prepared')describe('private partial withdrawal consumer',()=>{
  const previewHash=`0x${'55'.repeat(32)}`;
  async function previewFixture(index=0){
    const f=fixture(index);hooks.allowNative=true;hooks.states[11]=hash;await f.load();
    const prepared={action:'withdraw',exitPhase:'preview'};
    const preview={action:'withdraw',exitPhase:'preview',positionId:52n,transactionHash:previewHash,status:'exit-preview-verified',
      privateAccountingVerified:false,snapshot:f.value,
      preview:{amount0:600_001n,amount1:1_100_002n,burnedShares:50n,remainingShares:50n,numerator:1n,denominator:2n}};
    f.prepareExitPreview.mockImplementation(async request=>{
      expect(request).toMatchObject({positionId:52n,expectedContext:hash,producerHash:hash,fraction:[1n,2n]});
      return await request.confirm({snapshot:f.value,fraction:[1n,2n],gasCap:100_000_000n})?prepared:null;
    });
    const recover=vi.fn(async()=>preview),submit=vi.fn(async()=>({transactionHash:previewHash,recover}));
    f.getSender.mockResolvedValue({submitPoolPositionAction:submit});
    const run=async()=>{f.button('Review private withdrawal preview').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
      f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));};
    return{...f,prepared,preview,recover,submit,run};
  }
  it('keeps preview held before wallet acquisition',async()=>{
    const f=await previewFixture();hooks.allowNative=false;f.getPositions.mockClear();
    f.button('Review private withdrawal preview').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain(key==='cheap-history'?'App signing hold remains active':'admission is absent');expect(f.getPositions).not.toHaveBeenCalled();
    expect(f.getSender).not.toHaveBeenCalled();expect(f.prepareExitPreview).not.toHaveBeenCalled();
  });
  it.each([0,1,2,3,4,5])('connects preview, withdrawal and remaining-share proof for pair%i',async index=>{
    const f=await previewFixture(index);expect(f.button('Withdraw previewed shares').props.disabled).toBe(true);
    await f.run();
    expect(f.getPositions).toHaveBeenLastCalledWith(BigInt(candidate.chainId),{candidate:key});
    expect(f.getSender).toHaveBeenLastCalledWith(BigInt(candidate.chainId),{candidate:key});
    expect(f.submit).toHaveBeenCalledWith(f.prepared);expect(f.recover).toHaveBeenCalledOnce();
    expect(text(f.render())).toContain(`${f.pair.tokens[0].label} payout0.600001`);
    expect(text(f.render())).toContain(`${f.pair.tokens[1].label} payout1.100002`);
    expect(text(f.render())).toContain('Remaining private shares50');expect(text(f.render())).toContain('No tokens have moved');
    expect(f.button('Withdraw previewed shares').props.disabled).toBe(false);
    hooks.states[2]='0.500001';hooks.states[3]='1.000002';
    const withdrawal={action:'withdraw',exitPhase:'withdrawal'};
    f.prepareAction.mockImplementation(async request=>{
      expect(request).toMatchObject({action:'withdraw',positionId:52n,expectedContext:hash,producerHash:hash,
        fraction:[1n,2n],minimums:[500_001n,1_000_002n]});
      expect(await request.confirm({snapshot:f.value,action:'withdraw',recipient:null,fraction:request.fraction,minimums:request.minimums})).toBe(true);
      return withdrawal;
    });
    const paid=vi.fn(async()=>({action:'withdraw',positionId:52n,status:'remaining-proof-required',privateAccountingVerified:false,
      payouts:[600_001n,1_100_002n],snapshot:{...f.value,context:previewHash,amounts:null}}));
    f.getSender.mockResolvedValue({submitPoolPositionAction:vi.fn(async prepared=>{expect(prepared).toBe(withdrawal);return{transactionHash:hash,recover:paid};})});
    f.button('Withdraw previewed shares').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(paid).toHaveBeenCalledOnce();expect(text(f.render())).toContain('Withdrawal mined and payouts checked');
    expect(text(f.render())).not.toContain('Withdrawal complete');expect(text(f.render())).not.toContain('Remaining private shares50');
    f.prepareSnapshot.mockResolvedValue({action:'snapshot'});
    const proof=vi.fn(async()=>({action:'snapshot',positionId:52n,producerHash:hash,status:'active-snapshot-verified',privateAccountingVerified:true,
      snapshot:{...f.value,context:previewHash,amounts:{...f.value.amounts,shares:50n}}}));
    f.getSender.mockResolvedValue({submitPoolPositionAction:vi.fn(async()=>({transactionHash:hash,recover:proof}))});
    f.button('Review remaining-share verification').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(proof).toHaveBeenCalledOnce();expect(text(f.render())).toContain('Withdrawal complete: exact private payouts and remaining shares verified');
  });
  it('does not acquire a sender after a cancelled preview',async()=>{
    const f=await previewFixture();hooks.confirm.mockResolvedValueOnce(false);
    f.button('Review private withdrawal preview').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(f.getSender).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();expect(text(f.render())).toContain('preview cancelled');
  });
  it('rejects changed inputs during private preview review',async()=>{
    const f=await previewFixture();hooks.confirm.mockImplementationOnce(async()=>{hooks.states[1]='25';f.render();return true;});
    f.button('Review private withdrawal preview').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('inputs changed during review');expect(f.getSender).not.toHaveBeenCalled();
  });
  it.each(['percentage','position','owner','candidate'] as const)('hides old preview after %s changes',async change=>{
    const f=await previewFixture();await f.run();f.getPositions.mockClear();f.getSender.mockClear();
    if(change==='percentage')hooks.states[1]='25';
    if(change==='position')hooks.states[0]='53';
    if(change==='owner')f.props.sharedWalletSession={...f.props.sharedWalletSession,walletAddress:`0x${'44'.repeat(20)}`};
    if(change==='candidate')f.props.candidateKey='cheap-prepared';
    expect(text(f.render())).not.toContain('Remaining private shares50');
    if(change==='percentage'){
      expect(f.button('Withdraw previewed shares').props.disabled).toBe(true);
      f.button('Withdraw previewed shares').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
      expect(f.prepareAction).not.toHaveBeenCalled();expect(f.getPositions).not.toHaveBeenCalled();
    }
  });
  it('does not convert public preview metadata into private authority',async()=>{
    const f=await previewFixture();f.getSender.mockResolvedValue({recoverCurrentPreparedPoolPositionResult:async()=>null,
      recoverPendingPoolPositionAttempt:async()=>({status:'observed-mined',privateAccountingVerified:false})});
    f.button('Check position status').props.onClick!();await vi.waitFor(()=>expect(hooks.states[5]).toBe(false));
    expect(text(f.render())).toContain('No private payout is confirmed');expect(text(f.render())).not.toContain('Remaining private shares50');
    expect(f.prepareAction).not.toHaveBeenCalled();expect(f.prepareExitPreview).not.toHaveBeenCalled();
  });
});

});
