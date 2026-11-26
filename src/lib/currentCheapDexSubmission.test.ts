const browserContexts = vi.hoisted(() => new WeakMap<object,{owner:string;guard:()=>void}>());
import { getAddress, Interface, keccak256 } from '@coti-io/coti-ethers';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';
import { currentCheapDexStages } from './dexV2Deployment';
import { CURRENT_APP_SWAP_OWNER } from './currentDexC1SwapPolicy';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI, CURRENT_FAST_DEX_RECEIPT_ABI, decodeCurrentCheapDexOperation, type CurrentCheapDexProfile } from './currentDexOperation';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/contracts';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_DEX_OPERATION_LOOKUPS_KEY, readCurrentDexOperationLookups,
  recordCurrentDexOperationLookup } from './currentDexPendingAttempt';
import { CURRENT_DEX_NATIVE_RELOAD_KEY, CURRENT_DEX_NORMAL_USE_RELOAD_KEY, currentDexNormalUseReloadKey, readCurrentDexNativeReload, writeCurrentDexNativeReload } from './currentDexNativeReload';
import { type CurrentTransport } from './currentDexSendBoundary';
import { createCurrentAttemptBoundary } from './currentDexSendBoundary';
import { currentDexOwnerTransferAbi } from './currentDexOwnerTokenProof';
import { currentNativeSigningBudget, currentNativeSwapCheckpoint, hasCurrentNativeSigningBudget } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY } from './currentDexC1SwapPolicy';
import { currentOwnerBetaLegacyReservationHash } from './currentDexNativeSwapPolicy';
import { CURRENT_OWNER_BETA } from './currentDexOwnerBetaPolicy';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './selectedCurrentDexCandidate';
import { currentLimitAbiForCandidate } from './currentDexLimit';
import { currentPoolSnapshotAbi } from './currentDexPoolPosition';
import { resolveCurrentSharedTokenDistribution } from './currentSharedDexTokenDistribution';
import { readCurrentSharedDexTokenFunds } from './currentSharedDexTokenFunds';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { CURRENT_SHARED_DEX_TOKENS } from './currentSharedDexTokenDistribution';
vi.mock('./currentSharedDexTokenFunds',async original=>{
  const actual=await original<typeof import('./currentSharedDexTokenFunds')>();
  return {...actual,readCurrentSharedDexTokenFunds:vi.fn(actual.readCurrentSharedDexTokenFunds)};
});
const ownerActionBrands=vi.hoisted(()=>new WeakMap<object,object>());
vi.mock('../features/wallet/currentDexLimitCapability',async original=>{
  const actual=await original<typeof import('../features/wallet/currentDexLimitCapability')>();
  return {...actual,assertCurrentLimitPrepared:(value:object,signer:object)=>{
    if(ownerActionBrands.get(value)!==signer)actual.assertCurrentLimitPrepared(value,signer);
  }};
});
vi.mock('../features/wallet/currentDexPoolPositionCapability',async original=>{
  const actual=await original<typeof import('../features/wallet/currentDexPoolPositionCapability')>();
  return {...actual,assertCurrentPoolPositionPrepared:(value:object,signer:object)=>{
    if(ownerActionBrands.get(value)!==signer)actual.assertCurrentPoolPositionPrepared(value,signer);
  }};
});
const ownerBeta = vi.hoisted(() => ({ active: false, activation: { activatedAt: 2_000_000_000n, startingNonce: 220, legacyReservationHash:'' } }));
vi.mock('../features/wallet/currentDexPoolFundingCapability',async original=>{
  const actual=await original<typeof import('../features/wallet/currentDexPoolFundingCapability')>();
  return {...actual,assertCurrentPoolFundingPrepared:(value:object,signer:object)=>{
    if(ownerActionBrands.get(value)!==signer)actual.assertCurrentPoolFundingPrepared(value,signer);
  }};
});
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
  wide: vi.fn(), decrypt: vi.fn(), rate: vi.fn(()=>1n) }));
vi.mock('@coti-io/coti-sdk-typescript',async original=>({...await original<typeof import('@coti-io/coti-sdk-typescript')>(),decryptUint:m.rate}));
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: m.owner, hasCurrentDexBrowserSigner: (signer:object|undefined,owner:string)=>{const row=signer&&browserContexts.get(signer);if(!row||row.owner!==owner.toLowerCase())return false;row.guard();return true;} }));
vi.mock('../features/wallet/currentDexReceiptCapability', () => ({ issueCurrentDexReceiptCapability: m.receipts }));
vi.mock('./appChain', async original => ({ ...await original<typeof import('./appChain')>(), readCurrentDexGraph: vi.fn(), readCurrentDexIssuedQuote: m.issue, readCurrentDexOperation: m.operation }));
vi.mock('./dexV2Chain', async original => ({ ...await original<typeof import('./dexV2Chain')>(),
  readCurrentSharedPoolDexGraph: m.graph, readCurrentDexOperation: m.operation }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.wide, decryptPrivateUint256Output: m.decrypt }));
// Only this test can replace the owner hold; production exposes no activation input.
vi.mock('./currentDexC1SwapPolicy', async original => {
  const actual = await original<typeof import('./currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentD06AppAuthority: vi.fn(actual.assertCurrentD06AppAuthority) };
});
const publicAbi = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI), token = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const owner = `0x${'22'.repeat(20)}`, blockHash = `0x${'33'.repeat(32)}`, context = `0x${'66'.repeat(32)}`;
const zero = `0x${'00'.repeat(32)}`, signature = `0x${'44'.repeat(65)}`;
const bindCurrentDexBrowserSigner=(signer:object,owner:string,_chain:bigint,guard:()=>void)=>{browserContexts.set(signer,{owner:owner.toLowerCase(),guard});};
afterEach(() => { ownerBeta.active=false; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

type FixtureReceipt = Awaited<ReturnType<Awaited<ReturnType<typeof import('../features/wallet/currentDexReceiptCapability').issueCurrentDexReceiptCapability>>['readCurrent']>>;

async function fixture(profile: CurrentCheapDexProfile, useNative: 'history' = 'history', selectedOwner = owner, operationId = 7n, deadline = 200n, actualGraph = false, actualReaders = false, coupled?: { rpc: (method: string, args: unknown[]) => Promise<unknown>; principalSend: (request: Record<string, unknown>) => string; head: () => { hash: string; number: string }; now: () => number }) {
  const owner = selectedOwner;
  const blockHash = coupled?.head().hash ?? `0x${'33'.repeat(32)}`;
  const c = history, stages = currentCheapDexStages(c);
  const candidate = 'cheap-history' as const;
  const minedBlock = coupled ? Number(BigInt(coupled.head().number)) : actualGraph ? Number(history.attestationBlock.number) + 10 : 50;
  const preparationBlock = coupled ? minedBlock : actualGraph ? minedBlock - 8 : 42;
  // Public capture of the selected build 13 candidate (decision-034); its SHA-256 is the candidate's attestationSha256.
  const captureBytes = actualGraph ? readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/c1-band-sizing-2026-11-21/native-bob-dense-1/APP_PUBLIC_CAPTURE.json', import.meta.url)) : null;
  if (captureBytes) expect(createHash('sha256').update(captureBytes).digest('hex')).toBe(history.attestationSha256);
  const captured = captureBytes ? JSON.parse(captureBytes.toString()).reads as { method: string; params: unknown[]; result: unknown }[] : [];
  const graphReads: { binding: number; block: string; calls: number }[] = [], graphBindings = new Map<object, number>();
  const opening = new Interface(useNative ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
  const retained = new Interface((import.meta.env.VITE_LOW_RPC_TRIAL ? createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/public-binding.cjs').loadPublicBinding().api.ChainWhisperDexCore.fragments : createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/packed-rate-input-2026-11-03/candidate.cjs').frozen().artifacts.ChainWhisperDexCore.abi));
  // Synthetic packed quote dispatch; retained ABI still checks unchanged actions.
  const compiled = useNative ? new Interface([...retained.fragments.filter((f: { type: string; name?: string }) => !(f.type === 'function' && ['quoteFastPool','quoteCheapAsync'].includes(f.name ?? ''))), ...CURRENT_SLIPPAGE_DEX_QUOTE_ABI]) : retained;
  vi.clearAllMocks();
  const initialTime=useNative==='history'?ownerBeta.activation.activatedAt:100n;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => coupled ? coupled.now() : Number(initialTime)*1000), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage: storage });
  let live = true, stage = profile === 'cheap-async' ? 1 : 4, ready = true, boundContext = profile === 'cheap-async' ? zero : context;
  let balance = 100n, allowance = useNative === 'history' ? 20n : 100n, latest = actualGraph ? minedBlock + 5 : 55, headGas = 150_000_000n;
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
    ...log, index, transactionHash: hash, blockNumber: minedBlock, blockHash, removed: false }));
  const signer = { getUserOnboardInfo: () => ({ aesKey: useNative === 'history' ? '11'.repeat(16) : 'test-only' }),
    encryptValue: vi.fn(async () => ({ ciphertext: 3n, signature })), estimateGas: vi.fn(async () => { if(useNative) return 10_000_000n; throw new Error('MPC estimate must not run'); }),
    getNonce: vi.fn(async () => 4), sendUncheckedTransaction: vi.fn(async request => {
      if (coupled) return coupled.principalSend(request);
      const nativeCall = compiled.parseTransaction({ data: request.data });
      expect(nativeCall).not.toBeNull();
      expect(compiled.encodeFunctionData(nativeCall!.name, nativeCall!.args)).toBe(request.data);
      const name = nativeCall!.name, hash = `0x${(name.startsWith('quote') ? '77' : name.startsWith('accept') ? '88' : '99').repeat(32)}`;
      const quote = name.startsWith('quote');
      if (!quote) { if (name.startsWith('accept')) { stage = stages.funded; boundContext = context; ready = false; } else stage = stages.released; }
      const event = profile === 'fast-pool' && quote ? opening.encodeEventLog(opening.getEvent('FastPoolQuoteIssued')!, [operationId, context, deadline]) :
        profile === 'cheap-async' ? opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, quote ? 1 : stage, quote ? zero : boundContext]) : null;
      const tx = { ...request, hash, blockNumber: minedBlock, blockHash };
      transactions.set(hash, tx);
      const logs: {address:string;topics:string[];data:string}[] = event ? [{ address: c.core, ...event }] : [];
      if ((useNative === 'history') && name.startsWith('accept')) {
        logs.push(ownerTransfer(c.tokens[0][0], owner, c.core, amounts.maximumInput));
        if (profile === 'fast-pool') logs.push(ownerTransfer(c.tokens[1][0], c.core, owner, amounts.netOutput), ownerTransfer(c.tokens[0][0], c.core, owner, amounts.refund));
      }
      if ((useNative === 'history') && name === 'recoverSwap') logs.push(ownerTransfer(c.tokens[0][0], c.core, owner, amounts.maximumInput));
      receipts.set(hash, { hash, status: 1, from: owner, to: c.core, blockNumber: minedBlock, blockHash,
        logs: useNative === 'history' ? originLogs(logs, hash) : logs });
      return hash;
    }) };
  const readProvider = { getTransaction: vi.fn(async hash => transactions.get(hash) ?? null),
    waitForTransaction: vi.fn(async hash => receipts.get(hash) ?? null),
    getTransactionReceipt: vi.fn(async hash => receipts.get(hash) ?? null),
    getLogs: vi.fn(async (filter: { topics: string[]; fromBlock?: bigint; toBlock?: bigint }) => [...receipts.values()].flatMap(r => r.logs as ReturnType<typeof originLogs>).filter(log =>
      log.address.toLowerCase() === c.core.toLowerCase() && log.topics[0] === filter.topics[0] && log.topics[1] === filter.topics[1])),
    send: vi.fn(async (method, params) => {
      if (actualReaders && method === 'eth_call' && params[0].to.toLowerCase() === c.core) {
        expect(params[1]).toEqual({ blockHash, requireCanonical: true });
        if (params[0].data === publicAbi.encodeFunctionData('fastPoolQuotePublic', [operationId])) return publicAbi.encodeFunctionResult('fastPoolQuotePublic', [boundContext, deadline, ready]);
        if (params[0].data === publicAbi.encodeFunctionData('cheapAsyncPublic', [operationId])) return publicAbi.encodeFunctionResult('cheapAsyncPublic', [stage, boundContext, deadline]);
        const receiptAbi = new Interface(profile === 'fast-pool' ? CURRENT_FAST_DEX_RECEIPT_ABI : CURRENT_DEX_RECEIPT_ABI);
        const receiptMethod = profile === 'fast-pool' ? 'fastPoolPrincipalReceipt' : 'principalReceipt';
        if (params[0].data === receiptAbi.encodeFunctionData(receiptMethod, [operationId])) {
          expect(params[0].from.toLowerCase()).toBe(owner);
          const envelope = (amount: bigint) => [[901n, 1n], [amount, 1n]];
          return receiptAbi.encodeFunctionResult(receiptMethod, [[[1n, 1n], ...[amounts.maximumInput, amounts.actualInput, amounts.refund, amounts.grossOutput, amounts.fee, amounts.netOutput].map(envelope)]]);
        }
      }
      if (actualGraph && ['eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(method)) {
        const key = (args: unknown[]) => method === 'eth_call' ? `${(args[0] as { to: string }).to.toLowerCase()}:${(args[0] as { data: string }).data}` :
          `${String(args[0]).toLowerCase()}:${method === 'eth_getStorageAt' ? args[1] : ''}`;
        const row = captured.find(row => row.method === method && key(row.params) === key(params));
        if (row) {
          expect(params[1 + Number(method === 'eth_getStorageAt')]).toEqual({ blockHash, requireCanonical: true });
          if (typeof row.result !== 'string') throw new Error('Captured graph byte result is invalid.');
          return row.result;
        }
        if (method === 'eth_getStorageAt') throw new Error('Missing captured graph storage read.');
      }
      if (method === 'eth_chainId') return `0x${(7082400).toString(16)}`;
      if (method === 'eth_getTransactionCount') return useNative==='history'?'0xdc':'0x4';
      if (method === 'eth_gasPrice') return '0x2faf080';
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (method === 'eth_getCode') return '0x';
      if (method === 'eth_getTransactionByHash') { const tx=transactions.get(params[0])!; return {...tx, input:tx.data, chainId:'0x6c11a0',value:'0x0',nonce:`0x${(tx.nonce as number).toString(16)}`,gas:`0x${(tx.gasLimit as bigint).toString(16)}`,blockNumber:`0x${minedBlock.toString(16)}`,transactionIndex:`0x${[...transactions.keys()].indexOf(params[0]).toString(16)}`}; }
      if (method === 'eth_getTransactionReceipt') { const receipt=receipts.get(params[0])!;return {...receipt,transactionHash:receipt.hash,status:'0x1',blockNumber:`0x${minedBlock.toString(16)}`,transactionIndex:`0x${[...transactions.keys()].indexOf(params[0]).toString(16)}`,
        ...(useNative === 'history' ? { logs: (receipt.logs as ReturnType<typeof originLogs>).map(log => ({ ...log, blockNumber:`0x${minedBlock.toString(16)}`,logIndex:`0x${log.index.toString(16)}` })) } : {}) }; }
      if (actualGraph && method === 'eth_getBlockByNumber' && BigInt(params[0] === 'latest' ? latest : params[0]) === 0n) return { number: '0x0', hash: history.genesisHash };
      if (actualGraph && method === 'eth_getBlockByNumber' && BigInt(params[0] === 'latest' ? latest : params[0]) === BigInt(history.attestationBlock.number)) return { number: params[0], hash: history.attestationBlock.hash };
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
  if (coupled) readProvider.send.mockImplementation(coupled.rpc as NonNullable<ReturnType<typeof readProvider.send.getMockImplementation>>);
  if(ownerBeta.active)bindCurrentDexBrowserSigner(signer,owner,7082400n,()=>{if(!live)throw new Error('Session revoked');});
  const bind = async (args: { bindCapability: (input: unknown) => Promise<unknown> }) => args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: () => { if (!live) throw new Error('Session revoked'); },
    signer, readProvider, ownerAddress: owner, chainId: 7082400n });
  m.owner.mockImplementation(bind);
  m.wide.mockResolvedValue({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature });
  m.decrypt.mockImplementation((_signer, ciphertext) => BigInt(ciphertext.ciphertextHigh));
  m.graph.mockImplementation(async request => ({ graph: c.graph, packageSha256: c.packageSha256, chainId: 7082400n, core: c.core,
    genesisHash: c.genesisHash, inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], maxWorkLifetime: 900n,
    block: { number: request.blockNumber, hash: request.blockHash, timestamp: initialTime },
    operationReadIdentity: { runtimeHash: snapshot().runtimeHash, releaseId: c.releaseId } }));
  if (actualGraph) {
    expect(useNative).toBe('history');
    const reader = await vi.importActual<typeof import('./dexV2Chain')>('./dexV2Chain');
    m.graph.mockImplementation(async request => {
      const before = readProvider.send.mock.calls.length;
      if (!graphBindings.has(request.capability)) graphBindings.set(request.capability, graphBindings.size + 1);
      const result = await reader.readCurrentSharedPoolDexGraph(request);
      graphReads.push({ binding: graphBindings.get(request.capability)!, block: String(request.blockNumber), calls: readProvider.send.mock.calls.length - before });
      return result;
    });
  }
  m.issue.mockImplementation(async args => ({ ...snapshot(), transactionHash: args.issue.expected.transactionHash,
    originBlock: { number: BigInt(minedBlock), hash: blockHash } }));
  m.operation.mockImplementation(async () => snapshot());
  const amounts = { filled: true, maximumInput: 20n, actualInput: 15n, refund: 5n, grossOutput: 17n, fee: 1n, netOutput: 16n };
  const readReceipt = vi.fn(async (_request?: unknown): Promise<FixtureReceipt> => ({ ...snapshot(), kind: profile === 'cheap-async' && stage >= stages.settled ? 'terminal' : ready || stage === stages.ready ? 'quote' : 'unverified', amounts }));
  m.receipts.mockResolvedValue({ readCurrent: readReceipt });
  if (actualReaders) {
    expect(actualGraph).toBe(true);
    const reader = await vi.importActual<typeof import('./dexV2Chain')>('./dexV2Chain');
    m.issue.mockImplementation(reader.readCurrentDexIssuedQuote);
    m.operation.mockImplementation(reader.readCurrentDexOperation);
    const receiptModule = await vi.importActual<typeof import('../features/wallet/currentDexReceiptCapability')>('../features/wallet/currentDexReceiptCapability');
    m.receipts.mockImplementation(async args => {
      const capability = await receiptModule.issueCurrentDexReceiptCapability(args);
      readReceipt.mockImplementation(async request => {
        const receipt = await capability.readCurrent(request as Parameters<typeof capability.readCurrent>[0]);
        expect(receipt.candidate).toBe(c);
        return receipt;
      });
      return { ...capability, readCurrent: readReceipt };
    });
  }
  const quoteCapability = await issueCurrentDexQuoteCapability({} as never);
  const prepared = (await quoteCapability.prepareCurrentQuote({ profile,
    graph: { candidate, expectedGraph: c.graph, expectedPackageSha256: c.packageSha256, blockNumber: BigInt(preparationBlock), blockHash },
    terms: { inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], destination: owner, deadline,
      maximumInput: 20n, minimumInput: 5n, minimumOutput: 1n, rateNumerator: 1n, rateDenominator: 1n, ...(useNative ? {toleranceBps:50} : {}) },
    confirmPrivateInputs: async () => true }))!;
  const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate } as never);
  const quote = async () => { const submitted = await capability.submitCurrentCheapQuote(prepared); return submitted.recover(); };
  const terminal = (recover = false) => {
    stage = recover ? stages.released : stages.settled;
    const hash = `0x${'ab'.repeat(32)}`, method = recover ? 'recoverSwap' : 'advanceFixedWork';
    const event = opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, stage, boundContext]);
    transactions.set(hash, { hash, chainId:7082400n, from:`0x${'ac'.repeat(20)}`, to:c.core,value:0n,
      data:compiled.encodeFunctionData(method,[operationId]),nonce:4,gasLimit:110_000_000n,blockNumber:minedBlock,blockHash });
    const logs = [{address:c.core,...event}, ...(recover ? [ownerTransfer(c.tokens[0][0],c.core,owner,amounts.maximumInput)] :
      [ownerTransfer(c.tokens[1][0],c.core,owner,amounts.netOutput),ownerTransfer(c.tokens[0][0],c.core,owner,amounts.refund)])];
    receipts.set(hash,{hash,status:1,from:`0x${'ac'.repeat(20)}`,to:c.core,blockNumber:minedBlock,blockHash,logs:originLogs(logs,hash)});
    return hash;
  };
  return { profile, signer, values, clock, readProvider, prepared, capability, quote, transactions, receipts, readReceipt, amounts, graphReads,
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
  const value={version:1 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:CURRENT_OWNER_BETA.graph,start:'1792198683',windowStart:'1792441436',activeSwap:null,
    committedWei:String(caps.reduce((sum,cap)=>sum+cap*1_000_000n*50_000_000n,0n)),charges};
  ownerBeta.activation.legacyReservationHash=currentOwnerBetaLegacyReservationHash(value);
  return value;
};
const ownerReloadScope={owner:CURRENT_APP_SWAP_OWNER,graph:history.graph,chainId:7082400n};
const ownerReloadAuthentication=(budget:ReturnType<typeof currentNativeSwapCheckpoint>)=>`0x${createHmac('sha256',Buffer.from('11'.repeat(16),'hex'))
  .update(`ChainWhisper:${budget.version===2?'7b67:owner-normal-use:v2':'b2aa:reload:v1'}:7082400:${CURRENT_APP_SWAP_OWNER}:`+JSON.stringify(budget)).digest('hex')}`;

describe('Decision-030 actual adapter and shared send boundary', () => {
  it.each(['verified', 'reload', 'expired', 'reverted', 'pending', 'unknown', 'mixed', 'canonical', 'sender', 'pending-nonce', 'nonce-race', 'record-race', 'wrong-token', 'private-balance', 'unknown-send'] as const)(
    'clears a positive abandoned approval without first proving it zero: %s', async fault => {
      ownerBeta.active = true;
      const f = await fixture('fast-pool', 'history', CURRENT_APP_SWAP_OWNER, 9n, ownerBeta.activation.activatedAt + 900n);
      f.capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history',
        sessionOnboardInfo: { [CURRENT_APP_SWAP_OWNER]: { aesKey: '11'.repeat(16) } } } as never);
      const policy = resolveCurrentSharedTokenDistribution('cheap-history');
      const states = CURRENT_SHARED_DEX_TOKENS.map(t => ({ ...t, balance: 100n, allowance: 0n,
        encryptionAddress: CURRENT_APP_SWAP_OWNER, claimed: true, quota: 100n, nextClaimAt: 0n,
        initialAmount: policy.initialAmount, refillAmount: policy.refillAmount,
        initialClaimAvailability: 'claimed' as const, refillAvailability: 'ready' as const }));
      vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async ({ head }) => {
        if (head.number === 49n) throw new Error('TEST_ABANDONED_APPROVAL_PARENT_UNAVAILABLE');
        return { owner: CURRENT_APP_SWAP_OWNER, head,
        core: history.core, graph: history.graph, packageSha256: history.packageSha256, vault: policy.vault,
        privateFundsVerified: true, readyToSign: false, tokens: states.map(t => ({ ...t })) }; });
      m.wide.mockImplementation(async (_signer, amount) => ({ ciphertext: { ciphertextHigh: amount, ciphertextLow: 0n }, signature }));
      f.setFunding(100n, 0n); f.signer.estimateGas.mockResolvedValue(800_000n); f.signer.getNonce.mockResolvedValue(220);
      let mined = 0;
      const rpc = f.readProvider.send.getMockImplementation()!;
      f.readProvider.send.mockImplementation(async (method, params) => {
        if (method === 'eth_getTransactionCount') return `0x${(220 + mined).toString(16)}`;
        const result = await rpc(method, params);
        if (fault === 'reverted' && method === 'eth_getTransactionReceipt' && params[0] === `0x${'b8'.repeat(32)}`)
          return { ...result as Extract<typeof result, { transactionHash: unknown }>, status: '0x0' };
        if (method === 'eth_getBlockByNumber') return { ...result as Extract<typeof result, { gasLimit: unknown }>, timestamp: `0x${Math.floor(f.clock() / 1000).toString(16)}` };
        return result;
      });
      f.signer.sendUncheckedTransaction.mockImplementation(async request => {
        if (mined && fault === 'unknown-send') throw new Error('TEST_UNKNOWN_ZERO_SEND');
        const amount = currentTokenFundingAbi.decodeFunctionData('approve', request.data)[1].ciphertext.ciphertextHigh as bigint;
        const hash = `0x${(mined ? 'b8' : 'a8').repeat(32)}`;
        const reverted = mined > 0 && fault === 'reverted';
        f.transactions.set(hash, { ...request, hash, blockNumber: 50, blockHash });
        if (!reverted) states.find(t => t.address.toLowerCase() === request.to!.toString().toLowerCase())!.allowance = amount;
        if (mined && fault === 'private-balance') states[3].balance++;
        const event = currentTokenFundingAbi.encodeEventLog(currentTokenFundingAbi.getEvent('Approval')!,
          [CURRENT_APP_SWAP_OWNER, history.core, [amount, 0n], [8n, 0n]]);
        f.receipts.set(hash, { hash, status: reverted ? 0 : 1, from: CURRENT_APP_SWAP_OWNER, to: request.to, blockNumber: 50, blockHash,
          logs: reverted ? [] : [{ address: request.to, ...event, index: 0, transactionHash: hash, blockNumber: 50, blockHash, removed: false }] });
        mined++; return hash;
      });
      const original = (await f.capability.prepareSharedSwapApproval({ token: f.prepared.intent.inputToken, amount: 20n,
        preparedQuote: f.prepared, assertReviewCurrent: async () => {}, confirm: async () => true }))!;
      const sent = await f.capability.submitSharedSwapApproval(original);
      expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
      expect(states[0].allowance).toBe(20n);
      const originalBudget = readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget;
      expect(originalBudget.activeSwap).not.toBeNull();
      if (fault === 'reload') {
        f.signer = { ...f.signer };
        bindCurrentDexBrowserSigner(f.signer, CURRENT_APP_SWAP_OWNER, 7082400n, () => {});
        m.owner.mockImplementation(async args => args.bindCapability({ signer: f.signer, readProvider: f.readProvider,
          ownerAddress: CURRENT_APP_SWAP_OWNER, chainId: 7082400n, assertCurrent: async () => {}, assertSnapshotCurrent: () => {} }));
        f.capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history',
          sessionOnboardInfo: { [CURRENT_APP_SWAP_OWNER]: { aesKey: '11'.repeat(16) } } } as never);
      }
      f.signer.getNonce.mockResolvedValue(221);
      const quotes = await issueCurrentDexQuoteCapability({} as never);
      const fresh = (await quotes.prepareCurrentQuote({ profile: 'fast-pool',
        graph: { candidate: 'cheap-history', expectedGraph: history.graph, expectedPackageSha256: history.packageSha256, blockNumber: 55n, blockHash },
        terms: { ...f.prepared.intent, maximumInput: 21n }, confirmPrivateInputs: async () => true }))!;
      expect(fresh.data).not.toBe(f.prepared.data);
      f.setFunding(100n, 20n);
      await expect(f.capability.prepareSharedSwapApproval({ token: fresh.intent.inputToken, amount: 21n, preparedQuote: fresh,
        assertReviewCurrent: async () => {}, confirm: async () => true })).resolves.not.toBeNull();
      if (fault === 'expired') {
        f.clock.mockReturnValue(Number(fresh.intent.deadline + 1n) * 1000);
        await expect(f.capability.prepareSharedSwapApproval({ token: fresh.intent.inputToken, amount: 21n, preparedQuote: fresh,
          assertReviewCurrent: async () => {}, confirm: async () => true })).rejects.toThrow();
      }
      const record = { ...originalBudget, charges: originalBudget.charges.map(row => ({ ...row })) };
      if (fault === 'unknown') record.charges[0].hash = null;
      if (fault === 'mixed') { record.charges[0].phase = 'quote'; record.charges[0].key = record.charges[0].scope; record.charges[0].gasCap = '110000000'; record.committedWei = String(110_000_000n * 50_000_000n); }
      writeCurrentDexNativeReload(window.sessionStorage, { budget: record, authentication: ownerReloadAuthentication(record) }, ownerReloadScope);
      const recordKey = currentDexNormalUseReloadKey(ownerReloadScope), bytes = f.values.get(recordKey);
      if (fault === 'pending') f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{unknown');
      if (fault === 'canonical') f.transactions.get(sent.transactionHash)!.data = '0x1234';
      if (fault === 'sender') f.transactions.get(sent.transactionHash)!.from = owner;
      if (fault === 'wrong-token') f.transactions.get(sent.transactionHash)!.to = fresh.intent.outputToken;
      if (fault === 'record-race') {
        const get = f.readProvider.getTransaction.getMockImplementation()!;
        f.readProvider.getTransaction.mockImplementation(async hash => { const tx = await get(hash);
          f.values.set(recordKey, JSON.stringify({ budget: record, authentication: zero })); return tx; });
      }
      if (fault === 'pending-nonce' || fault === 'nonce-race') {
        let reads = 0; const currentRpc = f.readProvider.send.getMockImplementation()!;
        f.readProvider.send.mockImplementation((method, params) => {
          if (method !== 'eth_getTransactionCount') return currentRpc(method, params);
          reads++; return Promise.resolve(fault === 'pending-nonce' && params[1] === 'pending' || fault === 'nonce-race' && reads > 2 ? '0xde' : '0xdd');
        });
      }
      const cleanup = () => f.capability.prepareSharedSwapAllowanceCleanup({ token: fresh.intent.inputToken, preparedQuote: fresh,
        assertReviewCurrent: async () => {}, confirm: async () => true });
      if (!['verified', 'reload', 'expired', 'reverted', 'private-balance', 'unknown-send'].includes(fault)) {
        await expect(cleanup()).rejects.toThrow();
        if (fault !== 'record-race') expect(f.values.get(recordKey)).toBe(bytes);
        expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce(); return;
      }
      const prepared = (await cleanup())!;
      expect(prepared.amount).toBe(0n);
      expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual(originalBudget);
      if (fault === 'unknown-send') {
        await expect(f.capability.submitSharedSwapApproval(prepared)).rejects.toThrow('TEST_UNKNOWN_ZERO_SEND');
        await expect(f.capability.submitSharedSwapApproval(prepared)).rejects.toThrow();
        expect(await f.capability.recoverPendingSharedSwapApproval()).toMatchObject({ status: 'manual-reconciliation-required' });
      } else {
        const zeroSent = await f.capability.submitSharedSwapApproval(prepared);
        const active = readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget;
        expect(active.activeSwap).toBe(originalBudget.activeSwap);
        expect(active.charges[0]).toEqual(originalBudget.charges[0]);
        expect(active.charges[1]).toMatchObject({ scope: originalBudget.activeSwap, phase: 'token-funding', nonce: 221, hash: zeroSent.transactionHash });
        expect(active.committedWei).toBe(String(BigInt(originalBudget.committedWei) + 5_000_000n * 50_000_000n));
        if (fault === 'reverted') {
          expect(await zeroSent.recover()).toMatchObject({ fundingOutcome: 'reverted', privateAccountingVerified: true });
          expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual(active);
          expect(states[0].allowance).toBe(20n);
          await expect(f.capability.reconcileCurrentCheapSwapAllowanceCleanup()).rejects.toThrow();
          expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual(active);
        } else if (fault === 'private-balance') {
          await expect(zeroSent.recover()).rejects.toThrow('private balances');
          expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual(active);
        } else {
          expect(await zeroSent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
          expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual({ ...active, activeSwap: null });
          expect(states.map(t => t.balance)).toEqual([100n, 100n, 100n, 100n]);
          expect(states[0].allowance).toBe(0n);
          if (fault === 'expired') await expect(f.capability.submitCurrentCheapQuote(fresh)).rejects.toThrow();
        }
      }
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    });
  it.each(['verified', 'renew-approval', 'reverted', 'unknown', 'private-balance', 'nonzero-event', 'clone', 'review', 'lookup-race', 'wrong-token',
    'saved-reload', 'saved-reverted', 'saved-private-balance', 'saved-canonical', 'saved-pending', 'saved-lookup', 'saved-authentication', 'saved-mixed', 'saved-unknown', 'saved-nonzero', 'saved-record-race', 'saved-pending-nonce', 'saved-nonce-race', 'closure-write-failure'] as const)('uses the branded browser Quote for zero-only swap allowance cleanup: %s', async result => {
    ownerBeta.active = true;
    const f = await fixture('fast-pool', 'history', CURRENT_APP_SWAP_OWNER, 9n, ownerBeta.activation.activatedAt + 900n);
    f.capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history',
      sessionOnboardInfo: { [CURRENT_APP_SWAP_OWNER]: { aesKey: '11'.repeat(16) } } } as never);
    const policy = resolveCurrentSharedTokenDistribution('cheap-history'), confirm = vi.fn(async () => true);
    const states = CURRENT_SHARED_DEX_TOKENS.map(t => ({ ...t, balance: 100n, allowance: t.address.toLowerCase() === f.prepared.intent.inputToken.toLowerCase() ? 99n : 0n,
      encryptionAddress: CURRENT_APP_SWAP_OWNER, claimed: true, quota: 100n, nextClaimAt: 0n,
      initialAmount: policy.initialAmount, refillAmount: policy.refillAmount, initialClaimAvailability: 'claimed' as const, refillAvailability: 'ready' as const }));
    vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async ({ head }) => ({ owner: CURRENT_APP_SWAP_OWNER, head,
      core: history.core, graph: history.graph, packageSha256: history.packageSha256, vault: policy.vault,
      privateFundsVerified: true, readyToSign: false, tokens: states.map(t => ({ ...t })) }));
    m.wide.mockImplementation(async (_signer, amount) => ({ ciphertext: { ciphertextHigh: amount, ciphertextLow: 0n }, signature }));
    f.signer.getNonce.mockResolvedValue(220); f.signer.estimateGas.mockResolvedValue(800_000n);
    const hash = `0x${'a8'.repeat(32)}`, before = states.map(t => ({ ...t })); let current = true, cleanupMined = false;
    const initialRpc = f.readProvider.send.getMockImplementation()!;
    const reverted = result === 'reverted' || result === 'saved-reverted';
    f.readProvider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_getTransactionCount' && cleanupMined) return '0xdd';
      const value = await initialRpc(method, params);
      return method === 'eth_getTransactionReceipt' && reverted ? { ...value as Extract<typeof value, { transactionHash: unknown }>, status: '0x0' } : value;
    });
    f.signer.sendUncheckedTransaction.mockImplementation(async request => {
      if (result === 'unknown') throw new Error('TEST_UNKNOWN_CLEANUP_SEND');
      const tx = { ...request, hash, blockNumber: 50, blockHash };
      f.transactions.set(hash, tx);
      if (!reverted) states.find(t => t.address.toLowerCase() === request.to!.toString().toLowerCase())!.allowance = 0n;
      if (result === 'private-balance') states[3].balance++;
      const event = currentTokenFundingAbi.encodeEventLog(currentTokenFundingAbi.getEvent('Approval')!,
        [CURRENT_APP_SWAP_OWNER, history.core, [result === 'nonzero-event' ? 1n : 0n, 0n], [8n, 0n]]);
      f.receipts.set(hash, { hash, status: reverted ? 0 : 1, from: CURRENT_APP_SWAP_OWNER, to: request.to,
        blockNumber: 50, blockHash, logs: reverted ? [] : [{ address: request.to, ...event, index: 0, transactionHash: hash, blockNumber: 50, blockHash, removed: false }] });
      cleanupMined = true;
      return hash;
    });
    const request = { token: result === 'wrong-token' ? f.prepared.intent.outputToken : f.prepared.intent.inputToken,
      preparedQuote: f.prepared, assertReviewCurrent: async () => { if (!current) throw new Error('TEST_REVIEW_CHANGED'); }, confirm };
    if (result === 'wrong-token') {
      await expect(f.capability.prepareSharedSwapAllowanceCleanup(request)).rejects.toThrow('differs from the branded Quote');
      expect(confirm).not.toHaveBeenCalled(); return;
    }
    const prepared = (await f.capability.prepareSharedSwapAllowanceCleanup(request))!;
    expect(prepared).toMatchObject({ amount: 0n, cleanup: true, token: getAddress(f.prepared.intent.inputToken), spender: getAddress(history.core) });
    if (result === 'review') current = false;
    if (result === 'lookup-race') f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY, '{unreconciled');
    if (['clone', 'review', 'lookup-race'].includes(result)) {
      await expect(f.capability.submitSharedSwapApproval(result === 'clone' ? { ...prepared } : prepared)).rejects.toThrow();
      expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled(); return;
    }
    if (result === 'unknown') {
      await expect(f.capability.submitSharedSwapApproval(prepared)).rejects.toThrow('TEST_UNKNOWN_CLEANUP_SEND');
      expect(await f.capability.recoverPendingSharedSwapApproval()).toMatchObject({ status: 'manual-reconciliation-required' });
      await expect(f.capability.submitSharedSwapApproval(prepared)).rejects.toThrow();
    } else {
      const sent = await f.capability.submitSharedSwapApproval(prepared);
      const budget = readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget;
      expect(budget.charges).toMatchObject([{ phase: 'token-funding', nonce: 220, gasCap: '5000000', hash }]);
      if (result.startsWith('saved-')) {
        // Model the published version: private recovery had cleared pending but retained the funding-only scope.
        f.values.delete(CURRENT_DEX_PENDING_ATTEMPT_KEY);
        const signer = { ...f.signer, getNonce: vi.fn(async () => 221), sendUncheckedTransaction: vi.fn(async () => { throw new Error('TEST_SAVED_APPROVAL_BOUNDARY'); }) };
        bindCurrentDexBrowserSigner(signer, CURRENT_APP_SWAP_OWNER, 7082400n, () => {});
        m.owner.mockImplementation(async args => args.bindCapability({ signer, readProvider: f.readProvider, ownerAddress: CURRENT_APP_SWAP_OWNER,
          chainId: 7082400n, assertCurrent: async () => {}, assertSnapshotCurrent: () => {} }));
        const record = { ...budget, charges: budget.charges.map(row => ({ ...row })) };
        if (result === 'saved-unknown') record.charges[0].hash = null;
        if (result === 'saved-mixed') { record.charges[0].phase = 'quote'; record.charges[0].key = record.charges[0].scope; }
        writeCurrentDexNativeReload(window.sessionStorage, { budget: record,
          authentication: result === 'saved-authentication' ? zero : ownerReloadAuthentication(record) }, ownerReloadScope);
        const recordKey = currentDexNormalUseReloadKey(ownerReloadScope), oldBytes = f.values.get(recordKey);
        const rpc = f.readProvider.send.getMockImplementation()!;
        f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve('0xdd') : rpc(method, params));
        vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async ({ head }) => ({ owner: CURRENT_APP_SWAP_OWNER, head,
          core: history.core, graph: history.graph, packageSha256: history.packageSha256, vault: policy.vault,
          privateFundsVerified: true, readyToSign: false, tokens: (head.number === 49n ? before : states).map(t => ({ ...t })) }));
        if (result === 'saved-private-balance') states[3].balance++;
        if (result === 'saved-nonzero') states[0].allowance = 1n;
        if (result === 'saved-canonical') f.transactions.get(hash)!.data = '0x1234';
        if (result === 'saved-pending') f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{unknown');
        if (result === 'saved-lookup') f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY, '{unknown');
        if (result === 'saved-record-race') {
          const get = f.readProvider.getTransaction.getMockImplementation()!;
          f.readProvider.getTransaction.mockImplementation(async transactionHash => {
            const tx = await get(transactionHash);
            f.values.set(recordKey, JSON.stringify({ budget: record, authentication: zero })); return tx;
          });
        }
        const cap = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history',
          sessionOnboardInfo: { [CURRENT_APP_SWAP_OWNER]: { aesKey: '11'.repeat(16) } } } as never);
        if (result === 'saved-pending-nonce' || result === 'saved-nonce-race') {
          let nonceReads = 0; const resourceRpc = f.readProvider.send.getMockImplementation()!;
          f.readProvider.send.mockImplementation((method, params) => {
            if (method !== 'eth_getTransactionCount') return resourceRpc(method, params);
            nonceReads++;
            return Promise.resolve(result === 'saved-pending-nonce' && params[1] === 'pending' || result === 'saved-nonce-race' && nonceReads > 2 ? '0xde' : '0xdd');
          });
          await expect(cap.reconcileCurrentCheapSwapAllowanceCleanup()).rejects.toThrow('nonce');
          expect(f.values.get(recordKey)).toBe(oldBytes); expect(signer.sendUncheckedTransaction).not.toHaveBeenCalled(); return;
        }
        const quotes = await issueCurrentDexQuoteCapability({} as never);
        const fresh = (await quotes.prepareCurrentQuote({ profile: 'fast-pool',
          graph: { candidate: 'cheap-history', expectedGraph: history.graph, expectedPackageSha256: history.packageSha256, blockNumber: 55n, blockHash },
          terms: { ...f.prepared.intent, maximumInput: 21n }, confirmPrivateInputs: async () => true }))!;
        f.setFunding(100n, 0n);
        const approval = () => result === 'saved-reverted' ? cap.prepareSharedSwapAllowanceCleanup({ token: fresh.intent.inputToken, preparedQuote: fresh,
          assertReviewCurrent: async () => {}, confirm: async () => true }) : cap.prepareSharedSwapApproval({ token: fresh.intent.inputToken, amount: 21n, preparedQuote: fresh,
          assertReviewCurrent: async () => {}, confirm: async () => true });
        if (result === 'saved-reverted') m.wide.mockImplementation(async (_signer, amount) => ({
          ciphertext: { ciphertextHigh: amount, ciphertextLow: 0n }, signature: `0x${'45'.repeat(65)}` }));
        if (result === 'saved-reload' || result === 'saved-reverted') {
          const p = (await approval())!;
          await expect(cap.submitSharedSwapApproval(p)).rejects.toThrow('TEST_SAVED_APPROVAL_BOUNDARY');
          const after = readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget;
          expect(after.charges[0]).toEqual(budget.charges[0]);
          expect(after.charges[1]).toMatchObject({ phase: 'token-funding', nonce: 221, hash: null });
          expect(after.committedWei).toBe(String(BigInt(budget.committedWei) + 5_000_000n * 50_000_000n));
          expect(signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
        } else {
          await expect((async () => { const p = (await approval())!; await cap.submitSharedSwapApproval(p); })()).rejects.toThrow();
          expect(signer.sendUncheckedTransaction).not.toHaveBeenCalled();
          if (result !== 'saved-record-race') expect(f.values.get(recordKey)).toBe(oldBytes);
        }
        expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce(); return;
      }
      if (result === 'closure-write-failure') {
        const write = window.sessionStorage.setItem.bind(window.sessionStorage);
        const failWrite = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation((key, value) => {
          if (key.startsWith(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)) throw new Error('TEST_CLOSURE_WRITE_FAILURE'); write(key, value);
        });
        await expect(sent.recover()).rejects.toThrow();
        expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual(budget);
        expect(currentNativeSwapCheckpoint(f.signer)).toEqual(budget);
        failWrite.mockRestore();
        await f.capability.reconcileCurrentCheapSwapAllowanceCleanup();
        expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget).toEqual({ ...budget, activeSwap: null });
        expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce(); return;
      }
      if (result === 'verified' || result === 'renew-approval' || result === 'reverted') {
        expect(await sent.recover()).toMatchObject({ fundingOutcome: result === 'reverted' ? 'reverted' : 'verified', privateAccountingVerified: true });
        expect(states).toEqual(result === 'reverted' ? before : before.map(t => t.address.toLowerCase() === prepared.token.toLowerCase() ? { ...t, allowance: 0n } : t));
        expect(readCurrentDexNativeReload(window.sessionStorage, ownerReloadScope)!.budget.activeSwap).toBe(result === 'reverted' ? budget.activeSwap : null);
        expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
        if (result === 'renew-approval') {
          f.setFunding(100n, 0n);
          const quoteCapability = await issueCurrentDexQuoteCapability({} as never);
          const fresh = (await quoteCapability.prepareCurrentQuote({ profile: 'fast-pool',
            graph: { candidate: 'cheap-history', expectedGraph: history.graph, expectedPackageSha256: history.packageSha256, blockNumber: 55n, blockHash },
            terms: { ...f.prepared.intent, maximumInput: 21n }, confirmPrivateInputs: async () => true }))!;
          expect(fresh.data).not.toBe(f.prepared.data);
          f.signer.getNonce.mockResolvedValue(221);
          const rpc = f.readProvider.send.getMockImplementation()!;
          f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve('0xdd') : rpc(method, params));
          f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_NEXT_EXACT_APPROVAL_BOUNDARY'));
          const approval = (await f.capability.prepareSharedSwapApproval({ token: fresh.intent.inputToken, amount: 21n,
            preparedQuote: fresh, assertReviewCurrent: async () => {}, confirm: async () => true }))!;
          await expect(f.capability.submitSharedSwapApproval(approval)).rejects.toThrow('TEST_NEXT_EXACT_APPROVAL_BOUNDARY');
          expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
          return;
        }
      } else {
        await expect(sent.recover()).rejects.toThrow(result === 'private-balance' ? 'private balances' : 'allowance differs');
        expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ verificationBlocked: true });
      }
    }
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each(['idle', 'active', 'funding-active', 'unknown', 'lookup', 'pending', 'authentication', 'unbranded'] as const)('checks strict browser idle state before swap allowance cleanup: %s', async state => {
    ownerBeta.active = true;
    const f = await fixture('fast-pool', 'history', CURRENT_APP_SWAP_OWNER, 9n, ownerBeta.activation.activatedAt + 900n);
    const scope = `quote:${keccak256(f.prepared.data)}`, active = ['active', 'funding-active', 'unknown'].includes(state);
    const phase = state === 'funding-active' ? 'token-funding' as const : 'quote' as const, gasCap = phase === 'token-funding' ? '5000000' : '110000000';
    const budget = { version: 2 as const, owner: CURRENT_APP_SWAP_OWNER, candidateGraph: history.graph,
      start: String(ownerBeta.activation.activatedAt), activeSwap: active ? scope : null,
      committedWei: active ? String(BigInt(gasCap) * 50_000_000n) : '0', charges: active ? [{ phase, scope,
        key: phase === 'quote' ? scope : `token-funding:${scope}:${zero}`, gasCap, gasPrice: '50000000', nonce: 220,
        hash: state === 'unknown' ? null : `0x${'ab'.repeat(32)}` }] : [] };
    writeCurrentDexNativeReload(window.sessionStorage, { budget, authentication: state === 'authentication' ? zero : ownerReloadAuthentication(budget) });
    const before = f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    const attempt = { version: 1, chainId: '7082400', owner: CURRENT_APP_SWAP_OWNER, core: history.core, graph: `0x${history.graph}`,
      phase: 'quote', callHash: keccak256(f.prepared.data), nonce: 220, txHash: state === 'lookup' ? `0x${'aa'.repeat(32)}` : null };
    if (state === 'pending') f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt));
    if (state === 'lookup') f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY, JSON.stringify([{ attempt, operationId: '9', contextHash: context,
      deadline: String(f.prepared.intent.deadline), origin: { number: 50, hash: blockHash } }]));
    const check = f.capability.assertCurrentCheapSwapAllowanceCleanupIdle(state === 'unbranded' ? { ...f.prepared } : f.prepared);
    if (state === 'idle') await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(before);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['idle', 'active', 'funding-active', 'unknown', 'lookup', 'pending', 'authentication', 'unbranded'] as const)('checks read-only token approval dependency guard: %s', async state => {
    ownerBeta.active = true;
    const f = await fixture('fast-pool', 'history', CURRENT_APP_SWAP_OWNER, 9n, ownerBeta.activation.activatedAt + 900n);
    const scope = `quote:${keccak256(f.prepared.data)}`, active = ['active', 'funding-active', 'unknown'].includes(state);
    const phase = state === 'funding-active' ? 'token-funding' as const : 'quote' as const, gasCap = phase === 'token-funding' ? '5000000' : '110000000';
    const budget = { version: 2 as const, owner: CURRENT_APP_SWAP_OWNER, candidateGraph: history.graph,
      start: String(ownerBeta.activation.activatedAt), activeSwap: active ? scope : null,
      committedWei: active ? String(BigInt(gasCap) * 50_000_000n) : '0', charges: active ? [{ phase, scope,
        key: phase === 'quote' ? scope : `token-funding:${scope}:${zero}`, gasCap, gasPrice: '50000000', nonce: 220,
        hash: state === 'unknown' ? null : `0x${'ab'.repeat(32)}` }] : [] };
    writeCurrentDexNativeReload(window.sessionStorage, { budget, authentication: state === 'authentication' ? zero : ownerReloadAuthentication(budget) });
    const before = f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    const attempt = { version: 1, chainId: '7082400', owner: CURRENT_APP_SWAP_OWNER, core: history.core, graph: `0x${history.graph}`,
      phase: 'quote', callHash: keccak256(f.prepared.data), nonce: 220, txHash: state === 'lookup' ? `0x${'aa'.repeat(32)}` : null };
    if (state === 'pending') f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt));
    if (state === 'lookup') f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY, JSON.stringify([{ attempt, operationId: '9', contextHash: context,
      deadline: String(f.prepared.intent.deadline), origin: { number: 50, hash: blockHash } }]));
    const check = f.capability.assertCurrentAllowanceMutationIdle(state === 'unbranded' ? { ...f.prepared } : f.prepared);
    if (state === 'idle' || state === 'funding-active') await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(before);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.skipIf(!import.meta.env.VITE_LOW_RPC_TRIAL)('counts one coupled compiled App and keeper operation with matched public admission readers', async () => {
    const require = createRequire(import.meta.url), runtime = '../../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/runtime/';
    const { coupledKeeper } = require(runtime + 'native-io.fixture.cjs'), results = [];
    vi.stubGlobal('fetch', () => { throw new Error('TEST_NETWORK_ACCESS'); });
    for (const restart of [false, true]) for (const before of [true, false]) {
      ownerBeta.active = true;
      const wallet = `0x${'cd'.repeat(20)}`, deadline = ownerBeta.activation.activatedAt + 900n;
      const amounts = { filled: true, maximumInput: 20n, actualInput: 15n, refund: 5n, grossOutput: 17n, fee: 1n, netOutput: 16n };
      const model = await coupledKeeper({ principal: wallet, operationId: 9n, now: Number(ownerBeta.activation.activatedAt) * 1000, deadline, amounts, before });
      try {
        expect(model.identity.graph).toBe(history.graph);expect(model.identity.core.toLowerCase()).toBe(history.core);
        const tokenAbi = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI), receiptAbi = new Interface(CURRENT_DEX_RECEIPT_ABI);
        const transfer = (address: string, from: string, to: string, amount: bigint) => ({ address,
          ...currentDexOwnerTransferAbi.encodeEventLog(currentDexOwnerTransferAbi.getEvent('Transfer')!, [from, to,
            [from === wallet ? amount : 901n, 1n], [to === wallet ? amount : 902n, 1n]]) });
        model.bindApp({
          transfer: (phase: string) => phase === 'fund' ? [transfer(history.tokens[0][0], wallet, history.core, amounts.maximumInput)] :
            [transfer(history.tokens[1][0], history.core, wallet, amounts.netOutput), transfer(history.tokens[0][0], history.core, wallet, amounts.refund)],
          privateReceipt: () => { const envelope = (amount: bigint) => [[901n, 1n], [amount, 1n]];
            return receiptAbi.encodeFunctionResult('principalReceipt', [[[1n, 1n], ...[amounts.maximumInput, amounts.actualInput, amounts.refund, amounts.grossOutput, amounts.fee, amounts.netOutput].map(envelope)]]); },
          tokenCall: (call: { to: string; from: string; data: string }) => {
            if (!history.tokens.some(([address]) => address === call.to.toLowerCase())) return undefined;
            expect(call.from.toLowerCase()).toBe(wallet);const parsed = tokenAbi.parseTransaction({ data: call.data });
            if (parsed?.name === 'balanceOf') return tokenAbi.encodeFunctionResult('balanceOf(address)', [[100n, 1n]]);
            expect(parsed?.name).toBe('allowance');return tokenAbi.encodeFunctionResult('allowance(address,address)', [[[999999n, 1n], [20n, 1n], [888888n, 1n]]]);
          }
        });
        const f = await fixture('cheap-async', 'history', wallet, 9n, deadline, true, true, model);
        f.signer.getNonce.mockImplementation(async () => model.principalNonce());
        const sdkReceipt = async (hash: string) => {
          const raw = await model.rpc('eth_getTransactionReceipt', [hash]);
          return raw && { ...raw, hash: raw.transactionHash, status: Number(BigInt(raw.status)), blockNumber: Number(BigInt(raw.blockNumber)),
            logs: raw.logs.map((log: Record<string, string>) => ({ ...log, index: Number(BigInt(log.logIndex)), blockNumber: Number(BigInt(log.blockNumber)) })) };
        };
        f.readProvider.getTransaction.mockImplementation(async hash => {const raw = await model.rpc('eth_getTransactionByHash', [hash]);return raw && { ...raw, data: raw.input, value: BigInt(raw.value), nonce: Number(BigInt(raw.nonce)), gasLimit: BigInt(raw.gas), chainId: 7082400n, blockNumber: Number(BigInt(raw.blockNumber)) };});
        f.readProvider.getTransactionReceipt.mockImplementation(sdkReceipt);
        f.readProvider.waitForTransaction.mockImplementation(sdkReceipt);
        f.readProvider.getLogs.mockImplementation(async filter => {
          const rows = await model.rpc('eth_getLogs', [{ ...filter, fromBlock: `0x${BigInt(filter.fromBlock!).toString(16)}`, toBlock: `0x${BigInt(filter.toBlock!).toString(16)}` }]);
          return rows.filter((log: { topics: string[] }) => log.topics[0] === filter.topics[0] && log.topics[1] === filter.topics[1]).map((log: Record<string, string>) => ({ ...log, index: Number(BigInt(log.logIndex)), blockNumber: Number(BigInt(log.blockNumber)) }));
        });
        const counts = () => ({ provider: model.requests.length,
          methods: Object.fromEntries([...new Set<string>(model.requests.map((row: { method: string }) => row.method))].sort().map(method => [method, model.requests.filter((row: { method: string }) => row.method === method).length])),
          wallet: { nonce: f.signer.getNonce.mock.calls.length, estimate: f.signer.estimateGas.mock.calls.length, privateInputs: m.wide.mock.calls.length, wideDecrypt: m.decrypt.mock.calls.length, rateDecrypt: m.rate.mock.calls.length, send: f.signer.sendUncheckedTransaction.mock.calls.length } });
        await f.capability.checkCurrentCheapCandidate();const setup = counts();model.scope('app-quote');
        const issued = await f.quote();const quote = counts();
        const checkpoints = [{ phase: 'Quote', stage: model.stage(), head: { ...model.head() }, syntheticElapsedMs: model.now() - Number(ownerBeta.activation.activatedAt) * 1000, privateReceiptCalls: f.readReceipt.mock.calls.length }];
        expect(checkpoints[0].stage).toBe(1);expect(checkpoints[0].privateReceiptCalls).toBe(0);
        model.scope('coupling-negative');const sends = f.signer.sendUncheckedTransaction.mock.calls.length;
        await expect(f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true })).rejects.toThrow(/not READY/);
        expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends);const negativeRequests = counts().provider - quote.provider;
        let accepted = false;
        model.onReady(async () => {
          expect(model.stage()).toBe(currentCheapDexStages(history).ready);
          checkpoints.push({ phase: 'READY before App review', stage: model.stage(), head: { ...model.head() }, syntheticElapsedMs: model.now() - Number(ownerBeta.activation.activatedAt) * 1000, privateReceiptCalls: f.readReceipt.mock.calls.length });
          const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
          expect((await sent.recover()).status).toBe('settlement-pending');accepted = true;
          checkpoints.push({ phase: 'Accept', stage: model.stage(), head: { ...model.head() }, syntheticElapsedMs: model.now() - Number(ownerBeta.activation.activatedAt) * 1000, privateReceiptCalls: f.readReceipt.mock.calls.length });
        });
        await model.run(restart);expect(accepted).toBe(true);model.scope('app-delivery');
        const delivery = await f.capability.readCurrentCheapDelivery(issued);
        expect(delivery).toMatchObject({ kind: 'terminal', principal: wallet, amounts });
        checkpoints.push({ phase: 'Delivery', stage: model.stage(), head: { ...model.head() }, syntheticElapsedMs: model.now() - Number(ownerBeta.activation.activatedAt) * 1000, privateReceiptCalls: f.readReceipt.mock.calls.length });
        expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
        const keeper = model.result(), completed = counts(), keeperLogical = keeper.invocations.reduce((sum: number, row: { beforeClose: { logicalCalls: number } }) => sum + row.beforeClose.logicalCalls, 0);
        const keeperProvider = model.requests.filter((row: { scope: string }) => row.scope.startsWith('keeper')).length;
        const result = { kind: 'COUPLED_COMPILED_APP_KEEPER_LOCAL_COUNTER', comparison: before ? 'old public storage admission' : 'compiled compact public admission', restart,
          graph: history.graph, identity: model.identity, setup, quote, completed, negativeRequests, checkpoints, graphReads: f.graphReads,
          appProviderSend: f.readProvider.send.mock.calls.length, sdkProviderMethods: { transaction: f.readProvider.getTransaction.mock.calls.length, receipt: f.readProvider.getTransactionReceipt.mock.calls.length, wait: f.readProvider.waitForTransaction.mock.calls.length, logs: f.readProvider.getLogs.mock.calls.length },
          coldKeeperSetupProvider: model.setup.length, operationAfterExplicitSetupProvider: completed.provider - setup.provider - negativeRequests,
          operationAfterExplicitSetupScope: 'Includes cold keeper invocation qualification and forced-restart qualification; not a pure prequalified warm path.',
          wholeProvider: completed.provider - negativeRequests + model.setup.length, wholeLogical: completed.provider - negativeRequests - keeperProvider + keeperLogical + model.setup.length,
          readyProvider: model.requests.filter((row: { scope: string; stage: number }) => row.scope.startsWith('keeper') && row.stage === 5).length, receiptWaitProvider: model.requests.filter((row: { scope: string; method: string }) => row.scope.endsWith('/waitReceipt') && row.method === 'eth_getTransactionReceipt').length,
          keeperProvider, keeperLogical, keeper, byScope: Object.fromEntries([...new Set<string>(model.requests.map((row: { scope: string }) => row.scope))].map(scope => [scope, model.requests.filter((row: { scope: string }) => row.scope === scope).length])),
          limits: 'Synthetic wallet, crypto, chain, state, balances and receipts. Logical/provider/high-level wallet calls only. No network, HTTP demand, native gas, native privacy/accounting or real wall wait measured.' };
        results.push(result);console.log(JSON.stringify(result));
      } finally { model.close();vi.restoreAllMocks();vi.clearAllMocks(); }
    }
    for (let i = 0; i < results.length; i += 2) {
      expect(results[i].identity).toEqual(results[i + 1].identity);expect(results[i].keeper.inputSha256).toBe(results[i + 1].keeper.inputSha256);expect(results[i].keeper.stateSha256).toBe(results[i + 1].keeper.stateSha256);expect(results[i].completed.wallet).toEqual(results[i + 1].completed.wallet);
      expect(results[i + 1].wholeProvider).toBeLessThan(results[i].wholeProvider);expect(results[i + 1].wholeLogical).toBeLessThan(results[i].wholeLogical);
    }
  }, 60_000);
  it('counts a complete current async App journey with actual public and private readers', async () => {
    ownerBeta.active = true;
    const wallet = `0x${'cd'.repeat(20)}`, f = await fixture('cheap-async', 'history', wallet, 9n, ownerBeta.activation.activatedAt + 900n, true, true);
    let nonce = 220;
    f.signer.getNonce.mockImplementation(async () => nonce);
    const rpc = f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve(`0x${nonce.toString(16)}`) : rpc(method, params));
    const counts = () => ({ providerSend: f.readProvider.send.mock.calls.length,
      methods: Object.fromEntries([...new Set(f.readProvider.send.mock.calls.map(([method]) => method))].sort().map(method => [method, f.readProvider.send.mock.calls.filter(([m]) => m === method).length])),
      mockedProviderMethods: { transaction: f.readProvider.getTransaction.mock.calls.length, receipt: f.readProvider.getTransactionReceipt.mock.calls.length,
        wait: f.readProvider.waitForTransaction.mock.calls.length, logs: f.readProvider.getLogs.mock.calls.length },
      mockedWalletMethods: { nonce: f.signer.getNonce.mock.calls.length, estimate: f.signer.estimateGas.mock.calls.length,
        encryptedInputs: m.wide.mock.calls.length, send: f.signer.sendUncheckedTransaction.mock.calls.length } });
    await f.capability.checkCurrentCheapCandidate(); const setup = counts();
    const issued = await f.quote(); const quote = counts(); nonce++;
    f.setState(currentCheapDexStages(history).ready);
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    expect((await sent.recover()).status).toBe('settlement-pending'); const funded = counts(); nonce++;
    f.terminal();
    const delivery = await f.capability.readCurrentCheapDelivery(issued);
    expect(delivery).toMatchObject({ kind: 'terminal', principal: wallet, amounts: f.amounts });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexOperationLookups(window.sessionStorage)).toHaveLength(0);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
    console.log(JSON.stringify({ kind: 'CURRENT_ASYNC_ACTUAL_PUBLIC_PRIVATE_READER_LOGICAL_READS', setup, quote, funded, completed: counts(),
      warmAfterSetup: counts().providerSend - setup.providerSend,
      keeperRequests: 'unmeasured: fixture advances public work state; no keeper was invoked',
      physicalHTTP: 'unmeasured', synthetic: 'chain responses, work transitions, decryption, wallet and high-level SDK methods' }));
  });
  it('counts a complete current Fast journey with actual graph operation and private readers', async () => {
    ownerBeta.active = true;
    const wallet = `0x${'cd'.repeat(20)}`, f = await fixture('fast-pool', 'history', wallet, 9n, ownerBeta.activation.activatedAt + 900n, true, true);
    let nonce = 220;
    f.signer.getNonce.mockImplementation(async () => nonce);
    const rpc = f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve(`0x${nonce.toString(16)}`) : rpc(method, params));
    const counts = () => ({ providerSend: f.readProvider.send.mock.calls.length,
      methods: Object.fromEntries([...new Set(f.readProvider.send.mock.calls.map(([method]) => method))].sort().map(method => [method, f.readProvider.send.mock.calls.filter(([m]) => m === method).length])),
      graphInvocations: f.graphReads.length, graphSubrequests: f.graphReads.reduce((sum, row) => sum + row.calls, 0),
      actualIssueDelegations: m.issue.mock.calls.length, actualOperationDelegations: m.operation.mock.calls.length, actualPrivateDelegations: f.readReceipt.mock.calls.length,
      mockedProviderMethods: { transaction: f.readProvider.getTransaction.mock.calls.length, receipt: f.readProvider.getTransactionReceipt.mock.calls.length,
        wait: f.readProvider.waitForTransaction.mock.calls.length, logs: f.readProvider.getLogs.mock.calls.length },
      mockedWalletMethods: { nonce: f.signer.getNonce.mock.calls.length, estimate: f.signer.estimateGas.mock.calls.length,
        encryptedInputs: m.wide.mock.calls.length, send: f.signer.sendUncheckedTransaction.mock.calls.length } });
    await f.capability.checkCurrentCheapCandidate(); const setup = counts();
    const issued = await f.quote(); const quote = counts(); nonce++;
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!; const accept = counts();
    expect((await sent.recover()).delivery).toMatchObject({ principal: wallet, core: history.core, amounts: f.amounts });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.readReceipt).toHaveBeenCalledTimes(3);
    // Build 13 capture. CW-140.03: the second read capability on this provider reuses the first qualification
    // (15 requests instead of a second 107-request cold read), so setup and quote read less.
    expect([setup.providerSend, quote.providerSend, accept.providerSend, counts().providerSend]).toEqual([134, 193, 302, 355]);
    expect(counts().providerSend - setup.providerSend).toBe(221);
    expect(m.issue).toHaveBeenCalledOnce(); expect(m.operation).toHaveBeenCalledTimes(4);
    expect(m.rate).toHaveBeenCalledTimes(3);
    console.log(JSON.stringify({ kind: 'CURRENT_FAST_ACTUAL_PUBLIC_PRIVATE_READER_LOGICAL_READS', setup, quote, accept, completed: counts(),
      warmAfterSetup: counts().providerSend - setup.providerSend, graphReads: f.graphReads,
      synthetic: 'owner envelope values, decryption, wallet methods, SDK high-level transaction/receipt methods', physicalHTTP: 'not measured', keeperRequests: 0 }));
  });
  it('counts a complete current Fast journey with actual canonical graph reads', async () => {
    ownerBeta.active = true;
    const wallet = `0x${'cd'.repeat(20)}`, f = await fixture('fast-pool', 'history', wallet, 9n, ownerBeta.activation.activatedAt + 900n, true);
    let nonce = 220;
    f.signer.getNonce.mockImplementation(async () => nonce);
    const rpc = f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve(`0x${nonce.toString(16)}`) : rpc(method, params));
    const counts = () => ({ providerSend: f.readProvider.send.mock.calls.length,
      methods: Object.fromEntries([...new Set(f.readProvider.send.mock.calls.map(([method]) => method))].sort().map(method => [method, f.readProvider.send.mock.calls.filter(([m]) => m === method).length])),
      graphInvocations: f.graphReads.length, graphSubrequests: f.graphReads.reduce((sum, row) => sum + row.calls, 0),
      operationMocks: m.operation.mock.calls.length, privateReceiptMocks: f.readReceipt.mock.calls.length });
    await f.capability.checkCurrentCheapCandidate(); const setup = counts();
    const issued = await f.quote(); const quote = counts(); nonce++;
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    expect((await sent.recover()).delivery).toMatchObject({ principal: wallet, core: history.core, amounts: f.amounts });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(new Set(f.graphReads.map(row => row.binding)).size).toBe(2);
    // CW-140.03: one cold qualification per read provider; the second capability only repeats fresh runtime/admission reads.
    expect(f.graphReads.filter(row => row.calls === 107)).toHaveLength(1);
    expect(f.graphReads.find(row => row.binding === 2)?.calls).toBe(15);
    expect(f.graphReads.every(row => row.calls === 107 || row.calls === 2 || row.calls === 15)).toBe(true);
    expect([setup.providerSend, quote.providerSend, counts().providerSend]).toEqual([134, 181, 267]);
    expect([setup.graphSubrequests, quote.graphSubrequests, counts().graphSubrequests]).toEqual([124, 134, 162]);
    expect(counts().providerSend - setup.providerSend).toBeLessThanOrEqual(200);
    console.log(JSON.stringify({ kind: 'CURRENT_FAST_ACTUAL_GRAPH_LOGICAL_READS', setup, quote, completed: counts(), graphReads: f.graphReads,
      operationAndPrivateSubrequests: 'mocked; not counted', walletDispatchesAndPhysicalHTTP: 'not measured', keeperRequests: 0 }));
  });
  it('reviews one current async Quote receipt and refreshes it after confirmation', async () => {
    ownerBeta.active = true;
    const wallet = `0x${'cd'.repeat(20)}`, f = await fixture('cheap-async', 'history', wallet, 9n, ownerBeta.activation.activatedAt + 900n);
    let nonce = 220;
    f.signer.getNonce.mockImplementation(async () => nonce);
    const rpc = f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve(`0x${nonce.toString(16)}`) : rpc(method, params));
    const issued = await f.quote(); nonce++;
    f.setState(currentCheapDexStages(history).ready);
    const confirm = vi.fn(async () => { expect(f.readReceipt).toHaveBeenCalledTimes(1); return true; });
    const accepted = await f.capability.submitCurrentCheapAcceptance({ issued, confirm });
    expect(accepted).not.toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.readReceipt).toHaveBeenCalledTimes(2);
  });
  it('completes one current normal Fast journey and separates provider call counts', async () => {
    ownerBeta.active = true;
    const wallet = `0x${'cd'.repeat(20)}`, f = await fixture('fast-pool', 'history', wallet, 9n, ownerBeta.activation.activatedAt + 900n);
    let nonce = 220;
    f.signer.getNonce.mockImplementation(async () => nonce);
    const rpc = f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method, params) => method === 'eth_getTransactionCount' ? Promise.resolve(`0x${nonce.toString(16)}`) : rpc(method, params));
    const counts = () => ({
      walletMethods: { nonce: f.signer.getNonce.mock.calls.length, estimate: f.signer.estimateGas.mock.calls.length,
        encryptedInputs: m.wide.mock.calls.length, send: f.signer.sendUncheckedTransaction.mock.calls.length },
      appSendMethods: Object.fromEntries([...new Set(f.readProvider.send.mock.calls.map(([method]) => method))].sort().map(method =>
        [method, f.readProvider.send.mock.calls.filter(([m]) => m === method).length])),
      appProviderMethods: { transaction: f.readProvider.getTransaction.mock.calls.length, receipt: f.readProvider.getTransactionReceipt.mock.calls.length,
        wait: f.readProvider.waitForTransaction.mock.calls.length, logs: f.readProvider.getLogs.mock.calls.length },
      stubbedGraphCalls: m.graph.mock.calls.length, stubbedOperationCalls: m.operation.mock.calls.length, privateReceiptReads: f.readReceipt.mock.calls.length
    });
    await f.capability.checkCurrentCheapCandidate(); const setup = counts();
    const issued = await f.quote(); const quote = counts(); nonce++;
    const sent = (await f.capability.submitCurrentCheapAcceptance({ issued, confirm: async () => true }))!;
    const result = await sent.recover();
    expect(result.delivery).toMatchObject({ principal: wallet, core: history.core, amounts: f.amounts });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.readReceipt).toHaveBeenCalledTimes(3);
    expect({ setup, quote, completed: counts(), keeperRequests: 0,
      walletRpcDispatches: 'not observable from mocked signer methods', physicalHttp: 'not observable from mocked providers' }).toMatchInlineSnapshot(`
        {
          "completed": {
            "appProviderMethods": {
              "logs": 0,
              "receipt": 4,
              "transaction": 8,
              "wait": 0,
            },
            "appSendMethods": {
              "eth_call": 6,
              "eth_chainId": 10,
              "eth_gasPrice": 7,
              "eth_getBalance": 7,
              "eth_getBlockByNumber": 44,
              "eth_getCode": 7,
              "eth_getTransactionByHash": 5,
              "eth_getTransactionCount": 14,
              "eth_getTransactionReceipt": 5,
            },
            "privateReceiptReads": 3,
            "stubbedGraphCalls": 22,
            "stubbedOperationCalls": 4,
            "walletMethods": {
              "encryptedInputs": 4,
              "estimate": 2,
              "nonce": 6,
              "send": 2,
            },
          },
          "keeperRequests": 0,
          "physicalHttp": "not observable from mocked providers",
          "quote": {
            "appProviderMethods": {
              "logs": 0,
              "receipt": 2,
              "transaction": 3,
              "wait": 0,
            },
            "appSendMethods": {
              "eth_call": 2,
              "eth_chainId": 5,
              "eth_gasPrice": 4,
              "eth_getBalance": 4,
              "eth_getBlockByNumber": 18,
              "eth_getCode": 4,
              "eth_getTransactionByHash": 1,
              "eth_getTransactionCount": 8,
              "eth_getTransactionReceipt": 1,
            },
            "privateReceiptReads": 0,
            "stubbedGraphCalls": 8,
            "stubbedOperationCalls": 0,
            "walletMethods": {
              "encryptedInputs": 4,
              "estimate": 1,
              "nonce": 3,
              "send": 1,
            },
          },
          "setup": {
            "appProviderMethods": {
              "logs": 0,
              "receipt": 0,
              "transaction": 0,
              "wait": 0,
            },
            "appSendMethods": {
              "eth_chainId": 1,
              "eth_gasPrice": 1,
              "eth_getBalance": 1,
              "eth_getBlockByNumber": 4,
              "eth_getCode": 1,
              "eth_getTransactionCount": 2,
            },
            "privateReceiptReads": 0,
            "stubbedGraphCalls": 3,
            "stubbedOperationCalls": 0,
            "walletMethods": {
              "encryptedInputs": 4,
              "estimate": 0,
              "nonce": 0,
              "send": 0,
            },
          },
          "walletRpcDispatches": "not observable from mocked signer methods",
        }
      `);
  });
  it.each(['fast-pool','cheap-async'] as const)('admits a new browser wallet at nonce zero for %s and retains its unknown send',async profile=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture(profile,'history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0x0'):rpc(method,params));
    f.signer.getNonce.mockResolvedValue(0);
    const legacy=ownerBetaLegacy(),legacyBytes=JSON.stringify({budget:legacy,authentication:ownerReloadAuthentication(legacy)});
    f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,legacyBytes);
    await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({owner:getAddress(wallet),graph:history.graph});
    const scope={owner:wallet,graph:history.graph,chainId:7082400n};
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({owner:wallet,version:2,charges:[]});
    f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_NEW_WALLET_BOUNDARY'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('TEST_NEW_WALLET_BOUNDARY');
    const bytes=f.values.get(currentDexNormalUseReloadKey(scope));
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget.charges).toMatchObject([{phase:'quote',nonce:0,hash:null}]);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.values.get(currentDexNormalUseReloadKey(scope))).toBe(bytes);
    expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(legacyBytes);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  // CW-086, decision-033: a wallet rejection by code with no hash is released after the chain nonce check.
  it.each(['fast-pool','cheap-async'] as const)('releases a wallet-rejected Quote for %s and permits the same Quote again',async profile=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture(profile,'history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0x0'):rpc(method,params));
    f.signer.getNonce.mockResolvedValue(0);
    await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({owner:getAddress(wallet),graph:history.graph});
    const scope={owner:wallet,graph:history.graph,chainId:7082400n};
    const rejection=Object.assign(new Error('user rejected action'),{code:'ACTION_REJECTED',info:{error:{code:4001,message:'User rejected the request.'}}});
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(rejection);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toBe(rejection);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({version:2,activeSwap:null,committedWei:'0',charges:[],
      released:[{phase:'quote',nonce:0,hash:null}]});
    // The release sent nothing. The same reviewed Quote reserves the same nonce again.
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(new Error('TEST_UNKNOWN_SECOND_SEND'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('TEST_UNKNOWN_SECOND_SEND');
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({charges:[{phase:'quote',nonce:0,hash:null}],
      released:[{phase:'quote',nonce:0,hash:null}]});
    // An unknown wallet result keeps the lock, as before.
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(2);
  });
  it('releases a wallet-rejected swap approval with its owner-record reservation and permits a new approval',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    f.capability=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history',sessionOnboardInfo:{[wallet]:{aesKey:'11'.repeat(16)}}} as never);
    const policy=resolveCurrentSharedTokenDistribution('cheap-history');
    const states=CURRENT_SHARED_DEX_TOKENS.map(t=>({...t,balance:100n,allowance:0n,encryptionAddress:wallet,claimed:true,quota:100n,nextClaimAt:0n,
      initialAmount:policy.initialAmount,refillAmount:policy.refillAmount,initialClaimAvailability:'claimed' as const,refillAvailability:'ready' as const}));
    vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async({head})=>({owner:wallet,head,core:history.core,graph:history.graph,
      packageSha256:history.packageSha256,vault:policy.vault,privateFundsVerified:true,readyToSign:false,tokens:states.map(t=>({...t}))}));
    m.wide.mockImplementation(async(_signer,amount)=>({ciphertext:{ciphertextHigh:amount,ciphertextLow:0n},signature}));
    f.setFunding(100n,0n);f.signer.estimateGas.mockResolvedValue(800_000n);f.signer.getNonce.mockResolvedValue(0);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation(async(method,params)=>{
      if(method==='eth_getTransactionCount')return '0x0';
      const result=await rpc(method,params);
      if(method==='eth_getBlockByNumber')return {...result as Extract<typeof result,{gasLimit:unknown}>,timestamp:`0x${Math.floor(f.clock()/1000).toString(16)}`};
      return result;
    });
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    const request={token:f.prepared.intent.inputToken,amount:20n,preparedQuote:f.prepared,assertReviewCurrent:async()=>{},confirm:async()=>true};
    const prepared=(await f.capability.prepareSharedSwapApproval(request))!;
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(rejection);
    await expect(f.capability.submitSharedSwapApproval(prepared)).rejects.toBe(rejection);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({version:2,activeSwap:null,committedWei:'0',charges:[],
      released:[{phase:'token-funding',nonce:0,hash:null}]});
    expect(states[0].allowance).toBe(0n);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    // An unknown wallet result for the next approval keeps the lock and its reservation.
    const again=(await f.capability.prepareSharedSwapApproval(request))!;
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(new Error('TEST_UNKNOWN_APPROVAL_SEND'));
    await expect(f.capability.submitSharedSwapApproval(again)).rejects.toThrow('TEST_UNKNOWN_APPROVAL_SEND');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({phase:'token-approve',nonce:0,txHash:null});
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({charges:[{phase:'token-funding',nonce:0,hash:null}],
      released:[{phase:'token-funding',nonce:0,hash:null}]});
  });
  it('keeps a rejected Quote locked while its nonce is pending and releases it on a later state check',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    const rpc=f.readProvider.send.getMockImplementation()!;let pendingNonce='0x0';
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve(params[1]==='pending'?pendingNonce:'0x0'):rpc(method,params));
    f.signer.getNonce.mockResolvedValue(0);
    await f.capability.checkCurrentCheapCandidate();
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    f.signer.sendUncheckedTransaction.mockImplementationOnce(async()=>{pendingNonce='0x1';throw rejection;});
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toBe(rejection);
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({phase:'quote',nonce:0,txHash:null,walletRejected:true});
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({charges:[{phase:'quote',nonce:0,hash:null}]});
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).rejects.toThrow('nonce');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({txHash:null,walletRejected:true});
    pendingNonce='0x0';
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({status:'released-unsent',phase:'quote',nonce:0,readyToSign:false});
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({activeSwap:null,charges:[],released:[{phase:'quote',nonce:0,hash:null}]});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  // CW-086 parts B and C: with shared records, another tab can change the owner record. A tab whose record in
  // memory differs from the saved record must not send and must not overwrite the saved record.
  it('does not send or overwrite when the saved owner record differs from the record in memory',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0x0'):rpc(method,params));
    f.signer.getNonce.mockResolvedValue(0);
    await f.capability.checkCurrentCheapCandidate();
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},key=currentDexNormalUseReloadKey(scope);
    const rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(rejection);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toBe(rejection);
    const mine=readCurrentDexNativeReload(window.sessionStorage,scope)!;
    expect(mine.budget.released).toHaveLength(1);
    // Another tab saved a different authentic record of this wallet: here, the same checkpoint with no released row.
    const other={version:2 as const,owner:mine.budget.owner,candidateGraph:mine.budget.candidateGraph,start:mine.budget.start,committedWei:'0',activeSwap:null,charges:[]};
    const hmac=await crypto.subtle.importKey('raw',Uint8Array.from({length:16},()=>0x11),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const bytes=new TextEncoder().encode(`ChainWhisper:7b67:owner-normal-use:v2:7082400:${wallet}:`+JSON.stringify(other));
    const authentication=`0x${[...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
    const shared=JSON.stringify({budget:other,authentication});
    f.values.set(key,shared);
    // A new adapter instance of the same wallet session keeps the record in memory, as a tab does.
    f.capability=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history',sessionOnboardInfo:{[wallet]:{aesKey:'11'.repeat(16)}}} as never);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('Reload this tab');
    expect(f.values.get(key)).toBe(shared);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('stops an Accept at admission when another tab changed the saved owner record',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    let nonce=220;
    f.signer.getNonce.mockImplementation(async()=>nonce);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve(`0x${nonce.toString(16)}`):rpc(method,params));
    await f.capability.checkCurrentCheapCandidate();
    const issued=await f.quote();nonce++;
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},key=currentDexNormalUseReloadKey(scope);
    const mine=readCurrentDexNativeReload(window.sessionStorage,scope)!,quote=mine.budget.charges[0];
    // Another tab restored the same Quote, and the wallet rejected its Accept. That tab saved the released reservation.
    const other={...mine.budget,released:[{...quote,phase:'accept' as const,nonce:221,hash:null,key:`accept:${quote.scope}`,gasCap:'35000000'}]};
    const hmac=await crypto.subtle.importKey('raw',Uint8Array.from({length:16},()=>0x11),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const bytes=new TextEncoder().encode(`ChainWhisper:7b67:owner-normal-use:v2:7082400:${wallet}:`+JSON.stringify(other));
    const authentication=`0x${[...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
    const shared=JSON.stringify({budget:other,authentication});
    f.values.set(key,shared);
    const sends=f.signer.sendUncheckedTransaction.mock.calls.length;
    await expect(f.capability.submitCurrentCheapAcceptance({issued,confirm:async()=>true})).rejects.toThrow('Reload this tab');
    expect(f.values.get(key)).toBe(shared);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends);
  });
  it('releases a wallet-rejected Fast Accept and completes the same Accept on the next request',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    let nonce=220;
    f.signer.getNonce.mockImplementation(async()=>nonce);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve(`0x${nonce.toString(16)}`):rpc(method,params));
    await f.capability.checkCurrentCheapCandidate();
    const issued=await f.quote();nonce++;
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},quoteScope=`quote:${keccak256(f.prepared.data)}`;
    const rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(rejection);
    await expect(f.capability.submitCurrentCheapAcceptance({issued,confirm:async()=>true})).rejects.toBe(rejection);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({activeSwap:quoteScope,
      charges:[{phase:'quote',nonce:220}],released:[{phase:'accept',nonce:221,hash:null}]});
    const sent=(await f.capability.submitCurrentCheapAcceptance({issued,confirm:async()=>true}))!;
    const result=await sent.recover();
    expect(result.delivery).toMatchObject({principal:wallet,core:history.core,amounts:f.amounts});
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({
      charges:[{phase:'quote',nonce:220},{phase:'accept',nonce:221}],released:[{phase:'accept',nonce:221,hash:null}]});
  });
  it.each(['cancel','recover'] as const)('releases a wallet-rejected %s and permits the same owner action again',async action=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('cheap-async','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    let nonce=220;
    f.signer.getNonce.mockImplementation(async()=>nonce);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve(`0x${nonce.toString(16)}`):rpc(method,params));
    await f.capability.checkCurrentCheapCandidate();
    const issued=await f.quote();nonce++;
    if(action==='recover')f.setState(6);
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},quoteScope=`quote:${keccak256(f.prepared.data)}`;
    const rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    const sends=f.signer.sendUncheckedTransaction.mock.calls.length;
    f.signer.sendUncheckedTransaction.mockRejectedValueOnce(rejection);
    await expect(f.capability.submitCurrentCheapOwnerAction({issued,action,confirm:async()=>true})).rejects.toBe(rejection);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({activeSwap:quoteScope,
      charges:[{phase:'quote',nonce:220}],released:[{phase:action,nonce:221,hash:null}]});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends+1);
    // The release sent nothing. The same owner action reserves the same nonce again.
    await f.capability.submitCurrentCheapOwnerAction({issued,action,confirm:async()=>true});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(sends+2);
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({phase:action,nonce:221});
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({
      charges:[{phase:'quote',nonce:220},{phase:action,nonce:221}],released:[{phase:action,nonce:221,hash:null}]});
  });
  it.each(['locked','changed'] as const)('keeps a rejected Quote locked while privacy is %s, and releases it after the privacy key returns',async privacy=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,9n,ownerBeta.activation.activatedAt+900n);
    const rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0x0'):rpc(method,params));
    f.signer.getNonce.mockResolvedValue(0);
    await f.capability.checkCurrentCheapCandidate();
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},rejection=Object.assign(new Error('User rejected the request.'),{code:4001});
    const unlocked=f.signer.getUserOnboardInfo;
    f.signer.sendUncheckedTransaction.mockImplementationOnce(async()=>{
      f.signer.getUserOnboardInfo=()=>({aesKey:privacy==='locked'?'':'22'.repeat(16)});throw rejection;});
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toBe(rejection);
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({phase:'quote',nonce:0,txHash:null,walletRejected:true});
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).rejects.toThrow(privacy==='locked'?'Unlock owner privacy':'authentication failed');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({txHash:null,walletRejected:true});
    f.signer.getUserOnboardInfo=unlocked;
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({charges:[{phase:'quote',nonce:0,hash:null}]});
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget.released).toBeUndefined();
    await expect(f.capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({status:'released-unsent',phase:'quote',nonce:0,readyToSign:false});
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexNativeReload(window.sessionStorage,scope)?.budget).toMatchObject({activeSwap:null,charges:[],released:[{phase:'quote',nonce:0,hash:null}]});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each(['unbranded','session','privacy','authentication','candidate','pending','blocked','lookup','accept','consumed','context','canonical','pending-nonce','nonce-race','record-race','write-failed'] as const)('retains a Fast Quote and makes no send when local discard has %s uncertainty',async fault=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,11n,ownerBeta.activation.activatedAt+900n);
    f.signer.getNonce.mockResolvedValue(220);const issued=await f.quote(),rpc=f.readProvider.send.getMockImplementation()!;
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},key=currentDexNormalUseReloadKey(scope),quoteScope=`quote:${keccak256(f.prepared.data)}`;
    const authenticate=(budget:ReturnType<typeof currentNativeSwapCheckpoint>)=>`0x${createHmac('sha256',Buffer.from('11'.repeat(16),'hex')).update(`ChainWhisper:7b67:owner-normal-use:v2:7082400:${wallet}:`+JSON.stringify(budget)).digest('hex')}`;
    let nonceReads=0,raced=false;
    f.readProvider.send.mockImplementation((method,params)=>{
      if(method==='eth_getTransactionCount'){
        nonceReads++;
        return Promise.resolve(fault==='pending-nonce'&&params[1]==='pending'||fault==='nonce-race'&&nonceReads>2?'0xde':'0xdd');
      }
      if(fault==='record-race'&&!raced&&method==='eth_getTransactionByHash'){
        raced=true;const record=JSON.parse(f.values.get(key)!);f.values.set(key,JSON.stringify({...record,authentication:zero}));
      }
      return rpc(method,params);
    });
    if(fault==='session')f.revoke();
    if(fault==='privacy')f.signer.getUserOnboardInfo=()=>({aesKey:'22'.repeat(16)});
    if(fault==='authentication'||fault==='candidate'){
      const record=JSON.parse(f.values.get(key)!);f.values.set(key,JSON.stringify(fault==='authentication'?{...record,authentication:zero}:{...record,budget:{...record.budget,candidateGraph:'f'.repeat(64)}}));
    }
    const attempt={version:1 as const,chainId:'7082400',owner:wallet,core:history.core,graph:`0x${history.graph}`,phase:'accept' as const,callHash:keccak256(f.prepared.data),nonce:221,txHash:null,...(fault==='blocked'?{verificationBlocked:true as const}:{})};
    if(fault==='pending'||fault==='blocked')f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify(attempt));
    if(fault==='lookup')recordCurrentDexOperationLookup(window.sessionStorage,{attempt:{...attempt,txHash:`0x${'ab'.repeat(32)}`},operationId:'11',contextHash:context,deadline:String(issued.intent.deadline),origin:{number:50,hash:blockHash}});
    if(fault==='accept'){
      currentNativeSigningBudget(f.signer,wallet,()=>ownerBeta.activation.activatedAt,history).commit('accept',`accept:${quoteScope}`,110_000_000n,quoteScope,221);
      const budget=currentNativeSwapCheckpoint(f.signer);writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:authenticate(budget)},scope);
    }
    if(fault==='consumed')f.setState(0);
    if(fault==='context')f.setState(currentCheapDexStages(history).ready,`0x${'af'.repeat(32)}`);
    if(fault==='canonical')f.transactions.get(issued.transactionHash)!.gasLimit=1n;
    if(fault==='write-failed')vi.spyOn(window.sessionStorage,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError');});
    const live=currentNativeSwapCheckpoint(f.signer),bytes=f.values.get(key),pendingBytes=f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY),lookupBytes=f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    f.signer.sendUncheckedTransaction.mockClear();f.signer.estimateGas.mockClear();
    await expect(f.capability.discardCurrentFastQuote(fault==='unbranded'?{...issued}:issued)).rejects.toThrow();
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual(live);
    if(fault!=='record-race')expect(f.values.get(key)).toBe(bytes);
    else expect(JSON.parse(f.values.get(key)!).budget).toEqual(live);
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(pendingBytes);expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(lookupBytes);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();
  });
  it('rejects local discard for an asynchronous Quote without clearing its accounting',async()=>{
    ownerBeta.active=true;const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('cheap-async','history',wallet,11n,ownerBeta.activation.activatedAt+900n);
    f.signer.getNonce.mockResolvedValue(220);const issued=await f.quote(),before=currentNativeSwapCheckpoint(f.signer);f.signer.sendUncheckedTransaction.mockClear();
    await expect(f.capability.discardCurrentFastQuote(issued)).rejects.toThrow('Fast Quote');expect(currentNativeSwapCheckpoint(f.signer)).toEqual(before);expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('discards an expired still-ready unfunded Fast Quote without a signing request',async()=>{
    ownerBeta.active=true;const wallet=`0x${'cd'.repeat(20)}`,deadline=ownerBeta.activation.activatedAt+900n,f=await fixture('fast-pool','history',wallet,11n,deadline);
    f.signer.getNonce.mockResolvedValue(220);const issued=await f.quote(),rpc=f.readProvider.send.getMockImplementation()!;
    f.clock.mockReturnValue(Number(deadline+1n)*1000);
    f.readProvider.send.mockImplementation(async(method,params)=>{
      if(method==='eth_getTransactionCount')return '0xdd';
      const value=await rpc(method,params);
      if(method==='eth_getBlockByNumber'&&typeof value==='object'&&value!==null&&value.timestamp!==undefined)return {...value,timestamp:`0x${(deadline+1n).toString(16)}`};
      return value;
    });
    const before=currentNativeSwapCheckpoint(f.signer);f.signer.sendUncheckedTransaction.mockClear();
    await f.capability.discardCurrentFastQuote(issued);expect(currentNativeSwapCheckpoint(f.signer)).toEqual({...before,activeSwap:null});expect(f.capability.readCurrentCheapRestoreHint()).toBeNull();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('rejects explicit old-hash restoration of a discarded Fast Quote after a fresh signer reload',async()=>{
    ownerBeta.active=true;const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,11n,ownerBeta.activation.activatedAt+900n);
    f.signer.getNonce.mockResolvedValue(220);const issued=await f.quote(),rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0xdd'):rpc(method,params));
    await f.capability.discardCurrentFastQuote(issued);
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},bytes=f.values.get(currentDexNormalUseReloadKey(scope)),signer={...f.signer};
    bindCurrentDexBrowserSigner(signer,wallet,7082400n,()=>{});
    m.owner.mockImplementation(async args=>args.bindCapability({assertCurrent:async()=>{},assertSnapshotCurrent:()=>{},signer,readProvider:f.readProvider,ownerAddress:wallet,chainId:7082400n}));
    const sender=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history'} as never);
    expect(sender.readCurrentCheapRestoreHint()).toBeNull();
    m.decrypt.mockReturnValueOnce(20n).mockReturnValueOnce(5n).mockReturnValueOnce(1n);
    const quoteCapability=await issueCurrentDexQuoteCapability({} as never),restored=await quoteCapability.restoreCurrentQuote({quoteHash:issued.transactionHash});
    f.signer.sendUncheckedTransaction.mockClear();f.signer.estimateGas.mockClear();
    await expect(sender.restoreCurrentCheapOperation(restored)).rejects.toThrow('closed without funding');
    expect(hasCurrentNativeSigningBudget(signer)).toBe(false);expect(f.values.get(currentDexNormalUseReloadKey(scope))).toBe(bytes);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();
  });
  it('discards a confirmed ready Fast Quote locally, retains all fees, and blocks old Accept and restore hints',async()=>{
    ownerBeta.active=true;
    const wallet=`0x${'cd'.repeat(20)}`,f=await fixture('fast-pool','history',wallet,11n,ownerBeta.activation.activatedAt+900n);
    f.signer.getNonce.mockResolvedValue(220);
    const issued=await f.quote(),rpc=f.readProvider.send.getMockImplementation()!;
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0xdd'):rpc(method,params));
    const scope={owner:wallet,graph:history.graph,chainId:7082400n},before=readCurrentDexNativeReload(window.sessionStorage,scope)!;
    f.signer.sendUncheckedTransaction.mockClear();f.signer.estimateGas.mockClear();
    await f.capability.discardCurrentFastQuote(issued);
    const after=readCurrentDexNativeReload(window.sessionStorage,scope)!;
    expect(after.budget).toEqual({...before.budget,activeSwap:null});
    expect(currentNativeSwapCheckpoint(f.signer)).toEqual(after.budget);
    expect(f.capability.readCurrentCheapRestoreHint()).toBeNull();
    const reload=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history'} as never);
    expect(reload.readCurrentCheapRestoreHint()).toBeNull();
    const confirm=vi.fn(async()=>true);
    await expect(reload.submitCurrentCheapAcceptance({issued,confirm})).rejects.toThrow('no longer active');
    expect(confirm).not.toHaveBeenCalled();expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();
    const quoteCapability=await issueCurrentDexQuoteCapability({} as never);
    m.wide.mockResolvedValue({ciphertext:{ciphertextHigh:5n,ciphertextLow:6n},signature});
    const next=(await quoteCapability.prepareCurrentQuote({profile:'fast-pool',graph:{candidate:'cheap-history',expectedGraph:history.graph,expectedPackageSha256:history.packageSha256,blockNumber:55n,blockHash},
      terms:{...f.prepared.intent,maximumInput:21n},confirmPrivateInputs:async()=>true}))!;
    f.setFunding(100n,21n);f.signer.getNonce.mockResolvedValue(221);f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_NEW_QUOTE_WALLET_BOUNDARY'));
    await expect(reload.submitCurrentCheapQuote(next)).rejects.toThrow('TEST_NEW_QUOTE_WALLET_BOUNDARY');
    const renewed=currentNativeSwapCheckpoint(f.signer);expect(renewed.charges.slice(0,before.budget.charges.length)).toEqual(before.budget.charges);expect(renewed.charges).toHaveLength(before.budget.charges.length+1);expect(renewed.activeSwap).toBe(`quote:${keccak256(next.data)}`);
  });
  it.each(['valid','wrong-hmac'] as const)('global historical v2 record: %s',async state=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    const legacy=ownerBetaLegacy();
    expect(currentOwnerBetaLegacyReservationHash(legacy)).not.toBe('0x8fc3d42c0f418a860455579df8cb8fde8bafc069e6065a35046713bedb5e4567');
    const budget={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:CURRENT_OWNER_BETA.graph,start:'1792452366',committedWei:'0',activeSwap:null,charges:[]};
    writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:state==='valid'?ownerReloadAuthentication(budget):zero});
    const before=f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    if(state==='valid'){
      await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({graph:history.graph});
      expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget).toMatchObject({version:2,candidateGraph:history.graph,charges:[]});
    }else{
      await expect(f.capability.checkCurrentCheapCandidate()).rejects.toThrow('authentication');
      expect(f.values.has(currentDexNormalUseReloadKey(ownerReloadScope))).toBe(false);
    }
    expect(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(before);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it('preserves a closed historical v1 record and writes new charges to a separate current record',async()=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n),legacy=ownerBetaLegacy();
    writeCurrentDexNativeReload(window.sessionStorage,{budget:legacy,authentication:ownerReloadAuthentication(legacy)});
    const before=f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    expect(legacy.candidateGraph).toBe(CURRENT_OWNER_BETA.graph);
    expect(CURRENT_OWNER_BETA.core).toBe('0xa3da6c8d5f9b1566bf965e94966ecba9f1deb758');
    expect(legacy.candidateGraph).not.toBe(history.graph);
    await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({graph:history.graph});
    expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget).toMatchObject({version:2,candidateGraph:history.graph,charges:[]});
    f.signer.getNonce.mockResolvedValue(220);f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_OWNER_WALLET_BOUNDARY'));
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('TEST_OWNER_WALLET_BOUNDARY');
    expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(before);
    expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget.charges).toMatchObject([{phase:'quote',nonce:220,hash:null}]);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow('pending attempt');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each([49n,54n])('runs independent refresh of position %s through the browser owner admission and sender without changing the position49 hold',async positionId=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    await f.capability.checkCurrentCheapCandidate();
    const oldHash=`0x${'ba'.repeat(32)}`,newHash=`0x${'bb'.repeat(32)}`,oldData=currentPoolSnapshotAbi.encodeFunctionData('poolSnapshot',[49n]),data=currentPoolSnapshotAbi.encodeFunctionData('poolSnapshot',[positionId]);
    const log=(hash:string)=>({address:history.core,index:0,transactionHash:hash,blockNumber:50,blockHash,removed:false,
      ...currentPoolSnapshotAbi.encodeEventLog(currentPoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[hash===oldHash?49n:positionId,context,Array.from({length:10},()=>({ciphertextHigh:1n,ciphertextLow:2n}))])});
    f.transactions.set(oldHash,{hash:oldHash,chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:history.core,value:0n,data:oldData,nonce:219,gasLimit:30_000_000n,gasPrice:50_000_000n,blockNumber:50,blockHash});
    f.receipts.set(oldHash,{hash:oldHash,status:1,from:CURRENT_APP_SWAP_OWNER,to:history.core,blockNumber:50,blockHash,logs:[log(oldHash)]});
    const held={version:1,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:history.core,graph:`0x${history.graph}`,phase:'pool-snapshot',callHash:keccak256(oldData),nonce:219,txHash:oldHash,verificationBlocked:true};
    const bytes=JSON.stringify(held);f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,bytes);
    f.signer.getNonce.mockResolvedValue(220);f.signer.estimateGas.mockResolvedValue(1_000_000n);
    f.signer.sendUncheckedTransaction.mockImplementation(async request=>{
      expect(request.nonce).toBe(220);expect(request.data).toBe(data);expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(bytes);
      f.transactions.set(newHash,{...request,hash:newHash,blockNumber:50,blockHash});
      f.receipts.set(newHash,{hash:newHash,status:1,from:CURRENT_APP_SWAP_OWNER,to:history.core,blockNumber:50,blockHash,logs:[log(newHash)]});return newHash;
    });
    const pair=history.pairs[0],pool={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:history.core,value:0n,graph:history.graph,packageSha256:history.packageSha256,
      readyToSign:false,positionId,marketId:pair.marketId,poolTokens:pair.tokens,action:'snapshot',closed:false,data,
      assertCurrent:async()=>{},assertBeforeSend:async()=>{},readResult:async()=>({action:'snapshot',positionId,producerHash:newHash,status:'active-snapshot-verified'})};
    ownerActionBrands.set(pool,f.signer);
    const sent=await f.capability.submitPoolPositionAction(pool as never,undefined,{refreshHeldSnapshot:true});
    expect(await sent.recover()).toMatchObject({status:'active-snapshot-verified',producerHash:newHash});
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(bytes);
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it('continues a verified top-up through browser admission to its final snapshot without repeating funding',async()=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    await f.capability.checkCurrentCheapCandidate();
    const fundingHash=`0x${'ba'.repeat(32)}`,snapshotHash=`0x${'bb'.repeat(32)}`,positionId=53n,
      data=currentPoolSnapshotAbi.encodeFunctionData('poolSnapshot',[positionId]);
    const held={version:1,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:history.core,graph:`0x${history.graph}`,
      phase:'pool-fund',callHash:keccak256('0x1234'),nonce:219,txHash:fundingHash,poolTopUpHash:null};
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify(held));
    f.signer.getNonce.mockResolvedValue(220);f.signer.estimateGas.mockResolvedValue(1_000_000n);
    f.signer.sendUncheckedTransaction.mockImplementation(async request=>{
      expect(request.nonce).toBe(220);expect(request.data).toBe(data);
      f.transactions.set(snapshotHash,{...request,hash:snapshotHash,blockNumber:50,blockHash});
      f.receipts.set(snapshotHash,{hash:snapshotHash,status:1,from:CURRENT_APP_SWAP_OWNER,to:history.core,blockNumber:50,blockHash,
        logs:[{address:history.core,index:0,transactionHash:snapshotHash,blockNumber:50,blockHash,removed:false,
          ...currentPoolSnapshotAbi.encodeEventLog(currentPoolSnapshotAbi.getEvent('PoolSnapshotRefreshed')!,[positionId,context,Array.from({length:10},()=>({ciphertextHigh:1n,ciphertextLow:2n}))])}]});
      return snapshotHash;
    });
    const pair=history.pairs[0],pool={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:history.core,value:0n,graph:history.graph,packageSha256:history.packageSha256,
      readyToSign:false,positionId,marketId:pair.marketId,poolTokens:pair.tokens,action:'snapshot',closed:false,data,
      assertCurrent:async()=>{},assertBeforeSend:async()=>{},readResult:async()=>({action:'snapshot',positionId,producerHash:snapshotHash,status:'active-snapshot-verified'})};
    const topUp={...pool,transactionHash:fundingHash,expectation:{action:'top-up',marketId:pair.marketId},
      verifySnapshot:vi.fn(async()=>({positionId,producerHash:snapshotHash,privateAccountingVerified:true}))};
    ownerActionBrands.set(pool,f.signer);ownerActionBrands.set(topUp,f.signer);
    const sent=await f.capability.submitPoolPositionAction(pool as never,topUp as never);
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({phase:'pool-snapshot',poolTopUpHash:fundingHash,txHash:snapshotHash});
    await expect(f.capability.submitPoolPositionAction(pool as never,topUp as never)).rejects.toThrow();
    expect(await sent.recover()).toMatchObject({producerHash:snapshotHash,poolTopUpHash:fundingHash,privateAccountingVerified:true});
    expect(topUp.verifySnapshot).toHaveBeenCalledWith(snapshotHash);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it.each(['valid','wrong-cap','changed-record','blocked','unknown-send','wrong-owner','wrong-graph','wrong-phase','wrong-link','active','unknown-charge','swap-scope','held-snapshot'] as const)('admits only the exact top-up snapshot handoff: %s',async fault=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    await f.capability.checkCurrentCheapCandidate();
    const held={version:1 as const,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:history.core,graph:`0x${history.graph}`,
      phase:'pool-fund' as const,callHash:keccak256('0x1234'),nonce:219,txHash:`0x${'ab'.repeat(32)}` as string|null,poolTopUpHash:null as string|null};
    if(fault==='blocked')Object.assign(held,{verificationBlocked:true});
    if(fault==='unknown-send')held.txHash=null;
    if(fault==='wrong-owner')held.owner=`0x${'ab'.repeat(20)}`;
    if(fault==='wrong-graph')held.graph=`0x${'ab'.repeat(32)}`;
    if(fault==='wrong-phase')Object.assign(held,{phase:'pool-snapshot'});
    if(fault==='wrong-link')held.poolTopUpHash=`0x${'ac'.repeat(32)}`;
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify(held));
    if(fault==='active'||fault==='unknown-charge'){
      const scope=`quote:0x${'df'.repeat(32)}`;
      const budget={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,start:String(ownerBeta.activation.activatedAt),
        activeSwap:scope,committedWei:'5500000000000000',charges:[{phase:'quote' as const,scope,key:scope,gasCap:'110000000',gasPrice:'50000000',nonce:220,hash:fault==='unknown-charge'?null:`0x${'ab'.repeat(32)}`}]};
      writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:ownerReloadAuthentication(budget)},ownerReloadScope);
    }
    const records=[...f.values];
    const result=f.capability.admitCurrentOwnerNormalRecord(fault==='swap-scope'?'another-swap':undefined,fault==='wrong-cap'?5_000_000n:30_000_000n,
      fault==='held-snapshot'?held:undefined,fault==='changed-record'?{...held,nonce:218}:held);
    if(fault==='valid')await expect(result).resolves.toBeUndefined();else await expect(result).rejects.toThrow();
    expect([...f.values]).toEqual(records);expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['valid','wrong-cap','wrong-record','top-up','active','unknown-charge'] as const)('admits only independent snapshot owner context: %s',async fault=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    await f.capability.checkCurrentCheapCandidate();
    const held={version:1 as const,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:history.core,graph:`0x${history.graph}`,
      phase:'pool-snapshot' as const,callHash:keccak256('0x1234'),nonce:219,txHash:`0x${'ab'.repeat(32)}`,verificationBlocked:true as const};
    if(fault==='top-up')Object.assign(held,{poolTopUpHash:`0x${'ac'.repeat(32)}`});
    const bytes=JSON.stringify(held);f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,bytes);
    if(fault==='active'||fault==='unknown-charge'){
      const scope=`quote:0x${'df'.repeat(32)}`;
      const budget={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,start:String(ownerBeta.activation.activatedAt),
        activeSwap:scope,committedWei:'5500000000000000',charges:[{phase:'quote' as const,scope,key:scope,gasCap:'110000000',gasPrice:'50000000',nonce:220,hash:fault==='unknown-charge'?null:`0x${'ab'.repeat(32)}`}]};
      writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:ownerReloadAuthentication(budget)},ownerReloadScope);
    }
    const records=[...f.values];
    const result=f.capability.admitCurrentOwnerNormalRecord(undefined,fault==='wrong-cap'?5_000_000n:30_000_000n,fault==='wrong-record'?{...held,nonce:218}:held);
    if(fault==='valid')await expect(result).resolves.toBeUndefined();else await expect(result).rejects.toThrow();
    expect([...f.values]).toEqual(records);expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    await expect(f.capability.submitCurrentCheapQuote(f.prepared)).rejects.toThrow();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each(['closed','active','unknown','total','authentication','legacy-conflict','pending','lookup'] as const)('authenticates and holds existing normal-use state: %s',async state=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n),scope=`quote:0x${'df'.repeat(32)}`,
      active=state==='active'||state==='unknown';
    const budget={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,start:String(ownerBeta.activation.activatedAt),
      activeSwap:active?scope:null,committedWei:active?'5500000000000000':state==='total'?'1':'0',charges:active?
        [{phase:'quote' as const,scope,key:scope,gasCap:'110000000',gasPrice:'50000000',nonce:220,hash:state==='unknown'?null:`0x${'ab'.repeat(32)}`}]:[]};
    writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:state==='authentication'?zero:ownerReloadAuthentication(budget)});
    const before=f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    if(state==='legacy-conflict')f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    const attempt={version:1,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,core:history.core,graph:`0x${history.graph}`,
      phase:state==='lookup'?'accept':'quote',callHash:keccak256(f.prepared.data),nonce:220,txHash:state==='lookup'?`0x${'aa'.repeat(32)}`:null};
    if(state==='pending')f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify(attempt));
    if(state==='lookup')f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY,JSON.stringify([{attempt,operationId:'9',contextHash:context,
      deadline:String(ownerBeta.activation.activatedAt+900n),origin:{number:50,hash:blockHash}}]));
    if(state==='closed')await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({graph:history.graph});
    else await expect(f.capability.checkCurrentCheapCandidate()).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(before);
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each((['pool','limit','claim'] as const).flatMap(action=>(['fresh','corrupt','authentication','pending','unknown','active',...(action==='claim'?['small-balance' as const]:[])] as const).map(state=>({action,state}))))('admits direct owner $action first use without Swap preflight: $state',async({action,state})=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    if(state==='corrupt')f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    if(state==='authentication')writeCurrentDexNativeReload(window.sessionStorage,{budget:ownerBetaLegacy(),authentication:zero});
    if(state==='pending')f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:'7082400',owner:CURRENT_APP_SWAP_OWNER,
      core:history.core,graph:`0x${history.graph}`,phase:'quote',callHash:keccak256(f.prepared.data),nonce:220,txHash:null}));
    if(state==='unknown'||state==='active'){
      const scope=`quote:0x${'cf'.repeat(32)}`,budget={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,
        start:String(ownerBeta.activation.activatedAt),activeSwap:scope,committedWei:'5500000000000000',charges:[{phase:'quote' as const,
          scope,key:scope,gasCap:'110000000',gasPrice:'50000000',nonce:220,hash:state==='unknown'?null:`0x${'ab'.repeat(32)}`} ]};
      writeCurrentDexNativeReload(window.sessionStorage,{budget,authentication:ownerReloadAuthentication(budget)});
    }
    const before=f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
    if(state==='small-balance'){
      const rpc=f.readProvider.send.getMockImplementation()!;
      f.readProvider.send.mockImplementation((method,params)=>method==='eth_getBalance'?Promise.resolve(`0x${11_000_000_000_000_000n.toString(16)}`):rpc(method,params));
    }
    f.signer.getNonce.mockResolvedValue(220);
    f.signer.estimateGas.mockResolvedValue(1_000_000n);
    f.signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_OWNER_WALLET_BOUNDARY'));
    const pair=history.pairs[0],base={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:history.core,value:0n,graph:history.graph,
      packageSha256:history.packageSha256,readyToSign:false,positionId:20n,marketId:pair.marketId,poolTokens:pair.tokens,
      assertCurrent:async()=>{},assertAuthority:async()=>{},assertBeforeSend:async()=>{},readResult:async()=>null};
    const pool={...base,action:'snapshot',closed:false,data:currentPoolSnapshotAbi.encodeFunctionData('poolSnapshot',[20n])};
    const limit={...base,phase:'limit-snapshot',data:currentLimitAbiForCandidate('cheap-history').encodeFunctionData('privateOrderSnapshot',[20n])};
    ownerActionBrands.set(pool,f.signer);ownerActionBrands.set(limit,f.signer);
    const execute=action==='pool'?()=>f.capability.submitPoolPositionAction(pool as never):
      action==='limit'?()=>f.capability.submitLimit(limit as never):async()=>{
        const policy=resolveCurrentSharedTokenDistribution('cheap-history');
        vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async({head})=>({owner:CURRENT_APP_SWAP_OWNER,head,
          core:history.core,graph:history.graph,packageSha256:history.packageSha256,vault:policy.vault,privateFundsVerified:true,readyToSign:false,
          tokens:history.tokenMetadata.map(token=>({...token,claimed:false,balance:0n,allowance:0n,encryptionAddress:CURRENT_APP_SWAP_OWNER,
            quota:policy.initialQuota,nextClaimAt:0n,initialAmount:policy.initialAmount,refillAmount:policy.refillAmount,
            initialClaimAvailability:'ready',refillAvailability:'initial-claim-required'}))} as never));
        const cap=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history',
          sessionOnboardInfo:{[CURRENT_APP_SWAP_OWNER]:{aesKey:'11'.repeat(16)}}} as never);
        const review=await cap.prepareSharedTokenFunding({action:'initial',token:history.tokenMetadata[3].address,confirm:async()=>true});
        return cap.submitSharedTokenFunding(review!);
      };
    const admitted=state==='fresh'||state==='small-balance';
    await expect(execute()).rejects.toThrow(admitted?'TEST_OWNER_WALLET_BOUNDARY':state==='authentication'?'authentication':state==='pending'?'pending':state==='unknown'||state==='active'?'active':'invalid');
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(admitted?1:0);
    if(admitted){
      expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget).toMatchObject({version:2,charges:[],committedWei:'0'});
      expect(f.values.has(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(false);
    }else expect(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(before);
  });
  it.each(['missing', 'incomplete', 'valid', 'corrupt', 'authentication', 'active', 'pending', 'lookup', 'write-failed'] as const)('checks owner reload records before private-input preparation: %s', async state => {
    ownerBeta.active = true;
    const f = await fixture('fast-pool', 'history', CURRENT_APP_SWAP_OWNER, 9n, ownerBeta.activation.activatedAt + 900n);
    const legacy = ownerBetaLegacy();
    if (!['missing','pending','lookup','write-failed'].includes(state)) {
      const budget=state==='incomplete'?{...legacy,charges:legacy.charges.slice(0,11)}:
        state==='active'?{...legacy,activeSwap:legacy.charges[13].scope}:legacy;
      const authentication=ownerReloadAuthentication(budget);
      writeCurrentDexNativeReload(window.sessionStorage, {budget,authentication:state==='authentication'?zero:authentication});
    }
    const retained=f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    if(state==='corrupt')f.values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    if(state==='pending')f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,'{bad');
    if(state==='lookup')f.values.set(CURRENT_DEX_OPERATION_LOOKUPS_KEY,'{bad');
    if(state==='write-failed')vi.spyOn(window.sessionStorage,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError');});
    m.wide.mockClear(); f.readProvider.send.mockClear();
    if (state === 'valid'||state==='missing') {
      await expect(f.capability.checkCurrentCheapCandidate()).resolves.toMatchObject({ graph: history.graph });
      expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget).toMatchObject({version:2,charges:[],committedWei:'0',activeSwap:null});
      expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(retained);
    }
    else {
      await expect(f.capability.checkCurrentCheapCandidate()).rejects.toThrow();
      expect(f.values.has(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)).toBe(false);
    }
    expect(m.wide).not.toHaveBeenCalled();
    expect(f.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
  it.each((['fast-pool','cheap-async'] as const).flatMap(profile=>[false,true].flatMap(approval=>[false,true].map(normal=>({profile,approval,normal})))) )('keeps exact charges and a durable no-resend lock for owner $profile Quote, approval:$approval normal:$normal', async ({profile,approval,normal}) => {
    ownerBeta.active=true;
    const f=await fixture(profile,'history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n),legacy=ownerBetaLegacy();
    if(!normal)writeCurrentDexNativeReload(window.sessionStorage,{budget:legacy,authentication:ownerReloadAuthentication(legacy)});
    const legacyBytes=f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    await f.capability.checkCurrentCheapCandidate();
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
    const saved=readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!;
    if(!normal)expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(legacyBytes);
    expect(saved.budget.charges[approval?1:0]).toMatchObject({phase:'quote',nonce,gasPrice:'50000000',hash:null});
    expect(saved.budget.committedWei).toBe(String((110_000_000n+(approval?5_000_000n:0n))*50_000_000n));
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
    if(['allowed','early','expired','nonce'].includes(fault))writeCurrentDexNativeReload(storage,{budget:{version:2,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,start:String(ownerBeta.activation.activatedAt),committedWei:'0',activeSwap:null,charges:[]},authentication:zero},ownerReloadScope);
    if(fault==='legacy-scope'){
      const saved=readCurrentDexNativeReload(storage)!,scope=`quote:0x${'e'.repeat(64)}`;
      writeCurrentDexNativeReload(storage,{...saved,budget:{...saved.budget,charges:saved.budget.charges.map((row,i)=>i===0?{...row,scope,key:`token-funding:${scope}:0x${'a'.repeat(64)}`}:row)}});
    }
    if(fault==='corrupt')values.set(CURRENT_DEX_NATIVE_RELOAD_KEY,'{bad');
    if(fault==='pending')values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,'{bad');
    const now=ownerBeta.activation.activatedAt+(fault==='early'?-1n:fault==='expired'?604800n:0n),nonce=fault==='nonce'?10_000:220;
    const head={number:55n,hash:blockHash,timestamp:now,gasLimit:120_000_000n};
    const send=vi.fn(async()=>{throw new Error('TEST_OWNER_WALLET_BOUNDARY');});
    const transport={assertCurrent:async()=>{},admitOwnerRecord:async()=>{},readHead:async()=>head,readNonce:async()=>nonce,estimateGas:async()=>1_000_000n,send,
      readNativeResources:async()=>({owner:CURRENT_APP_SWAP_OWNER,chainId:7082400n,head,latestNonce:nonce,pendingNonce:nonce,gasPrice:50_000_000n,baseFeePerGas:50_000_000n,code:'0x',balance:1_000_000_000_000_000_000n})} as unknown as CurrentTransport;
    const boundary=createCurrentAttemptBoundary({storage,c:history,core:history.core,owner:CURRENT_APP_SWAP_OWNER,chainId:7082400n,transport,attest:async()=>{},now:()=>now,historical:false,bindTarget:true});
    const token=history.tokenMetadata[3].address,call={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:token,value:0n as const,data:new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet')};
    const signer={};bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    const execute=()=>boundary.sendCurrent('token-faucet',call,undefined,()=>{},()=>{},undefined,5_000_000n,undefined,undefined,undefined,undefined,undefined,{action:'initial',token,signer});
    const admitted=['allowed','early','expired','nonce'].includes(fault);
    await expect(execute()).rejects.toThrow(admitted?'TEST_OWNER_WALLET_BOUNDARY':fault==='missing'||fault==='legacy-scope'?'retained':fault==='corrupt'?'invalid':fault==='pending'?'invalid':'check failed');
    expect(send).toHaveBeenCalledTimes(admitted?1:0);
    if(admitted){
      expect(JSON.parse(values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({nonce,txHash:null});
      await expect(execute()).rejects.toThrow('pending attempt');
      expect(send).toHaveBeenCalledOnce();
    }
  });
  it.each((['valid','authentication','allowance'] as const).flatMap(fault=>[false,true].map(normal=>({fault,normal}))))('restores an unquoted beta approval after wallet reload: $fault normal:$normal',async ({fault,normal})=>{
    ownerBeta.active=true;
    const f=await fixture('fast-pool','history',CURRENT_APP_SWAP_OWNER,9n,ownerBeta.activation.activatedAt+900n);
    if(!normal){const legacy=ownerBetaLegacy();writeCurrentDexNativeReload(window.sessionStorage,{budget:legacy,authentication:ownerReloadAuthentication(legacy)});}
    const legacyBytes=f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY);
    await f.capability.checkCurrentCheapCandidate();
    f.setFunding(100n,0n);
    const data=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']).encodeFunctionData('approve',[history.core,{ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature}]);
    const request={chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,to:f.prepared.intent.inputToken,value:0n as const,data,nonce:220,gasLimit:5_000_000n,gasPrice:50_000_000n},hash=`0x${'de'.repeat(32)}`;
    await f.capability.authorizeCurrentCheapSwapApproval(f.prepared,request);
    f.transactions.set(hash,{...request,hash,blockNumber:50,blockHash});
    f.receipts.set(hash,{hash,status:1,from:request.from,to:request.to,blockNumber:50,blockHash,logs:[]});
    await f.capability.rememberCurrentCheapSwapApproval({request,transactionHash:hash});
    // Simulate the pre-scope v2 browser journal with confirmed, unquoted funding still active.
    if(normal&&fault==='valid'){
      const scoped=currentDexNormalUseReloadKey(ownerReloadScope),bytes=f.values.get(scoped)!;
      f.values.set(CURRENT_DEX_NORMAL_USE_RELOAD_KEY,bytes);f.values.delete(scoped);
    }
    const saved=readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!;
    if(fault==='authentication')writeCurrentDexNativeReload(window.sessionStorage,{...saved,authentication:zero},ownerReloadScope);
    f.setFunding(100n,fault==='allowance'?21n:20n);
    const signer={...f.signer};bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});const rpc=f.readProvider.send.getMockImplementation()!;
    signer.getNonce.mockResolvedValue(221);
    f.readProvider.send.mockImplementation((method,params)=>method==='eth_getTransactionCount'?Promise.resolve('0xdd'):rpc(method,params));
    m.owner.mockImplementation(async args=>args.bindCapability({assertCurrent:async()=>{},assertSnapshotCurrent:()=>{},signer,readProvider:f.readProvider,ownerAddress:CURRENT_APP_SWAP_OWNER,chainId:7082400n}));
    const capability=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-history'} as never);
    if(fault==='valid')await expect(capability.checkCurrentCheapCandidate()).resolves.toMatchObject({graph:history.graph});
    const quotes=await issueCurrentDexQuoteCapability({} as never);
    const fresh=(await quotes.prepareCurrentQuote({profile:'cheap-async',graph:{candidate:'cheap-history',expectedGraph:history.graph,expectedPackageSha256:history.packageSha256,blockNumber:55n,blockHash},
      terms:{...f.prepared.intent,deadline:ownerBeta.activation.activatedAt+899n},confirmPrivateInputs:async()=>true}))!;
    signer.sendUncheckedTransaction.mockRejectedValue(new Error('TEST_OWNER_WALLET_BOUNDARY'));
    await expect(capability.submitCurrentCheapQuote(fresh)).rejects.toThrow(fault==='authentication'?'authenticated':'TEST_OWNER_WALLET_BOUNDARY');
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledTimes(fault==='authentication'?0:1);
    expect(readCurrentDexNativeReload(window.sessionStorage,ownerReloadScope)!.budget.charges.slice(0,saved.budget.charges.length)).toEqual(saved.budget.charges);
    if(!normal)expect(f.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(legacyBytes);
    if(normal&&fault==='valid'){expect(f.values.has(currentDexNormalUseReloadKey(ownerReloadScope))).toBe(false);expect(JSON.parse(f.values.get(CURRENT_DEX_NORMAL_USE_RELOAD_KEY)!).budget.charges).toHaveLength(saved.budget.charges.length+1);}
  });
});
