import {
  COTI_TESTNET_CHAIN_ID,
  PINNED_COTI_SNAP_VERSION,
  PINNED_METAMASK_DIRECTORY_SHA256,
  PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  PINNED_METAMASK_VERSION
} from './metamaskPolicy';
import {
  DIRECT_CHAT_V2_CREATE_SELECTOR,
  DIRECT_CHAT_V2_ROTATE_SELECTOR
} from '../../src/lib/directChatV2Chain';
import { deriveDirectChatV2ConversationId } from '../../src/lib/directChatV2Crypto';
import { DIRECT_CHAT_V2_SEND_SELECTOR } from './transactionPolicy';

export const REAL_WALLET_PHASES = [
  'wallet-connect',
  'snap-unlock',
  'deployment-attestation',
  'warm-create',
  'envelope-recovery',
  'warm-send',
  'warm-rotate',
  'snap-install',
  'privacy-onboarding',
  'snap-key-store'
] as const;

export type RealWalletPhase = (typeof REAL_WALLET_PHASES)[number];
export type RealWalletRole = 'alice' | 'bob';
export type RpcObservationOutcome = 'blocked' | 'error' | 'success';
export type CotiSnapOperation =
  | 'connect-to-wallet'
  | 'get-aes-key'
  | 'has-aes-key'
  | 'set-aes-key';
export type WalletPromptKind =
  | 'signature'
  | 'snap-aes-access'
  | 'snap-install'
  | 'snap-connect-wallet'
  | 'snap-key-store'
  | 'transaction'
  | 'wallet-connect'
  | 'wallet-unlock';

export type SanitizedRpcObservation = {
  durationMs: number;
  method: string;
  operation?: CotiSnapOperation;
  outcome: RpcObservationOutcome;
  phase: RealWalletPhase;
  selector?: string;
  startedAtMs: number;
  target?: string;
};

export type SanitizedWalletPromptObservation = {
  durationMs: number;
  kind: WalletPromptKind;
  outcome: 'rejected' | 'resolved';
  phase: RealWalletPhase;
  startedAtMs: number;
};

export type PhaseEvidence = {
  phase: RealWalletPhase;
  rpc: SanitizedRpcObservation[];
  uiPrompts: SanitizedWalletPromptObservation[];
};

export type RoleEvidence = {
  phases: PhaseEvidence[];
  role: RealWalletRole;
};

export type ChatV2RecoveryAnchor = {
  conversationId: string;
  currentEpoch: string;
  latestMessageBlock: string;
  latestMessageBlockHash: string;
  latestMessageId: string;
  latestRecipient: string;
  latestSender: string;
  messageCount: string;
};

export type ChatRecoveryAnchor = ChatV2RecoveryAnchor;

export type ChatV2AuthenticatedRecovery = {
  conversationId: string;
  epoch: string;
  messageBlock: string;
  messageBlockHash: string;
  messageId: string;
  recipient: string;
  sender: string;
};

export type RealWalletEvidenceDocument = {
  capturedAt: string;
  contract: {
    address: string;
    chainId: string;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  };
  participants: {
    alice: string;
    bob: string;
  };
  authenticatedRecovery: ChatV2AuthenticatedRecovery;
  recoveryAnchor: ChatV2RecoveryAnchor;
  roles: RoleEvidence[];
  schemaVersion: 2;
  walletRuntime: {
    browserVersion: string;
    cotiSnapVersion: string;
    extensionId: string;
    metamaskOfficialArchiveSha256: string;
    metamaskUnpackedDirectorySha256: string;
    metamaskUnpackedDirectorySha256AfterRun: string;
    metamaskVersion: string;
    playwrightVersion: string;
  };
};

export type RealWalletEvidenceInput = Omit<RealWalletEvidenceDocument, 'schemaVersion'>;

const PHASE_SET = new Set<string>(REAL_WALLET_PHASES);
const PROMPT_KIND_SET = new Set<string>([
  'signature',
  'snap-aes-access',
  'snap-install',
  'snap-connect-wallet',
  'snap-key-store',
  'transaction',
  'wallet-connect',
  'wallet-unlock'
]);
const OUTCOME_SET = new Set<string>(['blocked', 'error', 'success']);
const PROMPT_OUTCOME_SET = new Set<string>(['rejected', 'resolved']);
const COTI_SNAP_OPERATION_SET = new Set<string>([
  'connect-to-wallet',
  'get-aes-key',
  'has-aes-key',
  'set-aes-key'
]);
const METHOD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SELECTOR_PATTERN = /^0x[0-9a-fA-F]{8}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,79}$/;
const EVIDENCE_INPUT_KEYS = [
  'authenticatedRecovery',
  'capturedAt',
  'contract',
  'participants',
  'recoveryAnchor',
  'roles',
  'walletRuntime'
] as const;
const EVIDENCE_DOCUMENT_KEYS = [...EVIDENCE_INPUT_KEYS, 'schemaVersion'] as const;
const RECOVERY_ANCHOR_KEYS = [
  'conversationId',
  'currentEpoch',
  'latestMessageBlock',
  'latestMessageBlockHash',
  'latestMessageId',
  'latestRecipient',
  'latestSender',
  'messageCount'
] as const;
const AUTHENTICATED_RECOVERY_KEYS = [
  'conversationId',
  'epoch',
  'messageBlock',
  'messageBlockHash',
  'messageId',
  'recipient',
  'sender'
] as const;
const WALLET_RUNTIME_KEYS = [
  'browserVersion',
  'cotiSnapVersion',
  'extensionId',
  'metamaskOfficialArchiveSha256',
  'metamaskUnpackedDirectorySha256',
  'metamaskUnpackedDirectorySha256AfterRun',
  'metamaskVersion',
  'playwrightVersion'
] as const;
const EXPECTED_PHASES_BY_ROLE: Record<RealWalletRole, readonly RealWalletPhase[]> = {
  alice: [
    'wallet-connect',
    'snap-unlock',
    'deployment-attestation',
    'warm-create',
    'envelope-recovery',
    'warm-send',
    'warm-rotate',
    'envelope-recovery'
  ],
  bob: [
    'wallet-connect',
    'snap-unlock',
    'deployment-attestation',
    'envelope-recovery',
    'warm-send',
    'warm-rotate'
  ]
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const assertExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must use the exact evidence schema.`);
  }
};

const finiteMilliseconds = (value: unknown, label: string): number => {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite non-negative millisecond value.`);
  }
  return Math.round(parsed * 1_000) / 1_000;
};

const realWalletPhase = (value: unknown): RealWalletPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    throw new Error('Unknown real-wallet measurement phase.');
  }
  return value as RealWalletPhase;
};

export const isUnexpectedSigningMethod = (method: string): boolean =>
  method === 'eth_decrypt' ||
  method === 'eth_sendRawTransaction' ||
  method === 'eth_sign' ||
  method === 'eth_signTransaction' ||
  method.startsWith('eth_signTypedData') ||
  method === 'personal_sendTransaction' ||
  method === 'personal_sign' ||
  method === 'personal_unlockAccount';

export const isWalletOrSnapMethod = (method: string): boolean => method.startsWith('wallet_');

export const sanitizeRpcObservation = (input: Record<string, unknown>): SanitizedRpcObservation => {
  const method = typeof input.method === 'string' ? input.method : '';
  if (!METHOD_PATTERN.test(method)) {
    throw new Error('RPC observation method is invalid.');
  }
  const outcome = typeof input.outcome === 'string' ? input.outcome : '';
  if (!OUTCOME_SET.has(outcome)) {
    throw new Error('RPC observation outcome is invalid.');
  }

  const sanitized: SanitizedRpcObservation = {
    durationMs: finiteMilliseconds(input.durationMs, 'RPC duration'),
    method,
    outcome: outcome as RpcObservationOutcome,
    phase: realWalletPhase(input.phase),
    startedAtMs: finiteMilliseconds(input.startedAtMs, 'RPC start')
  };

  if (method === 'wallet_invokeSnap') {
    const operation = typeof input.operation === 'string' ? input.operation : '';
    if (!COTI_SNAP_OPERATION_SET.has(operation)) {
      throw new Error('COTI Snap observation requires an allowlisted operation.');
    }
    sanitized.operation = operation as CotiSnapOperation;
  } else if (input.operation !== undefined) {
    throw new Error('Only COTI Snap observations may contain an operation.');
  }

  if (method === 'eth_sendTransaction') {
    const target = typeof input.target === 'string' ? input.target : '';
    const selector = typeof input.selector === 'string' ? input.selector : '';
    if (!ADDRESS_PATTERN.test(target) || !SELECTOR_PATTERN.test(selector)) {
      throw new Error('Transaction observation requires an allowlisted target and selector.');
    }
    sanitized.target = target.toLowerCase();
    sanitized.selector = selector.toLowerCase();
  }

  return sanitized;
};

export const sanitizeWalletPromptObservation = (
  input: Record<string, unknown>
): SanitizedWalletPromptObservation => {
  const kind = typeof input.kind === 'string' ? input.kind : '';
  const outcome = typeof input.outcome === 'string' ? input.outcome : '';
  if (!PROMPT_KIND_SET.has(kind) || !PROMPT_OUTCOME_SET.has(outcome)) {
    throw new Error('Wallet prompt observation is invalid.');
  }
  return {
    durationMs: finiteMilliseconds(input.durationMs, 'Wallet prompt duration'),
    kind: kind as WalletPromptKind,
    outcome: outcome as 'rejected' | 'resolved',
    phase: realWalletPhase(input.phase),
    startedAtMs: finiteMilliseconds(input.startedAtMs, 'Wallet prompt start')
  };
};

export const buildPhaseEvidence = ({
  phase,
  rpc,
  uiPrompts
}: {
  phase: RealWalletPhase;
  rpc: Array<Record<string, unknown>>;
  uiPrompts: Array<Record<string, unknown>>;
}): PhaseEvidence => {
  const normalizedPhase = realWalletPhase(phase);
  const sanitizedRpc = rpc.map(sanitizeRpcObservation);
  const sanitizedPrompts = uiPrompts.map(sanitizeWalletPromptObservation);
  if (
    sanitizedRpc.some((entry) => entry.phase !== normalizedPhase) ||
    sanitizedPrompts.some((entry) => entry.phase !== normalizedPhase)
  ) {
    throw new Error('Evidence observation phase does not match its enclosing phase.');
  }
  return {
    phase: normalizedPhase,
    rpc: sanitizedRpc,
    uiPrompts: sanitizedPrompts
  };
};

const assertNoUnexpectedWarmMethods = (phase: PhaseEvidence): void => {
  const unexpected = phase.rpc.find(
    ({ method }) => isUnexpectedSigningMethod(method) || isWalletOrSnapMethod(method)
  );
  if (unexpected) {
    throw new Error(`Unexpected signing or wallet RPC in ${phase.phase}.`);
  }
  if (phase.rpc.some(({ outcome }) => outcome !== 'success')) {
    throw new Error(`${phase.phase} contains a failed or blocked RPC.`);
  }
};

export const assertWalletConnectPhase = (phase: PhaseEvidence): void => {
  if (phase.phase !== 'wallet-connect') throw new Error('Expected the wallet-connect phase.');
  if (
    phase.rpc.some(
      ({ method, outcome }) =>
        outcome !== 'success' ||
        method.startsWith('wallet_') ||
        method.startsWith('eth_send') ||
        isUnexpectedSigningMethod(method)
    )
  ) {
    throw new Error('Wallet connection used an unexpected or failed RPC.');
  }
  if (
    phase.uiPrompts.some(
      ({ kind, outcome }) =>
        outcome !== 'resolved' || (kind !== 'wallet-connect' && kind !== 'wallet-unlock')
    )
  ) {
    throw new Error('Wallet connection displayed an unexpected prompt.');
  }
};

export const assertSessionBootstrapPhase = (phase: PhaseEvidence): void => {
  if (phase.phase !== 'snap-unlock') throw new Error('Expected the COTI Snap bootstrap phase.');
  if (phase.rpc.some(({ outcome }) => outcome !== 'success')) {
    throw new Error('COTI Snap bootstrap contains a failed or blocked RPC.');
  }
  if (
    phase.rpc.some(
      ({ method }) => isUnexpectedSigningMethod(method) || method === 'wallet_requestSnaps'
    )
  ) {
    throw new Error('Cold Snap installation or private signing is forbidden in session bootstrap.');
  }
  const operations = phase.rpc
    .filter(({ method }) => method === 'wallet_invokeSnap')
    .map(({ operation }) => operation);
  if (
    operations.length !== 3 ||
    operations[0] !== 'connect-to-wallet' ||
    operations[1] !== 'has-aes-key' ||
    operations[2] !== 'get-aes-key'
  ) {
    throw new Error('Session bootstrap must invoke connect, prompt-free key check, then key access once.');
  }
  const prompts = phase.uiPrompts;
  if (
    prompts.length !== 2 ||
    prompts[0].kind !== 'snap-connect-wallet' ||
    prompts[1].kind !== 'snap-aes-access' ||
    prompts.some(({ outcome }) => outcome !== 'resolved')
  ) {
    throw new Error('Session bootstrap must contain exactly two resolved COTI confirmations.');
  }
};

export const assertWarmTransactionPhase = (
  phase: PhaseEvidence,
  expectedTarget: string,
  expectedSelector: string
): void => {
  assertNoUnexpectedWarmMethods(phase);
  const sends = phase.rpc.filter(({ method }) => method === 'eth_sendTransaction');
  if (sends.length !== 1 || sends[0].outcome !== 'success') {
    throw new Error(`${phase.phase} must contain exactly one successful eth_sendTransaction.`);
  }
  if (
    sends[0].target !== expectedTarget.toLowerCase() ||
    sends[0].selector !== expectedSelector.toLowerCase()
  ) {
    throw new Error(`${phase.phase} transaction target or selector did not match the allowlist.`);
  }
  if (
    phase.uiPrompts.length !== 1 ||
    phase.uiPrompts[0].kind !== 'transaction' ||
    phase.uiPrompts[0].outcome !== 'resolved'
  ) {
    throw new Error(`${phase.phase} must contain exactly one resolved transaction prompt.`);
  }
};

export const assertPromptFreeReadPhase = (phase: PhaseEvidence): void => {
  assertNoUnexpectedWarmMethods(phase);
  if (phase.rpc.some(({ method }) => method.startsWith('eth_send'))) {
    throw new Error(`${phase.phase} must not submit a transaction.`);
  }
  if (phase.uiPrompts.length !== 0) {
    throw new Error(`${phase.phase} must not display a wallet prompt.`);
  }
};

const normalizeAddress = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    !ADDRESS_PATTERN.test(value) ||
    /^0x0{40}$/i.test(value)
  ) {
    throw new Error(`${label} must be a non-zero address.`);
  }
  return value.toLowerCase();
};

const normalizePositiveIntegerString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal integer string.`);
  }
  return BigInt(value).toString();
};

const normalizeBytes32 = (value: unknown, label: string, nonZero = false): string => {
  if (
    typeof value !== 'string' ||
    !BYTES32_PATTERN.test(value) ||
    (nonZero && /^0x0{64}$/i.test(value))
  ) {
    throw new Error(`${label} must be a${nonZero ? ' non-zero' : ''} bytes32 value.`);
  }
  return value.toLowerCase();
};

const normalizeRecoveryAnchor = ({
  anchor,
  chainId,
  contractAddress,
  deploymentBlock,
  participants
}: {
  anchor: ChatV2RecoveryAnchor;
  chainId: string;
  contractAddress: string;
  deploymentBlock: string;
  participants: { alice: string; bob: string };
}): ChatV2RecoveryAnchor => {
  assertExactKeys(
    requireRecord(anchor, 'Evidence recovery anchor'),
    RECOVERY_ANCHOR_KEYS,
    'Evidence recovery anchor'
  );
  const conversationId = normalizeBytes32(
    anchor.conversationId,
    'Recovery conversation ID',
    true
  );
  const expectedConversationId = deriveDirectChatV2ConversationId({
    chainId: BigInt(chainId),
    contractAddress,
    participantA: participants.alice,
    participantB: participants.bob
  }).toLowerCase();
  if (conversationId !== expectedConversationId) {
    throw new Error('Recovery anchor conversation does not match its participants and deployment.');
  }
  const currentEpoch = normalizePositiveIntegerString(
    anchor.currentEpoch,
    'Recovery current epoch'
  );
  const messageCount = normalizePositiveIntegerString(anchor.messageCount, 'Recovery message count');
  const latestMessageId = normalizePositiveIntegerString(
    anchor.latestMessageId,
    'Recovery latest message ID'
  );
  const latestMessageBlock = normalizePositiveIntegerString(
    anchor.latestMessageBlock,
    'Recovery latest message block'
  );
  const latestSender = normalizeAddress(anchor.latestSender, 'Recovery latest sender');
  const latestRecipient = normalizeAddress(anchor.latestRecipient, 'Recovery latest recipient');
  if (messageCount !== latestMessageId) {
    throw new Error('Recovery anchor must bind the canonical latest message ID to message count.');
  }
  if (currentEpoch !== '3' || messageCount !== '2') {
    throw new Error('Recovery anchor must describe the completed two-message, three-epoch warm journey.');
  }
  if (latestSender !== participants.bob || latestRecipient !== participants.alice) {
    throw new Error('Recovery anchor latest message must bind Bob as sender and Alice as recipient.');
  }
  if (BigInt(latestMessageBlock) < BigInt(deploymentBlock)) {
    throw new Error('Recovery anchor latest message predates the Chat V2 deployment.');
  }
  return {
    conversationId,
    currentEpoch,
    latestMessageBlock,
    latestMessageBlockHash: normalizeBytes32(
      anchor.latestMessageBlockHash,
      'Recovery latest message block hash',
      true
    ),
    latestMessageId,
    latestRecipient,
    latestSender,
    messageCount
  };
};

const normalizeAuthenticatedRecovery = (
  receipt: ChatV2AuthenticatedRecovery,
  anchor: ChatV2RecoveryAnchor
): ChatV2AuthenticatedRecovery => {
  assertExactKeys(
    requireRecord(receipt, 'Evidence authenticated recovery'),
    AUTHENTICATED_RECOVERY_KEYS,
    'Evidence authenticated recovery'
  );
  const normalized = {
    conversationId: normalizeBytes32(
      receipt.conversationId,
      'Authenticated recovery conversation ID',
      true
    ),
    epoch: normalizePositiveIntegerString(receipt.epoch, 'Authenticated recovery epoch'),
    messageBlock: normalizePositiveIntegerString(
      receipt.messageBlock,
      'Authenticated recovery message block'
    ),
    messageBlockHash: normalizeBytes32(
      receipt.messageBlockHash,
      'Authenticated recovery message block hash',
      true
    ),
    messageId: normalizePositiveIntegerString(
      receipt.messageId,
      'Authenticated recovery message ID'
    ),
    recipient: normalizeAddress(receipt.recipient, 'Authenticated recovery recipient'),
    sender: normalizeAddress(receipt.sender, 'Authenticated recovery sender')
  };
  if (
    normalized.conversationId !== anchor.conversationId ||
    normalized.epoch !== (BigInt(anchor.currentEpoch) - 1n).toString() ||
    normalized.messageBlock !== anchor.latestMessageBlock ||
    normalized.messageBlockHash !== anchor.latestMessageBlockHash ||
    normalized.messageId !== anchor.latestMessageId ||
    normalized.recipient !== anchor.latestRecipient ||
    normalized.sender !== anchor.latestSender
  ) {
    throw new Error('Warm evidence does not attest the canonical authenticated message decrypt.');
  }
  return normalized;
};

const assertEvidencePhaseSemantics = (
  phase: PhaseEvidence,
  contractAddress: string
): void => {
  if (phase.rpc.length === 0) {
    throw new Error(`Evidence ${phase.phase} phase must contain measured RPC activity.`);
  }
  if (phase.phase === 'wallet-connect') {
    assertWalletConnectPhase(phase);
    return;
  }
  if (phase.phase === 'snap-unlock') {
    assertSessionBootstrapPhase(phase);
    return;
  }
  if (phase.phase === 'warm-create') {
    assertWarmTransactionPhase(phase, contractAddress, DIRECT_CHAT_V2_CREATE_SELECTOR);
    return;
  }
  if (phase.phase === 'warm-send') {
    assertWarmTransactionPhase(phase, contractAddress, DIRECT_CHAT_V2_SEND_SELECTOR);
    return;
  }
  if (phase.phase === 'warm-rotate') {
    assertWarmTransactionPhase(phase, contractAddress, DIRECT_CHAT_V2_ROTATE_SELECTOR);
    return;
  }
  assertPromptFreeReadPhase(phase);
};

export const buildEvidenceDocument = (
  input: RealWalletEvidenceInput
): RealWalletEvidenceDocument => {
  assertExactKeys(
    requireRecord(input, 'Evidence input'),
    EVIDENCE_INPUT_KEYS,
    'Evidence input'
  );
  const {
    authenticatedRecovery,
    capturedAt,
    contract,
    participants,
    recoveryAnchor,
    roles,
    walletRuntime
  } = input;
  assertExactKeys(requireRecord(contract, 'Evidence contract'), [
    'address',
    'chainId',
    'deploymentBlock',
    'runtimeBytecodeHash'
  ], 'Evidence contract');
  assertExactKeys(
    requireRecord(participants, 'Evidence participants'),
    ['alice', 'bob'],
    'Evidence participants'
  );
  assertExactKeys(
    requireRecord(walletRuntime, 'Evidence wallet runtime'),
    WALLET_RUNTIME_KEYS,
    'Evidence wallet runtime'
  );
  if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('Evidence capture time must be an ISO-compatible timestamp.');
  }
  const runtimeBytecodeHash = normalizeBytes32(
    contract.runtimeBytecodeHash,
    'Evidence runtime bytecode hash'
  );
  const contractAddress = normalizeAddress(contract.address, 'Evidence contract address');
  const chainId = normalizePositiveIntegerString(contract.chainId, 'Evidence chain ID');
  if (chainId !== COTI_TESTNET_CHAIN_ID) {
    throw new Error('Evidence is hard-locked to COTI testnet chain 7082400.');
  }
  const deploymentBlock = normalizePositiveIntegerString(
    contract.deploymentBlock,
    'Evidence deployment block'
  );
  const normalizedParticipants = {
    alice: normalizeAddress(participants.alice, 'Evidence Alice participant'),
    bob: normalizeAddress(participants.bob, 'Evidence Bob participant')
  };
  if (normalizedParticipants.alice === normalizedParticipants.bob) {
    throw new Error('Evidence Alice and Bob participants must be different addresses.');
  }
  const normalizedRecoveryAnchor = normalizeRecoveryAnchor({
    anchor: recoveryAnchor,
    chainId,
    contractAddress,
    deploymentBlock,
    participants: normalizedParticipants
  });
  const normalizedAuthenticatedRecovery = normalizeAuthenticatedRecovery(
    authenticatedRecovery,
    normalizedRecoveryAnchor
  );
  const roleSet = new Set(roles.map(({ role }) => role));
  if (roles.length !== 2 || roleSet.size !== 2 || !roleSet.has('alice') || !roleSet.has('bob')) {
    throw new Error('Evidence must contain exactly one Alice role and one Bob role.');
  }
  for (const { role, phases } of roles) {
    const expected = EXPECTED_PHASES_BY_ROLE[role];
    if (
      phases.length !== expected.length ||
      phases.some(({ phase }, index) => phase !== expected[index])
    ) {
      throw new Error(`Evidence ${role} phase sequence is incomplete or out of order.`);
    }
  }
  const normalizedRoles = roles.map(({ role, phases }) => ({
    role,
    phases: phases.map(({ phase, rpc, uiPrompts }) => {
      const normalized = buildPhaseEvidence({
        phase,
        rpc: rpc as unknown as Array<Record<string, unknown>>,
        uiPrompts: uiPrompts as unknown as Array<Record<string, unknown>>
      });
      assertEvidencePhaseSemantics(normalized, contractAddress);
      return normalized;
    })
  }));
  if (
    !VERSION_PATTERN.test(walletRuntime.browserVersion) ||
    !VERSION_PATTERN.test(walletRuntime.playwrightVersion)
  ) {
    throw new Error('Evidence browser and Playwright versions are invalid.');
  }
  if (!EXTENSION_ID_PATTERN.test(walletRuntime.extensionId)) {
    throw new Error('Evidence MetaMask extension ID is invalid.');
  }
  if (
    walletRuntime.cotiSnapVersion !== PINNED_COTI_SNAP_VERSION ||
    walletRuntime.metamaskVersion !== PINNED_METAMASK_VERSION ||
    walletRuntime.metamaskOfficialArchiveSha256 !== PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256 ||
    walletRuntime.metamaskUnpackedDirectorySha256 !== PINNED_METAMASK_DIRECTORY_SHA256 ||
    walletRuntime.metamaskUnpackedDirectorySha256AfterRun !== PINNED_METAMASK_DIRECTORY_SHA256
  ) {
    throw new Error('Evidence MetaMask provenance does not match the reviewed release pins.');
  }
  return {
    authenticatedRecovery: normalizedAuthenticatedRecovery,
    capturedAt: new Date(capturedAt).toISOString(),
    contract: {
      address: contractAddress,
      chainId,
      deploymentBlock,
      runtimeBytecodeHash
    },
    participants: normalizedParticipants,
    recoveryAnchor: normalizedRecoveryAnchor,
    roles: normalizedRoles,
    schemaVersion: 2,
    walletRuntime: {
      browserVersion: walletRuntime.browserVersion,
      cotiSnapVersion: PINNED_COTI_SNAP_VERSION,
      extensionId: walletRuntime.extensionId,
      metamaskOfficialArchiveSha256: PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
      metamaskUnpackedDirectorySha256: PINNED_METAMASK_DIRECTORY_SHA256,
      metamaskUnpackedDirectorySha256AfterRun: PINNED_METAMASK_DIRECTORY_SHA256,
      metamaskVersion: PINNED_METAMASK_VERSION,
      playwrightVersion: walletRuntime.playwrightVersion
    }
  };
};

const assertExactParsedEvidenceShape = (input: unknown): Record<string, unknown> => {
  const document = requireRecord(input, 'Evidence document');
  assertExactKeys(document, EVIDENCE_DOCUMENT_KEYS, 'Evidence document');
  if (document.schemaVersion !== 2) {
    throw new Error('Evidence document schemaVersion must be exactly 2.');
  }
  assertExactKeys(
    requireRecord(document.authenticatedRecovery, 'Evidence authenticated recovery'),
    AUTHENTICATED_RECOVERY_KEYS,
    'Evidence authenticated recovery'
  );
  assertExactKeys(
    requireRecord(document.contract, 'Evidence contract'),
    ['address', 'chainId', 'deploymentBlock', 'runtimeBytecodeHash'],
    'Evidence contract'
  );
  assertExactKeys(
    requireRecord(document.participants, 'Evidence participants'),
    ['alice', 'bob'],
    'Evidence participants'
  );
  assertExactKeys(
    requireRecord(document.recoveryAnchor, 'Evidence recovery anchor'),
    RECOVERY_ANCHOR_KEYS,
    'Evidence recovery anchor'
  );
  assertExactKeys(
    requireRecord(document.walletRuntime, 'Evidence wallet runtime'),
    WALLET_RUNTIME_KEYS,
    'Evidence wallet runtime'
  );
  if (!Array.isArray(document.roles)) {
    throw new Error('Evidence roles must be a JSON array.');
  }
  for (const role of document.roles) {
    const roleRecord = requireRecord(role, 'Evidence role');
    assertExactKeys(roleRecord, ['phases', 'role'], 'Evidence role');
    if (!Array.isArray(roleRecord.phases)) {
      throw new Error('Evidence role phases must be a JSON array.');
    }
    for (const phase of roleRecord.phases) {
      const phaseRecord = requireRecord(phase, 'Evidence phase');
      assertExactKeys(phaseRecord, ['phase', 'rpc', 'uiPrompts'], 'Evidence phase');
      if (!Array.isArray(phaseRecord.rpc) || !Array.isArray(phaseRecord.uiPrompts)) {
        throw new Error('Evidence phase observations must be JSON arrays.');
      }
      for (const observation of phaseRecord.rpc) {
        const rpc = requireRecord(observation, 'Evidence RPC observation');
        const optional = ['operation', 'selector', 'target'].filter(
          (key) => rpc[key] !== undefined
        );
        assertExactKeys(
          rpc,
          ['durationMs', 'method', 'outcome', 'phase', 'startedAtMs', ...optional],
          'Evidence RPC observation'
        );
        if (
          rpc.method !== 'eth_sendTransaction' &&
          (rpc.selector !== undefined || rpc.target !== undefined)
        ) {
          throw new Error('Only transaction evidence may contain a target or selector.');
        }
      }
      for (const observation of phaseRecord.uiPrompts) {
        assertExactKeys(
          requireRecord(observation, 'Evidence prompt observation'),
          ['durationMs', 'kind', 'outcome', 'phase', 'startedAtMs'],
          'Evidence prompt observation'
        );
      }
    }
  }
  return document;
};

export const parseEvidenceDocument = (input: string | unknown): RealWalletEvidenceDocument => {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error('Evidence document must be valid JSON.');
    }
  }
  const document = assertExactParsedEvidenceShape(parsed);
  return buildEvidenceDocument({
    authenticatedRecovery:
      document.authenticatedRecovery as ChatV2AuthenticatedRecovery,
    capturedAt: document.capturedAt as string,
    contract: document.contract as RealWalletEvidenceInput['contract'],
    participants: document.participants as RealWalletEvidenceInput['participants'],
    recoveryAnchor: document.recoveryAnchor as ChatV2RecoveryAnchor,
    roles: document.roles as RoleEvidence[],
    walletRuntime: document.walletRuntime as RealWalletEvidenceInput['walletRuntime']
  });
};

export const serializeEvidenceDocument = (document: RealWalletEvidenceDocument): string =>
  `${JSON.stringify(document, null, 2)}\n`;
