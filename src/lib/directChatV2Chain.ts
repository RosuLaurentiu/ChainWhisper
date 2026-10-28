import { BrowserProvider, getAddress, Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import { loadCotiEthersModule, type CotiReadProvider } from './appShared/core';
import { extractUserCiphertext, parseSubmitMemoPayload } from './appShared/parsers';
import {
  decodeDirectChatV2ContactSettings,
  encodeDirectChatV2ContactSettings,
  normalizeDirectChatV2ContactSettings
} from './directChatV2ContactSettings';
import {
  decryptDirectChatV2Message,
  deriveDirectChatV2ConversationId,
  deriveDirectChatV2AadHash,
  DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES,
  encryptDirectChatV2Message,
  type DirectChatV2EncryptedMessage,
  type DirectChatV2MessageContext,
  type DirectChatV2Seed
} from './directChatV2Crypto';

export const DIRECT_CHAT_V2_ABI = [
  'function contractVersion() view returns (string)',
  'function PROTOCOL_VERSION() view returns (uint16)',
  'function MIN_MESSAGE_CIPHERTEXT_BYTES() view returns (uint256)',
  'function MAX_MESSAGE_CIPHERTEXT_BYTES() view returns (uint256)',
  'function NICKNAME_MAX_BYTES() view returns (uint256)',
  'function MAX_CONVERSATION_PAGE_SIZE() view returns (uint256)',
  'function MAX_CONTACT_SETTINGS_CELLS() view returns (uint256)',
  'function deploymentBlock() view returns (uint64)',
  'function messageFee() view returns (uint256)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function conversationIdFor(address accountA,address accountB) view returns (bytes32)',
  'function isParticipant(bytes32 conversationId,address account) view returns (bool)',
  'function getConversation(bytes32 conversationId) view returns (tuple(bool exists,address participantA,address participantB,uint64 currentEpoch,uint64 messageCount,uint64 createdAt,uint64 lastMessageAt,uint64 createdBlock,uint64 firstMessageBlock,uint64 lastMessageBlock))',
  'function getEpochMetadata(bytes32 conversationId,uint64 epoch) view returns (bool exists,address rotatedBy,uint64 createdAt)',
  'function getMyEpochEnvelope(bytes32 conversationId,uint64 epoch) view returns (uint256 seed)',
  'function nextSenderSequence(bytes32 conversationId,uint64 epoch,address sender) view returns (uint64)',
  'function isMessageNonceUsed(bytes32 conversationId,uint64 epoch,bytes12 nonce) view returns (bool)',
  'function canReact(bytes32 conversationId,uint64 messageId,address actor) view returns (bool)',
  'function pendingNativeCredits(address account) view returns (uint256)',
  'function nicknames(address account) view returns (string)',
  'function participantConversationCount(address account) view returns (uint256)',
  'function getParticipantConversationPage(address account,uint256 beforeIndexExclusive,uint256 limit) view returns (tuple(bytes32 conversationId,address peer,uint64 currentEpoch,uint64 messageCount,uint64 createdAt,uint64 lastMessageAt,uint64 createdBlock,uint64 firstMessageBlock,uint64 lastMessageBlock)[] previews,uint256 nextBeforeIndex)',
  'function getMyContactSettings(address contact) view returns (bool exists,uint64 revision,tuple(uint256[] value) encryptedSettings)',
  'function deriveMessageAadHash(bytes32 conversationId,uint64 epoch,address sender,address recipient,uint64 senderSequence,bytes12 nonce,uint256 valueSent,uint256 feeTaken) view returns (bytes32)',
  'function createConversation(address peer) returns (bytes32 conversationId)',
  'function rotateConversationKey(bytes32 conversationId,uint64 expectedCurrentEpoch) returns (uint64 nextEpoch)',
  'function refreshMyEpochEnvelope(bytes32 conversationId,uint64 epoch)',
  'function sendMessage(bytes32 conversationId,uint64 epoch,uint64 senderSequence,bytes12 nonce,bytes ciphertext,uint256 expectedFee) payable returns (uint64 messageId)',
  'function withdrawNativeCredit() returns (uint256 amount)',
  'function setMyNickname(string nickname)',
  'function setMyContactSettings(address contact,uint64 expectedRevision,tuple(tuple(uint256[] value) ciphertext,bytes[] signature) encryptedSettings) returns (uint64 nextRevision)',
  'function refreshMyContactSettingsEnvelope(address contact,uint64 expectedRevision)',
  'function clearMyContactSettings(address contact,uint64 expectedRevision) returns (uint64 nextRevision)',
  'event ConversationCreated(bytes32 indexed conversationId,address indexed participantA,address indexed participantB,address createdBy,uint64 epoch)',
  'event ConversationKeyRotated(bytes32 indexed conversationId,uint64 indexed epoch,address indexed rotatedBy)',
  'event ConversationEnvelopeRefreshed(bytes32 indexed conversationId,uint64 indexed epoch,address indexed participant)',
  'event MessagePosted(bytes32 indexed conversationId,address indexed sender,address indexed recipient,uint64 messageId,uint64 epoch,uint64 senderSequence,bytes12 nonce,bytes32 aadHash,bytes ciphertext,uint256 valueSent,uint256 feeTaken)',
  'event NicknameSet(address indexed user,string nickname)'
] as const;

const DIRECT_CHAT_V2_INTERFACE = new Interface(DIRECT_CHAT_V2_ABI);
export const DIRECT_CHAT_V2_CREATE_SELECTOR = DIRECT_CHAT_V2_INTERFACE.getFunction('createConversation')?.selector ?? '';
export const DIRECT_CHAT_V2_ROTATE_SELECTOR = DIRECT_CHAT_V2_INTERFACE.getFunction('rotateConversationKey')?.selector ?? '';
export const DIRECT_CHAT_V2_WITHDRAW_SELECTOR = DIRECT_CHAT_V2_INTERFACE.getFunction('withdrawNativeCredit')?.selector ?? '';
export const DIRECT_CHAT_V2_CONVERSATION_CREATED_TOPIC = DIRECT_CHAT_V2_INTERFACE.getEvent('ConversationCreated')?.topicHash ?? '';
export const DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC = DIRECT_CHAT_V2_INTERFACE.getEvent('MessagePosted')?.topicHash ?? '';
export const DIRECT_CHAT_V2_NICKNAME_SET_TOPIC = DIRECT_CHAT_V2_INTERFACE.getEvent('NicknameSet')?.topicHash ?? '';
export const DIRECT_CHAT_V2_SET_NICKNAME_SELECTOR = DIRECT_CHAT_V2_INTERFACE.getFunction('setMyNickname')?.selector ?? '';
export const DIRECT_CHAT_V2_SET_CONTACT_SETTINGS_SELECTOR = DIRECT_CHAT_V2_INTERFACE.getFunction('setMyContactSettings')?.selector ?? '';
export const DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN = 2_048n;

export const DIRECT_CHAT_V2_REQUIRED_FEATURES = [
  'DIRECT_CHAT_V2',
  'COTI_EPOCH_SEED_RAND128',
  'AES_GCM_EVENT_MESSAGES',
  'RANDOM_UNIQUE_MESSAGE_NONCES',
  'STABLE_CONVERSATION_MESSAGE_IDS',
  'REACTION_AUTHORIZATION',
  'DIRECT_WALLET_AUTHORITY',
  'PULL_NATIVE_CREDITS'
] as const;

export const DIRECT_CHAT_V2_PROFILE_SYNC_FEATURES = [
  'ONCHAIN_WALLET_NICKNAMES',
  'PARTICIPANT_CONVERSATION_INDEX',
  'COTI_PRIVATE_CONTACT_SETTINGS'
] as const;

export const DIRECT_CHAT_V2_NICKNAME_MAX_BYTES = 32;
export const DIRECT_CHAT_V2_MAX_CONVERSATION_PAGE_SIZE = 50;
export const DIRECT_CHAT_V2_MAX_CONTACT_SETTINGS_CELLS = 5;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const PUBLIC_RECEIPT_POLL_MS = 1_500;
const PUBLIC_RECEIPT_TIMEOUT_MS = 180_000;
const MESSAGE_HINT_POLL_MS = 4_000;

declare const DIRECT_CHAT_V2_METAMASK_CAPABILITY_BRAND: unique symbol;

/**
 * Opaque application-session binding issued only for the wallet layer's exact
 * lease-guarded COTI BrowserProvider and signer. This is not cryptographic
 * proof that an injected provider was produced by MetaMask; wallet discovery
 * and provider selection remain wallet-layer responsibilities.
 */
export type DirectChatV2MetaMaskCapability = Readonly<{
  readonly [DIRECT_CHAT_V2_METAMASK_CAPABILITY_BRAND]: true;
}>;

export type DirectChatV2CapabilityAssertion = () => Promise<void>;

type DirectChatV2MetaMaskCapabilityBinding = Readonly<{
  assertCurrent: DirectChatV2CapabilityAssertion;
  assertSnapshotCurrent?: () => void;
  browserProvider: BrowserProvider;
  readProvider: CotiReadProvider | BrowserProvider;
  chainId: bigint;
  ownerAddress: string;
  signer: JsonRpcSigner;
}>;

const DIRECT_CHAT_V2_METAMASK_CAPABILITIES = new WeakMap<
  DirectChatV2MetaMaskCapability,
  DirectChatV2MetaMaskCapabilityBinding
>();
const VERIFIED_DIRECT_CHAT_V2_DEPLOYMENTS = new WeakSet<object>();
const VERIFIED_DIRECT_CHAT_V2_PROFILE_SYNC = new WeakMap<object, boolean>();

export type DirectChatV2DeploymentManifest = {
  chainId: bigint;
  contractAddress: string;
  deploymentBlock: bigint;
  runtimeBytecodeHash: string;
};

export type VerifiedDirectChatV2Deployment = Readonly<DirectChatV2DeploymentManifest>;

export type DirectChatV2Transaction = {
  txHash: string;
  wait: () => Promise<unknown>;
};

export type DirectChatV2MessageEvent = {
  protocol: 'direct-v2';
  key: string;
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  messageId: bigint;
  epoch: bigint;
  senderSequence: bigint;
  sender: string;
  recipient: string;
  nonce: string;
  aadHash: string;
  ciphertext: string;
  valueSent: bigint;
  feeTaken: bigint;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
  removed: boolean;
  context: DirectChatV2MessageContext;
  encrypted: DirectChatV2EncryptedMessage;
};

export type DirectChatV2ConversationCreatedEvent = Readonly<{
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  participantA: string;
  participantB: string;
  createdBy: string;
  epoch: bigint;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
}>;

export type DirectChatV2ExpectedMessageReceipt = {
  transactionHash: string;
  context: DirectChatV2MessageContext;
  encrypted: DirectChatV2EncryptedMessage;
};

export type DirectChatV2EpochReference = {
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  epoch: bigint;
};

export type DirectChatV2NonceAttempt = DirectChatV2EpochReference & {
  nonce: string;
  ownerAddress: string;
};

/**
 * Must durably claim `(chain, contract, conversation, epoch, nonce)` with
 * cross-tab atomic uniqueness. `ownerAddress` is public audit metadata and
 * must not partition that uniqueness key because nonces are epoch-wide.
 * Rejecting this promise aborts the send.
 * Entries may be cleaned up only after their epoch is irreversibly obsolete,
 * never merely because an attempt reverted, was dropped, or was cancelled.
 */
export type DirectChatV2NonceAttemptRetirer = (
  attempt: Readonly<DirectChatV2NonceAttempt>
) => Promise<void>;

export type DirectChatV2EpochKey = DirectChatV2Seed & DirectChatV2EpochReference;

export type DirectChatV2EpochMetadata = DirectChatV2EpochReference & {
  rotatedBy: string;
  createdAt: bigint;
};

export type DirectChatV2ConversationSnapshot = {
  exists: true;
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  participantA: string;
  participantB: string;
  currentEpoch: bigint;
  messageCount: bigint;
  createdAt: bigint;
  lastMessageAt: bigint;
  createdBlock: bigint;
  firstMessageBlock: bigint;
  lastMessageBlock: bigint;
};

export type DirectChatV2ConversationLookup =
  | DirectChatV2ConversationSnapshot
  | {
      exists: false;
      chainId: bigint;
      contractAddress: string;
      conversationId: string;
    };

export type DirectChatV2CanonicalBlock = {
  number: bigint;
  hash: string;
  timestamp: number;
};

export type DirectChatV2ConversationPreview = Readonly<{
  conversationId: string;
  peer: string;
  currentEpoch: bigint;
  messageCount: bigint;
  createdAt: bigint;
  lastMessageAt: bigint;
  createdBlock: bigint;
  firstMessageBlock: bigint;
  lastMessageBlock: bigint;
}>;

export type DirectChatV2ConversationPreviewPage = Readonly<{
  previews: readonly DirectChatV2ConversationPreview[];
  nextBeforeIndex: bigint;
}>;

export type DirectChatV2ContactSettings = Readonly<{
  savedName: string;
  hidden: boolean;
}>;

export type DirectChatV2ContactSettingsSnapshot = Readonly<{
  exists: boolean;
  revision: bigint;
  settings: DirectChatV2ContactSettings;
}>;

export type DirectChatV2EncryptedContactSettings = readonly [
  readonly [readonly bigint[]],
  readonly string[]
];

const normalizeUint64 = (value: unknown, label: string): bigint => {
  const parsed = normalizeUint256(value, label);
  if (parsed === 0n || parsed > UINT64_MAX) {
    throw new Error(`${label} must be a non-zero uint64 value.`);
  }
  return parsed;
};

const normalizeUint128 = (value: unknown, label: string): bigint => {
  const parsed = normalizeUint256(value, label);
  if (parsed > UINT128_MAX) {
    throw new Error(`${label} must be a uint128 value.`);
  }
  return parsed;
};

const normalizeContactSettingsRevision = (value: unknown): bigint => {
  const parsed = normalizeUint256(value, 'Contact settings revision');
  if (parsed > UINT64_MAX) {
    throw new Error('Contact settings revision must be a uint64 value.');
  }
  return parsed;
};

const normalizeUint256 = (value: unknown, label: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} is not an integer.`);
  }
  if (parsed < 0n || parsed > UINT256_MAX) {
    throw new Error(`${label} must be a uint256 value.`);
  }
  return parsed;
};

const normalizeAddress = (value: string, label: string): string => {
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error(`${label} is not a valid wallet address.`);
  }
};

export const normalizeDirectChatV2Nickname = (value: string): string => {
  if (typeof value !== 'string') {
    throw new Error('Public name must be text.');
  }
  if (value.length > DIRECT_CHAT_V2_NICKNAME_MAX_BYTES) {
    throw new Error(`Public name must be at most ${DIRECT_CHAT_V2_NICKNAME_MAX_BYTES} ASCII characters.`);
  }
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  const normalized = value.slice(start, end);
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (
      code < 0x20 ||
      code > 0x7e ||
      code === 0x22 ||
      code === 0x26 ||
      code === 0x27 ||
      code === 0x3c ||
      code === 0x3e ||
      code === 0x5c
    ) {
      throw new Error('Public name contains an unsupported character.');
    }
  }
  return normalized;
};

const normalizeBytes32 = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized;
};

const normalizeBytes12 = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{24}$/.test(normalized) || normalized === `0x${'00'.repeat(12)}`) {
    throw new Error(`${label} must be a non-zero 12-byte hex value.`);
  }
  return normalized;
};

const normalizeCiphertext = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})*$/.test(normalized)) {
    throw new Error('Message ciphertext must be canonical hex bytes.');
  }
  const byteLength = (normalized.length - 2) / 2;
  if (
    byteLength < DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    byteLength > DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Message ciphertext length is outside the Chat V2 bounds.');
  }
  return normalized;
};

const requireDirectChatV2MetaMaskCapabilityBinding = (
  capability: DirectChatV2MetaMaskCapability
): DirectChatV2MetaMaskCapabilityBinding => {
  const binding = capability && DIRECT_CHAT_V2_METAMASK_CAPABILITIES.get(capability);
  if (!binding) {
    throw new Error('ChainWhisperChatV2 requires a current owner browser-wallet session capability.');
  }
  return binding;
};

const assertDirectChatV2CapabilityBindingCurrent = async (
  binding: DirectChatV2MetaMaskCapabilityBinding
): Promise<void> => {
  if (
    !(binding.browserProvider instanceof BrowserProvider) ||
    binding.signer.provider !== binding.browserProvider
  ) {
    throw new Error('Chat V2 owner capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertCurrent();
};

const resolveDirectChatV2MetaMaskCapability = async (
  capability: DirectChatV2MetaMaskCapability
): Promise<DirectChatV2MetaMaskCapabilityBinding> => {
  const binding = requireDirectChatV2MetaMaskCapabilityBinding(capability);
  await assertDirectChatV2CapabilityBindingCurrent(binding);
  return binding;
};

const resolveDirectChatV2SnapshotCapability = (
  capability: DirectChatV2MetaMaskCapability
): DirectChatV2MetaMaskCapabilityBinding => {
  const binding = requireDirectChatV2MetaMaskCapabilityBinding(capability);
  if (binding.assertSnapshotCurrent) binding.assertSnapshotCurrent();
  return binding;
};

const assertDirectChatV2SnapshotCapability = async (
  capability: DirectChatV2MetaMaskCapability
): Promise<DirectChatV2MetaMaskCapabilityBinding> => {
  const binding = requireDirectChatV2MetaMaskCapabilityBinding(capability);
  if (binding.assertSnapshotCurrent) binding.assertSnapshotCurrent();
  else await assertDirectChatV2CapabilityBindingCurrent(binding);
  return binding;
};

const resolveDirectChatV2ReadCapability = (
  capability: DirectChatV2MetaMaskCapability
): DirectChatV2MetaMaskCapabilityBinding =>
  requireDirectChatV2MetaMaskCapabilityBinding(capability);

export const bindDirectChatV2MetaMaskCapability = async ({
  signer,
  browserProvider,
  readProvider = browserProvider,
  ownerAddress,
  chainId,
  assertCurrent,
  assertSnapshotCurrent
}: {
  signer: JsonRpcSigner;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider | BrowserProvider;
  ownerAddress: string;
  chainId: bigint;
  assertCurrent: DirectChatV2CapabilityAssertion;
  assertSnapshotCurrent?: () => void;
}): Promise<DirectChatV2MetaMaskCapability> => {
  const candidate = signer as JsonRpcSigner & {
    privateKey?: unknown;
    sendUncheckedTransaction?: unknown;
  };
  if (
    !(browserProvider instanceof BrowserProvider) ||
    !candidate ||
    candidate.provider !== browserProvider ||
    typeof candidate.getAddress !== 'function' ||
    typeof candidate.sendUncheckedTransaction !== 'function' ||
    typeof candidate.getUserOnboardInfo !== 'function' ||
    typeof assertCurrent !== 'function' ||
    (assertSnapshotCurrent !== undefined && typeof assertSnapshotCurrent !== 'function') ||
    'privateKey' in candidate
  ) {
    throw new Error(
      'ChainWhisperChatV2 requires the owner signer from the exact COTI BrowserProvider session.'
    );
  }
  const normalizedOwnerAddress = normalizeAddress(ownerAddress, 'Expected Chat V2 owner');
  const normalizedChainId = normalizeUint256(chainId, 'Expected Chat V2 chain ID');
  if (normalizedChainId === 0n) {
    throw new Error('Expected Chat V2 chain ID cannot be zero.');
  }
  const hasIndependentReadProvider = readProvider !== browserProvider;
  const connectedAddress = hasIndependentReadProvider && assertSnapshotCurrent
    ? normalizedOwnerAddress
    : normalizeAddress(await candidate.getAddress(), 'Connected owner signer');
  const connectedChainId = hasIndependentReadProvider && assertSnapshotCurrent
    ? normalizedChainId
    : normalizeUint256((await browserProvider.getNetwork()).chainId, 'Connected owner chain ID');
  if (assertSnapshotCurrent) assertSnapshotCurrent();
  else await assertCurrent();
  if (
    connectedAddress.toLowerCase() !== normalizedOwnerAddress.toLowerCase() ||
    connectedChainId !== normalizedChainId
  ) {
    throw new Error('Chat V2 owner capability account or chain changed.');
  }
  const binding = Object.freeze({
    assertCurrent,
    assertSnapshotCurrent,
    browserProvider,
    readProvider,
    chainId: normalizedChainId,
    ownerAddress: normalizedOwnerAddress,
    signer: candidate
  });
  const capability = Object.freeze({}) as DirectChatV2MetaMaskCapability;
  DIRECT_CHAT_V2_METAMASK_CAPABILITIES.set(capability, binding);
  return capability;
};

/** Stops the capability's BrowserProvider polling when its wallet session is retired. */
export const releaseDirectChatV2MetaMaskCapability = (
  capability: DirectChatV2MetaMaskCapability
): void => {
  const binding = DIRECT_CHAT_V2_METAMASK_CAPABILITIES.get(capability);
  if (!binding) return;
  DIRECT_CHAT_V2_METAMASK_CAPABILITIES.delete(capability);
};

export const assertDirectChatV2MetaMaskCapabilityCurrent = async ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: DirectChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): Promise<void> => {
  const binding = requireDirectChatV2MetaMaskCapabilityBinding(capability);
  const expectedOwner = normalizeAddress(ownerAddress, 'Expected Chat V2 owner');
  const expectedChainId = normalizeUint256(chainId, 'Expected Chat V2 chain ID');
  if (
    binding.ownerAddress.toLowerCase() !== expectedOwner.toLowerCase() ||
    binding.chainId !== expectedChainId
  ) {
    throw new Error('Chat V2 owner capability belongs to a different account or chain.');
  }
  await assertDirectChatV2CapabilityBindingCurrent(binding);
};

/** Uses the event-backed immutable lease without issuing an extension RPC. */
export const assertDirectChatV2MetaMaskCapabilitySnapshotCurrent = ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: DirectChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): Promise<void> => {
  const binding = requireDirectChatV2MetaMaskCapabilityBinding(capability);
  const expectedOwner = normalizeAddress(ownerAddress, 'Expected Chat V2 owner');
  const expectedChainId = normalizeUint256(chainId, 'Expected Chat V2 chain ID');
  if (
    binding.ownerAddress.toLowerCase() !== expectedOwner.toLowerCase() ||
    binding.chainId !== expectedChainId
  ) {
    return Promise.reject(new Error('Chat V2 owner capability belongs to a different account or chain.'));
  }
  return assertDirectChatV2SnapshotCapability(capability).then(() => undefined);
};

/**
 * Verifies the immutable account/chain scope without touching the injected
 * provider. Public history polling must not keep MetaMask's transport alive.
 */
export const assertDirectChatV2MetaMaskCapabilityScope = ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: DirectChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): void => {
  const binding = resolveDirectChatV2ReadCapability(capability);
  const expectedOwner = normalizeAddress(ownerAddress, 'Expected Chat V2 owner');
  const expectedChainId = normalizeUint256(chainId, 'Expected Chat V2 chain ID');
  if (
    binding.ownerAddress.toLowerCase() !== expectedOwner.toLowerCase() ||
    binding.chainId !== expectedChainId
  ) {
    throw new Error('Chat V2 owner capability belongs to a different account or chain.');
  }
};

export const signDirectChatV2ImageSessionAuthorization = async ({
  capability,
  message
}: {
  capability: DirectChatV2MetaMaskCapability;
  message: string;
}): Promise<string> => {
  const binding = await resolveDirectChatV2MetaMaskCapability(capability);
  const lines = typeof message === 'string' && !message.includes('\r') ? message.split('\n') : [];
  const expectedChain = `chainId:0x${binding.chainId.toString(16)}`;
  const expectedOwner = `owner:${binding.ownerAddress.toLowerCase()}`;
  if (
    lines.length !== 8 ||
    lines[0] !== 'ChainWhisper Chat Image Upload Session' ||
    lines[1] !== 'version:1' ||
    !/^audience:https:\/\/[^\s]+\/functions\/v1\/chat-image-session$/u.test(lines[2]) ||
    lines[3] !== expectedChain ||
    lines[4] !== expectedOwner ||
    !/^nonce:[a-f0-9]{64}$/u.test(lines[5]) ||
    !/^issuedAt:[1-9][0-9]*$/u.test(lines[6]) ||
    !/^expiresAt:[1-9][0-9]*$/u.test(lines[7]) ||
    message.length > 1_024
  ) {
    throw new Error('Chat V2 refused a malformed image-session authorization.');
  }
  const signature = await binding.signer.signMessage(message);
  await assertDirectChatV2SnapshotCapability(capability);
  if (typeof signature !== 'string' || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/u.test(signature)) {
    throw new Error('Chat V2 image-session authorization returned an invalid signature.');
  }
  return signature;
};

const requireVerifiedDeployment = (
  deployment: VerifiedDirectChatV2Deployment
): VerifiedDirectChatV2Deployment => {
  if (!deployment || !VERIFIED_DIRECT_CHAT_V2_DEPLOYMENTS.has(deployment)) {
    throw new Error('Verify the exact ChainWhisperChatV2 deployment manifest before using chat.');
  }
  return deployment;
};

const tupleField = (value: unknown, name: string, index: number): unknown => {
  if (value && typeof value === 'object') {
    const record = value as Record<string | number, unknown>;
    return record[name] ?? record[index];
  }
  return undefined;
};

const signerAddress = async (
  capability: DirectChatV2MetaMaskCapability
): Promise<string> => resolveDirectChatV2ReadCapability(capability).ownerAddress;

const toTransaction = (
  value: unknown,
  capability: DirectChatV2MetaMaskCapability
): DirectChatV2Transaction => {
  const transaction = value as { hash?: unknown; wait?: () => Promise<unknown> };
  if (typeof transaction.hash !== 'string' || typeof transaction.wait !== 'function') {
    throw new Error('COTI did not return a waitable chat transaction.');
  }
  const transactionHash = transaction.hash;
  const nativeWait = transaction.wait.bind(transaction);
  const { browserProvider, readProvider } = resolveDirectChatV2ReadCapability(capability);
  return {
    txHash: transactionHash,
    wait: readProvider === browserProvider
      ? nativeWait
      : async () => {
          const deadline = Date.now() + PUBLIC_RECEIPT_TIMEOUT_MS;
          while (Date.now() < deadline) {
            try {
              const receipt = await readProvider.getTransactionReceipt(transactionHash);
              if (receipt) return receipt;
            } catch {
              // Public RPC failures are retried without falling back to MetaMask.
            }
            await new Promise<void>((resolve) => {
              globalThis.setTimeout(resolve, PUBLIC_RECEIPT_POLL_MS);
            });
          }
          throw new Error(
            'The chat transaction was submitted, but COTI confirmation timed out. Check wallet activity before retrying.'
          );
        }
  };
};

const loadContract = async (
  contractAddress: string,
  capability: DirectChatV2MetaMaskCapability
) => {
  const { signer } = resolveDirectChatV2SnapshotCapability(capability);
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(contractAddress, DIRECT_CHAT_V2_ABI, signer);
};

const loadReadContract = async (
  contractAddress: string,
  capability: DirectChatV2MetaMaskCapability
) => {
  const { readProvider } = resolveDirectChatV2ReadCapability(capability);
  const cotiEthers = await loadCotiEthersModule();
  resolveDirectChatV2ReadCapability(capability);
  return new cotiEthers.Contract(contractAddress, DIRECT_CHAT_V2_ABI, readProvider);
};

export const verifyDirectChatV2Contract = async ({
  capability,
  manifest
}: {
  capability: DirectChatV2MetaMaskCapability;
  manifest: DirectChatV2DeploymentManifest;
}): Promise<VerifiedDirectChatV2Deployment> => {
  const { readProvider, chainId } = resolveDirectChatV2ReadCapability(capability);
  const target = normalizeAddress(manifest.contractAddress, 'Chat contract');
  const expectedChainId = normalizeUint256(manifest.chainId, 'Manifest chain ID');
  if (expectedChainId === 0n) {
    throw new Error('Manifest chain ID cannot be zero.');
  }
  const expectedDeploymentBlock = normalizeUint64(manifest.deploymentBlock, 'Manifest deployment block');
  const expectedRuntimeBytecodeHash = normalizeBytes32(
    manifest.runtimeBytecodeHash,
    'Manifest runtime bytecode hash'
  );
  const runtimeBytecode = await readProvider.getCode(target);
  if (runtimeBytecode === '0x') {
    throw new Error('The configured V2 chat address has no deployed contract.');
  }
  if (chainId !== expectedChainId) {
    throw new Error('Connected COTI chain does not match the Chat V2 deployment manifest.');
  }
  if (keccak256(runtimeBytecode).toLowerCase() !== expectedRuntimeBytecodeHash) {
    throw new Error('Chat V2 runtime bytecode does not match the trusted deployment manifest.');
  }
  const contract = await loadReadContract(target, capability);
  // Do not enqueue a full feature batch ahead of other App initializers.
  const [version, protocol, minimum, maximum, deploymentBlock] = [
    await contract.contractVersion(),
    await contract.PROTOCOL_VERSION(),
    await contract.MIN_MESSAGE_CIPHERTEXT_BYTES(),
    await contract.MAX_MESSAGE_CIPHERTEXT_BYTES(),
    await contract.deploymentBlock()
  ] as const;
  const featureSupport: boolean[] = [];
  for (const feature of DIRECT_CHAT_V2_REQUIRED_FEATURES) {
    featureSupport.push(await contract.supportsFeature(keccak256(toUtf8Bytes(feature))));
  }
  const profileSyncFeatureSupport: boolean[] = [];
  for (const feature of DIRECT_CHAT_V2_PROFILE_SYNC_FEATURES) {
    profileSyncFeatureSupport.push(await contract.supportsFeature(keccak256(toUtf8Bytes(feature))));
  }
  const appWalletSupport = await contract.supportsFeature(keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')));
  if (String(version) !== 'ChainWhisperChatV2' || BigInt(protocol) !== 2n) {
    throw new Error('Configured chat contract is not ChainWhisperChatV2 protocol 2.');
  }
  if (BigInt(minimum) !== 16n || BigInt(maximum) !== 4_096n || featureSupport.some((supported) => !supported)) {
    throw new Error('Configured chat contract does not expose the required V2 feature surface.');
  }
  if (appWalletSupport) {
    throw new Error('Refusing a V2 chat contract that advertises app-wallet execution.');
  }
  const hasProfileSync = profileSyncFeatureSupport.every(Boolean);
  if (hasProfileSync) {
    const [nicknameMaximum, pageMaximum, settingsMaximum] = [
      await contract.NICKNAME_MAX_BYTES(),
      await contract.MAX_CONVERSATION_PAGE_SIZE(),
      await contract.MAX_CONTACT_SETTINGS_CELLS()
    ] as const;
    if (
      BigInt(nicknameMaximum) !== BigInt(DIRECT_CHAT_V2_NICKNAME_MAX_BYTES) ||
      BigInt(pageMaximum) !== BigInt(DIRECT_CHAT_V2_MAX_CONVERSATION_PAGE_SIZE) ||
      BigInt(settingsMaximum) !== BigInt(DIRECT_CHAT_V2_MAX_CONTACT_SETTINGS_CELLS)
    ) {
      throw new Error('Configured chat contract exposes incompatible profile or sync bounds.');
    }
  } else if (profileSyncFeatureSupport.some(Boolean)) {
    throw new Error('Configured chat contract exposes only part of the profile and sync feature surface.');
  }
  resolveDirectChatV2ReadCapability(capability);
  const verifiedDeployment = Object.freeze({
    chainId,
    contractAddress: target,
    deploymentBlock: normalizeUint64(deploymentBlock, 'Chat deployment block'),
    runtimeBytecodeHash: expectedRuntimeBytecodeHash
  });
  if (verifiedDeployment.deploymentBlock !== expectedDeploymentBlock) {
    throw new Error('Chat V2 deployment block does not match the trusted manifest.');
  }
  VERIFIED_DIRECT_CHAT_V2_DEPLOYMENTS.add(verifiedDeployment);
  VERIFIED_DIRECT_CHAT_V2_PROFILE_SYNC.set(verifiedDeployment, hasProfileSync);
  return verifiedDeployment;
};

export const supportsDirectChatV2ProfileSync = (
  deployment: VerifiedDirectChatV2Deployment
): boolean => {
  requireVerifiedDeployment(deployment);
  return VERIFIED_DIRECT_CHAT_V2_PROFILE_SYNC.get(deployment) === true;
};

const requireDirectChatV2ProfileSync = (
  deployment: VerifiedDirectChatV2Deployment
): VerifiedDirectChatV2Deployment => {
  const verified = requireVerifiedDeployment(deployment);
  if (VERIFIED_DIRECT_CHAT_V2_PROFILE_SYNC.get(verified) !== true) {
    throw new Error('This Chat V2 deployment does not provide on-chain names and indexed conversations.');
  }
  return verified;
};

export const readDirectChatV2Nickname = async ({
  capability,
  deployment,
  account
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  account: string;
}): Promise<string> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const selectedAccount = normalizeAddress(account, 'Nickname account');
  const contract = await loadReadContract(verified.contractAddress, capability);
  const nickname = normalizeDirectChatV2Nickname(String(await contract.nicknames(selectedAccount)));
  resolveDirectChatV2ReadCapability(capability);
  return nickname;
};

export const setDirectChatV2Nickname = async ({
  capability,
  deployment,
  nickname
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  nickname: string;
}): Promise<{ nickname: string; transaction: DirectChatV2Transaction }> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = await resolveDirectChatV2MetaMaskCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const normalizedNickname = normalizeDirectChatV2Nickname(nickname);
  const contract = await loadContract(verified.contractAddress, capability);
  const submitted = await contract.setMyNickname(normalizedNickname);
  return {
    nickname: normalizedNickname,
    transaction: toTransaction(submitted, capability)
  };
};

const emptyDirectChatV2ContactSettings = (): DirectChatV2ContactSettings => Object.freeze({
  savedName: '',
  hidden: false
});

export const readDirectChatV2ContactSettings = async ({
  capability,
  deployment,
  contact
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  contact: string;
}): Promise<DirectChatV2ContactSettingsSnapshot> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const selectedContact = normalizeAddress(contact, 'Contact wallet');
  if (
    selectedContact.toLowerCase() === binding.ownerAddress.toLowerCase() ||
    selectedContact.toLowerCase() === verified.contractAddress.toLowerCase()
  ) {
    throw new Error('Contact settings require a different wallet address.');
  }
  const contract = await loadReadContract(verified.contractAddress, capability);
  const raw = await contract.getMyContactSettings(selectedContact, { from: binding.ownerAddress });
  const exists = tupleField(raw, 'exists', 0) === true;
  const revision = normalizeContactSettingsRevision(tupleField(raw, 'revision', 1));
  if (!exists) {
    resolveDirectChatV2ReadCapability(capability);
    return Object.freeze({ exists: false, revision, settings: emptyDirectChatV2ContactSettings() });
  }
  if (!binding.signer.getUserOnboardInfo()?.aesKey) {
    throw new Error('Unlock this wallet\'s COTI privacy key before reading private contact settings.');
  }
  const envelope = extractUserCiphertext(tupleField(raw, 'encryptedSettings', 2));
  if (!envelope || envelope.value.length === 0 || envelope.value.length > DIRECT_CHAT_V2_MAX_CONTACT_SETTINGS_CELLS) {
    throw new Error('Chat contract returned malformed private contact settings.');
  }
  const decrypted = await binding.signer.decryptValue(envelope as never);
  const settings = decodeDirectChatV2ContactSettings(decrypted);
  resolveDirectChatV2ReadCapability(capability);
  return Object.freeze({ exists: true, revision, settings });
};

export const setDirectChatV2ContactSettings = async ({
  capability,
  deployment,
  contact,
  expectedRevision,
  settings
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  contact: string;
  expectedRevision: bigint;
  settings: DirectChatV2ContactSettings;
}): Promise<{
  contact: string;
  expectedRevision: bigint;
  encryptedSettings: DirectChatV2EncryptedContactSettings;
  settings: DirectChatV2ContactSettings;
  transaction: DirectChatV2Transaction;
}> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = await resolveDirectChatV2MetaMaskCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const selectedContact = normalizeAddress(contact, 'Contact wallet');
  if (
    selectedContact.toLowerCase() === binding.ownerAddress.toLowerCase() ||
    selectedContact.toLowerCase() === verified.contractAddress.toLowerCase()
  ) {
    throw new Error('Contact settings require a different wallet address.');
  }
  const revision = normalizeContactSettingsRevision(expectedRevision);
  const normalized = normalizeDirectChatV2ContactSettings(settings);
  const plaintext = encodeDirectChatV2ContactSettings(normalized);
  const encrypted = await binding.signer.encryptValue(
    plaintext,
    verified.contractAddress,
    DIRECT_CHAT_V2_SET_CONTACT_SETTINGS_SELECTOR
  );
  const payload = parseSubmitMemoPayload(encrypted);
  if (
    payload.ciphertextValue.length === 0 ||
    payload.ciphertextValue.length > DIRECT_CHAT_V2_MAX_CONTACT_SETTINGS_CELLS ||
    payload.signature.length !== payload.ciphertextValue.length
  ) {
    throw new Error('COTI returned malformed encrypted contact settings.');
  }
  const encryptedSettings: DirectChatV2EncryptedContactSettings = [
    [[...payload.ciphertextValue]],
    [...payload.signature]
  ] as const;
  const contract = await loadContract(verified.contractAddress, capability);
  const submitted = await contract.setMyContactSettings(selectedContact, revision, encryptedSettings);
  return Object.freeze({
    contact: selectedContact,
    expectedRevision: revision,
    encryptedSettings,
    settings: normalized,
    transaction: toTransaction(submitted, capability)
  });
};

export const clearDirectChatV2ContactSettings = async ({
  capability,
  deployment,
  contact,
  expectedRevision
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  contact: string;
  expectedRevision: bigint;
}): Promise<{ contact: string; expectedRevision: bigint; transaction: DirectChatV2Transaction }> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = await resolveDirectChatV2MetaMaskCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const selectedContact = normalizeAddress(contact, 'Contact wallet');
  if (
    selectedContact.toLowerCase() === binding.ownerAddress.toLowerCase() ||
    selectedContact.toLowerCase() === verified.contractAddress.toLowerCase()
  ) {
    throw new Error('Contact settings require a different wallet address.');
  }
  const revision = normalizeContactSettingsRevision(expectedRevision);
  const contract = await loadContract(verified.contractAddress, capability);
  const submitted = await contract.clearMyContactSettings(selectedContact, revision);
  return Object.freeze({
    contact: selectedContact,
    expectedRevision: revision,
    transaction: toTransaction(submitted, capability)
  });
};

export const readDirectChatV2ConversationPreviewPage = async ({
  capability,
  deployment,
  beforeIndexExclusive = UINT256_MAX,
  limit = BigInt(DIRECT_CHAT_V2_MAX_CONVERSATION_PAGE_SIZE)
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  beforeIndexExclusive?: bigint;
  limit?: bigint;
}): Promise<DirectChatV2ConversationPreviewPage> => {
  const verified = requireDirectChatV2ProfileSync(deployment);
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verified.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const cursor = normalizeUint256(beforeIndexExclusive, 'Conversation page cursor');
  const pageLimit = normalizeUint256(limit, 'Conversation page limit');
  if (pageLimit === 0n || pageLimit > BigInt(DIRECT_CHAT_V2_MAX_CONVERSATION_PAGE_SIZE)) {
    throw new Error(`Conversation page limit must be between 1 and ${DIRECT_CHAT_V2_MAX_CONVERSATION_PAGE_SIZE}.`);
  }
  const contract = await loadReadContract(verified.contractAddress, capability);
  const raw = await contract.getParticipantConversationPage(binding.ownerAddress, cursor, pageLimit);
  const rawPreviews = tupleField(raw, 'previews', 0);
  if (!Array.isArray(rawPreviews) || rawPreviews.length > Number(pageLimit)) {
    throw new Error('Chat contract returned an invalid conversation preview page.');
  }
  const seen = new Set<string>();
  const previews = rawPreviews.map((value, index) => {
    const peer = normalizeAddress(String(tupleField(value, 'peer', 1)), `Conversation peer ${index + 1}`);
    if (peer.toLowerCase() === binding.ownerAddress.toLowerCase()) {
      throw new Error('Chat contract returned the owner as their own conversation peer.');
    }
    const conversationId = normalizeBytes32(
      String(tupleField(value, 'conversationId', 0)),
      `Conversation ID ${index + 1}`
    );
    const expectedConversationId = deriveDirectChatV2ConversationId({
      chainId: verified.chainId,
      contractAddress: verified.contractAddress,
      participantA: binding.ownerAddress,
      participantB: peer
    });
    if (conversationId !== expectedConversationId.toLowerCase() || seen.has(conversationId)) {
      throw new Error('Chat contract returned a mismatched or duplicate conversation preview.');
    }
    seen.add(conversationId);
    return Object.freeze({
      conversationId,
      peer,
      currentEpoch: normalizeUint64(tupleField(value, 'currentEpoch', 2), 'Conversation preview epoch'),
      messageCount: normalizeUint256(tupleField(value, 'messageCount', 3), 'Conversation preview message count'),
      createdAt: normalizeUint256(tupleField(value, 'createdAt', 4), 'Conversation preview creation time'),
      lastMessageAt: normalizeUint256(tupleField(value, 'lastMessageAt', 5), 'Conversation preview last message time'),
      createdBlock: normalizeUint256(tupleField(value, 'createdBlock', 6), 'Conversation preview creation block'),
      firstMessageBlock: normalizeUint256(tupleField(value, 'firstMessageBlock', 7), 'Conversation preview first message block'),
      lastMessageBlock: normalizeUint256(tupleField(value, 'lastMessageBlock', 8), 'Conversation preview last message block')
    });
  });
  const nextBeforeIndex = normalizeUint256(
    tupleField(raw, 'nextBeforeIndex', 1),
    'Next conversation page cursor'
  );
  if (nextBeforeIndex > cursor && cursor !== UINT256_MAX) {
    throw new Error('Chat contract returned a conversation cursor that moved forward.');
  }
  resolveDirectChatV2ReadCapability(capability);
  return Object.freeze({ previews: Object.freeze(previews), nextBeforeIndex });
};

export const decryptDirectChatV2SeedEnvelope = async ({
  capability,
  seedCiphertext
}: {
  capability: DirectChatV2MetaMaskCapability;
  seedCiphertext: unknown;
}): Promise<DirectChatV2Seed> => {
  // Decryption is entirely local in coti-ethers once the session AES key is
  // present. Background history must not ping the injected wallet for every
  // epoch or MetaMask can be overwhelmed during the first privacy unlock.
  const { signer } = resolveDirectChatV2ReadCapability(capability);
  if (!signer.getUserOnboardInfo()?.aesKey) {
    throw new Error(
      'Unlock or recover this wallet\'s COTI privacy key before reading the conversation key.'
    );
  }
  const seed = {
    value: normalizeUint128(
    await signer.decryptValue(normalizeUint256(seedCiphertext, 'Conversation seed envelope')),
    'Decrypted conversation seed'
    )
  };
  return seed;
};

export const readDirectChatV2Conversation = async ({
  capability,
  deployment,
  peer,
  blockTag
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  blockTag?: bigint;
}): Promise<DirectChatV2ConversationLookup> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const target = verifiedDeployment.contractAddress;
  const binding = resolveDirectChatV2ReadCapability(capability);
  const account = binding.ownerAddress;
  const normalizedPeer = normalizeAddress(peer, 'Chat peer');
  if (account.toLowerCase() === normalizedPeer.toLowerCase()) {
    throw new Error('Direct chat requires a different peer wallet.');
  }
  if (target.toLowerCase() === normalizedPeer.toLowerCase()) {
    throw new Error('The chat contract cannot be used as a peer wallet.');
  }
  const chainId = binding.chainId;
  if (chainId !== verifiedDeployment.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const localConversationId = deriveDirectChatV2ConversationId({
    chainId,
    contractAddress: target,
    participantA: account,
    participantB: normalizedPeer
  });
  const contract = await loadReadContract(target, capability);
  const normalizedBlockTag = blockTag === undefined
    ? undefined
    : normalizeUint256(blockTag, 'Conversation read block');
  if (
    normalizedBlockTag !== undefined &&
    (normalizedBlockTag < verifiedDeployment.deploymentBlock || normalizedBlockTag > BigInt(Number.MAX_SAFE_INTEGER))
  ) {
    throw new Error('Conversation read block is outside the verified deployment range.');
  }
  const readOverrides = normalizedBlockTag === undefined
    ? undefined
    : { blockTag: Number(normalizedBlockTag) };
  const chainConversationId = String(readOverrides
    ? await contract.conversationIdFor(account, normalizedPeer, readOverrides)
    : await contract.conversationIdFor(account, normalizedPeer)).toLowerCase();
  if (chainConversationId !== localConversationId) {
    throw new Error('Chat contract conversation domain does not match the V2 client.');
  }
  const isParticipant = readOverrides
    ? await contract.isParticipant(localConversationId, account, readOverrides)
    : await contract.isParticipant(localConversationId, account);
  if (!isParticipant) {
    resolveDirectChatV2ReadCapability(capability);
    return {
      exists: false,
      chainId,
      contractAddress: target,
      conversationId: localConversationId
    };
  }

  const raw = readOverrides
    ? await contract.getConversation(localConversationId, readOverrides)
    : await contract.getConversation(localConversationId);
  const participantA = normalizeAddress(String(tupleField(raw, 'participantA', 1)), 'Conversation participant A');
  const participantB = normalizeAddress(String(tupleField(raw, 'participantB', 2)), 'Conversation participant B');
  const expectedParticipants = [account.toLowerCase(), normalizedPeer.toLowerCase()].sort();
  if (
    participantA.toLowerCase() !== expectedParticipants[0] ||
    participantB.toLowerCase() !== expectedParticipants[1]
  ) {
    throw new Error('Chat contract returned a conversation for a different wallet pair.');
  }

  const snapshot = {
    exists: true,
    chainId,
    contractAddress: target,
    conversationId: localConversationId,
    participantA,
    participantB,
    currentEpoch: normalizeUint64(tupleField(raw, 'currentEpoch', 3), 'Conversation epoch'),
    messageCount: normalizeUint256(tupleField(raw, 'messageCount', 4), 'Conversation message count'),
    createdAt: normalizeUint256(tupleField(raw, 'createdAt', 5), 'Conversation creation time'),
    lastMessageAt: normalizeUint256(tupleField(raw, 'lastMessageAt', 6), 'Conversation last message time'),
    createdBlock: normalizeUint256(tupleField(raw, 'createdBlock', 7), 'Conversation creation block'),
    firstMessageBlock: normalizeUint256(tupleField(raw, 'firstMessageBlock', 8), 'Conversation first message block'),
    lastMessageBlock: normalizeUint256(tupleField(raw, 'lastMessageBlock', 9), 'Conversation last message block')
  } satisfies DirectChatV2ConversationSnapshot;
  resolveDirectChatV2ReadCapability(capability);
  return snapshot;
};

export const readDirectChatV2LatestBlockNumber = async ({
  capability,
  deployment
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
}): Promise<bigint> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verifiedDeployment.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const latestBlockNumber = await binding.readProvider.getBlockNumber();
  if (!Number.isSafeInteger(latestBlockNumber) || latestBlockNumber < 0) {
    throw new Error('COTI returned an invalid latest block number for Chat V2.');
  }
  resolveDirectChatV2ReadCapability(capability);
  return BigInt(latestBlockNumber);
};

export const readDirectChatV2CanonicalBlock = async ({
  capability,
  deployment,
  blockNumber
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  blockNumber: bigint;
}): Promise<DirectChatV2CanonicalBlock | null> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const selectedBlockNumber = normalizeUint256(blockNumber, 'Canonical Chat V2 block number');
  if (selectedBlockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Canonical Chat V2 block number is not safely representable by the provider.');
  }
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verifiedDeployment.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const block = await binding.readProvider.getBlock(Number(selectedBlockNumber));
  resolveDirectChatV2ReadCapability(capability);
  if (!block) return null;
  const observedBlockNumber = normalizeUint256(block.number, 'Canonical Chat V2 block number');
  if (observedBlockNumber !== selectedBlockNumber) {
    throw new Error('COTI returned the wrong canonical block for Chat V2.');
  }
  if (!Number.isSafeInteger(block.timestamp) || block.timestamp < 0) {
    throw new Error('COTI returned an invalid canonical block timestamp for Chat V2.');
  }
  return {
    number: observedBlockNumber,
    hash: normalizeBytes32(String(block.hash ?? ''), 'Canonical Chat V2 block hash'),
    timestamp: block.timestamp
  };
};

export const readDirectChatV2ConversationMessageCountAtBlock = async ({
  capability,
  deployment,
  peer,
  blockNumber
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  blockNumber: bigint;
}): Promise<bigint> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const selectedBlockNumber = normalizeUint256(blockNumber, 'Historical Chat V2 block number');
  if (
    selectedBlockNumber < verifiedDeployment.deploymentBlock ||
    selectedBlockNumber > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error('Historical Chat V2 block must be within the verified deployment history.');
  }
  // COTI testnet does not reliably serve historical eth_call state. Use the
  // current snapshot when it is fully inside the selected range; otherwise
  // derive the safe count from canonical MessagePosted logs. Scanning backward
  // normally needs one bounded request and lets finalized history load even
  // while a newer message is still awaiting confirmations.
  const conversation = await readDirectChatV2Conversation({
    capability,
    deployment: verifiedDeployment,
    peer
  });
  if (!conversation.exists) return 0n;
  if (conversation.messageCount === 0n || conversation.firstMessageBlock > selectedBlockNumber) {
    return 0n;
  }
  if (conversation.lastMessageBlock <= selectedBlockNumber) {
    return conversation.messageCount;
  }
  if (conversation.firstMessageBlock === 0n) {
    throw new Error('Chat contract returned an invalid first-message block.');
  }

  const lowerBound = conversation.firstMessageBlock > verifiedDeployment.deploymentBlock
    ? conversation.firstMessageBlock
    : verifiedDeployment.deploymentBlock;
  const { readProvider } = resolveDirectChatV2ReadCapability(capability);
  let pageEnd = selectedBlockNumber;
  while (pageEnd >= lowerBound) {
    const candidateStart = pageEnd >= DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN - 1n
      ? pageEnd - DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN + 1n
      : 0n;
    const pageStart = candidateStart > lowerBound ? candidateStart : lowerBound;
    const logs = await readProvider.getLogs({
      address: verifiedDeployment.contractAddress,
      fromBlock: Number(pageStart),
      toBlock: Number(pageEnd),
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, conversation.conversationId]
    });
    resolveDirectChatV2ReadCapability(capability);
    const messages = logs.map((log) => parseDirectChatV2MessagePostedLog({
      deployment: verifiedDeployment,
      log
    })).sort((left, right) => {
      if (left.blockNumber < right.blockNumber) return -1;
      if (left.blockNumber > right.blockNumber) return 1;
      return left.logIndex - right.logIndex;
    });
    let previousMessageId = 0n;
    for (const message of messages) {
      if (
        message.removed ||
        message.conversationId !== conversation.conversationId ||
        message.blockNumber < pageStart ||
        message.blockNumber > pageEnd ||
        message.messageId <= previousMessageId ||
        message.messageId > conversation.messageCount
      ) {
        throw new Error('Chat V2 historical count page is not canonical.');
      }
      previousMessageId = message.messageId;
    }
    if (messages.length > 0) {
      return messages[messages.length - 1].messageId;
    }
    if (pageStart === lowerBound) break;
    pageEnd = pageStart - 1n;
  }
  return 0n;
};

export const createDirectChatV2Conversation = async ({
  capability,
  deployment,
  peer
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
}): Promise<{ reference: DirectChatV2EpochReference; transaction: DirectChatV2Transaction }> => {
  await resolveDirectChatV2MetaMaskCapability(capability);
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (conversation.exists) {
    throw new Error('This direct-chat conversation already exists.');
  }
  const contract = await loadContract(conversation.contractAddress, capability);
  const submitted = await contract.createConversation(normalizeAddress(peer, 'Chat peer'));
  return {
    reference: {
      chainId: conversation.chainId,
      contractAddress: conversation.contractAddress,
      conversationId: conversation.conversationId,
      epoch: 1n
    },
    transaction: toTransaction(submitted, capability)
  };
};

export const rotateDirectChatV2ConversationKey = async ({
  capability,
  deployment,
  peer
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
}): Promise<{ reference: DirectChatV2EpochReference; transaction: DirectChatV2Transaction }> => {
  await resolveDirectChatV2MetaMaskCapability(capability);
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) {
    throw new Error('Create the direct-chat conversation before rotating its key.');
  }
  const nextEpoch = conversation.currentEpoch + 1n;
  if (nextEpoch > UINT64_MAX) {
    throw new Error('Direct-chat epoch limit reached.');
  }
  const contract = await loadContract(conversation.contractAddress, capability);
  const submitted = await contract.rotateConversationKey(
    conversation.conversationId,
    conversation.currentEpoch
  );
  return {
    reference: {
      chainId: conversation.chainId,
      contractAddress: conversation.contractAddress,
      conversationId: conversation.conversationId,
      epoch: nextEpoch
    },
    transaction: toTransaction(submitted, capability)
  };
};

export const refreshDirectChatV2EpochEnvelope = async ({
  capability,
  deployment,
  peer,
  epoch
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  epoch: bigint;
}): Promise<DirectChatV2Transaction> => {
  await resolveDirectChatV2MetaMaskCapability(capability);
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) {
    throw new Error('This direct-chat conversation has not been created.');
  }
  const selectedEpoch = normalizeUint64(epoch, 'Requested chat epoch');
  if (selectedEpoch > conversation.currentEpoch) {
    throw new Error('Requested chat epoch does not exist yet.');
  }
  const contract = await loadContract(conversation.contractAddress, capability);
  const submitted = await contract.refreshMyEpochEnvelope(conversation.conversationId, selectedEpoch);
  return toTransaction(submitted, capability);
};

export const readDirectChatV2EpochMetadata = async ({
  capability,
  deployment,
  peer,
  epoch
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  epoch: bigint;
}): Promise<DirectChatV2EpochMetadata> => {
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) {
    throw new Error('This direct-chat conversation has not been created.');
  }
  const selectedEpoch = normalizeUint64(epoch, 'Requested chat epoch');
  if (selectedEpoch > conversation.currentEpoch) {
    throw new Error('Requested chat epoch does not exist yet.');
  }
  const contract = await loadReadContract(conversation.contractAddress, capability);
  const raw = await contract.getEpochMetadata(conversation.conversationId, selectedEpoch);
  if (tupleField(raw, 'exists', 0) !== true) {
    throw new Error('Chat contract did not return the requested epoch metadata.');
  }
  const metadata = {
    chainId: conversation.chainId,
    contractAddress: conversation.contractAddress,
    conversationId: conversation.conversationId,
    epoch: selectedEpoch,
    rotatedBy: normalizeAddress(String(tupleField(raw, 'rotatedBy', 1)), 'Epoch rotator'),
    createdAt: normalizeUint64(tupleField(raw, 'createdAt', 2), 'Epoch creation time')
  } satisfies DirectChatV2EpochMetadata;
  resolveDirectChatV2ReadCapability(capability);
  return metadata;
};

export const readDirectChatV2EpochKey = async ({
  capability,
  deployment,
  peer,
  epoch
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  epoch?: bigint;
}): Promise<DirectChatV2EpochKey> => {
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) {
    throw new Error('This direct-chat conversation has not been created.');
  }
  const selectedEpoch = epoch === undefined
    ? conversation.currentEpoch
    : normalizeUint64(epoch, 'Requested chat epoch');
  if (selectedEpoch > conversation.currentEpoch) {
    throw new Error('Requested chat epoch does not exist yet.');
  }
  const { ownerAddress } = resolveDirectChatV2ReadCapability(capability);
  const contract = await loadReadContract(conversation.contractAddress, capability);
  const envelope = await contract.getMyEpochEnvelope(
    conversation.conversationId,
    selectedEpoch,
    { from: ownerAddress }
  );
  const seed = await decryptDirectChatV2SeedEnvelope({
    capability,
    seedCiphertext: tupleField(envelope, 'seed', 0) ?? envelope
  });
  const key = {
    ...seed,
    chainId: conversation.chainId,
    contractAddress: conversation.contractAddress,
    conversationId: conversation.conversationId,
    epoch: selectedEpoch
  } satisfies DirectChatV2EpochKey;
  return key;
};

export const canReactToDirectChatV2Message = async ({
  capability,
  deployment,
  peer,
  messageId
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  messageId: bigint;
}): Promise<boolean> => {
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) return false;
  const selectedMessageId = normalizeUint64(messageId, 'Reaction message ID');
  const actor = resolveDirectChatV2ReadCapability(capability).ownerAddress;
  const contract = await loadReadContract(conversation.contractAddress, capability);
  const allowed = Boolean(await contract.canReact(conversation.conversationId, selectedMessageId, actor));
  resolveDirectChatV2ReadCapability(capability);
  return allowed;
};

export const readDirectChatV2NativeCredit = async ({
  capability,
  deployment
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
}): Promise<bigint> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const binding = resolveDirectChatV2ReadCapability(capability);
  if (binding.chainId !== verifiedDeployment.chainId) {
    throw new Error('Connected COTI chain changed after the Chat V2 deployment was verified.');
  }
  const account = binding.ownerAddress;
  const contract = await loadReadContract(verifiedDeployment.contractAddress, capability);
  const credit = normalizeUint256(await contract.pendingNativeCredits(account), 'Pending native chat credit');
  resolveDirectChatV2ReadCapability(capability);
  return credit;
};

export const withdrawDirectChatV2NativeCredit = async ({
  capability,
  deployment
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
}): Promise<{ observedCredit: bigint; transaction: DirectChatV2Transaction }> => {
  await resolveDirectChatV2MetaMaskCapability(capability);
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const observedCredit = await readDirectChatV2NativeCredit({ capability, deployment: verifiedDeployment });
  if (observedCredit === 0n) {
    throw new Error('This wallet has no pending native Chat V2 credit to withdraw.');
  }
  const contract = await loadContract(verifiedDeployment.contractAddress, capability);
  const submitted = await contract.withdrawNativeCredit();
  return {
    observedCredit,
    transaction: toTransaction(submitted, capability)
  };
};

const assertEpochKeyMatchesConversation = (
  key: DirectChatV2EpochKey,
  conversation: DirectChatV2ConversationSnapshot
): void => {
  if (
    key.chainId !== conversation.chainId ||
    normalizeAddress(key.contractAddress, 'Epoch-key contract').toLowerCase() !== conversation.contractAddress.toLowerCase() ||
    key.conversationId.toLowerCase() !== conversation.conversationId ||
    key.epoch !== conversation.currentEpoch
  ) {
    throw new Error('The in-memory direct-chat key is stale or belongs to another conversation.');
  }
};

export const sendDirectChatV2Message = async ({
  capability,
  deployment,
  peer,
  key,
  plaintext,
  retireNonceAttempt,
  tip = 0n
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  key: DirectChatV2EpochKey;
  plaintext: string;
  retireNonceAttempt: DirectChatV2NonceAttemptRetirer;
  tip?: bigint;
}): Promise<{
  encrypted: DirectChatV2EncryptedMessage;
  context: DirectChatV2MessageContext;
  transaction: DirectChatV2Transaction;
}> => {
  // The selected wallet/session was already attested when this capability was
  // issued. Avoid extension RPC reads during message preparation; the guarded
  // provider performs the live lease check immediately before eth_sendTransaction.
  resolveDirectChatV2SnapshotCapability(capability);
  const conversation = await readDirectChatV2Conversation({ capability, deployment, peer });
  if (!conversation.exists) {
    throw new Error('Create the direct-chat conversation before sending a message.');
  }
  assertEpochKeyMatchesConversation(key, conversation);
  const normalizedTip = normalizeUint256(tip, 'Message tip');
  const sender = await signerAddress(capability);
  const recipient = sender.toLowerCase() === conversation.participantA.toLowerCase()
    ? conversation.participantB
    : conversation.participantA;
  const readContract = await loadReadContract(conversation.contractAddress, capability);
  const [sequenceRaw, feeRaw] = await Promise.all([
    readContract.nextSenderSequence(conversation.conversationId, conversation.currentEpoch, sender),
    readContract.messageFee()
  ]);
  const senderSequence = normalizeUint64(sequenceRaw, 'Next sender sequence');
  const feeTaken = normalizeUint256(feeRaw, 'Message fee');
  const valueSent = feeTaken + normalizedTip;
  if (valueSent > UINT256_MAX) {
    throw new Error('Message fee and tip exceed uint256.');
  }
  const context = {
    chainId: conversation.chainId,
    contractAddress: conversation.contractAddress,
    conversationId: conversation.conversationId,
    epoch: conversation.currentEpoch,
    participantA: conversation.participantA,
    participantB: conversation.participantB,
    sender,
    recipient,
    senderSequence,
    valueSent,
    feeTaken
  } satisfies DirectChatV2MessageContext;
  const encrypted = await encryptDirectChatV2Message(plaintext, key, context);
  await retireNonceAttempt(Object.freeze({
    chainId: conversation.chainId,
    contractAddress: conversation.contractAddress,
    conversationId: conversation.conversationId,
    epoch: conversation.currentEpoch,
    nonce: encrypted.nonce,
    ownerAddress: sender
  }));
  const [nonceAlreadyUsed, contractAadHash] = await Promise.all([
    readContract.isMessageNonceUsed(
      conversation.conversationId,
      conversation.currentEpoch,
      encrypted.nonce
    ),
    readContract.deriveMessageAadHash(
      conversation.conversationId,
      conversation.currentEpoch,
      sender,
      recipient,
      senderSequence,
      encrypted.nonce,
      valueSent,
      feeTaken
    )
  ]);
  if (nonceAlreadyUsed) {
    throw new Error('Secure randomness produced a direct-chat nonce that is already used; nothing was sent.');
  }
  if (String(contractAadHash).toLowerCase() !== encrypted.aadHash.toLowerCase()) {
    throw new Error('Chat contract authenticated-data derivation does not match the V2 client.');
  }
  const writeContract = await loadContract(conversation.contractAddress, capability);
  const submitted = await writeContract.sendMessage(
    conversation.conversationId,
    conversation.currentEpoch,
    senderSequence,
    encrypted.nonce,
    encrypted.ciphertext,
    feeTaken,
    { value: valueSent }
  );
  return {
    encrypted,
    context,
    transaction: toTransaction(submitted, capability)
  };
};

export const decryptDirectChatV2EventMessage = async ({
  encrypted,
  key,
  context
}: {
  encrypted: DirectChatV2EncryptedMessage;
  key: DirectChatV2EpochKey;
  context: DirectChatV2MessageContext;
}): Promise<string> => {
  if (
    key.chainId !== context.chainId ||
    key.contractAddress.toLowerCase() !== context.contractAddress.toLowerCase() ||
    key.conversationId.toLowerCase() !== context.conversationId.toLowerCase() ||
    key.epoch !== context.epoch
  ) {
    throw new Error('Direct-chat event does not match the supplied epoch key.');
  }
  return decryptDirectChatV2Message(encrypted, key, context);
};

export const buildDirectChatV2MessageKey = ({
  chainId,
  contractAddress,
  conversationId,
  messageId
}: {
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  messageId: bigint;
}): string => {
  const normalizedChainId = normalizeUint256(chainId, 'Message chain ID');
  if (normalizedChainId === 0n) {
    throw new Error('Message chain ID cannot be zero.');
  }
  const target = normalizeAddress(contractAddress, 'Message contract').toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(conversationId)) {
    throw new Error('Message conversation ID must be bytes32.');
  }
  return `direct-v2:${normalizedChainId}:${target}:${conversationId.toLowerCase()}:${normalizeUint64(messageId, 'Message ID')}`;
};

export const parseDirectChatV2ConversationCreatedReceipt = ({
  deployment,
  receipt,
  expected
}: {
  deployment: VerifiedDirectChatV2Deployment;
  receipt: unknown;
  expected: Readonly<{
    transactionHash: string;
    conversationId: string;
    ownerAddress: string;
    peer: string;
    epoch: bigint;
  }>;
}): DirectChatV2ConversationCreatedEvent => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('Chat V2 conversation receipt is missing.');
  }
  const raw = receipt as Record<string, unknown>;
  if (raw.status === undefined || normalizeUint256(raw.status, 'Conversation receipt status') !== 1n) {
    throw new Error('Chat V2 conversation transaction did not succeed.');
  }
  const receiptTransactionHash = normalizeBytes32(
    String(raw.hash ?? raw.transactionHash ?? ''),
    'Conversation receipt transaction hash'
  );
  const receiptBlockHash = normalizeBytes32(
    String(raw.blockHash ?? ''),
    'Conversation receipt block hash'
  );
  const receiptBlockNumber = normalizeUint256(
    raw.blockNumber,
    'Conversation receipt block number'
  );
  if (receiptBlockNumber < verifiedDeployment.deploymentBlock || !Array.isArray(raw.logs)) {
    throw new Error('Chat V2 conversation receipt provenance is invalid.');
  }

  const matchingLogs = raw.logs.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const record = candidate as Record<string, unknown>;
    return (
      typeof record.address === 'string' &&
      record.address.toLowerCase() === verifiedDeployment.contractAddress.toLowerCase() &&
      Array.isArray(record.topics) &&
      typeof record.topics[0] === 'string' &&
      record.topics[0].toLowerCase() === DIRECT_CHAT_V2_CONVERSATION_CREATED_TOPIC.toLowerCase()
    );
  });
  if (matchingLogs.length !== 1) {
    throw new Error('Chat V2 receipt must contain exactly one ConversationCreated event.');
  }
  const log = matchingLogs[0] as Record<string, unknown>;
  if (log.removed === true || !Array.isArray(log.topics) || typeof log.data !== 'string') {
    throw new Error('Chat V2 receipt contains an invalid ConversationCreated event.');
  }
  let parsed;
  try {
    parsed = DIRECT_CHAT_V2_INTERFACE.parseLog({
      topics: log.topics as string[],
      data: log.data
    });
  } catch {
    throw new Error('ConversationCreated receipt event ABI data is malformed.');
  }
  if (!parsed || parsed.name !== 'ConversationCreated') {
    throw new Error('Chat V2 receipt event is not ConversationCreated.');
  }

  const transactionHash = normalizeBytes32(
    String(log.transactionHash ?? ''),
    'Conversation event transaction hash'
  );
  const blockHash = normalizeBytes32(String(log.blockHash ?? ''), 'Conversation event block hash');
  const blockNumber = normalizeUint256(log.blockNumber, 'Conversation event block number');
  const rawLogIndex = log.index ?? log.logIndex;
  const logIndex = Number(rawLogIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw new Error('ConversationCreated event log index is invalid.');
  }
  if (
    transactionHash !== receiptTransactionHash ||
    blockHash !== receiptBlockHash ||
    blockNumber !== receiptBlockNumber
  ) {
    throw new Error('ConversationCreated event provenance does not match its receipt.');
  }

  const conversationId = normalizeBytes32(
    String(tupleField(parsed.args, 'conversationId', 0)),
    'Created conversation ID'
  );
  const participantA = normalizeAddress(
    String(tupleField(parsed.args, 'participantA', 1)),
    'Created conversation participant A'
  );
  const participantB = normalizeAddress(
    String(tupleField(parsed.args, 'participantB', 2)),
    'Created conversation participant B'
  );
  const createdBy = normalizeAddress(
    String(tupleField(parsed.args, 'createdBy', 3)),
    'Created conversation sender'
  );
  const epoch = normalizeUint64(tupleField(parsed.args, 'epoch', 4), 'Created conversation epoch');
  const expectedOwner = normalizeAddress(expected.ownerAddress, 'Expected conversation owner');
  const expectedPeer = normalizeAddress(expected.peer, 'Expected conversation peer');
  const expectedParticipants = [expectedOwner.toLowerCase(), expectedPeer.toLowerCase()].sort();
  if (
    receiptTransactionHash !== normalizeBytes32(expected.transactionHash, 'Expected conversation transaction hash') ||
    conversationId !== normalizeBytes32(expected.conversationId, 'Expected conversation ID') ||
    participantA.toLowerCase() !== expectedParticipants[0] ||
    participantB.toLowerCase() !== expectedParticipants[1] ||
    createdBy.toLowerCase() !== expectedOwner.toLowerCase() ||
    epoch !== normalizeUint64(expected.epoch, 'Expected conversation epoch') ||
    deriveDirectChatV2ConversationId({
      chainId: verifiedDeployment.chainId,
      contractAddress: verifiedDeployment.contractAddress,
      participantA,
      participantB
    }) !== conversationId
  ) {
    throw new Error('ConversationCreated event does not match the submitted wallet pair.');
  }

  return Object.freeze({
    chainId: verifiedDeployment.chainId,
    contractAddress: verifiedDeployment.contractAddress,
    conversationId,
    participantA,
    participantB,
    createdBy,
    epoch,
    transactionHash,
    blockHash,
    blockNumber,
    logIndex
  });
};

export const parseDirectChatV2MessagePostedLog = ({
  deployment,
  log
}: {
  deployment: VerifiedDirectChatV2Deployment;
  log: unknown;
}): DirectChatV2MessageEvent => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  if (!log || typeof log !== 'object') {
    throw new Error('Chat V2 message log is missing.');
  }
  const raw = log as Record<string, unknown>;
  const logAddress = normalizeAddress(String(raw.address ?? ''), 'Message log contract');
  if (logAddress.toLowerCase() !== verifiedDeployment.contractAddress.toLowerCase()) {
    throw new Error('Message log was emitted by an unverified chat contract.');
  }
  const topics = raw.topics;
  if (
    !Array.isArray(topics) ||
    topics.length !== 4 ||
    topics.some((topic) => typeof topic !== 'string') ||
    String(topics[0]).toLowerCase() !== DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC.toLowerCase()
  ) {
    throw new Error('Message log does not have the canonical MessagePosted topics.');
  }
  if (typeof raw.data !== 'string') {
    throw new Error('Message log data is missing.');
  }

  let parsed;
  try {
    parsed = DIRECT_CHAT_V2_INTERFACE.parseLog({
      topics: topics as string[],
      data: raw.data
    });
  } catch {
    throw new Error('Message log ABI data is malformed.');
  }
  if (!parsed || parsed.name !== 'MessagePosted') {
    throw new Error('Message log is not a Chat V2 MessagePosted event.');
  }

  const conversationId = normalizeBytes32(String(tupleField(parsed.args, 'conversationId', 0)), 'Conversation ID');
  const sender = normalizeAddress(String(tupleField(parsed.args, 'sender', 1)), 'Message sender');
  const recipient = normalizeAddress(String(tupleField(parsed.args, 'recipient', 2)), 'Message recipient');
  if (sender.toLowerCase() === recipient.toLowerCase()) {
    throw new Error('Message sender and recipient must be different wallets.');
  }
  const participantA = BigInt(sender) < BigInt(recipient) ? sender : recipient;
  const participantB = participantA === sender ? recipient : sender;
  const expectedConversationId = deriveDirectChatV2ConversationId({
    chainId: verifiedDeployment.chainId,
    contractAddress: verifiedDeployment.contractAddress,
    participantA,
    participantB
  });
  if (conversationId !== expectedConversationId) {
    throw new Error('Message log conversation does not match its wallet pair and deployment.');
  }

  const messageId = normalizeUint64(tupleField(parsed.args, 'messageId', 3), 'Message ID');
  const epoch = normalizeUint64(tupleField(parsed.args, 'epoch', 4), 'Message epoch');
  const senderSequence = normalizeUint64(
    tupleField(parsed.args, 'senderSequence', 5),
    'Message sender sequence'
  );
  const nonce = normalizeBytes12(String(tupleField(parsed.args, 'nonce', 6)), 'Message nonce');
  const aadHash = normalizeBytes32(String(tupleField(parsed.args, 'aadHash', 7)), 'Message AAD hash');
  const ciphertext = normalizeCiphertext(String(tupleField(parsed.args, 'ciphertext', 8)));
  const valueSent = normalizeUint256(tupleField(parsed.args, 'valueSent', 9), 'Message value');
  const feeTaken = normalizeUint256(tupleField(parsed.args, 'feeTaken', 10), 'Message fee');
  if (feeTaken > valueSent) {
    throw new Error('Message log fee exceeds its transaction value.');
  }

  const context = {
    chainId: verifiedDeployment.chainId,
    contractAddress: verifiedDeployment.contractAddress,
    conversationId,
    epoch,
    participantA,
    participantB,
    sender,
    recipient,
    senderSequence,
    valueSent,
    feeTaken
  } satisfies DirectChatV2MessageContext;
  if (deriveDirectChatV2AadHash(context, nonce) !== aadHash) {
    throw new Error('Message log AAD does not match its canonical event context.');
  }

  const transactionHash = normalizeBytes32(String(raw.transactionHash ?? ''), 'Message transaction hash');
  const blockHash = normalizeBytes32(String(raw.blockHash ?? ''), 'Message block hash');
  const blockNumber = normalizeUint256(raw.blockNumber, 'Message block number');
  if (blockNumber < verifiedDeployment.deploymentBlock) {
    throw new Error('Message log predates the verified Chat V2 deployment.');
  }
  const rawLogIndex = raw.index ?? raw.logIndex;
  const logIndex = Number(rawLogIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw new Error('Message log index is invalid.');
  }
  if (raw.removed !== undefined && typeof raw.removed !== 'boolean') {
    throw new Error('Message removed flag is invalid.');
  }
  const encrypted = { nonce, aadHash, ciphertext } satisfies DirectChatV2EncryptedMessage;

  return {
    protocol: 'direct-v2',
    key: buildDirectChatV2MessageKey({
      chainId: verifiedDeployment.chainId,
      contractAddress: verifiedDeployment.contractAddress,
      conversationId,
      messageId
    }),
    chainId: verifiedDeployment.chainId,
    contractAddress: verifiedDeployment.contractAddress,
    conversationId,
    messageId,
    epoch,
    senderSequence,
    sender,
    recipient,
    nonce,
    aadHash,
    ciphertext,
    valueSent,
    feeTaken,
    transactionHash,
    blockHash,
    blockNumber,
    logIndex,
    removed: raw.removed === true,
    context,
    encrypted
  };
};

export const readDirectChatV2MessageLogPage = async ({
  capability,
  deployment,
  peer,
  fromBlock,
  toBlock
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<DirectChatV2MessageEvent[]> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const start = normalizeUint256(fromBlock, 'Message log start block');
  const end = normalizeUint256(toBlock, 'Message log end block');
  if (start < verifiedDeployment.deploymentBlock || end < start) {
    throw new Error('Message log range must begin at the verified deployment block and end after it.');
  }
  if (end - start + 1n > DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Message log range exceeds the bounded Chat V2 page size.');
  }
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Message log block range is not safely representable by the provider.');
  }
  const conversation = await readDirectChatV2Conversation({ capability, deployment: verifiedDeployment, peer });
  if (!conversation.exists) return [];
  const { readProvider } = resolveDirectChatV2ReadCapability(capability);
  const logs = await readProvider.getLogs({
    address: verifiedDeployment.contractAddress,
    fromBlock: Number(start),
    toBlock: Number(end),
    topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, conversation.conversationId]
  });
  resolveDirectChatV2ReadCapability(capability);
  const messages = logs.map((log) => parseDirectChatV2MessagePostedLog({
    deployment: verifiedDeployment,
    log
  }));
  messages.sort((left, right) => {
    if (left.blockNumber < right.blockNumber) return -1;
    if (left.blockNumber > right.blockNumber) return 1;
    return left.logIndex - right.logIndex;
  });
  let previousMessageId = 0n;
  for (const message of messages) {
    if (message.removed) {
      throw new Error('A bounded Chat V2 history page cannot contain a removed log.');
    }
    if (message.conversationId !== conversation.conversationId || message.messageId <= previousMessageId) {
      throw new Error('Chat V2 history page is not in canonical conversation-message order.');
    }
    previousMessageId = message.messageId;
  }
  return messages;
};

export const readDirectChatV2IncomingMessageLogPage = async ({
  capability,
  deployment,
  fromBlock,
  toBlock
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<DirectChatV2MessageEvent[]> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  const start = normalizeUint256(fromBlock, 'Incoming-message log start block');
  const end = normalizeUint256(toBlock, 'Incoming-message log end block');
  if (start < verifiedDeployment.deploymentBlock || end < start) {
    throw new Error('Incoming-message log range must begin at the verified deployment block and end after it.');
  }
  if (end - start + 1n > DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Incoming-message log range exceeds the bounded Chat V2 page size.');
  }
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Incoming-message log block range is not safely representable by the provider.');
  }
  const binding = resolveDirectChatV2ReadCapability(capability);
  const ownerTopic = `0x${binding.ownerAddress.slice(2).toLowerCase().padStart(64, '0')}`;
  const logRange = {
    address: verifiedDeployment.contractAddress,
    fromBlock: Number(start),
    toBlock: Number(end)
  } as const;
  const [receivedLogs, sentLogs] = await Promise.all([
    binding.readProvider.getLogs({
      ...logRange,
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, null, null, ownerTopic]
    }),
    binding.readProvider.getLogs({
      ...logRange,
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, null, ownerTopic, null]
    })
  ]);
  resolveDirectChatV2ReadCapability(capability);
  const messages = [...receivedLogs, ...sentLogs].map((log) => parseDirectChatV2MessagePostedLog({
    deployment: verifiedDeployment,
    log
  }));
  messages.sort((left, right) => {
    if (left.blockNumber < right.blockNumber) return -1;
    if (left.blockNumber > right.blockNumber) return 1;
    return left.logIndex - right.logIndex;
  });
  const physicalIds = new Set<string>();
  for (const message of messages) {
    const ownerIsSender = message.sender.toLowerCase() === binding.ownerAddress.toLowerCase();
    const ownerIsRecipient = message.recipient.toLowerCase() === binding.ownerAddress.toLowerCase();
    if (
      message.removed ||
      ownerIsSender === ownerIsRecipient ||
      message.blockNumber < start ||
      message.blockNumber > end
    ) {
      throw new Error('Chat activity history contains an invalid participant or block provenance.');
    }
    const physicalId = `${message.blockHash.toLowerCase()}:${message.transactionHash.toLowerCase()}:${message.logIndex}`;
    if (physicalIds.has(physicalId)) {
      throw new Error('Chat activity history contains a duplicate physical log.');
    }
    physicalIds.add(physicalId);
  }
  return messages;
};

export const watchDirectChatV2MessageHints = async ({
  capability,
  deployment,
  peer,
  onHint
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  peer: string;
  onHint: () => void | Promise<void>;
}): Promise<(() => Promise<void>) | null> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  if (typeof onHint !== 'function') {
    throw new Error('Direct-chat V2 message hint listener is invalid.');
  }
  const conversation = await readDirectChatV2Conversation({
    capability,
    deployment: verifiedDeployment,
    peer
  });
  if (!conversation.exists) return null;
  let nextBlock = (await readDirectChatV2LatestBlockNumber({
    capability,
    deployment: verifiedDeployment
  })) + 1n;
  let active = true;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let polling = false;
  const poll = async () => {
    if (!active || polling) return;
    polling = true;
    try {
      const latestBlock = await readDirectChatV2LatestBlockNumber({
        capability,
        deployment: verifiedDeployment
      });
      if (latestBlock < nextBlock - 1n) {
        nextBlock = latestBlock + 1n;
        if (active) await Promise.resolve(onHint());
        return;
      }
      if (latestBlock < nextBlock) return;
      const toBlock = nextBlock + DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN - 1n < latestBlock
        ? nextBlock + DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN - 1n
        : latestBlock;
      const messages = await readDirectChatV2MessageLogPage({
        capability,
        deployment: verifiedDeployment,
        peer,
        fromBlock: nextBlock,
        toBlock
      });
      nextBlock = toBlock + 1n;
      if (active && messages.length > 0) await Promise.resolve(onHint());
    } catch {
      // A hint is never canonical state. Leave the cursor unchanged so a later
      // stateless eth_getLogs poll can retry without installing fragile RPC filters.
    } finally {
      polling = false;
      if (active) timer = globalThis.setTimeout(() => { void poll(); }, MESSAGE_HINT_POLL_MS);
    }
  };
  resolveDirectChatV2ReadCapability(capability);
  timer = globalThis.setTimeout(() => { void poll(); }, MESSAGE_HINT_POLL_MS);
  return async () => {
    if (!active) return;
    active = false;
    if (timer !== null) globalThis.clearTimeout(timer);
  };
};

export const watchDirectChatV2IncomingMessageHints = async ({
  capability,
  deployment,
  onHint
}: {
  capability: DirectChatV2MetaMaskCapability;
  deployment: VerifiedDirectChatV2Deployment;
  onHint: (peer: string) => void | Promise<void>;
}): Promise<() => Promise<void>> => {
  const verifiedDeployment = requireVerifiedDeployment(deployment);
  if (typeof onHint !== 'function') {
    throw new Error('Direct-chat V2 incoming-message hint listener is invalid.');
  }
  const binding = resolveDirectChatV2ReadCapability(capability);
  let nextBlock = (await readDirectChatV2LatestBlockNumber({
    capability,
    deployment: verifiedDeployment
  })) + 1n;
  let active = true;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let polling = false;
  const poll = async () => {
    if (!active || polling) return;
    polling = true;
    try {
      const latestBlock = await readDirectChatV2LatestBlockNumber({
        capability,
        deployment: verifiedDeployment
      });
      if (latestBlock < nextBlock - 1n) {
        nextBlock = latestBlock + 1n;
        return;
      }
      if (latestBlock < nextBlock) return;
      const toBlock = nextBlock + DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN - 1n < latestBlock
        ? nextBlock + DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN - 1n
        : latestBlock;
      const messages = await readDirectChatV2IncomingMessageLogPage({
        capability,
        deployment: verifiedDeployment,
        fromBlock: nextBlock,
        toBlock
      });
      nextBlock = toBlock + 1n;
      const peers = new Set<string>();
      for (const event of messages) {
        const ownerIsSender = event.sender.toLowerCase() === binding.ownerAddress.toLowerCase();
        peers.add(ownerIsSender ? event.recipient : event.sender);
      }
      for (const peer of peers) {
        if (!active) break;
        await Promise.resolve(onHint(peer));
      }
    } catch {
      // RPC filter state is deliberately not used. Failed stateless reads retry
      // the same bounded block range on the next poll.
    } finally {
      polling = false;
      if (active) timer = globalThis.setTimeout(() => { void poll(); }, MESSAGE_HINT_POLL_MS);
    }
  };
  resolveDirectChatV2ReadCapability(capability);
  timer = globalThis.setTimeout(() => { void poll(); }, MESSAGE_HINT_POLL_MS);
  return async () => {
    if (!active) return;
    active = false;
    if (timer !== null) globalThis.clearTimeout(timer);
  };
};

export const parseDirectChatV2MessageReceipt = ({
  deployment,
  receipt,
  expected
}: {
  deployment: VerifiedDirectChatV2Deployment;
  receipt: unknown;
  expected: DirectChatV2ExpectedMessageReceipt;
}): DirectChatV2MessageEvent => {
  requireVerifiedDeployment(deployment);
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('Chat V2 transaction receipt is missing.');
  }
  const raw = receipt as Record<string, unknown>;
  if (raw.status === undefined || normalizeUint256(raw.status, 'Chat receipt status') !== 1n) {
    throw new Error('Chat V2 transaction did not succeed.');
  }
  const receiptTransactionHash = normalizeBytes32(
    String(raw.hash ?? raw.transactionHash ?? ''),
    'Chat receipt transaction hash'
  );
  const receiptBlockHash = normalizeBytes32(String(raw.blockHash ?? ''), 'Chat receipt block hash');
  const receiptBlockNumber = normalizeUint256(raw.blockNumber, 'Chat receipt block number');
  if (!Array.isArray(raw.logs)) {
    throw new Error('Chat V2 transaction receipt has no logs.');
  }
  const matchingLogs = raw.logs.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const record = candidate as Record<string, unknown>;
    return (
      typeof record.address === 'string' &&
      record.address.toLowerCase() === deployment.contractAddress.toLowerCase() &&
      Array.isArray(record.topics) &&
      typeof record.topics[0] === 'string' &&
      record.topics[0].toLowerCase() === DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC.toLowerCase()
    );
  });
  if (matchingLogs.length !== 1) {
    throw new Error('Chat V2 receipt must contain exactly one MessagePosted event.');
  }
  const message = parseDirectChatV2MessagePostedLog({ deployment, log: matchingLogs[0] });
  if (message.removed) {
    throw new Error('Chat V2 receipt contains a removed MessagePosted event.');
  }
  if (
    message.transactionHash !== receiptTransactionHash ||
    message.blockHash !== receiptBlockHash ||
    message.blockNumber !== receiptBlockNumber
  ) {
    throw new Error('Chat V2 receipt provenance does not match its MessagePosted log.');
  }

  const expectedTransactionHash = normalizeBytes32(
    expected.transactionHash,
    'Expected message transaction hash'
  );
  const expectedNonce = normalizeBytes12(expected.encrypted.nonce, 'Expected message nonce');
  const expectedAadHash = normalizeBytes32(expected.encrypted.aadHash, 'Expected message AAD hash');
  const expectedCiphertext = normalizeCiphertext(expected.encrypted.ciphertext);
  if (deriveDirectChatV2AadHash(expected.context, expectedNonce) !== expectedAadHash) {
    throw new Error('Expected Chat V2 message AAD is not canonical.');
  }
  const expectedSender = normalizeAddress(expected.context.sender, 'Expected message sender');
  const expectedRecipient = normalizeAddress(expected.context.recipient, 'Expected message recipient');
  const expectedContract = normalizeAddress(expected.context.contractAddress, 'Expected message contract');
  const expectedConversationId = normalizeBytes32(
    expected.context.conversationId,
    'Expected conversation ID'
  );
  if (
    receiptTransactionHash !== expectedTransactionHash ||
    message.chainId !== normalizeUint256(expected.context.chainId, 'Expected message chain ID') ||
    message.contractAddress.toLowerCase() !== expectedContract.toLowerCase() ||
    message.conversationId !== expectedConversationId ||
    message.sender.toLowerCase() !== expectedSender.toLowerCase() ||
    message.recipient.toLowerCase() !== expectedRecipient.toLowerCase() ||
    message.epoch !== normalizeUint64(expected.context.epoch, 'Expected message epoch') ||
    message.senderSequence !== normalizeUint64(
      expected.context.senderSequence,
      'Expected sender sequence'
    ) ||
    message.valueSent !== normalizeUint256(expected.context.valueSent, 'Expected message value') ||
    message.feeTaken !== normalizeUint256(expected.context.feeTaken, 'Expected message fee') ||
    message.nonce !== expectedNonce ||
    message.aadHash !== expectedAadHash ||
    message.ciphertext !== expectedCiphertext
  ) {
    throw new Error('Chat V2 receipt message does not match the submitted encrypted message.');
  }
  return message;
};
