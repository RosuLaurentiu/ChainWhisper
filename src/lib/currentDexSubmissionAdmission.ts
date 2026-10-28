import { assertCurrentSwapCandidate } from './currentDexNativeSwapPolicy';
import { keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentSharedPoolPreparedQuote, assertCurrentSharedPoolIssuedQuote,
  assertCurrentCheapDexPreparedQuote, assertCurrentCheapDexIssuedQuote } from '../features/wallet/currentDexQuoteCapability';
import { CURRENT_CHEAP_DEX_CANDIDATE, CURRENT_SHARED_POOL_CANDIDATE, currentCheapDexQuoteProtocol,
  currentCheapDexCandidateKey, resolveCurrentCheapDexCandidate } from './dexV2Deployment';
import type { CurrentCheapDexPreparedQuote, CurrentCheapDexIssuedQuote, CurrentDexPreparedAcceptance } from './currentDexSubmission';

export const CURRENT_DEX_SUBMISSION_VERSION = 'async-submission-phase-v2' as const;
export const CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256 = '8f629796995885e09983c6e502b2a7e96d93ce61b542da55362777147057f4c8' as const;
export const CURRENT_DEX_SUBMISSION_SOURCES_SHA256 = '962f6aa174ce8c3d27a2f175208717834d4ae5e47e1492955bd0b482efb73a50' as const;

export type CurrentDexNativeAdmission = Readonly<{
  evidenceHash: string;
  gasUsed: bigint;
  gasLimit: bigint;
}>;

export type CurrentDexSubmissionPhase = 'quote' | 'accept';

export type CurrentDexSubmissionAdmissionEvidence<Phase extends CurrentDexSubmissionPhase = CurrentDexSubmissionPhase> = Readonly<{
  version: typeof CURRENT_DEX_SUBMISSION_VERSION;
  candidateSha256: typeof CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256;
  sourcesSha256: typeof CURRENT_DEX_SUBMISSION_SOURCES_SHA256;
  chainId: bigint;
  principal: string;
  core: string;
  manifestHash: string;
  runtimeHash: string;
  releaseId: string;
  inputToken: string;
  outputToken: string;
  tokenPolicyHash: string;
  phase: Phase;
  callHash: string;
  authorizationHash: string;
  native: CurrentDexNativeAdmission;
}>;

declare const CURRENT_DEX_SUBMISSION_ADMISSION: unique symbol;
export type CurrentDexSubmissionAdmission<Phase extends CurrentDexSubmissionPhase = CurrentDexSubmissionPhase> = Readonly<{
  readonly [CURRENT_DEX_SUBMISSION_ADMISSION]: true;
  evidence: CurrentDexSubmissionAdmissionEvidence<Phase>;
}>;

// No native evidence verifier is available in this checkpoint. Tests mock this
// boundary; application data cannot promote itself to submission authority.
export const verifyCurrentDexSubmissionAdmission = (
  _value: unknown
): _value is CurrentDexSubmissionAdmission => false;

// Current shared-Pool authority is an in-memory object identity, not caller data.
// The old evidence-shaped admission above remains permanently closed here.
type InternalPhase = 'quote' | 'accept';
type InternalBinding = Readonly<{ phase: InternalPhase; signer: object; callHash: string;
  preparedQuote: object; issuedQuote?: object; profile?: 'fast-pool' | 'cheap-async' }>;
const internalBindings = new WeakMap<object, InternalBinding>();
export type CurrentDexInternalAdmission<Phase extends InternalPhase = InternalPhase> = Readonly<{ phase: Phase }>;

const register = <Phase extends InternalPhase>(binding: InternalBinding & { phase: Phase }): CurrentDexInternalAdmission<Phase> => {
  const admission = Object.freeze({ phase: binding.phase });
  internalBindings.set(admission, Object.freeze(binding));
  return admission;
};

export const issueCurrentSharedPoolQuoteAdmission = (prepared: Readonly<{
  chainId: bigint; from: string; to: string; value: bigint; data: string; graph: string;
  intent: Readonly<{ runtimeHash: string; releaseId: string }>;
}>, signer: object): CurrentDexInternalAdmission<'quote'> => {
  assertCurrentSharedPoolPreparedQuote(prepared, signer);
  const c = CURRENT_SHARED_POOL_CANDIDATE;
  const coreRuntime = c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2];
  if (prepared.graph !== c.graph || prepared.chainId !== BigInt(c.chainId) ||
      prepared.from.toLowerCase() === c.core || prepared.to.toLowerCase() !== c.core || prepared.value !== 0n ||
      prepared.intent.runtimeHash !== coreRuntime || prepared.intent.releaseId !== c.releaseId) {
    throw new Error('Shared-Pool Quote does not match the reviewed candidate.');
  }
  return register({ phase: 'quote', signer, callHash: keccak256(prepared.data), preparedQuote: prepared });
};

export const issueCurrentSharedPoolAcceptAdmission = (quote: CurrentDexInternalAdmission<'quote'>,
  issued: Readonly<{ operationId: bigint; operation: Readonly<{ contextHash: string }> }>,
  prepared: Readonly<{ data: string }>, signer: object): CurrentDexInternalAdmission<'accept'> => {
  assertCurrentSharedPoolIssuedQuote(issued, signer);
  const previous = internalBindings.get(quote);
  if (!previous || previous.phase !== 'quote' || previous.signer !== signer) {
    throw new Error('Shared-Pool Quote authority is absent.');
  }
  return register({ phase: 'accept', signer, callHash: keccak256(prepared.data),
    preparedQuote: previous.preparedQuote, issuedQuote: issued });
};

export const assertCurrentDexInternalAdmission = (value: unknown, phase: InternalPhase, signer: object,
  callData: string, preparedQuote: object, issuedQuote?: object): void => {
  const binding = value && typeof value === 'object' ? internalBindings.get(value) : undefined;
  if (!binding || binding.phase !== phase || binding.signer !== signer ||
      binding.callHash !== keccak256(callData) || binding.preparedQuote !== preparedQuote ||
      (phase === 'accept' && binding.issuedQuote !== issuedQuote)) {
    throw new Error('Current shared-Pool submission is not admitted for this call and session.');
  }
};

export const issueCurrentCheapDexQuoteAdmission = (prepared: CurrentCheapDexPreparedQuote,
  signer: object): CurrentDexInternalAdmission<'quote'> => {
  assertCurrentCheapDexPreparedQuote(prepared, signer);
  const c = prepared.intent.candidate ? resolveCurrentCheapDexCandidate(currentCheapDexCandidateKey(prepared.intent.candidate)) : CURRENT_CHEAP_DEX_CANDIDATE;
  assertCurrentSwapCandidate(c, prepared.intent);
  if (prepared.intent.candidate) assertCurrentSwapCandidate(prepared.intent.candidate, prepared.intent);
  const protocol = currentCheapDexQuoteProtocol(c);
  if (prepared.graph !== c.graph || prepared.chainId !== BigInt(c.chainId) || prepared.to.toLowerCase() !== c.core ||
      prepared.value !== 0n || prepared.intent.runtimeHash !== c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2] ||
      prepared.intent.releaseId !== c.releaseId || prepared.intent.profile !== prepared.profile ||
      prepared.intent.quoteProtocol !== protocol || (protocol ? !Number.isInteger(prepared.intent.toleranceBps) ||
        prepared.intent.toleranceBps! < 0 || prepared.intent.toleranceBps! > 10000 : prepared.intent.toleranceBps !== undefined) ||
      prepared.profile !== 'fast-pool' && prepared.profile !== 'cheap-async') {
    throw new Error('Current-mode Quote does not match the reviewed candidate.');
  }
  return register({ phase: 'quote', signer, callHash: keccak256(prepared.data), preparedQuote: prepared, profile: prepared.profile });
};

export const issueCurrentCheapDexAcceptAdmission = (quote: CurrentDexInternalAdmission<'quote'>,
  issued: CurrentCheapDexIssuedQuote, prepared: CurrentDexPreparedAcceptance,
  signer: object): CurrentDexInternalAdmission<'accept'> => {
  assertCurrentCheapDexIssuedQuote(issued, signer);
  const previous = internalBindings.get(quote);
  if (!previous || previous.phase !== 'quote' || previous.signer !== signer || previous.profile !== issued.intent.profile ||
      prepared.operationId !== issued.operationId || prepared.contextHash !== issued.operation.contextHash) {
    throw new Error('Current-mode Quote authority is absent or changed.');
  }
  const original = previous.preparedQuote as CurrentCheapDexPreparedQuote;
  const identity = issued.intent.candidate ?? CURRENT_CHEAP_DEX_CANDIDATE;
  assertCurrentSwapCandidate(identity, issued.intent);
  if (original.graph !== identity.graph || original.to.toLowerCase() !== identity.core.toLowerCase() ||
      original.intent.runtimeHash !== issued.runtimeHash || original.intent.releaseId !== issued.releaseId ||
      original.intent.principal.toLowerCase() !== issued.principal.toLowerCase()) {
    throw new Error('Current-mode Accept differs from its original Quote candidate.');
  }
  return register({ phase: 'accept', signer, callHash: keccak256(prepared.data),
    preparedQuote: previous.preparedQuote, issuedQuote: issued, profile: issued.intent.profile });
};
