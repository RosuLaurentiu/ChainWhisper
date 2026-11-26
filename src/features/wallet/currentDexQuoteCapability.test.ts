import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCurrentDexQuoteCapability, assertCurrentCheapDexPreparedQuote, assertCurrentCheapDexIssuedQuote, currentDexRestoredPlan, assertCurrentDexQuoteNotRestored } from './currentDexQuoteCapability';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, type CurrentCheapDexProfile } from '../../lib/currentDexOperation';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../lib/currentDexPendingAttempt';
import {createCurrentCheapDexSubmissionAdapter} from '../../lib/currentDexSubmission';
import {currentNativeSigningBudget,currentNativeSwapCheckpoint,recordCurrentNativeSwapHash,hasCurrentNativeSigningBudget} from '../../lib/currentDexNativeSwapPolicy';
import {CURRENT_DEX_OPERATION_LOOKUPS_KEY} from '../../lib/currentDexPendingAttempt';
import {CURRENT_DEX_NATIVE_RELOAD_KEY,writeCurrentDexNativeReload} from '../../lib/currentDexNativeReload';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY as ledgerRecovery, CURRENT_APP_PARTIAL_REFUND_TRIAL as partialTrial, CURRENT_APP_SWAP_OWNER } from '../../lib/currentDexC1SwapPolicy';

const mocks = vi.hoisted(() => ({ issue: vi.fn(), receiptIssue: vi.fn(), graph: vi.fn(), sharedGraph: vi.fn(),
  wide: vi.fn(), reveal: vi.fn(), rate: vi.fn(), inclusion: vi.fn(), issued: vi.fn(), current: vi.fn(), operation: vi.fn(), browser: new WeakSet<object>(), slippage: false }));
vi.mock('../../lib/currentDexOwnerBetaPolicy',async original=>({...await original<typeof import('../../lib/currentDexOwnerBetaPolicy')>(),isCurrentOwnerBeta:()=>false}));
vi.mock('../../lib/currentDexCanonicalInclusion',()=>({verifyCurrentDexCanonicalInclusion:mocks.inclusion}));
vi.mock('@coti-io/coti-sdk-typescript',async original=>({...await original<typeof import('@coti-io/coti-sdk-typescript')>(),decryptUint:mocks.rate}));
vi.mock('./ownerCotiMetaMaskCapability', () => ({ hasCurrentDexBrowserSigner:(signer:object|undefined)=>Boolean(signer&&mocks.browser.has(signer)), issueOwnerCotiMetaMaskCapability: mocks.issue }));
vi.mock('./currentDexReceiptCapability', () => ({ issueCurrentDexReceiptCapability: mocks.receiptIssue }));
vi.mock('../../lib/appChain', () => ({ readCurrentDexGraph: mocks.graph, readCurrentDexIssuedQuote: mocks.issued,
  readCurrentDexOperation: mocks.current }));
vi.mock('../../lib/dexV2Chain', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/dexV2Chain')>(),
  readCurrentSharedPoolDexGraph: mocks.sharedGraph, readCurrentDexOperation: mocks.operation }));
vi.mock('../../lib/privateUint256', () => ({ encryptPrivateUint256Input: mocks.wide, decryptPrivateUint256Output:mocks.reveal }));
const core = `0x${'11'.repeat(20)}`, owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
const signature = `0x${'44'.repeat(65)}`;
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const pendingStorage = () => {
  const values = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage });
  return sessionStorage;
};

describe('current DEX owner quote preparation', () => {
  it.each(['fast-pool','cheap-async'] as const)('reports only actual completed %s private-input signatures for each selected plan',async profile=>{
    for(const [key,total]of [['cheap-history',4]] as const){
      const f=await cheapFixture(profile,key),events:unknown[]=[];
      const request={...f.request,terms:{...f.request.terms,toleranceBps:50},progress:(event:unknown)=>events.push(event)};
      await f.capability.prepareCurrentQuote(request);
      expect(events).toEqual([{phase:'planned',completed:0,total},...Array.from({length:total},(_,i)=>[{phase:'requesting',completed:i,total},{phase:'completed',completed:i+1,total}]).flat()]);
    }
  });
  it.each(['cancel','reject','replaced'] as const)('does not count an uncompleted private-input signature after %s',async fault=>{
    const f=await cheapFixture('fast-pool','cheap-history'),events:unknown[]=[];
    if(fault==='cancel')f.request.confirmPrivateInputs.mockResolvedValue(false);
    if(fault==='reject')mocks.wide.mockRejectedValueOnce(new Error('Wallet signature rejected'));
    if(fault==='replaced')mocks.wide.mockImplementationOnce(async()=>{f.revoke();return{ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature};});
    const result=f.capability.prepareCurrentQuote({...f.request,terms:{...f.request.terms,toleranceBps:50},progress:(event:unknown)=>events.push(event)});
    if(fault==='cancel')await expect(result).resolves.toBeNull();else await expect(result).rejects.toThrow();
    expect(events).toEqual([{phase:'planned',completed:0,total:4},...(fault==='cancel'?[]:[{phase:'requesting',completed:0,total:4}])]);
  });
  it('recovers the approved lost ledger only after eleven canonical calls and exact private Fast7 proof',async()=>{
    const f=await lostPartialLedgerFixture();
    expect(f.adapter.readCurrentCheapRestoreHint()).toEqual({quoteHash:ledgerRecovery.hashes[9]});
    await f.adapter.restoreCurrentCheapOperation(f.restored);
    const record=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    expect(record.budget.charges.map((c:{hash:string})=>c.hash)).toEqual(ledgerRecovery.hashes);
    expect(record.budget.windowStart).toBe(String(partialTrial.approvedAt));
    expect(f.verifyTokens).toHaveBeenCalledWith(expect.objectContaining({phase:'fast-settle',amounts:expect.objectContaining({actualInput:1_000_000n,netOutput:959_968n,refund:0n})}));
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it.each(['canonical','private','nonce','pending','result'] as const)('does not install a recovered ledger with %s uncertainty',async fault=>{
    const f=await lostPartialLedgerFixture();
    if(fault==='canonical')f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical identity changed'));
    if(fault==='private')f.verifyTokens.mockRejectedValue(new Error('private credit changed'));
    if(fault==='nonce')f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:218,pendingNonce:218}));
    if(fault==='result')f.original.amounts.netOutput=959_967n;
    if(fault==='pending')f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:f.c.core,graph:`0x${f.c.graph}`,phase:'quote',callHash:keccak256(f.tx.data),nonce:217,txHash:null}));
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBeNull();
    expect(hasCurrentNativeSigningBudget(f.signer)).toBe(false);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('restores a closed Fast result with canonical Accept and private token accounting, without another send',async()=>{
    const f=await closedFastConsumerFixture(),before=f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    const current=await f.adapter.restoreCurrentCheapOperation(f.restored);
    await expect(f.adapter.readCurrentCheapDelivery(current)).resolves.toMatchObject({
      privateAccountingVerified:true,originalQuoteRateVerification:'unavailable',amounts:{actualInput:15n,netOutput:19n,refund:5n}
    });
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.verifyTokens).toHaveBeenCalledWith(expect.objectContaining({phase:'fast-settle',receipt:expect.objectContaining({hash:f.acceptHash})}));
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled();expect(f.readTerminalReceipt).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it.each(['authentication','private-credit','tokens','missing-accept','reverted-accept'] as const)('holds closed Fast restoration with %s evidence',async fault=>{
    const f=await closedFastConsumerFixture();
    if(fault==='authentication'){const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);saved.authentication=hash;f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify(saved));}
    if(fault==='private-credit')f.original.amounts.netOutput=18n;
    if(fault==='tokens')f.verifyTokens.mockRejectedValue(new Error('Owner token credit changed'));
    if(fault==='missing-accept'){const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);saved.budget.charges.pop();saved.budget.committedWei='5500000000000000';saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);}
    if(fault==='reverted-accept'){const wait=f.transport.waitForReceipt.getMockImplementation()!;f.transport.waitForReceipt.mockImplementation(async h=>{const r=await wait(h);return h===f.acceptHash?{...r,status:0}:r;});}
    const before=f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(hasCurrentNativeSigningBudget(f.signer)).toBe(false);expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('does not reuse a closed Fast rate proof for an active or uncertain budget',async()=>{
    const f=await closedFastConsumerFixture(),saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    saved.budget.activeSwap=`quote:${keccak256(f.tx.data)}`;saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
    const current=await f.adapter.restoreCurrentCheapOperation(f.restored);
    await expect(f.adapter.readCurrentCheapDelivery(current)).rejects.toThrow('reviewed Quote tolerance');
    expect(currentNativeSwapCheckpoint(f.signer).activeSwap).toBe(saved.budget.activeSwap);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('restores an expired unfunded Fast Quote and closes only its fee scope without sending',async()=>{
    const f=await restorationConsumerFixture(50_000_000n,'cheap-history','fast-pool');
    f.observed.block.timestamp=101n;f.observed.operation.phase='expired-unrecovered';
    const head=await f.transport.readHead();f.transport.readHead.mockResolvedValue({...head,timestamp:101n});
    const before=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!).budget;
    await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual({...before,activeSwap:null});
    expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeNull();
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(()=>assertCurrentDexQuoteNotRestored(currentDexRestoredPlan(f.restored,f.signer))).toThrow('cannot be submitted again');
  });
  it.each(['ready','consumed','nonce','authentication','canonical'] as const)('does not close a Fast scope with %s evidence',async fault=>{
    const f=await restorationConsumerFixture(50_000_000n,'cheap-history','fast-pool');
    f.observed.block.timestamp=101n;f.observed.operation.phase='expired-unrecovered';
    if(fault==='ready'){f.observed.block.timestamp=99n;f.observed.operation.phase='quote-prepared';}
    if(fault==='consumed'){f.observed.operation.ready=false;f.observed.operation.phase='consumed-unverified';}
    if(fault==='nonce')f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),pendingNonce:6}));
    if(fault==='authentication'){const r=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);r.authentication=hash;f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify(r));}
    if(fault==='canonical')f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical inclusion changed'));
    const before=f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    if(['ready','consumed'].includes(fault))await f.adapter.restoreCurrentCheapOperation(f.restored);
    else await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains an expired Fast scope when an Accept was reserved, even if that receipt reverted',async()=>{
    const f=await restorationConsumerFixture(50_000_000n,'cheap-history','fast-pool'),scope=`quote:${keccak256(f.tx.data)}`,acceptHash=`0x${'66'.repeat(32)}`;
    f.observed.block.timestamp=101n;f.observed.operation.phase='expired-unrecovered';
    const head=await f.transport.readHead();f.transport.readHead.mockResolvedValue({...head,timestamp:101n});
    const tx={...f.tx,hash:acceptHash,data:new Interface(['function acceptFastPool(uint256,bytes32)']).encodeFunctionData('acceptFastPool',[7n,hash]),nonce:5};
    const quoteReceipt=await f.transport.waitForReceipt(f.tx.hash),quoteTx=await f.transport.readTransaction(f.tx.hash);
    f.transport.readTransaction.mockImplementation(async h=>h===acceptHash?{...tx,gasPrice:50_000_000n}:quoteTx);
    f.transport.waitForReceipt.mockImplementation(async h=>h===acceptHash?{...quoteReceipt,hash:acceptHash,status:0}:quoteReceipt);
    f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:6,pendingNonce:6}));
    const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    saved.budget.charges.push({phase:'accept',key:`accept:${scope}`,scope,gasCap:'110000000',nonce:5,hash:acceptHash});
    saved.budget.committedWei=String(220_000_000n*50_000_000n);saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
    await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(currentNativeSwapCheckpoint(f.signer).activeSwap).toBe(scope);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('restores already closed settlement accounting without obsolete READY state or new signing', async () => {
    const f=await closedActivityConsumerFixture(),before=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    const restored=await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled();
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual(before.budget);
    expect(f.verifyTokens.mock.calls.map(([input])=>(input as {phase:string}).phase)).toEqual(['accept','terminal']);
    await expect(f.adapter.readCurrentCheapDelivery(restored)).resolves.toMatchObject({
      privateAccountingVerified:true,originalQuoteRateVerification:'unavailable',amounts:{actualInput:15n,netOutput:19n,refund:5n}
    });
    await expect(f.adapter.submitCurrentCheapAcceptance({issued:restored,confirm:async()=>true})).rejects.toThrow();
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual(before.budget);
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it.each(['active','authentication','private-credit','canonical','nonce','blocked','record-race'] as const)('does not install closed-ledger accounting with %s evidence',async fault=>{
    const f=await closedActivityConsumerFixture();
    if(fault==='active'||fault==='authentication'){
      const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
      if(fault==='active')saved.budget.activeSwap=saved.budget.charges[0].scope;
      saved.authentication=fault==='authentication'?hash:await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
    }
    if(fault==='private-credit')f.verifyTokens.mockRejectedValue(new Error('owner token mismatch'));
    if(fault==='canonical')f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical inclusion changed'));
    if(fault==='nonce')f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:6,pendingNonce:7}));
    if(fault==='blocked')f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner,core:f.c.core,graph:`0x${f.c.graph}`,phase:'accept',callHash:hash,nonce:5,txHash:`0x${'66'.repeat(32)}`,verificationBlocked:true}));
    if(fault==='record-race')f.verifyTokens.mockImplementation(async()=>{f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,'{}');});
    const before=f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(hasCurrentNativeSigningBudget(f.signer)).toBe(false);
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
    if(fault==='active')expect(f.readOriginalQuoteReceipt).toHaveBeenCalledOnce();
  });
  it('restores exact privately recovered funding without obsolete Quote-rate state and retains every charge', async () => {
    const f=await recoveredConsumerFixture(),before=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    f.original.block={...f.original.block,number:10_000n};
    const restored=await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(restored.operation.stage).toBe(8);
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled();
    expect(f.verifyTokens.mock.calls.map(([input])=>(input as {phase:string}).phase)).toEqual(['accept','recover']);
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual(before.budget);
    await expect(f.adapter.readCurrentCheapDelivery(restored)).resolves.toMatchObject({releaseAction:'recover',amounts:{actualInput:0n,refund:20n,netOutput:0n}});
    expect(f.readTerminalReceipt).toHaveBeenCalledWith(expect.anything(),4137n);
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual({...before.budget,activeSwap:null});
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it.each(['filled','partial-refund','output','debit','tokens','reverted-accept','wrong-recover','missing-accept',
    'authentication','nonce','reorg','blocked','record-race'] as const)('holds recovered %s before installing the signing budget',async fault=>{
    const f=await recoveredConsumerFixture();
    if(fault==='filled')f.original.amounts.filled=true;
    if(fault==='partial-refund')f.original.amounts.refund=19n;
    if(fault==='output')Object.assign(f.original.amounts,{grossOutput:1n,netOutput:1n});
    if(fault==='debit')Object.assign(f.original.amounts,{actualInput:1n,refund:19n});
    if(fault==='tokens')f.verifyTokens.mockRejectedValue(new Error('owner token mismatch'));
    if(fault==='reverted-accept')f.acceptReceipt.status=0;
    if(fault==='wrong-recover')f.recoverTx.data=new Interface(['function recoverSwap(uint256)']).encodeFunctionData('recoverSwap',[8n]);
    if(fault==='missing-accept'){
      const r=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);r.budget.charges.splice(1,1);
      r.budget.committedWei=String(BigInt(r.budget.committedWei)-35_000_000n*50_000_000n);
      r.authentication=await f.authenticate(r.budget);writeCurrentDexNativeReload(f.storage,r);
    }
    if(fault==='authentication'){
      const r=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);r.authentication=hash;writeCurrentDexNativeReload(f.storage,r);
    }
    if(fault==='nonce')f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:7,pendingNonce:8}));
    if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(`0x${'88'.repeat(32)}`);
    if(fault==='blocked')f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner,core:f.c.core,graph:`0x${f.c.graph}`,phase:'recover',callHash:keccak256(f.recoverTx.data),nonce:6,txHash:f.recoverTx.hash,verificationBlocked:true}));
    if(fault==='record-race')f.verifyTokens.mockImplementation(async()=>{f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,'{}');});
    const before=f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(hasCurrentNativeSigningBudget(f.signer)).toBe(false);
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('restores the canonical 7b67 Quote with its own authenticated budget and no new signing', async () => {
    const f = await restorationConsumerFixture(50_000_000n, 'cheap-history');
    const restored = await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(restored.intent.candidate).toEqual(f.c);
    expect(restored.transactionHash).toBe(f.tx.hash);
    expect(JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!).budget).toMatchObject({
      candidateGraph: f.c.graph, committedWei: '5500000000000000', charges: [{ phase: 'quote', gasPrice: '50000000' }]
    });
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.signer.encryptValue).not.toHaveBeenCalled(); expect(mocks.wide).not.toHaveBeenCalled();
    await expect(f.adapter.submitCurrentCheapAcceptance({ issued: restored, confirm: async () => true })).rejects.toThrow('signing hold');
  });
  it('joins 7b67 Activity to owner token checks and exact partial refund without changing reservations', async () => {
    const f = await activityConsumerFixture('cheap-history'), before = f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    const result = await f.adapter.readCurrentCheapActivityReceipt(f.restored);
    expect(result).toMatchObject({ privateAccountingVerified: true, amounts: { actualInput: 15n, netOutput: 19n, refund: 5n } });
    expect(f.verifyTokens).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'accept' }));
    expect(f.verifyTokens).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'terminal' }));
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('checks the full 7b67 no-fill refund and rejects a private token mismatch', async () => {
    const f = await activityConsumerFixture('cheap-history');
    Object.assign(f.original.amounts, { filled: false, actualInput: 0n, grossOutput: 0n, fee: 0n, netOutput: 0n, refund: 20n });
    const before = f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    expect(await f.adapter.readCurrentCheapActivityReceipt(f.restored)).toMatchObject({ privateAccountingVerified: true,
      amounts: { actualInput: 0n, netOutput: 0n, refund: 20n } });
    f.verifyTokens.mockRejectedValue(new Error('owner token mismatch'));
    await expect(f.adapter.readCurrentCheapActivityReceipt(f.restored)).rejects.toThrow('owner token mismatch');
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('reads terminal Activity accounting with pruned Quote state and no budget or pending writes', async () => {
    const f = await activityConsumerFixture(), before = f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY), pending = f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    f.readOriginalQuoteReceipt.mockRejectedValue(new Error('missing trie node'));
    const result = await f.adapter.readCurrentCheapActivityReceipt(f.restored);
    expect(result).toMatchObject({ readyToSign: false, nativeAdmission: false, privateAccountingVerified: true,
      originalQuoteRateVerification: 'unavailable', releaseAction: null, amounts: { actualInput: 15n, netOutput: 19n, refund: 5n } });
    expect(f.verifyTokens).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'accept' }));
    expect(f.verifyTokens).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'terminal' }));
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled(); expect(f.transport.readNativeResources).not.toHaveBeenCalled();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before); expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(pending);
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
    await expect(f.adapter.readCurrentCheapDelivery(f.restored)).rejects.toThrow('not recovered');
  });
  it.each(['amount', 'context', 'authentication', 'canonical', 'tokens', 'missing-accept', 'terminal-phase'] as const)('holds invalid %s Activity evidence without changing reservations', async fault => {
    const f = await activityConsumerFixture();
    if (fault === 'amount') f.original.amounts.refund = 6n;
    if (fault === 'context') f.original.operation.contextHash = `0x${'88'.repeat(32)}`;
    if (fault === 'authentication') { const r = JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!); r.authentication = hash; f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY, JSON.stringify(r)); }
    if (fault === 'canonical') f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical inclusion changed'));
    if (fault === 'tokens') f.verifyTokens.mockRejectedValue(new Error('owner token mismatch'));
    if (fault === 'missing-accept') { const r = JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!); r.budget.charges.pop(); r.budget.committedWei = '5500000000000000'; r.authentication = await f.authenticate(r.budget); f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY, JSON.stringify(r)); }
    if (fault === 'terminal-phase') f.readTerminalReceipt.mockResolvedValue({ receipt: f.terminalReceipt, phase: 'cancel' as never });
    const before = f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY), pending = f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    await expect(f.adapter.readCurrentCheapActivityReceipt(f.restored)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before); expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(pending);
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it.each(['no-fill', 'recover', 'cancel', 'cancel-after-reverted-accept'] as const)('reads exact %s Activity accounting without granting restoration', async outcome => {
    const f = await activityConsumerFixture();
    Object.assign(f.original.amounts, { filled: false, actualInput: 0n, netOutput: 0n, grossOutput: 0n, fee: 0n, refund: 20n });
    if (outcome !== 'no-fill') { f.observed.operation.stage = 8; f.observed.operation.phase = 'released'; f.original.operation = { ...f.observed.operation }; }
    f.readTerminalReceipt.mockResolvedValue({ receipt: f.terminalReceipt, phase: (outcome.startsWith('cancel') ? 'cancel' : outcome === 'recover' ? 'recover' : 'terminal') as never });
    if (outcome === 'cancel') { const r = JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!); r.budget.charges.pop(); r.budget.committedWei = '5500000000000000'; r.authentication = await f.authenticate(r.budget); writeCurrentDexNativeReload(f.storage, r); }
    if (outcome === 'cancel-after-reverted-accept') {
      const read = f.transport.waitForReceipt.getMockImplementation()!;
      f.transport.waitForReceipt.mockImplementation(async h => { const r = await read(h); return h === `0x${'66'.repeat(32)}` ? { ...r, status: 0 } : r; });
    }
    const before = f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    expect(await f.adapter.readCurrentCheapActivityReceipt(f.restored)).toMatchObject({ amounts: { actualInput: 0n, netOutput: 0n, refund: 20n },
      releaseAction: outcome.startsWith('cancel') ? 'cancel' : outcome === 'recover' ? 'recover' : null, readyToSign: false });
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(f.verifyTokens).toHaveBeenCalledTimes(outcome.startsWith('cancel') ? 1 : 2);
  });
  it.each(['origin-reorg','origin-lifetime','head-before-origin','head-reorg'] as const)('holds restored Quote on %s',async fault=>{
    const f=await restoreFixture();
    f.readProvider.send.mockImplementation(async(method,params)=>{
      expect(method).toBe('eth_getBlockByNumber');const latest=params[0]==='latest';
      return{number:latest?(fault==='head-before-origin'?'0x29':'0x2b'):'0x2a',
        hash:(latest&&fault==='head-reorg'||!latest&&fault==='origin-reorg')?`0x${'77'.repeat(32)}`:hash,
        timestamp:!latest&&fault==='origin-lifetime'?'0x65':'0x63'};
    });
    await expect(f.capability.restoreCurrentQuote({quoteHash:f.tx.hash})).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it('restores a canonical unfunded cancellation without obsolete private Quote history',async()=>{
    const f=await restorationConsumerFixture(),scope=`quote:${keccak256(f.tx.data)}`,cancelHash=`0x${'66'.repeat(32)}`;
    const abi=new Interface(['function cancelSwap(uint256 operationId)','event CheapAsyncAdvanced(uint256 indexed quoteId,uint8 stage,bytes32 context)']);
    const tx={...f.tx,hash:cancelHash,data:abi.encodeFunctionData('cancelSwap',[7n]),nonce:5,gasLimit:30_000_000n,gasPrice:50_000_000n};
    const receipt={hash:cancelHash,status:1,from:owner,to:f.c.core,blockNumber:42,blockHash:hash,
      logs:[{address:f.c.core,...abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,8,hash])}]};
    const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
    saved.budget.charges.push({phase:'cancel',key:`cancel:${scope}`,scope,gasCap:'30000000',gasPrice:'50000000',nonce:5,hash:cancelHash});
    saved.budget.committedWei=String(BigInt(saved.budget.committedWei)+30_000_000n*50_000_000n);
    saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
    f.transport.readTransaction.mockImplementation(async h=>h===cancelHash?tx:{...f.tx,gasPrice:50_000_000n});
    const quoteReceipt=await f.transport.waitForReceipt(f.tx.hash);
    f.transport.waitForReceipt.mockImplementation(async h=>h===cancelHash?receipt:quoteReceipt);
    f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:6,pendingNonce:6}));
    const current={...f.observed,operation:{...f.observed.operation,stage:8,phase:'released',ready:false}};
    mocks.current.mockResolvedValue(current);
    f.readOriginalQuoteReceipt.mockRejectedValue(new Error('missing trie node'));
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).resolves.toMatchObject({operation:{stage:8}});
    expect(f.readOriginalQuoteReceipt).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('restores expired terms from their canonical origin while checking the graph at the current block',async()=>{
    const f=await restoreFixture();
    f.readProvider.send.mockImplementation(async(method,params)=>{
      expect(method).toBe('eth_getBlockByNumber');return{number:params[0]==='latest'?'0x2b':'0x2a',hash,timestamp:params[0]==='latest'?'0x3e9':'0x63'};
    });
    const graph=mocks.sharedGraph.getMockImplementation()!;
    mocks.sharedGraph.mockImplementation(async args=>{if(args.blockNumber===42n)throw new Error('missing trie node');const result=await graph(args);return{...result,block:{...result.block,timestamp:1001n}};});
    const restored=await f.capability.restoreCurrentQuote({quoteHash:f.tx.hash});
    expect(restored.intent.deadline).toBe(100n);expect(restored.originBlock.number).toBe(42n);
    expect(mocks.sharedGraph.mock.calls.every(([args])=>args.blockNumber===43n)).toBe(true);
    expect(()=>assertCurrentDexQuoteNotRestored(currentDexRestoredPlan(restored,f.signer))).toThrow('cannot be submitted again');
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['fast-pool','cheap-async'] as const)('restores an admitted browser %s quote and holds unbranded restoration',async profile=>{
    const f=await restoreFixture('cheap-history',profile,CURRENT_APP_SWAP_OWNER,100_000_000n);
    mocks.browser.add(f.signer);
    await expect(f.capability.restoreCurrentQuote({quoteHash:f.tx.hash})).resolves.toMatchObject({intent:{maximumInput:100_000_000n}});
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
    const other=await restoreFixture('cheap-history',profile,owner,100_000_000n);
    await expect(other.capability.restoreCurrentQuote({quoteHash:other.tx.hash})).rejects.toThrow('protected domain');
  });
  it.each(['fast-pool','cheap-async'] as const)('restores exact packed %s rate halves without new signatures', async profile => {
    for (const [numerator, denominator] of [[0n, 1n], [(1n << 128n) - 1n, (1n << 128n) - 1n], [1n, 0n]]) {
      const f = await restoreFixture('cheap-history', profile), abi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
      const method = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
      const args = abi.decodeFunctionData(method, f.tx.data).toArray(true), terms = profile === 'fast-pool' ? args : args[0];
      terms[7] = [[(numerator << 128n) | denominator, 0n], signature];
      f.tx.data = abi.encodeFunctionData(method, args);
      if (denominator === 0n) await expect(f.capability.restoreCurrentQuote({ quoteHash: f.tx.hash })).rejects.toThrow();
      else expect((await f.capability.restoreCurrentQuote({ quoteHash: f.tx.hash })).intent).toMatchObject({ rateNumerator: numerator, rateDenominator: denominator });
      expect(mocks.wide).not.toHaveBeenCalled();
      expect(f.signer.encryptValue).not.toHaveBeenCalled();
      expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    }
  });
  it('rejects an old separate-rate Quote instead of restoring through a fallback', async () => {
    const f = await restoreFixture();
    f.tx.data = retainedKeeperCalldata(f.tx.data);
    await expect(f.capability.restoreCurrentQuote({ quoteHash: f.tx.hash })).rejects.toThrow();
    expect(mocks.wide).not.toHaveBeenCalled();
    expect(f.signer.encryptValue).not.toHaveBeenCalled();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('normalizes the SDK missing removed field before canonical Quote restoration',async()=>{
    const f=await restoreFixture(),r=await f.readProvider.getTransactionReceipt(f.tx.hash);
    Object.assign(r!,{logs:[{address:f.tx.to,topics:[hash],data:'0x',index:0,transactionHash:f.tx.hash,blockNumber:42,blockHash:hash}]});
    f.readProvider.getTransactionReceipt.mockResolvedValue(r);
    await f.capability.restoreCurrentQuote({quoteHash:f.tx.hash});
    expect(mocks.inclusion.mock.calls[0][2].logs[0]).toMatchObject({index:0,transactionHash:f.tx.hash,blockNumber:42,blockHash:hash,removed:false});
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('joins authenticated reload terms to the original finite budget and clears only the proven Quote pending record',async()=>{
    const f=await restorationConsumerFixture();
    expect(f.adapter.readCurrentCheapRestoreHint()).toEqual({quoteHash:f.tx.hash});
    const current=await f.adapter.restoreCurrentCheapOperation(f.restored);
    expect(current.intent.maximumInput).toBe(20n);expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeNull();
    expect(currentNativeSigningBudget(f.signer,owner,()=>99n,f.c).snapshot()).toMatchObject({signingStarts:1,committedWei:5500000000000000n,normalExpiresAt:998n,recoveryExpiresAt:1898n});
    await expect(f.adapter.submitCurrentCheapQuote(currentDexRestoredPlan(current,f.signer))).rejects.toThrow('cannot be submitted again');
    await expect(f.adapter.submitCurrentCheapAcceptance({issued:current,confirm:async()=>true})).rejects.toThrow('signing hold');
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)).not.toMatch(/maximumInput|minimumInput|ciphertext|aesKey|rateNumerator/);
  });
  it.each([50_000_000n])('restores funded Accept fee %s and its original Quote tolerance, then holds an invalid terminal private receipt',async acceptFee=>{
    const f=await restorationConsumerFixture(),scope=`quote:${keccak256(f.tx.data)}`,acceptHash=`0x${'66'.repeat(32)}`;
    const abi=new Interface(['function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)','event CheapAsyncAdvanced(uint256 indexed quoteId,uint8 stage,bytes32 context)']);
    const data=abi.encodeFunctionData('acceptPrivateSwapV1',[7n,hash]),event=abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,6,hash]);
    const tx={...f.tx,hash:acceptHash,data,nonce:5,gasLimit:35000000n,gasPrice:acceptFee,blockNumber:43};
    const receipt={hash:acceptHash,status:1,from:owner,to:f.c.core,blockNumber:43,blockHash:hash,logs:[{...event,address:f.c.core}]};
    const quoteTx=f.transport.readTransaction.getMockImplementation()!,quoteReceipt=f.transport.waitForReceipt.getMockImplementation()!;
    f.transport.readTransaction.mockImplementation(async(hashArg?:string)=>hashArg===acceptHash?tx:quoteTx());
    f.transport.waitForReceipt.mockImplementation(async(hashArg?:string)=>hashArg===acceptHash?receipt:quoteReceipt());
    f.transport.readNativeResources.mockImplementation(async head=>({...f.resources(head),latestNonce:6,pendingNonce:6}));
    const record=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);record.budget.charges.push({phase:'accept',key:`accept:${scope}`,scope,gasCap:'35000000',...(acceptFee===52_000_000n?{gasPrice:'52000000'}:{}),nonce:5,hash:acceptHash});record.budget.committedWei=String(5_500_000_000_000_000n+35_000_000n*acceptFee);record.authentication=await f.authenticate(record.budget);f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify(record));
    f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner,core:f.c.core,graph:`0x${f.c.graph}`,phase:'accept',callHash:keccak256(data),nonce:5,txHash:acceptHash}));
    f.observed.operation.stage=6;f.observed.operation.phase='settlement-pending';f.observed.operation.ready=false;f.original.operation={...f.observed.operation};f.original.kind='pending';
    const restored=await f.adapter.restoreCurrentCheapOperation(f.restored);expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeNull();expect(f.verifyTokens).toHaveBeenCalledWith(expect.objectContaining({phase:'accept'}));
    expect(JSON.parse(f.storage.getItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY)!)).toHaveLength(1);
    f.observed.operation.stage=7;f.observed.operation.phase='consumed-unverified';f.original.operation={...f.observed.operation};f.original.kind='terminal';f.original.amounts.netOutput=18n;f.original.amounts.grossOutput=19n;
    await expect(f.adapter.readCurrentCheapDelivery(restored)).rejects.toThrow('reviewed Quote tolerance');
    expect(JSON.parse(f.storage.getItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY)!)[0].attempt.verificationBlocked).toBe(true);expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['missing','authentication','hashless','nonce','reorg','terminal-substitute','context','private-failure'] as const)('keeps %s reload evidence held before financial restoration',async fault=>{
    const f=await restorationConsumerFixture(),pending=f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    if(fault==='missing')f.storage.removeItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
    if(fault==='authentication'){const record=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);record.budget.start='99';f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify(record));}
    if(fault==='hashless'){const record=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);record.budget.charges[0].hash=null;record.authentication=await f.authenticate(record.budget);f.storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify(record));f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...JSON.parse(pending!),txHash:null}));}
    if(fault==='nonce')f.transport.readNativeResources.mockImplementation(async head=>({...f.resources(head),pendingNonce:6}));
    if(fault==='reorg')f.transport.readBlockHash.mockResolvedValue(`0x${'88'.repeat(32)}`);
    if(fault==='terminal-substitute')f.original.kind='terminal';
    if(fault==='context')f.original.operation.contextHash=`0x${'88'.repeat(32)}`;
    if(fault==='private-failure')f.original.amounts.refund=6n;
    await expect(f.adapter.restoreCurrentCheapOperation(f.restored)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).not.toBeNull();expect(f.transport.send).not.toHaveBeenCalled();expect(f.transport.estimateGas).not.toHaveBeenCalled();
    if(['terminal-substitute','context','private-failure'].includes(fault))expect(JSON.parse(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({verificationBlocked:true});
  });
  it('restores original private async inputs after expiry without encryption, signing or Quote resubmission authority',async()=>{
    const f=await restoreFixture();f.clock.mockReturnValue(200000);
    const restored=await f.capability.restoreCurrentQuote({quoteHash:f.tx.hash,operationId:7n});
    expect(restored.intent).toMatchObject({maximumInput:20n,minimumInput:5n,minimumOutput:1n,rateNumerator:1n,rateDenominator:1n,toleranceBps:50,deadline:100n});
    expect(()=>assertCurrentCheapDexIssuedQuote(restored,f.signer)).not.toThrow();
    const plan=currentDexRestoredPlan(restored,f.signer);expect(plan.data).toBe(f.tx.data);
    expect(()=>assertCurrentDexQuoteNotRestored(plan)).toThrow('cannot be submitted again');
    expect(()=>currentDexRestoredPlan({...restored},f.signer)).toThrow();
    expect(mocks.inclusion).toHaveBeenCalledTimes(2);expect(mocks.wide).not.toHaveBeenCalled();expect(f.signer.encryptValue).not.toHaveBeenCalled();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue({...f.observed,operation:{...f.observed.operation,contextHash:`0x${'77'.repeat(32)}`}});
    await expect(restored.readCurrent()).rejects.toThrow('context changed');
  });
  it.each(['owner','candidate','chain','canonical','decrypt','graph','operation','lease'] as const)('holds invalid %s restoration without new private inputs',async fault=>{
    const f=await restoreFixture();
    if(fault==='owner')f.tx.from=`0x${'77'.repeat(20)}`;
    if(fault==='candidate')f.tx.to=core;
    if(fault==='chain')f.tx.chainId=1n;
    if(fault==='canonical')mocks.inclusion.mockRejectedValueOnce(new Error('Canonical reorg'));
    if(fault==='decrypt')mocks.reveal.mockImplementationOnce(()=>{throw new Error('Private decrypt failed');});
    if(fault==='graph')mocks.sharedGraph.mockRejectedValueOnce(new Error('Graph changed'));
    if(fault==='lease')f.revoke();
    await expect(f.capability.restoreCurrentQuote({quoteHash:f.tx.hash,operationId:fault==='operation'?8n:7n})).rejects.toThrow();
    expect(mocks.wide).not.toHaveBeenCalled();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('exports only public keeper identifiers from the selected owner session', async () => {
    const f = await keeperNominationFixture();
    const nomination = await f.issued.readKeeperNomination();
    expect(Object.keys(nomination).sort()).toEqual(['schema', 'identity', 'principal', 'inputToken', 'outputToken', 'destination',
      'operationId', 'quoteHash', 'origin', 'deadline', 'toleranceBps'].sort());
    expect(nomination).toMatchObject({ principal: owner, operationId: '7', quoteHash: f.txHash, toleranceBps: 50,
      identity: { graph: resolveCurrentCheapDexCandidate('cheap-history').graph } });
    const serialized = JSON.stringify(nomination);
    for (const name of ['maximumInput', 'minimumInput', 'minimumOutput', 'rateNumerator', 'rateDenominator', 'ciphertext', 'signature', 'aesKey', 'intent'])
      expect(serialized).not.toContain(name);
    expect(Object.isFrozen(nomination.identity)).toBe(true);
    expect(Object.isFrozen(nomination.origin)).toBe(true);
    f.revoke(); await expect(f.issued.readKeeperNomination()).rejects.toThrow('revoked');
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['fast', 'terminal', 'expired', 'context', 'graph'] as const)('does not nominate %s work', async fault => {
    const f = await keeperNominationFixture(fault === 'fast' ? 'fast-pool' : 'cheap-async');
    if (fault === 'terminal') mocks.current.mockResolvedValue({ ...f.current, operation: { ...f.current.operation, stage: 7 } });
    if (fault === 'expired') mocks.current.mockResolvedValue({ ...f.current, block: { ...f.current.block, timestamp: 100n } });
    if (fault === 'context') {
      mocks.current.mockResolvedValue({ ...f.current, operation: { ...f.current.operation, stage: 5, contextHash: hash } });
      await f.issued.readCurrent();
      mocks.current.mockResolvedValue({ ...f.current, operation: { ...f.current.operation, stage: 5, contextHash: `0x${'77'.repeat(32)}` } });
    }
    if (fault === 'graph') mocks.sharedGraph.mockRejectedValueOnce(new Error('Candidate graph changed'));
    await expect(f.issued.readKeeperNomination()).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['fast-pool', 'cheap-async'] as const)('prepares current %s slippage without granting native submission', async profile => {
    const f = await cheapFixture(profile, 'cheap-history'), candidate = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
    const request = { ...f.request, terms: { ...f.request.terms, rateNumerator: 0n, toleranceBps: 50 } };
    request.confirmPrivateInputs.mockImplementation(async () => { request.terms.toleranceBps = 100; return true; });
    const prepared = (await f.capability.prepareCurrentQuote(request))!;
    const abi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI), method = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
    const decoded = abi.decodeFunctionData(method, prepared.data), terms = profile === 'cheap-async' ? decoded.request : decoded;
    expect(terms.toleranceBps).toBe(50n); expect(prepared.intent).toMatchObject({ candidate, toleranceBps: 50, quoteProtocol: 'quote-slippage' });
    expect(prepared).toMatchObject({ to: candidate.core, graph: candidate.graph, readyToSign: false });
    for (const call of mocks.wide.mock.calls) expect(call.slice(2)).toEqual([candidate.core, abi.getFunction(method)!.selector]);
    expect(() => assertCurrentCheapDexPreparedQuote(prepared, f.signer)).not.toThrow(); expect(() => assertCurrentCheapDexPreparedQuote(prepared, {})).toThrow('session');
    expect(f.signer.getNonce).not.toHaveBeenCalled(); expect(f.signer.estimateGas).not.toHaveBeenCalled(); expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['fast-pool', 'cheap-async'] as const)('keeps current %s tolerance, identity and lease checks', async profile => {
    for (const fault of ['missing-tolerance', 'mixed-identity', 'read-identity', 'revoked-review']) {
      const f = await cheapFixture(profile, 'cheap-history');
      const request = { ...f.request, terms: { ...f.request.terms, toleranceBps: fault === 'missing-tolerance' ? undefined : 50 } };
      if (fault === 'mixed-identity') request.graph.expectedPackageSha256 = 'ff'.repeat(32);
      if (fault === 'read-identity') mocks.sharedGraph.mockResolvedValueOnce({ ...cheapIdentity(42n), packageSha256: 'ff'.repeat(32) });
      if (fault === 'revoked-review') request.confirmPrivateInputs.mockImplementation(async () => { f.revoke(); return true; });
      await expect(f.capability.prepareCurrentQuote(request)).rejects.toThrow();
      expect(mocks.wide).not.toHaveBeenCalled(); expect(f.signer.encryptValue).not.toHaveBeenCalled(); expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    }
  });
  it.each(['fast-pool', 'cheap-async'] as const)('captures exact %s tolerance and optional zero hard rate before private inputs', async profile => {
    const f = await cheapFixture(profile);
    const request = { ...f.request, graph: { ...f.request.graph, candidate: 'cheap-history' as const }, terms: { ...f.request.terms, rateNumerator: 0n, rateDenominator: 1n, toleranceBps: 50 } };
    request.confirmPrivateInputs.mockImplementation(async () => { request.terms.toleranceBps = 100; return true; });
    const prepared = (await f.capability.prepareCurrentQuote(request))!;
    const abi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI), method = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
    const decoded = abi.decodeFunctionData(method, prepared.data), terms = profile === 'cheap-async' ? decoded.request : decoded;
    expect(terms.toleranceBps).toBe(50n);
    expect(mocks.wide).toHaveBeenCalledTimes(4);
    expect(mocks.wide.mock.calls[3][1]).toBe(1n);
    expect(f.signer.encryptValue).not.toHaveBeenCalled();
    expect(prepared.intent).toMatchObject({ quoteProtocol: 'quote-slippage', toleranceBps: 50, rateNumerator: 0n, rateDenominator: 1n });
    expect(Object.isFrozen(prepared.intent)).toBe(true);
    expect(request.confirmPrivateInputs.mock.calls[0][0]).toMatchObject({ toleranceBps: 50 });
    for (const call of mocks.wide.mock.calls) expect(call.slice(2)).toEqual([STAGED_SHARED_HISTORY_DEX_CANDIDATE.core, abi.getFunction(method)!.selector]);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['fast-pool', 'cheap-async'] as const)('signs the maximum packed %s rate as one uint256 input', async profile => {
    const f = await cheapFixture(profile, 'cheap-history'), max = (1n << 128n) - 1n;
    const request = { ...f.request, terms: { ...f.request.terms, rateNumerator: max, rateDenominator: max, toleranceBps: 50 } };
    await f.capability.prepareCurrentQuote(request);
    expect(mocks.wide).toHaveBeenCalledTimes(4);
    expect(mocks.wide.mock.calls[3][1]).toBe((1n << 256n) - 1n);
    expect(f.signer.encryptValue).not.toHaveBeenCalled();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });

  it.each(['fast-pool', 'cheap-async'] as const)('stops %s for wrong candidate, expired/revoked review and malformed input', async profile => {
    for (const fault of ['candidate', 'graph', 'pair', 'deadline', 'decline', 'revoke', 'expire', 'ciphertext', 'signature', 'prompt-revoke']) {
      const f = await cheapFixture(profile);
      Object.assign(f.request.terms, { toleranceBps: 50 });
      if (fault === 'candidate') f.request.graph.expectedGraph = 'wrong';
      if (fault === 'graph') mocks.sharedGraph.mockResolvedValueOnce({ ...cheapIdentity(), graph: 'wrong' });
      if (fault === 'pair') f.request.terms.inputToken = owner;
      if (fault === 'deadline') f.request.terms.deadline = 99n;
      if (fault === 'ciphertext') mocks.wide.mockResolvedValueOnce({ ciphertext: { ciphertextHigh: -1n, ciphertextLow: 0n }, signature });
      if (fault === 'signature') mocks.wide.mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 0n }, signature: '0x' });
      if (fault === 'prompt-revoke') mocks.wide.mockImplementationOnce(async () => {
        f.revoke(); return { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 0n }, signature };
      });
      f.request.confirmPrivateInputs.mockImplementation(async () => {
        if (fault === 'revoke') f.revoke();
        if (fault === 'expire') f.clock.mockReturnValue(100000);
        return fault !== 'decline';
      });
      if (fault === 'decline') await expect(f.capability.prepareCurrentQuote(f.request)).resolves.toBeNull();
      else await expect(f.capability.prepareCurrentQuote(f.request)).rejects.toThrow();
      if (!['ciphertext', 'signature', 'prompt-revoke'].includes(fault)) expect(mocks.wide).not.toHaveBeenCalled();
      expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    }
  });

  it('binds async READY context once and rejects later changes without legacy epochs', async () => {
    const f = await cheapFixture('cheap-async'), prepared = (await f.capability.prepareCurrentQuote({ ...f.request, terms: { ...f.request.terms, toleranceBps: 50 } }))!;
    const zero = `0x${'00'.repeat(32)}`, context = `0x${'66'.repeat(32)}`, txHash = `0x${'55'.repeat(32)}`;
    f.readProvider.getTransaction.mockResolvedValue({ hash: txHash });
    f.readProvider.getTransactionReceipt.mockResolvedValue({ hash: txHash });
    mocks.issued.mockResolvedValue({ operationId: 7n, originBlock: { number: 50n, hash }, block: { number: 50n, hash },
      operation: { phase: 'preparing-quote', contextHash: zero, deadline: 100n, stage: 1, ready: false } });
    const issued = (await prepared.readIssue(txHash))!;
    expect(() => assertCurrentCheapDexIssuedQuote(issued, f.signer)).not.toThrow();
    expect(() => assertCurrentCheapDexIssuedQuote({ ...issued }, f.signer)).toThrow('session');
    expect(issued.intent.contextHash).toBe(zero);
    mocks.current.mockResolvedValueOnce({ operationId: 7n, block: { number: 51n, hash },
      operation: { phase: 'quote-prepared', contextHash: context, deadline: 100n, stage: 4, ready: true } });
    const ready = await issued.readCurrent();
    expect(() => assertCurrentCheapDexIssuedQuote(ready, f.signer)).not.toThrow();
    expect(ready.intent.contextHash).toBe(context);
    expect(ready.operation).not.toHaveProperty('epochId');
    mocks.current.mockResolvedValueOnce({ operationId: 7n, block: { number: 52n, hash },
      operation: { phase: 'quote-prepared', contextHash: `0x${'77'.repeat(32)}`, deadline: 100n, stage: 4, ready: true } });
    await expect(issued.readCurrent()).rejects.toThrow('context changed');
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
});

async function restoreFixture(candidate: 'cheap-history' = 'cheap-history',profile:CurrentCheapDexProfile='cheap-async',selectedOwner=owner,maximumInput=20n){
  const owner=selectedOwner,f=await cheapFixture(profile,candidate,owner),c=resolveCurrentCheapDexCandidate(candidate),abi=new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
  Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey:'11'.repeat(16)})});
  const q={inputToken:c.tokens[0][0],outputToken:c.tokens[1][0],destination:owner,deadline:100n,maximumInput:[[maximumInput,0n],signature],minimumInput:[[5n,0n],signature],minimumOutput:[[1n,0n],signature],minimumRate:[[(1n<<128n)|1n,0n],signature],toleranceBps:50};
  const tx={hash:`0x${'55'.repeat(32)}`,from:owner,to:c.core as string,chainId:7082400n,value:0n,data:profile==='cheap-async'?abi.encodeFunctionData('quoteCheapAsync',[q]):abi.encodeFunctionData('quoteFastPool',Object.values(q)),nonce:4,gasLimit:110000000n,blockNumber:42,blockHash:hash};
  f.readProvider.getTransaction.mockResolvedValue(tx);f.readProvider.getTransactionReceipt.mockResolvedValue({hash:tx.hash,status:1,from:owner,to:c.core,blockNumber:42,blockHash:hash,logs:[]});
  f.readProvider.send.mockImplementation(async(method,params)=>method==='eth_getBlockByNumber'?{number:params[0]==='latest'?'0x2b':'0x2a',hash,timestamp:'0x63'}:undefined);
  mocks.inclusion.mockResolvedValue(undefined);mocks.reveal.mockImplementation((_s,cipher)=>BigInt(cipher.ciphertextHigh));mocks.rate.mockReturnValue(1n);
  const observed={candidate:c,chainId:7082400n,core:c.core,runtimeHash:c.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2],releaseId:c.releaseId,
    operationId:7n,principal:owner,transactionHash:tx.hash,originBlock:{number:42n,hash},block:{number:43n,hash,timestamp:99n},
    operation:{profile,phase:'quote-prepared',stage:profile==='cheap-async'?5:undefined,ready:true,contextHash:hash,deadline:100n}};
  mocks.issued.mockResolvedValue(observed);mocks.current.mockResolvedValue(observed);return{...f,tx,observed};
}

async function restorationConsumerFixture(fee = 50_000_000n, candidate: 'cheap-history' = 'cheap-history',profile:CurrentCheapDexProfile='cheap-async',selectedOwner=owner,now=()=>99n){
 const owner=selectedOwner,storage=pendingStorage(),f=await restoreFixture(candidate,profile,owner),c=resolveCurrentCheapDexCandidate(candidate);
 const restored=await f.capability.restoreCurrentQuote({quoteHash:f.tx.hash}),oldSigner={},scope=`quote:${keccak256(f.tx.data)}`;
 const budget=currentNativeSigningBudget(oldSigner,owner,()=>98n,c);budget.commit('quote',scope,110000000n,scope,4);recordCurrentNativeSwapHash(oldSigner,4,keccak256(f.tx.data),f.tx.hash);
 const authenticate=async(value:unknown)=>keccak256(toUtf8Bytes(JSON.stringify(value))),checkpoint=structuredClone(currentNativeSwapCheckpoint(oldSigner));
 writeCurrentDexNativeReload(storage,{budget:checkpoint,authentication:await authenticate(checkpoint)});
 storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner,core:c.core,graph:`0x${c.graph}`,phase:'quote',callHash:keccak256(f.tx.data),nonce:4,txHash:f.tx.hash}));
 const abi=new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI),event=profile==='cheap-async'?abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,1,`0x${'00'.repeat(32)}`]):abi.encodeEventLog(abi.getEvent('FastPoolQuoteIssued')!,[7n,hash,100n]);
 const receipt={hash:f.tx.hash,status:1,from:owner,to:c.core,blockNumber:42,blockHash:hash,logs:[{...event,address:c.core}]};
 const head={number:43n,hash,timestamp:99n,gasLimit:120000000n},resources=(h:typeof head)=>({owner,chainId:7082400n,head:h,latestNonce:5,pendingNonce:5,gasPrice:50000000n,baseFeePerGas:1n,balance:1000000000000000000n,code:'0x'});
 const transport={assertCurrent:f.assertCurrent,readHead:vi.fn(async()=>head),readNonce:vi.fn(async()=>5),readNativeResources:vi.fn(async(h:typeof head)=>resources(h)),
   readBlockHash:vi.fn(async()=>hash),readTransaction:vi.fn(async(_hash?:string)=>({...f.tx,gasPrice:fee})),waitForReceipt:vi.fn(async(_hash?:string)=>receipt),verifyCanonicalInclusion:vi.fn(async()=>{}),estimateGas:vi.fn(),send:vi.fn()};
 const original={...f.observed,kind:'quote',amounts:{filled:true,maximumInput:20n,actualInput:15n,refund:5n,grossOutput:20n,fee:1n,netOutput:19n},operation:{...f.observed.operation}};
 const readTerminalReceipt=vi.fn(async (_issued?: unknown, _upper?: bigint)=>({receipt,phase:'terminal' as const}));
 const readOriginalQuoteReceipt=vi.fn(async()=>original as never),verifyTokens=vi.fn(async(_args?:unknown)=>{}),adapter=createCurrentCheapDexSubmissionAdapter({candidate,signer:f.signer,ownerAddress:owner,chainId:7082400n,transport,
   attest:async()=>{},readOperation:async()=>f.observed as never,readReceipt:async()=>original as never,readOriginalQuoteReceipt,
   authenticateReload:authenticate,verifyOwnerTokens:verifyTokens,readTerminalReceipt,reviewAcceptance:async()=>null,requireFunding:async()=>{},now});
 return{...f,storage,c,restored,adapter,authenticate,transport,resources,original,verifyTokens,readOriginalQuoteReceipt,readTerminalReceipt};
}

async function activityConsumerFixture(candidate: 'cheap-history' = 'cheap-history') {
 const f=await restorationConsumerFixture(50_000_000n,candidate),scope=`quote:${keccak256(f.tx.data)}`,acceptHash=`0x${'66'.repeat(32)}`,terminalHash=`0x${'77'.repeat(32)}`;
 const abi=new Interface(['function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)']);
 const acceptTx={...f.tx,hash:acceptHash,data:abi.encodeFunctionData('acceptPrivateSwapV1',[7n,hash]),nonce:5,gasLimit:35000000n,gasPrice:50000000n,blockNumber:43};
 const quoteTx=await f.transport.readTransaction(),quoteReceipt=await f.transport.waitForReceipt();
 const acceptReceipt={...quoteReceipt,hash:acceptHash,blockNumber:43};
 const terminalReceipt={...quoteReceipt,hash:terminalHash,blockNumber:44};
 f.transport.readTransaction.mockImplementation(async h=>h===acceptHash?acceptTx:quoteTx);
 f.transport.waitForReceipt.mockImplementation(async h=>h===acceptHash?acceptReceipt:quoteReceipt);
 const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
 saved.budget.charges.push({phase:'accept',key:`accept:${scope}`,scope,gasCap:'35000000',...(candidate==='cheap-history'?{gasPrice:'50000000'}:{}),nonce:5,hash:acceptHash});
 saved.budget.committedWei=String(BigInt(saved.budget.committedWei)+1750000000000000n);saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
 f.observed.operation.stage=7;f.observed.operation.phase='consumed-unverified';f.observed.operation.ready=false;
 f.original.operation={...f.observed.operation};f.original.kind='terminal';f.original.block={...f.original.block,number:44n};
 f.readTerminalReceipt.mockResolvedValue({receipt:terminalReceipt,phase:'terminal'});
 return{...f,terminalReceipt};
}

async function closedActivityConsumerFixture(){
 const f=await activityConsumerFixture('cheap-history'),saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
 saved.budget.activeSwap=null;saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
 f.storage.removeItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
 const wait=f.transport.waitForReceipt.getMockImplementation()!,events=new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
 f.transport.waitForReceipt.mockImplementation(async h=>{
   const receipt=await wait(h);
   return h===`0x${'66'.repeat(32)}`?{...receipt,logs:[{address:f.c.core,...events.encodeEventLog(events.getEvent('CheapAsyncAdvanced')!,[7n,6,hash])}]}:receipt;
 });
 f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:6,pendingNonce:6}));
 f.readOriginalQuoteReceipt.mockRejectedValue(new Error('missing trie node'));
 return f;
}

async function closedFastConsumerFixture(selectedOwner=owner,now=()=>99n){
 const f=await restorationConsumerFixture(50_000_000n,'cheap-history','fast-pool',selectedOwner,now),scope=`quote:${keccak256(f.tx.data)}`,acceptHash=`0x${'66'.repeat(32)}`;
 const abi=new Interface(['function acceptFastPool(uint256,bytes32)']);
 const quoteTx=await f.transport.readTransaction(f.tx.hash),quoteReceipt=await f.transport.waitForReceipt(f.tx.hash);
 const acceptTx={...quoteTx,hash:acceptHash,data:abi.encodeFunctionData('acceptFastPool',[7n,hash]),nonce:5,gasLimit:110_000_000n,blockNumber:43};
 const acceptReceipt={...quoteReceipt,hash:acceptHash,blockNumber:43};
 f.transport.readTransaction.mockImplementation(async h=>h===acceptHash?acceptTx:quoteTx);
 f.transport.waitForReceipt.mockImplementation(async h=>h===acceptHash?acceptReceipt:quoteReceipt);
 f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:6,pendingNonce:6}));
 const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
 saved.budget.charges.push({phase:'accept',key:`accept:${scope}`,scope,gasCap:'110000000',nonce:5,hash:acceptHash});
 saved.budget.committedWei=String(220_000_000n*50_000_000n);saved.budget.activeSwap=null;
 saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);f.storage.removeItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
 f.observed.operation.ready=false;f.observed.operation.phase='consumed-unverified';f.original.operation={...f.observed.operation};f.original.kind='unverified';
 f.readOriginalQuoteReceipt.mockRejectedValue(new Error('missing trie node'));
 return{...f,acceptHash};
}

async function lostPartialLedgerFixture(){
 const f=await closedFastConsumerFixture(CURRENT_APP_SWAP_OWNER,()=>partialTrial.approvedAt),opening=new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
 const args=Array.from(opening.decodeFunctionData('quoteFastPool',f.tx.data));
 args[4]=[[1_000_000n,0n],signature];args[5]=[[0n,0n],signature];args[6]=[[1n,0n],signature];args[7]=[[1n,0n],signature];
 const fastData=opening.encodeFunctionData('quoteFastPool',args),older=[...args];older[3]=101n;
 const quoteData=[opening.encodeFunctionData('quoteCheapAsync',[args]),opening.encodeFunctionData('quoteCheapAsync',[older]),opening.encodeFunctionData('quoteFastPool',older),fastData];
 const approval=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']);
 const accept=new Interface(['function acceptFastPool(uint256,bytes32)','function acceptPrivateSwapV1(uint256,bytes32)','function recoverSwap(uint256)']);
 const data=[approval.encodeFunctionData('approve',[f.c.core,[[1n,0n],signature]]),quoteData[0],accept.encodeFunctionData('acceptPrivateSwapV1',[4n,hash]),accept.encodeFunctionData('recoverSwap',[4n]),
   approval.encodeFunctionData('approve',[f.c.core,[[2n,0n],signature]]),quoteData[1],accept.encodeFunctionData('acceptPrivateSwapV1',[5n,hash]),
   approval.encodeFunctionData('approve',[f.c.core,[[3n,0n],signature]]),quoteData[2],quoteData[3],accept.encodeFunctionData('acceptFastPool',[7n,hash])];
 const caps=[5n,110n,35n,50n,5n,110n,35n,5n,110n,110n,110n],events=new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
 const rows=ledgerRecovery.hashes.map((txHash,i)=>({ ...f.tx,hash:txHash,data:data[i],nonce:i<7?148+i:155+i,gasLimit:caps[i]*1_000_000n,gasPrice:50_000_000n,
   to:[0,4,7].includes(i)?f.c.tokens[0][0]:f.c.core,blockNumber:i===9?42:i===10?43:20+i }));
 const receipts=rows.map((tx,i)=>({hash:tx.hash,status:1,from:CURRENT_APP_SWAP_OWNER,to:tx.to,blockNumber:tx.blockNumber,blockHash:hash,
   logs:[1,5,8,9].includes(i)?[{address:f.c.core,...(i<8?events.encodeEventLog(events.getEvent('CheapAsyncAdvanced')!,[i===1?4n:5n,1,`0x${'0'.repeat(64)}`]):events.encodeEventLog(events.getEvent('FastPoolQuoteIssued')!,[i===8?6n:7n,hash,100n]))}]:[]}));
 f.transport.readTransaction.mockImplementation(async h=>rows.find(tx=>tx.hash===h)!);
 f.transport.waitForReceipt.mockImplementation(async h=>receipts.find(r=>r.hash===h)!);
 f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:217,pendingNonce:217}));
 f.readProvider.getTransaction.mockResolvedValue(rows[9]);f.readProvider.getTransactionReceipt.mockResolvedValue(receipts[9]);
 f.observed.transactionHash=ledgerRecovery.hashes[9];
 Object.assign(f.original.amounts,{maximumInput:1_000_000n,actualInput:1_000_000n,refund:0n,grossOutput:959_969n,fee:1n,netOutput:959_968n});

 const restored=await f.capability.restoreCurrentQuote({quoteHash:ledgerRecovery.hashes[9]});
 f.storage.removeItem(CURRENT_DEX_NATIVE_RELOAD_KEY);
 return{...f,restored};
}

async function recoveredConsumerFixture(){
 const f=await activityConsumerFixture('cheap-history'),scope=`quote:${keccak256(f.tx.data)}`,recoverHash=`0x${'77'.repeat(32)}`;
 const abi=new Interface(['function recoverSwap(uint256 operationId)','event CheapAsyncAdvanced(uint256 indexed quoteId,uint8 stage,bytes32 context)']);
 const recoverTx={...f.tx,hash:recoverHash,data:abi.encodeFunctionData('recoverSwap',[7n]),nonce:6,gasLimit:50_000_000n,gasPrice:50_000_000n,blockNumber:44};
 const read=f.transport.readTransaction.getMockImplementation()!,wait=f.transport.waitForReceipt.getMockImplementation()!;
 const acceptReceipt=await wait(`0x${'66'.repeat(32)}`);
 f.transport.readTransaction.mockImplementation(async h=>h===recoverHash?recoverTx:read(h));
 const recoverReceipt={...f.terminalReceipt,logs:[{address:f.c.core,...abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,8,hash])}]};
 f.transport.waitForReceipt.mockImplementation(async h=>h===recoverHash?recoverReceipt:h===acceptReceipt.hash?acceptReceipt:wait(h));
 f.transport.readNativeResources.mockImplementation(async h=>({...f.resources(h),latestNonce:7,pendingNonce:7}));
 const saved=JSON.parse(f.storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY)!);
 saved.budget.charges.push({phase:'recover',key:`recover:${scope}`,scope,gasCap:'50000000',gasPrice:'50000000',nonce:6,hash:recoverHash});
 saved.budget.committedWei=String(BigInt(saved.budget.committedWei)+2_500_000_000_000_000n);
 saved.authentication=await f.authenticate(saved.budget);writeCurrentDexNativeReload(f.storage,saved);
 f.storage.removeItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
 Object.assign(f.observed.operation,{stage:8,phase:'released',ready:false});
 f.original.operation={...f.observed.operation};
 Object.assign(f.original.amounts,{filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
 f.readTerminalReceipt.mockResolvedValue({receipt:recoverReceipt,phase:'recover' as never});
 f.readOriginalQuoteReceipt.mockRejectedValue(new Error('missing trie node'));
 return{...f,acceptReceipt,recoverTx};
}

async function keeperNominationFixture(profile: CurrentCheapDexProfile = 'cheap-async') {
  const f = await cheapFixture(profile, 'cheap-history');
  const request = { ...f.request, terms: { ...f.request.terms, toleranceBps: 50 } };
  const prepared = (await f.capability.prepareCurrentQuote(request))!, txHash = `0x${'55'.repeat(32)}`;
  f.readProvider.getTransaction.mockResolvedValue({ hash: txHash });
  f.readProvider.getTransactionReceipt.mockResolvedValue({ hash: txHash });
  const current = { operationId: 7n, block: { number: 10000001n, hash, timestamp: 99n },
    operation: { phase: 'preparing-quote', stage: 1, contextHash: `0x${'00'.repeat(32)}`, deadline: 100n, ready: false } };
  mocks.issued.mockResolvedValue({ ...current, principal: owner, transactionHash: txHash, originBlock: { number: 10000000n, hash } });
  mocks.current.mockResolvedValue(current);
  const issued = (await prepared.readIssue(txHash))!;
  return { ...f, prepared, issued, txHash, current };
}


const retainedKeeperAbi = new Interface(createRequire(import.meta.url)('../../../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/candidate.cjs').frozen().artifacts.ChainWhisperDexCore.abi);
function retainedKeeperCalldata(data: string) {
  const current = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI).decodeFunctionData('quoteCheapAsync', data).request;
  return retainedKeeperAbi.encodeFunctionData('quoteCheapAsync', [[...current.toArray().slice(0, 7), [1n, signature], [1n, signature], current.toleranceBps]]);
}


async function fixture(selectedOwner=owner) {
  const owner=selectedOwner;
  vi.clearAllMocks();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(99000);
  let current = true;
  const assertCurrent = async () => { if (!current) throw new Error('Session revoked'); };
  const signer = { encryptValue: vi.fn(async () => ({ ciphertext: 3n, signature })), sendUncheckedTransaction: vi.fn(),
    estimateGas: vi.fn(), getNonce: vi.fn(async () => 1) };
  const readProvider = { send: vi.fn(), getTransaction: vi.fn(), getTransactionReceipt: vi.fn() };
  mocks.issue.mockImplementation(async args => {
    expect(args.requirePrivacy).toBe(true);
    return args.bindCapability({ assertCurrent, assertSnapshotCurrent: () => { if (!current) throw new Error('Session revoked'); },
      signer, chainId: 7082400n, ownerAddress: owner, readProvider });
  });
  mocks.graph.mockResolvedValue({ graph: 'test-only', manifestHash: hash, chainId: 7082400n, core,
    inputToken: `0x${'33'.repeat(20)}`, outputToken: `0x${'44'.repeat(20)}`,
    maxWorkLifetime: 2000n, block: { number: 42n, hash, timestamp: 99n },
    operationReadIdentity: { runtimeHash: keccak256('0x6000'), releaseId: hash } });
  mocks.wide.mockResolvedValue({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature });
  const capability = await issueCurrentDexQuoteCapability({} as never);
  const request = { graph: { manifestJson: '{}', expectedManifestHash: hash, blockNumber: 42n, blockHash: hash },
    terms: { inputToken: `0x${'33'.repeat(20)}`, outputToken: `0x${'44'.repeat(20)}`,
      destination: owner, deadline: 100n, maximumInput: (1n << 256n) - 1n, minimumInput: 10n, minimumOutput: 0n,
      rateNumerator: (1n << 128n) - 1n, rateDenominator: 4n },
    confirmPrivateInputs: vi.fn(async (_review: unknown) => true) };
  return { capability, request, signer, readProvider, clock, assertCurrent,
    assertSnapshotCurrent: () => { if (!current) throw new Error('Session revoked'); },
    revoke: () => { current = false; } };
}

function sharedIdentity(blockNumber = 42n) {
  const candidate = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
  return { graph: candidate.graph, packageSha256: candidate.packageSha256, chainId: 7082400n,
    genesisHash: candidate.genesisHash, core: candidate.core, inputToken: candidate.tokens[0][0],
    outputToken: candidate.tokens[1][0], maxWorkLifetime: 900n,
    block: { number: blockNumber, hash, timestamp: 99n },
    operationReadIdentity: { runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
      releaseId: candidate.releaseId } };
}

async function sharedFixture(selectedOwner=owner) {
  const f = await fixture(selectedOwner);
  const transactions = new Map<string, Record<string, unknown>>();
  f.readProvider.getTransaction.mockImplementation(async (transactionHash: string) => transactions.get(transactionHash) ?? null);
  mocks.sharedGraph.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => sharedIdentity(blockNumber));
  const request = { ...f.request,
    graph: { candidate: 'cheap-history' as const, expectedGraph: STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph as string,
      expectedPackageSha256: STAGED_SHARED_HISTORY_DEX_CANDIDATE.packageSha256 as string, blockNumber: 42n, blockHash: hash },
    terms: { ...f.request.terms, inputToken: STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokens[0][0],
      outputToken: STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokens[1][0], maximumInput: 20n, minimumInput: 5n, minimumOutput: 1n,
      rateNumerator: 1n, rateDenominator: 1n } };
  return { ...f, request, recordCanonicalTransaction: (txHash: string, request: Record<string, unknown>) => {
    transactions.set(txHash, { ...request, hash: txHash, chainId: 7082400n, blockNumber: 50, blockHash: hash });
  } };
}

function cheapIdentity(blockNumber = 42n, candidateKey: CurrentCheapDexCandidateKey = 'cheap-history') {
  const candidate = resolveCurrentCheapDexCandidate(candidateKey);
  return { ...sharedIdentity(blockNumber), graph: candidate.graph, packageSha256: candidate.packageSha256,
    core: candidate.core, genesisHash: candidate.genesisHash, inputToken: candidate.tokens[0][0], outputToken: candidate.tokens[1][0],
    operationReadIdentity: { runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2], releaseId: candidate.releaseId } };
}

async function cheapFixture(profile: CurrentCheapDexProfile, candidateKey: CurrentCheapDexCandidateKey = 'cheap-history',selectedOwner=owner) {
  const f = await sharedFixture(selectedOwner);
  const selected = resolveCurrentCheapDexCandidate(candidateKey);
  mocks.sharedGraph.mockImplementation(async ({ candidate, blockNumber }: { candidate: string; blockNumber: bigint }) => {
    expect(candidate).toBe(candidateKey);
    return cheapIdentity(blockNumber, candidateKey);
  });
  const request = { ...f.request, profile,
    graph: { ...f.request.graph, candidate: candidateKey, expectedGraph: selected.graph as string,
      expectedPackageSha256: selected.packageSha256 as string },
    terms: { ...f.request.terms, inputToken: selected.tokens[0][0] as string, outputToken: selected.tokens[1][0] as string } };
  return { ...f, request };
}
