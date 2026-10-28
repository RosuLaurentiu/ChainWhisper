import { assertCurrentSwapCandidate, assertCurrentSwapIdentity, assertCurrentNativeSwapIntent, usesCurrentNativeSwapChecks, currentNativeSigningBudget, completeCurrentNativeSwapScope,
  currentNativeSwapCheckpoint, recordCurrentNativeSwapHash, restoreCurrentNativeSwapCheckpoint, validateCurrentNativeSwapCheckpoint, currentNativeSwapChargeGasPrice, hasCurrentNativeSigningBudget, bindCurrentNativeSwapFundingScope, renewCurrentNativeSwapFundingWindow, renewCurrentNativeSwapClosedWindow, CURRENT_NATIVE_SWAP_LIMITS, type CurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';
import { CURRENT_D06_SWAP_GAS_CAPS, assertCurrentD06AppAuthority, assertCurrentAppInitialClaimAuthority, assertCurrentAppSharedFundingAuthority, assertCurrentAppLimitAuthority, assertCurrentAppPoolAuthority, assertCurrentAppPoolAllowanceCleanupAuthority, CURRENT_APP_REPLACEMENT_TRIAL, CURRENT_APP_FURTHER_TRIAL, CURRENT_APP_FOURTH_TRIAL, CURRENT_APP_HISTORY_REPLACEMENT_TRIAL, hasCurrentHistoryReplacementProof, CURRENT_APP_HISTORY_FAST_TRIAL, hasCurrentHistoryFastProof } from './currentDexC1SwapPolicy';
import { assertCurrentPoolFundingPrepared, type CurrentPoolPreparedPreview, type CurrentPoolPreparedFunding, type CurrentPoolPreparedTopUpPreview, type CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import { assertCurrentPoolPositionPrepared, type CurrentPoolPreparedPositionAction, type CurrentPoolPreparedSnapshot, type CurrentPoolPreparedExitPreview } from '../features/wallet/currentDexPoolPositionCapability';
import { assertCurrentSharedPoolApprovalPrepared, type CurrentSharedPoolApprovalPrepared } from './currentSharedDexTokenFunding';
import { currentPoolOwnerGasCap } from './currentDexPoolPosition';
import { assertCurrentLimitPrepared, type CurrentLimitPrepared, type CurrentLimitPreparedSnapshot, type CurrentLimitPreparedOwner, type CurrentLimitFundingReview } from '../features/wallet/currentDexLimitCapability';
import { CURRENT_LIMIT_CREATE_GAS_CAP, CURRENT_LIMIT_SNAPSHOT_GAS_CAP, CURRENT_LIMIT_OWNER_GAS_CAPS } from './currentDexLimit';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';
import { CURRENT_EXIT_SWAP_GAS_CAPS, usesCurrentSwapAccounting, currentSwapFixedGasPrice } from './currentDexExitSwapPolicy';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION } from './currentSharedDexTokenDistribution';
import type { CurrentDexOwnerTokenAmounts, CurrentDexOwnerTokenPhase } from './currentDexOwnerTokenProof';
import { assertCurrentNativePoolSourceFit, assertCurrentNativePoolSourceFitBinding, type CurrentNativePoolSourceFit } from './currentDexNativePoolPolicy';
import { Interface, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import type { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import { assertCurrentDexIssuedQuote, currentDexRestoredPlan, assertCurrentDexQuoteNotRestored } from '../features/wallet/currentDexQuoteCapability';
import { CURRENT_DEX_OPEN_ABI, CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI,
  decodeCurrentCheapDexOperation, type CurrentCheapDexProfile } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
export class CurrentDexPrivateReceiptError extends Error {
  constructor(message: string) {
    super(`Private verification failed: ${message}`);
    this.name = 'CurrentDexPrivateReceiptError';
  }
}

import {
  CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256,
  CURRENT_DEX_SUBMISSION_SOURCES_SHA256,
  CURRENT_DEX_SUBMISSION_VERSION,
  verifyCurrentDexSubmissionAdmission,
  type CurrentDexNativeAdmission,
  type CurrentDexSubmissionAdmission,
  type CurrentDexSubmissionAdmissionEvidence,
  type CurrentDexSubmissionPhase
} from './currentDexSubmissionAdmission';
import { assertCurrentDexInternalAdmission, issueCurrentSharedPoolAcceptAdmission,
  issueCurrentSharedPoolQuoteAdmission, issueCurrentCheapDexQuoteAdmission,
  issueCurrentCheapDexAcceptAdmission } from './currentDexSubmissionAdmission';
import { CURRENT_CHEAP_DEX_CANDIDATE, ARCHIVED_CHEAP_DEX_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, CURRENT_SHARED_POOL_CANDIDATE, currentCheapDexQuoteProtocol,
  currentCheapDexStages, currentCheapDexOwnerActionEligible, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { assertCurrentSharedPoolIssuedQuote, assertCurrentSharedPoolPreparedQuote,
  assertCurrentCheapDexPreparedQuote, assertCurrentCheapDexIssuedQuote } from '../features/wallet/currentDexQuoteCapability';
import { blockCurrentSwapVerification, blockCurrentDexOperationVerification, clearCurrentDexOperationLookup,
  readCurrentDexOperationLookups, recordCurrentDexOperationLookup,
  clearCurrentDexPendingAttempt, currentDexPendingStorage, readCurrentDexPendingAttempt,
  recordCurrentDexPendingHash, reserveCurrentDexPendingAttempt, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload, type CurrentDexNativeReloadRecord } from './currentDexNativeReload';
import { recoverCurrentPartialLedger } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY, CURRENT_APP_PARTIAL_REFUND_TRIAL, currentPartialLedgerRecoveryAllowed, hasCurrentPartialRefundProof } from './currentDexC1SwapPolicy';
import { CURRENT_OWNER_BETA, isCurrentOwnerBeta, assertCurrentOwnerBetaWindow, isCurrentOwnerBetaRecovery } from './currentDexOwnerBetaPolicy';

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
export type CurrentDexPreparedQuote = NonNullable<Awaited<ReturnType<QuoteCapability['prepareQuote']>>>;
export type CurrentDexIssuedQuote = NonNullable<Awaited<ReturnType<CurrentDexPreparedQuote['readIssue']>>>;
export type CurrentCheapDexPreparedQuote = NonNullable<Awaited<ReturnType<QuoteCapability['prepareCurrentQuote']>>>;
export type CurrentCheapDexIssuedQuote = NonNullable<Awaited<ReturnType<CurrentCheapDexPreparedQuote['readIssue']>>>;
type CurrentCheapDexOperation = ReturnType<typeof decodeCurrentCheapDexOperation>;
type CurrentCheapReceipt = Awaited<ReturnType<Awaited<ReturnType<typeof import('../features/wallet/currentDexReceiptCapability').issueCurrentDexReceiptCapability>>['readCurrent']>>;

type TransactionRequest = Readonly<{ chainId: bigint; from: string; to: string; value: 0n; data: string; gasLimit: bigint; nonce?: number; gasPrice?: bigint }>;
type UnsignedTransaction = Omit<TransactionRequest, 'gasLimit'>;
type SubmittedTransaction = Readonly<{ hash: string; chainId: bigint; from: string; to: string | null; value: bigint; data: string;
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

const openInterface = new Interface(CURRENT_DEX_OPEN_ABI);
const acceptInterface = new Interface(CURRENT_DEX_ACCEPT_ABI);
const ownerActionInterface = new Interface(['function cancelSwap(uint256 operationId)', 'function recoverSwap(uint256 operationId)']);
const hash = (value: string, label: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) throw new Error(`Invalid ${label}.`);
  return value.toLowerCase();
};

const address = (value: string, label: string) => {
  const normalized = getAddress(value);
  if (BigInt(normalized) === 0n) throw new Error(`Invalid ${label}.`);
  return normalized;
};
const sameAddress = (left: string, right: string) => address(left, 'transaction address') === address(right, 'transaction address');
const sameCall = (left: UnsignedTransaction, right: UnsignedTransaction) =>
  left.chainId === right.chainId && sameAddress(left.from, right.from) && sameAddress(left.to, right.to) &&
  left.value === right.value && left.data.toLowerCase() === right.data.toLowerCase();

const nativeCheck = (value: CurrentDexNativeAdmission, label: string) => {
  hash(value.evidenceHash, `${label} native evidence hash`);
  if (typeof value.gasUsed !== 'bigint' || typeof value.gasLimit !== 'bigint' ||
      value.gasUsed <= 0n || value.gasLimit <= 0n || value.gasUsed > value.gasLimit) {
    throw new Error(`Invalid ${label} native transaction-fit evidence.`);
  }
};

const admittedEvidence = (admission: CurrentDexSubmissionAdmission | null, phase: CurrentDexSubmissionPhase) => {
  if (!verifyCurrentDexSubmissionAdmission(admission)) throw new Error('Current DEX submission is not admitted.');
  const evidence = admission.evidence;
  if (evidence.version !== CURRENT_DEX_SUBMISSION_VERSION ||
      evidence.candidateSha256 !== CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256 ||
      evidence.sourcesSha256 !== CURRENT_DEX_SUBMISSION_SOURCES_SHA256 || evidence.phase !== phase ||
      typeof evidence.chainId !== 'bigint' || evidence.chainId <= 0n) {
    throw new Error('Current DEX submission evidence is for another candidate or phase.');
  }
  address(evidence.principal, 'submission principal'); address(evidence.core, 'submission Core');
  address(evidence.inputToken, 'submission input token'); address(evidence.outputToken, 'submission output token');
  hash(evidence.manifestHash, 'submission manifest hash'); hash(evidence.runtimeHash, 'submission runtime hash');
  hash(evidence.releaseId, 'submission release ID'); hash(evidence.tokenPolicyHash, 'submission token policy evidence');
  hash(evidence.callHash, `${phase} call hash`);
  hash(evidence.authorizationHash, 'submission authorization evidence');
  if (sameAddress(evidence.inputToken, evidence.outputToken) || sameAddress(evidence.principal, evidence.core)) {
    throw new Error('Current DEX submission evidence has an invalid authority or token pair.');
  }
  nativeCheck(evidence.native, phase);
  return evidence;
};

const validateSamePlan = (quote: CurrentDexSubmissionAdmissionEvidence, accept: CurrentDexSubmissionAdmissionEvidence) => {
  if (quote.chainId !== accept.chainId || !sameAddress(quote.principal, accept.principal) ||
      !sameAddress(quote.core, accept.core) || !sameAddress(quote.inputToken, accept.inputToken) ||
      !sameAddress(quote.outputToken, accept.outputToken) || quote.manifestHash.toLowerCase() !== accept.manifestHash.toLowerCase() ||
      quote.runtimeHash.toLowerCase() !== accept.runtimeHash.toLowerCase() ||
      quote.releaseId.toLowerCase() !== accept.releaseId.toLowerCase() ||
      quote.tokenPolicyHash.toLowerCase() !== accept.tokenPolicyHash.toLowerCase()) {
    throw new Error('Acceptance authority does not match the admitted quote plan.');
  }
};

const decodeCanonical = (data: string, contract: Interface, functionName: string) => {
  try {
    if (!/^0x[0-9a-fA-F]+$/.test(data)) throw new Error();
    const decoded = contract.decodeFunctionData(functionName, data);
    if (contract.encodeFunctionData(functionName, decoded).toLowerCase() !== data.toLowerCase()) throw new Error();
    return decoded;
  } catch {
    throw new Error('Current DEX transaction changed the admitted call.');
  }
};

const validateQuoteCall = (call: UnsignedTransaction, prepared: CurrentDexPreparedQuote,
  evidence: CurrentDexSubmissionAdmissionEvidence) => {
  const decoded = decodeCanonical(call.data, openInterface, 'openSinglePassSwapV2');
  if (call.value !== 0n || keccak256(call.data).toLowerCase() !== evidence.callHash.toLowerCase() ||
      !sameAddress(decoded[0], prepared.intent.inputToken) || !sameAddress(decoded[1], prepared.intent.outputToken) ||
      !sameAddress(decoded[2], prepared.intent.destination) || decoded[3] !== prepared.intent.deadline) {
    throw new Error('Current DEX transaction changed the admitted quote call.');
  }
};

const validateAcceptanceCall = (call: UnsignedTransaction, prepared: CurrentDexPreparedAcceptance,
  issued: CurrentDexIssuedQuote, evidence: CurrentDexSubmissionAdmissionEvidence) => {
  const decoded = decodeCanonical(call.data, acceptInterface, 'acceptPrivateSwapV1');
  if (call.value !== 0n || keccak256(call.data).toLowerCase() !== evidence.callHash.toLowerCase() ||
      decoded[0] !== issued.operationId || decoded[1].toLowerCase() !== issued.operation.contextHash.toLowerCase() ||
      prepared.operationId !== decoded[0] || prepared.contextHash.toLowerCase() !== decoded[1].toLowerCase()) {
    throw new Error('Current DEX transaction changed the admitted acceptance call.');
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
  if (!receipt || (receipt.status !== 1 && !(allowFailed && receipt.status === 0)) || hash(receipt.hash, 'mined transaction hash') !== transactionHash ||
      !sameAddress(receipt.from, request.from) || !receipt.to || !sameAddress(receipt.to, request.to)) {
    throw new Error('Current DEX transaction did not confirm successfully.');
  }
};

const validatePlan = (evidence: CurrentDexSubmissionAdmissionEvidence, prepared: CurrentDexPreparedQuote) => {
  const i = prepared.intent;
  if (prepared.readyToSign !== false || prepared.chainId !== evidence.chainId || !sameAddress(prepared.from, evidence.principal) ||
      !sameAddress(prepared.to, evidence.core) || prepared.value !== 0n ||
      hash(prepared.manifestHash, 'prepared manifest hash') !== evidence.manifestHash.toLowerCase() ||
      hash(i.runtimeHash, 'prepared runtime hash') !== evidence.runtimeHash.toLowerCase() ||
      hash(i.releaseId, 'prepared release ID') !== evidence.releaseId.toLowerCase() ||
      !sameAddress(i.principal, evidence.principal) || !sameAddress(i.core, evidence.core) ||
      !sameAddress(i.inputToken, evidence.inputToken) || !sameAddress(i.outputToken, evidence.outputToken)) {
    throw new Error('Prepared quote does not match the admitted plan.');
  }
};

const validateIssuedPlan = (evidence: CurrentDexSubmissionAdmissionEvidence, issued: CurrentDexIssuedQuote, currentTime: bigint) => {
  const i = issued.intent;
  if (issued.readyToSign !== false || issued.operationId <= 0n || i.operationId !== issued.operationId ||
      issued.operation.status !== 2 || !issued.operation.quotePrepared || issued.operation.funded || currentTime >= i.deadline ||
      issued.operation.deadline !== i.deadline ||
      i.chainId !== evidence.chainId || !sameAddress(i.principal, evidence.principal) || !sameAddress(i.core, evidence.core) ||
      !sameAddress(i.inputToken, evidence.inputToken) || !sameAddress(i.outputToken, evidence.outputToken) ||
      hash(i.runtimeHash, 'issued runtime hash') !== evidence.runtimeHash.toLowerCase() ||
      hash(i.releaseId, 'issued release ID') !== evidence.releaseId.toLowerCase() ||
      i.contextHash.toLowerCase() !== issued.operation.contextHash.toLowerCase()) {
    throw new Error('Mined quote does not match the active admitted plan.');
  }
};

const readReadyQuote = async (issued: CurrentDexIssuedQuote, evidence: CurrentDexSubmissionAdmissionEvidence, now: () => bigint) => {
  assertCurrentDexIssuedQuote(issued);
  const current = await issued.readCurrent();
  assertCurrentDexIssuedQuote(current);
  if (current.operationId !== issued.operationId || current.operation.epochId !== issued.operation.epochId ||
      current.transactionHash !== issued.transactionHash || current.block.number < issued.block.number ||
      current.originBlock.number !== issued.originBlock.number ||
      current.originBlock.hash.toLowerCase() !== issued.originBlock.hash.toLowerCase() ||
      (current.block.number === issued.block.number && current.block.hash.toLowerCase() !== issued.block.hash.toLowerCase()) ||
      current.chainId !== issued.chainId || !sameAddress(current.core, issued.core) ||
      current.runtimeHash.toLowerCase() !== issued.runtimeHash.toLowerCase() ||
      current.releaseId.toLowerCase() !== issued.releaseId.toLowerCase() ||
      current.intent.chainId !== issued.intent.chainId || !sameAddress(current.intent.principal, issued.intent.principal) ||
      !sameAddress(current.intent.core, issued.intent.core) || !sameAddress(current.intent.inputToken, issued.intent.inputToken) ||
      !sameAddress(current.intent.outputToken, issued.intent.outputToken) ||
      current.intent.runtimeHash.toLowerCase() !== issued.intent.runtimeHash.toLowerCase() ||
      current.intent.releaseId.toLowerCase() !== issued.intent.releaseId.toLowerCase() ||
      current.intent.contextHash.toLowerCase() !== issued.intent.contextHash.toLowerCase() ||
      current.operation.contextHash.toLowerCase() !== issued.operation.contextHash.toLowerCase() ||
      current.intent.deadline !== issued.intent.deadline || current.intent.destination !== issued.intent.destination ||
      current.intent.maximumInput !== issued.intent.maximumInput || current.intent.minimumInput !== issued.intent.minimumInput ||
      current.intent.minimumOutput !== issued.intent.minimumOutput ||
      current.intent.rateNumerator !== issued.intent.rateNumerator || current.intent.rateDenominator !== issued.intent.rateDenominator) {
    throw new Error('Current quote changed from the mined Open operation.');
  }
  validateIssuedPlan(evidence, current, now());
  return current;
};

const quoteCall = (prepared: CurrentDexPreparedQuote): UnsignedTransaction => Object.freeze({
  chainId: prepared.chainId, from: prepared.from, to: prepared.to, value: 0n, data: prepared.data
});
const acceptanceCall = (prepared: CurrentDexPreparedAcceptance): UnsignedTransaction => Object.freeze({
  chainId: prepared.chainId, from: prepared.from, to: prepared.to, value: 0n, data: prepared.data
});

export const createCurrentDexSubmissionAdapter = ({ quoteAdmission, transport, now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  quoteAdmission: CurrentDexSubmissionAdmission<'quote'> | null;
  transport: CurrentDexSubmissionTransport;
  now?: () => bigint;
}) => {
  const quoteKeys = new Set<string>(), acceptKeys = new Set<string>();
  const submit = async (call: UnsignedTransaction, check: CurrentDexNativeAdmission, validateBeforeSign: () => void | Promise<void>,
    onSigningRequest: () => void) => {
    await validateBeforeSign();
    await transport.assertCurrent();
    const gas = await transport.estimateGas(call);
    await transport.assertCurrent();
    if (typeof gas !== 'bigint' || gas <= 0n || gas > check.gasLimit) throw new Error('Current DEX transaction exceeds admitted native gas.');
    const request = Object.freeze({ ...call, gasLimit: check.gasLimit });
    await transport.assertCurrent();
    await validateBeforeSign();
    onSigningRequest();
    const transaction = await transport.send(request);
    return Object.freeze({ request, transactionHash: validateSubmitted(transaction, request) });
  };
  const recover = async (request: TransactionRequest, transactionHash: string) => {
    await transport.assertCurrent();
    const receipt = await transport.waitForReceipt(hash(transactionHash, 'recovery transaction hash'));
    await transport.assertCurrent();
    validateReceipt(receipt, request, transactionHash.toLowerCase());
    return receipt;
  };
  return Object.freeze({
    version: CURRENT_DEX_SUBMISSION_VERSION,
    readyToSign: verifyCurrentDexSubmissionAdmission(quoteAdmission) && quoteAdmission.evidence.phase === 'quote',
    submitQuote: async (prepared: CurrentDexPreparedQuote) => {
      const evidence = admittedEvidence(quoteAdmission, 'quote'), captured = quoteCall(prepared);
      const validate = () => {
        validatePlan(evidence, prepared);
        if (now() >= prepared.intent.deadline) throw new Error('Prepared quote expired before submission.');
        const current = quoteCall(prepared);
        if (!sameCall(current, captured)) throw new Error('Prepared quote changed before submission.');
        validateQuoteCall(current, prepared, evidence);
      };
      validate();
      const key = `${captured.chainId}:${captured.from}:${captured.to}:${keccak256(captured.data)}`.toLowerCase();
      if (quoteKeys.has(key)) throw new Error('Prepared quote was already submitted. Recover it instead.');
      quoteKeys.add(key);
      let signingRequested = false;
      try {
        const submitted = await submit(captured, evidence.native, validate, () => { signingRequested = true; });
        return Object.freeze({ ...submitted,
          recover: async () => {
            await recover(submitted.request, submitted.transactionHash);
            const issued = await prepared.readIssue(submitted.transactionHash);
            if (!issued) throw new Error('Mined quote operation is not available. Recover or request a new quote.');
            validatePlan(evidence, prepared);
            if (issued.intent.operationId !== issued.operationId || issued.intent.contextHash.toLowerCase() !== issued.operation.contextHash.toLowerCase()) {
              throw new Error('Mined quote identity is inconsistent.');
            }
            return issued;
          }
        });
      } catch (error) {
        if (!signingRequested) quoteKeys.delete(key);
        throw error;
      }
    },
    submitAcceptance: async ({ issued, prepare }: {
      issued: CurrentDexIssuedQuote;
      prepare: (ready: CurrentDexIssuedQuote) => Promise<Readonly<{
        prepared: CurrentDexPreparedAcceptance;
        admission: CurrentDexSubmissionAdmission<'accept'> | null;
      }> | null>;
    }) => {
      const quoteEvidence = admittedEvidence(quoteAdmission, 'quote');
      assertCurrentDexIssuedQuote(issued);
      const key = [issued.intent.chainId, issued.intent.principal, issued.intent.core, issued.operationId,
        issued.operation.contextHash, issued.intent.runtimeHash, issued.intent.releaseId].join(':').toLowerCase();
      if (acceptKeys.has(key)) throw new Error('Quote acceptance was already submitted. Recover it instead.');
      acceptKeys.add(key);
      let signingRequested = false;
      try {
        const ready = await readReadyQuote(issued, quoteEvidence, now);
        await transport.assertCurrent();
        const reviewed = await prepare(ready);
        await transport.assertCurrent();
        if (!reviewed) { acceptKeys.delete(key); return null; }
        const { prepared } = reviewed;
        const evidence = admittedEvidence(reviewed.admission, 'accept');
        validateSamePlan(quoteEvidence, evidence);
        const captured = acceptanceCall(prepared);
        const validate = async () => {
          const refreshed = await readReadyQuote(issued, evidence, now);
          if (refreshed.operation.stageRevision !== ready.operation.stageRevision) {
            throw new Error('Current quote changed during acceptance review.');
          }
          const current = acceptanceCall(prepared);
          if (!sameCall(current, captured) || prepared.readyToSign !== false || prepared.operationId !== issued.operationId ||
              prepared.contextHash.toLowerCase() !== refreshed.operation.contextHash.toLowerCase() ||
              prepared.chainId !== evidence.chainId || !sameAddress(prepared.from, evidence.principal) ||
              !sameAddress(prepared.to, evidence.core) || prepared.value !== 0n) {
            throw new Error('Prepared acceptance does not match the mined quote or admitted plan.');
          }
          validateAcceptanceCall(current, prepared, refreshed, evidence);
        };
        const submitted = await submit(captured, evidence.native, validate, () => { signingRequested = true; });
        return Object.freeze({ ...submitted, operationId: issued.operationId, status: 'accepting' as const,
          recover: async () => {
            await recover(submitted.request, submitted.transactionHash);
            return Object.freeze({ operationId: issued.operationId, transactionHash: submitted.transactionHash,
              status: 'settlement-pending' as const });
          }
        });
      } catch (error) {
        if (!signingRequested) acceptKeys.delete(key);
        throw error;
      }
    }
  });
};

// Internal current-candidate path. The legacy evidence-shaped adapter above stays denied.
const SHARED_POOL_GAS_CAP = 108_000_000n;
type CurrentHead = Readonly<{ number: bigint; hash: string; timestamp: bigint; gasLimit: bigint }>;
export { CURRENT_NATIVE_FIXED_GAS_PRICE } from './currentDexExitSwapPolicy';
export const CURRENT_NATIVE_RECOVERY_RESERVE = 10_000_000_000_000_000n;
export type CurrentNativeResources = Readonly<{ owner: string; chainId: bigint; head: CurrentHead;
  latestNonce: number; pendingNonce: number; gasPrice: bigint; baseFeePerGas: bigint; balance: bigint; code: string }>;
type CurrentAppPoolSigning = Readonly<{ signer: object }> & (
  { kind: 'funding'; prepared: CurrentPoolPreparedPreview | CurrentPoolPreparedFunding | CurrentPoolPreparedTopUpPreview | CurrentPoolPreparedTopUpFunding } |
  { kind: 'position'; prepared: CurrentPoolPreparedPositionAction | CurrentPoolPreparedSnapshot | CurrentPoolPreparedExitPreview } |
  { kind: 'approval'; prepared: CurrentSharedPoolApprovalPrepared });
export type CurrentTransport = CurrentDexSubmissionTransport & Readonly<{ readHead(): Promise<CurrentHead>;
  readNonce(): Promise<number>;
  readNativeResources?(head: CurrentHead): Promise<CurrentNativeResources>;
  readBlockHash(blockNumber: number): Promise<string | null>;
  readTransaction(transactionHash: string): Promise<SubmittedTransaction | null>;
  verifyCanonicalInclusion?(transaction: SubmittedTransaction, receipt: MinedReceipt): Promise<void> }>;
const currentReservations = new WeakMap<object, { quote: Set<string>; accept: Set<string>; actions: Set<string>;
  acceptRequests: Map<string, TransactionRequest>;
  cheapReviewed?: Map<string, Readonly<{ actualInput: bigint; netOutput: bigint; context: string }>>;
  cheapRecovered?: Map<string, { prepared: CurrentCheapDexPreparedQuote; origin: { number: bigint; hash: string } }>;
  cheapClosedTrials?: Set<string> }>();
export const createCurrentAttemptBoundary = ({ storage, c, core, owner, chainId, transport, attest, now, historical = true, bindTarget = false, canonicalIndexProof = false }: {
  storage: ReturnType<typeof currentDexPendingStorage>; c: { graph: string; packageSha256?: string }; core: string; owner: string; chainId: bigint;
  transport: CurrentTransport; attest: (head: CurrentHead) => Promise<void>; now: () => bigint; historical?: boolean; bindTarget?: boolean;
  canonicalIndexProof?: boolean;
}) => {
  const nativeFit = [STAGED_NATIVE_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, STAGED_SHARED_HISTORY_DEX_CANDIDATE]
    .some(candidate => c.graph === candidate.graph && core.toLowerCase() === candidate.core);
  const exitFit = [STAGED_EXIT_PREVIEW_DEX_CANDIDATE, STAGED_SHARED_HISTORY_DEX_CANDIDATE].some(candidate =>
    c.graph === candidate.graph && core.toLowerCase() === candidate.core && chainId === BigInt(candidate.chainId));
  const fixedGasPrice = currentSwapFixedGasPrice(c);
  const pending = () => readCurrentDexPendingAttempt(storage);
  const requireEmptyPending = () => {
    if (pending()) throw new Error('Current DEX has a pending attempt; reconcile it before another send.');
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
         recorded.operationId !== attempt.operationId || recorded.target !== attempt.target || recorded.txHash !== txHash.toLowerCase()) {
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
  const requireNativeResources = async (head: CurrentHead, nonce: number, gasCap: bigint) => {
    if (!nativeFit) return;
    if (!transport.readNativeResources) throw new Error('Current native send resources are unavailable.');
    await transport.assertCurrent();
    const resources = await transport.readNativeResources(head);
    await transport.assertCurrent();
    if (!sameAddress(resources.owner, owner) || resources.chainId !== chainId ||
        resources.head.number !== head.number || resources.head.hash.toLowerCase() !== head.hash.toLowerCase() ||
        resources.head.timestamp !== head.timestamp || resources.head.gasLimit !== head.gasLimit ||
        resources.latestNonce !== nonce || resources.pendingNonce !== nonce ||
        typeof resources.gasPrice !== 'bigint' || resources.gasPrice <= 0n ||
        typeof resources.baseFeePerGas !== 'bigint' || resources.baseFeePerGas < 0n || resources.baseFeePerGas > fixedGasPrice ||
        resources.code !== '0x' || typeof resources.balance !== 'bigint' ||
        resources.balance < CURRENT_NATIVE_RECOVERY_RESERVE + gasCap * fixedGasPrice ||
        head.timestamp > now() || now() - head.timestamp >= 90n) {
      throw new Error('Current native nonce, fee, payer resources or head changed.');
    }
  };
  const sendCurrent = async (phase: CurrentDexPendingAttempt['phase'], call: UnsignedTransaction, deadline: bigint | undefined,
    validate: () => void | Promise<void>, onSigningRequest: (request: TransactionRequest) => void,
    operationId?: bigint, gasCap = SHARED_POOL_GAS_CAP,
    observation?: { sendStarted(): void; hashReturned?(transactionHash: string): void; submissionReturned(transactionHash: string): void },
    authorizeSigning?: (request: TransactionRequest) => void | Promise<void>, sourceFit?: CurrentNativePoolSourceFit, appSwap?: { prepared: CurrentCheapDexPreparedQuote; signer: object }, appInitialClaimSigner?: object,
    appSharedFunding?: Readonly<{ action: 'initial' | 'refill'; token: string }>,
    appLimit?: Readonly<{ prepared: CurrentLimitPrepared | CurrentLimitPreparedSnapshot | CurrentLimitPreparedOwner | CurrentLimitFundingReview; signer: object }>,
    appPool?: CurrentAppPoolSigning) => {
    const fundingScope = appSharedFunding && Object.freeze({ ...appSharedFunding });
    const limitScope = appLimit && Object.freeze({ ...appLimit });
    const poolScope = appPool && Object.freeze({ ...appPool });
    const checkOwnerBeta = (nonce: number) => {
      if (!isCurrentOwnerBeta(c.graph, owner)) return;
      const saved = readCurrentDexNativeReload(storage);
      if (!saved) throw new Error('Owner beta requires the retained native reload record.');
      validateCurrentNativeSwapCheckpoint(saved.budget, owner, STAGED_SHARED_HISTORY_DEX_CANDIDATE);
      // Action names come only from the issuer-authenticated objects checked below.
      let recovery = false;
      if (appSwap) recovery = isCurrentOwnerBetaRecovery('swap', phase);
      else if (limitScope) {
        const p = limitScope.prepared;
        recovery = isCurrentOwnerBetaRecovery('limit', p.phase === 'limit-snapshot' ? 'snapshot' : p.phase === 'limit-owner' ? p.action : 'create');
      } else if (poolScope) {
        recovery = poolScope.kind === 'position' ? isCurrentOwnerBetaRecovery('pool', poolScope.prepared.action) :
          poolScope.kind === 'approval' && poolScope.prepared.cleanup && poolScope.prepared.amount === 0n;
      }
      assertCurrentOwnerBetaWindow(c.graph, owner, core, chainId, now(), nonce, recovery, gasCap, fixedGasPrice);
    };
    if(poolScope&&(appSwap||appInitialClaimSigner||fundingScope||limitScope||sourceFit)) throw new Error('Pool App scope changed.');
    if(limitScope&&(appSwap||appInitialClaimSigner||fundingScope||sourceFit)) throw new Error('Limit App scope changed.');
    const assertLimitCall = (request: UnsignedTransaction) => {
      if (!limitScope || appSwap || appInitialClaimSigner || fundingScope || sourceFit) throw new Error('Limit App scope changed.');
      const p=limitScope.prepared;
      assertCurrentLimitPrepared(p,limitScope.signer);
      const action=p.phase==='limit-funding-review'?`approve-${p.kind}` as const:p.phase==='limit-create'?'create':p.phase==='limit-snapshot'?'snapshot':p.action;
      const amount=p.phase==='limit-funding-review'?p.amount:p.phase==='limit-create'?p.intent.amount:p.phase==='limit-owner'&&p.action==='topup'?p.topUpAmount:undefined;
      assertCurrentAppLimitAuthority(c.graph,{owner,action,amount});
      const pair=STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.find(pair=>pair.marketId===p.marketId&&p.poolTokens?.length===2&&pair.tokens.every((token,i)=>sameAddress(token,p.poolTokens![i])));
      if(c.graph!==STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph||c.packageSha256!==STAGED_SHARED_HISTORY_DEX_CANDIDATE.packageSha256||
          !sameAddress(core,STAGED_SHARED_HISTORY_DEX_CANDIDATE.core)||chainId!==BigInt(STAGED_SHARED_HISTORY_DEX_CANDIDATE.chainId)||
          p.graph!==c.graph||p.packageSha256!==c.packageSha256||p.chainId!==chainId||!sameAddress(p.from,owner)||!sameAddress(p.to,core)||p.readyToSign!==false||
          request.chainId!==chainId||!sameAddress(request.from,owner)||request.value!==0n||!pair) throw new Error('Limit App candidate, owner or market changed.');
      if(p.phase==='limit-funding-review'){
        const args=currentTokenFundingAbi.decodeFunctionData('approve',request.data);
        if(phase!=='token-approve'||gasCap!==5_000_000n||!pair.tokens.some(token=>sameAddress(token,p.fundingToken))||!sameAddress(request.to,p.fundingToken)||
            !sameAddress(args[0],core)||request.data!==currentTokenFundingAbi.encodeFunctionData('approve',args)||!/^0x[0-9a-fA-F]{130}$/.test(args[1].signature)) throw new Error('Limit App approval call changed.');
      }else{
        const cap=p.phase==='limit-create'?CURRENT_LIMIT_CREATE_GAS_CAP:p.phase==='limit-snapshot'?CURRENT_LIMIT_SNAPSHOT_GAS_CAP:CURRENT_LIMIT_OWNER_GAS_CAPS[p.action];
        if(phase!==p.phase||gasCap!==cap||!sameAddress(request.to,core)||request.data!==p.data) throw new Error('Limit App call changed.');
      }
    };
    const assertSharedFunding = (request: UnsignedTransaction) => {
      if (!fundingScope || appInitialClaimSigner || appSwap || sourceFit) throw new Error('Shared funding App scope changed.');
      assertCurrentAppSharedFundingAuthority(c.graph, owner, fundingScope.token, fundingScope.action);
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
        assertCurrentAppPoolAllowanceCleanupAuthority(c.graph, owner);
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
        assertCurrentAppPoolAuthority(c.graph, { owner, action, positionId: position.positionId, recipient: position.recipient });
        const expectedPhase = action === 'snapshot' ? 'pool-snapshot' : action === 'transfer' ? 'pool-transfer' : 'pool-owner';
        const expectedTarget = action === 'transfer' ? STAGED_SHARED_HISTORY_DEX_CANDIDATE.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1] : core;
        if (phase !== expectedPhase || gasCap !== (action === 'snapshot' ? 30_000_000n : currentPoolOwnerGasCap(action)) || !sameAddress(request.to, expectedTarget) || !sameAddress(position.to, expectedTarget)) throw new Error('Pool App position phase changed.');
      } else {
        const funding = poolScope.kind === 'approval' ? assertCurrentSharedPoolApprovalPrepared(poolScope.prepared, poolScope.signer) : poolScope.prepared;
        if (!('intent' in funding)) throw new Error('Pool cleanup cannot authorize funding.');
        const topUp = 'positionId' in funding, intent = funding.intent;
        const action = poolScope.kind === 'approval' ? (poolScope.prepared.cleanup ? topUp ? 'clear-top-up' : 'clear-create' : topUp ? 'approve-top-up' : 'approve-create') : topUp ? 'top-up' : 'create';
        assertCurrentAppPoolAuthority(c.graph, { owner, action, positionId: topUp ? funding.positionId : undefined, budgets: intent.budgets,
          classId: intent.classId, tolerance: 'tolerance' in intent ? intent.tolerance : [intent.terms[8], intent.terms[9]] });
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
      if (!isCurrentOwnerBeta(c.graph, owner) && c.graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph && hasCurrentNativeSigningBudget(appSwap.signer)) {
        const charges=currentNativeSwapCheckpoint(appSwap.signer).charges;
        if(hasCurrentPartialRefundProof(c.graph,owner,charges)?appSwap.prepared.profile!=='cheap-async':hasCurrentHistoryFastProof(c.graph,owner,charges)?appSwap.prepared.profile!=='fast-pool':
          hasCurrentHistoryReplacementProof(c.graph,owner,charges)&&appSwap.prepared.profile!=='cheap-async')
          throw new Error('The approved App trial swap mode changed.');
      }
      if (!sameAddress(appSwap.prepared.from, owner) || !['quote','accept','cancel','recover','token-approve','token-faucet'].includes(phase)) throw new Error('App trial phase or owner changed.');
      if(appSwap.prepared.graph!==c.graph||!sameAddress(appSwap.prepared.to,core)||!sameAddress(call.to,phase==='token-approve'?appSwap.prepared.intent.inputToken:core)||phase==='quote'&&call.data!==appSwap.prepared.data)throw new Error('App trial candidate, target or Quote calldata changed.');
      if(exitFit)assertCurrentNativeSwapIntent(appSwap.prepared,now(),phase==='cancel'||phase==='recover',phase==='accept');
    }
    if (appInitialClaimSigner) {
      assertCurrentAppInitialClaimAuthority(c.graph,owner,call.to,'initial');
      if(phase!=='token-faucet'||gasCap!==5_000_000n||call.data!==new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet'))throw new Error('Initial claim App call changed.');
      const scope=`quote:${keccak256(call.data)}`;currentNativeSigningBudget(appInitialClaimSigner,owner,now,STAGED_EXIT_PREVIEW_DEX_CANDIDATE).check('token-faucet',`token-faucet:${scope}:${keccak256(call.data)}`,gasCap,scope);
    } else if (fundingScope) assertSharedFunding(call);
    else if (limitScope) assertLimitCall(call);
    else if (poolScope) await assertPoolCall(call);
    else assertCurrentD06AppAuthority(c.graph, appSwap?.prepared.intent);
    if (exitFit && (phase === 'quote' || phase === 'accept' || phase === 'cancel' || phase === 'recover')) {
      const profile = pendingProfile(call.data, phase, 'quote-slippage');
      const expected = phase === 'quote' || phase === 'accept'
        ? CURRENT_EXIT_SWAP_GAS_CAPS[profile][phase] : CURRENT_EXIT_SWAP_GAS_CAPS['cheap-async'][phase];
      if (gasCap !== expected) throw new Error('Current native user phase gas cap changed.');
    }
    // Accepted 110M phase caps retain a 10M absolute block reserve.
    const exitHighCap = exitFit && gasCap === 110_000_000n && (phase === 'quote' || phase === 'accept');
    const checkFit = async () => {
      if (!sourceFit) return;
      if (!nativeFit || historical) throw new Error('Source fit is restricted to the current native Pool funding call.');
      await assertCurrentNativePoolSourceFit(sourceFit, phase, call.data, gasCap, c, owner, core, chainId);
    };
    // Select the source policy before estimation. A failed estimate never selects it.
    await checkFit();
    await validate();
    const initialHead = await currentHead(deadline, gasCap, exitHighCap);
    requireEmptyPending();
    const nonce = await transport.readNonce();
    await transport.assertCurrent();
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Current DEX pending nonce is invalid.');
    checkOwnerBeta(nonce);
    await requireNativeResources(initialHead, nonce, gasCap);
    const numberedCall = Object.freeze({ ...call, nonce, ...(nativeFit ? { gasPrice: fixedGasPrice } : {}) });
    if ((historical || nativeFit) && !sourceFit) {
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
    requireEmptyPending();
    const request = Object.freeze({ ...numberedCall, gasLimit: gasCap });
    const attempt = attemptFor(phase, numberedCall, nonce, operationId);
    if (authorizeSigning) {
      await authorizeSigning(request);
      await checkFit();
      // An asynchronous phase gate can yield after the earlier nonce/resources proof.
      // Recheck those inputs before reserving this action. A consumed budget stays consumed on failure.
      await transport.assertCurrent();
      if (await transport.readNonce() !== nonce) throw new Error('Current DEX pending nonce changed before signing.');
      await transport.assertCurrent();
      await requireNativeResources(await currentHead(deadline, gasCap, exitHighCap), nonce, gasCap);
      await transport.assertCurrent();
    }
    requireEmptyPending();
    if (sourceFit) assertCurrentNativePoolSourceFitBinding(sourceFit, phase, call.data, gasCap, c, owner, core, chainId);
    if (appSwap) {
      assertCurrentCheapDexPreparedQuote(appSwap.prepared, appSwap.signer);
      if (!sameAddress(appSwap.prepared.from, owner) || !['quote','accept','cancel','recover','token-approve'].includes(phase)) throw new Error('App trial phase or owner changed.');
      if(exitFit)assertCurrentNativeSwapIntent(appSwap.prepared,now(),phase==='cancel'||phase==='recover',phase==='accept');
    }
    if (appInitialClaimSigner) {
      const scope=`quote:${keccak256(call.data)}`,budget=currentNativeSwapCheckpoint(appInitialClaimSigner);
      assertCurrentAppInitialClaimAuthority(c.graph,owner,call.to,'initial');
      const charge=budget.charges[budget.charges.length-1];
      if(charge?.phase!=='token-faucet'||charge.key!==`token-faucet:${scope}:${keccak256(call.data)}`||charge.nonce!==nonce)throw new Error('Initial claim has no durable shared reservation.');
    } else if (fundingScope) assertSharedFunding(numberedCall);
    else if (limitScope) assertLimitCall(numberedCall);
    else if (poolScope) await assertPoolCall(numberedCall);
    else assertCurrentD06AppAuthority(c.graph, appSwap?.prepared.intent);
    requireEmptyPending();
    checkOwnerBeta(nonce);
    reserveCurrentDexPendingAttempt(storage, attempt);
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
  return { pending, requireEmptyPending, requireOwnPending, currentHead, sendCurrent, verifyMinedCall, recheckMinedCall };
};

export const createCurrentSharedPoolSubmissionAdapter = ({ signer, ownerAddress, chainId, transport, attest,
  reviewAcceptance, readOperation, now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport;
  attest: (head: CurrentHead) => Promise<void>;
  reviewAcceptance: (issued: CurrentDexIssuedQuote, confirm: (model: unknown) => Promise<boolean>) => Promise<CurrentDexPreparedAcceptance | null>;
  readOperation: (operationId: bigint, origin?: { number: bigint; hash: string }) => Promise<{
    operation: { status: number; contextHash: string; epochId: bigint; deadline: bigint } }>;
  now?: () => bigint;
}) => {
  let reservations = currentReservations.get(signer);
  if (!reservations) {
    reservations = { quote: new Set(), accept: new Set(), actions: new Set(), acceptRequests: new Map() };
    currentReservations.set(signer, reservations);
  }
  const quoteKeys = reservations.quote, acceptKeys = reservations.accept, actionKeys = reservations.actions;
  const recoveredQuotes = new WeakMap<object, CurrentDexPreparedQuote>();
  const pendingAcceptRequests = reservations.acceptRequests;
  const storage = currentDexPendingStorage();
  const c = CURRENT_SHARED_POOL_CANDIDATE, core = address(c.core, 'current shared-Pool Core');
  const owner = address(ownerAddress, 'current shared-Pool owner');
  const runtimeHash = c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2];
  if (chainId !== BigInt(c.chainId)) throw new Error('Current shared-Pool chain differs.');
  const { pending, requireEmptyPending, requireOwnPending, currentHead, sendCurrent, verifyMinedCall } =
    createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now });
  const validateQuote = (prepared: CurrentDexPreparedQuote, allowExpired = false) => {
    assertCurrentSharedPoolPreparedQuote(prepared, signer);
    const intent = prepared.intent;
    if (prepared.readyToSign !== false || prepared.chainId !== chainId ||
        !sameAddress(prepared.from, owner) || !sameAddress(prepared.to, core) || prepared.value !== 0n ||
        prepared.graph !== c.graph || intent.chainId !== chainId ||
        !sameAddress(intent.principal, owner) || !sameAddress(intent.core, core) ||
        intent.runtimeHash !== runtimeHash || intent.releaseId !== c.releaseId ||
        !((sameAddress(intent.inputToken, c.tokens[0][0]) && sameAddress(intent.outputToken, c.tokens[1][0])) ||
          (sameAddress(intent.inputToken, c.tokens[1][0]) && sameAddress(intent.outputToken, c.tokens[0][0])))) {
      throw new Error('Current shared-Pool Quote plan changed.');
    }
    const decoded = decodeCanonical(prepared.data, openInterface, 'openSinglePassSwapV2');
    if (!sameAddress(decoded.inputToken, intent.inputToken) || !sameAddress(decoded.outputToken, intent.outputToken) ||
        !sameAddress(decoded.destination, intent.destination) || decoded.deadline !== intent.deadline ||
        (!allowExpired && now() >= intent.deadline)) throw new Error('Current shared-Pool Quote call changed or expired.');
  };
  const recoverQuote = async (prepared: CurrentDexPreparedQuote, transactionHash: string) => {
    validateQuote(prepared, true);
    await transport.assertCurrent();
    const issued = await prepared.readIssue(transactionHash);
    await transport.assertCurrent();
    if (!issued) throw new Error('Current shared-Pool Open receipt is not available.');
    assertCurrentSharedPoolIssuedQuote(issued, signer);
    if (issued.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
        issued.operation.status === 0 || issued.operation.deadline !== prepared.intent.deadline ||
        !sameAddress(issued.principal, owner)) {
      throw new Error('Current shared-Pool Open identity changed.');
    }
    const recorded = pending();
    if (!recorded || recorded.phase !== 'quote' || recorded.callHash !== keccak256(prepared.data).toLowerCase()) {
      throw new Error('Current DEX pending Open attempt changed.');
    }
    const transaction = await transport.readTransaction(transactionHash);
    await transport.assertCurrent();
    if (!transaction || transaction.nonce !== recorded.nonce || transaction.chainId !== chainId ||
        !sameAddress(transaction.from, owner) || !transaction.to || !sameAddress(transaction.to, core) ||
        transaction.value !== 0n || keccak256(transaction.data).toLowerCase() !== recorded.callHash) {
      throw new Error('Current DEX pending Open transaction changed.');
    }
    clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, transactionHash));
    recoveredQuotes.set(issued, prepared);
    return issued;
  };
  const recoverPendingAttempt = async () => {
    await transport.assertCurrent();
    const attempt = pending();
    if (!attempt) return null;
    if (attempt.phase === 'token-faucet' || attempt.phase === 'token-approve' || attempt.phase === 'token-refill' || attempt.phase === 'pool-preview' || attempt.phase === 'pool-fund' || attempt.phase === 'pool-owner' || attempt.phase === 'pool-transfer' || attempt.phase === 'pool-snapshot' || attempt.phase === 'limit-create' || attempt.phase === 'limit-snapshot' || attempt.phase === 'limit-owner') throw new Error('Use the owner-action pending-attempt reader for this action.');
    if (attempt.chainId !== chainId.toString() || attempt.owner !== owner.toLowerCase() ||
        attempt.core !== core.toLowerCase() || attempt.graph !== `0x${c.graph}`.toLowerCase()) {
      throw new Error('Current DEX pending attempt belongs to another owner or candidate.');
    }
    if (!attempt.txHash) return Object.freeze({ status: 'manual-reconciliation-required' as const,
      phase: attempt.phase, nonce: attempt.nonce, callHash: attempt.callHash });
    const head = await transport.readHead();
    await transport.assertCurrent();
    await attest(head);
    const transaction = await transport.readTransaction(attempt.txHash);
    await transport.assertCurrent();
    const receipt = await transport.waitForReceipt(attempt.txHash);
    await transport.assertCurrent();
    if (!transaction || !receipt) return Object.freeze({ status: 'awaiting-chain-confirmation' as const,
      phase: attempt.phase, nonce: attempt.nonce, transactionHash: attempt.txHash });
    if (hash(transaction.hash, 'pending transaction hash') !== attempt.txHash ||
        transaction.chainId !== chainId || !sameAddress(transaction.from, owner) ||
        !transaction.to || !sameAddress(transaction.to, core) || transaction.value !== 0n ||
        transaction.nonce !== attempt.nonce || keccak256(transaction.data).toLowerCase() !== attempt.callHash ||
        hash(receipt.hash, 'pending receipt hash') !== attempt.txHash ||
        (receipt.status !== 0 && receipt.status !== 1) ||
        !sameAddress(receipt.from, owner) || !receipt.to || !sameAddress(receipt.to, core) ||
        !Number.isSafeInteger(receipt.blockNumber) || (receipt.blockNumber ?? -1) < 0 ||
        !receipt.blockHash || transaction.blockNumber !== receipt.blockNumber ||
        !transaction.blockHash || hash(transaction.blockHash, 'pending transaction block') !== hash(receipt.blockHash, 'pending receipt block')) {
      throw new Error('Current DEX pending attempt does not match the canonical transaction.');
    }
    const canonicalHash = await transport.readBlockHash(receipt.blockNumber!);
    await transport.assertCurrent();
    if (!canonicalHash || hash(canonicalHash, 'canonical block hash') !== hash(receipt.blockHash, 'pending receipt block')) {
      throw new Error('Current DEX pending attempt block changed.');
    }
    if (receipt.status === 0) {
      clearCurrentDexPendingAttempt(storage, requireOwnPending(attempt, attempt.txHash));
      if (attempt.phase === 'cancel' || attempt.phase === 'recover') {
        actionKeys.delete(`${chainId}:${owner}:${attempt.operationId}:${attempt.phase}`.toLowerCase());
      }
      return Object.freeze({ status: 'observed-reverted' as const, phase: attempt.phase,
        transactionHash: attempt.txHash });
    }
    let operationId: bigint, expectedContext: string | null = null, expectedEpoch: bigint | null = null,
      expectedDeadline: bigint | null = null;
    if (attempt.phase === 'quote') {
      const decoded = decodeCanonical(transaction.data, openInterface, 'openSinglePassSwapV2');
      const pair = c.tokens.map(([token]) => token);
      if (!pair.some(token => sameAddress(token, decoded.inputToken)) ||
          !pair.some(token => sameAddress(token, decoded.outputToken)) ||
          sameAddress(decoded.inputToken, decoded.outputToken) || sameAddress(decoded.destination, core)) {
        throw new Error('Current DEX pending Open call has another market.');
      }
      const event = openInterface.getEvent('WorkIssued')!;
      const matches = (receipt.logs ?? []).filter(log => sameAddress(log.address, core) &&
        log.topics[0]?.toLowerCase() === event.topicHash);
      if (matches.length !== 1) throw new Error('Current DEX pending Open has no unique operation event.');
      const parsed = openInterface.parseLog(matches[0]);
      const encoded = parsed && openInterface.encodeEventLog(event, parsed.args);
      if (!parsed || parsed.name !== 'WorkIssued' ||
          encoded?.data.toLowerCase() !== matches[0].data.toLowerCase() ||
          encoded.topics.length !== matches[0].topics.length ||
          encoded.topics.some((topic, index) => topic.toLowerCase() !== matches[0].topics[index].toLowerCase()) ||
          parsed.args.releaseId.toLowerCase() !== c.releaseId || parsed.args.deadline !== decoded.deadline) {
        throw new Error('Current DEX pending Open event changed.');
      }
      operationId = BigInt(parsed.args.operationId);
      expectedEpoch = BigInt(parsed.args.epochId);
      expectedDeadline = BigInt(parsed.args.deadline);
      if (operationId <= 0n || expectedEpoch <= 0n) throw new Error('Current DEX pending Open operation is invalid.');
    } else if (attempt.phase === 'accept') {
      const decoded = decodeCanonical(transaction.data, acceptInterface, 'acceptPrivateSwapV1');
      operationId = BigInt(decoded.operationId);
      expectedContext = hash(decoded.expectedContext, 'pending Accept context');
      if (operationId <= 0n) throw new Error('Current DEX pending Accept operation is invalid.');
    } else {
      const decoded = decodeCanonical(transaction.data, ownerActionInterface,
        attempt.phase === 'cancel' ? 'cancelSwap' : 'recoverSwap');
      operationId = BigInt(decoded.operationId);
      if (operationId <= 0n || operationId.toString() !== attempt.operationId) {
        throw new Error('Current DEX pending owner action is invalid.');
      }
    }
    const observed = await readOperation(operationId, { number: BigInt(receipt.blockNumber!), hash: receipt.blockHash! });
    await transport.assertCurrent();
    if (observed.operation.status === 0 ||
        ((attempt.phase === 'cancel' || attempt.phase === 'recover') && observed.operation.status !== 4) ||
        (expectedEpoch !== null && observed.operation.epochId !== expectedEpoch) ||
        (expectedDeadline !== null && observed.operation.deadline !== expectedDeadline) ||
        (expectedContext !== null && observed.operation.contextHash.toLowerCase() !== expectedContext)) {
      throw new Error('Current DEX pending operation identity changed.');
    }
    clearCurrentDexPendingAttempt(storage, requireOwnPending(attempt, attempt.txHash));
    return Object.freeze({ status: 'observed-mined' as const, phase: attempt.phase,
      transactionHash: attempt.txHash, operationId, operation: observed.operation });
  };
  const submitOwnerAction = async ({ issued, action, confirm }: { issued: CurrentDexIssuedQuote;
    action: 'cancel' | 'recover'; confirm: (operation: CurrentDexIssuedQuote['operation']) => Promise<boolean> }) => {
    assertCurrentSharedPoolIssuedQuote(issued, signer);
    if (typeof issued.operationId !== 'bigint' || issued.operationId <= 0n ||
        !sameAddress(issued.principal, owner) || !sameAddress(issued.intent.principal, owner) ||
        issued.chainId !== chainId || !sameAddress(issued.core, core) ||
        issued.runtimeHash.toLowerCase() !== runtimeHash || issued.releaseId.toLowerCase() !== c.releaseId) {
      throw new Error('Current shared-Pool owner operation changed.');
    }
    requireEmptyPending();
    const key = `${chainId}:${owner}:${issued.operationId}:${action}`.toLowerCase();
    if (actionKeys.has(key)) throw new Error('Current DEX owner action was already submitted. Recover it instead.');
    actionKeys.add(key);
    let signingRequested = false;
    try {
      const refresh = async () => {
        await transport.assertCurrent();
        const current = await issued.readCurrent();
        await transport.assertCurrent();
        assertCurrentSharedPoolIssuedQuote(current, signer);
        if (current.operationId !== issued.operationId || current.operation.epochId !== issued.operation.epochId ||
            current.operation.contextHash.toLowerCase() !== issued.operation.contextHash.toLowerCase() ||
            current.operation.deadline !== issued.operation.deadline ||
            current.operation.canonicalMarketId !== issued.operation.canonicalMarketId ||
            current.operation.marketRevision !== issued.operation.marketRevision ||
            current.operation.registryRevision !== issued.operation.registryRevision ||
            current.transactionHash !== issued.transactionHash ||
            current.originBlock.hash.toLowerCase() !== issued.originBlock.hash.toLowerCase() ||
            current.operation.status !== 1 && current.operation.status !== 2 ||
            action === 'cancel' && current.operation.status === 1 && current.operation.fixedCursor !== 0n) {
          throw new Error('Current DEX owner action is not eligible on this operation.');
        }
        return current;
      };
      const current = await refresh();
      await currentHead();
      if (!await confirm(current.operation)) { actionKeys.delete(key); return null; }
      await transport.assertCurrent();
      const call: UnsignedTransaction = Object.freeze({ chainId, from: owner, to: core, value: 0n,
        data: ownerActionInterface.encodeFunctionData(action === 'cancel' ? 'cancelSwap' : 'recoverSwap', [issued.operationId]) });
      const sent = await sendCurrent(action, call, undefined, async () => { await refresh(); },
        () => { signingRequested = true; }, issued.operationId);
      return Object.freeze({ ...sent, operationId: issued.operationId, action, status: 'release-pending' as const,
        recover: async () => {
          await verifyMinedCall(sent.request, sent.transactionHash);
          const recorded = pending();
          if (!recorded || recorded.phase !== action || recorded.operationId !== issued.operationId.toString()) {
            throw new Error('Current DEX pending owner action changed.');
          }
          const head = await transport.readHead();
          await transport.assertCurrent();
          await attest(head);
          const observed = await readOperation(issued.operationId);
          await transport.assertCurrent();
          if (observed.operation.status !== 4 ||
              observed.operation.contextHash.toLowerCase() !== issued.operation.contextHash.toLowerCase() ||
              observed.operation.epochId !== issued.operation.epochId) {
            throw new Error('Current DEX owner release is not confirmed.');
          }
          clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, sent.transactionHash));
          return Object.freeze({ status: 'released' as const, operationId: issued.operationId,
            transactionHash: sent.transactionHash, operation: observed.operation });
        } });
    } catch (error) { if (!signingRequested) actionKeys.delete(key); throw error; }
  };
  return Object.freeze({ readyToSign: false as const,
    recoverPendingCurrentAttempt: recoverPendingAttempt,
    submitCurrentOwnerAction: submitOwnerAction,
    submitCurrentQuote: async (prepared: CurrentDexPreparedQuote) => {
      validateQuote(prepared);
      requireEmptyPending();
      const admission = issueCurrentSharedPoolQuoteAdmission(prepared, signer);
      const call = quoteCall(prepared), key = `${chainId}:${owner}:${keccak256(call.data)}`.toLowerCase();
      if (quoteKeys.has(key)) throw new Error('Current shared-Pool Quote was already submitted. Recover it instead.');
      quoteKeys.add(key);
      let signingRequested = false;
      try {
        const sent = await sendCurrent('quote', call, prepared.intent.deadline, () => {
          validateQuote(prepared);
          assertCurrentDexInternalAdmission(admission, 'quote', signer, prepared.data, prepared);
        }, () => { signingRequested = true; });
        return Object.freeze({ ...sent, recover: () => recoverQuote(prepared, sent.transactionHash) });
      } catch (error) { if (!signingRequested) quoteKeys.delete(key); throw error; }
    },
    recoverCurrentQuote: recoverQuote,
    submitCurrentAcceptance: async ({ issued, confirm }: { issued: CurrentDexIssuedQuote;
      confirm: (model: unknown) => Promise<boolean> }) => {
      assertCurrentSharedPoolIssuedQuote(issued, signer);
      requireEmptyPending();
      const preparedQuote = recoveredQuotes.get(issued);
      if (!preparedQuote) throw new Error('Current shared-Pool Quote was not recovered in this session.');
      const key = `${chainId}:${owner}:${issued.operationId}:${issued.operation.contextHash}`.toLowerCase();
      if (acceptKeys.has(key)) throw new Error('Current shared-Pool Accept was already submitted. Recover it instead.');
      acceptKeys.add(key);
      let signingRequested = false;
      try {
        const ready = await issued.readCurrent();
        assertCurrentSharedPoolIssuedQuote(ready, signer);
        if (ready.operation.status !== 2 || !ready.operation.quotePrepared || ready.operation.funded ||
            ready.operationId !== issued.operationId || ready.operation.contextHash !== issued.operation.contextHash ||
            ready.operation.epochId !== issued.operation.epochId || ready.operation.deadline !== preparedQuote.intent.deadline ||
            now() >= ready.operation.deadline) throw new Error('Current shared-Pool Quote is not READY.');
        await currentHead(ready.operation.deadline);
        const prepared = await reviewAcceptance(ready, confirm);
        await transport.assertCurrent();
        if (!prepared) { acceptKeys.delete(key); return null; }
        const admission = issueCurrentSharedPoolAcceptAdmission(issueCurrentSharedPoolQuoteAdmission(preparedQuote, signer),
          ready, prepared, signer);
        const call = acceptanceCall(prepared), decoded = decodeCanonical(call.data, acceptInterface, 'acceptPrivateSwapV1');
        if (prepared.readyToSign !== false || !sameAddress(call.from, owner) || !sameAddress(call.to, core) ||
            call.chainId !== chainId || call.value !== 0n || decoded.operationId !== ready.operationId ||
            decoded.expectedContext.toLowerCase() !== ready.operation.contextHash.toLowerCase()) {
          throw new Error('Current shared-Pool Accept call changed.');
        }
        const validate = async () => {
          assertCurrentDexInternalAdmission(admission, 'accept', signer, prepared.data, preparedQuote, ready);
          const refreshed = await ready.readCurrent();
          assertCurrentSharedPoolIssuedQuote(refreshed, signer);
          if (refreshed.operation.status !== 2 || !refreshed.operation.quotePrepared || refreshed.operation.funded ||
              refreshed.operationId !== ready.operationId || refreshed.operation.contextHash !== ready.operation.contextHash ||
              refreshed.operation.stageRevision !== ready.operation.stageRevision ||
              refreshed.operation.canonicalMarketId !== ready.operation.canonicalMarketId ||
              refreshed.operation.marketRevision !== ready.operation.marketRevision ||
              refreshed.operation.registryRevision !== ready.operation.registryRevision ||
              now() >= ready.operation.deadline) throw new Error('Current shared-Pool Quote changed before Accept.');
        };
        const sent = await sendCurrent('accept', call, ready.operation.deadline, validate, request => {
          signingRequested = true;
          pendingAcceptRequests.set(key, request);
        });
        return Object.freeze({ ...sent, operationId: ready.operationId, status: 'accepting' as const,
          recover: async () => {
            await verifyMinedCall(sent.request, sent.transactionHash);
            const recorded = pending();
            if (!recorded || recorded.phase !== 'accept' || recorded.callHash !== keccak256(call.data).toLowerCase()) {
              throw new Error('Current DEX pending Accept attempt changed.');
            }
            clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, sent.transactionHash));
            return Object.freeze({ operationId: ready.operationId, transactionHash: sent.transactionHash,
              status: 'settlement-pending' as const }); } });
      } catch (error) { if (!signingRequested) acceptKeys.delete(key); throw error; }
    },
    recoverCurrentAcceptance: async ({ issued, transactionHash }: { issued: CurrentDexIssuedQuote; transactionHash: string }) => {
      assertCurrentSharedPoolIssuedQuote(issued, signer);
      const key = `${chainId}:${owner}:${issued.operationId}:${issued.operation.contextHash}`.toLowerCase();
      const request = pendingAcceptRequests.get(key);
      if (!request) throw new Error('Current shared-Pool Accept has no signing attempt to recover.');
      await verifyMinedCall(request, transactionHash);
      const recorded = pending();
      if (!recorded || recorded.phase !== 'accept' || recorded.callHash !== keccak256(request.data).toLowerCase()) {
        throw new Error('Current DEX pending Accept attempt changed.');
      }
      clearCurrentDexPendingAttempt(storage, requireOwnPending(recorded, transactionHash));
      return Object.freeze({ operationId: issued.operationId, transactionHash: transactionHash.toLowerCase(),
        status: 'settlement-pending' as const });
    }
  });
};

/** Current 04ea modes. The historical methods above keep their explicit old profile. */
export const CURRENT_CHEAP_DEX_GAS_CAPS = Object.freeze({
  'fast-pool': Object.freeze({ quote: 60_000_000n, accept: 50_000_000n }),
  'cheap-async': Object.freeze({ quote: 50_000_000n, accept: 25_000_000n, cancel: 10_000_000n, recover: 25_000_000n })
});
// Exact signed caps from the accepted fa71 native profiles. A cap grants no send admission.
export const currentCheapDexGasCaps = (candidate = CURRENT_CHEAP_DEX_CANDIDATE) => {
  if (usesCurrentSwapAccounting(candidate)) {
    assertCurrentSwapIdentity(candidate);
    return CURRENT_EXIT_SWAP_GAS_CAPS;
  }
  if (candidate.graph === STAGED_D06_DEX_CANDIDATE.graph) {
    assertCurrentSwapIdentity(candidate);
    return CURRENT_D06_SWAP_GAS_CAPS;
  }
  return candidate.graph === STAGED_NATIVE_DEX_CANDIDATE.graph && candidate.packageSha256 === STAGED_NATIVE_DEX_CANDIDATE.packageSha256 &&
  candidate.core.toLowerCase() === STAGED_NATIVE_DEX_CANDIDATE.core
    ? Object.freeze({ 'fast-pool': Object.freeze({ quote: 70_000_000n, accept: 85_000_000n }),
      'cheap-async': Object.freeze({ quote: 65_000_000n, accept: 35_000_000n, cancel: 20_000_000n,
        recover: 50_000_000n }) }) // Exact accepted funded principal-recovery signed cap.
    : CURRENT_CHEAP_DEX_GAS_CAPS;
};
// Bound to native-coexistence-manifest-1.json (9513dcca...) and its original native receipts.
const cheapProtocol = currentCheapDexQuoteProtocol(CURRENT_CHEAP_DEX_CANDIDATE);
const cheapOpening = new Interface(cheapProtocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
const pendingProfile = (data: string, phase: CurrentDexPendingAttempt['phase'], protocol: ReturnType<typeof currentCheapDexQuoteProtocol>): CurrentCheapDexProfile => {
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
  createCheapDexSubmissionAdapter(args, args.candidate ? resolveCurrentCheapDexCandidate(args.candidate) : CURRENT_CHEAP_DEX_CANDIDATE);

// Exact reviewed-candidate reconciliation only. No submission or private Accept authority is restored.
export const createArchivedCheapDexRecovery = (args: Pick<Parameters<typeof createCheapDexSubmissionAdapter>[0],
  'signer' | 'ownerAddress' | 'chainId' | 'transport' | 'attest' | 'readOperation' | 'now'> & { candidate?: CurrentCheapDexCandidateKey }) =>
  createCheapDexSubmissionAdapter({ ...args,
    readReceipt: async () => { throw new Error('Archived recovery does not restore private Quote authority.'); },
    reviewAcceptance: async () => { throw new Error('Archived recovery cannot accept a Quote.'); },
    requireFunding: async () => { throw new Error('Archived recovery cannot fund a swap.'); }
  }, args.candidate ? resolveCurrentCheapDexCandidate(args.candidate) : ARCHIVED_CHEAP_DEX_CANDIDATE).recoverPendingCurrentCheapAttempt;

const createCheapDexSubmissionAdapter = ({ signer, ownerAddress, chainId, transport, attest,
  readOperation, readReceipt, reviewAcceptance, requireFunding, verifyOwnerTokens, readTerminalReceipt,
  authenticateReload, readOriginalQuoteReceipt,
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport;
  attest: (head: CurrentHead) => Promise<void>;
  readOperation: (profile: CurrentCheapDexProfile, operationId: bigint, origin?: { number: bigint; hash: string }) =>
    Promise<{ operation: CurrentCheapDexOperation }>;
  readReceipt: (issued: CurrentCheapDexIssuedQuote, origin?: { number: bigint; hash: string }) => Promise<CurrentCheapReceipt>;
  reviewAcceptance: (issued: CurrentCheapDexIssuedQuote, confirm: (model: unknown) => Promise<boolean>) =>
    Promise<CurrentDexPreparedAcceptance | null>;
  requireFunding: (prepared: CurrentCheapDexPreparedQuote, head: CurrentHead, beforeApproval?: boolean) => Promise<void>;
  // Issued only by the live selected-wallet capability. Never a stored proof flag.
  verifyOwnerTokens?: (args: { issued: CurrentCheapDexIssuedQuote; amounts: CurrentDexOwnerTokenAmounts;
    phase: CurrentDexOwnerTokenPhase; receipt: MinedReceipt; contextHash: string }) => Promise<void>;
  readTerminalReceipt?: (issued: CurrentCheapDexIssuedQuote, upperBlock: bigint) =>
    Promise<{ receipt: MinedReceipt; phase: 'terminal' | 'recover' | 'cancel' }>;
  authenticateReload?: (record: CurrentNativeSwapCheckpoint) => Promise<string>;
  readOriginalQuoteReceipt?: (issued: CurrentCheapDexIssuedQuote) => Promise<CurrentCheapReceipt>;
  now?: () => bigint;
}, c = CURRENT_CHEAP_DEX_CANDIDATE) => {
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
  const storage = currentDexPendingStorage();
  const closedTrialScopes = reservations.cheapClosedTrials ??= new Set<string>();
  const closedAccountingScopes = new Set<string>();
  let savedReload: string | undefined;
  let recoveringRecord: CurrentDexNativeReloadRecord | null = null;
  const persistBudget = async () => {
    if(!usesCurrentSwapAccounting(c))return;
    if(!authenticateReload)throw new Error('Owner-authenticated reload reservations are unavailable.');
    savedReload??=JSON.stringify(readCurrentDexNativeReload(storage));
    const budget=currentNativeSwapCheckpoint(signer);validateCurrentNativeSwapCheckpoint(budget,owner,c);
    const authentication=await authenticateReload(budget);await transport.assertCurrent();
    if(JSON.stringify(readCurrentDexNativeReload(storage))!==savedReload)throw new Error('Native reload reservation changed during this wallet session.');
    writeCurrentDexNativeReload(storage,{budget,authentication});
    savedReload=JSON.stringify(readCurrentDexNativeReload(storage));
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
  const { pending, requireEmptyPending, requireOwnPending, currentHead, sendCurrent, verifyMinedCall, recheckMinedCall } =
    createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now, historical: false });
  const fundingRequest = (charge: CurrentNativeSwapCheckpoint['charges'][number], tx: SubmittedTransaction,
    prepared?: CurrentCheapDexPreparedQuote): TransactionRequest => {
    if (!['token-funding', 'token-faucet'].includes(charge.phase) || tx.nonce !== charge.nonce || tx.chainId !== chainId ||
        !sameAddress(tx.from, owner) || !tx.to || !c.tokens.some(token => sameAddress(token[0], tx.to!)) ||
        tx.value !== 0n || tx.gasLimit !== 5_000_000n || charge.key !== `${charge.phase}:${charge.scope}:${keccak256(tx.data)}`) {
      throw new Error('Native reload funding transaction changed.');
    }
    if (charge.phase === 'token-funding') {
      const approval = new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']);
      if (!sameAddress(decodeCanonical(tx.data, approval, 'approve')[0], core) ||
          prepared && charge.scope === `quote:${keccak256(prepared.data)}` && !sameAddress(tx.to, prepared.intent.inputToken)) throw new Error('Native reload approval token or spender changed.');
    } else if (tx.data !== new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet')) {
      throw new Error('Native reload initial claim changed.');
    }
    return { chainId, from: owner, to: tx.to, value: 0n, data: tx.data, nonce: charge.nonce,
      gasLimit: 5_000_000n, gasPrice: currentNativeSwapChargeGasPrice(charge) };
  };
  const restoreFundingBudget = async (prepared?: CurrentCheapDexPreparedQuote, approvalRequest?: TransactionRequest) => {
    const saved=readCurrentDexNativeReload(storage);
    if(!usesCurrentSwapAccounting(c)||!saved)return;
    const scope = prepared ? `quote:${keccak256(prepared.data)}` : undefined;
    const expired = isCurrentOwnerBeta(c.graph,owner) ? false :
      now() >= BigInt(saved.budget.windowStart ?? saved.budget.start) +
        (hasCurrentPartialRefundProof(c.graph,owner,saved.budget.charges)?7200n:CURRENT_NATIVE_SWAP_LIMITS.normalSeconds);
    if(prepared && hasCurrentNativeSigningBudget(signer) && !pending() && !ownLookups().length &&
        currentNativeSwapCheckpoint(signer).activeSwap === null && (isCurrentOwnerBeta(c.graph,owner) || !expired && saved.budget.charges.some(row=>closedTrialScopes.has(row.scope)))) {
      if(JSON.stringify(currentNativeSwapCheckpoint(signer))!==JSON.stringify(saved.budget))throw new Error('Closed trial reservation changed.');
      validateCurrentNativeSwapCheckpoint(saved.budget,owner,c);
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
    validateCurrentNativeSwapCheckpoint(saved.budget,owner,c);
    if(isCurrentOwnerBeta(c.graph,owner)){
      if(pending()||ownLookups().length||!authenticateReload||await authenticateReload(saved.budget)!==saved.authentication)
        throw new Error('Owner beta funding has no authenticated continuation.');
      const activeScope=saved.budget.activeSwap;
      const lastScope=saved.budget.charges[saved.budget.charges.length-1]?.scope;
      const funding=activeScope===null?[]:saved.budget.charges.slice(CURRENT_OWNER_BETA.legacyStarts).filter(row=>row.scope===lastScope);
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
      if(JSON.stringify(readCurrentDexNativeReload(storage))!==JSON.stringify(saved)||pending()||ownLookups().length)
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
    if(JSON.stringify(readCurrentDexNativeReload(storage))!==JSON.stringify(saved))throw new Error('Funding reservation changed during restoration.');
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
    if (usesCurrentNativeSwapChecks(c) && !restorationRead) assertCurrentNativeSwapIntent(prepared, now(), expired);
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
        (cheapProtocol && terms[9] !== BigInt(i.toleranceBps!))) throw new Error('Current-mode Quote calldata changed.');
  };
  const nativeSigning = (phase: 'quote' | 'accept' | 'cancel' | 'recover', cap: bigint,
    prepared: CurrentCheapDexPreparedQuote) => {
    if (!usesCurrentNativeSwapChecks(c)) return undefined;
    if(usesCurrentSwapAccounting(c)&&readCurrentDexNativeReload(storage)&&!hasCurrentNativeSigningBudget(signer))throw new Error('Restore the original native budget before another signing request.');
    const budget = currentNativeSigningBudget(signer, owner, now, c), scope = `quote:${keccak256(prepared.data)}`,
      key = phase === 'quote' ? scope : `${phase}:${scope}`;
    const check = () => {
      assertCurrentSwapCandidate(c, prepared.intent); assertCurrentNativeSwapIntent(prepared, now(), phase === 'cancel' || phase === 'recover');
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
  const refreshReady = async (issued: CurrentCheapDexIssuedQuote, prepared: CurrentCheapDexPreparedQuote) => {
    validateIssued(issued, prepared);
    const ready = await issued.readCurrent();
    await transport.assertCurrent();
    validateIssued(ready, prepared);
    if (ready.operationId !== issued.operationId || ready.transactionHash !== issued.transactionHash ||
        ready.originBlock.number !== issued.originBlock.number || ready.originBlock.hash !== issued.originBlock.hash ||
        ready.block.number < issued.block.number ||
        (ready.block.number === issued.block.number && ready.block.hash !== issued.block.hash) ||
        (BigInt(issued.operation.contextHash) !== 0n && ready.operation.contextHash !== issued.operation.contextHash) ||
        !ready.operation.ready || ready.operation.phase !== 'quote-prepared' || now() >= ready.operation.deadline) {
      throw new Error('Current-mode Quote is not READY or changed.');
    }
    return ready;
  };
  const recoverQuote = async (prepared: CurrentCheapDexPreparedQuote, transactionHash: string) => timedVerification(transactionHash, 'quote-issue', async observation => {
    assertCurrentSwapCandidate(c, prepared.intent);
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
    if (issued.intent.profile === 'cheap-async') {
      const event = uniqueCheapEvent(receipt, core, 'CheapAsyncAdvanced');
      if (event.quoteId !== issued.operationId || event.stage !== BigInt(stages.funded) || event.context !== issued.operation.contextHash ||
          ![stages.funded, stages.settled, stages.released].includes(observed.operation.stage ?? 0)) throw new Error('Current-mode Accept has no exact funded event.');
      await verifyTokens(issued, fundingAmounts(issued), 'accept', receipt);
    } else {
      if (observed.operation.phase !== 'consumed-unverified' || observed.operation.ready) throw new Error('Fast Accept is not consumed.');
      const privateReceipt = await verifyReceipt(issued, prepared, origin);
      await verifyTokens(issued, privateReceipt.amounts, 'fast-settle', receipt);
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
    let saved=readCurrentDexNativeReload(storage);
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
    validateCurrentNativeSwapCheckpoint(saved.budget,owner,c);
    if(await authenticateReload(saved.budget)!==saved.authentication)throw new Error('Original native budget authentication failed.');
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
    await transport.assertCurrent();if(JSON.stringify(pending())!==pendingBytes||JSON.stringify(readCurrentDexNativeReload(storage))!==recordBytes)throw new Error('Native reload records changed during reconciliation.');
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
      const record=readCurrentDexNativeReload(storage);
      if(!record)return currentPartialLedgerRecoveryAllowed(c.graph,owner,now())?{quoteHash:CURRENT_APP_PARTIAL_LEDGER_RECOVERY.hashes[9]}:null;
      validateCurrentNativeSwapCheckpoint(record.budget,owner,c);
      const row=[...record.budget.charges].reverse().find(r=>r.phase==='quote'&&(record.budget.activeSwap===null||r.scope===record.budget.activeSwap));
      const attempt=pending();return row?Object.freeze({quoteHash:row.hash??(attempt?.phase==='quote'&&attempt.nonce===row.nonce?attempt.txHash:null)}):null;
    },
    restoreCurrentCheapOperation: restoreOperation,
    // History proves accounting only; it never restores or releases signing authority.
    readCurrentCheapActivityReceipt: async (issued: CurrentCheapDexIssuedQuote) => {
      if (!usesCurrentSwapAccounting(c) || !authenticateReload || !verifyOwnerTokens || issued.intent.profile==='cheap-async'&&!readTerminalReceipt) {
        throw new Error('Read-only private Activity is unavailable.');
      }
      const prepared = currentDexRestoredPlan(issued, signer);
      validateQuote(prepared, true, true); validateIssued(issued, prepared);
      const stored = readCurrentDexNativeReload(storage),saved=stored??recoveringRecord;
      if (!saved) throw new Error('Original Activity reservation is unavailable.');
      const savedBytes = JSON.stringify(stored), pendingBytes = JSON.stringify(pending()), lookupBytes = JSON.stringify(ownLookups());
      validateCurrentNativeSwapCheckpoint(saved.budget, owner, c);
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
        if(JSON.stringify(readCurrentDexNativeReload(storage))!==savedBytes||JSON.stringify(pending())!==pendingBytes||JSON.stringify(ownLookups())!==lookupBytes)
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
      if (JSON.stringify(readCurrentDexNativeReload(storage)) !== savedBytes || JSON.stringify(pending()) !== pendingBytes || JSON.stringify(ownLookups()) !== lookupBytes) {
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
      if(readCurrentDexNativeReload(storage)&&!hasCurrentNativeSigningBudget(signer))throw new Error('The original App trial is already reserved. Reconcile it.');
      const scope=`quote:${keccak256(request.data)}`;currentNativeSigningBudget(signer,owner,now,c).commit('token-faucet',`token-faucet:${scope}:${keccak256(request.data)}`,5_000_000n,scope,request.nonce);await persistBudget();
    },
    authorizeCurrentCheapSwapApproval: async (prepared: CurrentCheapDexPreparedQuote, request: TransactionRequest) => {
      validateQuote(prepared); assertCurrentSwapCandidate(c, prepared.intent);
      if (!usesCurrentSwapAccounting(c) || !sameAddress(request.to, prepared.intent.inputToken) || !sameAddress(request.from, owner) || request.chainId !== chainId || request.value !== 0n) throw new Error('Swap approval owner or target changed.');
      const claim=request.data===new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet'),phase=claim?'token-faucet':'token-funding';
      if(!claim){const approval=new Interface(['function approve(address,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) input)']);if(!sameAddress(decodeCanonical(request.data,approval,'approve')[0],core))throw new Error('Exact approval spender changed.');}
      await restoreFundingBudget(claim ? undefined : prepared, claim ? undefined : request);
      if (readCurrentDexNativeReload(storage) && !hasCurrentNativeSigningBudget(signer)) throw new Error('Restore the original native budget before another signing request.');
      const scope=`quote:${keccak256(prepared.data)}`, key=`${phase}:${scope}:${keccak256(request.data)}`;
      currentNativeSigningBudget(signer,owner,now,c).commit(phase,key,5_000_000n,scope,request.nonce);
      await persistBudget();
    },
    rememberCurrentCheapSwapApproval: rememberHash,
    checkCurrentCheapCandidate: async () => {
      assertCurrentSwapIdentity(c);
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
      assertCurrentSwapCandidate(c, prepared.intent);
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
          assertCurrentSwapCandidate(c, prepared.intent);
          if (prepared.profile === 'cheap-async') requireLookupCapacity();
          validateQuote(prepared); assertCurrentDexInternalAdmission(admission, 'quote', signer, prepared.data, prepared);
        }, () => { signing = true; }, undefined, gasCaps()[prepared.profile].quote, observeSend(prepared.profile, 'quote', progress), authorize, undefined, { prepared, signer });
        await rememberHash(sent);
        return Object.freeze({ ...sent, profile: prepared.profile, recover: () => recoverQuote(prepared, sent.transactionHash) });
      } catch (error) { if (!signing) reservations.quote.delete(key); throw error; }
    },
    submitCurrentCheapAcceptance: async ({ issued, confirm, progress }: { issued: CurrentCheapDexIssuedQuote;
      confirm: (model: unknown) => Promise<boolean>; progress?: CurrentDexSendProgress }) => {
      assertCurrentSwapCandidate(c, issued.intent);
      assertCurrentCheapDexIssuedQuote(issued, signer); requireEmptyPending();
      if (issued.intent.profile === 'cheap-async') requireLookupCapacity();
      const preparedQuote = capturedQuote(issued);
      const ready = await refreshReady(issued, preparedQuote);
      if (usesCurrentSwapAccounting(c)) assertCurrentNativeSwapIntent(preparedQuote, now(), false, true);
      const key = `${chainId}:${owner}:${ready.intent.profile}:${ready.operationId}:${ready.operation.contextHash}`.toLowerCase();
      if (reservations.accept.has(key)) throw new Error('Current-mode Accept was already submitted. Recover it instead.');
      reservations.accept.add(key); let signing = false;
      try {
        const quoted = cheapProtocol ? await verifyReceipt(ready, preparedQuote, ready.originBlock) : undefined;
        const prepared = await reviewAcceptance(ready, confirm);
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
          assertCurrentSwapCandidate(c, ready.intent);
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
      } catch (error) { if (!signing) reservations.accept.delete(key); throw error; }
    },
    submitCurrentCheapOwnerAction: async ({ issued, action, confirm, progress }: { issued: CurrentCheapDexIssuedQuote;
      action: 'cancel' | 'recover'; confirm: (operation: CurrentCheapDexOperation) => Promise<boolean>; progress?: CurrentDexSendProgress }) => {
      assertCurrentSwapCandidate(c, issued.intent);
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
        const sent = await sendCurrent(action, call, undefined, async () => { assertCurrentSwapCandidate(c, prepared.intent); await refresh(); },
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
      } catch (error) { if (!signing) reservations.actions.delete(key); throw error; }
    }
  });
  return adapter;
};
