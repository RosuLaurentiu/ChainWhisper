import { getAddress, Interface, keccak256 } from '@coti-io/coti-ethers';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as archived, STAGED_NATIVE_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, currentCheapDexStages } from './dexV2Deployment';
import { assertCurrentD06AppAuthority, CURRENT_APP_SWAP_OWNER, CURRENT_APP_SWAP_AUTHORITY } from './currentDexC1SwapPolicy';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI, decodeCurrentCheapDexOperation, type CurrentCheapDexProfile } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/contracts';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_DEX_OPERATION_LOOKUPS_KEY, readCurrentDexOperationLookups,
  recordCurrentDexOperationLookup } from './currentDexPendingAttempt';
import { CURRENT_DEX_NATIVE_RELOAD_KEY, readCurrentDexNativeReload, writeCurrentDexNativeReload } from './currentDexNativeReload';
import { CURRENT_CHEAP_DEX_GAS_CAPS } from './currentDexSubmission';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
import { currentDexOwnerTransferAbi } from './currentDexOwnerTokenProof';
import { currentNativeSigningBudget, recordCurrentNativeSwapHash, currentNativeSwapCheckpoint, restoreCurrentNativeSwapCheckpoint, completeCurrentNativeSwapScope } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_REPLACEMENT_TRIAL, CURRENT_APP_FURTHER_TRIAL, CURRENT_APP_FOURTH_TRIAL } from './currentDexC1SwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY } from './currentDexC1SwapPolicy';
import { currentOwnerBetaLegacyReservationHash } from './currentDexNativeSwapPolicy';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
const ownerBeta = vi.hoisted(() => ({ active: false, activation: { activatedAt: 2_000_000_000n, startingNonce: 220, legacyReservationHash:'' } }));
vi.mock('./currentDexOwnerBetaPolicy', async importOriginal => {
  const actual=await importOriginal<typeof import('./currentDexOwnerBetaPolicy')>();
  const selected=(graph:string,owner:string)=>ownerBeta.active&&graph===actual.CURRENT_OWNER_BETA.graph&&owner.toLowerCase()===actual.CURRENT_OWNER_BETA.owner;
  return {...actual,CURRENT_OWNER_BETA:{...actual.CURRENT_OWNER_BETA,activation:ownerBeta.activation},isCurrentOwnerBeta:selected,
    assertCurrentOwnerBetaWindow:(graph:string,owner:string,core:string,chainId:bigint,now:bigint,nonce:number,recovery:boolean,cap:bigint,price:bigint)=>{
      if(!selected(graph,owner)||core.toLowerCase()!==actual.CURRENT_OWNER_BETA.core||chainId!==7082400n)throw new Error('Owner beta identity changed.');
      actual.checkCurrentOwnerBetaWindow(ownerBeta.activation,now,nonce,recovery,cap,price);
    }};
});

const m = vi.hoisted(() => ({ owner: vi.fn(), graph: vi.fn(), issue: vi.fn(), operation: vi.fn(), receipts: vi.fn(),
  wide: vi.fn(), decrypt: vi.fn() }));
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: m.owner }));
vi.mock('../features/wallet/currentDexReceiptCapability', () => ({ issueCurrentDexReceiptCapability: m.receipts }));
vi.mock('./appChain', () => ({ readCurrentDexGraph: vi.fn(), readCurrentDexIssuedQuote: m.issue, readCurrentDexOperation: m.operation }));
vi.mock('./dexV2Chain', async original => ({ ...await original<typeof import('./dexV2Chain')>(),
  readCurrentSharedPoolDexGraph: m.graph, readCurrentDexOperation: m.operation }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.wide, decryptPrivateUint256Output: m.decrypt }));
// Retain the frozen 04ea protocol regression fixture, whose production sends
// are now retired. This local-only exact identity grant is not deployment policy.
vi.mock('./dexV2Deployment', async original => {
  const actual = await original<typeof import('./dexV2Deployment')>();
  return { ...actual, assertCurrentCheapDexNativeAdmission: (candidate: typeof archived) => {
    if (JSON.stringify(candidate) === JSON.stringify(actual.ARCHIVED_CHEAP_DEX_CANDIDATE)) return;
    actual.assertCurrentCheapDexNativeAdmission(candidate);
  } };
});
// Only this test can replace the owner hold; production exposes no activation input.
vi.mock('./currentDexC1SwapPolicy', async original => {
  const actual = await original<typeof import('./currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentD06AppAuthority: vi.fn(actual.assertCurrentD06AppAuthority) };
});
const c = archived;
const opening = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI), accept = new Interface(CURRENT_DEX_ACCEPT_ABI);
const publicAbi = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI), token = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const owner = `0x${'22'.repeat(20)}`, blockHash = `0x${'33'.repeat(32)}`, context = `0x${'66'.repeat(32)}`;
const zero = `0x${'00'.repeat(32)}`, signature = `0x${'44'.repeat(65)}`;
const native = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/current-pool-case.cjs').frozen();
afterEach(() => { ownerBeta.active=false; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function fixture(profile: CurrentCheapDexProfile, useNative: boolean | 'd06' | 'exit' | 'history' = false, selectedOwner = owner, operationId = 7n, deadline = 200n) {
  const owner = selectedOwner;
  const c = useNative === 'history' ? history : useNative === 'exit' ? STAGED_EXIT_PREVIEW_DEX_CANDIDATE : useNative === 'd06' ? STAGED_D06_DEX_CANDIDATE : useNative ? STAGED_NATIVE_DEX_CANDIDATE : archived, stages = currentCheapDexStages(c);
  const candidate = useNative === 'history' ? 'cheap-history' : useNative === 'exit' ? 'cheap-exit' : useNative === 'd06' ? 'cheap-d06' : useNative ? 'cheap-native' : 'cheap-archived';
  const opening = new Interface(useNative ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
  const compiled = useNative === 'history' ? new Interface(createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/candidate.cjs').frozen().artifacts.ChainWhisperDexCore.abi) : useNative === 'exit' ? new Interface(createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/candidate.cjs').frozen().artifacts.ChainWhisperDexCore.abi) : useNative ? new Interface(JSON.parse(readFileSync(useNative === 'd06'
    ? 'reports/current-dex-c1-integration-2026-10-06/core-abi.json' : 'reports/next-dex-app-2026-10-04/core-abi.json', 'utf8'))) : native.iface;
  vi.clearAllMocks();
  const initialTime=useNative==='history'?ownerBeta.activation.activatedAt:100n;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Number(initialTime)*1000), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage: storage });
  let live = true, stage = profile === 'cheap-async' ? 1 : 4, ready = true, boundContext = profile === 'cheap-async' ? zero : context;
  let balance = 100n, allowance = useNative === 'exit' || useNative === 'history' ? 20n : 100n, latest = 55, headGas = 150_000_000n;
  let baseFeePerGas = '0x2faf080';
  const guard = async () => { if (!live) throw new Error('Session revoked'); };
  const currentOperation = () => decodeCurrentCheapDexOperation(
    profile === 'cheap-async' ? publicAbi.encodeFunctionResult('cheapAsyncPublic', [stage, boundContext, deadline]) :
      publicAbi.encodeFunctionResult('fastPoolQuotePublic', [boundContext, deadline, ready]), BigInt(clock() / 1000), profile, c);
  const snapshot = () => ({ candidate: c, operationId, operation: currentOperation(), chainId: 7082400n,
    core: c.core, principal: owner, runtimeHash: c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
    releaseId: c.releaseId, block: { number: BigInt(latest), hash: blockHash, timestamp: initialTime } });
  const transactions = new Map<string, Record<string, unknown>>(), receipts = new Map<string, Record<string, unknown>>();
  const ownerTransfer = (tokenAddress: string, from: string, to: string, amount: bigint) => ({ address: tokenAddress,
    ...currentDexOwnerTransferAbi.encodeEventLog(currentDexOwnerTransferAbi.getEvent('Transfer')!, [from, to,
      [from.toLowerCase() === owner ? amount : 901n, 1n], [to.toLowerCase() === owner ? amount : 902n, 1n]]) });
  const originLogs = (logs: { address: string; topics: string[]; data: string }[], hash: string) => logs.map((log, index) => ({
    ...log, index, transactionHash: hash, blockNumber: 50, blockHash, removed: false }));
  const signer = { getUserOnboardInfo: () => ({ aesKey: useNative === 'exit' || useNative === 'history' ? '11'.repeat(16) : 'test-only' }),
    encryptValue: vi.fn(async () => ({ ciphertext: 3n, signature })), estimateGas: vi.fn(async () => { if(useNative) return 10_000_000n; throw new Error('MPC estimate must not run'); }),
    getNonce: vi.fn(async () => 4), sendUncheckedTransaction: vi.fn(async request => {
      if (useNative === 'exit') {
        const saved = readCurrentDexNativeReload(storage)!;
        expect(saved.authentication).toMatch(/^0x[0-9a-f]{64}$/);
        expect(saved.budget.start).toBe('100');
        expect(saved.budget.charges).toHaveLength(transactions.size + 1);
        expect(saved.budget.charges[saved.budget.charges.length - 1]).toMatchObject({ nonce: request.nonce, gasCap: String(request.gasLimit), hash: null });
        expect(JSON.parse(storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ nonce: request.nonce, txHash: null });
      }
      const nativeCall = compiled.parseTransaction({ data: request.data });
      expect(nativeCall).not.toBeNull();
      expect(compiled.encodeFunctionData(nativeCall!.name, nativeCall!.args)).toBe(request.data);
      const name = nativeCall!.name, hash = `0x${(name.startsWith('quote') ? '77' : name.startsWith('accept') ? '88' : '99').repeat(32)}`;
      const quote = name.startsWith('quote');
      if (!quote) { if (name.startsWith('accept')) { stage = stages.funded; boundContext = context; ready = false; } else stage = stages.released; }
      const event = profile === 'fast-pool' && quote ? opening.encodeEventLog(opening.getEvent('FastPoolQuoteIssued')!, [operationId, context, deadline]) :
        profile === 'cheap-async' ? opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, quote ? 1 : stage, quote ? zero : boundContext]) : null;
      const tx = { ...request, hash, blockNumber: 50, blockHash };
      transactions.set(hash, tx);
      const logs: {address:string;topics:string[];data:string}[] = event ? [{ address: c.core, ...event }] : [];
      if (useNative === 'exit' && name.startsWith('accept')) {
        logs.push(ownerTransfer(c.tokens[0][0], owner, c.core, amounts.maximumInput));
        if (profile === 'fast-pool') logs.push(ownerTransfer(c.tokens[1][0], c.core, owner, amounts.netOutput), ownerTransfer(c.tokens[0][0], c.core, owner, amounts.refund));
      }
      if (useNative === 'exit' && name === 'recoverSwap') logs.push(ownerTransfer(c.tokens[0][0], c.core, owner, amounts.maximumInput));
      receipts.set(hash, { hash, status: 1, from: owner, to: c.core, blockNumber: 50, blockHash,
        logs: useNative === 'exit' ? originLogs(logs, hash) : logs });
      return hash;
    }) };
  const readProvider = { getTransaction: vi.fn(async hash => transactions.get(hash) ?? null),
    waitForTransaction: vi.fn(async hash => receipts.get(hash) ?? null),
    getTransactionReceipt: vi.fn(async hash => receipts.get(hash) ?? null),
    getLogs: vi.fn(async (filter: { topics: string[] }) => [...receipts.values()].flatMap(r => r.logs as ReturnType<typeof originLogs>).filter(log =>
      log.address.toLowerCase() === c.core.toLowerCase() && log.topics[0] === filter.topics[0] && log.topics[1] === filter.topics[1])),
    send: vi.fn(async (method, params) => {
      if (method === 'eth_chainId') return `0x${(7082400).toString(16)}`;
      if (method === 'eth_getTransactionCount') return useNative==='history'?'0xdc':'0x4';
      if (method === 'eth_gasPrice') return '0x2faf080';
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (method === 'eth_getCode') return '0x';
      if (method === 'eth_getTransactionByHash') { const tx=transactions.get(params[0])!; return {...tx, input:tx.data, chainId:'0x6c11a0',value:'0x0',nonce:`0x${(tx.nonce as number).toString(16)}`,gas:`0x${(tx.gasLimit as bigint).toString(16)}`,blockNumber:'0x32',transactionIndex:`0x${[...transactions.keys()].indexOf(params[0]).toString(16)}`}; }
      if (method === 'eth_getTransactionReceipt') { const receipt=receipts.get(params[0])!;return {...receipt,transactionHash:receipt.hash,status:'0x1',blockNumber:'0x32',transactionIndex:`0x${[...transactions.keys()].indexOf(params[0]).toString(16)}`,
        ...(useNative === 'exit' ? { logs: (receipt.logs as ReturnType<typeof originLogs>).map(log => ({ ...log, blockNumber:'0x32',logIndex:`0x${log.index.toString(16)}` })) } : {}) }; }
      if (method === 'eth_getBlockByNumber') return { number: params[0] === 'latest' ? `0x${latest.toString(16)}` : params[0],
        hash: blockHash, timestamp: `0x${initialTime.toString(16)}`, gasLimit: `0x${headGas.toString(16)}`, baseFeePerGas, transactions:[...transactions.keys()] };
      if (method === 'eth_call') {
        const call = token.parseTransaction({ data: params[0].data });
        expect(params[0].from.toLowerCase()).toBe(owner); expect(params[0].to.toLowerCase()).toBe(c.tokens[0][0]);
        expect(params[1]).toEqual({ blockHash, requireCanonical: true });
        if (call!.name === 'balanceOf') return token.encodeFunctionResult('balanceOf(address)', [[balance, 1n]]);
        expect(call!.args.map(String).map(x => x.toLowerCase())).toEqual([owner, c.core]);
        return token.encodeFunctionResult('allowance(address,address)', [[[999999n, 1n], [allowance, allowance ? 1n : 0n], [888888n, 1n]]]);
      }
      throw new Error('Unexpected RPC ' + method);
    }) };
  const bind = async (args: { bindCapability: (input: unknown) => Promise<unknown> }) => args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: () => { if (!live) throw new Error('Session revoked'); },
    signer, readProvider, ownerAddress: owner, chainId: 7082400n });
  m.owner.mockImplementation(bind);
  m.wide.mockResolvedValue({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature });
  m.decrypt.mockImplementation((_signer, ciphertext) => BigInt(ciphertext.ciphertextHigh));
  m.graph.mockImplementation(async request => ({ graph: c.graph, packageSha256: c.packageSha256, chainId: 7082400n, core: c.core,
    genesisHash: c.genesisHash, inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], maxWorkLifetime: 900n,
    block: { number: request.blockNumber, hash: request.blockHash, timestamp: initialTime },
    operationReadIdentity: { runtimeHash: snapshot().runtimeHash, releaseId: c.releaseId } }));
  m.issue.mockImplementation(async args => ({ ...snapshot(), transactionHash: args.issue.expected.transactionHash,
    originBlock: { number: 50n, hash: blockHash } }));
  m.operation.mockImplementation(async () => snapshot());
  const amounts = { filled: true, maximumInput: 20n, actualInput: 15n, refund: 5n, grossOutput: 17n, fee: 1n, netOutput: 16n };
  const readReceipt = vi.fn(async () => ({ ...snapshot(), kind: profile === 'cheap-async' && stage >= stages.settled ? 'terminal' : ready || stage === stages.ready ? 'quote' : 'unverified', amounts }));
  m.receipts.mockResolvedValue({ readCurrent: readReceipt });
  const quoteCapability = await issueCurrentDexQuoteCapability({} as never);
  const prepared = (await quoteCapability.prepareCurrentQuote({ profile,
    graph: { candidate, expectedGraph: c.graph, expectedPackageSha256: c.packageSha256, blockNumber: 42n, blockHash },
    terms: { inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], destination: owner, deadline,
      maximumInput: 20n, minimumInput: 5n, minimumOutput: 1n, rateNumerator: 1n, rateDenominator: 1n, ...(useNative ? {toleranceBps:50} : {}) },
    confirmPrivateInputs: async () => true }))!;
  const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate } as never);
  const quote = async () => { const submitted = await capability.submitCurrentCheapQuote(prepared); return submitted.recover(); };
  const terminal = (recover = false) => {
    stage = recover ? stages.released : stages.settled;
    const hash = `0x${'ab'.repeat(32)}`, method = recover ? 'recoverSwap' : 'advanceFixedWork';
    const event = opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [7n, stage, boundContext]);
    transactions.set(hash, { hash, chainId:7082400n, from:`0x${'ac'.repeat(20)}`, to:c.core,value:0n,
      data:compiled.encodeFunctionData(method,[7n]),nonce:4,gasLimit:110_000_000n,blockNumber:50,blockHash });
    const logs = [{address:c.core,...event}, ...(recover ? [ownerTransfer(c.tokens[0][0],c.core,owner,amounts.maximumInput)] :
      [ownerTransfer(c.tokens[1][0],c.core,owner,amounts.netOutput),ownerTransfer(c.tokens[0][0],c.core,owner,amounts.refund)])];
    receipts.set(hash,{hash,status:1,from:`0x${'ac'.repeat(20)}`,to:c.core,blockNumber:50,blockHash,logs:originLogs(logs,hash)});
    return hash;
  };
  return { profile, signer, values, clock, readProvider, prepared, capability, quote, transactions, receipts, readReceipt, amounts,
    terminal,
    currentOperation, bind, setState: (next: number, nextContext = context) => { stage = next; boundContext = nextContext; ready = next === stages.ready; },
    setFunding: (b: bigint, a: bigint) => { balance = b; allowance = a; },
    setHeadGas: (gas: bigint) => { headGas = gas; }, revoke: () => { live = false; },
    setBaseFee: (fee: string) => { baseFeePerGas = fee; },
    setLatest: (number: number) => { latest = number; } };
}

const ownerBetaLegacy = () => {
  const phases=['token-funding','quote','accept','recover','token-funding','quote','accept','token-funding','quote','quote','accept','token-funding','quote','accept'] as const;
  const caps=[5n,110n,35n,50n,5n,110n,35n,5n,110n,110n,110n,5n,110n,35n];
  const hashes=[...CURRENT_APP_PARTIAL_LEDGER_RECOVERY.hashes,'0x2e8c953987b9da4dd5149b8053b503bc152ae4fcb699a0597f74e7686201e57e','0xf0555667b314df628eebefd04709adccbd64315e5ea244d6c7dfe0f526ad2bcc','0x38f0f3117ec7985797aee9636754aa29186970329e07fb9f8918e55b4d990210'];
  const charges=phases.map((phase,i)=>{
    const scope=`quote:0x${String(i<4?1:i<7?2:i<9?3:i<11?4:5).repeat(64)}`;
    return {phase,scope,key:phase==='token-funding'?`${phase}:${scope}:0x${'a'.repeat(64)}`:phase==='quote'?scope:`${phase}:${scope}`,
      gasCap:String(caps[i]*1_000_000n),gasPrice:'50000000',nonce:i<7?148+i:i<11?155+i:206+i,hash:hashes[i]};
  });
  const value={version:1 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,start:'1792198683',windowStart:'1792441436',activeSwap:null,
    committedWei:String(caps.reduce((sum,cap)=>sum+cap*1_000_000n*50_000_000n,0n)),charges};
  ownerBeta.activation.legacyReservationHash=currentOwnerBetaLegacyReservationHash(value);
  return value;
};

describe('Decision-030 actual adapter and shared send boundary', () => {
  it.each((['fast-pool','cheap-async'] as const).flatMap(profile=>[false,true].map(approval=>({profile,approval}))))('keeps legacy charges and a durable no-resend lock for owner $profile Quote, approval:$approval', async ({profile,approval}) => {
    ownerBeta.active=true;
    const f=await fixture(profile,'history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n),legacy=ownerBetaLegacy();
    restoreCurrentNativeSwapCheckpoint(f.signer,CURRENT_APP_SWAP_OWNER,history,legacy);
    writeCurrentDexNativeReload(window.sessionStorage,{budget:currentNativeSwapCheckpoint(f.signer),authentication:zero});
    if(approval){
      f.setFunding(100n,0n);
      const data=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']).encodeFunctionData('approve',[history.core,{ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature}]);
      const request={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:f.prepared.intent.inputToken,value:0n as const,data,nonce:220,gasLimit:5_000_000n,gasPrice:50_000_000n};
      await f.capability.authorizeCurrentCheapSwapApproval(f.prepared,request);
      await f.capability.rememberCurrentCheapSwapApproval({request,transactionHash:`0x${'de'.repeat(32)}`});
      f.setFunding(100n,20n);
      const rpc=f.readProvider.send.getMockImplementation()!;
      f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0xdd'):rpc(method,params));
    }
    const nonce=approval?221:220;
    f.signer.getNonce.mockResolvedValue(nonce);
    f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_OWNER_WALLET_BOUNDARY'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('TEST_OWNER_WALLET_BOUNDARY');
    const saved=readCurrentDexNativeReload(window.sessionStorage)!;
    expect(saved.budget.charges.slice(0,14)).toEqual(legacy.charges);
    expect(saved.budget.charges[approval?15:14]).toMatchObject({phase:'quote',nonce,gasPrice:'50000000',hash:null});
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({nonce,txHash:null});
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    const reconnected=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history'} as never);
    await expect(reconnected.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });

  it.each(['allowed','early','expired','nonce','missing','corrupt','legacy-scope','pending'] as const)('checks owner claim admission without trial quotas: %s',async fault=>{
    ownerBeta.active=true;
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    if(fault!=='missing')writeCurrentDexNativeReload(storage,{budget:ownerBetaLegacy(),authentication:zero});
    if(fault==='legacy-scope'){
      const saved=readCurrentDexNativeReload(storage)!,scope=`quote:0x${'e'.repeat(64)}`;
      writeCurrentDexNativeReload(storage,{...saved,budget:{...saved.budget,charges:saved.budget.charges.map((row,i)=>i===0?{...row,scope,key:`token-funding:${scope}:0x${'a'.repeat(64)}`}:row)}});
    }
    if(fault==='corrupt')values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    if(fault==='pending')values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,'{bad');
    const now=ownerBeta.activation.activatedAt+(fault==='early'?-1n:fault==='expired'?604800n:0n),nonce=fault==='nonce'?10_000:220;
    const head={number:55n,hash:blockHash,timestamp:now,gasLimit:120_000_000n};
    const send=vi.fn(async()=>{throw new Error('TEST_OWNER_WALLET_BOUNDARY');});
    const transport={assertCurrent:async()=>{},readHead:async()=>head,readNonce:async()=>nonce,estimateGas:async()=>1_000_000n,send,
      readNativeResources:async()=>({owner:CURRENT_APP_SWAP_OWNER,chainId:7082400n,head,latestNonce:nonce,pendingNonce:nonce,gasPrice:50_000_000n,baseFeePerGas:50_000_000n,code:'0x',balance:1_000_000_000_000_000_000n})} as unknown as CurrentTransport;
    const boundary=createCurrentAttemptBoundary({storage,c:history,core:history.core,owner:CURRENT_APP_SWAP_OWNER,chainId:7082400n,transport,attest:async()=>{},now:()=>now,historical:false,bindTarget:true});
    const token=history.tokenMetadata[3].address,call={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:token,value:0n as const,data:new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet')};
    const execute=()=>boundary.sendCurrent('token-faucet',call,undefined,()=>{},()=>{},undefined,5_000_000n,undefined,undefined,undefined,undefined,undefined,{action:'initial',token});
    const admitted=['allowed','expired','nonce'].includes(fault);
    await expect(execute()).rejects.toThrow(admitted?'TEST_OWNER_WALLET_BOUNDARY':fault==='missing'||fault==='legacy-scope'?'retained':fault==='corrupt'?'invalid':fault==='pending'?'invalid':'check failed');
    expect(send).toHaveBeenCalledTimes(admitted?1:0);
    if(admitted){
      expect(JSON.parse(values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({nonce,txHash:null});
      await expect(execute()).rejects.toThrow('pending attempt');
      expect(send).toHaveBeenCalledOnce();
    }
  });
  it.each(['valid','authentication','allowance'] as const)('restores an unquoted beta approval with legacy history after wallet reload: %s',async fault=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    restoreCurrentNativeSwapCheckpoint(f.signer,CURRENT_APP_SWAP_OWNER,history,ownerBetaLegacy());
    writeCurrentDexNativeReload(window.sessionStorage,{budget:currentNativeSwapCheckpoint(f.signer),authentication:zero});
    f.setFunding(100n,0n);
    const data=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']).encodeFunctionData('approve',[history.core,{ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature}]);
    const request={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:f.prepared.intent.inputToken,value:0n as const,data,nonce:220,gasLimit:5_000_000n,gasPrice:50_000_000n},hash=`0x${'de'.repeat(32)}`;
    await f.capability.authorizeCurrentCheapSwapApproval(f.prepared,request);
    f.transactions.set(hash,{...request,hash,blockNumber:50,blockHash});
    f.receipts.set(hash,{hash,status:1,from:request.from,to:request.to,blockNumber:50,blockHash,logs:[]});
    await f.capability.rememberCurrentCheapSwapApproval({request,transactionHash:hash});
    const saved=readCurrentDexNativeReload(window.sessionStorage)!;
    if(fault==='authentication')writeCurrentDexNativeReload(window.sessionStorage,{...saved,authentication:zero});
    f.setFunding(100n,fault==='allowance'?21n:20n);
    const signer={...f.signer},rpc=f.readProvider.send.getMockImplementation()!;
    signer.getNonce.mockResolvedValue(221);
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0xdd'):rpc(method,params));
    m.owner.mockImplementation(async args=>args.bindCapability({assertCurrent:async()=>{},assertSnapshotCurrent:()=>{},signer,readProvider:f.readProvider,ownerAddress:CURRENT_APP_SWAP_OWNER,chainId:7082400n}));
    const quotes=await issueCurrentDexQuoteCapability({} as never);
    const fresh=(await quotes.prepareCurrentQuote({profile:'cheap-async',graph:{candidate:'cheap-history',expectedGraph:history.graph,expectedPackageSha256:history.packageSha256,blockNumber:55n,blockHash},
      terms:{...f.prepared.intent,deadline:ownerBeta.activation.activatedAt+899n},confirmPrivateInputs:async()=>true}))!;
    const capability=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history'} as never);
    signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_OWNER_WALLET_BOUNDARY'));
    await expect(capability.submitCurrentCheapQuote(fresh)).rejects.toThrow(fault==='valid'?'TEST_OWNER_WALLET_BOUNDARY':fault==='authentication'?'authenticated':'allowance must equal');
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledTimes(fault==='valid'?1:0);
    expect(readCurrentDexNativeReload(window.sessionStorage)!.budget.charges.slice(0,15)).toEqual(saved.budget.charges);
  });
});

describe('b2aa owner token boundary with a test-only cleared App hold', () => {
  it.each([120_000_000n,119_999_999n])('uses the registered Fast Accept reserve at block gas %s',async headGas=>{
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(()=>{});
    const f=await fixture('fast-pool','exit'),issued=await f.quote();
    f.setHeadGas(headGas);
    const result=f.capability.submitCurrentCheapAcceptance({issued,confirm:async()=>true});
    if(headGas===120_000_000n){
      await expect(result).resolves.toMatchObject({request:{gasLimit:110_000_000n}});
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    }else{
      await expect(result).rejects.toThrow('gas headroom');
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    }
  });
  it.each([50n,51n,52n].flatMap(operationId=>[20n,0n,21n].map(allowance=>({operationId,allowance}))))('reuses only exact allowance after cancelled Quote$operationId: $allowance', async ({operationId,allowance}) => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'exit', CURRENT_APP_SWAP_OWNER, operationId), candidate = STAGED_EXIT_PREVIEW_DEX_CANDIDATE;
    const trial=operationId===50n?CURRENT_APP_REPLACEMENT_TRIAL:operationId===51n?CURRENT_APP_FURTHER_TRIAL:CURRENT_APP_FOURTH_TRIAL,
      quoteNonce=operationId===50n?139:operationId===51n?141:143;
    const opening = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI), actions = new Interface(['function cancelSwap(uint256)']);
    const sends = [
      { hash: trial.quoteHash, data: f.prepared.data, nonce: quoteNonce, stage: 1, status: 1 },
      ...(operationId === 52n ? [{ hash: CURRENT_APP_FOURTH_TRIAL.failedAcceptHash,
        data: accept.encodeFunctionData('acceptPrivateSwapV1', [operationId, zero]), nonce: quoteNonce + 1,
        stage: 4, status: 0 }] : []),
      { hash: trial.cancelHash, data: actions.encodeFunctionData('cancelSwap', [operationId]),
        nonce: quoteNonce + (operationId === 52n ? 2 : 1), stage: 8, status: 1 }
    ];
    for (const sent of sends) {
      const tx = { hash: sent.hash, data: sent.data, nonce: sent.nonce, chainId: 7082400n,
        from: CURRENT_APP_SWAP_OWNER, to: candidate.core, value: 0n,
        gasLimit: sent.stage === 1 ? 110_000_000n : sent.stage === 4 ? 35_000_000n : 30_000_000n,
        gasPrice: 52_000_000n, blockNumber: 50, blockHash };
      const logs = sent.status === 0 ? [] : [{ address: candidate.core,
        ...opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, sent.stage, zero]),
        index: 0, transactionHash: sent.hash, blockNumber: 50, blockHash, removed: false }];
      f.transactions.set(sent.hash, tx); f.receipts.set(sent.hash, { hash: sent.hash, status: sent.status,
        from: tx.from, to: tx.to, blockNumber: 50, blockHash, logs });
    }
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ version: 1, chainId: '7082400', owner: CURRENT_APP_SWAP_OWNER,
      core: candidate.core, graph: `0x${candidate.graph}`, phase: 'quote', nonce: quoteNonce, callHash: keccak256(f.prepared.data), txHash: trial.quoteHash }));
    const issued = await f.capability.recoverCurrentCheapQuote(f.prepared, trial.quoteHash);
    f.setState(8, zero);
    Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    const scope = `quote:${keccak256(f.prepared.data)}`, seed = {}, budget = currentNativeSigningBudget(seed, CURRENT_APP_SWAP_OWNER, () => 100n, candidate);
    const phases = operationId===50n?['token-faucet', 'token-funding', 'quote', 'cancel'] as const:
      operationId===51n?['token-faucet', 'token-funding', 'quote', 'cancel','quote','cancel'] as const:
      ['token-faucet', 'token-funding', 'quote', 'cancel','quote','cancel','quote','accept','cancel'] as const;
    const caps = [5_000_000n, 5_000_000n, 110_000_000n, 30_000_000n,110_000_000n,30_000_000n,
      110_000_000n,35_000_000n,30_000_000n];
    const hashes = ['0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350',
      '0xd2d1b519ac3dbd29216babad015da73a859723645d28958c6aac0f0b18510974', CURRENT_APP_REPLACEMENT_TRIAL.quoteHash, CURRENT_APP_REPLACEMENT_TRIAL.cancelHash,
      CURRENT_APP_FURTHER_TRIAL.quoteHash,CURRENT_APP_FURTHER_TRIAL.cancelHash,CURRENT_APP_FOURTH_TRIAL.quoteHash,
      CURRENT_APP_FOURTH_TRIAL.failedAcceptHash,CURRENT_APP_FOURTH_TRIAL.cancelHash];
    phases.forEach((phase, i) => {
      const chargeScope=operationId===51n&&i<4||operationId===52n&&i<4?`quote:0x${'11'.repeat(32)}`:
        operationId===52n&&i<6?`quote:0x${'22'.repeat(32)}`:scope;
      const key = i < 2 ? `${phase}:${chargeScope}:${zero}` : phase === 'quote' ? chargeScope : `${phase}:${chargeScope}`;
      budget.commit(phase, key, caps[i], chargeScope, 137 + i);
      recordCurrentNativeSwapHash(seed, 137 + i, phase==='quote'?chargeScope.slice(6):zero, hashes[i]);
      if(phase==='cancel')completeCurrentNativeSwapScope(seed,chargeScope);
    });
    completeCurrentNativeSwapScope(seed, scope);
    const original = currentNativeSwapCheckpoint(seed);
    if (operationId === 52n) {
      expect(original.charges).toHaveLength(9);
      expect(original.charges.map(charge => charge.nonce)).toEqual([137,138,139,140,141,142,143,144,145]);
      expect(original.charges.slice(0, 6).map(charge => charge.hash)).toEqual(hashes.slice(0, 6));
      expect(original.charges.slice(6).map(({ phase, hash }) => ({ phase, hash }))).toEqual([
        { phase: 'quote', hash: CURRENT_APP_FOURTH_TRIAL.quoteHash },
        { phase: 'accept', hash: CURRENT_APP_FOURTH_TRIAL.failedAcceptHash },
        { phase: 'cancel', hash: CURRENT_APP_FOURTH_TRIAL.cancelHash }
      ]);
      expect(f.receipts.get(CURRENT_APP_FOURTH_TRIAL.failedAcceptHash)).toMatchObject({ status: 0, logs: [] });
    }
    restoreCurrentNativeSwapCheckpoint(f.signer, CURRENT_APP_SWAP_OWNER, candidate, original);
    writeCurrentDexNativeReload(window.sessionStorage, { budget: original, authentication: zero });
    f.clock.mockReturnValue(Number(trial.approvedAt + 1n) * 1000);
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-exit' } as never);
    await expect(capability.readCurrentCheapDelivery(issued)).resolves.toMatchObject({ releaseAction: 'cancel' });
    const rpc = f.readProvider.send.getMockImplementation()!, graph = m.graph.getMockImplementation()!;
    const now = BigInt(f.clock() / 1000);
    f.readProvider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_getTransactionCount') return `0x${(quoteNonce+(operationId===52n?3:2)).toString(16)}`;
      const value = await rpc(method, params);
      return method === 'eth_getBlockByNumber' && (params[0] === 'latest' || params[0] === '0x37') ? { ...value as Extract<typeof value, {timestamp:string}>, timestamp: `0x${now.toString(16)}` } : value;
    });
    m.graph.mockImplementation(async request => { const value = await graph(request); return { ...value, block: { ...value.block, timestamp: now } }; });
    const quotes = await issueCurrentDexQuoteCapability({} as never);
    const fresh = (await quotes.prepareCurrentQuote({ profile: 'cheap-async',
      graph: { candidate: 'cheap-exit', expectedGraph: candidate.graph, expectedPackageSha256: candidate.packageSha256, blockNumber: 55n, blockHash },
      terms: { ...f.prepared.intent, deadline: now + (operationId>=51n?900n:600n) }, confirmPrivateInputs: async () => true }))!;
    f.signer.getNonce.mockResolvedValue(quoteNonce+(operationId===52n?3:2));
    f.setFunding(100n, allowance);
    // Stop at wallet send: the regression concerns fresh exact funding admission, not another synthetic settlement.
    f.signer.sendUncheckedTransaction.mockImplementation(async () => { throw new Error('TEST_WALLET_BOUNDARY'); });
    await expect(capability.submitCurrentCheapQuote(fresh)).rejects.toThrow(allowance === 20n ? 'TEST_WALLET_BOUNDARY' : allowance === 0n ? 'allowance is insufficient' : 'allowance must equal');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(allowance === 20n ? 1 : 0);
    const after = readCurrentDexNativeReload(window.sessionStorage)!.budget;
    expect(after.charges.slice(0, original.charges.length)).toEqual(original.charges);
    expect(after.charges.filter(charge => charge.phase === 'token-faucet')).toHaveLength(1);
    expect(after.charges.filter(charge => charge.phase === 'token-funding')).toHaveLength(1);
    if (allowance === 20n) {
      expect(after.charges).toHaveLength(original.charges.length + 1);
      expect(after.charges[after.charges.length - 1]).toMatchObject({ phase: 'quote', nonce: quoteNonce + (operationId === 52n ? 3 : 2), hash: null });
      await expect(capability.submitCurrentCheapQuote(fresh)).rejects.toThrow('pending attempt');
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    } else expect(after.charges).toHaveLength(original.charges.length);
  });
  it.each(['none', 'allowance', 'pending', 'authentication'] as const)('renews the confirmed claim before exact approval: %s', async fault => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'exit', CURRENT_APP_SWAP_OWNER), candidate = STAGED_EXIT_PREVIEW_DEX_CANDIDATE;
    const data = new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet');
    const claim = { chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:CURRENT_APP_SWAP_AUTHORITY.inputToken,value:0n as const,
      data,nonce:4,gasLimit:5_000_000n,gasPrice:52_000_000n }, hash=`0x${'a2'.repeat(32)}`;
    await f.capability.authorizeCurrentCheapInitialClaim(claim);
    f.transactions.set(hash,{...claim,hash,blockNumber:50,blockHash});
    f.receipts.set(hash,{hash,status:1,from:claim.from,to:claim.to,blockNumber:50,blockHash,logs:[]});
    await f.capability.rememberCurrentCheapSwapApproval({request:claim,transactionHash:hash});
    const before=readCurrentDexNativeReload(window.sessionStorage)!.budget;
    f.clock.mockReturnValue(1_001_000);f.setFunding(100n,fault==='allowance'?1n:0n);
    const rpc=f.readProvider.send.getMockImplementation()!, graph=m.graph.getMockImplementation()!;
    f.readProvider.send.mockImplementation(async(method,params)=>{const value=await rpc(method,params);
      return method==='eth_getBlockByNumber'&&(params[0]==='latest'||params[0]==='0x37')?{...value as Extract<typeof value,{timestamp:string}>,timestamp:'0x3e9'}:value;});
    m.graph.mockImplementation(async request=>{const value=await graph(request);return {...value,block:{...value.block,timestamp:request.blockNumber===55n?1001n:100n}};});
    const quotes=await issueCurrentDexQuoteCapability({} as never);
    const fresh=(await quotes.prepareCurrentQuote({profile:'cheap-async',
      graph:{candidate:'cheap-exit',expectedGraph:candidate.graph,expectedPackageSha256:candidate.packageSha256,blockNumber:55n,blockHash},
      terms:{...f.prepared.intent,deadline:1200n},confirmPrivateInputs:async()=>true}))!;
    const approval=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']);
    const request={...claim,to:fresh.intent.inputToken,nonce:5,data:approval.encodeFunctionData('approve',[candidate.core,{ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature}])};
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner:claim.from.toLowerCase(),core:candidate.core.toLowerCase(),graph:`0x${candidate.graph}`,
      phase:'token-approve',callHash:keccak256(request.data),nonce:5,target:request.to.toLowerCase(),txHash:fault==='pending'?hash:null}));
    if(fault==='authentication'){const saved=readCurrentDexNativeReload(window.sessionStorage)!;f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,JSON.stringify({...saved,authentication:zero}));}
    const saved=f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    if(fault!=='none'){
      await expect(f.capability.authorizeCurrentCheapSwapApproval(fresh,request)).rejects.toThrow();
      expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(saved);
    } else {
      await f.capability.authorizeCurrentCheapSwapApproval(fresh,request);
      const after=readCurrentDexNativeReload(window.sessionStorage)!.budget;
      expect(after.start).toBe(before.start);expect(after.windowStart).toBe('1001');expect(after.charges[0]).toEqual(before.charges[0]);
      expect(after.charges).toHaveLength(2);expect(after.committedWei).toBe('520000000000000');
    }
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['none', 'fresh-renewal', 'authentication', 'missing-hash', 'spender', 'allowance', 'fee', 'expiry'] as const)(
    'continues a confirmed approval after reload only with safe funding: %s', async fault => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'exit'), candidate = STAGED_EXIT_PREVIEW_DEX_CANDIDATE;
    const approval = new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']);
    const data = approval.encodeFunctionData('approve', [candidate.core, { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature }]);
    const hash = `0x${'a1'.repeat(32)}`, request = { chainId: 7082400n, from: owner, to: candidate.tokens[0][0], value: 0n as const,
      data, nonce: 4, gasLimit: 5_000_000n, gasPrice: 52_000_000n };
    await f.capability.authorizeCurrentCheapSwapApproval(f.prepared, request);
    f.transactions.set(hash, { ...request, hash, blockNumber: 50, blockHash });
    f.receipts.set(hash, { hash, status: 1, from: owner, to: request.to, blockNumber: 50, blockHash, logs: [] });
    await f.capability.rememberCurrentCheapSwapApproval({ request, transactionHash: hash });
    const before = readCurrentDexNativeReload(window.sessionStorage)!.budget;
    f.setFunding(100n, fault === 'allowance' ? 21n : 20n);
    if (fault === 'authentication') {
      const record = readCurrentDexNativeReload(window.sessionStorage)!;
      f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY, JSON.stringify({ ...record, authentication: zero }));
    }
    if (fault === 'missing-hash') {
      const record = readCurrentDexNativeReload(window.sessionStorage)!;
      f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY, JSON.stringify({ ...record,
        budget: { ...record.budget, charges: [{ ...record.budget.charges[0], hash: null }] } }));
    }
    if (fault === 'spender') f.transactions.get(hash)!.data = approval.encodeFunctionData('approve', [owner,
      { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature }]);
    if (fault === 'fee') f.transactions.get(hash)!.gasPrice = 53_000_000n;
    const signer = { ...f.signer }, rpc = f.readProvider.send.getMockImplementation()!;
    signer.getNonce.mockResolvedValue(5);
    if (fault === 'fresh-renewal') f.clock.mockReturnValue(1_001_000);
    f.readProvider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_getTransactionCount') return '0x5';
      const value = await rpc(method, params);
      return fault === 'fresh-renewal' && method === 'eth_getBlockByNumber' && (params[0] === 'latest' || params[0] === '0x37')
        ? { ...value as Extract<typeof value,{timestamp:string}>, timestamp: '0x3e9' } : value;
    });
    if (fault === 'fresh-renewal') {
      const graph = m.graph.getMockImplementation()!;
      m.graph.mockImplementation(async request => { const value = await graph(request);
        return { ...value, block: { ...value.block, timestamp: request.blockNumber === 55n ? 1001n : 100n } }; });
    }
    m.owner.mockImplementation(async args => args.bindCapability({ assertCurrent: async () => {}, assertSnapshotCurrent: () => {},
      signer, readProvider: f.readProvider, ownerAddress: owner, chainId: 7082400n }));
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-exit' } as never);
    const quoteCapability = await issueCurrentDexQuoteCapability({} as never);
    const fresh = (await quoteCapability.prepareCurrentQuote({ profile: 'cheap-async',
      graph: { candidate: 'cheap-exit', expectedGraph: candidate.graph, expectedPackageSha256: candidate.packageSha256, blockNumber: 55n, blockHash },
      terms: { inputToken: candidate.tokens[0][0], outputToken: candidate.tokens[1][0], destination: owner, deadline: fault === 'fresh-renewal' ? 1200n : 201n,
        maximumInput: 20n, minimumInput: 5n, minimumOutput: 1n, rateNumerator: 1n, rateDenominator: 1n, toleranceBps: 50 },
      confirmPrivateInputs: async () => true }))!;
    if (fault === 'expiry') f.clock.mockReturnValue(1_001_000);
    if (fault !== 'none' && fault !== 'fresh-renewal') {
      const saved = f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
      await expect(capability.submitCurrentCheapQuote(fresh)).rejects.toThrow();
      expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(saved);
      expect(signer.sendUncheckedTransaction).not.toHaveBeenCalled();
      return;
    }
    await expect(capability.submitCurrentCheapQuote(fresh)).resolves.toMatchObject({ profile: 'cheap-async' });
    const after = readCurrentDexNativeReload(window.sessionStorage)!.budget;
    expect(after.start).toBe(before.start);
    expect(after.windowStart).toBe(fault === 'fresh-renewal' ? '1001' : undefined);
    expect(after.charges[0]).toEqual(before.charges[0]);
    expect(after.activeSwap).toBe(`quote:${keccak256(fresh.data)}`);
    expect(after.committedWei).toBe('5980000000000000');
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  const acceptExit = async (profile: CurrentCheapDexProfile) => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture(profile, 'exit', owner, 7n, 400n), issued = await f.quote();
    if (profile === 'cheap-async') f.setState(5);
    const ready = await issued.readCurrent();
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true }))!;
    return { ...f, ready, sent };
  };
  it.each(['fast-pool','cheap-async'] as const)('checks actual %s token envelopes before clearing pending Accept', async profile => {
    const f = await acceptExit(profile);
    await expect(f.sent.recover()).resolves.toMatchObject({ status: profile === 'fast-pool' ? 'settled' : 'settlement-pending' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    expect(readCurrentDexNativeReload(window.sessionStorage)!.budget).toEqual(currentNativeSwapCheckpoint(f.signer));
    expect(currentNativeSwapCheckpoint(f.signer).activeSwap === null).toBe(profile === 'fast-pool');
  });
  it.each(['debit','missing','metadata','call','session'] as const)('keeps %s failure pending through reload', async fault => {
    const f = await acceptExit('fast-pool');
    const receipt = f.receipts.get(f.sent.transactionHash)!;
    const logs = receipt.logs as {address:string;topics:string[];data:string;index:number;blockHash:string}[];
    if (fault === 'debit') logs[0].data = currentDexOwnerTransferAbi.encodeEventLog(currentDexOwnerTransferAbi.getEvent('Transfer')!,
      [owner,STAGED_EXIT_PREVIEW_DEX_CANDIDATE.core,[19n,1n],[902n,1n]]).data;
    if (fault === 'missing') logs.splice(2,1);
    if (fault === 'metadata') logs[0].blockHash = context;
    if (fault === 'call') f.transactions.get(f.sent.transactionHash)!.data = f.prepared.data;
    if (fault === 'session') m.decrypt.mockImplementation(() => { f.revoke(); return 20n; });
    await expect(f.sent.recover()).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    if (fault !== 'call') expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({verificationBlocked:true});
    if (fault !== 'session' && fault !== 'call') {
      const reload = await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-exit'} as never);
      await expect(reload.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({status:'manual-reconciliation-required',privateAccountingVerified:false});
    }
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it('keeps canonical public-only Accept pending even without a recorded private failure', async () => {
    const f = await acceptExit('cheap-async');
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({status:'manual-reconciliation-required',privateAccountingVerified:false});
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    await expect(f.sent.recover()).resolves.toMatchObject({status:'settlement-pending'});
  });
  it('retains an incorrect asynchronous maximum debit as a private failure', async () => {
    const f = await acceptExit('cheap-async');
    const receipt = f.receipts.get(f.sent.transactionHash)!;
    const logs = receipt.logs as {data:string}[];
    logs[1].data = currentDexOwnerTransferAbi.encodeEventLog(currentDexOwnerTransferAbi.getEvent('Transfer')!,
      [owner,STAGED_EXIT_PREVIEW_DEX_CANDIDATE.core,[19n,1n],[902n,1n]]).data;
    await expect(f.sent.recover()).rejects.toThrow('TOKEN_AMOUNT');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({verificationBlocked:true});
    expect(readCurrentDexOperationLookups(window.sessionStorage)).toHaveLength(0);
  });
  it.each(['fill','no-fill','recover'] as const)('binds asynchronous %s to the canonical execution transaction', async outcome => {
    const f = await acceptExit('cheap-async'); await f.sent.recover();
    if (outcome !== 'fill') Object.assign(f.amounts,{filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
    f.terminal(outcome === 'recover');
    await expect(f.capability.readCurrentCheapDelivery(f.ready)).resolves.toMatchObject({kind:'terminal',amounts:{...f.amounts},releaseAction:outcome === 'recover' ? 'recover' : null});
    expect([...f.values.keys()]).toEqual([CURRENT_DEX_NATIVE_RELOAD_KEY]);
    expect(readCurrentDexNativeReload(window.sessionStorage)!.budget.charges).toHaveLength(2);
    const saved = readCurrentDexNativeReload(window.sessionStorage)!.budget;
    expect(saved).toEqual(currentNativeSwapCheckpoint(f.signer));
    expect(saved.activeSwap).toBeNull();
    expect(() => restoreCurrentNativeSwapCheckpoint(f.signer, owner, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, saved)).not.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    expect(f.readProvider.getLogs).toHaveBeenCalledTimes(1);
  });
  it.each(['payout','zero-leg','duplicate-terminal','long-gap','terminal-call','terminal-context'] as const)('keeps %s terminal failure locked without a resend', async fault => {
    const f = await acceptExit('cheap-async'); await f.sent.recover();
    Object.assign(f.amounts,{filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
    const hash = f.terminal(), receipt = f.receipts.get(hash)!;
    const logs = receipt.logs as {address:string;topics:string[];data:string;index:number}[];
    if (fault === 'zero-leg') logs.splice(1,1);
    if (fault === 'payout') logs[2].data = currentDexOwnerTransferAbi.encodeEventLog(currentDexOwnerTransferAbi.getEvent('Transfer')!,
      [STAGED_EXIT_PREVIEW_DEX_CANDIDATE.core,owner,[901n,1n],[19n,1n]]).data;
    if (fault === 'duplicate-terminal') f.readProvider.getLogs.mockImplementation(async () => [logs[0],logs[0]] as never);
    if (fault === 'long-gap') { f.setLatest(5000); Object.assign(logs[0],{blockNumber:5000}); }
    if (fault === 'terminal-call') f.transactions.get(hash)!.data = new Interface(['function advanceFixedWork(uint256)']).encodeFunctionData('advanceFixedWork',[8n]);
    if (fault === 'terminal-context') logs[0].data = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI).encodeEventLog(new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI).getEvent('CheapAsyncAdvanced')!,[7n,7,blockHash]).data;
    await expect(f.capability.readCurrentCheapDelivery(f.ready)).rejects.toThrow();
    expect(readCurrentDexOperationLookups(window.sessionStorage)[0]).toMatchObject({attempt:{verificationBlocked:true}});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['cancel','recover'] as const)('verifies exact %s token work before clearing owner recovery', async action => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async','exit'), issued = await f.quote();
    if (action === 'recover') f.setState(6);
    const sent = (await f.capability.submitCurrentCheapOwnerAction({issued,action,confirm:async()=>true}))!;
    Object.assign(f.amounts,{filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
    await expect(sent.recover()).resolves.toMatchObject({status:'released'});
    if (action === 'cancel') await expect(f.capability.readCurrentCheapDelivery(issued)).resolves.toMatchObject({releaseAction:'cancel'});
    expect([...f.values.keys()]).toEqual([CURRENT_DEX_NATIVE_RELOAD_KEY]);
    expect(readCurrentDexNativeReload(window.sessionStorage)!.budget.charges).toHaveLength(2);
  });
});

describe('current-mode integrated Quote/Accept sender', () => {
  it('stops at the public lookup bound before another async wallet request and retains every original operation', async () => {
    const f = await fixture('cheap-async', true);
    for (let i = 1; i <= 32; i++) recordCurrentDexOperationLookup(window.sessionStorage, {
      attempt: { version: 1, chainId: '7082400', owner, core: STAGED_NATIVE_DEX_CANDIDATE.core,
        graph: `0x${STAGED_NATIVE_DEX_CANDIDATE.graph}`, phase: 'accept', nonce: i, callHash: context,
        txHash: `0x${i.toString(16).padStart(64, '0')}` }, operationId: i.toString(), contextHash: context,
      deadline: '200', origin: { number: 50, hash: blockHash }
    });
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('limit reached');
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled(); expect(f.signer.estimateGas).not.toHaveBeenCalled();
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it('retains a confirmed async operation after reload and reads public settlement without restoring private authority', async () => {
    const f = await fixture('cheap-async', true), issued = await f.quote(); f.setState(5);
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: await issued.readCurrent(), confirm: async () => true }))!;
    await accepted.recover();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)!;
    expect(saved).not.toMatch(/ciphertext|signature|maximumInput|minimumOutput|aesKey|data"/);
    const reloadSigner = { ...f.signer };
    m.owner.mockImplementation(async args => args.bindCapability({ assertCurrent: async () => {}, assertSnapshotCurrent: () => {},
      signer: reloadSigner, readProvider: f.readProvider, chainId: 7082400n, ownerAddress: owner }));
    const reload = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    const sends = f.signer.sendUncheckedTransaction.mock.calls.length, estimates = f.signer.estimateGas.mock.calls.length,
      privateReads = f.readReceipt.mock.calls.length;
    for (const [stage, phase] of [[6, 'settling'], [7, 'settled']] as const) {
      f.setState(stage);
      await expect(reload.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', operationId: 7n,
        operation: { phase }, privateAccountingVerified: false, readyToSign: false, transactionHash: accepted.transactionHash });
    }
    await expect(reload.readCurrentCheapDelivery(issued)).rejects.toThrow('session');
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends); expect(f.signer.estimateGas).toHaveBeenCalledTimes(estimates);
    expect(f.readReceipt).toHaveBeenCalledTimes(privateReads);
  });
  it('keeps authenticated owner recovery available after a confirmed async Accept', async () => {
    const f = await fixture('cheap-async', true), issued = await f.quote(); f.setState(5);
    const ready = await issued.readCurrent();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true }))!;
    await accepted.recover();
    expect(readCurrentDexOperationLookups(window.sessionStorage)).toHaveLength(1);
    f.amounts.filled = false; Object.assign(f.amounts, { actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    const recovery = (await f.capability.submitCurrentCheapOwnerAction({ issued: ready, action: 'recover', confirm: async () => true }))!;
    await expect(recovery.recover()).resolves.toMatchObject({ status: 'released' });
    expect(f.values.size).toBe(0); expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(3);
  });
  it('retains async private verification failure after confirmed Accept and clears only after authenticated repair', async () => {
    const f = await fixture('cheap-async', true), issued = await f.quote(); f.setState(5);
    const ready = await issued.readCurrent();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true }))!;
    await accepted.recover(); f.setState(7); f.amounts.refund = 4n;
    await expect(f.capability.readCurrentCheapDelivery(ready)).rejects.toThrow('protected intent');
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required', verificationBlocked: true });
    expect(readCurrentDexOperationLookups(window.sessionStorage)[0].attempt.verificationBlocked).toBe(true);
    f.amounts.refund = 5n;
    await expect(f.capability.readCurrentCheapDelivery(ready)).resolves.toMatchObject({ kind: 'terminal' });
    expect(f.values.size).toBe(0); expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['malformed', 'accounting', 'unavailable'] as const)('keeps a private %s failure blocked across capability reload', async fault => {
    const f = await fixture('fast-pool'), issued = await f.quote();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    const original = f.readReceipt.getMockImplementation()!;
    if (fault === 'accounting') f.amounts.refund = 4n;
    else f.readReceipt.mockRejectedValueOnce(new Error(fault === 'malformed' ? 'Malformed private receipt' : 'Private read unavailable'));
    await expect(accepted.recover()).rejects.toThrow('Private verification failed');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ verificationBlocked: true, txHash: accepted.transactionHash });
    const renewed = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-archived' } as never);
    await expect(renewed.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required', verificationBlocked: true });
    await expect(renewed.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    f.amounts.refund = 5n; f.readReceipt.mockImplementation(original);
    await expect(accepted.recover()).resolves.toMatchObject({ status: 'settled' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it('waits for delayed RPC visibility without sending a second Quote', async () => {
    const f = await fixture('fast-pool');
    f.readProvider.getTransaction.mockResolvedValueOnce(null);
    const sent = await f.capability.submitCurrentCheapQuote(f.prepared);
    await expect(sent.recover()).resolves.toMatchObject({ operationId: 7n });
    expect(f.readProvider.waitForTransaction).toHaveBeenCalledWith(sent.transactionHash, 1, 60000);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each(['timeout', 'missing', 'session'] as const)('retains the hash if canonical RPC verification fails: %s', async fault => {
    const f = await fixture('fast-pool');
    f.readProvider.getTransaction.mockResolvedValueOnce(null);
    if (fault === 'timeout') f.readProvider.waitForTransaction.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    if (fault === 'missing' || fault === 'timeout') f.readProvider.getTransaction.mockResolvedValueOnce(null);
    if (fault === 'session') f.readProvider.waitForTransaction.mockImplementationOnce(async () => { f.revoke(); return null; });
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow(fault === 'session' ? 'Session revoked' : 'not yet verified');
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('retains the returned hash when direct RPC lookup fails and refuses a second submit', async () => {
    const f = await fixture('fast-pool');
    f.readProvider.getTransaction.mockRejectedValueOnce(new Error('RPC lookup unavailable'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('RPC lookup unavailable');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ txHash: `0x${'77'.repeat(32)}` });
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('accepts a hash only after canonical RPC supplies exact Quote and Accept metadata', async () => {
    const f = await fixture('fast-pool');
    const issued = await f.quote();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    await expect(accepted.recover()).resolves.toMatchObject({ status: 'settled' });
    expect(f.values.size).toBe(0);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    expect(f.readProvider.getTransaction).toHaveBeenCalled();
  });
  it.each(['missing', 'chainId', 'hash', 'from', 'to', 'value', 'data', 'nonce', 'gasLimit', 'session'] as const)(
    'retains the hash when canonical RPC metadata is missing or conflicts: %s', async field => {
      const f = await fixture('fast-pool');
      const read = f.readProvider.getTransaction.getMockImplementation()!;
      f.readProvider.getTransaction.mockImplementationOnce(async hash => {
        const tx = await read(hash);
        if (field === 'missing') { f.readProvider.getTransaction.mockResolvedValueOnce(null); return null; }
        if (field === 'session') { f.revoke(); return tx; }
        return { ...tx, [field]: field === 'chainId' || field === 'value' || field === 'gasLimit' ? 1n
          : field === 'nonce' ? 99 : field === 'data' ? '0x1234' : field === 'hash' ? context : c.tokens[0][0] };
      });
      await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow(
        field === 'session' ? 'Session revoked' : field === 'missing' ? 'not yet verified' : `Mismatch: ${field}`);
      expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
  it.each(['fast-pool', 'cheap-async'] as const)('reconciles a lost %s hash only after exact canonical proof', async profile => {
    const f = await fixture(profile), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
    const saved = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...saved, txHash: null }));
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' });
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!).txHash).toBeNull();
    if (profile === 'fast-pool') f.clock.mockReturnValue(201000);
    await expect(f.capability.recoverPendingCurrentCheapAttempt(sent.transactionHash)).resolves.toMatchObject({
      status: 'observed-mined', operationId: 7n, readyToSign: false,
      ...(profile === 'fast-pool' ? { operation: { phase: 'expired-unrecovered' } } : {})
    });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each([
    ['fast-pool', ''], ['fast-pool', ' \t '],
    ['cheap-async', ''], ['cheap-async', ' \t ']
  ] as const)('uses the saved %s hash when the optional recovery field is blank: %j', async (profile, input) => {
    const f = await fixture(profile), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
    await expect(f.capability.recoverPendingCurrentCheapAttempt(input)).resolves.toMatchObject({
      status: 'observed-mined', transactionHash: sent.transactionHash, operationId: 7n, readyToSign: false
    });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    expect(f.readReceipt).not.toHaveBeenCalled();
  });
  it.each([
    ['fast-pool', ''], ['fast-pool', ' \t '],
    ['cheap-async', ''], ['cheap-async', ' \t ']
  ] as const)('keeps a lost %s hash blocked when the optional recovery field is blank: %j', async (profile, input) => {
    const f = await fixture(profile);
    await f.capability.submitCurrentCheapQuote(f.prepared);
    const saved = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    const lost = JSON.stringify({ ...saved, txHash: null });
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, lost);
    await expect(f.capability.recoverPendingCurrentCheapAttempt(input)).resolves.toMatchObject({
      status: 'manual-reconciliation-required', readyToSign: false
    });
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(lost);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    expect(f.readReceipt).not.toHaveBeenCalled();
  });
  it.each(['missing', 'nonce', 'call', 'reorg', 'event', 'gas', 'owner', 'saved-hash', 'invalid-hash'] as const)(
    'keeps a lost Quote hash blocked on %s', async fault => {
      const f = await fixture('fast-pool'), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
      const saved = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
      f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...saved, txHash: fault === 'saved-hash' ? sent.transactionHash : null }));
      const tx = f.transactions.get(sent.transactionHash)!, receipt = f.receipts.get(sent.transactionHash)!;
      if (fault === 'missing') f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
      if (fault === 'nonce') tx.nonce = 99;
      if (fault === 'call') tx.data = accept.encodeFunctionData('acceptFastPoolV1', [7n, context]);
      if (fault === 'reorg') receipt.blockHash = context;
      if (fault === 'event') receipt.logs = [];
      if (fault === 'gas') tx.gasLimit = 1n;
      if (fault === 'owner') tx.from = c.core;
      const hash = fault === 'invalid-hash' ? 'invalid' : fault === 'saved-hash' ? `0x${'ab'.repeat(32)}` : sent.transactionHash;
      const check = f.capability.recoverPendingCurrentCheapAttempt(hash);
      if (fault === 'missing' || fault === 'saved-hash') await expect(check).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' });
      else await expect(check).rejects.toThrow();
      expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(JSON.stringify({ ...saved, txHash: fault === 'saved-hash' ? sent.transactionHash : null }));
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
  it.each([
    ['fast-pool', 'quote'], ['cheap-async', 'quote'],
    ['fast-pool', 'accept'], ['cheap-async', 'accept'],
    ['cheap-async', 'cancel'], ['cheap-async', 'recover']
  ] as const)('reconciles an exact repriced %s %s without sending or restoring private authority', async (profile, phase) => {
    const f = await fixture(profile);
    let sent;
    if (phase === 'quote') sent = await f.capability.submitCurrentCheapQuote(f.prepared);
    else {
      const issued = await f.quote();
      if (phase === 'accept') {
        f.setState(4);
        sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
      } else {
        if (phase === 'recover') f.setState(5);
        sent = (await f.capability.submitCurrentCheapOwnerAction({ issued, action: phase, confirm: async () => true }))!;
      }
    }
    const replacementHash = `0x${'ab'.repeat(32)}`;
    f.transactions.set(replacementHash, { ...f.transactions.get(sent.transactionHash)!, hash: replacementHash });
    f.receipts.set(replacementHash, { ...f.receipts.get(sent.transactionHash)!, hash: replacementHash });
    f.receipts.delete(sent.transactionHash);
    const sends = f.signer.sendUncheckedTransaction.mock.calls.length, privateReads = f.readReceipt.mock.calls.length;
    await expect(f.capability.recoverPendingCurrentCheapAttempt(replacementHash)).resolves.toMatchObject({
      status: 'observed-mined', phase, transactionHash: replacementHash, readyToSign: false
    });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends);
    expect(f.readReceipt).toHaveBeenCalledTimes(privateReads);
  });
  it.each(['missing', 'nonce', 'call', 'reorg', 'event', 'gas', 'owner', 'chain', 'to', 'value', 'lease', 'private-block', 'private-block-revert'] as const)(
    'retains the original journal when replacement proof fails: %s', async fault => {
      const f = await fixture('fast-pool'), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
      const replacementHash = `0x${'ab'.repeat(32)}`;
      const tx: Record<string, unknown> = { ...f.transactions.get(sent.transactionHash)!, hash: replacementHash };
      const receipt: Record<string, unknown> = { ...f.receipts.get(sent.transactionHash)!, hash: replacementHash };
      f.transactions.set(replacementHash, tx); f.receipts.set(replacementHash, receipt);
      if (fault === 'missing') f.receipts.delete(replacementHash);
      if (fault === 'nonce') tx.nonce = 99;
      if (fault === 'call') tx.data = accept.encodeFunctionData('acceptFastPoolV1', [7n, context]);
      if (fault === 'reorg') receipt.blockHash = context;
      if (fault === 'event') receipt.logs = [];
      if (fault === 'gas') tx.gasLimit = 1n;
      if (fault === 'owner') tx.from = c.core;
      if (fault === 'chain') tx.chainId = 1n;
      if (fault === 'to') tx.to = owner;
      if (fault === 'value') tx.value = 1n;
      if (fault === 'lease') f.revoke();
      if (fault === 'private-block' || fault === 'private-block-revert') {
        const saved = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
        f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...saved, verificationBlocked: true }));
        if (fault === 'private-block-revert') receipt.status = 0;
      }
      const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
      const check = f.capability.recoverPendingCurrentCheapAttempt(replacementHash);
      if (fault === 'missing') await expect(check).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' });
      else if (fault === 'private-block' || fault === 'private-block-revert') await expect(check).resolves.toMatchObject({ status: 'manual-reconciliation-required', verificationBlocked: true });
      else await expect(check).rejects.toThrow();
      expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
  it.each(['fast-pool', 'cheap-async'] as const)('captures exact %s session timing without private inputs or mining inference', async profile => {
    const f = await fixture(profile); let ms = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => ms);
    const send = f.signer.sendUncheckedTransaction.getMockImplementation()!, sends: Array<{ start: number; end: number }> = [];
    f.signer.sendUncheckedTransaction.mockImplementation(async request => {
      const start = ms, result = await send(request); ms += 5; sends.push({ start, end: ms }); return result;
    });
    const issue = m.issue.getMockImplementation()!;
    m.issue.mockImplementation(async args => { ms += 7; return issue(args); });
    const readTx = f.readProvider.getTransaction.getMockImplementation()!;
    f.readProvider.getTransaction.mockImplementation(async hash => { ms += 2; return readTx(hash); });
    const receipt = f.readProvider.getTransactionReceipt.getMockImplementation()!, observed: Array<{ start: number; end: number }> = [];
    f.readProvider.getTransactionReceipt.mockImplementation(async hash => {
      const start = ms, result = await receipt(hash); ms += 3; observed.push({ start, end: ms }); return result;
    });
    const privateRead = f.readReceipt.getMockImplementation()!;
    f.readReceipt.mockImplementation(async () => { ms += 4; return privateRead(); });
    expect(f.capability.readCurrentCheapTiming(`0x${'aa'.repeat(32)}`)).toBeNull();
    const sent = await f.capability.submitCurrentCheapQuote(f.prepared), initial = f.capability.readCurrentCheapTiming(sent.transactionHash)!;
    expect(initial).toMatchObject({ transactionHash: sent.transactionHash, profile, phase: 'quote', sendStartedAtMs: 100,
      hashReturnedAtMs: 105, submissionReturnedAtMs: 107, walletSendMs: 7, walletRequestToHashMs: 5, hashToRpcVisibilityMs: 2, checks: [] });
    ms += 200; const quoteCheckStart = ms, issued = await sent.recover();
    const quoteTiming = f.capability.readCurrentCheapTiming(sent.transactionHash)!;
    // readIssue independently reads tx+receipt before its issued-state checks.
    // Only the later boundary receipt call is the isolated observation interval.
    expect(observed).toHaveLength(2);
    expect(quoteTiming.checks).toEqual([{ startedAtMs: quoteCheckStart, receiptStartedAtMs: observed[1].start,
      receiptFinishedAtMs: observed[1].end, receiptObservation: 'received', finishedAtMs: ms, successfulVerifiedAtMs: ms,
      verificationScope: 'quote-issue', submittedToCheckMs: 200, receiptObservationMs: 3,
      preReceiptVerificationMs: 14, postReceiptVerificationMs: 0, verificationRemainderMs: 14 }]);
    expect(initial.checks).toHaveLength(0); expect(Object.isFrozen(quoteTiming.checks[0])).toBe(true);
    expect(issued).not.toHaveProperty('timing'); expect(Object.keys(quoteTiming).sort()).toEqual([
      'transactionHash', 'profile', 'phase', 'sendStartedAtMs', 'hashReturnedAtMs', 'submissionReturnedAtMs', 'walletSendMs',
      'walletRequestToHashMs', 'hashToRpcVisibilityMs', 'checks'].sort());
    if (profile === 'cheap-async') f.setState(4);
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    expect(f.capability.readCurrentCheapTiming(accepted.transactionHash)).toMatchObject({ profile, phase: 'accept', walletSendMs: 7,
      walletRequestToHashMs: 5, hashToRpcVisibilityMs: 2, checks: [] });
    ms += 300; const acceptCheckStart = ms, result = await accepted.recover();
    expect(result.status).toBe(profile === 'fast-pool' ? 'settled' : 'settlement-pending');
    const timing = f.capability.readCurrentCheapTiming(accepted.transactionHash)!;
    expect(timing).toMatchObject({ sendStartedAtMs: sends[1].start, hashReturnedAtMs: sends[1].end,
      submissionReturnedAtMs: sends[1].end + 2 });
    expect(observed).toHaveLength(3);
    expect(timing.checks).toEqual([{ startedAtMs: acceptCheckStart, receiptStartedAtMs: observed[2].start,
      receiptFinishedAtMs: observed[2].end, receiptObservation: 'received', finishedAtMs: ms, successfulVerifiedAtMs: ms,
      verificationScope: profile === 'fast-pool' ? 'fast-private-delivery' : 'async-funded-accept', submittedToCheckMs: 300,
      receiptObservationMs: 3, preReceiptVerificationMs: 2, postReceiptVerificationMs: profile === 'fast-pool' ? 4 : 0,
      verificationRemainderMs: profile === 'fast-pool' ? 6 : 2 }]);
    expect(JSON.stringify(timing)).not.toContain(signature); expect(JSON.stringify(timing)).not.toContain(accepted.request.data);
    expect(JSON.stringify(timing)).not.toMatch(/ciphertext|maximumInput|actualInput|netOutput|nonce|owner/);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(profile === 'cheap-async');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['pending', 'receipt', 'private', 'reorg', 'rpc'] as const)('retains %s observations without verified completion or clearing pending', async fault => {
    const f = await fixture('fast-pool'); vi.spyOn(performance, 'now').mockReturnValue(10);
    const issued = await f.quote(), accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    if (fault === 'pending') f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
    if (fault === 'rpc') f.readProvider.getTransactionReceipt.mockRejectedValueOnce(new Error('Read unavailable'));
    if (fault === 'receipt') f.receipts.get(accepted.transactionHash)!.status = 0;
    if (fault === 'private') f.amounts.netOutput = 0n;
    if (fault === 'reorg') f.receipts.get(accepted.transactionHash)!.blockHash = context;
    await expect(accepted.recover()).rejects.toThrow();
    expect(f.capability.readCurrentCheapTiming(accepted.transactionHash)!.checks[0]).toMatchObject({
      receiptObservation: fault === 'pending' ? 'missing' : fault === 'rpc' ? 'error' : 'received',
      finishedAtMs: 10, successfulVerifiedAtMs: null, verificationScope: null, postReceiptVerificationMs: null, verificationRemainderMs: null });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true); expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it('keeps each explicit check separate and read-only after a missing receipt', async () => {
    const f = await fixture('fast-pool'); let ms = 10; vi.spyOn(performance, 'now').mockImplementation(() => ms);
    const issued = await f.quote(), accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null); ms = 20;
    await expect(accepted.recover()).rejects.toThrow(); const failed = f.capability.readCurrentCheapTiming(accepted.transactionHash)!;
    ms = 30; await accepted.recover();
    const completed = f.capability.readCurrentCheapTiming(accepted.transactionHash)!;
    expect(completed.checks.map(check => [check.submittedToCheckMs, check.successfulVerifiedAtMs, check.receiptObservation])).toEqual([
      [10, null, 'missing'], [20, 30, 'received']]);
    expect(failed.checks).toHaveLength(1); expect(Object.isFrozen(completed)).toBe(true); expect(Object.isFrozen(completed.checks)).toBe(true);
    const reads = f.readProvider.getTransactionReceipt.mock.calls.length;
    expect(f.capability.readCurrentCheapTiming(accepted.transactionHash)).toEqual(completed);
    expect(f.readProvider.getTransactionReceipt).toHaveBeenCalledTimes(reads); expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not make a missing diagnostic clock a sender or recovery prerequisite', async () => {
    const f = await fixture('fast-pool'); vi.spyOn(performance, 'now').mockReturnValue(Number.NaN);
    const sent = await f.capability.submitCurrentCheapQuote(f.prepared); await sent.recover();
    expect(f.capability.readCurrentCheapTiming(sent.transactionHash)).toMatchObject({ sendStartedAtMs: null, submissionReturnedAtMs: null,
      walletSendMs: null, checks: [{ startedAtMs: null, receiptStartedAtMs: null, receiptFinishedAtMs: null,
        successfulVerifiedAtMs: null, submittedToCheckMs: null, receiptObservationMs: null, verificationRemainderMs: null }] });
    expect(f.values.size).toBe(0);
  });
  it('checks the current candidate without encryption, nonce reservation or signing', async () => {
    const f = await fixture('fast-pool');
    m.wide.mockClear();
    await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({
      chainId: 7082400n, owner, core: getAddress(c.core), graph: c.graph, readyToSign: false,
      block: { number: 55n, hash: blockHash }
    });
    expect(m.graph).toHaveBeenLastCalledWith(expect.objectContaining({ candidate: 'cheap-archived', blockHash }));
    expect(m.wide).not.toHaveBeenCalled();
    expect(f.signer.getNonce).not.toHaveBeenCalled();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
  });
  it.each(['graph', 'lease', 'headroom'] as const)('rejects candidate readiness drift: %s', async fault => {
    const f = await fixture('fast-pool');
    if (fault === 'graph') m.graph.mockResolvedValueOnce({ graph: 'wrong' });
    if (fault === 'lease') f.revoke();
    if (fault === 'headroom') f.setHeadGas(60_000_000n);
    await expect(f.capability.checkCurrentCheapCandidate()).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
  });
  it('pins actual phase caps to the frozen candidate manifest and successful native receipts', () => {
    const directory = '../../../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/current-mode-coexistence/';
    const manifestRaw = readFileSync(new URL(directory + 'native-coexistence-manifest-1.json', import.meta.url));
    const journalRaw = readFileSync(new URL(directory + 'native-coexistence-1.jsonl', import.meta.url));
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(sha(manifestRaw)).toBe('9513dcca57f05e1a2b0b91f65e238dffb84ce1147f9dd0ed4e40ff525e04a38f');
    expect(sha(journalRaw)).toBe('7d4971ae104826b8be7fa152015f9382d30c369da7d6ef7ae4e0c071c50d55db');
    const manifest = JSON.parse(manifestRaw.toString());
    expect(manifest.graph).toBe(c.graph); expect(manifest.package).toBe(c.packageSha256);
    expect(manifest.core.toLowerCase()).toBe(c.core);
    const rows = journalRaw.toString().trim().split(/\r?\n/).map(line => JSON.parse(line));
    for (const [profile, phase, action, cost] of [
      ['fast-pool', 'quote', 'b-quote', 37_064_713n], ['fast-pool', 'accept', 'b-accept', 24_305_341n],
      ['cheap-async', 'quote', 'a-issue', 33_857_298n], ['cheap-async', 'accept', 'a-accept', 11_560_250n]
    ] as const) {
      const cap = CURRENT_CHEAP_DEX_GAS_CAPS[profile][phase];
      expect(cap).toBe(BigInt(manifest.gasLimits[action]));
      const signed = rows.filter(row => row.kind === 'signed' && row.action === action);
      const mined = rows.filter(row => row.kind === 'receipt' && row.action === action);
      expect(signed).toHaveLength(1); expect(mined).toHaveLength(1);
      expect(mined[0].hash).toBe(signed[0].hash); expect(mined[0].status).toBe(1);
      expect(BigInt(mined[0].gasUsed)).toBe(cost); expect(cost).toBeLessThan(cap);
    }
    expect(CURRENT_CHEAP_DEX_GAS_CAPS['cheap-async'].cancel).toBe(BigInt(manifest.gasLimits['a-cancel']));
    expect(CURRENT_CHEAP_DEX_GAS_CAPS['cheap-async'].recover).toBe(BigInt(manifest.gasLimits['a-recover']));
  });
  it.each(['fast-pool', 'cheap-async'] as const)('uses genuine %s preparation, exact native ABI/cap, and private review', async profile => {
    const f = await fixture(profile);
    await expect(f.capability.submitCurrentCheapQuote({ ...f.prepared })).rejects.toThrow('session');
    const issued = await f.quote();
    expect(f.signer.sendUncheckedTransaction.mock.calls[0][0]).toMatchObject({ gasLimit: profile === 'fast-pool' ? 60_000_000n : 50_000_000n, nonce: 4 });
    if (profile === 'cheap-async') {
      await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true })).rejects.toThrow('not READY');
      f.setState(4);
    }
    const ready = await issued.readCurrent(); // Refreshed opaque object is valid with its recovered origin.
    const accepted = await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true });
    expect(accepted?.request.data).toBe(accept.encodeFunctionData(profile === 'fast-pool' ? 'acceptFastPoolV1' : 'acceptPrivateSwapV1', [7n, context]));
    expect(accepted?.request.gasLimit).toBe(profile === 'fast-pool' ? 50_000_000n : 25_000_000n);
    expect(accepted?.status).toBe('accepting');
    await expect(accepted?.recover()).resolves.toMatchObject({ status: profile === 'fast-pool' ? 'settled' : 'settlement-pending' });
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeUndefined();
    expect(f.signer.estimateGas).not.toHaveBeenCalled();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    expect(m.decrypt.mock.calls.map(([, cipher]) => cipher.ciphertextHigh)).not.toContain(999999n);
    expect(m.decrypt.mock.calls.map(([, cipher]) => cipher.ciphertextHigh)).not.toContain(888888n);
    expect(f.capability.readyToSign).toBe(false); expect(f.capability).not.toHaveProperty('signer');
  });
  it.each(['fast-pool', 'cheap-async'] as const)('keeps %s duplicate/uncertain nonce attempts reserved', async profile => {
    const f = await fixture(profile);
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(new Error('transport interrupted'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('interrupted');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ phase: 'quote', txHash: null, nonce: 4 });
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required', readyToSign: false });
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each(['fast-pool', 'cheap-async'] as const)('reconciles %s canonical issue after reload without restoring authority', async profile => {
    const f = await fixture(profile), submitted = await f.capability.submitCurrentCheapQuote(f.prepared);
    const original = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    expect(Object.keys(original).sort()).toEqual(['callHash', 'chainId', 'core', 'graph', 'nonce', 'owner', 'phase', 'txHash', 'version'].sort());
    const reloadSigner = { ...f.signer };
    m.owner.mockImplementation(async args => args.bindCapability({ assertCurrent: async () => {}, assertSnapshotCurrent: () => {},
      signer: reloadSigner, readProvider: f.readProvider, chainId: 7082400n, ownerAddress: owner }));
    const reload = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-archived' } as never);
    expect(reload.readCurrentCheapTiming(submitted.transactionHash)).toBeNull();
    await expect(reload.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', operationId: 7n, profile, readyToSign: false });
    expect(reload.readCurrentCheapTiming(submitted.transactionHash)).toBeNull();
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeUndefined();
    await expect(reload.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('session');
    expect(submitted.transactionHash).toBe(original.txHash);
  });
  it.each((['fast-pool', 'cheap-async'] as const).flatMap(profile =>
    (['missing', 'duplicate', 'forged', 'selector', 'actor', 'chain', 'nonce', 'reorg', 'deadline', 'gas-cap'] as const)
      .map(fault => [profile, fault] as const)))(
    'rejects %s reload issue drift: %s', async (profile, fault) => {
      const f = await fixture(profile), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
      const receipt = f.receipts.get(sent.transactionHash)!, tx = f.transactions.get(sent.transactionHash)!;
      const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string }>;
      if (fault === 'missing') receipt.logs = [];
      if (fault === 'duplicate') receipt.logs = [...logs, ...logs];
      if (fault === 'forged') logs[0].address = owner;
      if (fault === 'selector') tx.data = accept.encodeFunctionData('acceptPrivateSwapV1', [7n, context]);
      if (fault === 'actor') tx.from = c.core;
      if (fault === 'chain') tx.chainId = 1n;
      if (fault === 'nonce') tx.nonce = 9;
      if (fault === 'reorg') receipt.blockHash = context;
      if (fault === 'deadline') m.operation.mockResolvedValueOnce({ operation: { ...f.currentOperation(), deadline: 201n } });
      if (fault === 'gas-cap') tx.gasLimit = 108_000_000n;
      await expect(f.capability.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
      expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
  it.each(['funds', 'allowance', 'headroom', 'nonce', 'lease', 'expiry', 'graph', 'private-context', 'decline'] as const)(
    'rejects unsafe current Accept before signing: %s', async fault => {
      const f = await fixture('fast-pool'), issued = await f.quote();
      if (fault === 'funds') f.setFunding(19n, 100n);
      if (fault === 'allowance') f.setFunding(100n, 0n);
      if (fault === 'headroom') f.setHeadGas(50_000_000n);
      if (fault === 'nonce') f.signer.getNonce.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
      if (fault === 'lease') f.revoke();
      if (fault === 'expiry') f.clock.mockReturnValue(200000);
      if (fault === 'graph') m.graph.mockResolvedValueOnce({ graph: 'wrong' });
      if (fault === 'private-context') f.setState(4, `0x${'ab'.repeat(32)}`);
      const result = f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => fault !== 'decline' });
      if (fault === 'decline') await expect(result).resolves.toBeNull();
      else await expect(result).rejects.toThrow(fault === 'funds' ? 'input balance is insufficient' :
        fault === 'allowance' ? 'Core allowance is insufficient' :
        fault === 'nonce' ? 'nonce changed' : fault === 'headroom' ? 'gas headroom' : undefined);
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
      expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    });
  it.each(['pending', 'receipt', 'context', 'private', 'reorg'] as const)('never treats Fast consumed or %s as delivery', async fault => {
    const f = await fixture('fast-pool'), issued = await f.quote();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    if (fault === 'pending') f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
    if (fault === 'receipt') f.receipts.get(accepted.transactionHash)!.status = 0;
    if (fault === 'context') f.setState(5, `0x${'ab'.repeat(32)}`);
    if (fault === 'private') f.amounts.netOutput = 0n;
    if (fault === 'reorg') f.receipts.get(accepted.transactionHash)!.blockHash = context;
    await expect(accepted.recover()).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
  });
  it('keeps unmined async Accept pending, then requires the exact funded event', async () => {
    const f = await fixture('cheap-async'), issued = await f.quote(); f.setState(4);
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' });
    const receipt = f.receipts.get(accepted.transactionHash)!;
    receipt.logs = []; await expect(accepted.recover()).rejects.toThrow('unique Core event');
    receipt.status = 0;
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-reverted' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it.each(['fast-pool', 'cheap-async'] as const)('allows a newly reviewed %s Accept only after canonical status-0 reconciliation', async profile => {
    const f = await fixture(profile), issued = await f.quote(); f.setState(4);
    const first = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    f.receipts.get(first.transactionHash)!.status = 0; f.setState(4);
    await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true })).rejects.toThrow('reconcile');
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-reverted' });
    const confirm = vi.fn(async () => true);
    await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm })).resolves.toMatchObject({ status: 'accepting' });
    expect(confirm).toHaveBeenCalledOnce(); expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(3);
  });
  it.each(['pending', 'reorg', 'nonce', 'lease', 'status'] as const)('keeps failed Accept reserved until canonical proof: %s', async fault => {
    const f = await fixture('cheap-async'), issued = await f.quote(); f.setState(4);
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    f.receipts.get(sent.transactionHash)!.status = 0; f.setState(4);
    if (fault === 'pending') f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
    if (fault === 'reorg') f.receipts.get(sent.transactionHash)!.blockHash = context;
    if (fault === 'nonce') f.transactions.get(sent.transactionHash)!.nonce = 5;
    if (fault === 'lease') f.revoke();
    if (fault === 'status') f.receipts.get(sent.transactionHash)!.status = null;
    const recovery = f.capability.recoverPendingCurrentCheapAttempt();
    if (fault === 'pending') await expect(recovery).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' });
    else await expect(recovery).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true })).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['minimum-fill', 'minimum-output', 'rate', 'maximum', 'refund', 'principal', 'context', 'stage'] as const)(
    'rejects async terminal delivery outside its captured intent: %s', async fault => {
      const f = await fixture('cheap-async'), issued = await f.quote(); f.setState(6);
      if (fault === 'minimum-fill') Object.assign(f.amounts, { actualInput: 3n, refund: 17n, grossOutput: 4n, netOutput: 3n });
      if (fault === 'minimum-output') Object.assign(f.amounts, { grossOutput: 1n, netOutput: 0n });
      if (fault === 'rate') Object.assign(f.amounts, { grossOutput: 15n, netOutput: 14n });
      if (fault === 'maximum') Object.assign(f.amounts, { maximumInput: 21n, refund: 6n });
      if (fault === 'refund') f.amounts.refund = 4n;
      if (fault === 'stage') f.setState(5);
      if (fault === 'principal' || fault === 'context') {
        const original = f.readReceipt.getMockImplementation()!;
        f.readReceipt.mockImplementation(async () => { const receipt = await original(); return fault === 'principal'
          ? { ...receipt, principal: c.core }
          : { ...receipt, operation: { ...receipt.operation, contextHash: blockHash } }; });
      }
      await expect(f.capability.readCurrentCheapDelivery(issued)).rejects.toThrow();
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
  it.each(['fill', 'no-fill', 'release'] as const)('reads protected async %s from the recovered intent', async outcome => {
    const f = await fixture('cheap-async'), issued = await f.quote(); f.setState(outcome === 'release' ? 7 : 6);
    if (outcome !== 'fill') Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    await expect(f.capability.readCurrentCheapDelivery(issued)).resolves.toMatchObject({ kind: 'terminal', amounts: f.amounts });
  });
  it.each(['cancel', 'recover'] as const)('uses actual async %s eligibility and exact private refund', async action => {
    const f = await fixture('cheap-async'), issued = await f.quote();
    if (action === 'recover') f.setState(5); // Principal recovery does not require expiry.
    const sent = (await f.capability.submitCurrentCheapOwnerAction({ issued, action, confirm: async () => true }))!;
    expect(sent.request.gasLimit).toBe(action === 'cancel' ? 10_000_000n : 25_000_000n);
    Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    await expect(sent.recover()).resolves.toMatchObject({ status: 'released' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it('rejects Fast owner actions and invalid async recovery states without signing', async () => {
    const fast = await fixture('fast-pool'), issued = await fast.quote();
    await expect(fast.capability.submitCurrentCheapOwnerAction({ issued, action: 'cancel', confirm: async () => true })).rejects.toThrow('no cancel');
    expect(fast.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    const async = await fixture('cheap-async'), quote = await async.quote();
    await expect(async.capability.submitCurrentCheapOwnerAction({ issued: quote, action: 'recover', confirm: async () => true })).rejects.toThrow('not eligible');
    expect(async.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('recovers an interrupted Accept in the same genuine session through the explicit API', async () => {
    const f = await fixture('fast-pool'), issued = await f.quote();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    f.readProvider.getTransactionReceipt.mockResolvedValueOnce(null);
    await expect(accepted.recover()).rejects.toThrow();
    const renewed = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-archived' } as never);
    await expect(renewed.recoverCurrentCheapAcceptance({ issued, transactionHash: accepted.transactionHash })).resolves.toMatchObject({ status: 'settled' });
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['fast-pool', 'cheap-async'] as const)('rejects a %s pending attempt with the other mode selector', async profile => {
    const f = await fixture(profile), sent = await f.capability.submitCurrentCheapQuote(f.prepared);
    const decoded = opening.decodeFunctionData(profile === 'fast-pool' ? 'quoteFastPoolV1' : 'quoteCheapAsyncV1', f.prepared.data);
    const terms = profile === 'fast-pool' ? decoded : decoded.request;
    const wrong = opening.encodeFunctionData(profile === 'fast-pool' ? 'quoteCheapAsyncV1' : 'quoteFastPoolV1',
      profile === 'fast-pool' ? [terms] : terms);
    f.transactions.get(sent.transactionHash)!.data = wrong;
    const recorded = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    const { keccak256 } = await import('@coti-io/coti-ethers');
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...recorded, callHash: keccak256(wrong) }));
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
  });
  it('retains a known hash if the session is revoked just after signing', async () => {
    const f = await fixture('fast-pool'), send = f.signer.sendUncheckedTransaction.getMockImplementation()!;
    f.signer.sendUncheckedTransaction.mockImplementationOnce(async request => { const result = await send(request); f.revoke(); return result; });
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('Session revoked');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ txHash: `0x${'77'.repeat(32)}` });
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
});


describe('finite native swap actual issuer flow',()=>{
  it.each(['fast-pool','cheap-async'] as const)('submits/reconciles exact %s Quote and Accept with fixed fee and budget',async profile=>{
    const f=await fixture(profile,true),issued=await f.quote();
    if(profile==='cheap-async')f.setState(5);
    const ready=await issued.readCurrent();
    const accepted=(await f.capability.submitCurrentCheapAcceptance({issued:ready,confirm:async()=>true}))!;
    await expect(accepted.recover()).resolves.toMatchObject({status:profile==='fast-pool'?'settled':'settlement-pending'});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(profile === 'cheap-async');
    for(const [request] of f.signer.sendUncheckedTransaction.mock.calls)expect(request.gasPrice).toBe(50_000_000n);
    expect(f.signer.estimateGas).toHaveBeenCalledTimes(2);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['cancel','recover'] as const)('uses exact native %s stage and full private refund',async action=>{
    const f=await fixture('cheap-async',true),issued=await f.quote();
    f.setState(action==='recover'?6:1,action==='recover'?context:zero);
    Object.assign(f.amounts,{filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
    const sent=(await f.capability.submitCurrentCheapOwnerAction({issued,action,confirm:async()=>true}))!;
    expect(sent.request.gasLimit).toBe(action==='recover'?50_000_000n:20_000_000n);
    await expect(sent.recover()).resolves.toMatchObject({status:'released'});expect(f.values.size).toBe(0);
  });
  it('stops a wrong native recovery stage without another signature',async()=>{
    const f=await fixture('cheap-async',true),issued=await f.quote();f.setState(5);
    await expect(f.capability.submitCurrentCheapOwnerAction({issued,action:'recover',confirm:async()=>true})).rejects.toThrow('not eligible');expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('retains rejected native wallet signing commitment and cannot reset it on capability reload',async()=>{
    const f=await fixture('fast-pool',true);f.signer.sendUncheckedTransaction.mockRejectedValueOnce(new Error('Wallet rejected'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('Wallet rejected');expect(f.values.size).toBe(1);
    const renewed=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-native'} as never);
    await expect(renewed.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
});


describe('native swap final authority guards',()=>{
  it.each(['fast-pool','cheap-async'] as const)('reconciles known %s Quote after expiry without restoring send authority',async profile=>{
    const f=await fixture(profile,true),sent=await f.capability.submitCurrentCheapQuote(f.prepared);
    f.clock.mockReturnValue(200000);
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({status:'observed-mined',readyToSign:false});
    expect(f.values.size).toBe(0);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();expect(sent.transactionHash).toBeTruthy();
  });
  it('rejects a final canonical base-fee rise before any durable pending entry or signature',async()=>{
    const f=await fixture('fast-pool',true);
    f.signer.estimateGas.mockImplementation(async()=>{f.setBaseFee('0x2faf081');return 10_000_000n;});
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.estimateGas).toHaveBeenCalledOnce();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(f.values.size).toBe(0);
  });
  it.each(['data','principal','inputToken','context'] as const)('rejects unbranded native %s intent mutation without signature',async field=>{
    const f=await fixture('fast-pool',true),mutated=field==='data'?{...f.prepared,data:'0x12345678'}:{...f.prepared,intent:{...f.prepared.intent,[field]:context}};
    await expect(f.capability.submitCurrentCheapQuote(mutated)).rejects.toThrow();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(f.values.size).toBe(0);
  });
});

describe('d06 sender wiring with a test-only cleared owner hold', () => {
  // Synthetic issuer/RPC/private receipts test App flow, not native fit or privacy.
  it.each(['fast-pool', 'cheap-async'] as const)('binds %s Quote and Accept to exact d06 phases', async profile => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture(profile, 'd06'), issued = await f.quote();
    if (profile === 'cheap-async') f.setState(5);
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: await issued.readCurrent(), confirm: async () => true }))!;
    await expect(accepted.recover()).resolves.toMatchObject({ status: profile === 'fast-pool' ? 'settled' : 'settlement-pending' });
    const requests = f.signer.sendUncheckedTransaction.mock.calls.map(([r]) => r);
    expect(requests.map(r => r.gasLimit)).toEqual(profile === 'fast-pool' ? [75_000_000n, 75_000_000n] : [65_000_000n, 35_000_000n]);
    for (const r of requests) expect(r).toMatchObject({ to: STAGED_D06_DEX_CANDIDATE.core, gasPrice: 50_000_000n });
    expect(f.signer.estimateGas).toHaveBeenCalledTimes(2);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(profile === 'cheap-async');
    await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true })).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['cancel', 'recover'] as const)('verifies exact d06 %s refund without inheriting owner-action admission', async action => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'd06'), issued = await f.quote();
    f.setState(action === 'recover' ? 6 : 1, action === 'recover' ? context : zero);
    Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    const released = (await f.capability.submitCurrentCheapOwnerAction({ issued, action, confirm: async () => true }))!;
    expect(released.request.gasLimit).toBe(action === 'recover' ? 50_000_000n : 20_000_000n);
    await expect(released.recover()).resolves.toMatchObject({ status: 'released' });
    expect(f.values.size).toBe(0);
  });
  it.each(['resources', 'estimate', 'session', 'hold'] as const)('stops final d06 %s drift before durable reservation', async fault => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('fast-pool', 'd06');
    if (fault === 'resources') f.setBaseFee('0x2faf081');
    if (fault === 'estimate') f.signer.estimateGas.mockResolvedValue(50_000_001n);
    if (fault === 'session') f.signer.estimateGas.mockImplementation(async () => { f.revoke(); return 10_000_000n; });
    if (fault === 'hold') f.signer.estimateGas.mockImplementation(async () => {
      vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => { throw Error('owner hold restored'); }); return 10_000_000n;
    });
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.each((['fast-pool', 'cheap-async'] as const).flatMap(profile =>
    (['funds', 'allowance', 'expiry', 'context', 'session', 'no-fill', 'decline'] as const).map(fault => [profile, fault] as const)))(
    'rejects d06 %s unsafe Accept: %s', async (profile, fault) => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture(profile, 'd06'), issued = await f.quote(); f.setState(5);
    const ready = await issued.readCurrent();
    if (fault === 'funds') f.setFunding(19n, 100n);
    if (fault === 'allowance') f.setFunding(100n, 0n);
    if (fault === 'expiry') f.clock.mockReturnValue(200000);
    if (fault === 'context') f.setState(5, blockHash);
    if (fault === 'session') f.revoke();
    if (fault === 'no-fill') Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    const result = f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => fault !== 'decline' });
    if (fault === 'decline') await expect(result).resolves.toBeNull();
    else await expect(result).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it.each(['fast-pool', 'cheap-async'] as const)('rechecks d06 %s session after user confirmation', async profile => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture(profile, 'd06'), issued = await f.quote(); f.setState(5);
    await expect(f.capability.submitCurrentCheapAcceptance({ issued: await issued.readCurrent(), confirm: async () => {
      f.revoke(); return true;
    } })).rejects.toThrow('Session revoked');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce(); expect(f.values.size).toBe(0);
  });
  it.each(['partial', 'smaller-protected-fill', 'no-fill', 'released'] as const)('reconciles exact d06 async %s after Accept', async outcome => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'd06'), issued = await f.quote(); f.setState(5);
    const ready = await issued.readCurrent();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true }))!;
    await expect(accepted.recover()).resolves.toMatchObject({ status: 'settlement-pending' });
    f.setState(outcome === 'released' ? 8 : 7);
    if (outcome === 'smaller-protected-fill') Object.assign(f.amounts, { actualInput: 10n, refund: 10n, grossOutput: 12n, netOutput: 11n });
    if (outcome === 'no-fill' || outcome === 'released') Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 20n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    await expect(f.capability.readCurrentCheapDelivery(ready)).resolves.toMatchObject({ kind: 'terminal', amounts: { ...f.amounts } });
    expect(f.amounts.actualInput + f.amounts.refund).toBe(20n);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2); expect(f.values.size).toBe(0);
  });
  it.each(['tolerance', 'refund', 'minimum-fill', 'context', 'principal'] as const)('rejects d06 terminal %s drift without another send', async fault => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'd06'), issued = await f.quote(); f.setState(5);
    const ready = await issued.readCurrent();
    const accepted = (await f.capability.submitCurrentCheapAcceptance({ issued: ready, confirm: async () => true }))!;
    await accepted.recover(); f.setState(7);
    if (fault === 'tolerance') Object.assign(f.amounts, { grossOutput: 16n, netOutput: 15n });
    if (fault === 'refund') f.amounts.refund = 4n;
    if (fault === 'minimum-fill') Object.assign(f.amounts, { actualInput: 3n, refund: 17n, grossOutput: 5n, netOutput: 4n });
    if (fault === 'context') f.setState(7, blockHash);
    if (fault === 'principal') {
      const read = f.readReceipt.getMockImplementation()!;
      f.readReceipt.mockImplementation(async () => ({ ...await read(), principal: STAGED_D06_DEX_CANDIDATE.core }));
    }
    await expect(f.capability.readCurrentCheapDelivery(ready)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it('keeps a d06 recovery with an incorrect private refund blocked after reload', async () => {
    vi.mocked(assertCurrentD06AppAuthority).mockImplementation(() => {});
    const f = await fixture('cheap-async', 'd06'), issued = await f.quote(); f.setState(6);
    const sent = (await f.capability.submitCurrentCheapOwnerAction({ issued, action: 'recover', confirm: async () => true }))!;
    Object.assign(f.amounts, { filled: false, actualInput: 0n, refund: 19n, grossOutput: 0n, fee: 0n, netOutput: 0n });
    await expect(sent.recover()).rejects.toThrow('protected intent');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ verificationBlocked: true });
    const renewed = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-d06' } as never);
    await expect(renewed.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({
      status: 'manual-reconciliation-required', verificationBlocked: true, readyToSign: false, privateAccountingVerified: false
    });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
});
