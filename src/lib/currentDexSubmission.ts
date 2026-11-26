import { isCurrentDexBrowserSigner, assertCurrentDexBrowserWindow } from './currentDexBrowserPolicy';
import { assertCurrentSwapCandidate, assertCurrentSwapIdentity, assertCurrentNativeSwapIntent, usesCurrentNativeSwapChecks, currentNativeSigningBudget, completeCurrentNativeSwapScope,
  currentNativeSwapCheckpoint, recordCurrentNativeSwapHash, restoreCurrentNativeSwapCheckpoint, validateCurrentNativeSwapCheckpoint, currentNativeSwapChargeGasPrice, hasCurrentNativeSigningBudget, bindCurrentNativeSwapFundingScope, renewCurrentNativeSwapFundingWindow, renewCurrentNativeSwapClosedWindow, CURRENT_NATIVE_SWAP_LIMITS, type CurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';
import { assertCurrentAppInitialClaimAuthority, CURRENT_APP_REPLACEMENT_TRIAL, CURRENT_APP_FURTHER_TRIAL, CURRENT_APP_FOURTH_TRIAL, CURRENT_APP_HISTORY_REPLACEMENT_TRIAL, CURRENT_APP_HISTORY_FAST_TRIAL, hasCurrentHistoryFastProof } from './currentDexC1SwapPolicy';



import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';
import { CURRENT_EXIT_SWAP_GAS_CAPS, usesCurrentSwapAccounting, currentSwapFixedGasPrice } from './currentDexExitSwapPolicy';
import type { CurrentDexOwnerTokenAmounts, CurrentDexOwnerTokenPhase } from './currentDexOwnerTokenProof';
import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import type { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import { currentDexRestoredPlan, assertCurrentDexQuoteNotRestored } from '../features/wallet/currentDexQuoteCapability';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, decodeCurrentCheapDexOperation, type CurrentCheapDexProfile } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
export class CurrentDexPrivateReceiptError extends Error {
  constructor(message: string) {
    super(`Private verification failed: ${message}`);
    this.name = 'CurrentDexPrivateReceiptError';
  }
}
import { assertCurrentDexInternalAdmission, issueCurrentCheapDexQuoteAdmission,
  issueCurrentCheapDexAcceptAdmission } from './currentDexSubmissionAdmission';
import { currentCheapDexQuoteProtocol, currentCheapDexStages, currentCheapDexOwnerActionEligible, resolveCurrentCheapDexCandidate,
  type CurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { assertCurrentCheapDexPreparedQuote, assertCurrentCheapDexIssuedQuote } from '../features/wallet/currentDexQuoteCapability';
import { blockCurrentSwapVerification, blockCurrentDexOperationVerification, clearCurrentDexOperationLookup, readCurrentDexOperationLookups, recordCurrentDexOperationLookup, clearCurrentDexPendingAttempt, currentDexPendingStorage, recordCurrentDexPendingHash, heldPoolSnapshotRefreshEligible, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';
import { recoverCurrentPartialLedger, releaseCurrentNativeSwapCharge } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY, CURRENT_APP_PARTIAL_REFUND_TRIAL, currentPartialLedgerRecoveryAllowed, hasCurrentPartialRefundProof } from './currentDexC1SwapPolicy';
import { CURRENT_OWNER_BETA } from './currentDexOwnerBetaPolicy';
import { decodeCanonical, ownerActionInterface, type MinedReceipt, sameAddress, type CurrentTransport, type CurrentHead, type CurrentDexPreparedAcceptance, type TransactionRequest, address, currentReservations, createCurrentAttemptBoundary, CURRENT_DEX_STALE_TAB_MESSAGE, type CurrentNativeResources, type SubmittedTransaction, hash, sameCall, type UnsignedTransaction, wasCurrentDexUnsentReleased, acceptanceCall } from './currentDexSendBoundary';

export {
  CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256,
  CURRENT_DEX_SUBMISSION_SOURCES_SHA256,
  CURRENT_DEX_SUBMISSION_VERSION
} from './currentDexSubmissionAdmission';
export type {
  CurrentDexSubmissionAdmission,
  CurrentDexSubmissionAdmissionEvidence,
  CurrentDexSubmissionPhase
} from './currentDexSubmissionAdmission';

type QuoteCapability = Awaited<ReturnType<typeof issueCurrentDexQuoteCapability>>;
export type CurrentCheapDexPreparedQuote = NonNullable<Awaited<ReturnType<QuoteCapability['prepareCurrentQuote']>>>;
export type CurrentCheapDexIssuedQuote = NonNullable<Awaited<ReturnType<CurrentCheapDexPreparedQuote['readIssue']>>>;
type CurrentCheapDexOperation = ReturnType<typeof decodeCurrentCheapDexOperation>;
type CurrentCheapReceipt = Awaited<ReturnType<Awaited<ReturnType<typeof import('../features/wallet/currentDexReceiptCapability').issueCurrentDexReceiptCapability>>['readCurrent']>>;

export const CURRENT_CHEAP_DEX_GAS_CAPS = Object.freeze({
  'fast-pool': Object.freeze({ quote: 60_000_000n, accept: 50_000_000n }),
  'cheap-async': Object.freeze({ quote: 50_000_000n, accept: 25_000_000n, cancel: 10_000_000n, recover: 25_000_000n })
});
// Exact signed caps from the accepted fa71 native profiles. A cap grants no send admission.
export const currentCheapDexGasCaps = (candidate: CurrentCheapDexCandidate = STAGED_SHARED_HISTORY_DEX_CANDIDATE) => {
  if (usesCurrentSwapAccounting(candidate)) {
    assertCurrentSwapIdentity(candidate);
    return CURRENT_EXIT_SWAP_GAS_CAPS;
  }
  return CURRENT_CHEAP_DEX_GAS_CAPS;
};
// Bound to native-coexistence-manifest-1.json (9513dcca...) and its original native receipts.
const cheapProtocol = currentCheapDexQuoteProtocol(STAGED_SHARED_HISTORY_DEX_CANDIDATE);
const cheapOpening = new Interface(cheapProtocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
export const pendingProfile = (data: string, phase: CurrentDexPendingAttempt['phase'], protocol: ReturnType<typeof currentCheapDexQuoteProtocol>): CurrentCheapDexProfile => {
  if (phase === 'cancel' || phase === 'recover') {
    decodeCanonical(data, ownerActionInterface, phase === 'cancel' ? 'cancelSwap' : 'recoverSwap');
    return 'cheap-async';
  }
  const contract = phase === 'quote' ? new Interface(protocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI)
    : new Interface(protocol ? CURRENT_SLIPPAGE_DEX_ACCEPT_ABI : CURRENT_DEX_ACCEPT_ABI);
  const method = (profile: CurrentCheapDexProfile) => phase === 'quote'
    ? profile === 'fast-pool' ? protocol ? 'quoteFastPool' : 'quoteFastPoolV1' : protocol ? 'quoteCheapAsync' : 'quoteCheapAsyncV1'
    : profile === 'fast-pool' ? protocol ? 'acceptFastPool' : 'acceptFastPoolV1' : 'acceptPrivateSwapV1';
  for (const profile of ['fast-pool', 'cheap-async'] as const) {
    if (data.slice(0, 10).toLowerCase() === contract.getFunction(method(profile))!.selector) {
      decodeCanonical(data, contract, method(profile));
      return profile;
    }
  }
  throw new Error('Pending transaction has no exact current-mode selector for its phase.');
};

const uniqueCheapEvent = (receipt: MinedReceipt, core: string, name: 'FastPoolQuoteIssued' | 'CheapAsyncAdvanced') => {
  const event = cheapOpening.getEvent(name)!;
  const logs = (receipt.logs ?? []).filter(log => sameAddress(log.address, core) && log.topics[0]?.toLowerCase() === event.topicHash);
  if (logs.length !== 1) throw new Error('Current-mode transaction has no unique Core event.');
  const parsed = cheapOpening.parseLog({ ...logs[0], topics: [...logs[0].topics] });
  const encoded = parsed && cheapOpening.encodeEventLog(event, parsed.args);
  if (!parsed || encoded?.data.toLowerCase() !== logs[0].data.toLowerCase() ||
      encoded.topics.length !== logs[0].topics.length ||
      encoded.topics.some((topic, i) => topic.toLowerCase() !== logs[0].topics[i].toLowerCase())) {
    throw new Error('Current-mode Core event is not canonical.');
  }
  return parsed.args;
};

/** Local monotonic clocks only. Receipt observation is not chain inclusion/mining time. */
type CheapTimingCheck = { startedAtMs: number | null; receiptStartedAtMs: number | null;
  receiptFinishedAtMs: number | null; receiptObservation: 'received' | 'missing' | 'error' | null;
  finishedAtMs: number | null; successfulVerifiedAtMs: number | null;
  verificationScope: 'quote-issue' | 'fast-private-delivery' | 'async-funded-accept' | null };
export type CurrentCheapDexTiming = Readonly<{ transactionHash: string; profile: CurrentCheapDexProfile;
  phase: 'quote' | 'accept'; sendStartedAtMs: number | null; hashReturnedAtMs: number | null; submissionReturnedAtMs: number | null;
  walletSendMs: number | null; walletRequestToHashMs: number | null; hashToRpcVisibilityMs: number | null;
  checks: ReadonlyArray<Readonly<CheapTimingCheck & {
    submittedToCheckMs: number | null; receiptObservationMs: number | null;
    preReceiptVerificationMs: number | null; postReceiptVerificationMs: number | null;
    verificationRemainderMs: number | null }>> }>;
export type CurrentDexSendProgress = Readonly<{
  walletRequested?(): void;
  transactionHashReturned?(hash: string): void;
}>;

export const createCurrentCheapDexSubmissionAdapter = (args: Parameters<typeof createCheapDexSubmissionAdapter>[0] & { candidate?: CurrentCheapDexCandidateKey }) =>
  createCheapDexSubmissionAdapter(args, resolveCurrentCheapDexCandidate(args.candidate ?? 'cheap-history'));

const createCheapDexSubmissionAdapter = ({ signer, ownerAddress, chainId, transport, attest,
  readOperation, readReceipt, reviewAcceptance, requireFunding, verifyOwnerTokens, readTerminalReceipt,
  authenticateReload, readOriginalQuoteReceipt, verifySwapAllowanceCleanup,
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport;
  attest: (head: CurrentHead) => Promise<void>;
  readOperation: (profile: CurrentCheapDexProfile, operationId: bigint, origin?: { number: bigint; hash: string }) =>
    Promise<{ operation: CurrentCheapDexOperation }>;
  readReceipt: (issued: CurrentCheapDexIssuedQuote, origin?: { number: bigint; hash: string }) => Promise<CurrentCheapReceipt>;
  reviewAcceptance: (issued: CurrentCheapDexIssuedQuote, confirm: (model: unknown) => Promise<boolean>, initialReceipt?: CurrentCheapReceipt) =>
    Promise<CurrentDexPreparedAcceptance | null>;
  requireFunding: (prepared: CurrentCheapDexPreparedQuote, head: CurrentHead, beforeApproval?: boolean) => Promise<void>;
  // Issued only by the live selected-wallet capability. Never a stored proof flag.
  verifyOwnerTokens?: (args: { issued: CurrentCheapDexIssuedQuote; amounts: CurrentDexOwnerTokenAmounts;
    phase: CurrentDexOwnerTokenPhase; receipt: MinedReceipt; contextHash: string }) => Promise<void>;
  readTerminalReceipt?: (issued: CurrentCheapDexIssuedQuote, upperBlock: bigint) =>
    Promise<{ receipt: MinedReceipt; phase: 'terminal' | 'recover' | 'cancel' }>;
  authenticateReload?: (record: CurrentNativeSwapCheckpoint) => Promise<string>;
  verifySwapAllowanceCleanup?: (request: TransactionRequest, transactionHash: string) => Promise<void>;
  readOriginalQuoteReceipt?: (issued: CurrentCheapDexIssuedQuote) => Promise<CurrentCheapReceipt>;
  now?: () => bigint;
}, c: CurrentCheapDexCandidate = STAGED_SHARED_HISTORY_DEX_CANDIDATE) => {
  const stages = currentCheapDexStages(c);
  // Defer send-only fit admission so held candidates can still be read and
  // pending metadata can be reconciled without selecting historical caps.
  const gasCaps = () => currentCheapDexGasCaps(c);
  const cheapProtocol = currentCheapDexQuoteProtocol(c);
  const cheapOpening = new Interface(cheapProtocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
  const cheapAccept = new Interface(cheapProtocol ? CURRENT_SLIPPAGE_DEX_ACCEPT_ABI : CURRENT_DEX_ACCEPT_ABI);
  const quoteMethod = (profile: CurrentCheapDexProfile) => profile === 'fast-pool'
    ? cheapProtocol ? 'quoteFastPool' : 'quoteFastPoolV1' : cheapProtocol ? 'quoteCheapAsync' : 'quoteCheapAsyncV1';
  const acceptMethod = (profile: CurrentCheapDexProfile) => profile === 'fast-pool'
    ? cheapProtocol ? 'acceptFastPool' : 'acceptFastPoolV1' : 'acceptPrivateSwapV1';
  const core = address(c.core, 'current-mode Core'), owner = address(ownerAddress, 'owner');
  const runtime = c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2];
  if (chainId !== BigInt(c.chainId)) throw new Error('Current-mode chain differs.');
  // No timing is persisted or reconstructed from pending metadata on a new issuer/reload.
  const timings = new Map<string, { transactionHash: string; profile: CurrentCheapDexProfile; phase: 'quote' | 'accept';
    sendStartedAtMs: number | null; hashReturnedAtMs: number | null; submissionReturnedAtMs: number | null; checks: CheapTimingCheck[] }>();
  const timingNow = () => {
    try { const ms = performance.now(); return Number.isFinite(ms) && ms >= 0 ? ms : null; }
    catch { return null; } // Missing diagnostic clock must not change sender behavior.
  };
  const elapsed = (start: number | null, end: number | null) =>
    start !== null && end !== null && end >= start ? end - start : null;
  const observeSend = (profile: CurrentCheapDexProfile, phase: 'quote' | 'accept', progress?: CurrentDexSendProgress) => {
    let started: number | null = null;
    return { sendStarted: () => { started = timingNow(); progress?.walletRequested?.(); },
      hashReturned: (transactionHash: string) => {
        timings.set(transactionHash.toLowerCase(), { transactionHash: transactionHash.toLowerCase(), profile, phase,
          sendStartedAtMs: started, hashReturnedAtMs: timingNow(), submissionReturnedAtMs: null, checks: [] });
        progress?.transactionHashReturned?.(transactionHash);
      }, submissionReturned: (transactionHash: string) => {
      const known = timings.get(transactionHash.toLowerCase());
      if (known) known.submissionReturnedAtMs = timingNow();
      else timings.set(transactionHash.toLowerCase(), { transactionHash: transactionHash.toLowerCase(), profile, phase,
        sendStartedAtMs: started, hashReturnedAtMs: null, submissionReturnedAtMs: timingNow(), checks: [] });
    } };
  };
  const timedVerification = async <T>(transactionHash: string, scope: NonNullable<CheapTimingCheck['verificationScope']>,
    verify: (observation?: { receiptStarted(): void; receiptFinished(outcome: 'received' | 'missing' | 'error'): void }) => Promise<T>) => {
    const timing = timings.get(transactionHash.toLowerCase());
    if (!timing) return verify();
    const check: CheapTimingCheck = { startedAtMs: timingNow(), receiptStartedAtMs: null, receiptFinishedAtMs: null,
      receiptObservation: null, finishedAtMs: null, successfulVerifiedAtMs: null, verificationScope: null };
    timing.checks.push(check);
    const observation = { receiptStarted: () => { check.receiptStartedAtMs = timingNow(); },
      receiptFinished: (outcome: 'received' | 'missing' | 'error') => { check.receiptFinishedAtMs = timingNow(); check.receiptObservation = outcome; } };
    try { const result = await verify(observation); check.successfulVerifiedAtMs = timingNow(); check.verificationScope = scope; return result; }
    finally { check.finishedAtMs = check.successfulVerifiedAtMs ?? timingNow(); }
  };
  let reservations = currentReservations.get(signer);
  if (!reservations) {
    reservations = { quote: new Set(), accept: new Set(), actions: new Set(), acceptRequests: new Map() };
    currentReservations.set(signer, reservations);
  }
  const recovered = reservations.cheapRecovered ??= new Map();
  const reviewed = reservations.cheapReviewed ??= new Map();
  const storage = currentDexPendingStorage({ chainId, graph: c.graph, owner });
  const reloadScope = Object.freeze({owner,graph:c.graph,chainId});
  const closedTrialScopes = reservations.cheapClosedTrials ??= new Set<string>();
  const closedAccountingScopes = new Set<string>();
  let savedReload: string | undefined;
  let recoveringRecord: CurrentDexNativeReloadRecord | null = null;
  const retainedRecords = () => [readCurrentDexNativeReload(storage, false), readCurrentDexNativeReload(storage, true)];
  const retainedRecordBytes = () => JSON.stringify(retainedRecords());
  const authenticateRetainedRecord = async () => {
    const retained = retainedRecords(), bytes = JSON.stringify(retained), checked = new Set<string>();
    // Historical evidence stays separate; its graph never grants current send authority.
    for (const record of retained) {
      const recordBytes = JSON.stringify(record);
      if (!record || record.budget.owner !== owner.toLowerCase() || checked.has(recordBytes)) continue;
      if (!authenticateReload || await authenticateReload(record.budget) !== record.authentication)
        throw new Error('Retained owner reload record authentication failed.');
      await transport.assertCurrent();
      checked.add(recordBytes);
    }
    if (retainedRecordBytes() !== bytes) throw new Error('Retained owner record changed during authentication.');
    return bytes;
  };
  const persistBudget = async () => {
    if(!usesCurrentSwapAccounting(c))return;
    if(!authenticateReload)throw new Error('Owner-authenticated reload reservations are unavailable.');
    savedReload??=JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false));
    const retainedBytes = isCurrentDexBrowserSigner(signer,c.graph,owner) ? await authenticateRetainedRecord() : undefined;
    const budget=currentNativeSwapCheckpoint(signer);validateCurrentNativeSwapCheckpoint(budget,owner,c,signer);
    const authentication=await authenticateReload(budget);await transport.assertCurrent();
    if(retainedBytes !== undefined && retainedRecordBytes() !== retainedBytes)throw new Error('Retained owner record changed during this wallet session.');
    if(JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false))!==savedReload)throw new Error('Native reload reservation changed during this wallet session.');
    writeCurrentDexNativeReload(storage,{budget,authentication},isCurrentDexBrowserSigner(signer,c.graph,owner)&&budget.version===2?reloadScope:undefined);
    savedReload=JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false));
  };
  const rememberHash = async (sent: {request:TransactionRequest;transactionHash:string}) => {
    if(!usesCurrentSwapAccounting(c))return;
    recordCurrentNativeSwapHash(signer,sent.request.nonce!,keccak256(sent.request.data).toLowerCase(),sent.transactionHash.toLowerCase());await persistBudget();
  };
  const issuedKey = (issued: CurrentCheapDexIssuedQuote) =>
    `${issued.intent.profile}:${issued.operationId}:${issued.transactionHash}`.toLowerCase();
  const capturedQuote = (issued: CurrentCheapDexIssuedQuote) => {
    const captured = recovered.get(issuedKey(issued));
    if (!captured || captured.origin.number !== issued.originBlock.number || captured.origin.hash !== issued.originBlock.hash) {
      throw new Error('Current-mode Quote was not recovered in this session.');
    }
    return captured.prepared;
  };
  // decision-033: releases the unsent reservation that the rejected record owns in this owner record.
  // A swap action always owns one. A swap approval owns one. Other token actions own none. A throw keeps the lock.
  const isSwapPhase = (phase: CurrentDexPendingAttempt['phase']): phase is 'quote' | 'accept' | 'cancel' | 'recover' =>
    phase === 'quote' || phase === 'accept' || phase === 'cancel' || phase === 'recover';
  const releaseUnsentLedgerReservation = async (attempt: CurrentDexPendingAttempt) => {
    const swap = isSwapPhase(attempt.phase);
    if (!swap && attempt.phase !== 'token-approve' && attempt.phase !== 'token-faucet' && attempt.phase !== 'token-refill')
      throw new Error('This owner record has no release step for this action.');
    if (!usesCurrentSwapAccounting(c)) return;
    if (!isCurrentDexBrowserSigner(signer, c.graph, owner) || !authenticateReload) throw new Error('Owner-authenticated reload reservations are unavailable.');
    const saved = readCurrentDexNativeReload(storage, reloadScope);
    if (!saved) throw new Error('Owner normal-use record is unavailable.');
    validateCurrentNativeSwapCheckpoint(saved.budget, owner, c, signer);
    if (await authenticateReload(saved.budget) !== saved.authentication) throw new Error('Owner reload record authentication failed.');
    await transport.assertCurrent();
    if (!hasCurrentNativeSigningBudget(signer)) restoreCurrentNativeSwapCheckpoint(signer, owner, c, saved.budget);
    else if (JSON.stringify(currentNativeSwapCheckpoint(signer)) !== JSON.stringify(saved.budget)) throw new Error('Live native budget differs from the saved owner record.');
    const ledgerPhase = isSwapPhase(attempt.phase) ? attempt.phase : attempt.phase === 'token-approve' ? 'token-funding' as const : null;
    const budget = currentNativeSwapCheckpoint(signer);
    const releasedBefore = ledgerPhase === 'token-funding' && !!budget.released?.some(row =>
      row.phase === 'token-funding' && row.nonce === attempt.nonce && row.key.endsWith(`:${attempt.callHash}`));
    // A Limit or Pool approval, a claim and a refill reserve nothing here. Their admission proved that no reservation was open.
    if (!swap && !releasedBefore && budget.charges.every(row => row.hash !== null)) return;
    if (!ledgerPhase) throw new Error('The owner record has an open reservation that this action does not own.');
    const undo = releaseCurrentNativeSwapCharge(signer, owner, c, attempt.nonce, attempt.callHash, ledgerPhase);
    if (!undo) return;
    try { await persistBudget(); } catch (error) { undo(); throw error; }
  };
  const { pending, requireEmptyPending, requirePoolTopUpHandoff, requireOwnPending, currentHead, requireNativeResources, sendCurrent, verifyMinedCall, recheckMinedCall, releaseUnsent } =
    createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now, historical: false,
      releaseReservation: async attempt => {
        if (!isSwapPhase(attempt.phase)) throw new Error('This adapter releases swap actions only.');
        await releaseUnsentLedgerReservation(attempt);
      } });
  const admitNormalOwnerRecord = async (requireIdle = true, swapScope?: string, actionGasCap?: bigint, heldSnapshot?: CurrentDexPendingAttempt, topUpHandoff?: CurrentDexPendingAttempt) => {
    if(!isCurrentDexBrowserSigner(signer,c.graph,owner))return;
    const saved=readCurrentDexNativeReload(storage,reloadScope), recordBytes=JSON.stringify(saved),
      legacy=readCurrentDexNativeReload(storage,false,reloadScope),legacyBytes=JSON.stringify(legacy);
    if(saved)validateCurrentNativeSwapCheckpoint(saved.budget,owner,c,signer);
    if(legacy&&saved?.budget.version===2)validateCurrentNativeSwapCheckpoint(legacy.budget,owner,c);
    if(!authenticateReload)throw new Error('Owner-authenticated reload reservations are unavailable.');
    const retainedBytes = await authenticateRetainedRecord();
    if(saved&&await authenticateReload(saved.budget)!==saved.authentication)throw new Error('Owner reload record authentication failed.');
    if(legacy&&saved?.budget.version===2&&await authenticateReload(legacy.budget)!==legacy.authentication)
      throw new Error('Retained owner reload record authentication failed.');
    await transport.assertCurrent();
    if(JSON.stringify(readCurrentDexNativeReload(storage,reloadScope))!==recordBytes||JSON.stringify(readCurrentDexNativeReload(storage,false,reloadScope))!==legacyBytes||retainedRecordBytes()!==retainedBytes)
      throw new Error('Owner records changed during normal-use admission.');
    // decision-033 part C: all tabs share the saved owner record. A tab whose record in memory differs from it
    // holds older data. It does not send, and it never writes its older record over the saved record.
    if(saved&&hasCurrentNativeSigningBudget(signer)&&JSON.stringify(currentNativeSwapCheckpoint(signer))!==JSON.stringify(saved.budget))
      throw new Error(CURRENT_DEX_STALE_TAB_MESSAGE);
    const lookups=readCurrentDexOperationLookups(storage);
    if (!requireIdle && swapScope && actionGasCap === 5_000_000n && saved?.budget.activeSwap && saved.budget.activeSwap !== swapScope && verifySwapAllowanceCleanup &&
        !pending() && !lookups.length && !saved.budget.charges.some(row => !row.hash) &&
        saved.budget.charges.filter(row => row.scope === saved.budget.activeSwap).every(row => row.phase === 'token-funding')) {
      await reconcileSwapAllowanceCleanup();
      return admitNormalOwnerRecord(requireIdle, swapScope, actionGasCap);
    }
    if(!requireIdle&&saved){
      const retained=heldSnapshot&&actionGasCap===30_000_000n&&!swapScope&&c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&
        heldPoolSnapshotRefreshEligible(heldSnapshot,{chainId:String(chainId),owner,core,graph:`0x${c.graph}`})&&
        JSON.stringify(pending())===JSON.stringify(heldSnapshot);
      if(heldSnapshot&&!retained)throw new Error('Original snapshot hold changed during owner admission.');
      const topUp=topUpHandoff&&!heldSnapshot&&actionGasCap===30_000_000n&&!swapScope&&c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&
        !!topUpHandoff.txHash&&JSON.stringify(requirePoolTopUpHandoff(topUpHandoff.txHash))===JSON.stringify(topUpHandoff);
      if(topUpHandoff&&!topUp)throw new Error('Top-up funding journal changed during owner admission.');
      if(pending()&&!retained&&!topUp||saved.budget.charges.some(row=>!row.hash)||saved.budget.activeSwap!==null&&saved.budget.activeSwap!==swapScope||
          legacy&&saved.budget.version===2&&(legacy.budget.activeSwap!==null||legacy.budget.charges.some(row=>!row.hash))||
          lookups.some(row=>!swapScope||!saved.budget.charges.some(charge=>charge.scope===swapScope&&charge.hash===row.attempt.txHash)))
        throw new Error('Reconcile the pending or active owner record before this action.');
      return;
    }
    if(pending()||lookups.length||[saved,legacy].some(record=>record&&record.budget.charges.some(row=>!row.hash)))
      throw new Error('Reconcile the pending or active owner record before normal use.');
    if(saved?.budget.activeSwap!==null&&saved){
      const lastScope=saved.budget.charges[saved.budget.charges.length-1]?.scope,
        funding=saved.budget.charges.slice(saved.budget.version===1?CURRENT_OWNER_BETA.legacyStarts:0).filter(row=>row.scope===lastScope);
      if(!funding.length||funding.some(row=>row.phase!=='token-funding'))throw new Error('Reconcile the active owner swap before another Quote.');
      await restoreFundingBudget();return;
    }
    if(legacy&&saved?.budget.version===2&&legacy.budget.activeSwap!==null)
      throw new Error('Reconcile the retained active owner record before normal use.');
    // Intact closed v1 continuations keep their complete authenticated accounting.
    if(saved?.budget.version===2||saved&&saved.budget.charges.length>CURRENT_OWNER_BETA.legacyStarts)return;
    if(hasCurrentNativeSigningBudget(signer)){
      const live=currentNativeSwapCheckpoint(signer);
      if(saved&&JSON.stringify(live)===JSON.stringify(saved.budget))return;
      if(live.version!==2||live.activeSwap!==null||live.charges.length)throw new Error('Reconcile the existing signing budget before normal use.');
    }
    const cap=actionGasCap??gasCaps()['fast-pool'].quote;
    const head=await currentHead(undefined,cap,cap===gasCaps()['fast-pool'].quote);
    const resources=await requireNativeResources(head,undefined,cap);
    if(!resources)throw new Error('Owner normal-use resources are unavailable.');
    assertCurrentDexBrowserWindow(signer,c.graph,owner,core,chainId,now(),resources.latestNonce,cap,currentSwapFixedGasPrice(c));
    const budget:CurrentNativeSwapCheckpoint=hasCurrentNativeSigningBudget(signer)?currentNativeSwapCheckpoint(signer):
      {version:2,owner:owner.toLowerCase(),candidateGraph:c.graph,start:String(now()),committedWei:'0',activeSwap:null,charges:[]};
    validateCurrentNativeSwapCheckpoint(budget,owner,c,signer);
    const authentication=await authenticateReload(budget);await transport.assertCurrent();
    if(JSON.stringify(readCurrentDexNativeReload(storage,reloadScope))!==recordBytes||JSON.stringify(readCurrentDexNativeReload(storage,false,reloadScope))!==legacyBytes||retainedRecordBytes()!==retainedBytes||pending()||readCurrentDexOperationLookups(storage).length)
      throw new Error('Owner records changed during normal-use admission.');
    writeCurrentDexNativeReload(storage,{budget,authentication},isCurrentDexBrowserSigner(signer,c.graph,owner)&&budget.version===2?reloadScope:undefined);
    restoreCurrentNativeSwapCheckpoint(signer,owner,c,budget);
    savedReload=JSON.stringify(readCurrentDexNativeReload(storage,reloadScope));
  };
  const reconcileSwapAllowanceCleanup = async (complete = true, cleanupToken?: string) => {
    if (!isCurrentDexBrowserSigner(signer, c.graph, owner) || !verifySwapAllowanceCleanup || !authenticateReload) throw new Error('Browser allowance cleanup proof is unavailable.');
    requireEmptyPending();
    const saved = readCurrentDexNativeReload(storage, reloadScope), bytes = JSON.stringify(saved), retained = await authenticateRetainedRecord();
    if (!saved || saved.budget.activeSwap === null) return;
    validateCurrentNativeSwapCheckpoint(saved.budget, owner, c, signer);
    if (await authenticateReload(saved.budget) !== saved.authentication) throw new Error('Owner reload record authentication failed.');
    const scope = saved.budget.activeSwap, funding = saved.budget.charges.filter(row => row.scope === scope);
    if (!funding.length || funding.some(row => row.phase !== 'token-funding' || !row.hash) || saved.budget.charges.some(row => !row.hash) ||
        readCurrentDexOperationLookups(storage).length) throw new Error('Reconcile the pending or active owner record before clearing its allowance.');
    const checked: { request: TransactionRequest; receipt: MinedReceipt; hash: string }[] = [];
    for (const charge of funding) {
      const tx = await transport.readTransaction(charge.hash!); await transport.assertCurrent();
      if (!tx) throw new Error('Original owner beta approval is unavailable.');
      const request = fundingRequest(charge, tx), receipt = await verifyMinedCall(request, charge.hash!, true);
      if (cleanupToken && !sameAddress(request.to, cleanupToken)) throw new Error('Active allowance cleanup token changed.');
      checked.push({ request, receipt, hash: charge.hash! });
    }
    const head = await currentHead(undefined, 5_000_000n);
    if (!transport.readNativeResources) throw new Error('Allowance cleanup nonce observation is unavailable.');
    const resources = await transport.readNativeResources(head);
    const checkResources = (value: CurrentNativeResources) => {
      if (!sameAddress(value.owner, owner) || value.chainId !== chainId || value.code !== '0x' || value.head.number !== head.number ||
          value.head.hash !== head.hash || value.head.timestamp !== head.timestamp || value.head.gasLimit !== head.gasLimit ||
          !Number.isSafeInteger(value.latestNonce) || value.latestNonce !== value.pendingNonce ||
          value.latestNonce <= Math.max(...saved.budget.charges.map(row => row.nonce)) || head.timestamp > now() || now() - head.timestamp >= 90n) {
        throw new Error('Allowance cleanup has an unresolved wallet nonce or changed identity.');
      }
    };
    checkResources(resources);
    const last = checked[checked.length - 1];
    if (complete) await verifySwapAllowanceCleanup(last.request, last.hash);
    for (const row of checked) await recheckMinedCall(row.request, row.hash, row.receipt, true);
    const closed = complete ? Object.freeze({ ...saved.budget, activeSwap: null }) : saved.budget,
      authentication = await authenticateReload(closed);
    const finalResources = await transport.readNativeResources(head); checkResources(finalResources);
    if (finalResources.latestNonce !== resources.latestNonce) throw new Error('Allowance cleanup wallet nonce changed during reconciliation.');
    await transport.assertCurrent(); requireEmptyPending();
    if (JSON.stringify(readCurrentDexNativeReload(storage, reloadScope)) !== bytes || retainedRecordBytes() !== retained || readCurrentDexOperationLookups(storage).length ||
        hasCurrentNativeSigningBudget(signer) && JSON.stringify(currentNativeSwapCheckpoint(signer)) !== JSON.stringify(saved.budget)) {
      throw new Error('Owner records changed during allowance cleanup reconciliation.');
    }
    if (complete) writeCurrentDexNativeReload(storage, { budget: closed, authentication }, reloadScope);
    restoreCurrentNativeSwapCheckpoint(signer, owner, c, saved.budget);
    if (complete) completeCurrentNativeSwapScope(signer, scope);
    savedReload = JSON.stringify(readCurrentDexNativeReload(storage, reloadScope));
  };
  const assertSwapAllowanceCleanupIdle = async (prepared: CurrentCheapDexPreparedQuote) => {
    validateQuote(prepared, true); assertCurrentSwapCandidate(c, prepared.intent, signer);
    if (!isCurrentDexBrowserSigner(signer, c.graph, owner)) throw new Error('Swap allowance cleanup requires the current browser wallet.');
    const savedCleanup = readCurrentDexNativeReload(storage, reloadScope);
    if (savedCleanup?.budget.activeSwap && verifySwapAllowanceCleanup &&
        savedCleanup.budget.charges.filter(row => row.scope === savedCleanup.budget.activeSwap).every(row => row.phase === 'token-funding')) {
      // A mined positive approval permits only zero cleanup; closure still needs its private proof.
      await reconcileSwapAllowanceCleanup(false, prepared.intent.inputToken);
      const legacy = readCurrentDexNativeReload(storage, false, reloadScope);
      if (legacy && (legacy.budget.activeSwap !== null || legacy.budget.charges.some(charge => !charge.hash)))
        throw new Error('Reconcile the retained owner record before clearing its allowance.');
      return;
    }
    const requireIdle = () => {
      requireEmptyPending();
      const records = [readCurrentDexNativeReload(storage, reloadScope), readCurrentDexNativeReload(storage, false, reloadScope)];
      if (readCurrentDexOperationLookups(storage).length || records.some(record => record &&
          (record.budget.activeSwap !== null || record.budget.charges.some(charge => !charge.hash))) ||
          hasCurrentNativeSigningBudget(signer) && (currentNativeSwapCheckpoint(signer).activeSwap !== null ||
            currentNativeSwapCheckpoint(signer).charges.some(charge => !charge.hash))) {
        throw new Error('Reconcile the pending or active owner record before clearing its allowance.');
      }
    };
    requireIdle();
    await admitNormalOwnerRecord(false, `quote:${keccak256(prepared.data)}`, 5_000_000n);
    const admitted = JSON.stringify(readCurrentDexNativeReload(storage, reloadScope)), legacy = JSON.stringify(readCurrentDexNativeReload(storage, false, reloadScope));
    await transport.assertCurrent(); requireIdle();
    const saved = readCurrentDexNativeReload(storage, reloadScope);
    if (!saved || JSON.stringify(saved) !== admitted || JSON.stringify(readCurrentDexNativeReload(storage, false, reloadScope)) !== legacy ||
        hasCurrentNativeSigningBudget(signer) && JSON.stringify(currentNativeSwapCheckpoint(signer)) !== JSON.stringify(saved.budget)) {
      throw new Error('Owner signing budget changed before allowance cleanup.');
    }
  };
  const assertAllowanceMutationIdle = async (prepared?: CurrentCheapDexPreparedQuote) => {
    if (prepared) { validateQuote(prepared, true); assertCurrentSwapCandidate(c, prepared.intent, signer); }
    const allowedScope = prepared ? `quote:${keccak256(prepared.data)}` : undefined;
    const records = () => [readCurrentDexNativeReload(storage, reloadScope), readCurrentDexNativeReload(storage, false, reloadScope)];
    const initial = records(), bytes = JSON.stringify(initial);
    const checkBudget = (budget: CurrentNativeSwapCheckpoint) => {
      // Swap signing still reconciles old funding-only scopes before a new send.
      if (budget.charges.some(row => !row.hash) || budget.activeSwap !== null &&
          (!allowedScope || budget.charges.filter(row => row.scope === budget.activeSwap).some(row => row.phase !== 'token-funding'))) {
        throw new Error('Reconcile the active swap before changing token approvals.');
      }
    };
    const check = () => {
      requireEmptyPending();
      if (ownLookups().length) throw new Error('Reconcile the pending swap before changing token approvals.');
      for (const record of records()) if (record) checkBudget(record.budget);
      if (hasCurrentNativeSigningBudget(signer)) checkBudget(currentNativeSwapCheckpoint(signer));
    };
    check();
    for (const record of initial) if (record) {
      if (!authenticateReload || await authenticateReload(record.budget) !== record.authentication)
        throw new Error('Owner reload record authentication failed.');
    }
    await transport.assertCurrent(); check();
    if (JSON.stringify(records()) !== bytes) throw new Error('Owner record changed during token approval review.');
  };
  const fundingRequest = (charge: CurrentNativeSwapCheckpoint['charges'][number], tx: SubmittedTransaction,
    prepared?: CurrentCheapDexPreparedQuote): TransactionRequest => {
    if (!['token-funding', 'token-faucet'].includes(charge.phase) || tx.nonce !== charge.nonce || tx.chainId !== chainId ||
        !sameAddress(tx.from, owner) || !tx.to || !c.tokens.some(token => sameAddress(token[0], tx.to!)) ||
        tx.value !== 0n || tx.gasLimit !== 5_000_000n || charge.key !== `${charge.phase}:${charge.scope}:${keccak256(tx.data)}`) {
      throw new Error('Native reload funding transaction changed.');
    }
    if (charge.phase === 'token-funding') {
      const call = currentTokenFundingAbi.parseTransaction({ data: tx.data });
      if (!call || !['approve', ...(c.graph === STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph ? ['increaseAllowance'] : [])].includes(call.name) ||
          !sameAddress(decodeCanonical(tx.data, currentTokenFundingAbi, call.name)[0], core) ||
          prepared && charge.scope === `quote:${keccak256(prepared.data)}` && !sameAddress(tx.to, prepared.intent.inputToken)) throw new Error('Native reload approval token or spender changed.');
    } else if (tx.data !== new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet')) {
      throw new Error('Native reload initial claim changed.');
    }
    return { chainId, from: owner, to: tx.to, value: 0n, data: tx.data, nonce: charge.nonce,
      gasLimit: 5_000_000n, gasPrice: currentNativeSwapChargeGasPrice(charge) };
  };
  const restoreFundingBudget = async (prepared?: CurrentCheapDexPreparedQuote, approvalRequest?: TransactionRequest) => {
    if(isCurrentDexBrowserSigner(signer,c.graph,owner)&&!readCurrentDexNativeReload(storage,reloadScope))await admitNormalOwnerRecord();
    const saved=readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false);
    if(!usesCurrentSwapAccounting(c)||!saved)return;
    const scope = prepared ? `quote:${keccak256(prepared.data)}` : undefined;
    const expired = isCurrentDexBrowserSigner(signer,c.graph,owner) ? false :
      now() >= BigInt(saved.budget.windowStart ?? saved.budget.start) +
        (hasCurrentPartialRefundProof(c.graph,owner,saved.budget.charges)?7200n:CURRENT_NATIVE_SWAP_LIMITS.normalSeconds);
    if(prepared && hasCurrentNativeSigningBudget(signer) && !pending() && !ownLookups().length &&
        currentNativeSwapCheckpoint(signer).activeSwap === null && (isCurrentDexBrowserSigner(signer,c.graph,owner) || !expired && saved.budget.charges.some(row=>closedTrialScopes.has(row.scope)))) {
      if(JSON.stringify(currentNativeSwapCheckpoint(signer))!==JSON.stringify(saved.budget))
        throw new Error(isCurrentDexBrowserSigner(signer,c.graph,owner)?CURRENT_DEX_STALE_TAB_MESSAGE:'Closed trial reservation changed.');
      validateCurrentNativeSwapCheckpoint(saved.budget,owner,c,signer);
      await requireFunding(prepared,await currentHead(prepared.intent.deadline,gasCaps()[prepared.profile].quote,true),!!approvalRequest);
      return;
    }
    if(hasCurrentNativeSigningBudget(signer) && (!prepared || !expired && currentNativeSwapCheckpoint(signer).activeSwap === scope))return;
    const attempt = pending();
    if (prepared && (ownLookups().length || attempt && (!approvalRequest || attempt.phase !== 'token-approve' ||
        attempt.txHash !== null || attempt.verificationBlocked || attempt.owner !== owner.toLowerCase() ||
        attempt.chainId !== chainId.toString() || attempt.core !== core.toLowerCase() || attempt.graph !== `0x${c.graph}` ||
        attempt.target !== approvalRequest.to.toLowerCase() || attempt.nonce !== approvalRequest.nonce ||
        attempt.callHash !== keccak256(approvalRequest.data)))) throw new Error('Reconcile the earlier operation before renewing funding.');
    validateCurrentNativeSwapCheckpoint(saved.budget,owner,c,signer);
    if(isCurrentDexBrowserSigner(signer,c.graph,owner)){
      if(pending()||ownLookups().length||!authenticateReload||await authenticateReload(saved.budget)!==saved.authentication)
        throw new Error('Owner beta funding has no authenticated continuation.');
      const activeScope=saved.budget.activeSwap;
      const lastScope=saved.budget.charges[saved.budget.charges.length-1]?.scope;
      const funding=activeScope===null?[]:saved.budget.charges.slice(saved.budget.version===1?CURRENT_OWNER_BETA.legacyStarts:0).filter(row=>row.scope===lastScope);
      if(activeScope!==null&&(!funding.length||funding.some(row=>!row.hash||row.phase!=='token-funding')))
        throw new Error('Reconcile the active owner beta swap before another Quote.');
      const checked:{request:TransactionRequest;receipt:MinedReceipt;hash:string}[]=[];
      for(const charge of funding){
        const tx=await transport.readTransaction(charge.hash!);await transport.assertCurrent();
        if(!tx)throw new Error('Original owner beta approval is unavailable.');
        const request=fundingRequest(charge,tx,prepared),receipt=await verifyMinedCall(request,charge.hash!);
        checked.push({request,receipt,hash:charge.hash!});
      }
      if(prepared)await requireFunding(prepared,await currentHead(prepared.intent.deadline,gasCaps()[prepared.profile].quote,true),!!approvalRequest);
      for(const row of checked)await recheckMinedCall(row.request,row.hash,row.receipt);
      await transport.assertCurrent();
      if(JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false))!==JSON.stringify(saved)||pending()||ownLookups().length)
        throw new Error('Owner beta reload records changed during funding restoration.');
      restoreCurrentNativeSwapCheckpoint(signer,owner,c,saved.budget);
      if(scope&&activeScope!==null&&scope!==activeScope){bindCurrentNativeSwapFundingScope(signer,scope);await persistBudget();}
      return;
    }
    if(saved.budget.charges.some(charge => !charge.hash || !['token-funding','token-faucet'].includes(charge.phase)) ||
        !authenticateReload || await authenticateReload(saved.budget)!==saved.authentication) throw new Error('Original funding has no authenticated continuation.');
    const checked: {request: TransactionRequest; receipt: MinedReceipt; hash: string}[] = [];
    for (const charge of saved.budget.charges) {
      const tx=await transport.readTransaction(charge.hash!);await transport.assertCurrent();
      if(!tx)throw new Error('Original funding transaction is unavailable.');
      const request=fundingRequest(charge,tx,prepared), receipt=await verifyMinedCall(request,charge.hash!);
      checked.push({request,receipt,hash:charge.hash!});
    }
    if (prepared) await requireFunding(prepared, await currentHead(prepared.intent.deadline, gasCaps()[prepared.profile].quote, true), !!approvalRequest);
    for (const row of checked) await recheckMinedCall(row.request,row.hash,row.receipt);
    await transport.assertCurrent();
    if(JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false))!==JSON.stringify(saved))throw new Error('Funding reservation changed during restoration.');
    if (JSON.stringify(pending()) !== JSON.stringify(attempt) || prepared && ownLookups().length) throw new Error('Pending operation changed during funding restoration.');
    restoreCurrentNativeSwapCheckpoint(signer,owner,c,saved.budget);
    if (scope) {
      if (expired) renewCurrentNativeSwapFundingWindow(signer,owner,c,scope,now());
      else bindCurrentNativeSwapFundingScope(signer,scope);
      await persistBudget();
    }
  };
  const ownLookups = () => readCurrentDexOperationLookups(storage).filter(({ attempt }) =>
    attempt.chainId === chainId.toString() && attempt.owner === owner.toLowerCase() &&
    attempt.core === core.toLowerCase() && attempt.graph === `0x${c.graph}`);
  const operationLookup = (issued: CurrentCheapDexIssuedQuote) => ownLookups().find(row =>
    row.operationId === issued.operationId.toString() &&
    row.deadline === issued.operation.deadline.toString());
  const acceptedReceipts = new Map<string, MinedReceipt>();
  const failPrivateVerification = (issued: CurrentCheapDexIssuedQuote, error: unknown): never => {
    const attempt = pending();
    if (attempt && ['quote', 'accept', 'cancel', 'recover'].includes(attempt.phase)) blockCurrentSwapVerification(storage, attempt);
    const lookup = operationLookup(issued);
    if (lookup) blockCurrentDexOperationVerification(storage, lookup);
    throw new CurrentDexPrivateReceiptError(error instanceof Error ? error.message : 'Current-mode private verification failed.');
  };
  const verifyTokens = async (issued: CurrentCheapDexIssuedQuote, amounts: CurrentDexOwnerTokenAmounts,
    phase: CurrentDexOwnerTokenPhase, receipt: MinedReceipt, contextHash = issued.operation.contextHash) => {
    if (!usesCurrentSwapAccounting(c)) return;
    try {
      if (!verifyOwnerTokens) throw new Error('Current-mode owner token checks are unavailable.');
      await verifyOwnerTokens({ issued, amounts, phase, receipt, contextHash });
      await transport.assertCurrent();
    } catch (error) { failPrivateVerification(issued, error); }
  };
  const fundingAmounts = (issued: CurrentCheapDexIssuedQuote): CurrentDexOwnerTokenAmounts => Object.freeze({
    filled: false, maximumInput: issued.intent.maximumInput, actualInput: 0n, refund: issued.intent.maximumInput,
    grossOutput: 0n, fee: 0n, netOutput: 0n });
  const requireLookupCapacity = () => {
    if (readCurrentDexOperationLookups(storage).length >= 32) {
      throw new Error('Current DEX operation lookup limit reached. Verify an existing private result first.');
    }
  };
  const pair = (input: string, output: string) => c.tokens.some(([token]) => sameAddress(token, input)) &&
    c.tokens.some(([token]) => sameAddress(token, output)) && !sameAddress(input, output);
  const validateQuote = (prepared: CurrentCheapDexPreparedQuote, expired = false, restorationRead = false) => {
    assertCurrentCheapDexPreparedQuote(prepared, signer);
    const i = prepared.intent;
    if (usesCurrentNativeSwapChecks(c) && !restorationRead) assertCurrentNativeSwapIntent(prepared, now(), expired, false, signer);
    if(restorationRead)assertCurrentSwapIdentity(c);
    if (prepared.profile !== 'fast-pool' && prepared.profile !== 'cheap-async' || i.profile !== prepared.profile ||
        prepared.readyToSign !== false || prepared.graph !== c.graph || prepared.chainId !== chainId ||
        prepared.manifestHash !== keccak256(toUtf8Bytes(JSON.stringify(c))) ||
        !sameAddress(prepared.from, owner) || !sameAddress(prepared.to, core) || prepared.value !== 0n ||
        i.chainId !== chainId || !sameAddress(i.principal, owner) || !sameAddress(i.core, core) ||
        i.runtimeHash !== runtime || i.releaseId !== c.releaseId || i.quoteProtocol !== cheapProtocol ||
        (cheapProtocol ? !Number.isInteger(i.toleranceBps) || i.toleranceBps! < 0 || i.toleranceBps! > 10000 : i.toleranceBps !== undefined) ||
        !pair(i.inputToken, i.outputToken) ||
        sameAddress(i.destination, core) || (!expired && now() >= i.deadline)) {
      throw new Error('Current-mode Quote plan changed or expired.');
    }
    const decoded = decodeCanonical(prepared.data, cheapOpening, quoteMethod(prepared.profile));
    const terms = prepared.profile === 'cheap-async' ? decoded.request : decoded;
    if (!sameAddress(terms[0], i.inputToken) || !sameAddress(terms[1], i.outputToken) ||
        !sameAddress(terms[2], i.destination) || terms[3] !== i.deadline ||
        (cheapProtocol && terms.toleranceBps !== BigInt(i.toleranceBps!))) throw new Error('Current-mode Quote calldata changed.');
  };
  const nativeSigning = (phase: 'quote' | 'accept' | 'cancel' | 'recover', cap: bigint,
    prepared: CurrentCheapDexPreparedQuote) => {
    if (!usesCurrentNativeSwapChecks(c)) return undefined;
    if(usesCurrentSwapAccounting(c)&&readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false)&&!hasCurrentNativeSigningBudget(signer))throw new Error('Restore the original native budget before another signing request.');
    const budget = currentNativeSigningBudget(signer, owner, now, c), scope = `quote:${keccak256(prepared.data)}`,
      key = phase === 'quote' ? scope : `${phase}:${scope}`;
    const check = () => {
      assertCurrentSwapCandidate(c, prepared.intent, signer); assertCurrentNativeSwapIntent(prepared, now(), phase === 'cancel' || phase === 'recover', false, signer);
      budget.check(phase, key, cap, scope);
    };
    check();
    return async (request: TransactionRequest) => { check(); budget.commit(phase, key, cap, scope, request.nonce); await persistBudget(); };
  };
  const validateIssued = (issued: CurrentCheapDexIssuedQuote, prepared: CurrentCheapDexPreparedQuote) => {
    assertCurrentCheapDexIssuedQuote(issued, signer);
    const i = issued.intent, p = prepared.intent;
    if (issued.intent.profile !== prepared.profile || issued.operation.profile !== prepared.profile ||
        issued.readyToSign !== false || issued.operationId <= 0n || i.operationId !== issued.operationId ||
        issued.chainId !== chainId || !sameAddress(issued.core, core) || !sameAddress(issued.principal, owner) ||
        issued.runtimeHash !== runtime || issued.releaseId !== c.releaseId || issued.operation.phase === 'not-found' ||
        i.profile !== p.profile || i.chainId !== p.chainId || !sameAddress(i.principal, p.principal) ||
        !sameAddress(i.core, p.core) || i.runtimeHash !== p.runtimeHash || i.releaseId !== p.releaseId ||
        !sameAddress(i.inputToken, p.inputToken) || !sameAddress(i.outputToken, p.outputToken) ||
        !sameAddress(i.destination, p.destination) || i.deadline !== p.deadline || issued.operation.deadline !== p.deadline ||
        i.maximumInput !== p.maximumInput || i.minimumInput !== p.minimumInput || i.minimumOutput !== p.minimumOutput ||
        i.rateNumerator !== p.rateNumerator || i.rateDenominator !== p.rateDenominator ||
        i.quoteProtocol !== p.quoteProtocol || i.toleranceBps !== p.toleranceBps ||
        i.contextHash !== issued.operation.contextHash) throw new Error('Current-mode issued intent changed.');
  };
  const refreshReady = async (issued: CurrentCheapDexIssuedQuote, prepared: CurrentCheapDexPreparedQuote, allowExpired = false) => {
    validateIssued(issued, prepared);
    const ready = await issued.readCurrent();
    await transport.assertCurrent();
    validateIssued(ready, prepared);
    if (ready.operationId !== issued.operationId || ready.transactionHash !== issued.transactionHash ||
        ready.originBlock.number !== issued.originBlock.number || ready.originBlock.hash !== issued.originBlock.hash ||
        ready.block.number < issued.block.number ||
        (ready.block.number === issued.block.number && ready.block.hash !== issued.block.hash) ||
        (BigInt(issued.operation.contextHash) !== 0n && ready.operation.contextHash !== issued.operation.contextHash) ||
        !ready.operation.ready || ready.operation.phase !== 'quote-prepared' && !(allowExpired && ready.operation.phase === 'expired-unrecovered') || !allowExpired && now() >= ready.operation.deadline) {
      throw new Error('Current-mode Quote is not READY or changed.');
    }
    return ready;
  };
  const recoverQuote = async (prepared: CurrentCheapDexPreparedQuote, transactionHash: string) => timedVerification(transactionHash, 'quote-issue', async observation => {
    assertCurrentSwapCandidate(c, prepared.intent, signer);
    validateQuote(prepared, true);
    await transport.assertCurrent();
    const issued = await prepared.readIssue(transactionHash);
    await transport.assertCurrent();
    if (!issued) throw new Error('Current-mode Quote receipt is not available.');
    validateIssued(issued, prepared);
    if (issued.transactionHash.toLowerCase() !== hash(transactionHash, 'Quote transaction')) throw new Error('Quote transaction changed.');
    const recorded = pending();
    if (!recorded || recorded.phase !== 'quote' || recorded.callHash !== keccak256(prepared.data).toLowerCase()) {
      throw new Error('Current-mode pending Quote changed.');
    }
    const mined = await verifyMinedCall({ chainId, from: owner, to: core, value: 0n, data: prepared.data,
      nonce: recorded.nonce, gasLimit: gasCaps()[prepared.profile].quote }, transactionHash, false, observation);
    if (issued.originBlock.number !== BigInt(mined.blockNumber!) || issued.originBlock.hash.toLowerCase() !== mined.blockHash!.toLowerCase()) {
      throw new Error('Current-mode Quote canonical issue origin changed.');
    }
    clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, transactionHash));
    recovered.set(issuedKey(issued), { prepared, origin: issued.originBlock });
    return issued; // Async may still be preparing; only a later branded READY read can admit Accept.
  });
  const checkReceiptIntent = (receipt: CurrentCheapReceipt, issued: CurrentCheapDexIssuedQuote,
    prepared: CurrentCheapDexPreparedQuote, origin: { number: bigint; hash: string }, released: boolean,
    expectedContext = issued.operation.contextHash) => {
    if (receipt.operation.profile !== issued.intent.profile || receipt.chainId !== chainId || receipt.operationId !== issued.operationId ||
        !sameAddress(receipt.principal, owner) || !sameAddress(receipt.core, core) || receipt.runtimeHash !== runtime ||
        receipt.releaseId !== c.releaseId || receipt.operation.contextHash !== expectedContext ||
        receipt.operation.deadline !== issued.operation.deadline || receipt.block.number < origin.number) {
      throw new Error('Current-mode private receipt identity changed.');
    }
    const a = receipt.amounts, i = prepared.intent;
    if (a.maximumInput !== i.maximumInput || a.actualInput + a.refund !== a.maximumInput ||
        a.fee + a.netOutput !== a.grossOutput ||
        (released && (receipt.operation.stage !== stages.released || a.filled)) ||
        (!a.filled ? a.actualInput !== 0n || a.refund !== i.maximumInput ||
          a.grossOutput !== 0n || a.fee !== 0n || a.netOutput !== 0n
        : a.actualInput <= 0n || a.actualInput < i.minimumInput || a.netOutput <= 0n ||
          a.netOutput < i.minimumOutput || a.netOutput * i.rateDenominator < a.actualInput * i.rateNumerator)) {
      throw new Error('Current-mode private receipt violates the protected intent.');
    }
  };
  const verifyReceipt = async (issued: CurrentCheapDexIssuedQuote, prepared: CurrentCheapDexPreparedQuote,
    origin: { number: bigint; hash: string }, released = false, expectedContext = issued.operation.contextHash, originalQuote?: CurrentCheapReceipt) => {
    try {
    const receipt = originalQuote ?? await readReceipt(issued, origin);
    await transport.assertCurrent();
    checkReceiptIntent(receipt, issued, prepared, origin, released, expectedContext);
    if(originalQuote&&(!['quote','pending'].includes(receipt.kind)||![stages.ready,stages.funded].includes(receipt.operation.stage??0)))throw new Error('Original Quote receipt is not a canonical READY or funded snapshot.');
    const a = receipt.amounts, i = prepared.intent;
    if (i.quoteProtocol === 'quote-slippage' && a.filled && receipt.kind !== 'quote' && !originalQuote) {
      const quote = reviewed.get(issuedKey(issued));
      if (!quote || quote.context !== issued.operation.contextHash ||
          a.netOutput * quote.actualInput * 10000n < quote.netOutput * a.actualInput * BigInt(10000 - i.toleranceBps!)) {
        throw new Error('Current-mode private delivery violates the reviewed Quote tolerance.');
      }
    }
    return receipt;
    } catch (error) {
      return failPrivateVerification(issued, error);
    }
  };
  const acceptanceResult = async (issued: CurrentCheapDexIssuedQuote, prepared: CurrentCheapDexPreparedQuote,
    request: TransactionRequest, transactionHash: string) => timedVerification(transactionHash,
      issued.intent.profile === 'fast-pool' ? 'fast-private-delivery' : 'async-funded-accept', async observation => {
    const receipt = await verifyMinedCall(request, transactionHash, false, observation);
    const origin = { number: BigInt(receipt.blockNumber!), hash: receipt.blockHash! };
    const observed = await readOperation(issued.intent.profile, issued.operationId, origin);
    await transport.assertCurrent();
    await attest(await transport.readHead());
    await transport.assertCurrent();
    if (observed.operation.contextHash !== issued.operation.contextHash || observed.operation.deadline !== issued.operation.deadline) {
      throw new Error('Current-mode Accept operation changed.');
    }
    let delivery: Readonly<CurrentCheapReceipt & { releaseAction: null }> | undefined;
    if (issued.intent.profile === 'cheap-async') {
      const event = uniqueCheapEvent(receipt, core, 'CheapAsyncAdvanced');
      if (event.quoteId !== issued.operationId || event.stage !== BigInt(stages.funded) || event.context !== issued.operation.contextHash ||
          ![stages.funded, stages.settled, stages.released].includes(observed.operation.stage ?? 0)) throw new Error('Current-mode Accept has no exact funded event.');
      await verifyTokens(issued, fundingAmounts(issued), 'accept', receipt);
    } else {
      if (observed.operation.phase !== 'consumed-unverified' || observed.operation.ready) throw new Error('Fast Accept is not consumed.');
      const privateReceipt = await verifyReceipt(issued, prepared, origin);
      await verifyTokens(issued, privateReceipt.amounts, 'fast-settle', receipt);
      delivery = Object.freeze({ ...privateReceipt, releaseAction: null });
    }
    await recheckMinedCall(request, transactionHash, receipt);
    const recorded = pending();
    if (!recorded || recorded.phase !== 'accept' || recorded.callHash !== keccak256(request.data).toLowerCase()) {
      throw new Error('Current-mode pending Accept changed.');
    }
    if (issued.intent.profile === 'cheap-async') recordCurrentDexOperationLookup(storage, {
      attempt: requireOwnPending(recorded, transactionHash), operationId: issued.operationId.toString(),
      contextHash: issued.operation.contextHash, deadline: issued.operation.deadline.toString(),
      origin: { number: receipt.blockNumber!, hash: receipt.blockHash!.toLowerCase() }
    });
    clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, transactionHash));
    if (usesCurrentSwapAccounting(c)) acceptedReceipts.set(issuedKey(issued), receipt);
    if (usesCurrentNativeSwapChecks(c) && issued.intent.profile === 'fast-pool') {
      completeCurrentNativeSwapScope(signer, `quote:${keccak256(prepared.data)}`); await persistBudget();
    }
    return Object.freeze({ operationId: issued.operationId, transactionHash: transactionHash.toLowerCase(),
      status: issued.intent.profile === 'fast-pool' ? 'settled' as const : 'settlement-pending' as const,
      ...(delivery ? { delivery } : {}),
      ...(issued.intent.profile === 'cheap-async' ? { privateAccountingVerified: false as const } : {}) });
  });
  const recoverPending = async (knownTransactionHash?: string, authenticatedPrivateCheck = false) => {
    // Receipt-only admission is narrower than send authority and never issues a private brand.
    const nativeRecovery = usesCurrentNativeSwapChecks(c);
    if (nativeRecovery) assertCurrentSwapIdentity(c);
    await transport.assertCurrent();
    const activeAttempt = pending();
    const supplied = knownTransactionHash?.trim().toLowerCase();
    if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n)) throw new Error('Enter a valid existing DEX transaction hash.');
    // A transaction in flight takes priority. Confirmed operations use only
    // their original candidate identity and public canonical Accept evidence.
    const lookup = activeAttempt ? undefined : [...ownLookups()].reverse().find(row => !supplied || row.attempt.txHash === supplied);
    const attempt = activeAttempt ?? lookup?.attempt;
    if (!attempt) return null;
    if (attempt.phase === 'token-faucet' || attempt.phase === 'token-approve' || attempt.phase === 'token-refill' || attempt.phase === 'pool-preview' || attempt.phase === 'pool-fund' || attempt.phase === 'pool-owner' || attempt.phase === 'pool-transfer' || attempt.phase === 'pool-snapshot' || attempt.phase === 'limit-create' || attempt.phase === 'limit-snapshot' || attempt.phase === 'limit-owner') throw new Error('Use the owner-action pending-attempt reader for this action.');
    if (attempt.chainId !== chainId.toString() || attempt.owner !== owner.toLowerCase() ||
        attempt.core !== core.toLowerCase() || attempt.graph !== `0x${c.graph}`) throw new Error('Pending attempt belongs to another candidate or owner.');
    // A wallet can reprice the same nonce. An explicit hash is only a lookup:
    // all saved-intent and canonical receipt checks below must still pass.
    const transactionHash = supplied || attempt.txHash;
    // decision-033: a saved wallet rejection can be checked again. Every other record with no hash stays held.
    if (!transactionHash && activeAttempt?.walletRejected && await releaseUnsent(signer)) return Object.freeze({ status: 'released-unsent' as const,
      phase: attempt.phase, nonce: attempt.nonce, callHash: attempt.callHash, readyToSign: false as const, privateAccountingVerified: false as const });
    if (!transactionHash) return Object.freeze({ status: 'manual-reconciliation-required' as const, phase: attempt.phase,
      nonce: attempt.nonce, callHash: attempt.callHash, readyToSign: false as const,
      privateAccountingVerified: false as const });
    await attest(await transport.readHead());
    await transport.assertCurrent();
    const tx = await transport.readTransaction(transactionHash), receipt = await transport.waitForReceipt(transactionHash);
    await transport.assertCurrent();
    if (!tx || !receipt) return Object.freeze({ status: 'awaiting-chain-confirmation' as const, phase: attempt.phase,
      transactionHash, readyToSign: false as const,
      privateAccountingVerified: false as const });
    if (tx.nonce !== attempt.nonce) {
      throw new Error(`Current-mode pending canonical transaction changed. Mismatch: nonce (expected ${attempt.nonce}, received ${tx.nonce}). Do not resend.`);
    }
    if (tx.chainId !== chainId) {
      throw new Error(`Current-mode pending canonical transaction changed. Mismatch: chainId (expected ${chainId}, received ${tx.chainId}). Do not resend.`);
    }
    if (keccak256(tx.data).toLowerCase() !== attempt.callHash) {
      throw new Error('Current-mode pending canonical transaction changed. Mismatch: data. Do not resend.');
    }
    if (tx.nonce !== attempt.nonce || tx.chainId !== chainId || !sameAddress(tx.from, owner) || !tx.to ||
        !sameAddress(tx.to, core) || tx.value !== 0n || keccak256(tx.data).toLowerCase() !== attempt.callHash ||
        hash(tx.hash, 'pending hash') !== transactionHash || hash(receipt.hash, 'receipt hash') !== transactionHash ||
        !sameAddress(receipt.from, owner) || !receipt.to || !sameAddress(receipt.to, core) ||
        !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber! < 0 || !receipt.blockHash ||
        tx.blockNumber !== receipt.blockNumber || tx.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        (await transport.readBlockHash(receipt.blockNumber!))?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error('Current-mode pending canonical transaction changed.');
    }
    if (lookup && (receipt.blockNumber !== lookup.origin.number || receipt.blockHash.toLowerCase() !== lookup.origin.hash || receipt.status !== 1)) {
      throw new Error('Current-mode operation Accept origin changed.');
    }
    await transport.assertCurrent();
    const selectedProfile = pendingProfile(tx.data, attempt.phase, cheapProtocol);
    // The saved record is public reconciliation data, not successor gas admission.
    // Keep it until an exact native App phase package can verify the signed gas limit.
    if (stages.workCalls === 4 && !nativeRecovery) return Object.freeze({ status: 'manual-reconciliation-required' as const,
      phase: attempt.phase, transactionHash, receiptStatus: receipt.status,
      reason: 'Successor DEX native App phase admission is absent; the saved attempt remains blocked.', readyToSign: false as const,
      ...(attempt.verificationBlocked ? { verificationBlocked: true as const } : {}),
      privateAccountingVerified: false as const });
    const gasCap = attempt.phase === 'quote' || attempt.phase === 'accept'
      ? gasCaps()[selectedProfile][attempt.phase] : gasCaps()['cheap-async'][attempt.phase];
    if (tx.gasLimit !== gasCap) throw new Error('Pending current-mode gas cap changed.');
    if (attempt.verificationBlocked && !authenticatedPrivateCheck) return Object.freeze({ status: 'manual-reconciliation-required' as const,
      phase: attempt.phase, transactionHash, verificationBlocked: true as const, readyToSign: false as const,
      privateAccountingVerified: false as const });
    const recoveryRequest = Object.freeze({ chainId, from: owner, to: core, value: 0n as const, data: tx.data,
      nonce: attempt.nonce, gasLimit: gasCap });
    // Snapshot public evidence before later transport/operation reads. A mutable transport cannot replace it.
    const recoveryReceipt = Object.freeze({ ...receipt, logs: receipt.logs?.map(log => Object.freeze({ ...log, topics: [...log.topics] })) });
    if (nativeRecovery) await recheckMinedCall(recoveryRequest, transactionHash, recoveryReceipt, true);
    const observedReceipt = nativeRecovery ? recoveryReceipt : receipt;
    if (observedReceipt.status === 0) {
      if (nativeRecovery && observedReceipt.logs?.length) throw new Error('Reverted current native receipt contains events.');
      let key: string;
      if (attempt.phase === 'quote') {
        key = `${chainId}:${owner}:${attempt.callHash}`.toLowerCase();
      } else if (attempt.phase === 'accept') {
        const decoded = decodeCanonical(tx.data, cheapAccept, acceptMethod(selectedProfile));
        key = `${chainId}:${owner}:${selectedProfile}:${decoded[0]}:${decoded[1]}`.toLowerCase();
        const request = reservations.acceptRequests.get(key);
        if (request && (request.nonce !== tx.nonce || !sameCall(request, { ...tx, to: core, value: 0n }))) {
          throw new Error('Reverted Accept reservation changed.');
        }
      } else {
        const operationId = decodeCanonical(tx.data, ownerActionInterface, attempt.phase === 'cancel' ? 'cancelSwap' : 'recoverSwap')[0];
        if (operationId.toString() !== attempt.operationId) throw new Error('Reverted owner action changed.');
        key = `${chainId}:${owner}:cheap-async:${operationId}:${attempt.phase}`.toLowerCase();
      }
      if (nativeRecovery) await recheckMinedCall(recoveryRequest, transactionHash, recoveryReceipt, true);
      if (attempt.txHash !== transactionHash) recordCurrentDexPendingHash(storage, attempt, transactionHash);
      clearCurrentDexPendingAttempt(storage, requireOwnPending(attempt, transactionHash));
      if (attempt.phase === 'quote') { reservations.quote.delete(key); if (nativeRecovery) {
        completeCurrentNativeSwapScope(signer, `quote:${attempt.callHash}`); await persistBudget();
      } }
      else if (attempt.phase === 'accept') { reservations.accept.delete(key); reservations.acceptRequests.delete(key); }
      else reservations.actions.delete(key);
      return Object.freeze({ status: 'observed-reverted' as const, phase: attempt.phase, transactionHash,
        privateAccountingVerified: false as const, readyToSign: false as const });
    }
    if (observedReceipt.status !== 1) throw new Error('Current-mode pending receipt has no terminal status.');
    let profile: CurrentCheapDexProfile, operationId: bigint, context: string | undefined, deadline: bigint | undefined;
    if (attempt.phase === 'quote') {
      profile = selectedProfile;
      const decoded = decodeCanonical(tx.data, cheapOpening, quoteMethod(profile));
      const terms = profile === 'cheap-async' ? decoded.request : decoded;
      if (!pair(terms[0], terms[1]) || sameAddress(terms[2], core)) throw new Error('Pending Quote changed market.');
      deadline = terms[3];
      const event = uniqueCheapEvent(observedReceipt, core, profile === 'fast-pool' ? 'FastPoolQuoteIssued' : 'CheapAsyncAdvanced');
      operationId = event.quoteId;
      if (profile === 'fast-pool') {
        context = hash(event.context, 'Fast issue context');
        if (event.deadline !== deadline) throw new Error('Pending Fast deadline changed.');
      } else if (event.stage !== 1n || BigInt(event.context) !== 0n) throw new Error('Pending async issue event changed.');
    } else if (attempt.phase === 'accept') {
      profile = selectedProfile;
      const decoded = decodeCanonical(tx.data, cheapAccept, acceptMethod(profile));
      operationId = decoded[0]; context = hash(decoded[1], 'Accept context');
      if (profile === 'cheap-async') {
        const event = uniqueCheapEvent(observedReceipt, core, 'CheapAsyncAdvanced');
        if (event.quoteId !== operationId || event.stage !== BigInt(stages.funded) || event.context !== context) throw new Error('Pending funded event changed.');
      }
    } else {
      profile = 'cheap-async';
      operationId = decodeCanonical(tx.data, ownerActionInterface, attempt.phase === 'cancel' ? 'cancelSwap' : 'recoverSwap')[0];
      const event = uniqueCheapEvent(observedReceipt, core, 'CheapAsyncAdvanced');
      if (operationId.toString() !== attempt.operationId || event.quoteId !== operationId || event.stage !== BigInt(stages.released)) {
        throw new Error('Pending release event changed.');
      }
      context = event.context;
    }
    if (typeof operationId !== 'bigint' || operationId <= 0n) throw new Error('Pending current-mode ID is invalid.');
    if (lookup && (profile !== 'cheap-async' || operationId.toString() !== lookup.operationId || context !== lookup.contextHash)) {
      throw new Error('Current-mode operation lookup identity changed.');
    }
    const observed = await readOperation(profile, operationId, { number: BigInt(observedReceipt.blockNumber!), hash: observedReceipt.blockHash! });
    await transport.assertCurrent();
    if (observed.operation.profile !== profile || observed.operation.phase === 'not-found' ||
        (context !== undefined && observed.operation.contextHash !== context) ||
        (deadline !== undefined && observed.operation.deadline !== deadline) ||
        (lookup && observed.operation.deadline.toString() !== lookup.deadline) ||
        (attempt.phase === 'accept' && (profile === 'fast-pool' ? observed.operation.phase !== 'consumed-unverified' :
          ![stages.funded, stages.settled, stages.released].includes(observed.operation.stage ?? 0))) ||
        ((attempt.phase === 'cancel' || attempt.phase === 'recover') && observed.operation.stage !== stages.released)) {
      throw new Error('Pending current-mode public identity changed.');
    }
    if (nativeRecovery) await recheckMinedCall(recoveryRequest, transactionHash, recoveryReceipt);
    // A canonical public receipt cannot replace the wallet's private token checks.
    // Keep the saved action through reload until an authenticated path verifies it.
    if (usesCurrentSwapAccounting(c) && attempt.phase !== 'quote' && !lookup) return Object.freeze({
      status: 'manual-reconciliation-required' as const, phase: attempt.phase, transactionHash,
      reason: 'Owner private receipt and token checks are required; the saved action remains pending.',
      readyToSign: false as const, privateAccountingVerified: false as const,
      ...(attempt.verificationBlocked ? { verificationBlocked: true as const } : {}) });
    if(usesCurrentSwapAccounting(c)&&attempt.phase==='quote')return Object.freeze({status:'observed-mined' as const,phase:attempt.phase,profile,operationId,
      operation:observed.operation,transactionHash,readyToSign:false as const,privateAccountingVerified:false as const,ownerRestorationRequired:true as const});
    if (!lookup) {
      if (attempt.txHash !== transactionHash) recordCurrentDexPendingHash(storage, attempt, transactionHash);
      if (profile === 'cheap-async' && attempt.phase === 'accept') recordCurrentDexOperationLookup(storage, {
        attempt: requireOwnPending(attempt, transactionHash), operationId: operationId.toString(),
        contextHash: observed.operation.contextHash, deadline: observed.operation.deadline.toString(),
        origin: { number: observedReceipt.blockNumber!, hash: observedReceipt.blockHash!.toLowerCase() }
      });
      clearCurrentDexPendingAttempt(storage, requireOwnPending(attempt, transactionHash));
    }
    return Object.freeze({ status: 'observed-mined' as const, phase: attempt.phase, profile, operationId,
      operation: observed.operation, transactionHash, readyToSign: false as const,
      privateAccountingVerified: false as const });
  };
  const restoreOperation = async (issued: CurrentCheapDexIssuedQuote): Promise<CurrentCheapDexIssuedQuote> => {
    if(!usesCurrentSwapAccounting(c)||!authenticateReload)throw new Error('Current owner restoration is unavailable.');
    const prepared=currentDexRestoredPlan(issued,signer);validateQuote(prepared,true,true);validateIssued(issued,prepared);
    let saved=readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false);
    const recordBytes=JSON.stringify(saved),rebuilding=saved===null,recoveryTransactions=new Map<string,SubmittedTransaction>();
    if(!saved){
      if(!currentPartialLedgerRecoveryAllowed(c.graph,owner,now())||issued.intent.profile!=='fast-pool'||issued.operationId!==7n||
          issued.transactionHash.toLowerCase()!==CURRENT_APP_PARTIAL_LEDGER_RECOVERY.hashes[9]||pending()||ownLookups().length||hasCurrentNativeSigningBudget(signer))
        throw new Error('Original native budget was not retained. This operation remains held.');
      for(const hash of CURRENT_APP_PARTIAL_LEDGER_RECOVERY.hashes){
        const tx=await transport.readTransaction(hash);await transport.assertCurrent();
        if(!tx)throw new Error('An original ledger transaction is unavailable. Do not start a new trial.');
        recoveryTransactions.set(hash,tx);
      }
      const budget=recoverCurrentPartialLedger(owner,c,now(),[...recoveryTransactions.values()]);
      saved={budget,authentication:await authenticateReload(budget)};
    }
    validateCurrentNativeSwapCheckpoint(saved.budget,owner,c,signer);
    if(await authenticateReload(saved.budget)!==saved.authentication)throw new Error('Original native budget authentication failed.');
    const restoredScope=`quote:${keccak256(prepared.data)}`;
    if(issued.intent.profile==='fast-pool'&&saved.budget.activeSwap!==restoredScope&&
        saved.budget.charges.some(row=>row.scope===restoredScope&&row.phase==='quote'&&row.hash===issued.transactionHash.toLowerCase())&&
        !saved.budget.charges.some(row=>row.scope===restoredScope&&row.phase==='accept'))
      throw new Error('This Fast Quote was closed without funding. Request a new Quote.');
    const active=pending(),pendingBytes=JSON.stringify(active);
    if(active?.verificationBlocked||operationLookup(issued)?.attempt.verificationBlocked)throw new Error('Original private verification remains blocked.');
    if(active&&(active.owner!==owner.toLowerCase()||active.core!==core.toLowerCase()||active.graph!==`0x${c.graph}`||active.chainId!==String(chainId)))throw new Error('Pending action belongs to another owner or candidate.');
    const budget=structuredClone(saved.budget),scope=`quote:${keccak256(prepared.data)}`;
    const quotes=new Map<string,{id:bigint;profile:CurrentCheapDexProfile}>(),checked:{request:TransactionRequest;receipt:MinedReceipt;hash:string;phase:string;scope:string}[]=[];
    for(const charge of budget.charges){
      const transactionHash=charge.hash??(active?.nonce===charge.nonce?active.txHash:null);
      if(!transactionHash)throw new Error('A native signing start has no known hash. Reconcile without resending.');
      const tx=recoveryTransactions.get(transactionHash)??await transport.readTransaction(transactionHash),receipt=await transport.waitForReceipt(transactionHash);await transport.assertCurrent();
      if(!tx||!receipt)throw new Error('A recorded native transaction is not confirmed. Keep its reservation.');
      if (charge.phase === 'token-funding' || charge.phase === 'token-faucet') {
        await recheckMinedCall(fundingRequest(charge,tx,prepared),transactionHash,receipt);
        (charge as {hash:string|null}).hash=transactionHash.toLowerCase();continue;
      }
      if(tx.nonce!==charge.nonce||tx.gasLimit!==BigInt(charge.gasCap)||tx.chainId!==chainId||!sameAddress(tx.from,owner)||!tx.to||!sameAddress(tx.to,core)||tx.value!==0n)throw new Error('Native reload transaction identity changed.');
      const profile=pendingProfile(tx.data,charge.phase,cheapProtocol),request:TransactionRequest={chainId,from:owner,to:core,value:0n,data:tx.data,nonce:charge.nonce,gasLimit:BigInt(charge.gasCap),gasPrice:currentNativeSwapChargeGasPrice(charge)};
      if(charge.gasCap!==String(charge.phase==='quote'||charge.phase==='accept'?gasCaps()[profile][charge.phase]:gasCaps()['cheap-async'][charge.phase]))throw new Error('Native reload phase gas cap changed.');
      await recheckMinedCall(request,transactionHash,receipt,true);
      if(receipt.status!==0&&receipt.status!==1)throw new Error('Native reload transaction has no final status.');
      if(charge.phase==='quote'){
        if(charge.scope!==`quote:${keccak256(tx.data)}`)throw new Error('Native reload Quote scope changed.');
        if(receipt.status===1){const e=uniqueCheapEvent(receipt,core,profile==='cheap-async'?'CheapAsyncAdvanced':'FastPoolQuoteIssued');if(profile==='cheap-async'&&(e.stage!==1n||BigInt(e.context)!==0n))throw new Error('Native reload Quote event changed.');quotes.set(charge.scope,{id:e.quoteId,profile});}
      }else{
        const quote=quotes.get(charge.scope);if(!quote)throw new Error('Native reload action has no canonical Quote.');
        const call=decodeCanonical(tx.data,charge.phase==='accept'?cheapAccept:ownerActionInterface,charge.phase==='accept'?acceptMethod(quote.profile):charge.phase==='cancel'?'cancelSwap':'recoverSwap');
        if(call[0]!==quote.id)throw new Error('Native reload operation changed.');
        const key=charge.phase==='accept'?`${chainId}:${owner}:${quote.profile}:${quote.id}:${call[1]}`.toLowerCase():`${chainId}:${owner}:cheap-async:${quote.id}:${charge.phase}`.toLowerCase();
        if(charge.phase==='accept'){reservations.accept.add(key);reservations.acceptRequests.set(key,request);}else reservations.actions.add(key);
      }
      if(active?.nonce===charge.nonce&&(active.phase!==charge.phase||active.callHash!==keccak256(tx.data).toLowerCase()||active.txHash!==null&&active.txHash!==transactionHash))throw new Error('Native reload pending binding changed.');
      (charge as {hash:string|null}).hash=transactionHash;checked.push({request,receipt,hash:transactionHash,phase:charge.phase,scope:charge.scope});
    }
    const quote=quotes.get(scope),issue=checked.find(row=>row.phase==='quote'&&row.scope===scope);
    if(!quote||quote.id!==issued.operationId||quote.profile!==issued.intent.profile||issue?.hash!==issued.transactionHash.toLowerCase()||issue.receipt.blockNumber!==Number(issued.originBlock.number)||issue.receipt.blockHash?.toLowerCase()!==issued.originBlock.hash.toLowerCase())throw new Error('Restored Quote differs from its original reservation.');
    if(active&&!checked.some(row=>row.request.nonce===active.nonce&&row.scope===scope))throw new Error('Another reserved operation must be reconciled first.');
    const current=await issued.readCurrent();validateIssued(current,prepared);
    const unfundedCancel = current.operation.stage===stages.released &&
      checked.some(row=>row.scope===scope&&row.phase==='cancel'&&row.receipt.status===1) &&
      !checked.some(row=>row.scope===scope&&row.phase==='accept'&&row.receipt.status===1);
    const refunded = current.operation.stage===stages.released &&
      checked.some(row=>row.scope===scope&&row.phase==='recover'&&row.receipt.status===1);
    // A wallet-authenticated closed ledger reuses its accepted rate proof; recheck terminal accounting instead.
    const closedSettlement = budget.activeSwap===null&&(current.intent.profile==='fast-pool'
      ?current.operation.phase==='consumed-unverified'&&!current.operation.ready:current.operation.stage===stages.settled);
    if(rebuilding&&!closedSettlement)throw new Error('Approved ledger recovery requires completed Fast7 settlement.');
    if(closedSettlement){
      recoveringRecord=rebuilding?saved:null;
      try{
        const terminal=await adapter.readCurrentCheapActivityReceipt(current);
        if(rebuilding&&(terminal.amounts.actualInput!==1_000_000n||terminal.amounts.netOutput!==959_968n||terminal.amounts.refund!==0n))
          throw new Error('Accepted Fast7 private result changed.');
      }finally{recoveringRecord=null;}
    }
    if(refunded){
      const accepts=checked.filter(row=>row.scope===scope&&row.phase==='accept'),recoveries=checked.filter(row=>row.scope===scope&&row.phase==='recover');
      if(accepts.length!==1||accepts[0].receipt.status!==1||recoveries.length!==1||recoveries[0].receipt.status!==1||
          accepts[0].receipt.blockNumber!<issue.receipt.blockNumber!||recoveries[0].receipt.blockNumber!<accepts[0].receipt.blockNumber!)
        throw new Error('Recovered operation has no exact confirmed funding and refund reservation.');
      // An exact full refund has no execution rate; prove both private token movements before restoring authority.
      const receipt=await verifyReceipt(current,prepared,current.originBlock,true);
      if(receipt.kind!=='terminal'||recoveries[0].receipt.blockNumber!>Number(receipt.block.number))
        failPrivateVerification(current,new Error('Recovered private receipt is not the confirmed terminal refund.'));
      await verifyTokens(current,fundingAmounts(current),'accept',accepts[0].receipt);
      await verifyTokens(current,receipt.amounts,'recover',recoveries[0].receipt);
    }
    if(!unfundedCancel&&!refunded&&!closedSettlement&&BigInt(current.operation.contextHash)!==0n&&current.operation.stage!>=stages.ready){
      if(!readOriginalQuoteReceipt)throw new Error('Original Quote receipt reader is unavailable.');
      const original=await verifyReceipt(current,prepared,current.originBlock,false,current.operation.contextHash,await readOriginalQuoteReceipt(current));
      if(original.amounts.filled)reviewed.set(issuedKey(current),{actualInput:original.amounts.actualInput,netOutput:original.amounts.netOutput,context:current.operation.contextHash});
    }
    const head=await transport.readHead();await attest(head);if(!transport.readNativeResources)throw new Error('Native reload nonce observation is unavailable.');
    const resources=await transport.readNativeResources(head);
    if(resources.owner.toLowerCase()!==owner.toLowerCase()||resources.chainId!==chainId||resources.code!=='0x'||resources.head.number!==head.number||resources.head.hash!==head.hash||
       resources.latestNonce!==resources.pendingNonce||resources.latestNonce<=Math.max(...budget.charges.map(c=>c.nonce))||rebuilding&&resources.latestNonce!==217)throw new Error('Native reload has an unresolved wallet nonce or identity.');
    for(const row of checked)await recheckMinedCall(row.request,row.hash,row.receipt,true);
    await transport.assertCurrent();if(JSON.stringify(pending())!==pendingBytes||JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false))!==recordBytes)throw new Error('Native reload records changed during reconciliation.');
    restoreCurrentNativeSwapCheckpoint(signer,owner,c,budget);await persistBudget();
    if(closedSettlement&&hasCurrentPartialRefundProof(c.graph,owner,budget.charges)){
      if(renewCurrentNativeSwapClosedWindow(signer,owner,c,scope,now()))await persistBudget();
      if(BigInt(currentNativeSwapCheckpoint(signer).windowStart??budget.start)>=CURRENT_APP_PARTIAL_REFUND_TRIAL.approvedAt)closedTrialScopes.add(scope);
    }
    // Fast funds only in Accept; a still-ready expired Quote with no Accept reservation cannot hold tokens.
    if(current.intent.profile==='fast-pool'&&current.operation.ready&&current.operation.phase==='expired-unrecovered'&&
        current.block.timestamp>=current.intent.deadline&&head.timestamp>=current.intent.deadline&&
        !budget.charges.some(row=>row.scope===scope&&row.phase==='accept')){
      completeCurrentNativeSwapScope(signer,scope);
      renewCurrentNativeSwapClosedWindow(signer,owner,c,scope,now());
      await persistBudget();closedTrialScopes.add(scope);
    }
    if(closedSettlement)closedAccountingScopes.add(issuedKey(current));
    recovered.set(issuedKey(current),{prepared,origin:current.originBlock});reservations.quote.add(`${chainId}:${owner}:${keccak256(prepared.data)}`.toLowerCase());
    const accept=checked.find(row=>row.scope===scope&&row.phase==='accept'&&row.receipt.status===1);if(accept)acceptedReceipts.set(issuedKey(current),accept.receipt);
    if(active){
      const row=checked.find(row=>row.request.nonce===active.nonce)!;
      if(active.txHash===null)recordCurrentDexPendingHash(storage,active,row.hash);
      if(active.phase==='quote'&&row.receipt.status===1)clearCurrentDexPendingAttempt(storage,requireOwnPending(active,row.hash));
      else if(active.phase==='accept'&&row.receipt.status===1)await acceptanceResult(current,prepared,row.request,row.hash);
      else if((active.phase==='cancel'||active.phase==='recover')&&row.receipt.status===1){
        await adapter.readCurrentCheapDelivery(current);
        await recheckMinedCall(row.request,row.hash,row.receipt);
        clearCurrentDexPendingAttempt(storage,requireOwnPending(active,row.hash));
      }
      else if(row.receipt.status===0)await recoverPending(row.hash);
    }
    return current;
  };
  const adapter = Object.freeze({ readyToSign: false as const,
    readCurrentCheapRestoreHint: () => {
      const record=readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false);
      if(!record)return currentPartialLedgerRecoveryAllowed(c.graph,owner,now())?{quoteHash:CURRENT_APP_PARTIAL_LEDGER_RECOVERY.hashes[9]}:null;
      validateCurrentNativeSwapCheckpoint(record.budget,owner,c,signer);
      const row=[...record.budget.charges].reverse().find(r=>r.phase==='quote'&&(record.budget.activeSwap===null||r.scope===record.budget.activeSwap));
      // A closed unfunded Quote needs no signing restoration; keep its charge as history.
      if(record.budget.activeSwap===null&&row&&!record.budget.charges.some(charge=>charge.scope===row.scope&&charge.phase==='accept'))return null;
      const attempt=pending();return row?Object.freeze({quoteHash:row.hash??(attempt?.phase==='quote'&&attempt.nonce===row.nonce?attempt.txHash:null)}):null;
    },
    restoreCurrentCheapOperation: restoreOperation,
    discardCurrentFastQuote: async (issued: CurrentCheapDexIssuedQuote): Promise<void> => {
      if(!isCurrentDexBrowserSigner(signer,c.graph,owner)||issued.intent.profile!=='fast-pool'||!authenticateReload)
        throw new Error('Local Fast Quote cancellation requires the current browser wallet.');
      assertCurrentCheapDexIssuedQuote(issued,signer);
      const prepared=capturedQuote(issued);validateQuote(prepared,true);validateIssued(issued,prepared);
      const saved=readCurrentDexNativeReload(storage,reloadScope);
      if(!saved||!hasCurrentNativeSigningBudget(signer))throw new Error('Restore the original Fast Quote budget before cancellation.');
      validateCurrentNativeSwapCheckpoint(saved.budget,owner,c,signer);
      const scope=`quote:${keccak256(prepared.data)}`,recordBytes=JSON.stringify(saved),budgetBytes=JSON.stringify(saved.budget),
        acceptKey=`${chainId}:${owner}:fast-pool:${issued.operationId}:${issued.operation.contextHash}`.toLowerCase(),
        charges=saved.budget.charges.filter(row=>row.scope===scope),quotes=charges.filter(row=>row.phase==='quote');
      if(saved.budget.activeSwap!==scope||quotes.length!==1||quotes[0].hash!==issued.transactionHash.toLowerCase()||
          charges.some(row=>row.phase!=='quote'&&row.phase!=='token-funding')||saved.budget.charges.some(row=>!row.hash))
        throw new Error('Fast Quote has funding, an Accept reservation or unresolved accounting.');
      const fence=()=>{
        if(!isCurrentDexBrowserSigner(signer,c.graph,owner))throw new Error('Fast Quote browser session changed.');
        requireEmptyPending();
        if(readCurrentDexOperationLookups(storage).length||reservations.accept.has(acceptKey)||reservations.acceptRequests.has(acceptKey)||
            JSON.stringify(currentNativeSwapCheckpoint(signer))!==budgetBytes||JSON.stringify(readCurrentDexNativeReload(storage,reloadScope))!==recordBytes)
          throw new Error('Fast Quote records changed or an operation remains unresolved.');
      };
      fence();
      if(await authenticateReload(saved.budget)!==saved.authentication)throw new Error('Fast Quote record authentication failed.');
      await transport.assertCurrent();fence();
      const charge=quotes[0],request:TransactionRequest={chainId,from:owner,to:core,value:0n,data:prepared.data,
        nonce:charge.nonce,gasLimit:gasCaps()['fast-pool'].quote,gasPrice:currentNativeSwapChargeGasPrice(charge)},
        receipt=await verifyMinedCall(request,charge.hash!);
      const event=uniqueCheapEvent(receipt,core,'FastPoolQuoteIssued');
      if(event.quoteId!==issued.operationId||event.context!==issued.operation.contextHash||event.deadline!==issued.intent.deadline||
          receipt.blockNumber!==Number(issued.originBlock.number)||receipt.blockHash?.toLowerCase()!==issued.originBlock.hash.toLowerCase())
        throw new Error('Fast Quote canonical origin changed.');
      await refreshReady(issued,prepared,true);fence();
      const head=await transport.readHead();await attest(head);await transport.assertCurrent();fence();
      if(!transport.readNativeResources)throw new Error('Fast Quote nonce observation is unavailable.');
      const resources=await transport.readNativeResources(head);await transport.assertCurrent();fence();
      const checkResources=(value:CurrentNativeResources)=>{
        if(!sameAddress(value.owner,owner)||value.chainId!==chainId||value.code!=='0x'||value.head.number!==head.number||
            value.head.hash!==head.hash||value.head.timestamp!==head.timestamp||value.head.gasLimit!==head.gasLimit||
            !Number.isSafeInteger(value.latestNonce)||value.latestNonce!==value.pendingNonce||
            value.latestNonce<=Math.max(...saved.budget.charges.map(row=>row.nonce))||head.timestamp>now()||now()-head.timestamp>=90n)
          throw new Error('Fast Quote has an unresolved wallet nonce or changed identity.');
      };
      checkResources(resources);
      const budget=Object.freeze({...saved.budget,activeSwap:null}),authentication=await authenticateReload(budget);
      await transport.assertCurrent();fence();
      await recheckMinedCall(request,charge.hash!,receipt);fence();
      await refreshReady(issued,prepared,true);fence();
      const finalResources=await transport.readNativeResources(head);await transport.assertCurrent();fence();checkResources(finalResources);
      if(finalResources.latestNonce!==resources.latestNonce)throw new Error('Fast Quote wallet nonce changed during cancellation.');
      writeCurrentDexNativeReload(storage,{budget,authentication},budget.version===2?reloadScope:undefined);
      completeCurrentNativeSwapScope(signer,scope);
      savedReload=JSON.stringify(readCurrentDexNativeReload(storage,reloadScope));
    },
    // History proves accounting only; it never restores or releases signing authority.
    readCurrentCheapActivityReceipt: async (issued: CurrentCheapDexIssuedQuote) => {
      if (!usesCurrentSwapAccounting(c) || !authenticateReload || !verifyOwnerTokens || issued.intent.profile==='cheap-async'&&!readTerminalReceipt) {
        throw new Error('Read-only private Activity is unavailable.');
      }
      const prepared = currentDexRestoredPlan(issued, signer);
      validateQuote(prepared, true, true); validateIssued(issued, prepared);
      const stored = readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false),saved=stored??recoveringRecord;
      if (!saved) throw new Error('Original Activity reservation is unavailable.');
      const savedBytes = JSON.stringify(stored), pendingBytes = JSON.stringify(pending()), lookupBytes = JSON.stringify(ownLookups());
      validateCurrentNativeSwapCheckpoint(saved.budget, owner, c, signer);
      if (await authenticateReload(saved.budget) !== saved.authentication) throw new Error('Original Activity reservation authentication failed.');
      const scope = `quote:${keccak256(prepared.data)}`, charges = saved.budget.charges.filter(row => row.scope === scope);
      const quote = charges.filter(row => row.phase === 'quote');
      if (quote.length !== 1 || quote[0].hash !== issued.transactionHash.toLowerCase()) throw new Error('Saved Activity Quote changed.');
      const checkCharge = async (charge: typeof quote[number], data: string, cap: bigint, allowRevert = false) => {
        if (!charge.hash || charge.gasCap !== cap.toString()) throw new Error('Saved Activity call is unavailable.');
        return verifyMinedCall({ chainId, from: owner, to: core, value: 0n, data, nonce: charge.nonce,
          gasLimit: cap, gasPrice: currentNativeSwapChargeGasPrice(charge) }, charge.hash, allowRevert);
      };
      const quoteReceipt = await checkCharge(quote[0], prepared.data, gasCaps()[issued.intent.profile].quote);
      if (quoteReceipt.blockNumber !== Number(issued.originBlock.number) || quoteReceipt.blockHash?.toLowerCase() !== issued.originBlock.hash.toLowerCase()) {
        throw new Error('Activity Quote origin changed.');
      }
      const current = await issued.readCurrent(); validateIssued(current, prepared); await transport.assertCurrent();
      const receipt = await readReceipt(current, current.originBlock);
      await transport.assertCurrent();
      checkReceiptIntent(receipt, current, prepared, current.originBlock, current.operation.stage === stages.released);
      if(current.intent.profile==='fast-pool'){
        const accepts=charges.filter(row=>row.phase==='accept');
        if(current.operation.phase!=='consumed-unverified'||current.operation.ready||receipt.operation.phase!=='consumed-unverified'||receipt.operation.ready||accepts.length!==1)
          throw new Error('Fast Activity has no exact consumed result and Accept reservation.');
        const accept=await checkCharge(accepts[0],cheapAccept.encodeFunctionData(acceptMethod('fast-pool'),[current.operationId,current.operation.contextHash]),gasCaps()['fast-pool'].accept);
        if(accept.blockNumber===undefined||accept.blockNumber<quoteReceipt.blockNumber!||BigInt(accept.blockNumber)>receipt.block.number)
          throw new Error('Fast Activity Accept order changed.');
        await verifyOwnerTokens({issued:current,amounts:receipt.amounts,phase:'fast-settle',receipt:accept,contextHash:current.operation.contextHash});
        await transport.assertCurrent();
        if(JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false))!==savedBytes||JSON.stringify(pending())!==pendingBytes||JSON.stringify(ownLookups())!==lookupBytes)
          throw new Error('Activity reservation changed during the read.');
        return Object.freeze({...receipt,releaseAction:null,privateAccountingVerified:true as const,
          originalQuoteRateVerification:'unavailable' as const,readyToSign:false as const,nativeAdmission:false as const});
      }
      if (receipt.kind !== 'terminal' || receipt.operation.stage !== current.operation.stage || ![stages.settled, stages.released].includes(receipt.operation.stage ?? 0)) {
        throw new Error('Activity private result is not terminal.');
      }
      // shortcut: discovery covers the first 4096 blocks after Quote, expand when longer operations are supported.
      const upper = receipt.block.number < current.originBlock.number + 4095n ? receipt.block.number : current.originBlock.number + 4095n;
      const terminal = await readTerminalReceipt!(current, upper);
      if (terminal.receipt.blockNumber === undefined || BigInt(terminal.receipt.blockNumber) < current.originBlock.number || BigInt(terminal.receipt.blockNumber) > upper ||
          (current.operation.stage === stages.settled ? terminal.phase !== 'terminal' : terminal.phase === 'terminal')) throw new Error('Activity terminal transaction changed.');
      const accepts = charges.filter(row => row.phase === 'accept');
      if (terminal.phase === 'cancel') {
        if (accepts.length > 1 || accepts.length === 1 &&
            (await checkCharge(accepts[0], cheapAccept.encodeFunctionData('acceptPrivateSwapV1', [current.operationId, current.operation.contextHash]), gasCaps()['cheap-async'].accept, true)).status !== 0) {
          throw new Error('Cancelled Activity has confirmed funding or ambiguous reservations.');
        }
      } else {
        if (accepts.length !== 1) throw new Error('Activity funding receipt is unavailable.');
        const data = cheapAccept.encodeFunctionData('acceptPrivateSwapV1', [current.operationId, current.operation.contextHash]);
        const accept = await checkCharge(accepts[0], data, gasCaps()['cheap-async'].accept);
        if (accept.blockNumber === undefined || accept.blockNumber < quoteReceipt.blockNumber! || accept.blockNumber > terminal.receipt.blockNumber) throw new Error('Activity funding order changed.');
        await verifyOwnerTokens({ issued: current, amounts: fundingAmounts(current), phase: 'accept', receipt: accept, contextHash: current.operation.contextHash });
      }
      await verifyOwnerTokens({ issued: current, amounts: receipt.amounts, phase: terminal.phase, receipt: terminal.receipt, contextHash: current.operation.contextHash });
      await transport.assertCurrent();
      if (JSON.stringify(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false)) !== savedBytes || JSON.stringify(pending()) !== pendingBytes || JSON.stringify(ownLookups()) !== lookupBytes) {
        throw new Error('Activity reservation changed during the read.');
      }
      return Object.freeze({ ...receipt, releaseAction: terminal.phase === 'terminal' ? null : terminal.phase,
        privateAccountingVerified: true as const, originalQuoteRateVerification: 'unavailable' as const,
        readyToSign: false as const, nativeAdmission: false as const });
    },
    readCurrentCheapTiming: (transactionHash: string): CurrentCheapDexTiming | null => {
      const timing = timings.get(transactionHash.toLowerCase());
      if (!timing) return null;
      return Object.freeze({ ...timing, walletSendMs: elapsed(timing.sendStartedAtMs, timing.submissionReturnedAtMs),
        walletRequestToHashMs: elapsed(timing.sendStartedAtMs, timing.hashReturnedAtMs),
        hashToRpcVisibilityMs: elapsed(timing.hashReturnedAtMs, timing.submissionReturnedAtMs),
        checks: Object.freeze(timing.checks.map(check => {
          const receiptObservationMs = elapsed(check.receiptStartedAtMs, check.receiptFinishedAtMs);
          const verifiedDuration = elapsed(check.startedAtMs, check.successfulVerifiedAtMs);
          return Object.freeze({ ...check, submittedToCheckMs: elapsed(timing.submissionReturnedAtMs, check.startedAtMs),
            receiptObservationMs, preReceiptVerificationMs: elapsed(check.startedAtMs, check.receiptStartedAtMs),
            postReceiptVerificationMs: elapsed(check.receiptFinishedAtMs, check.successfulVerifiedAtMs),
            verificationRemainderMs: verifiedDuration !== null && receiptObservationMs !== null && verifiedDuration >= receiptObservationMs
              ? verifiedDuration - receiptObservationMs : null });
        })) });
    },
    authorizeCurrentCheapInitialClaim: async (request:TransactionRequest) => {
      assertCurrentAppInitialClaimAuthority(c.graph,owner,request.to,'initial');
      if(!usesCurrentSwapAccounting(c)||!sameAddress(request.from,owner)||request.chainId!==chainId||request.value!==0n||request.data!==new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet'))throw new Error('Initial claim App call changed.');
      if(readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false)&&!hasCurrentNativeSigningBudget(signer))throw new Error('The original App trial is already reserved. Reconcile it.');
      const scope=`quote:${keccak256(request.data)}`;currentNativeSigningBudget(signer,owner,now,c).commit('token-faucet',`token-faucet:${scope}:${keccak256(request.data)}`,5_000_000n,scope,request.nonce);await persistBudget();
    },
    assertCurrentCheapSwapAllowanceCleanupIdle: assertSwapAllowanceCleanupIdle,
    assertCurrentAllowanceMutationIdle: assertAllowanceMutationIdle,
    reconcileCurrentCheapSwapAllowanceCleanup: () => reconcileSwapAllowanceCleanup(),
    authorizeCurrentCheapSwapApproval: async (prepared: CurrentCheapDexPreparedQuote, request: TransactionRequest, cleanup?: true) => {
      validateQuote(prepared, !!cleanup); assertCurrentSwapCandidate(c, prepared.intent, signer);
      if (!usesCurrentSwapAccounting(c) || !sameAddress(request.to, prepared.intent.inputToken) || !sameAddress(request.from, owner) || request.chainId !== chainId || request.value !== 0n) throw new Error('Swap approval owner or target changed.');
      const claim=request.data===new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet'),phase=claim?'token-faucet':'token-funding';
      if(!claim){const call=currentTokenFundingAbi.parseTransaction({data:request.data});if(!call||!['approve',...(!cleanup&&c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph?['increaseAllowance']:[])].includes(call.name)||!sameAddress(decodeCanonical(request.data,currentTokenFundingAbi,call.name)[0],core))throw new Error('Exact approval spender changed.');}
      if (cleanup) {
        if (claim) throw new Error('Allowance cleanup requires an approval.');
        await assertSwapAllowanceCleanupIdle(prepared);
        if (!hasCurrentNativeSigningBudget(signer)) restoreCurrentNativeSwapCheckpoint(signer, owner, c, readCurrentDexNativeReload(storage, reloadScope)!.budget);
      } else await restoreFundingBudget(claim ? undefined : prepared, claim ? undefined : request);
      if (readCurrentDexNativeReload(storage, isCurrentDexBrowserSigner(signer,c.graph,owner) ? reloadScope : false) && !hasCurrentNativeSigningBudget(signer)) throw new Error('Restore the original native budget before another signing request.');
      const scope=cleanup ? currentNativeSwapCheckpoint(signer).activeSwap ?? `quote:${keccak256(prepared.data)}` : `quote:${keccak256(prepared.data)}`,
        key=`${phase}:${scope}:${keccak256(request.data)}`;
      currentNativeSigningBudget(signer,owner,now,c).commit(phase,key,5_000_000n,scope,request.nonce);
      await persistBudget();
    },
    rememberCurrentCheapSwapApproval: rememberHash,
    releaseCurrentCheapUnsentLedgerReservation: releaseUnsentLedgerReservation,
    admitCurrentOwnerNormalRecord: (swapScope?: string, gasCap?: bigint, heldSnapshot?: CurrentDexPendingAttempt, topUpHandoff?: CurrentDexPendingAttempt) => admitNormalOwnerRecord(false,swapScope,gasCap,heldSnapshot,topUpHandoff),
    checkCurrentCheapCandidate: async () => {
      assertCurrentSwapIdentity(c);
      if (isCurrentDexBrowserSigner(signer,c.graph,owner)) {
        await admitNormalOwnerRecord();
      }
      const block = await currentHead(undefined, gasCaps()['fast-pool'].quote, usesCurrentSwapAccounting(c));
      return Object.freeze({ chainId, owner, core, graph: c.graph, packageSha256: c.packageSha256, block, readyToSign: false as const });
    },
    recoverPendingCurrentCheapAttempt: (knownTransactionHash?: string) => recoverPending(knownTransactionHash),
    recoverCurrentCheapQuote: recoverQuote,
    readCurrentCheapDelivery: async (issued: CurrentCheapDexIssuedQuote) => {
      assertCurrentCheapDexIssuedQuote(issued, signer);
      const prepared = capturedQuote(issued), current = await issued.readCurrent();
      await transport.assertCurrent();
      validateIssued(current, prepared);
      const lookup = operationLookup(current);
      const checkLookup = async () => {
        if (!lookup) return;
        const publicResult = await recoverPending(lookup.attempt.txHash!, true);
        if (!publicResult || publicResult.status !== 'observed-mined' || publicResult.transactionHash !== lookup.attempt.txHash ||
            publicResult.profile !== 'cheap-async' || publicResult.operationId !== current.operationId ||
            publicResult.operation.contextHash !== current.operation.contextHash || publicResult.operation.stage !== current.operation.stage) {
          throw new Error('Current-mode terminal public lookup changed.');
        }
      };
      await checkLookup();
      const receipt = closedAccountingScopes.has(issuedKey(current))
        ? await adapter.readCurrentCheapActivityReceipt(current)
        : await verifyReceipt(current, prepared, current.originBlock, current.operation.stage === stages.released);
      let releaseAction: 'cancel' | 'recover' | null = null;
      if (current.intent.profile === 'cheap-async' ? receipt.kind !== 'terminal' ||
          ![stages.settled, stages.released].includes(receipt.operation.stage ?? 0) || receipt.operation.stage !== current.operation.stage
        : receipt.operation.phase !== 'consumed-unverified' || current.operation.phase !== 'consumed-unverified') {
        throw new Error('Current-mode terminal private receipt is not available.');
      }
      if (usesCurrentSwapAccounting(c)) {
        try {
          const acceptReceipt = lookup ? await transport.waitForReceipt(lookup.attempt.txHash!) : acceptedReceipts.get(issuedKey(current));
          if (current.intent.profile === 'fast-pool') {
            if (!acceptReceipt) throw new Error('Fast Accept token evidence is unavailable in this session.');
            await verifyTokens(current, receipt.amounts, 'fast-settle', acceptReceipt);
          } else {
            if (!readTerminalReceipt) throw new Error('Current-mode terminal token reader is unavailable.');
            const upper = receipt.block.number < current.originBlock.number + 4095n ? receipt.block.number : current.originBlock.number + 4095n;
            const terminal = await readTerminalReceipt(current, upper);
            if (terminal.receipt.blockNumber === undefined || BigInt(terminal.receipt.blockNumber) < current.originBlock.number || BigInt(terminal.receipt.blockNumber) > upper ||
                (receipt.operation.stage === stages.settled ? terminal.phase !== 'terminal' : terminal.phase === 'terminal')) {
              throw new Error('Current-mode terminal token transaction changed.');
            }
            if(current.operationId===5n&&hasCurrentNativeSigningBudget(signer)&&hasCurrentHistoryFastProof(c.graph,owner,currentNativeSwapCheckpoint(signer).charges)&&
                terminal.receipt.hash.toLowerCase()!==CURRENT_APP_HISTORY_FAST_TRIAL.terminalHash)
              throw new Error('Approved Fast continuation terminal transaction changed.');
            if (terminal.phase !== 'cancel') {
              if (!acceptReceipt) throw new Error('Funded Accept token evidence is unavailable.');
              await verifyTokens(current, fundingAmounts(current), 'accept', acceptReceipt);
            }
            await verifyTokens(current, receipt.amounts, terminal.phase, terminal.receipt);
            if (terminal.phase === 'cancel' || terminal.phase === 'recover') releaseAction = terminal.phase;
          }
        } catch (error) { failPrivateVerification(current, error); }
      }
      if (lookup) {
        await checkLookup();
        const verifiedLookup = operationLookup(current);
        if (!verifiedLookup) throw new Error('Current-mode operation lookup changed during private verification.');
        clearCurrentDexOperationLookup(storage, verifiedLookup);
      }
      if (usesCurrentNativeSwapChecks(c)) {
        completeCurrentNativeSwapScope(signer, `quote:${keccak256(prepared.data)}`); await persistBudget();
      }
      const historyClosed=c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&current.operationId===4n;
      const historyDelivered=c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&current.operationId===5n&&current.operation.stage===stages.settled&&
        hasCurrentNativeSigningBudget(signer)&&hasCurrentHistoryFastProof(c.graph,owner,currentNativeSwapCheckpoint(signer).charges);
      const closedTrial=historyDelivered?CURRENT_APP_HISTORY_FAST_TRIAL:historyClosed?CURRENT_APP_HISTORY_REPLACEMENT_TRIAL:current.operationId===50n?CURRENT_APP_REPLACEMENT_TRIAL:current.operationId===51n?CURRENT_APP_FURTHER_TRIAL:current.operationId===52n?CURRENT_APP_FOURTH_TRIAL:null;
      if((releaseAction === 'cancel'||historyClosed&&releaseAction==='recover'||historyDelivered&&releaseAction===null) && closedTrial && current.transactionHash.toLowerCase() === closedTrial.quoteHash && hasCurrentNativeSigningBudget(signer)) {
        const scope=`quote:${keccak256(prepared.data)}`;
        if(renewCurrentNativeSwapClosedWindow(signer,owner,c,scope,now()))await persistBudget();
        const budget=currentNativeSwapCheckpoint(signer);
        if(BigInt(budget.windowStart??budget.start)>=closedTrial.approvedAt && budget.charges.filter(row=>row.phase==='quote').length===(historyDelivered?2:historyClosed||current.operationId===50n?1:current.operationId===51n?2:3))
          closedTrialScopes.add(scope);
      }
      return Object.freeze({ ...receipt, releaseAction });
    },
    recoverCurrentCheapAcceptance: async ({ issued, transactionHash }: { issued: CurrentCheapDexIssuedQuote; transactionHash: string }) => {
      assertCurrentCheapDexIssuedQuote(issued, signer);
      const prepared = capturedQuote(issued), current = await issued.readCurrent();
      await transport.assertCurrent();
      validateIssued(current, prepared);
      if (current.operationId !== issued.operationId || current.transactionHash !== issued.transactionHash ||
          current.originBlock.hash !== issued.originBlock.hash) throw new Error('Current-mode Accept recovery origin changed.');
      const key = `${chainId}:${owner}:${current.intent.profile}:${current.operationId}:${current.operation.contextHash}`.toLowerCase();
      const request = reservations.acceptRequests.get(key);
      if (!request) throw new Error('Current-mode Accept has no signing attempt in this session.');
      const decoded = decodeCanonical(request.data, cheapAccept, acceptMethod(current.intent.profile));
      if (decoded[0] !== current.operationId || decoded[1] !== current.operation.contextHash) throw new Error('Current-mode Accept recovery context changed.');
      return acceptanceResult(current, prepared, request, transactionHash);
    },
    submitCurrentCheapQuote: async (prepared: CurrentCheapDexPreparedQuote, progress?: CurrentDexSendProgress) => {
      assertCurrentDexQuoteNotRestored(prepared);
      assertCurrentSwapCandidate(c, prepared.intent, signer);
      validateQuote(prepared); requireEmptyPending();
      if (prepared.profile === 'cheap-async') requireLookupCapacity();
      const admission = issueCurrentCheapDexQuoteAdmission(prepared, signer), call: UnsignedTransaction = Object.freeze({
        chainId: prepared.chainId, from: prepared.from, to: prepared.to, value: 0n, data: prepared.data });
      const key = `${chainId}:${owner}:${keccak256(call.data)}`.toLowerCase();
      if (reservations.quote.has(key)) throw new Error('Current-mode Quote was already submitted. Recover it instead.');
      reservations.quote.add(key); let signing = false;
      try {
        await restoreFundingBudget(prepared);
        const authorize = nativeSigning('quote', gasCaps()[prepared.profile].quote, prepared);
        const sent = await sendCurrent('quote', call, prepared.intent.deadline, () => {
          assertCurrentSwapCandidate(c, prepared.intent, signer);
          if (prepared.profile === 'cheap-async') requireLookupCapacity();
          validateQuote(prepared); assertCurrentDexInternalAdmission(admission, 'quote', signer, prepared.data, prepared);
        }, () => { signing = true; }, undefined, gasCaps()[prepared.profile].quote, observeSend(prepared.profile, 'quote', progress), authorize, undefined, { prepared, signer });
        await rememberHash(sent);
        return Object.freeze({ ...sent, profile: prepared.profile, recover: () => recoverQuote(prepared, sent.transactionHash) });
      } catch (error) { if (!signing || wasCurrentDexUnsentReleased(error)) reservations.quote.delete(key); throw error; }
    },
    submitCurrentCheapAcceptance: async ({ issued, confirm, progress }: { issued: CurrentCheapDexIssuedQuote;
      confirm: (model: unknown) => Promise<boolean>; progress?: CurrentDexSendProgress }) => {
      assertCurrentSwapCandidate(c, issued.intent, signer);
      assertCurrentCheapDexIssuedQuote(issued, signer); requireEmptyPending();
      if (issued.intent.profile === 'cheap-async') requireLookupCapacity();
      const preparedQuote = capturedQuote(issued);
      if(issued.intent.profile==='fast-pool'&&isCurrentDexBrowserSigner(signer,c.graph,owner)&&hasCurrentNativeSigningBudget(signer)&&
          currentNativeSwapCheckpoint(signer).activeSwap!==`quote:${keccak256(preparedQuote.data)}`)
        throw new Error('This Fast Quote is no longer active in the App. Request a new Quote.');
      const ready = await refreshReady(issued, preparedQuote);
      if (usesCurrentSwapAccounting(c)) assertCurrentNativeSwapIntent(preparedQuote, now(), false, true, signer);
      const key = `${chainId}:${owner}:${ready.intent.profile}:${ready.operationId}:${ready.operation.contextHash}`.toLowerCase();
      if (reservations.accept.has(key)) throw new Error('Current-mode Accept was already submitted. Recover it instead.');
      reservations.accept.add(key); let signing = false;
      try {
        const quoted = cheapProtocol ? await verifyReceipt(ready, preparedQuote, ready.originBlock) : undefined;
        const prepared = await reviewAcceptance(ready, confirm, quoted);
        await transport.assertCurrent();
        if (!prepared) { reservations.accept.delete(key); return null; }
        if (quoted) {
          if (quoted.kind !== 'quote' || !quoted.amounts.filled || quoted.amounts.actualInput <= 0n || quoted.amounts.netOutput <= 0n) {
            if (usesCurrentNativeSwapChecks(c) && ready.intent.profile === 'fast-pool' && quoted.kind === 'quote' && !quoted.amounts.filled) {
              completeCurrentNativeSwapScope(signer, `quote:${keccak256(preparedQuote.data)}`); await persistBudget();
            }
            throw new Error('Current-mode tolerance needs a positive authenticated Quote.');
          }
          reviewed.set(issuedKey(ready), Object.freeze({ actualInput: quoted.amounts.actualInput,
            netOutput: quoted.amounts.netOutput, context: ready.operation.contextHash }));
        }
        const admission = issueCurrentCheapDexAcceptAdmission(issueCurrentCheapDexQuoteAdmission(preparedQuote, signer), ready, prepared, signer);
        const call = acceptanceCall(prepared), decoded = decodeCanonical(call.data, cheapAccept, acceptMethod(ready.intent.profile));
        if (prepared.readyToSign !== false || call.chainId !== chainId || !sameAddress(call.from, owner) ||
            !sameAddress(call.to, core) || call.value !== 0n || decoded[0] !== ready.operationId ||
            decoded[1] !== ready.operation.contextHash) throw new Error('Current-mode Accept call changed.');
        const validate = async () => {
          assertCurrentSwapCandidate(c, ready.intent, signer);
          if (ready.intent.profile === 'cheap-async') requireLookupCapacity();
          assertCurrentDexInternalAdmission(admission, 'accept', signer, prepared.data, preparedQuote, ready);
          const fresh = await refreshReady(ready, preparedQuote);
          if (fresh.operation.contextHash !== ready.operation.contextHash) throw new Error('Current-mode private context changed.');
          await requireFunding(preparedQuote, await currentHead(ready.operation.deadline, gasCaps()[ready.intent.profile].accept, usesCurrentSwapAccounting(c)));
          await transport.assertCurrent();
        };
        const authorize = nativeSigning('accept', gasCaps()[ready.intent.profile].accept, preparedQuote);
        const sent = await sendCurrent('accept', call, ready.operation.deadline, validate,
          request => { signing = true; reservations.acceptRequests.set(key, request); },
          undefined, gasCaps()[ready.intent.profile].accept, observeSend(ready.intent.profile, 'accept', progress), authorize, undefined, { prepared: preparedQuote, signer });
        await rememberHash(sent);
        return Object.freeze({ ...sent, operationId: ready.operationId, profile: ready.intent.profile, status: 'accepting' as const,
          recover: () => acceptanceResult(ready, preparedQuote, sent.request, sent.transactionHash) });
      } catch (error) {
        if (!signing || wasCurrentDexUnsentReleased(error)) reservations.accept.delete(key);
        if (wasCurrentDexUnsentReleased(error)) reservations.acceptRequests.delete(key);
        throw error;
      }
    },
    submitCurrentCheapOwnerAction: async ({ issued, action, confirm, progress }: { issued: CurrentCheapDexIssuedQuote;
      action: 'cancel' | 'recover'; confirm: (operation: CurrentCheapDexOperation) => Promise<boolean>; progress?: CurrentDexSendProgress }) => {
      assertCurrentSwapCandidate(c, issued.intent, signer);
      assertCurrentCheapDexIssuedQuote(issued, signer); requireEmptyPending();
      const prepared = capturedQuote(issued);
      validateIssued(issued, prepared);
      if (issued.intent.profile !== 'cheap-async') throw new Error('Fast has no cancel or recover endpoint.');
      const refresh = async () => {
        const result = await readOperation('cheap-async', issued.operationId, issued.originBlock);
        await transport.assertCurrent();
        if (result.operation.deadline !== issued.operation.deadline ||
            (BigInt(issued.operation.contextHash) !== 0n && result.operation.contextHash !== issued.operation.contextHash) ||
            !currentCheapDexOwnerActionEligible(c, result.operation.stage, action)) {
          throw new Error('Current-mode owner action is not eligible.');
        }
        return result.operation;
      };
      const operation = await refresh();
      if (!await confirm(operation)) return null;
      await transport.assertCurrent();
      const key = `${chainId}:${owner}:cheap-async:${issued.operationId}:${action}`.toLowerCase();
      if (reservations.actions.has(key)) throw new Error('Current-mode owner action was already submitted.');
      reservations.actions.add(key); let signing = false;
      try {
        const call = Object.freeze({ chainId, from: owner, to: core, value: 0n as const,
          data: ownerActionInterface.encodeFunctionData(action === 'cancel' ? 'cancelSwap' : 'recoverSwap', [issued.operationId]) });
        const authorize = nativeSigning(action, gasCaps()['cheap-async'][action], prepared);
        const sent = await sendCurrent(action, call, undefined, async () => { assertCurrentSwapCandidate(c, prepared.intent, signer); await refresh(); },
          () => { signing = true; }, issued.operationId, gasCaps()['cheap-async'][action], {
            sendStarted: () => progress?.walletRequested?.(),
            hashReturned: transactionHash => progress?.transactionHashReturned?.(transactionHash),
            submissionReturned: () => {}
          }, authorize, undefined, { prepared, signer });
        await rememberHash(sent);
        return Object.freeze({ ...sent, operationId: issued.operationId, status: 'release-pending' as const,
          recover: async () => {
            const mined = await verifyMinedCall(sent.request, sent.transactionHash);
            const event = uniqueCheapEvent(mined, core, 'CheapAsyncAdvanced');
            if (event.quoteId !== issued.operationId || event.stage !== BigInt(stages.released) || event.context !== operation.contextHash) throw new Error('Current-mode release event changed.');
            await attest(await transport.readHead()); await transport.assertCurrent();
            const origin = { number: BigInt(mined.blockNumber!), hash: mined.blockHash! };
            // Eligibility reads use the real getter; no historical status or epoch is fabricated.
            const released = await readOperation('cheap-async', issued.operationId, origin);
            if (released.operation.stage !== stages.released || released.operation.contextHash !== operation.contextHash) throw new Error('Current-mode release is not confirmed.');
            // Before READY, issued context is zero; a later READY context comes from the canonical getter.
            const privateReceipt = await verifyReceipt(issued, prepared, origin, true, operation.contextHash);
            await verifyTokens(issued, privateReceipt.amounts, action, mined, operation.contextHash);
            await recheckMinedCall(sent.request, sent.transactionHash, mined);
            const recorded = pending();
            if (!recorded || recorded.phase !== action) throw new Error('Current-mode pending release changed.');
            clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, sent.transactionHash));
            const lookup = operationLookup(issued);
            if (lookup) clearCurrentDexOperationLookup(storage, lookup);
            if (usesCurrentNativeSwapChecks(c)) {
              completeCurrentNativeSwapScope(signer, `quote:${keccak256(prepared.data)}`); await persistBudget();
            }
            return Object.freeze({ status: 'released' as const, operationId: issued.operationId, transactionHash: sent.transactionHash });
          } });
      } catch (error) { if (!signing || wasCurrentDexUnsentReleased(error)) reservations.actions.delete(key); throw error; }
    }
  });
  return adapter;
};
