// CW-140.06: the shared DEX send boundary (saved-action record, nonce and resource checks, signing, mined
// receipt checks, unsent release). Pool, Limit, token funding and swap sending all use it. Moved unchanged
// from currentDexSubmission.ts.
import { isCurrentDexBrowserSigner, assertCurrentDexBrowserWindow } from './currentDexBrowserPolicy';
import { assertCurrentNativeSwapIntent, currentNativeSwapCheckpoint, validateCurrentNativeSwapCheckpoint, hasCurrentNativeSigningBudget } from './currentDexNativeSwapPolicy';
import { assertCurrentD06AppAuthority, assertCurrentAppInitialClaimAuthority, assertCurrentAppSharedFundingAuthority, assertCurrentAppLimitAuthority, assertCurrentAppPoolAuthority, assertCurrentAppPoolAllowanceCleanupAuthority, hasCurrentHistoryReplacementProof, hasCurrentHistoryFastProof } from './currentDexC1SwapPolicy';
import { assertCurrentPoolFundingPrepared, type CurrentPoolPreparedPreview, type CurrentPoolPreparedFunding, type CurrentPoolPreparedTopUpPreview, type CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import { assertCurrentPoolPositionPrepared, type CurrentPoolPreparedPositionAction, type CurrentPoolPreparedSnapshot, type CurrentPoolPreparedExitPreview } from '../features/wallet/currentDexPoolPositionCapability';
import { assertCurrentSharedPoolApprovalPrepared, type CurrentSharedPoolApprovalPrepared } from './currentSharedDexTokenFunding';
import { currentPoolOwnerGasCap } from './currentDexPoolPosition';
import { assertCurrentLimitPrepared, type CurrentLimitPrepared, type CurrentLimitPreparedSnapshot, type CurrentLimitPreparedOwner, type CurrentLimitFundingReview } from '../features/wallet/currentDexLimitCapability';
import { CURRENT_LIMIT_CREATE_GAS_CAP, CURRENT_LIMIT_SNAPSHOT_GAS_CAP, CURRENT_LIMIT_OWNER_GAS_CAPS } from './currentDexLimit';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';
import { CURRENT_EXIT_SWAP_GAS_CAPS, CURRENT_NATIVE_FIXED_GAS_PRICE } from './currentDexExitSwapPolicy';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION } from './currentSharedDexTokenDistribution';
import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';



import { assertCurrentCheapDexPreparedQuote } from '../features/wallet/currentDexQuoteCapability';
import { clearCurrentDexPendingAttempt, currentDexPendingStorage, readCurrentDexPendingAttempt, recordCurrentDexPendingHash, reserveCurrentDexPendingAttempt, advanceCurrentPoolTopUpAttempt, heldPoolSnapshotRefreshEligible, markCurrentDexPendingWalletRejected, archiveReviewedPoolPreview, isReviewedPoolPreview, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { readCurrentDexNativeReload } from './currentDexNativeReload';
import { hasCurrentPartialRefundProof } from './currentDexC1SwapPolicy';
import { type CurrentCheapDexPreparedQuote, pendingProfile } from './currentDexSubmission';

export type TransactionRequest = Readonly<{ chainId: bigint; from: string; to: string; value: 0n; data: string; gasLimit: bigint; nonce?: number; gasPrice?: bigint }>;
export type UnsignedTransaction = Omit<TransactionRequest, 'gasLimit'>;
export type SubmittedTransaction = Readonly<{ hash: string; chainId: bigint; from: string; to: string | null; value: bigint; data: string;
  nonce?: number; gasLimit?: bigint; gasPrice?: bigint; blockNumber?: number | null; blockHash?: string | null }>;
export type MinedReceipt = Readonly<{ hash: string; status: number | null; from: string; to: string | null;
  blockNumber?: number; blockHash?: string; logs?: ReadonlyArray<Readonly<{ address: string; topics: ReadonlyArray<string>; data: string;
    index?: number; transactionHash?: string; blockNumber?: number; blockHash?: string; removed?: boolean }>> }>;
export type CurrentDexSubmissionTransport = Readonly<{
  assertCurrent(): void | Promise<void>;
  estimateGas(request: UnsignedTransaction): Promise<bigint>;
  send(request: TransactionRequest, onTransactionHash?: (hash: string) => void | Promise<void>): Promise<SubmittedTransaction>;
  waitForReceipt(transactionHash: string): Promise<MinedReceipt | null>;
}>;

export type CurrentDexPreparedAcceptance = Readonly<{
  chainId: bigint; from: string; to: string; value: 0n; data: string; readyToSign: false;
  operationId: bigint; contextHash: string;
}>;

export const ownerActionInterface = new Interface(['function cancelSwap(uint256 operationId)', 'function recoverSwap(uint256 operationId)']);
export const hash = (value: string, label: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) throw new Error(`Invalid ${label}.`);
  return value.toLowerCase();
};

export const address = (value: string, label: string) => {
  const normalized = getAddress(value);
  if (BigInt(normalized) === 0n) throw new Error(`Invalid ${label}.`);
  return normalized;
};
export const sameAddress = (left: string, right: string) => address(left, 'transaction address') === address(right, 'transaction address');
export const sameCall = (left: UnsignedTransaction, right: UnsignedTransaction) =>
  left.chainId === right.chainId && sameAddress(left.from, right.from) && sameAddress(left.to, right.to) &&
  left.value === right.value && left.data.toLowerCase() === right.data.toLowerCase();

export const decodeCanonical = (data: string, contract: Interface, functionName: string) => {
  try {
    if (!/^0x[0-9a-fA-F]+$/.test(data)) throw new Error();
    const decoded = contract.decodeFunctionData(functionName, data);
    if (contract.encodeFunctionData(functionName, decoded).toLowerCase() !== data.toLowerCase()) throw new Error();
    return decoded;
  } catch {
    throw new Error('Current DEX transaction changed the admitted call.');
  }
};

const validateSubmitted = (submitted: SubmittedTransaction, request: TransactionRequest) => {
  const mismatch = [
    submitted.chainId !== request.chainId ? `chainId (expected ${request.chainId}, received ${submitted.chainId})` : '',
    !sameAddress(submitted.from, request.from) ? 'from' : '',
    !submitted.to || !sameAddress(submitted.to, request.to) ? 'to' : '',
    submitted.value !== request.value ? 'value' : '',
    submitted.data.toLowerCase() !== request.data.toLowerCase() ? 'data' : '',
    request.nonce !== undefined && submitted.nonce !== request.nonce ? `nonce (expected ${request.nonce}, received ${submitted.nonce})` : '',
    request.gasPrice !== undefined && submitted.gasPrice !== request.gasPrice ? 'gasPrice' : ''
  ].filter(Boolean);
  if (mismatch.length) {
    // Do not put private input payloads or signatures in an error message.
    throw new Error(`Wallet returned a transaction outside the reviewed DEX call. Mismatch: ${mismatch.join(', ')}. Do not resend.`);
  }
  return hash(submitted.hash, 'submitted transaction hash');
};
const validateReceipt = (receipt: MinedReceipt | null, request: TransactionRequest, transactionHash: string, allowFailed = false) => {
  if (!receipt) throw new Error('Confirmation is not available yet. Keep this transaction pending and check its status. Do not resend.');
  if (hash(receipt.hash, 'mined transaction hash') !== transactionHash ||
      !sameAddress(receipt.from, request.from) || !receipt.to || !sameAddress(receipt.to, request.to)) {
    throw new Error('Current DEX receipt identity changed. Keep the pending action and reconcile without resending.');
  }
  if (receipt.status === 0 && !allowFailed) throw new Error('Current DEX transaction failed on chain. Check its status before another action. Do not resend.');
  if (receipt.status !== 1 && !(allowFailed && receipt.status === 0))
    throw new Error('Current DEX receipt status is unavailable. Keep the pending action and reconcile without resending.');
};

export const acceptanceCall = (prepared: CurrentDexPreparedAcceptance): UnsignedTransaction => Object.freeze({
  chainId: prepared.chainId, from: prepared.from, to: prepared.to, value: 0n, data: prepared.data
});

const SHARED_POOL_GAS_CAP = 108_000_000n;
export type CurrentHead = Readonly<{ number: bigint; hash: string; timestamp: bigint; gasLimit: bigint }>;
export const CURRENT_NATIVE_RECOVERY_RESERVE = 10_000_000_000_000_000n;
export type CurrentNativeResources = Readonly<{ owner: string; chainId: bigint; head: CurrentHead;
  latestNonce: number; pendingNonce: number; gasPrice: bigint; baseFeePerGas: bigint; balance: bigint; code: string }>;
type CurrentAppPoolSigning = Readonly<{ signer: object }> & (
  { kind: 'funding'; prepared: CurrentPoolPreparedPreview | CurrentPoolPreparedFunding | CurrentPoolPreparedTopUpPreview | CurrentPoolPreparedTopUpFunding } |
  { kind: 'position'; prepared: CurrentPoolPreparedPositionAction | CurrentPoolPreparedSnapshot | CurrentPoolPreparedExitPreview } |
  { kind: 'approval'; prepared: CurrentSharedPoolApprovalPrepared });
export type CurrentTransport = CurrentDexSubmissionTransport & Readonly<{ readHead(): Promise<CurrentHead>;
  readNonce(): Promise<number>;
  admitOwnerRecord?(swapScope?: string, gasCap?: bigint, heldSnapshot?: CurrentDexPendingAttempt, topUpHandoff?: CurrentDexPendingAttempt): Promise<void>;
  readNativeResources?(head: CurrentHead): Promise<CurrentNativeResources>;
  readBlockHash(blockNumber: number): Promise<string | null>;
  readTransaction(transactionHash: string): Promise<SubmittedTransaction | null>;
  verifyCanonicalInclusion?(transaction: SubmittedTransaction, receipt: MinedReceipt): Promise<void> }>;
export const currentReservations = new WeakMap<object, { quote: Set<string>; accept: Set<string>; actions: Set<string>;
  acceptRequests: Map<string, TransactionRequest>;
  cheapReviewed?: Map<string, Readonly<{ actualInput: bigint; netOutput: bigint; context: string }>>;
  cheapRecovered?: Map<string, { prepared: CurrentCheapDexPreparedQuote; origin: { number: bigint; hash: string } }>;
  cheapClosedTrials?: Set<string> }>();
// decision-033 (CW-086). A send that the wallet rejected by code, with no returned hash, can be released
// after a chain nonce check. The same error object marks a completed release for the calling adapter.
const releasedUnsentErrors = new WeakSet<object>();
export const wasCurrentDexUnsentReleased = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && releasedUnsentErrors.has(error);
// EIP-1193 code 4001 only, direct or as the cause of the SDK error. Message text is never evidence.
const walletRejectedByCode = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; info?: { error?: { code?: unknown } } };
  return e.code === 4001 || e.code === 'ACTION_REJECTED' && e.info?.error?.code === 4001;
};
const UNSENT_RELEASE_HEAD_GAS_CAP = 5_000_000n;
// decision-033 part C: the saved records are shared by all tabs. A reload reads them again.
export const CURRENT_DEX_STALE_TAB_MESSAGE = 'Another tab changed the saved DEX records of this wallet. Nothing was sent. Reload this tab before another request.';
export const createCurrentAttemptBoundary = ({ storage, c, core, owner, chainId, transport, attest, now, historical = true, bindTarget = false, canonicalIndexProof = false, heldSnapshot, releaseReservation }: {
  storage: ReturnType<typeof currentDexPendingStorage>; c: { graph: string; packageSha256?: string }; core: string; owner: string; chainId: bigint;
  transport: CurrentTransport; attest: (head: CurrentHead) => Promise<void>; now: () => bigint; historical?: boolean; bindTarget?: boolean;
  canonicalIndexProof?: boolean; heldSnapshot?: CurrentDexPendingAttempt;
  // The adapter releases its own reservation for the rejected record, or throws. No hook means no release.
  releaseReservation?: (attempt: CurrentDexPendingAttempt) => Promise<void>;
}) => {
  // decision-034: only the current candidate; the b2aa exit candidate was removed.
  const nativeFit = c.graph === STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph && core.toLowerCase() === STAGED_SHARED_HISTORY_DEX_CANDIDATE.core;
  const exitFit = nativeFit && chainId === BigInt(STAGED_SHARED_HISTORY_DEX_CANDIDATE.chainId);
  const fixedGasPrice = CURRENT_NATIVE_FIXED_GAS_PRICE;
  const pending = () => readCurrentDexPendingAttempt(storage);
  const requireEmptyPending = () => {
    if (pending()) throw new Error('Current DEX has a pending attempt; reconcile it before another send.');
  };
  const requirePoolTopUpHandoff = (fundingHash: string) => {
    const active = pending();
    if (!active || active.phase !== 'pool-fund' || active.poolTopUpHash !== null || active.txHash !== fundingHash || active.verificationBlocked ||
      active.chainId !== chainId.toString() || active.owner !== owner.toLowerCase() || active.core !== core.toLowerCase() || active.graph !== `0x${c.graph}`.toLowerCase())
      throw new Error('Top-up funding journal is unavailable or changed. Do not resend.');
    return active;
  };
  const attemptFor = (phase: CurrentDexPendingAttempt['phase'], call: UnsignedTransaction, nonce: number,
    operationId?: bigint): CurrentDexPendingAttempt =>
    Object.freeze({ version: 1, chainId: chainId.toString(), owner: owner.toLowerCase(), core: core.toLowerCase(),
      graph: `0x${c.graph}`.toLowerCase(), phase, callHash: keccak256(call.data).toLowerCase(), nonce, txHash: null,
      ...(bindTarget ? { target: call.to.toLowerCase() } : {}),
      ...(operationId === undefined ? {} : { operationId: operationId.toString() }) });
  const requireOwnPending = (attempt: CurrentDexPendingAttempt, txHash: string) => {
    const recorded = pending();
    if (!recorded || recorded.chainId !== attempt.chainId || recorded.owner !== attempt.owner ||
        recorded.core !== attempt.core || recorded.graph !== attempt.graph || recorded.phase !== attempt.phase ||
         recorded.callHash !== attempt.callHash || recorded.nonce !== attempt.nonce ||
         recorded.operationId !== attempt.operationId || recorded.target !== attempt.target || recorded.poolTopUpHash !== attempt.poolTopUpHash || recorded.txHash !== txHash.toLowerCase()) {
      throw new Error('Current DEX pending attempt changed; reconcile manually.');
    }
    return recorded;
  };
  const currentHead = async (deadline?: bigint, gasCap = SHARED_POOL_GAS_CAP, exitHighCap = false) => {
    await transport.assertCurrent();
    const head = await transport.readHead();
    await transport.assertCurrent();
    if (head.number < 0n || !/^0x[0-9a-fA-F]{64}$/.test(head.hash) ||
        ((historical || nativeFit) && head.gasLimit < 120_000_000n) ||
        (gasCap * 10n > head.gasLimit * 9n && !(exitFit && exitHighCap && head.gasLimit - gasCap >= 10_000_000n)) ||
         head.timestamp > now() || (nativeFit ? now() - head.timestamp >= 90n : now() - head.timestamp > 300n) || (deadline !== undefined && (now() >= deadline || head.timestamp >= deadline))) {
      throw new Error('Current shared-Pool block, gas headroom or deadline is invalid.');
    }
    await attest(head);
    await transport.assertCurrent();
    return head;
  };
  const requireNativeResources = async (head: CurrentHead, nonce: number | undefined, gasCap: bigint) => {
    if (!nativeFit) return;
    if (!transport.readNativeResources) throw new Error('Current native send resources are unavailable.');
    await transport.assertCurrent();
    const resources = await transport.readNativeResources(head);
    await transport.assertCurrent();
    if (!sameAddress(resources.owner, owner) || resources.chainId !== chainId ||
        resources.head.number !== head.number || resources.head.hash.toLowerCase() !== head.hash.toLowerCase() ||
        resources.head.timestamp !== head.timestamp || resources.head.gasLimit !== head.gasLimit ||
        !Number.isSafeInteger(resources.latestNonce) || resources.latestNonce < 0 || resources.latestNonce !== resources.pendingNonce ||
        nonce !== undefined && resources.latestNonce !== nonce ||
        typeof resources.gasPrice !== 'bigint' || resources.gasPrice <= 0n ||
        typeof resources.baseFeePerGas !== 'bigint' || resources.baseFeePerGas < 0n || resources.baseFeePerGas > fixedGasPrice ||
        resources.code !== '0x' || typeof resources.balance !== 'bigint' ||
        resources.balance < CURRENT_NATIVE_RECOVERY_RESERVE + gasCap * fixedGasPrice ||
        head.timestamp > now() || now() - head.timestamp >= 90n) {
      throw new Error('Current native nonce, fee, payer resources or head changed.');
    }
    return resources;
  };
  // decision-033 and CW-129. Both paths require the current browser wallet and a fresh nonce check.
  // It signs nothing and sends nothing. Any failed check leaves the record in place.
  const releaseUnsent = async (browserSigner: object | undefined, review?: () => Promise<boolean>): Promise<boolean> => {
    const saved = pending();
    if (review && !isReviewedPoolPreview(saved)) throw new Error('Only a Pool preview with no transaction hash can be released after review.');
    if (!saved || saved.txHash !== null || (!review && saved.walletRejected !== true)) return false;
    if (saved.chainId !== chainId.toString() || saved.owner !== owner.toLowerCase() || saved.core !== core.toLowerCase() ||
        saved.graph !== `0x${c.graph}`.toLowerCase())
      throw new Error('The saved action belongs to another wallet, network or contract. Restore that session to check it. Do not resend.');
    if (!storage || !releaseReservation || heldSnapshot || saved.poolTopUpHash !== undefined || !isCurrentDexBrowserSigner(browserSigner, c.graph, owner) ||
        !transport.readNativeResources) throw new Error('Release of an unsent action needs the current browser wallet session.');
    if (review && !await review()) return false;
    const head = await currentHead(undefined, UNSENT_RELEASE_HEAD_GAS_CAP);
    const resources = await transport.readNativeResources(head);
    await transport.assertCurrent();
    if (!sameAddress(resources.owner, owner) || resources.chainId !== chainId || resources.code !== '0x' ||
        resources.head.number !== head.number || resources.head.hash.toLowerCase() !== head.hash.toLowerCase() ||
        resources.head.timestamp !== head.timestamp || !Number.isSafeInteger(resources.latestNonce) ||
        resources.latestNonce !== resources.pendingNonce || resources.latestNonce !== saved.nonce)
      throw new Error('The reserved wallet nonce is used or pending. The action stays locked. Do not resend.');
    await releaseReservation(saved);
    await transport.assertCurrent();
    const current = pending();
    if (!current || JSON.stringify(current) !== JSON.stringify(saved)) throw new Error('Current DEX pending attempt changed; reconcile manually.');
    if (review) archiveReviewedPoolPreview(storage, current);
    else clearCurrentDexPendingAttempt(storage, current);
    return true;
  };
  const sendCurrent = async (phase: CurrentDexPendingAttempt['phase'], call: UnsignedTransaction, deadline: bigint | undefined,
    validate: () => void | Promise<void>, onSigningRequest: (request: TransactionRequest) => void,
    operationId?: bigint, gasCap = SHARED_POOL_GAS_CAP,
    observation?: { sendStarted(): void; hashReturned?(transactionHash: string): void; submissionReturned(transactionHash: string): void },
    // decision-034 (CW-140.12): the fa71 native Pool source fit was removed. Its argument slot stays so that
    // positional callers keep their order; it accepts only undefined.
    authorizeSigning?: (request: TransactionRequest) => void | Promise<void>, _removedSourceFit?: undefined, appSwap?: { prepared: CurrentCheapDexPreparedQuote; signer: object; cleanup?: true }, appInitialClaimSigner?: object,
    appSharedFunding?: Readonly<{ action: 'initial' | 'refill'; token: string; signer?: object }>,
    appLimit?: Readonly<{ prepared: CurrentLimitPrepared | CurrentLimitPreparedSnapshot | CurrentLimitPreparedOwner | CurrentLimitFundingReview; signer: object }>,
    appPool?: CurrentAppPoolSigning, poolTopUpHash?: string | null) => {
    if(heldSnapshot&&(phase!=='pool-snapshot'||poolTopUpHash!==undefined||gasCap!==30_000_000n||c.graph!==STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph||
      !heldPoolSnapshotRefreshEligible(heldSnapshot,{chainId:String(chainId),owner,core,graph:`0x${c.graph}`})))
      throw new Error('Independent private refresh scope changed.');
    if (poolTopUpHash !== undefined && !(poolTopUpHash === null && phase === 'pool-fund' || typeof poolTopUpHash === 'string' && phase === 'pool-snapshot' && hash(poolTopUpHash, 'Top-up transaction') === poolTopUpHash)) throw new Error('Top-up snapshot journal binding changed.');
    const handoff = typeof poolTopUpHash === 'string' ? requirePoolTopUpHandoff(poolTopUpHash) : undefined;
    const requireSendSlot = () => {
      if (handoff) { requirePoolTopUpHandoff(poolTopUpHash!); requireOwnPending(handoff, handoff.txHash!); }
      else requireEmptyPending();
    };
    const fundingScope = appSharedFunding && Object.freeze({ ...appSharedFunding });
    const limitScope = appLimit && Object.freeze({ ...appLimit });
    const poolScope = appPool && Object.freeze({ ...appPool });
    const browserSigner = appSwap?.signer ?? limitScope?.signer ?? poolScope?.signer ?? fundingScope?.signer;
    const normalBrowser = () => isCurrentDexBrowserSigner(browserSigner,c.graph,owner);
    const reloadScope = Object.freeze({ owner, graph: c.graph, chainId });
    const checkNormalBrowser = (nonce: number) => {
      if (!normalBrowser()) return;
      const saved = readCurrentDexNativeReload(storage, reloadScope);
      if (!saved) throw new Error('Owner beta requires the retained native reload record.');
      validateCurrentNativeSwapCheckpoint(saved.budget, owner, STAGED_SHARED_HISTORY_DEX_CANDIDATE, browserSigner);
      if(saved.budget.version===2){
        const legacy=readCurrentDexNativeReload(storage,false,reloadScope);
        if(legacy){
          validateCurrentNativeSwapCheckpoint(legacy.budget,owner,STAGED_SHARED_HISTORY_DEX_CANDIDATE);
          if(legacy.budget.activeSwap!==null||legacy.budget.charges.some(row=>!row.hash)||appSwap&&
              legacy.budget.charges.some(row=>row.scope===`quote:${keccak256(appSwap.prepared.data)}`))
            throw new Error('The retained owner record has an active or reused scope. Reconcile it.');
        }
      }
      assertCurrentDexBrowserWindow(browserSigner!,c.graph,owner,core,chainId,now(),nonce,gasCap,fixedGasPrice);
    };
    if(poolScope&&(appSwap||appInitialClaimSigner||fundingScope||limitScope)) throw new Error('Pool App scope changed.');
    if(limitScope&&(appSwap||appInitialClaimSigner||fundingScope)) throw new Error('Limit App scope changed.');
    const assertLimitCall = (request: UnsignedTransaction) => {
      if (!limitScope || appSwap || appInitialClaimSigner || fundingScope) throw new Error('Limit App scope changed.');
      const p=limitScope.prepared;
      assertCurrentLimitPrepared(p,limitScope.signer);
      const action=p.phase==='limit-funding-review'?`approve-${p.kind}` as const:p.phase==='limit-create'?'create':p.phase==='limit-snapshot'?'snapshot':p.action;
      const amount=p.phase==='limit-funding-review'?p.amount:p.phase==='limit-create'?p.intent.amount:p.phase==='limit-owner'&&p.action==='topup'?p.topUpAmount:undefined;
      assertCurrentAppLimitAuthority(c.graph,{owner,action,amount},limitScope.signer);
      const pair=STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.find(pair=>pair.marketId===p.marketId&&p.poolTokens?.length===2&&pair.tokens.every((token,i)=>sameAddress(token,p.poolTokens![i])));
      if(c.graph!==STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph||c.packageSha256!==STAGED_SHARED_HISTORY_DEX_CANDIDATE.packageSha256||
          !sameAddress(core,STAGED_SHARED_HISTORY_DEX_CANDIDATE.core)||chainId!==BigInt(STAGED_SHARED_HISTORY_DEX_CANDIDATE.chainId)||
          p.graph!==c.graph||p.packageSha256!==c.packageSha256||p.chainId!==chainId||!sameAddress(p.from,owner)||!sameAddress(p.to,core)||p.readyToSign!==false||
          request.chainId!==chainId||!sameAddress(request.from,owner)||request.value!==0n||!pair) throw new Error('Limit App candidate, owner or market changed.');
      if(p.phase==='limit-funding-review'){
        const call=currentTokenFundingAbi.parseTransaction({data:request.data});
        if(!call || !['approve','increaseAllowance'].includes(call.name)) throw new Error('Limit App approval call changed.');
        const args=call.args;
        if(phase!=='token-approve'||gasCap!==5_000_000n||!pair.tokens.some(token=>sameAddress(token,p.fundingToken))||!sameAddress(request.to,p.fundingToken)||
            !sameAddress(args[0],core)||request.data!==currentTokenFundingAbi.encodeFunctionData(call.name,args)||!/^0x[0-9a-fA-F]{130}$/.test(args[1].signature)) throw new Error('Limit App approval call changed.');
      }else{
        const cap=p.phase==='limit-create'?CURRENT_LIMIT_CREATE_GAS_CAP:p.phase==='limit-snapshot'?CURRENT_LIMIT_SNAPSHOT_GAS_CAP:CURRENT_LIMIT_OWNER_GAS_CAPS[p.action];
        if(phase!==p.phase||gasCap!==cap||!sameAddress(request.to,core)||request.data!==p.data) throw new Error('Limit App call changed.');
      }
    };
    const assertSharedFunding = (request: UnsignedTransaction) => {
      if (!fundingScope || appInitialClaimSigner || appSwap) throw new Error('Shared funding App scope changed.');
      assertCurrentAppSharedFundingAuthority(c.graph, owner, fundingScope.token, fundingScope.action, fundingScope.signer);
      const abi = new Interface(['function claimFaucet()', 'function claim(address)']);
      const initial = fundingScope.action === 'initial';
      if (chainId !== BigInt(STAGED_SHARED_HISTORY_DEX_CANDIDATE.chainId) || !sameAddress(core, STAGED_SHARED_HISTORY_DEX_CANDIDATE.core) ||
          !sameAddress(request.from, owner) || request.chainId !== chainId || request.value !== 0n || gasCap !== 5_000_000n ||
          phase !== (initial ? 'token-faucet' : 'token-refill') ||
          !sameAddress(request.to, initial ? fundingScope.token : CURRENT_SHARED_TOKEN_DISTRIBUTION.vault.address) ||
          request.data !== abi.encodeFunctionData(initial ? 'claimFaucet' : 'claim', initial ? [] : [fundingScope.token])) {
        throw new Error('Shared funding App call changed.');
      }
    };
    const assertPoolCall = async (request: UnsignedTransaction) => {
      if (!poolScope) throw new Error('Pool App scope is absent.');
      const p = poolScope.prepared;
      const binding = poolScope.kind === 'approval' ? assertCurrentSharedPoolApprovalPrepared(poolScope.prepared, poolScope.signer) : poolScope.prepared;
      if (poolScope.kind === 'funding') assertCurrentPoolFundingPrepared(poolScope.prepared, poolScope.signer);
      if (poolScope.kind === 'position') assertCurrentPoolPositionPrepared(poolScope.prepared, poolScope.signer);
      await binding.assertCurrent();
      if (c.graph !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph || c.packageSha256 !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.packageSha256 ||
          !sameAddress(core, STAGED_SHARED_HISTORY_DEX_CANDIDATE.core) || chainId !== BigInt(STAGED_SHARED_HISTORY_DEX_CANDIDATE.chainId) ||
          binding.graph !== c.graph || binding.packageSha256 !== c.packageSha256 || binding.chainId !== chainId || !sameAddress(binding.from, owner) ||
          binding.readyToSign !== false || request.chainId !== chainId || !sameAddress(request.from, owner) || request.value !== 0n || request.data !== p.data) throw new Error('Pool App candidate, owner or call changed.');
      if ('kind' in binding && binding.kind === 'allowance-cleanup') {
        assertCurrentAppPoolAllowanceCleanupAuthority(c.graph, owner,poolScope.signer);
        if (poolScope.kind !== 'approval') throw new Error('Pool cleanup cannot authorize funding.');
        const approval = poolScope.prepared;
        const pair = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.find(pair => pair.marketId === binding.marketId &&
          pair.tokens.every((token, i) => sameAddress(token, binding.poolTokens[i])));
        if (!pair || !sameAddress(binding.to, core) || !sameAddress(binding.core, core) || approval.marketId !== binding.marketId ||
            approval.recovery !== true || approval.cleanup !== true || approval.amount !== 0n ||
            phase !== 'token-approve' || gasCap !== 5_000_000n || !sameAddress(pair.tokens[approval.canonicalIndex], approval.token) ||
            !sameAddress(request.to, approval.token) || !sameAddress(currentTokenFundingAbi.decodeFunctionData('approve', request.data)[0], core)) {
          throw new Error('Pool App zero-allowance recovery changed.');
        }
      } else if (poolScope.kind === 'position') {
        const position = poolScope.prepared, action = position.action;
        assertCurrentAppPoolAuthority(c.graph, { owner, action, positionId: position.positionId, recipient: position.recipient },poolScope.signer);
        const expectedPhase = action === 'snapshot' ? 'pool-snapshot' : action === 'transfer' ? 'pool-transfer' : 'pool-owner';
        const expectedTarget = action === 'transfer' ? STAGED_SHARED_HISTORY_DEX_CANDIDATE.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1] : core;
        if (phase !== expectedPhase || gasCap !== (action === 'snapshot' ? 30_000_000n : currentPoolOwnerGasCap(action)) || !sameAddress(request.to, expectedTarget) || !sameAddress(position.to, expectedTarget)) throw new Error('Pool App position phase changed.');
      } else {
        const funding = poolScope.kind === 'approval' ? assertCurrentSharedPoolApprovalPrepared(poolScope.prepared, poolScope.signer) : poolScope.prepared;
        if (!('intent' in funding)) throw new Error('Pool cleanup cannot authorize funding.');
        const topUp = 'positionId' in funding, intent = funding.intent;
        const action = poolScope.kind === 'approval' ? (poolScope.prepared.cleanup ? topUp ? 'clear-top-up' : 'clear-create' : topUp ? 'approve-top-up' : 'approve-create') : topUp ? 'top-up' : 'create';
        assertCurrentAppPoolAuthority(c.graph, { owner, action, positionId: topUp ? funding.positionId : undefined, budgets: intent.budgets,
          classId: intent.classId, tolerance: 'tolerance' in intent ? intent.tolerance : [intent.terms[8], intent.terms[9]] },poolScope.signer);
        const pair = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.find(pair => pair.marketId === intent.marketId && pair.tokens.every((token, i) => sameAddress(token, intent.poolTokens[i])));
        if (!pair || !sameAddress(funding.to, core)) throw new Error('Pool App market changed.');
        if (poolScope.kind === 'approval') {
          const approval = poolScope.prepared;
          if (phase !== 'token-approve' || gasCap !== 5_000_000n || !pair.tokens.some(token => sameAddress(token, approval.token)) || !sameAddress(request.to, approval.token)) throw new Error('Pool App approval phase changed.');
        } else if (phase !== ('readPreview' in funding ? 'pool-preview' : 'pool-fund') || gasCap !== 100_000_000n || !sameAddress(request.to, core)) throw new Error('Pool App funding phase changed.');
      }
    };
    // Read identity is not per-phase admission. Keep the connected-wallet holds
    // at the shared send boundary too, including owner/funding callers.
    if (appSwap) {
      assertCurrentCheapDexPreparedQuote(appSwap.prepared, appSwap.signer);
      if (appSwap.cleanup && (phase !== 'token-approve' || !normalBrowser())) throw new Error('Allowance cleanup requires the current browser approval path.');
      if (!normalBrowser() && c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph && hasCurrentNativeSigningBudget(appSwap.signer)) {
        const charges=currentNativeSwapCheckpoint(appSwap.signer).charges;
        if(hasCurrentPartialRefundProof(c.graph,owner,charges)?appSwap.prepared.profile!=='cheap-async':hasCurrentHistoryFastProof(c.graph,owner,charges)?appSwap.prepared.profile!=='fast-pool':
          hasCurrentHistoryReplacementProof(c.graph,owner,charges)&&appSwap.prepared.profile!=='cheap-async')
          throw new Error('The approved App trial swap mode changed.');
      }
      if (!sameAddress(appSwap.prepared.from, owner) || !['quote','accept','cancel','recover','token-approve','token-faucet'].includes(phase)) throw new Error('App trial phase or owner changed.');
      if(appSwap.prepared.graph!==c.graph||!sameAddress(appSwap.prepared.to,core)||!sameAddress(call.to,phase==='token-approve'?appSwap.prepared.intent.inputToken:core)||phase==='quote'&&call.data!==appSwap.prepared.data)throw new Error('App trial candidate, target or Quote calldata changed.');
      if(exitFit)assertCurrentNativeSwapIntent(appSwap.prepared,now(),phase==='cancel'||phase==='recover'||!!appSwap.cleanup,phase==='accept',appSwap.signer);
    }
    // The initial-claim hold always applies: only the removed b2aa candidate admitted it (decision-034).
    if (appInitialClaimSigner) assertCurrentAppInitialClaimAuthority(c.graph,owner,call.to,'initial');
    else if (fundingScope) assertSharedFunding(call);
    else if (limitScope) assertLimitCall(call);
    else if (poolScope) await assertPoolCall(call);
    else assertCurrentD06AppAuthority(c.graph, appSwap?.prepared.intent,appSwap?.signer);
    if (exitFit && (phase === 'quote' || phase === 'accept' || phase === 'cancel' || phase === 'recover')) {
      const profile = pendingProfile(call.data, phase, 'quote-slippage');
      const expected = phase === 'quote' || phase === 'accept'
        ? CURRENT_EXIT_SWAP_GAS_CAPS[profile][phase] : CURRENT_EXIT_SWAP_GAS_CAPS['cheap-async'][phase];
      if (gasCap !== expected) throw new Error('Current native user phase gas cap changed.');
    }
    // Accepted 110M phase caps retain a 10M absolute block reserve.
    const exitHighCap = exitFit && gasCap === 110_000_000n && (phase === 'quote' || phase === 'accept');
    if(normalBrowser()){
      if(!transport.admitOwnerRecord)throw new Error('Owner normal-use record admission is unavailable.');
      const scope = appSwap ? `quote:${keccak256(appSwap.prepared.data)}` : undefined;
      await transport.admitOwnerRecord(appSwap?.cleanup ? readCurrentDexNativeReload(storage,reloadScope)?.budget.activeSwap ?? scope : scope,gasCap,heldSnapshot,handoff);
    }
    await validate();
    const initialHead = await currentHead(deadline, gasCap, exitHighCap);
    requireSendSlot();
    const nonce = await transport.readNonce();
    await transport.assertCurrent();
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Current DEX pending nonce is invalid.');
    checkNormalBrowser(nonce);
    await requireNativeResources(initialHead, nonce, gasCap);
    const numberedCall = Object.freeze({ ...call, nonce, ...(nativeFit ? { gasPrice: fixedGasPrice } : {}) });
    if (historical || nativeFit) {
      const estimate = await transport.estimateGas(numberedCall);
      await transport.assertCurrent();
      if (typeof estimate !== 'bigint' || estimate <= 0n || estimate > gasCap ||
          (nativeFit && (estimate > 50_000_000n || (estimate * 5n + 3n) / 4n + 1_000_000n > gasCap))) {
        throw new Error('Current shared-Pool estimate exceeds measured gas cap.');
      }
    }
    await validate();
    const signingHead = await currentHead(deadline, gasCap, exitHighCap);
    await transport.assertCurrent();
    if (await transport.readNonce() !== nonce) {
      throw new Error('Current DEX pending nonce changed before signing.');
    }
    await transport.assertCurrent();
    await requireNativeResources(signingHead, nonce, gasCap);
    requireSendSlot();
    const request = Object.freeze({ ...numberedCall, gasLimit: gasCap });
    const attempt = Object.freeze({ ...attemptFor(phase, numberedCall, nonce, operationId), ...(poolTopUpHash === undefined ? {} : { poolTopUpHash }) });
    if (authorizeSigning) {
      await authorizeSigning(request);
      // An asynchronous phase gate can yield after the earlier nonce/resources proof.
      // Recheck those inputs before reserving this action. A consumed budget stays consumed on failure.
      await transport.assertCurrent();
      if (await transport.readNonce() !== nonce) throw new Error('Current DEX pending nonce changed before signing.');
      await transport.assertCurrent();
      await requireNativeResources(await currentHead(deadline, gasCap, exitHighCap), nonce, gasCap);
      await transport.assertCurrent();
    }
    requireSendSlot();
    if (appSwap) {
      assertCurrentCheapDexPreparedQuote(appSwap.prepared, appSwap.signer);
      if (!sameAddress(appSwap.prepared.from, owner) || !['quote','accept','cancel','recover','token-approve'].includes(phase)) throw new Error('App trial phase or owner changed.');
      if(exitFit)assertCurrentNativeSwapIntent(appSwap.prepared,now(),phase==='cancel'||phase==='recover'||!!appSwap.cleanup,phase==='accept',appSwap.signer);
    }
    if (appInitialClaimSigner) assertCurrentAppInitialClaimAuthority(c.graph,owner,call.to,'initial');
    else if (fundingScope) assertSharedFunding(numberedCall);
    else if (limitScope) assertLimitCall(numberedCall);
    else if (poolScope) await assertPoolCall(numberedCall);
    else assertCurrentD06AppAuthority(c.graph, appSwap?.prepared.intent,appSwap?.signer);
    requireSendSlot();
    checkNormalBrowser(nonce);
    if (handoff) advanceCurrentPoolTopUpAttempt(storage, handoff, attempt);
    else reserveCurrentDexPendingAttempt(storage, attempt);
    onSigningRequest(request);
    await transport.assertCurrent();
    observation?.sendStarted();
    let submittedHash: string | null = null;
    const sent = await transport.send(request, transactionHash => {
      const knownHash = hash(transactionHash, 'Submitted transaction');
      if (submittedHash !== null) throw new Error('Wallet returned more than one transaction hash. Do not resend.');
      recordCurrentDexPendingHash(storage, attempt, knownHash);
      submittedHash = knownHash;
      observation?.hashReturned?.(knownHash);
    }).catch(async (error: unknown) => {
      // decision-033: only a rejection by wallet code with no returned hash can start a release.
      // An unknown wallet result, a top-up handoff and a held refresh keep the existing lock.
      try {
        if (submittedHash === null && releaseReservation && !handoff && !heldSnapshot && poolTopUpHash === undefined &&
            walletRejectedByCode(error) && normalBrowser()) {
          markCurrentDexPendingWalletRejected(storage, attempt);
          if (await releaseUnsent(browserSigner)) releasedUnsentErrors.add(error as object);
        }
      } catch { /* The record stays for a later check. The wallet error remains the result of this send. */ }
      throw error;
    });
    if (!historical && sent.gasLimit !== gasCap) throw new Error('Wallet changed the current-mode gas cap.');
    const transactionHash = validateSubmitted(sent, request);
    if (submittedHash !== null && submittedHash !== transactionHash) throw new Error('Submitted transaction hash changed. Do not resend.');
    observation?.submissionReturned(transactionHash);
    if (submittedHash === null) recordCurrentDexPendingHash(storage, attempt, transactionHash);
    await transport.assertCurrent();
    return Object.freeze({ request, transactionHash });
  };
  const verifyMinedCall = async (request: TransactionRequest, transactionHash: string, allowFailed = false,
    observation?: { receiptStarted(): void; receiptFinished(outcome: 'received' | 'missing' | 'error'): void }) => {
    await transport.assertCurrent();
    const transaction = await transport.readTransaction(transactionHash);
    await transport.assertCurrent();
    if (!transaction) throw new Error('Current DEX mined transaction is unavailable. Keep the pending action and reconcile without resending.');
    if (validateSubmitted(transaction, request) !== hash(transactionHash, 'transaction hash')) {
      throw new Error('Current DEX mined transaction changed.');
    }
    if (!historical && transaction.gasLimit !== request.gasLimit) throw new Error('Current-mode mined gas cap changed.');
    observation?.receiptStarted();
    let receipt: MinedReceipt | null;
    try { receipt = await transport.waitForReceipt(transactionHash); }
    catch (error) { observation?.receiptFinished('error'); throw error; }
    observation?.receiptFinished(receipt ? 'received' : 'missing');
    await transport.assertCurrent();
    validateReceipt(receipt, request, transactionHash.toLowerCase(), allowFailed);
    if (!Number.isSafeInteger(receipt!.blockNumber) || (receipt!.blockNumber ?? -1) < 0 ||
        !receipt!.blockHash || transaction.blockNumber !== receipt!.blockNumber ||
        !transaction.blockHash || hash(transaction.blockHash, 'transaction block') !== hash(receipt!.blockHash, 'receipt block')) {
      throw new Error('Current DEX mined block changed.');
    }
    const canonicalHash = await transport.readBlockHash(receipt!.blockNumber!);
    await transport.assertCurrent();
    if (!canonicalHash || hash(canonicalHash, 'canonical block') !== hash(receipt!.blockHash, 'receipt block')) {
      throw new Error('Current DEX mined block changed.');
    }
    if (nativeFit || canonicalIndexProof) {
      if (!transport.verifyCanonicalInclusion) throw new Error('Current native canonical index verification is unavailable.');
      await transport.verifyCanonicalInclusion(transaction, receipt!);
      await transport.assertCurrent();
    }
    return receipt!;
  };
  const recheckMinedCall = async (request: TransactionRequest, transactionHash: string, before: MinedReceipt, allowFailed = false) => {
    if (!nativeFit && !canonicalIndexProof) return;
    const after = await verifyMinedCall(request, transactionHash, allowFailed);
    const identity = (receipt: MinedReceipt) => JSON.stringify({ hash: receipt.hash.toLowerCase(), status: receipt.status,
      from: receipt.from.toLowerCase(), to: receipt.to?.toLowerCase(), blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash?.toLowerCase(), logs: receipt.logs?.map(log => ({ address: log.address.toLowerCase(),
        topics: log.topics.map(topic => topic.toLowerCase()), data: log.data.toLowerCase() })) });
    if (identity(before) !== identity(after)) throw new Error('Current native receipt changed after private verification.');
  };
  return { pending, requireEmptyPending, requirePoolTopUpHandoff, requireOwnPending, currentHead, requireNativeResources, sendCurrent, verifyMinedCall, recheckMinedCall, releaseUnsent };
};
