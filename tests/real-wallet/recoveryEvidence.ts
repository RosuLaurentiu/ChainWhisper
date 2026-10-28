import {
  COTI_TESTNET_CHAIN_ID,
  PINNED_COTI_SNAP_VERSION,
  PINNED_METAMASK_DIRECTORY_SHA256,
  PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  PINNED_METAMASK_VERSION
} from './metamaskPolicy';
import type { ChatV2AuthenticatedRecovery } from './promptEvidence';

export const ACCOUNT_ONBOARD_ADDRESS = '0x536a67f0cc46513e7d27a370ed1af9fdcc7a5095';
export const ACCOUNT_ONBOARD_SELECTOR = '0xafaea1bd';
export const ACCOUNT_ONBOARD_RUNTIME_HASH =
  '0x10b300ac6fba3b03ab87fb4728ed1d7a033a1551c97abc81194aa4c889324718';
export const COTI_ETHERS_VERSION = '1.0.5';
export const COTI_SDK_VERSION = '1.0.6';
export const RESTORED_PROFILE_ACK = 'SAME_TEST_EOA_MANUAL_RESTORE_ONLY';
export const OFFICIAL_COTI_ONBOARDING_ACK = 'OFFICIAL_TESTNET_COMPANION_COMPLETED';
export const OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN = 'https://dev.metamask.coti.io';

export const RECOVERY_WALLET_PHASES = [
  'wallet-connect',
  'snap-unlock',
  'deployment-attestation',
  'envelope-recovery',
  'snap-install',
  'privacy-onboarding',
  'snap-key-store'
] as const;

export type RecoveryWalletPhase = (typeof RECOVERY_WALLET_PHASES)[number];
export type RecoveryPromptKind =
  | 'signature'
  | 'snap-aes-access'
  | 'snap-connect-wallet'
  | 'snap-install'
  | 'snap-key-store'
  | 'transaction'
  | 'wallet-connect'
  | 'wallet-unlock';
export type RecoveryRpcOutcome = 'blocked' | 'error' | 'success';
export type RecoverySnapOperation =
  | 'connect-to-wallet'
  | 'get-aes-key'
  | 'has-aes-key'
  | 'set-aes-key';

export type RecoveryRpcObservation = {
  durationMs: number;
  method: string;
  operation?: RecoverySnapOperation;
  outcome: RecoveryRpcOutcome;
  phase: RecoveryWalletPhase;
  selector?: string;
  startedAtMs: number;
  target?: string;
};

export type RecoveryPromptObservation = {
  durationMs: number;
  kind: RecoveryPromptKind;
  outcome: 'rejected' | 'resolved';
  phase: RecoveryWalletPhase;
  startedAtMs: number;
};

export type RecoveryPhaseEvidence = {
  phase: RecoveryWalletPhase;
  rpc: RecoveryRpcObservation[];
  uiPrompts: RecoveryPromptObservation[];
};

export type ChatRecoveryAnchor = {
  conversationId: string;
  currentEpoch: string;
  latestMessageBlock: string;
  latestMessageBlockHash: string;
  latestMessageId: string;
  latestRecipient: string;
  latestSender: string;
  messageCount: string;
};

export type RecoveryWalletRuntime = {
  browserVersion: string;
  cotiSnapVersion: string;
  extensionId: string;
  metamaskOfficialArchiveSha256: string;
  metamaskUnpackedDirectorySha256: string;
  metamaskUnpackedDirectorySha256AfterRun: string;
  metamaskVersion: string;
  playwrightVersion: string;
};

export type ChatV2RecoveryEvidenceDocument = {
  capturedAt: string;
  contract: {
    address: string;
    chainId: typeof COTI_TESTNET_CHAIN_ID;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  };
  onboarding: {
    address: typeof ACCOUNT_ONBOARD_ADDRESS;
    runtimeBytecodeHash: typeof ACCOUNT_ONBOARD_RUNTIME_HASH;
    selector: typeof ACCOUNT_ONBOARD_SELECTOR;
  };
  packageRuntime: {
    cotiEthersVersion: typeof COTI_ETHERS_VERSION;
    cotiSdkVersion: typeof COTI_SDK_VERSION;
  };
  participants: {
    alice: string;
    bob: string;
  };
  persistentReload: {
    after: ChatRecoveryAnchor;
    authenticatedRecovery: ChatV2AuthenticatedRecovery;
    before: ChatRecoveryAnchor;
    envelopeRefresh: 'not-required';
    isolation: 'same-canonical-profile-after-context-close';
    phases: RecoveryPhaseEvidence[];
  };
  restoredProfile: {
    after: ChatRecoveryAnchor;
    authenticatedRecovery: ChatV2AuthenticatedRecovery;
    before: ChatRecoveryAnchor;
    envelopeRefresh: 'not-required';
    initialSnapState: 'pre-onboarded-by-official-companion';
    isolation: 'distinct-nonnested-canonical-profile';
    onboardingMeasuredInHarness: false;
    onboardingOperatorAck: typeof OFFICIAL_COTI_ONBOARDING_ACK;
    onboardingOrigin: typeof OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN;
    operatorAck: typeof RESTORED_PROFILE_ACK;
    ownerAddress: string;
    verificationPhases: RecoveryPhaseEvidence[];
  };
  schemaVersion: 1;
  walletRuntime: RecoveryWalletRuntime;
  warmEvidenceSha256: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const METHOD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const SELECTOR_PATTERN = /^0x[0-9a-fA-F]{8}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,79}$/;
const PHASE_SET = new Set<string>(RECOVERY_WALLET_PHASES);
const OUTCOME_SET = new Set<string>(['blocked', 'error', 'success']);
const PROMPT_OUTCOME_SET = new Set<string>(['rejected', 'resolved']);
const PROMPT_KIND_SET = new Set<string>([
  'signature',
  'snap-aes-access',
  'snap-connect-wallet',
  'snap-install',
  'snap-key-store',
  'transaction',
  'wallet-connect',
  'wallet-unlock'
]);
const SNAP_OPERATION_SET = new Set<string>([
  'connect-to-wallet',
  'get-aes-key',
  'has-aes-key',
  'set-aes-key'
]);
const SAFE_READ_METHODS = new Set([
  'eth_accounts',
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas'
]);
const PERSISTENT_PHASES: readonly RecoveryWalletPhase[] = [
  'wallet-connect',
  'snap-unlock',
  'deployment-attestation',
  'envelope-recovery'
];
const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must use the exact sanitized schema.`);
  }
};

const normalizeAddress = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero address.`);
  }
  return value.toLowerCase();
};

const normalizeHash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be bytes32.`);
  }
  return value.toLowerCase();
};

const normalizePositiveDecimal = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal integer string.`);
  }
  return BigInt(value).toString();
};

const finiteMilliseconds = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative.`);
  }
  return Math.round(value * 1_000) / 1_000;
};

const recoveryPhase = (value: unknown): RecoveryWalletPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    throw new Error('Unknown recovery measurement phase.');
  }
  return value as RecoveryWalletPhase;
};

export const sanitizeRecoveryRpcObservation = (
  input: Record<string, unknown>
): RecoveryRpcObservation => {
  const optional = ['operation', 'selector', 'target'].filter((key) => input[key] !== undefined);
  assertExactKeys(
    input,
    ['durationMs', 'method', 'outcome', 'phase', 'startedAtMs', ...optional],
    'Recovery RPC observation'
  );
  const method = typeof input.method === 'string' ? input.method : '';
  const outcome = typeof input.outcome === 'string' ? input.outcome : '';
  if (!METHOD_PATTERN.test(method) || !OUTCOME_SET.has(outcome)) {
    throw new Error('Recovery RPC observation is invalid.');
  }
  const normalized: RecoveryRpcObservation = {
    durationMs: finiteMilliseconds(input.durationMs, 'Recovery RPC duration'),
    method,
    outcome: outcome as RecoveryRpcOutcome,
    phase: recoveryPhase(input.phase),
    startedAtMs: finiteMilliseconds(input.startedAtMs, 'Recovery RPC start')
  };
  if (method === 'wallet_invokeSnap') {
    if (typeof input.operation !== 'string' || !SNAP_OPERATION_SET.has(input.operation)) {
      throw new Error('Recovery Snap observation requires an allowlisted operation.');
    }
    normalized.operation = input.operation as RecoverySnapOperation;
  } else if (input.operation !== undefined) {
    throw new Error('Only Snap observations may contain an operation.');
  }
  if (method === 'eth_sendTransaction') {
    if (
      typeof input.target !== 'string' ||
      typeof input.selector !== 'string' ||
      !ADDRESS_PATTERN.test(input.target) ||
      !SELECTOR_PATTERN.test(input.selector)
    ) {
      throw new Error('Recovery transaction observation is incomplete.');
    }
    normalized.target = input.target.toLowerCase();
    normalized.selector = input.selector.toLowerCase();
  } else if (input.target !== undefined || input.selector !== undefined) {
    throw new Error('Only transaction observations may contain a target or selector.');
  }
  return normalized;
};

export const sanitizeRecoveryPromptObservation = (
  input: Record<string, unknown>
): RecoveryPromptObservation => {
  assertExactKeys(
    input,
    ['durationMs', 'kind', 'outcome', 'phase', 'startedAtMs'],
    'Recovery prompt observation'
  );
  const kind = typeof input.kind === 'string' ? input.kind : '';
  const outcome = typeof input.outcome === 'string' ? input.outcome : '';
  if (!PROMPT_KIND_SET.has(kind) || !PROMPT_OUTCOME_SET.has(outcome)) {
    throw new Error('Recovery prompt observation is invalid.');
  }
  return {
    durationMs: finiteMilliseconds(input.durationMs, 'Recovery prompt duration'),
    kind: kind as RecoveryPromptKind,
    outcome: outcome as 'rejected' | 'resolved',
    phase: recoveryPhase(input.phase),
    startedAtMs: finiteMilliseconds(input.startedAtMs, 'Recovery prompt start')
  };
};

export const buildRecoveryPhaseEvidence = ({
  phase,
  rpc,
  uiPrompts
}: {
  phase: RecoveryWalletPhase;
  rpc: Array<Record<string, unknown>>;
  uiPrompts: Array<Record<string, unknown>>;
}): RecoveryPhaseEvidence => {
  const normalizedPhase = recoveryPhase(phase);
  const sanitizedRpc = rpc.map(sanitizeRecoveryRpcObservation);
  const sanitizedPrompts = uiPrompts.map(sanitizeRecoveryPromptObservation);
  if (
    sanitizedRpc.some((entry) => entry.phase !== normalizedPhase) ||
    sanitizedPrompts.some((entry) => entry.phase !== normalizedPhase)
  ) {
    throw new Error('Recovery observation phase does not match its enclosing phase.');
  }
  return { phase: normalizedPhase, rpc: sanitizedRpc, uiPrompts: sanitizedPrompts };
};

const assertResolvedPrompts = (phase: RecoveryPhaseEvidence): void => {
  if (phase.uiPrompts.some(({ outcome }) => outcome !== 'resolved')) {
    throw new Error(`${phase.phase} contains a rejected prompt.`);
  }
};

const assertReadOnlyPhase = (phase: RecoveryPhaseEvidence): void => {
  if (
    phase.rpc.length === 0 ||
    phase.rpc.some(({ method, outcome }) => !SAFE_READ_METHODS.has(method) || outcome !== 'success') ||
    phase.uiPrompts.length !== 0
  ) {
    throw new Error(`${phase.phase} must be a successful prompt-free read phase.`);
  }
};

const assertRecoveryPhaseSemantics = (phase: RecoveryPhaseEvidence): void => {
  assertResolvedPrompts(phase);
  if (phase.phase === 'wallet-connect') {
    if (
      phase.rpc.length === 0 ||
      phase.rpc.some(
        ({ method, outcome }) =>
          outcome !== 'success' || (method !== 'eth_chainId' && method !== 'eth_requestAccounts')
      ) ||
      phase.uiPrompts.some(({ kind }) => kind !== 'wallet-connect' && kind !== 'wallet-unlock')
    ) {
      throw new Error('Recovery wallet connection used an unexpected operation or prompt.');
    }
    return;
  }
  if (phase.phase === 'snap-unlock') {
    const operations = phase.rpc
      .filter(({ method }) => method === 'wallet_invokeSnap')
      .map(({ operation }) => operation);
    if (
      phase.rpc.some(
        ({ method, outcome }) =>
          outcome !== 'success' ||
          (method !== 'eth_accounts' &&
            method !== 'eth_chainId' &&
            method !== 'wallet_getSnaps' &&
            method !== 'wallet_invokeSnap')
      ) ||
      operations.join(',') !== 'connect-to-wallet,has-aes-key,get-aes-key' ||
      phase.uiPrompts.length !== 2 ||
      phase.uiPrompts[0]?.kind !== 'snap-connect-wallet' ||
      phase.uiPrompts[1]?.kind !== 'snap-aes-access'
    ) {
      throw new Error('Recovery Snap unlock does not match the reviewed warm sequence.');
    }
    return;
  }
  if (phase.phase === 'deployment-attestation' || phase.phase === 'envelope-recovery') {
    assertReadOnlyPhase(phase);
    return;
  }
  if (phase.phase === 'snap-install') {
    const methods = phase.rpc.map(({ method }) => method);
    if (
      phase.rpc.some(({ outcome }) => outcome !== 'success') ||
      methods.join(',') !== 'wallet_getSnaps,wallet_requestSnaps,wallet_getSnaps' ||
      phase.uiPrompts.length === 0 ||
      phase.uiPrompts.some(({ kind }) => kind !== 'snap-install')
    ) {
      throw new Error('Restored-profile Snap installation is incomplete or unexpected.');
    }
    return;
  }
  if (phase.phase === 'privacy-onboarding') {
    const signing = phase.rpc.filter(({ method }) => method === 'personal_sign');
    const sends = phase.rpc.filter(({ method }) => method === 'eth_sendTransaction');
    if (
      phase.rpc.some(
        ({ method, outcome }) =>
          outcome !== 'success' ||
          (!SAFE_READ_METHODS.has(method) && method !== 'personal_sign' && method !== 'eth_sendTransaction')
      ) ||
      signing.length !== 1 ||
      sends.length !== 1 ||
      sends[0]?.target !== ACCOUNT_ONBOARD_ADDRESS ||
      sends[0]?.selector !== ACCOUNT_ONBOARD_SELECTOR ||
      phase.uiPrompts.length !== 2 ||
      phase.uiPrompts[0]?.kind !== 'signature' ||
      phase.uiPrompts[1]?.kind !== 'transaction'
    ) {
      throw new Error('COTI privacy onboarding does not match the exact recovery policy.');
    }
    return;
  }
  const operations = phase.rpc
    .filter(({ method }) => method === 'wallet_invokeSnap')
    .map(({ operation }) => operation);
  if (
    phase.rpc.some(
      ({ method, outcome }) =>
        outcome !== 'success' ||
        (method !== 'eth_accounts' && method !== 'eth_chainId' && method !== 'wallet_invokeSnap')
    ) ||
    operations.join(',') !== 'connect-to-wallet,set-aes-key' ||
    phase.uiPrompts.length !== 2 ||
    phase.uiPrompts[0]?.kind !== 'snap-connect-wallet' ||
    phase.uiPrompts[1]?.kind !== 'snap-key-store'
  ) {
    throw new Error('Restored-profile Snap key storage does not match the reviewed sequence.');
  }
};

const normalizeAnchor = (input: ChatRecoveryAnchor): ChatRecoveryAnchor => {
  const messageCount = normalizePositiveDecimal(input.messageCount, 'Message count');
  const latestMessageId = normalizePositiveDecimal(input.latestMessageId, 'Latest message ID');
  if (messageCount !== latestMessageId) {
    throw new Error('The recovery anchor must describe the canonical latest message.');
  }
  return {
    conversationId: normalizeHash(input.conversationId, 'Conversation ID'),
    currentEpoch: normalizePositiveDecimal(input.currentEpoch, 'Current epoch'),
    latestMessageBlock: normalizePositiveDecimal(input.latestMessageBlock, 'Latest message block'),
    latestMessageBlockHash: normalizeHash(input.latestMessageBlockHash, 'Latest message block hash'),
    latestMessageId,
    latestRecipient: normalizeAddress(input.latestRecipient, 'Latest message recipient'),
    latestSender: normalizeAddress(input.latestSender, 'Latest message sender'),
    messageCount
  };
};

const normalizeAuthenticatedRecovery = (
  input: ChatV2AuthenticatedRecovery,
  anchor: ChatRecoveryAnchor,
  label: string
): ChatV2AuthenticatedRecovery => {
  const normalized = {
    conversationId: normalizeHash(input.conversationId, `${label} conversation ID`),
    epoch: normalizePositiveDecimal(input.epoch, `${label} epoch`),
    messageBlock: normalizePositiveDecimal(input.messageBlock, `${label} message block`),
    messageBlockHash: normalizeHash(input.messageBlockHash, `${label} message block hash`),
    messageId: normalizePositiveDecimal(input.messageId, `${label} message ID`),
    recipient: normalizeAddress(input.recipient, `${label} recipient`),
    sender: normalizeAddress(input.sender, `${label} sender`)
  };
  const currentEpoch = BigInt(anchor.currentEpoch);
  if (
    currentEpoch <= 1n ||
    normalized.conversationId !== anchor.conversationId ||
    normalized.epoch !== (currentEpoch - 1n).toString() ||
    normalized.messageBlock !== anchor.latestMessageBlock ||
    normalized.messageBlockHash !== anchor.latestMessageBlockHash ||
    normalized.messageId !== anchor.latestMessageId ||
    normalized.recipient !== anchor.latestRecipient ||
    normalized.sender !== anchor.latestSender
  ) {
    throw new Error(`${label} does not attest the canonical authenticated message decrypt.`);
  }
  return normalized;
};

const assertEqualAnchor = (
  before: ChatRecoveryAnchor,
  after: ChatRecoveryAnchor,
  label: string
): void => {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${label} changed the canonical Chat V2 recovery anchor.`);
  }
};

const normalizePhases = (
  phases: RecoveryPhaseEvidence[],
  expected: readonly RecoveryWalletPhase[],
  label: string
): RecoveryPhaseEvidence[] => {
  if (
    phases.length !== expected.length ||
    phases.some(({ phase }, index) => phase !== expected[index])
  ) {
    throw new Error(`${label} phase sequence is incomplete or out of order.`);
  }
  return phases.map((phase) => {
    const normalized = buildRecoveryPhaseEvidence({
      phase: phase.phase,
      rpc: phase.rpc as unknown as Array<Record<string, unknown>>,
      uiPrompts: phase.uiPrompts as unknown as Array<Record<string, unknown>>
    });
    assertRecoveryPhaseSemantics(normalized);
    return normalized;
  });
};

const normalizeWalletRuntime = (runtime: RecoveryWalletRuntime): RecoveryWalletRuntime => {
  if (
    !VERSION_PATTERN.test(runtime.browserVersion) ||
    !VERSION_PATTERN.test(runtime.playwrightVersion) ||
    !EXTENSION_ID_PATTERN.test(runtime.extensionId) ||
    runtime.cotiSnapVersion !== PINNED_COTI_SNAP_VERSION ||
    runtime.metamaskVersion !== PINNED_METAMASK_VERSION ||
    runtime.metamaskOfficialArchiveSha256 !== PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256 ||
    runtime.metamaskUnpackedDirectorySha256 !== PINNED_METAMASK_DIRECTORY_SHA256 ||
    runtime.metamaskUnpackedDirectorySha256AfterRun !== PINNED_METAMASK_DIRECTORY_SHA256
  ) {
    throw new Error('Recovery wallet provenance does not match the reviewed runtime pins.');
  }
  return {
    browserVersion: runtime.browserVersion,
    cotiSnapVersion: PINNED_COTI_SNAP_VERSION,
    extensionId: runtime.extensionId,
    metamaskOfficialArchiveSha256: PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
    metamaskUnpackedDirectorySha256: PINNED_METAMASK_DIRECTORY_SHA256,
    metamaskUnpackedDirectorySha256AfterRun: PINNED_METAMASK_DIRECTORY_SHA256,
    metamaskVersion: PINNED_METAMASK_VERSION,
    playwrightVersion: runtime.playwrightVersion
  };
};

export const buildChatV2RecoveryEvidence = (
  input: Omit<ChatV2RecoveryEvidenceDocument, 'schemaVersion'>
): ChatV2RecoveryEvidenceDocument => {
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error('Recovery capture time must be an ISO-compatible timestamp.');
  }
  const alice = normalizeAddress(input.participants.alice, 'Alice address');
  const bob = normalizeAddress(input.participants.bob, 'Bob address');
  if (alice === bob) throw new Error('Recovery participants must be different addresses.');
  if (input.contract.chainId !== COTI_TESTNET_CHAIN_ID) {
    throw new Error('Recovery evidence is hard-locked to COTI testnet.');
  }
  if (
    input.onboarding.address !== ACCOUNT_ONBOARD_ADDRESS ||
    input.onboarding.selector !== ACCOUNT_ONBOARD_SELECTOR ||
    input.onboarding.runtimeBytecodeHash !== ACCOUNT_ONBOARD_RUNTIME_HASH ||
    input.packageRuntime.cotiEthersVersion !== COTI_ETHERS_VERSION ||
    input.packageRuntime.cotiSdkVersion !== COTI_SDK_VERSION
  ) {
    throw new Error('Recovery onboarding or package provenance does not match reviewed pins.');
  }

  const persistentBefore = normalizeAnchor(input.persistentReload.before);
  const persistentAfter = normalizeAnchor(input.persistentReload.after);
  const restoredBefore = normalizeAnchor(input.restoredProfile.before);
  const restoredAfter = normalizeAnchor(input.restoredProfile.after);
  const persistentAuthenticatedRecovery = normalizeAuthenticatedRecovery(
    input.persistentReload.authenticatedRecovery,
    persistentAfter,
    'Persistent-profile recovery'
  );
  const restoredAuthenticatedRecovery = normalizeAuthenticatedRecovery(
    input.restoredProfile.authenticatedRecovery,
    restoredAfter,
    'Restored-profile recovery'
  );
  assertEqualAnchor(persistentBefore, persistentAfter, 'Persistent-profile reload');
  assertEqualAnchor(persistentBefore, restoredBefore, 'Restored-profile setup');
  assertEqualAnchor(restoredBefore, restoredAfter, 'Restored-profile verification');
  if (
    persistentBefore.latestSender !== bob ||
    persistentBefore.latestRecipient !== alice
  ) {
    throw new Error('Recovery evidence did not decrypt the canonical Bob-to-Alice message.');
  }
  if (
    input.persistentReload.envelopeRefresh !== 'not-required' ||
    input.persistentReload.isolation !== 'same-canonical-profile-after-context-close' ||
    input.restoredProfile.envelopeRefresh !== 'not-required' ||
    input.restoredProfile.initialSnapState !== 'pre-onboarded-by-official-companion' ||
    input.restoredProfile.isolation !== 'distinct-nonnested-canonical-profile' ||
    input.restoredProfile.onboardingMeasuredInHarness !== false ||
    input.restoredProfile.onboardingOperatorAck !== OFFICIAL_COTI_ONBOARDING_ACK ||
    input.restoredProfile.onboardingOrigin !== OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN ||
    input.restoredProfile.operatorAck !== RESTORED_PROFILE_ACK ||
    normalizeAddress(input.restoredProfile.ownerAddress, 'Restored owner') !== alice
  ) {
    throw new Error('Recovery isolation, initial state, or owner attestation is invalid.');
  }
  return {
    capturedAt: new Date(input.capturedAt).toISOString(),
    contract: {
      address: normalizeAddress(input.contract.address, 'Chat contract address'),
      chainId: COTI_TESTNET_CHAIN_ID,
      deploymentBlock: normalizePositiveDecimal(input.contract.deploymentBlock, 'Deployment block'),
      runtimeBytecodeHash: normalizeHash(input.contract.runtimeBytecodeHash, 'Chat runtime hash')
    },
    onboarding: {
      address: ACCOUNT_ONBOARD_ADDRESS,
      runtimeBytecodeHash: ACCOUNT_ONBOARD_RUNTIME_HASH,
      selector: ACCOUNT_ONBOARD_SELECTOR
    },
    packageRuntime: {
      cotiEthersVersion: COTI_ETHERS_VERSION,
      cotiSdkVersion: COTI_SDK_VERSION
    },
    participants: { alice, bob },
    persistentReload: {
      after: persistentAfter,
      authenticatedRecovery: persistentAuthenticatedRecovery,
      before: persistentBefore,
      envelopeRefresh: 'not-required',
      isolation: 'same-canonical-profile-after-context-close',
      phases: normalizePhases(input.persistentReload.phases, PERSISTENT_PHASES, 'Persistent reload')
    },
    restoredProfile: {
      after: restoredAfter,
      authenticatedRecovery: restoredAuthenticatedRecovery,
      before: restoredBefore,
      envelopeRefresh: 'not-required',
      initialSnapState: 'pre-onboarded-by-official-companion',
      isolation: 'distinct-nonnested-canonical-profile',
      onboardingMeasuredInHarness: false,
      onboardingOperatorAck: OFFICIAL_COTI_ONBOARDING_ACK,
      onboardingOrigin: OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN,
      operatorAck: RESTORED_PROFILE_ACK,
      ownerAddress: alice,
      verificationPhases: normalizePhases(
        input.restoredProfile.verificationPhases,
        PERSISTENT_PHASES,
        'Restored-profile verification'
      )
    },
    schemaVersion: 1,
    walletRuntime: normalizeWalletRuntime(input.walletRuntime),
    warmEvidenceSha256: normalizeHash(input.warmEvidenceSha256, 'Warm evidence SHA-256')
  };
};

export const serializeChatV2RecoveryEvidence = (
  document: ChatV2RecoveryEvidenceDocument
): string => `${JSON.stringify(document, null, 2)}\n`;
