import {
  BrowserProvider,
  getAddress,
  Interface,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import {
  extractRevertData,
  loadCotiEthersModule,
  type CotiReadProvider
} from './appShared/core';
import type { GroupChatV2DeploymentManifest } from './groupChatV2Deployment';
import {
  decryptGroupChatV2Metadata,
  decryptGroupChatV2Message,
  deriveGroupChatV2MessageAadHash,
  deriveGroupChatV2MetadataAadHash,
  encryptGroupChatV2Message,
  encryptGroupChatV2Metadata,
  type GroupChatV2EncryptedPayload,
  type GroupChatV2MessageContext,
  type GroupChatV2MetadataContext,
  type GroupChatV2Seed
} from './groupChatV2Crypto';

export const GROUP_CHAT_V2_ABI = [
  'function contractVersion() view returns (string)',
  'function PROTOCOL_VERSION() view returns (uint16)',
  'function deploymentBlock() view returns (uint64)',
  'function MESSAGE_AAD_DOMAIN() view returns (bytes32)',
  'function METADATA_AAD_DOMAIN() view returns (bytes32)',
  'function MAX_GROUP_MEMBERS() view returns (uint256)',
  'function MAX_INITIAL_MEMBERS() view returns (uint256)',
  'function MAX_MEMBERSHIP_BATCH() view returns (uint256)',
  'function MAX_INVITE_BATCH() view returns (uint256)',
  'function MAX_PAGE_SIZE() view returns (uint256)',
  'function MIN_CIPHERTEXT_BYTES() view returns (uint256)',
  'function MAX_CIPHERTEXT_BYTES() view returns (uint256)',
  'function messageFee() view returns (uint256)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function getGroup(uint256 groupId) view returns (tuple(address admin,uint64 createdAt,uint64 updatedAt,uint64 currentEpoch,uint64 messageCount,uint64 createdBlock,uint64 firstMessageBlock,uint64 lastMessageBlock,uint64 metadataVersion,uint32 membershipRevision,uint32 adminRevision,uint32 memberCount,bool exists,bool archived))',
  'function getMember(uint256 groupId,address account) view returns (tuple(bool active,uint32 generation,uint64 joinedAt,uint64 leftAt,uint64 firstReadableMessageId))',
  'function getInvite(uint256 groupId,address account) view returns (tuple(address inviter,uint64 expiresAt,uint64 generation,uint32 issuerAdminRevision,uint32 recipientGeneration,bool pending) invite,bool effective)',
  'function getJoinCode(uint256 groupId,bytes32 codeHash) view returns (tuple(address creator,address proofSigner,uint64 expiresAt,uint64 generation,uint32 issuerAdminRevision,uint32 usesLeft,bool active) joinCode,bool effective)',
  'function getGroupMembersPage(uint256 groupId,uint256 cursor,uint256 limit) view returns (address[] members,uint256 nextCursor)',
  'function getMembershipRange(uint256 groupId,address account,uint32 generation) view returns (tuple(uint64 firstMessageId,uint64 lastMessageId,uint64 firstEpoch,uint64 lastEpoch,uint32 joinedRevision,uint32 leftRevision,uint64 joinedAt,uint64 leftAt))',
  'function getMembershipRangesPage(uint256 groupId,address account,uint256 cursor,uint256 limit) view returns (tuple(uint64 firstMessageId,uint64 lastMessageId,uint64 firstEpoch,uint64 lastEpoch,uint32 joinedRevision,uint32 leftRevision,uint64 joinedAt,uint64 leftAt)[] ranges,uint256 nextCursor)',
  'function getEpochMetadata(uint256 groupId,uint64 epoch) view returns (bool exists,uint32 membershipRevision,address rotatedBy,uint64 createdAt,uint64 firstMessageId)',
  'function getMyEpochEnvelope(uint256 groupId,uint64 epoch) view returns (uint256 seed)',
  'function nextSenderSequence(uint256 groupId,uint64 epoch,address sender) view returns (uint64)',
  'function isMessageNonceUsed(uint256 groupId,uint64 epoch,bytes12 nonce) view returns (bool)',
  'function pendingNativeCredits(address account) view returns (uint256)',
  'function deriveMessageAadHash(uint256 groupId,uint64 epoch,uint32 membershipRevision,address sender,uint64 senderSequence,bytes12 nonce,uint256 valueSent,uint256 feeTaken) view returns (bytes32)',
  'function deriveMetadataAadHash(uint256 groupId,uint64 epoch,uint32 membershipRevision,uint64 metadataVersion,address editor,bytes12 nonce) view returns (bytes32)',
  'function canReadMessage(uint256 groupId,uint64 messageId,address account) view returns (bool)',
  'function canReact(uint256 groupId,uint64 messageId,address actor) view returns (bool)',
  'function createGroup(address[] initialInvitees) returns (uint256 groupId)',
  'function setGroupAdmin(uint256 groupId,address nextAdmin,uint32 expectedNextAdminGeneration,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function removeMembers(uint256 groupId,address[] accounts,uint32[] expectedGenerations,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function leaveGroup(uint256 groupId,uint32 expectedGeneration,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function disbandGroup(uint256 groupId,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function inviteMembers(uint256 groupId,address[] accounts,uint32[] expectedGenerations,uint64 ttl,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function acceptInvite(uint256 groupId,uint64 expectedInviteGeneration,uint32 expectedRecipientGeneration,uint32 expectedAdminRevision)',
  'function declineInvite(uint256 groupId,uint64 expectedInviteGeneration)',
  'function revokeInvite(uint256 groupId,address account,uint64 expectedInviteGeneration,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function createJoinCode(uint256 groupId,bytes32 codeHash,address proofSigner,uint64 ttl,uint32 uses,uint32 expectedAdminRevision,uint32 expectedMembershipRevision) returns (uint64 generation)',
  'function revokeJoinCode(uint256 groupId,bytes32 codeHash,uint64 expectedCodeGeneration,uint32 expectedAdminRevision,uint32 expectedMembershipRevision)',
  'function getJoinCodeProofDigest(uint256 groupId,bytes32 codeHash,uint64 generation,uint32 expectedAdminRevision,uint64 signatureDeadline) view returns (bytes32)',
  'function joinWithCode(uint256 groupId,bytes32 codeHash,uint64 generation,uint32 expectedAdminRevision,uint64 signatureDeadline,bytes signature)',
  'function rotateGroupKey(uint256 groupId,uint64 expectedEpoch,uint32 expectedAdminRevision,uint32 expectedMembershipRevision) returns (uint64 nextEpoch)',
  'function syncMyEpochEnvelope(uint256 groupId,uint64 epoch)',
  'function sendMessage(uint256 groupId,uint64 epoch,uint64 senderSequence,bytes12 nonce,bytes ciphertext,uint256 expectedFee) payable returns (uint64 messageId)',
  'function setEncryptedGroupMetadata(uint256 groupId,uint64 epoch,uint32 expectedAdminRevision,uint32 expectedMembershipRevision,uint64 expectedMetadataVersion,bytes12 nonce,bytes ciphertext) returns (uint64 metadataVersion)',
  'function withdrawNativeCredit() returns (uint256 amount)',
  'event GroupCreated(uint256 indexed groupId,address indexed admin,uint32 membershipRevision,uint32 adminRevision,uint64 epoch)',
  'event GroupAdminChanged(uint256 indexed groupId,address indexed previousAdmin,address indexed newAdmin,uint32 adminRevision)',
  'event GroupArchived(uint256 indexed groupId,address indexed actor)',
  'event GroupMemberAdded(uint256 indexed groupId,address indexed member,uint32 indexed membershipRevision,uint32 generation,uint64 firstReadableMessageId)',
  'event GroupMemberRemoved(uint256 indexed groupId,address indexed member,address indexed removedBy,uint32 membershipRevision,uint32 generation)',
  'event GroupMemberLeft(uint256 indexed groupId,address indexed member,uint32 indexed membershipRevision,uint32 generation)',
  'event GroupInviteCreated(uint256 indexed groupId,address indexed member,address indexed inviter,uint64 generation,uint32 issuerAdminRevision,uint32 recipientGeneration,uint64 expiresAt)',
  'event GroupInviteAccepted(uint256 indexed groupId,address indexed member,address indexed inviter,uint64 generation,uint32 membershipRevision)',
  'event GroupInviteDeclined(uint256 indexed groupId,address indexed member,uint64 indexed generation)',
  'event GroupInviteRevoked(uint256 indexed groupId,address indexed member,uint64 indexed generation,address revokedBy)',
  'event GroupJoinedWithCode(uint256 indexed groupId,address indexed member,bytes32 indexed codeHash,uint64 generation,uint32 membershipRevision)',
  'event GroupEpochCreated(uint256 indexed groupId,uint64 indexed epoch,uint32 indexed membershipRevision,address rotatedBy,uint64 firstMessageId)',
  'event GroupEpochEnvelopeSynchronized(uint256 indexed groupId,uint64 indexed epoch,address indexed member)',
  'event EncryptedGroupMetadataUpdated(uint256 indexed groupId,uint64 indexed metadataVersion,address indexed editor,uint64 epoch,uint32 membershipRevision,bytes12 nonce,bytes32 aadHash,bytes ciphertext)',
  'event GroupMessagePosted(uint256 indexed groupId,uint64 indexed messageId,address indexed sender,uint64 epoch,uint32 membershipRevision,uint64 senderSequence,bytes12 nonce,bytes32 aadHash,bytes ciphertext,uint256 valueSent,uint256 feeTaken)'
] as const;

const GROUP_INTERFACE = new Interface(GROUP_CHAT_V2_ABI);
const groupChatV2EventTopic = (name: string): string => {
  const topic = GROUP_INTERFACE.getEvent(name)?.topicHash;
  if (!topic) throw new Error(`Group Chat V2 ABI is missing the ${name} event.`);
  return topic;
};
export const GROUP_CHAT_V2_MESSAGE_TOPIC = groupChatV2EventTopic('GroupMessagePosted');
export const GROUP_CHAT_V2_METADATA_TOPIC = groupChatV2EventTopic('EncryptedGroupMetadataUpdated');
export const GROUP_CHAT_V2_CREATED_TOPIC = groupChatV2EventTopic('GroupCreated');

export const GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS = Object.freeze([
  'GroupCreated',
  'GroupMemberAdded',
  'GroupMemberRemoved',
  'GroupMemberLeft',
  'GroupInviteCreated',
  'GroupInviteAccepted',
  'GroupInviteDeclined',
  'GroupInviteRevoked',
  'GroupJoinedWithCode'
].map(groupChatV2EventTopic));
export const GROUP_CHAT_V2_MAX_LOG_BLOCK_SPAN = 2_048n;
const GROUP_CHAT_V2_RECEIPT_TIMEOUT_MS = 300_000;
const GROUP_CHAT_V2_RECEIPT_POLL_MS = 2_000;
const GROUP_CHAT_V2_EPOCH_ENVELOPE_NOT_SYNCHRONIZED_SELECTOR = '0xa70f12a4';

export class GroupChatV2EpochEnvelopeSyncRequiredError extends Error {
  readonly groupId: bigint;
  readonly epoch: bigint;

  constructor(groupId: bigint, epoch: bigint) {
    super('Synchronize this wallet\'s group privacy key before loading messages.');
    this.name = 'GroupChatV2EpochEnvelopeSyncRequiredError';
    this.groupId = groupId;
    this.epoch = epoch;
  }
}

export const isGroupChatV2EpochEnvelopeSyncRequiredError = (
  error: unknown
): error is GroupChatV2EpochEnvelopeSyncRequiredError =>
  error instanceof GroupChatV2EpochEnvelopeSyncRequiredError;

const isEpochEnvelopeNotSynchronizedRevert = (error: unknown): boolean =>
  extractRevertData(error)?.slice(0, 10) ===
  GROUP_CHAT_V2_EPOCH_ENVELOPE_NOT_SYNCHRONIZED_SELECTOR;

export const GROUP_CHAT_V2_REQUIRED_FEATURES = [
  'GROUP_CHAT_V2',
  'COTI_EPOCH_SEED_RAND128',
  'AES_GCM_EVENT_MESSAGES',
  'RANDOM_UNIQUE_MESSAGE_NONCES',
  'STABLE_GROUP_MESSAGE_IDS',
  'REACTION_AUTHORIZATION',
  'DIRECT_WALLET_AUTHORITY',
  'PULL_NATIVE_CREDITS',
  'HISTORICAL_MEMBERSHIP_AUTHORIZATION',
  'EVENT_ONLY_ENCRYPTED_METADATA',
  'REPLAY_SAFE_GROUP_JOINS'
] as const;

const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const EXPECTED_MESSAGE_AAD_DOMAIN = keccak256(
  toUtf8Bytes('chainwhisper.group-chat.v2.aes-gcm.aad.v1')
);
const EXPECTED_METADATA_AAD_DOMAIN = keccak256(
  toUtf8Bytes('chainwhisper.group-chat.v2.metadata.aad.v1')
);

declare const GROUP_CHAT_V2_CAPABILITY_BRAND: unique symbol;
export type GroupChatV2MetaMaskCapability = Readonly<{
  readonly [GROUP_CHAT_V2_CAPABILITY_BRAND]: true;
}>;

type CapabilityBinding = Readonly<{
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
  browserProvider: BrowserProvider;
  readProvider: CotiReadProvider | BrowserProvider;
  chainId: bigint;
  ownerAddress: string;
  signer: JsonRpcSigner;
}>;

export type VerifiedGroupChatV2Deployment = GroupChatV2DeploymentManifest;

export type GroupChatV2GroupSnapshot = Readonly<{
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  admin: string;
  createdAt: bigint;
  updatedAt: bigint;
  currentEpoch: bigint;
  messageCount: bigint;
  createdBlock: bigint;
  firstMessageBlock: bigint;
  lastMessageBlock: bigint;
  metadataVersion: bigint;
  membershipRevision: bigint;
  adminRevision: bigint;
  memberCount: bigint;
  archived: boolean;
}>;

export type GroupChatV2MemberSnapshot = Readonly<{
  groupId: bigint;
  account: string;
  active: boolean;
  generation: bigint;
  joinedAt: bigint;
  leftAt: bigint;
  firstReadableMessageId: bigint;
}>;

export type GroupChatV2MembershipRangeSnapshot = Readonly<{
  generation: bigint;
  firstMessageId: bigint;
  lastMessageId: bigint;
  firstEpoch: bigint;
  lastEpoch: bigint;
  joinedRevision: bigint;
  leftRevision: bigint;
  joinedAt: bigint;
  leftAt: bigint;
}>;

export type GroupChatV2InviteSnapshot = Readonly<{
  groupId: bigint;
  account: string;
  inviter: string;
  expiresAt: bigint;
  generation: bigint;
  issuerAdminRevision: bigint;
  recipientGeneration: bigint;
  pending: boolean;
  effective: boolean;
}>;

export type GroupChatV2JoinCodeSnapshot = Readonly<{
  groupId: bigint;
  codeHash: string;
  creator: string;
  proofSigner: string;
  expiresAt: bigint;
  generation: bigint;
  issuerAdminRevision: bigint;
  usesLeft: bigint;
  active: boolean;
  effective: boolean;
}>;

export type GroupChatV2EpochMetadata = Readonly<{
  groupId: bigint;
  epoch: bigint;
  exists: boolean;
  membershipRevision: bigint;
  rotatedBy: string;
  createdAt: bigint;
  firstMessageId: bigint;
}>;

export type GroupChatV2EpochKey = GroupChatV2Seed & Readonly<{
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  epoch: bigint;
  membershipRevision: bigint;
}>;

export type GroupChatV2Transaction = Readonly<{
  txHash: string;
  wait: () => Promise<unknown>;
}>;

export type GroupChatV2MessageEvent = Readonly<{
  protocol: 'group-v2';
  key: string;
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  messageId: bigint;
  epoch: bigint;
  membershipRevision: bigint;
  senderSequence: bigint;
  sender: string;
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
  context: GroupChatV2MessageContext;
  encrypted: GroupChatV2EncryptedPayload;
}>;

export type GroupChatV2MetadataEvent = Readonly<{
  protocol: 'group-v2';
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  metadataVersion: bigint;
  editor: string;
  epoch: bigint;
  membershipRevision: bigint;
  nonce: string;
  aadHash: string;
  ciphertext: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
  removed: boolean;
  context: GroupChatV2MetadataContext;
  encrypted: GroupChatV2EncryptedPayload;
}>;

export type GroupChatV2ExpectedMessageReceipt = Readonly<{
  transactionHash: string;
  context: GroupChatV2MessageContext;
  encrypted: GroupChatV2EncryptedPayload;
}>;

export type GroupChatV2CreatedEvent = Readonly<{
  groupId: bigint;
  admin: string;
  membershipRevision: bigint;
  adminRevision: bigint;
  epoch: bigint;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
}>;

export type GroupChatV2CanonicalBlock = Readonly<{
  blockNumber: bigint;
  blockHash: string;
  timestamp: number;
}>;

export type GroupChatV2WalletLifecycleEvent = Readonly<{
  kind:
    | 'created'
    | 'member-added'
    | 'member-removed'
    | 'member-left'
    | 'invite-created'
    | 'invite-accepted'
    | 'invite-declined'
    | 'invite-revoked'
    | 'joined-with-code';
  groupId: bigint;
  walletAddress: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
}>;

export type GroupChatV2NonceAttempt = Readonly<{
  purpose: 'message' | 'metadata';
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  epoch: bigint;
  nonce: string;
  ownerAddress: string;
}>;

export type GroupChatV2NonceAttemptRetirer = (
  attempt: GroupChatV2NonceAttempt
) => Promise<void>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const VERIFIED_DEPLOYMENTS = new WeakSet<object>();

const uint = (
  value: unknown,
  label: string,
  maximum = UINT256_MAX,
  allowZero = true
): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || parsed > maximum || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed;
};

const address = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes32 = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${label} must be bytes32.`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_BYTES32) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes12 = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^0x[0-9a-f]{24}$/u.test(normalized) || normalized === `0x${'00'.repeat(12)}`) {
    throw new Error(`${label} must be a non-zero bytes12 value.`);
  }
  return normalized;
};

const ciphertext = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^0x(?:[0-9a-f]{2})+$/u.test(normalized)) {
    throw new Error('Group message ciphertext must be canonical bytes.');
  }
  const length = (normalized.length - 2) / 2;
  if (length < 16 || length > 4_096) {
    throw new Error('Group message ciphertext length is outside the reviewed protocol bounds.');
  }
  return normalized;
};

const field = (tuple: unknown, name: string, index: number): unknown => {
  if (!tuple || typeof tuple !== 'object') return undefined;
  const record = tuple as Record<string | number, unknown>;
  return record[name] ?? record[index];
};

const transaction = (
  value: unknown,
  capability: GroupChatV2MetaMaskCapability
): GroupChatV2Transaction => {
  const candidate = value as { hash?: unknown; wait?: () => Promise<unknown> };
  if (typeof candidate?.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(candidate.hash) ||
      typeof candidate.wait !== 'function') {
    throw new Error('COTI did not return a waitable Group Chat V2 transaction.');
  }
  const transactionHash = candidate.hash.toLowerCase();
  const nativeWait = candidate.wait.bind(value);
  const { browserProvider, readProvider } = bindingOf(capability);
  return Object.freeze({
    txHash: transactionHash,
    wait: readProvider === browserProvider
      ? nativeWait
      : async () => {
          const deadline = Date.now() + GROUP_CHAT_V2_RECEIPT_TIMEOUT_MS;
          while (Date.now() < deadline) {
            try {
              const receipt = await readProvider.getTransactionReceipt(transactionHash);
              if (receipt) return receipt;
            } catch {
              // Retry the known public transaction hash without asking MetaMask to poll.
            }
            await new Promise<void>((resolve) => {
              globalThis.setTimeout(resolve, GROUP_CHAT_V2_RECEIPT_POLL_MS);
            });
          }
          throw new Error(
            'The group transaction was submitted, but COTI confirmation timed out. Check wallet activity before retrying.'
          );
        }
  });
};

const bindingOf = (capability: GroupChatV2MetaMaskCapability): CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('Group Chat V2 requires a current owner browser-wallet capability.');
  return binding;
};

const assertBindingCurrent = async (binding: CapabilityBinding): Promise<void> => {
  if (!(binding.browserProvider instanceof BrowserProvider) || binding.signer.provider !== binding.browserProvider) {
    throw new Error('Group Chat V2 capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertCurrent();
};

const assertBindingSnapshotCurrent = async (binding: CapabilityBinding): Promise<void> => {
  if (binding.assertSnapshotCurrent) {
    binding.assertSnapshotCurrent();
    return;
  }
  await assertBindingCurrent(binding);
};

const attestBindingScope = async (
  binding: CapabilityBinding,
  assertSnapshotCurrent?: () => void
): Promise<void> => {
  if (binding.readProvider !== binding.browserProvider && assertSnapshotCurrent) {
    assertSnapshotCurrent();
    return;
  }
  const [connectedOwnerRaw, network] = await Promise.all([
    binding.signer.getAddress(),
    binding.browserProvider.getNetwork()
  ]);
  if (assertSnapshotCurrent) assertSnapshotCurrent();
  else await assertBindingCurrent(binding);
  const connectedOwner = address(connectedOwnerRaw, 'Connected group owner');
  if (
    connectedOwner !== binding.ownerAddress ||
    uint(network.chainId, 'Connected group chain', UINT256_MAX, false) !== binding.chainId
  ) {
    throw new Error('Group Chat V2 capability account or chain changed.');
  }
};

const resolveCapability = async (
  capability: GroupChatV2MetaMaskCapability
): Promise<CapabilityBinding> => {
  const binding = bindingOf(capability);
  await assertBindingSnapshotCurrent(binding);
  return binding;
};

const resolveReadCapability = (
  capability: GroupChatV2MetaMaskCapability
): CapabilityBinding => bindingOf(capability);

export const bindGroupChatV2MetaMaskCapability = async ({
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
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
}): Promise<GroupChatV2MetaMaskCapability> => {
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
    throw new Error('Group Chat V2 requires the owner signer from the exact COTI BrowserProvider session.');
  }
  const binding = Object.freeze({
    assertCurrent,
    assertSnapshotCurrent,
    browserProvider,
    readProvider,
    chainId: uint(chainId, 'Expected Group Chat V2 chain', UINT256_MAX, false),
    ownerAddress: address(ownerAddress, 'Expected Group Chat V2 owner'),
    signer: candidate
  });
  await attestBindingScope(binding, assertSnapshotCurrent);
  const capability = Object.freeze({}) as GroupChatV2MetaMaskCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

/** Releases the COTI BrowserProvider owned by one Group Chat capability. */
export const releaseGroupChatV2MetaMaskCapability = (
  capability: GroupChatV2MetaMaskCapability
): boolean => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) return false;
  CAPABILITIES.delete(capability);
  return true;
};

export const assertGroupChatV2MetaMaskCapabilityCurrent = async ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: GroupChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): Promise<void> => {
  const binding = bindingOf(capability);
  if (
    binding.ownerAddress !== address(ownerAddress, 'Expected Group Chat V2 owner') ||
    binding.chainId !== uint(chainId, 'Expected Group Chat V2 chain', UINT256_MAX, false)
  ) {
    throw new Error('Group Chat V2 capability belongs to another account or chain.');
  }
  await assertBindingCurrent(binding);
};

/**
 * Checks the immutable event-backed wallet lease without issuing another
 * extension RPC. Mutation adapters still perform a full live check at entry,
 * and the guarded EIP-1193 provider checks account and chain immediately
 * before every signing or send request.
 */
export const assertGroupChatV2MetaMaskCapabilitySnapshotCurrent = ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: GroupChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): Promise<void> => {
  const binding = bindingOf(capability);
  if (
    binding.ownerAddress !== address(ownerAddress, 'Expected Group Chat V2 owner') ||
    binding.chainId !== uint(chainId, 'Expected Group Chat V2 chain', UINT256_MAX, false)
  ) {
    throw new Error('Group Chat V2 capability belongs to another account or chain.');
  }
  if (binding.assertSnapshotCurrent) {
    binding.assertSnapshotCurrent();
    return Promise.resolve();
  }
  return assertBindingCurrent(binding);
};

export const assertGroupChatV2MetaMaskCapabilityScope = ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: GroupChatV2MetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): void => {
  const binding = bindingOf(capability);
  if (
    binding.ownerAddress !== address(ownerAddress, 'Expected Group Chat V2 owner') ||
    binding.chainId !== uint(chainId, 'Expected Group Chat V2 chain', UINT256_MAX, false)
  ) {
    throw new Error('Group Chat V2 capability belongs to another account or chain.');
  }
};

export const signGroupChatV2ImageSessionAuthorization = async ({
  capability,
  message
}: {
  capability: GroupChatV2MetaMaskCapability;
  message: string;
}): Promise<string> => {
  const binding = await resolveCapability(capability);
  const lines = typeof message === 'string' && !message.includes('\r') ? message.split('\n') : [];
  if (
    lines.length !== 8 ||
    lines[0] !== 'ChainWhisper Chat Image Upload Session' ||
    lines[1] !== 'version:1' ||
    !/^audience:https:\/\/[^\s]+\/functions\/v1\/chat-image-session$/u.test(lines[2]) ||
    lines[3] !== `chainId:0x${binding.chainId.toString(16)}` ||
    lines[4] !== `owner:${binding.ownerAddress.toLowerCase()}` ||
    !/^nonce:[a-f0-9]{64}$/u.test(lines[5]) ||
    !/^issuedAt:[1-9][0-9]*$/u.test(lines[6]) ||
    !/^expiresAt:[1-9][0-9]*$/u.test(lines[7]) ||
    message.length > 1_024
  ) {
    throw new Error('Group Chat V2 refused a malformed image-session authorization.');
  }
  await binding.assertCurrent();
  const signature = await binding.signer.signMessage(message);
  await assertBindingCurrent(binding);
  if (typeof signature !== 'string' || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/u.test(signature)) {
    throw new Error('Group Chat V2 image-session authorization returned an invalid signature.');
  }
  return signature;
};

const writeContractFor = async (
  contractAddress: string,
  capability: GroupChatV2MetaMaskCapability
) => {
  const binding = bindingOf(capability);
  await assertBindingSnapshotCurrent(binding);
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(contractAddress, GROUP_CHAT_V2_ABI, binding.signer);
};

const readContractFor = async (
  contractAddress: string,
  capability: GroupChatV2MetaMaskCapability
) => {
  const binding = resolveReadCapability(capability);
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(contractAddress, GROUP_CHAT_V2_ABI, binding.readProvider);
};

const verified = (deployment: VerifiedGroupChatV2Deployment): VerifiedGroupChatV2Deployment => {
  if (!deployment || !VERIFIED_DEPLOYMENTS.has(deployment)) {
    throw new Error('Verify the exact Group Chat V2 deployment manifest before use.');
  }
  return deployment;
};

export const verifyGroupChatV2Deployment = async ({
  manifest,
  capability
}: {
  manifest: GroupChatV2DeploymentManifest;
  capability: GroupChatV2MetaMaskCapability;
}): Promise<VerifiedGroupChatV2Deployment> => {
  const binding = resolveReadCapability(capability);
  const expected = Object.freeze({
    chainId: uint(manifest.chainId, 'Group deployment chain', UINT256_MAX, false),
    contractAddress: address(manifest.contractAddress, 'Group deployment address'),
    deploymentBlock: uint(manifest.deploymentBlock, 'Group deployment block', UINT64_MAX, false),
    runtimeBytecodeHash: bytes32(manifest.runtimeBytecodeHash, 'Group runtime hash')
  });
  if (binding.chainId !== expected.chainId) {
    throw new Error('Group Chat V2 manifest chain does not match the current wallet.');
  }
  const runtime = await binding.readProvider.getCode(expected.contractAddress);
  if (runtime === '0x' || keccak256(runtime).toLowerCase() !== expected.runtimeBytecodeHash) {
    throw new Error('Group Chat V2 runtime does not match its frozen manifest.');
  }
  const contract = await readContractFor(expected.contractAddress, capability);
  const [
    version,
    protocol,
    deploymentBlock,
    messageAadDomain,
    metadataAadDomain,
    maxMembers,
    maxInitialMembers,
    maxMembershipBatch,
    maxInviteBatch,
    maxPageSize,
    minCiphertext,
    maxCiphertext
  ] = [
    await contract.contractVersion(),
    await contract.PROTOCOL_VERSION(),
    await contract.deploymentBlock(),
    await contract.MESSAGE_AAD_DOMAIN(),
    await contract.METADATA_AAD_DOMAIN(),
    await contract.MAX_GROUP_MEMBERS(),
    await contract.MAX_INITIAL_MEMBERS(),
    await contract.MAX_MEMBERSHIP_BATCH(),
    await contract.MAX_INVITE_BATCH(),
    await contract.MAX_PAGE_SIZE(),
    await contract.MIN_CIPHERTEXT_BYTES(),
    await contract.MAX_CIPHERTEXT_BYTES()
  ] as const;
  const requiredFeatures: boolean[] = [];
  for (const feature of GROUP_CHAT_V2_REQUIRED_FEATURES) {
    requiredFeatures.push(await contract.supportsFeature(keccak256(toUtf8Bytes(feature))));
  }
  const appWalletExecutor = await contract.supportsFeature(keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')));
  if (
    version !== 'ChainWhisperGroupChatV2' ||
    uint(protocol, 'Group protocol') !== 2n ||
    uint(deploymentBlock, 'Group on-chain deployment block') !== expected.deploymentBlock ||
    bytes32(messageAadDomain, 'Group message AAD domain') !== EXPECTED_MESSAGE_AAD_DOMAIN ||
    bytes32(metadataAadDomain, 'Group metadata AAD domain') !== EXPECTED_METADATA_AAD_DOMAIN ||
    uint(maxMembers, 'Group maximum members') !== 64n ||
    uint(maxInitialMembers, 'Group maximum initial invitees') !== 16n ||
    uint(maxMembershipBatch, 'Group membership batch') !== 16n ||
    uint(maxInviteBatch, 'Group invite batch') !== 16n ||
    uint(maxPageSize, 'Group page size') !== 50n ||
    uint(minCiphertext, 'Group minimum ciphertext') !== 16n ||
    uint(maxCiphertext, 'Group maximum ciphertext') !== 4_096n ||
    requiredFeatures.some((value) => value !== true) ||
    appWalletExecutor !== false
  ) {
    throw new Error('Group Chat V2 deployment features do not match the reviewed protocol.');
  }
  const result = Object.freeze({ ...expected });
  VERIFIED_DEPLOYMENTS.add(result);
  return result;
};

const groupContract = (
  deployment: VerifiedGroupChatV2Deployment,
  capability: GroupChatV2MetaMaskCapability
) => readContractFor(verified(deployment).contractAddress, capability);

const groupWriteContract = (
  deployment: VerifiedGroupChatV2Deployment,
  capability: GroupChatV2MetaMaskCapability
) => writeContractFor(verified(deployment).contractAddress, capability);

const submitGroupWrite = async (
  deployment: VerifiedGroupChatV2Deployment,
  capability: GroupChatV2MetaMaskCapability,
  method: string,
  args: readonly unknown[],
  overrides?: Readonly<{ value: bigint }>
): Promise<unknown> => {
  const binding = bindingOf(capability);
  const write = (await groupWriteContract(deployment, capability)).getFunction(method);
  const callArgs = overrides === undefined ? [...args] : [...args, overrides];
  const estimate = uint(await write.estimateGas(...callArgs), 'Group gas estimate', UINT256_MAX, false);
  // Local arithmetic avoids a dependency from Group Chat to Privacy Portal.
  const gasLimit = (estimate * 130n + 99n) / 100n;
  const block = await binding.readProvider.getBlock('latest');
  if (!block || gasLimit > uint(block.gasLimit, 'Group block gas limit', UINT256_MAX, false)) {
    throw new Error('Group transaction with gas headroom does not fit the latest block.');
  }
  await assertBindingCurrent(binding);
  return write(...args, { ...overrides, gasLimit });
};

export const readGroupChatV2Group = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<GroupChatV2GroupSnapshot> => {
  const target = verified(deployment);
  const id = uint(groupId, 'Group ID', UINT256_MAX, false);
  const raw = await (await groupContract(target, capability)).getGroup(id);
  if (field(raw, 'exists', 12) !== true) throw new Error('Group Chat V2 group does not exist.');
  return Object.freeze({
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId: id,
    admin: address(field(raw, 'admin', 0), 'Group admin', field(raw, 'archived', 13) === true),
    createdAt: uint(field(raw, 'createdAt', 1), 'Group creation time', UINT64_MAX),
    updatedAt: uint(field(raw, 'updatedAt', 2), 'Group update time', UINT64_MAX),
    currentEpoch: uint(field(raw, 'currentEpoch', 3), 'Group epoch', UINT64_MAX, false),
    messageCount: uint(field(raw, 'messageCount', 4), 'Group message count', UINT64_MAX),
    createdBlock: uint(field(raw, 'createdBlock', 5), 'Group creation block', UINT64_MAX, false),
    firstMessageBlock: uint(field(raw, 'firstMessageBlock', 6), 'Group first message block', UINT64_MAX),
    lastMessageBlock: uint(field(raw, 'lastMessageBlock', 7), 'Group last message block', UINT64_MAX),
    metadataVersion: uint(field(raw, 'metadataVersion', 8), 'Group metadata version', UINT64_MAX),
    membershipRevision: uint(field(raw, 'membershipRevision', 9), 'Group membership revision', UINT32_MAX, false),
    adminRevision: uint(field(raw, 'adminRevision', 10), 'Group admin revision', UINT32_MAX, false),
    memberCount: uint(field(raw, 'memberCount', 11), 'Group member count', 64n),
    archived: field(raw, 'archived', 13) === true
  });
};

export const readGroupChatV2Member = async ({
  deployment,
  capability,
  groupId,
  account
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  account: string;
}): Promise<GroupChatV2MemberSnapshot> => {
  const id = uint(groupId, 'Group ID', UINT256_MAX, false);
  const member = address(account, 'Group member');
  const raw = await (await groupContract(deployment, capability)).getMember(id, member);
  return Object.freeze({
    groupId: id,
    account: member,
    active: field(raw, 'active', 0) === true,
    generation: uint(field(raw, 'generation', 1), 'Member generation', UINT32_MAX),
    joinedAt: uint(field(raw, 'joinedAt', 2), 'Member join time', UINT64_MAX),
    leftAt: uint(field(raw, 'leftAt', 3), 'Member leave time', UINT64_MAX),
    firstReadableMessageId: uint(field(raw, 'firstReadableMessageId', 4), 'First readable message', UINT64_MAX)
  });
};

export const readGroupChatV2Members = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<readonly string[]> => {
  const id = uint(groupId, 'Group member-page ID', UINT256_MAX, false);
  const contract = await groupContract(deployment, capability);
  const members: string[] = [];
  let cursor = 0n;
  for (let page = 0; page < 2; page += 1) {
    const raw = await contract.getGroupMembersPage(id, cursor, 50n);
    const pageMembers = field(raw, 'members', 0);
    if (!Array.isArray(pageMembers)) throw new Error('Group member page is malformed.');
    members.push(...pageMembers.map((member) => address(member, 'Group page member')));
    const nextCursor = uint(field(raw, 'nextCursor', 1), 'Group member next cursor', 64n);
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }
  resolveReadCapability(capability);
  if (members.length > 64 || new Set(members).size !== members.length) {
    throw new Error('Group member pages contain invalid duplicates or capacity.');
  }
  return Object.freeze(members);
};

export const readGroupChatV2MembershipRanges = async ({
  deployment,
  capability,
  groupId,
  account
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  account: string;
}): Promise<readonly GroupChatV2MembershipRangeSnapshot[]> => {
  const id = uint(groupId, 'Group membership-range ID', UINT256_MAX, false);
  const member = address(account, 'Group membership-range account');
  const contract = await groupContract(deployment, capability);
  const ranges: GroupChatV2MembershipRangeSnapshot[] = [];
  let cursor = 0n;
  for (let page = 0; page < 82; page += 1) {
    const raw = await contract.getMembershipRangesPage(id, member, cursor, 50n);
    const pageRanges = field(raw, 'ranges', 0);
    if (!Array.isArray(pageRanges)) throw new Error('Group membership-range page is malformed.');
    for (const source of pageRanges) {
      const generation = BigInt(ranges.length + 1);
      const range = Object.freeze({
        generation,
        firstMessageId: uint(field(source, 'firstMessageId', 0), 'Membership first message', UINT64_MAX, false),
        lastMessageId: uint(field(source, 'lastMessageId', 1), 'Membership last message', UINT64_MAX),
        firstEpoch: uint(field(source, 'firstEpoch', 2), 'Membership first epoch', UINT64_MAX, false),
        lastEpoch: uint(field(source, 'lastEpoch', 3), 'Membership last epoch', UINT64_MAX),
        joinedRevision: uint(field(source, 'joinedRevision', 4), 'Membership joined revision', UINT32_MAX, false),
        leftRevision: uint(field(source, 'leftRevision', 5), 'Membership left revision', UINT32_MAX),
        joinedAt: uint(field(source, 'joinedAt', 6), 'Membership join time', UINT64_MAX, false),
        leftAt: uint(field(source, 'leftAt', 7), 'Membership leave time', UINT64_MAX)
      });
      if (
        (range.leftRevision === 0n) !== (range.leftAt === 0n) ||
        (range.leftRevision !== 0n && range.leftRevision <= range.joinedRevision) ||
        (range.lastEpoch !== 0n && range.lastEpoch < range.firstEpoch) ||
        (range.lastMessageId !== 0n && range.lastMessageId + 1n < range.firstMessageId)
      ) {
        throw new Error('Group membership range is internally inconsistent.');
      }
      const previous = ranges.length > 0 ? ranges[ranges.length - 1] : undefined;
      if (
        previous && (
          range.joinedRevision <= previous.joinedRevision ||
          range.firstMessageId <= previous.firstMessageId ||
          previous.leftRevision === 0n
        )
      ) {
        throw new Error('Group membership ranges are not strictly ordered.');
      }
      ranges.push(range);
    }
    const nextCursor = uint(field(raw, 'nextCursor', 1), 'Group membership-range next cursor', UINT32_MAX);
    if (nextCursor === 0n) {
      resolveReadCapability(capability);
      return Object.freeze(ranges);
    }
    if (nextCursor <= cursor || nextCursor !== BigInt(ranges.length)) {
      throw new Error('Group membership-range cursor is invalid.');
    }
    cursor = nextCursor;
  }
  throw new Error('Group membership history exceeds the supported bounded range.');
};

export const readGroupChatV2Invite = async ({
  deployment,
  capability,
  groupId,
  account
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  account: string;
}): Promise<GroupChatV2InviteSnapshot> => {
  const id = uint(groupId, 'Group ID', UINT256_MAX, false);
  const recipient = address(account, 'Invite recipient');
  const raw = await (await groupContract(deployment, capability)).getInvite(id, recipient);
  const invite = field(raw, 'invite', 0);
  return Object.freeze({
    groupId: id,
    account: recipient,
    inviter: address(field(invite, 'inviter', 0), 'Invite issuer', true),
    expiresAt: uint(field(invite, 'expiresAt', 1), 'Invite expiry', UINT64_MAX),
    generation: uint(field(invite, 'generation', 2), 'Invite generation', UINT64_MAX),
    issuerAdminRevision: uint(field(invite, 'issuerAdminRevision', 3), 'Invite admin revision', UINT32_MAX),
    recipientGeneration: uint(field(invite, 'recipientGeneration', 4), 'Invite recipient generation', UINT32_MAX),
    pending: field(invite, 'pending', 5) === true,
    effective: field(raw, 'effective', 1) === true
  });
};

export const readGroupChatV2JoinCode = async ({
  deployment,
  capability,
  groupId,
  codeHash
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  codeHash: string;
}): Promise<GroupChatV2JoinCodeSnapshot> => {
  const id = uint(groupId, 'Join-code group ID', UINT256_MAX, false);
  const hash = bytes32(codeHash, 'Group join-code hash');
  const raw = await (await groupContract(deployment, capability)).getJoinCode(id, hash);
  const code = field(raw, 'joinCode', 0);
  return Object.freeze({
    groupId: id,
    codeHash: hash,
    creator: address(field(code, 'creator', 0), 'Join-code creator', true),
    proofSigner: address(field(code, 'proofSigner', 1), 'Join-code proof signer', true),
    expiresAt: uint(field(code, 'expiresAt', 2), 'Join-code expiry', UINT64_MAX),
    generation: uint(field(code, 'generation', 3), 'Join-code generation', UINT64_MAX),
    issuerAdminRevision: uint(
      field(code, 'issuerAdminRevision', 4),
      'Join-code admin revision',
      UINT32_MAX
    ),
    usesLeft: uint(field(code, 'usesLeft', 5), 'Join-code remaining uses', UINT32_MAX),
    active: field(code, 'active', 6) === true,
    effective: field(raw, 'effective', 1) === true
  });
};

export const readGroupChatV2EpochMetadata = async ({
  deployment,
  capability,
  groupId,
  epoch
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  epoch: bigint;
}): Promise<GroupChatV2EpochMetadata> => {
  const id = uint(groupId, 'Group ID', UINT256_MAX, false);
  const epochId = uint(epoch, 'Group epoch', UINT64_MAX, false);
  const raw = await (await groupContract(deployment, capability)).getEpochMetadata(id, epochId);
  return Object.freeze({
    groupId: id,
    epoch: epochId,
    exists: field(raw, 'exists', 0) === true,
    membershipRevision: uint(field(raw, 'membershipRevision', 1), 'Epoch membership revision', UINT32_MAX),
    rotatedBy: address(field(raw, 'rotatedBy', 2), 'Epoch actor', true),
    createdAt: uint(field(raw, 'createdAt', 3), 'Epoch creation time', UINT64_MAX),
    firstMessageId: uint(field(raw, 'firstMessageId', 4), 'Epoch first message', UINT64_MAX)
  });
};

export const readGroupChatV2EpochKey = async ({
  deployment,
  capability,
  groupId,
  epoch
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  epoch: bigint;
}): Promise<GroupChatV2EpochKey> => {
  const target = verified(deployment);
  const binding = resolveReadCapability(capability);
  if (!binding.signer.getUserOnboardInfo()?.aesKey) {
    throw new Error('Unlock the COTI privacy key before reading this group epoch.');
  }
  const metadata = await readGroupChatV2EpochMetadata({ deployment: target, capability, groupId, epoch });
  if (!metadata.exists) throw new Error('Group epoch does not exist.');
  const contract = await groupContract(target, capability);
  let rawEnvelope: unknown;
  try {
    rawEnvelope = await contract.getMyEpochEnvelope(
      metadata.groupId,
      metadata.epoch,
      { from: binding.ownerAddress }
    );
  } catch (error) {
    if (isEpochEnvelopeNotSynchronizedRevert(error)) {
      throw new GroupChatV2EpochEnvelopeSyncRequiredError(
        metadata.groupId,
        metadata.epoch
      );
    }
    throw error;
  }
  const envelope = uint(rawEnvelope, 'Group seed envelope');
  const seed = uint(await binding.signer.decryptValue(envelope), 'Decrypted group seed', UINT128_MAX);
  resolveReadCapability(capability);
  return Object.freeze({
    value: seed,
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId: metadata.groupId,
    epoch: metadata.epoch,
    membershipRevision: metadata.membershipRevision
  });
};

const assertKeyMatchesGroup = (
  key: GroupChatV2EpochKey,
  group: GroupChatV2GroupSnapshot
): void => {
  if (
    key.chainId !== group.chainId ||
    address(key.contractAddress, 'Group key contract') !== group.contractAddress ||
    key.groupId !== group.groupId ||
    key.epoch !== group.currentEpoch ||
    key.membershipRevision !== group.membershipRevision
  ) {
    throw new Error('The in-memory group epoch key is stale or belongs to another group.');
  }
};

const requireGroupAdmin = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<Readonly<{ binding: CapabilityBinding; group: GroupChatV2GroupSnapshot }>> => {
  const binding = await resolveCapability(capability);
  const group = await readGroupChatV2Group({ deployment, capability, groupId });
  if (group.archived || group.admin !== binding.ownerAddress) {
    throw new Error('Only the active Group Chat V2 admin can perform this operation.');
  }
  return Object.freeze({ binding, group });
};

export const createGroupChatV2Group = async ({
  deployment,
  capability,
  initialInvitees = []
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  initialInvitees?: readonly string[];
}): Promise<GroupChatV2Transaction> => {
  const target = verified(deployment);
  if (initialInvitees.length > 16) throw new Error('Group creation supports at most 16 initial invitees.');
  const binding = await resolveCapability(capability);
  const invitees = initialInvitees.map((value) => address(value, 'Initial group invitee'));
  const unique = new Set(invitees);
  if (unique.size !== invitees.length || unique.has(binding.ownerAddress)) {
    throw new Error('Initial group invitees must be unique wallets other than the creator.');
  }
  const submitted = await submitGroupWrite(target, capability, 'createGroup', [invitees]);
  return transaction(submitted, capability);
};

export const setGroupChatV2Admin = async ({
  deployment,
  capability,
  groupId,
  nextAdmin
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  nextAdmin: string;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  const account = address(nextAdmin, 'Next group admin');
  if (account === group.admin) throw new Error('Next group admin is already the current admin.');
  const member = await readGroupChatV2Member({
    deployment,
    capability,
    groupId: group.groupId,
    account
  });
  if (!member.active) throw new Error('Next group admin must be an active member.');
  const submitted = await submitGroupWrite(deployment, capability, 'setGroupAdmin', [
    group.groupId,
    account,
    member.generation,
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const removeGroupChatV2Members = async ({
  deployment,
  capability,
  groupId,
  accounts
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  accounts: readonly string[];
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  if (accounts.length === 0 || accounts.length > 16) {
    throw new Error('Remove between 1 and 16 group members at a time.');
  }
  const normalized = accounts.map((account) => address(account, 'Removed group member'));
  if (new Set(normalized).size !== normalized.length || normalized.includes(group.admin)) {
    throw new Error('Removed group members must be unique and cannot include the admin.');
  }
  const members = await Promise.all(normalized.map((account) => readGroupChatV2Member({
    deployment,
    capability,
    groupId: group.groupId,
    account
  })));
  if (members.some((member) => !member.active)) {
    throw new Error('Every removed wallet must still be an active group member.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'removeMembers', [
    group.groupId,
    normalized,
    members.map((member) => member.generation),
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const leaveGroupChatV2 = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<GroupChatV2Transaction> => {
  const binding = await resolveCapability(capability);
  const group = await readGroupChatV2Group({ deployment, capability, groupId });
  const member = await readGroupChatV2Member({
    deployment,
    capability,
    groupId: group.groupId,
    account: binding.ownerAddress
  });
  if (!member.active) throw new Error('Only an active group member can leave.');
  if (!group.archived && group.admin === binding.ownerAddress && group.memberCount > 1n) {
    throw new Error('Transfer group administration before leaving this active group.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'leaveGroup', [
    group.groupId,
    member.generation,
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const disbandGroupChatV2 = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  const submitted = await submitGroupWrite(deployment, capability, 'disbandGroup', [
    group.groupId,
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const inviteGroupChatV2Members = async ({
  deployment,
  capability,
  groupId,
  accounts,
  ttl = 0n
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  accounts: readonly string[];
  ttl?: bigint;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  if (accounts.length === 0 || accounts.length > 16) {
    throw new Error('Invite between 1 and 16 wallets at a time.');
  }
  const normalized = accounts.map((account) => address(account, 'Group invitee'));
  if (new Set(normalized).size !== normalized.length || normalized.includes(group.admin)) {
    throw new Error('Group invitees must be unique wallets other than the admin.');
  }
  const members = await Promise.all(normalized.map((account) => readGroupChatV2Member({
    deployment,
    capability,
    groupId: group.groupId,
    account
  })));
  if (members.some((member) => member.active)) {
    throw new Error('An active member cannot receive a new group invite.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'inviteMembers', [
    group.groupId,
    normalized,
    members.map((member) => member.generation),
    uint(ttl, 'Group invite TTL', UINT64_MAX),
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const acceptGroupChatV2Invite = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<GroupChatV2Transaction> => {
  const binding = await resolveCapability(capability);
  const [group, invite, member] = await Promise.all([
    readGroupChatV2Group({ deployment, capability, groupId }),
    readGroupChatV2Invite({ deployment, capability, groupId, account: binding.ownerAddress }),
    readGroupChatV2Member({ deployment, capability, groupId, account: binding.ownerAddress })
  ]);
  if (!invite.effective || !invite.pending || member.active) {
    throw new Error('This wallet has no effective Group Chat V2 invite to accept.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'acceptInvite', [
    group.groupId,
    invite.generation,
    member.generation,
    group.adminRevision
  ]);
  return transaction(submitted, capability);
};

export const declineGroupChatV2Invite = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<GroupChatV2Transaction> => {
  const binding = await resolveCapability(capability);
  const invite = await readGroupChatV2Invite({
    deployment,
    capability,
    groupId,
    account: binding.ownerAddress
  });
  if (!invite.pending) throw new Error('This wallet has no pending group invite to decline.');
  const submitted = await submitGroupWrite(deployment, capability, 'declineInvite', [invite.groupId, invite.generation]);
  return transaction(submitted, capability);
};

export const revokeGroupChatV2Invite = async ({
  deployment,
  capability,
  groupId,
  account
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  account: string;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  const invite = await readGroupChatV2Invite({
    deployment,
    capability,
    groupId: group.groupId,
    account
  });
  if (!invite.pending) throw new Error('The selected wallet has no pending group invite.');
  const submitted = await submitGroupWrite(deployment, capability, 'revokeInvite', [
    group.groupId,
    invite.account,
    invite.generation,
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const rotateGroupChatV2Key = async ({
  deployment,
  capability,
  groupId
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
}): Promise<Readonly<{ nextEpoch: bigint; transaction: GroupChatV2Transaction }>> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  if (group.currentEpoch === UINT64_MAX) throw new Error('Group epoch limit reached.');
  const submitted = await submitGroupWrite(deployment, capability, 'rotateGroupKey', [
    group.groupId,
    group.currentEpoch,
    group.adminRevision,
    group.membershipRevision
  ]);
  return Object.freeze({
    nextEpoch: group.currentEpoch + 1n,
    transaction: transaction(submitted, capability)
  });
};

export const createGroupChatV2JoinCode = async ({
  deployment,
  capability,
  groupId,
  codeHash,
  proofSigner,
  ttl = 0n,
  uses = 0n
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  codeHash: string;
  proofSigner: string;
  ttl?: bigint;
  uses?: bigint;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  const submitted = await submitGroupWrite(deployment, capability, 'createJoinCode', [
    group.groupId,
    bytes32(codeHash, 'Group join-code hash'),
    address(proofSigner, 'Group join-code proof signer'),
    uint(ttl, 'Group join-code TTL', UINT64_MAX),
    uint(uses, 'Group join-code uses', UINT32_MAX),
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const revokeGroupChatV2JoinCode = async ({
  deployment,
  capability,
  groupId,
  codeHash
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  codeHash: string;
}): Promise<GroupChatV2Transaction> => {
  const { group } = await requireGroupAdmin({ deployment, capability, groupId });
  const code = await readGroupChatV2JoinCode({ deployment, capability, groupId, codeHash });
  if (!code.active) throw new Error('The selected group join code is not active.');
  const submitted = await submitGroupWrite(deployment, capability, 'revokeJoinCode', [
    group.groupId,
    code.codeHash,
    code.generation,
    group.adminRevision,
    group.membershipRevision
  ]);
  return transaction(submitted, capability);
};

export const readGroupChatV2JoinProofDigest = async ({
  deployment,
  capability,
  groupId,
  codeHash,
  generation,
  expectedAdminRevision,
  signatureDeadline
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  codeHash: string;
  generation: bigint;
  expectedAdminRevision: bigint;
  signatureDeadline: bigint;
}): Promise<string> => {
  const digest = bytes32(
    await (await groupContract(deployment, capability)).getJoinCodeProofDigest(
    uint(groupId, 'Join-proof group ID', UINT256_MAX, false),
    bytes32(codeHash, 'Join-proof code hash'),
    uint(generation, 'Join-proof generation', UINT64_MAX, false),
    uint(expectedAdminRevision, 'Join-proof admin revision', UINT32_MAX, false),
    uint(signatureDeadline, 'Join-proof deadline', UINT64_MAX, false)
    ),
    'Group join proof digest'
  );
  await resolveCapability(capability);
  return digest;
};

export const joinGroupChatV2WithCode = async ({
  deployment,
  capability,
  groupId,
  codeHash,
  generation,
  expectedAdminRevision,
  signatureDeadline,
  signature
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  codeHash: string;
  generation: bigint;
  expectedAdminRevision: bigint;
  signatureDeadline: bigint;
  signature: string;
}): Promise<GroupChatV2Transaction> => {
  await resolveCapability(capability);
  const normalizedSignature = signature.trim().toLowerCase();
  if (!/^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/u.test(normalizedSignature)) {
    throw new Error('Group join-code proof signature must be canonical ECDSA bytes.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'joinWithCode', [
    uint(groupId, 'Join-code group ID', UINT256_MAX, false),
    bytes32(codeHash, 'Join-code hash'),
    uint(generation, 'Join-code generation', UINT64_MAX, false),
    uint(expectedAdminRevision, 'Join-code admin revision', UINT32_MAX, false),
    uint(signatureDeadline, 'Join-code signature deadline', UINT64_MAX, false),
    normalizedSignature
  ]);
  return transaction(submitted, capability);
};

export const syncGroupChatV2EpochEnvelope = async ({
  deployment,
  capability,
  groupId,
  epoch
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  epoch: bigint;
}): Promise<GroupChatV2Transaction> => {
  await resolveCapability(capability);
  const metadata = await readGroupChatV2EpochMetadata({ deployment, capability, groupId, epoch });
  if (!metadata.exists) throw new Error('Cannot synchronize an unknown group epoch.');
  const submitted = await submitGroupWrite(deployment, capability, 'syncMyEpochEnvelope', [metadata.groupId, metadata.epoch]);
  return transaction(submitted, capability);
};

export const sendGroupChatV2Message = async ({
  deployment,
  capability,
  groupId,
  key,
  plaintext,
  retireNonceAttempt
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  key: GroupChatV2EpochKey;
  plaintext: string;
  retireNonceAttempt: GroupChatV2NonceAttemptRetirer;
}): Promise<Readonly<{
  encrypted: GroupChatV2EncryptedPayload;
  context: GroupChatV2MessageContext;
  transaction: GroupChatV2Transaction;
}>> => {
  const binding = await resolveCapability(capability);
  const group = await readGroupChatV2Group({ deployment, capability, groupId });
  if (group.archived) throw new Error('Archived groups cannot receive messages.');
  assertKeyMatchesGroup(key, group);
  const readContract = await groupContract(deployment, capability);
  const member = await readGroupChatV2Member({
    deployment,
    capability,
    groupId: group.groupId,
    account: binding.ownerAddress
  });
  if (!member.active) throw new Error('Only an active group member can send a message.');
  const [sequenceRaw, feeRaw] = await Promise.all([
    readContract.nextSenderSequence(group.groupId, group.currentEpoch, binding.ownerAddress),
    readContract.messageFee()
  ]);
  const senderSequence = uint(sequenceRaw, 'Next group sender sequence', UINT64_MAX, false);
  const feeTaken = uint(feeRaw, 'Group message fee');
  const context = Object.freeze({
    chainId: group.chainId,
    contractAddress: group.contractAddress,
    groupId: group.groupId,
    epoch: group.currentEpoch,
    membershipRevision: group.membershipRevision,
    sender: binding.ownerAddress,
    senderSequence,
    valueSent: feeTaken,
    feeTaken
  }) satisfies GroupChatV2MessageContext;
  const encrypted = await encryptGroupChatV2Message(plaintext, key, context);
  await retireNonceAttempt(Object.freeze({
    purpose: 'message',
    chainId: group.chainId,
    contractAddress: group.contractAddress,
    groupId: group.groupId,
    epoch: group.currentEpoch,
    nonce: encrypted.nonce,
    ownerAddress: binding.ownerAddress
  }));
  const [used, contractAadHash] = await Promise.all([
    readContract.isMessageNonceUsed(group.groupId, group.currentEpoch, encrypted.nonce),
    readContract.deriveMessageAadHash(
      group.groupId,
      group.currentEpoch,
      group.membershipRevision,
      binding.ownerAddress,
      senderSequence,
      encrypted.nonce,
      feeTaken,
      feeTaken
    )
  ]);
  if (used === true) throw new Error('The generated group message nonce is already used; nothing was sent.');
  if (bytes32(contractAadHash, 'Contract group message AAD') !== encrypted.aadHash) {
    throw new Error('Group contract message AAD does not match the V2 client.');
  }
  const submitted = await submitGroupWrite(deployment, capability, 'sendMessage', [
    group.groupId,
    group.currentEpoch,
    senderSequence,
    encrypted.nonce,
    encrypted.ciphertext,
    feeTaken
  ], { value: feeTaken });
  return Object.freeze({ encrypted, context, transaction: transaction(submitted, capability) });
};

export const setGroupChatV2EncryptedMetadata = async ({
  deployment,
  capability,
  groupId,
  key,
  plaintext,
  retireNonceAttempt
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  key: GroupChatV2EpochKey;
  plaintext: string;
  retireNonceAttempt: GroupChatV2NonceAttemptRetirer;
}): Promise<Readonly<{
  encrypted: GroupChatV2EncryptedPayload;
  context: GroupChatV2MetadataContext;
  transaction: GroupChatV2Transaction;
}>> => {
  const binding = await resolveCapability(capability);
  const group = await readGroupChatV2Group({ deployment, capability, groupId });
  if (group.archived) throw new Error('Archived group metadata cannot be changed.');
  assertKeyMatchesGroup(key, group);
  if (group.admin !== binding.ownerAddress) throw new Error('Only the current group admin can update metadata.');
  const metadataVersion = group.metadataVersion + 1n;
  if (metadataVersion > UINT64_MAX) throw new Error('Group metadata version limit reached.');
  const context = Object.freeze({
    chainId: group.chainId,
    contractAddress: group.contractAddress,
    groupId: group.groupId,
    epoch: group.currentEpoch,
    membershipRevision: group.membershipRevision,
    metadataVersion,
    editor: binding.ownerAddress
  }) satisfies GroupChatV2MetadataContext;
  const encrypted = await encryptGroupChatV2Metadata(plaintext, key, context);
  await retireNonceAttempt(Object.freeze({
    purpose: 'metadata',
    chainId: group.chainId,
    contractAddress: group.contractAddress,
    groupId: group.groupId,
    epoch: group.currentEpoch,
    nonce: encrypted.nonce,
    ownerAddress: binding.ownerAddress
  }));
  await assertBindingSnapshotCurrent(binding);
  const readContract = await groupContract(deployment, capability);
  const contractAadHash = await readContract.deriveMetadataAadHash(
    group.groupId,
    group.currentEpoch,
    group.membershipRevision,
    metadataVersion,
    binding.ownerAddress,
    encrypted.nonce
  );
  if (bytes32(contractAadHash, 'Contract group metadata AAD') !== encrypted.aadHash) {
    throw new Error('Group contract metadata AAD does not match the V2 client.');
  }
  await assertBindingSnapshotCurrent(binding);
  const submitted = await submitGroupWrite(deployment, capability, 'setEncryptedGroupMetadata', [
    group.groupId,
    group.currentEpoch,
    group.adminRevision,
    group.membershipRevision,
    group.metadataVersion,
    encrypted.nonce,
    encrypted.ciphertext
  ]);
  return Object.freeze({ encrypted, context, transaction: transaction(submitted, capability) });
};

export const readGroupChatV2NativeCredit = async ({
  deployment,
  capability
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
}): Promise<bigint> => {
  const binding = resolveReadCapability(capability);
  const credit = uint(
    await (await groupContract(deployment, capability)).pendingNativeCredits(binding.ownerAddress),
    'Pending group native credit'
  );
  resolveReadCapability(capability);
  return credit;
};

export const withdrawGroupChatV2NativeCredit = async ({
  deployment,
  capability
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
}): Promise<Readonly<{ observedCredit: bigint; transaction: GroupChatV2Transaction }>> => {
  await resolveCapability(capability);
  const observedCredit = await readGroupChatV2NativeCredit({ deployment, capability });
  if (observedCredit === 0n) throw new Error('This wallet has no Group Chat V2 credit to withdraw.');
  const submitted = await submitGroupWrite(deployment, capability, 'withdrawNativeCredit', []);
  return Object.freeze({ observedCredit, transaction: transaction(submitted, capability) });
};

export const buildGroupChatV2MessageKey = ({
  chainId,
  contractAddress,
  groupId,
  messageId
}: {
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  messageId: bigint;
}): string => [
  'group-v2',
  uint(chainId, 'Group message chain', UINT256_MAX, false).toString(),
  address(contractAddress, 'Group message contract').toLowerCase(),
  uint(groupId, 'Group message group ID', UINT256_MAX, false).toString(),
  uint(messageId, 'Group message ID', UINT64_MAX, false).toString()
].join(':');

export const parseGroupChatV2MessagePostedLog = ({
  deployment,
  log
}: {
  deployment: VerifiedGroupChatV2Deployment;
  log: unknown;
}): GroupChatV2MessageEvent => {
  const target = verified(deployment);
  if (!log || typeof log !== 'object') throw new Error('Group message log is missing.');
  const raw = log as Record<string, unknown>;
  if (address(raw.address, 'Group message log contract') !== target.contractAddress) {
    throw new Error('Group message log was emitted by an unverified contract.');
  }
  if (
    !Array.isArray(raw.topics) ||
    raw.topics.length !== 4 ||
    raw.topics.some((topic) => typeof topic !== 'string') ||
    String(raw.topics[0]).toLowerCase() !== GROUP_CHAT_V2_MESSAGE_TOPIC.toLowerCase() ||
    typeof raw.data !== 'string'
  ) {
    throw new Error('Group message log does not have canonical event data.');
  }
  let parsed;
  try {
    parsed = GROUP_INTERFACE.parseLog({ topics: raw.topics as string[], data: raw.data });
  } catch {
    throw new Error('Group message log ABI data is malformed.');
  }
  if (!parsed || parsed.name !== 'GroupMessagePosted') {
    throw new Error('Group message log is not GroupMessagePosted.');
  }
  const groupId = uint(field(parsed.args, 'groupId', 0), 'Group event group ID', UINT256_MAX, false);
  const messageId = uint(field(parsed.args, 'messageId', 1), 'Group event message ID', UINT64_MAX, false);
  const sender = address(field(parsed.args, 'sender', 2), 'Group event sender');
  const epoch = uint(field(parsed.args, 'epoch', 3), 'Group event epoch', UINT64_MAX, false);
  const membershipRevision = uint(
    field(parsed.args, 'membershipRevision', 4),
    'Group event membership revision',
    UINT32_MAX,
    false
  );
  const senderSequence = uint(
    field(parsed.args, 'senderSequence', 5),
    'Group event sender sequence',
    UINT64_MAX,
    false
  );
  const nonce = bytes12(field(parsed.args, 'nonce', 6), 'Group event nonce');
  const aadHash = bytes32(field(parsed.args, 'aadHash', 7), 'Group event AAD');
  const encrypted = Object.freeze({
    nonce,
    aadHash,
    ciphertext: ciphertext(field(parsed.args, 'ciphertext', 8))
  });
  const valueSent = uint(field(parsed.args, 'valueSent', 9), 'Group event value');
  const feeTaken = uint(field(parsed.args, 'feeTaken', 10), 'Group event fee');
  if (valueSent !== feeTaken) {
    throw new Error('Group message event value must exactly equal its message fee.');
  }
  const context = Object.freeze({
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId,
    epoch,
    membershipRevision,
    sender,
    senderSequence,
    valueSent,
    feeTaken
  }) satisfies GroupChatV2MessageContext;
  if (deriveGroupChatV2MessageAadHash(context, nonce) !== aadHash) {
    throw new Error('Group message event AAD does not match its canonical context.');
  }
  const transactionHash = bytes32(raw.transactionHash, 'Group message transaction hash');
  const blockHash = bytes32(raw.blockHash, 'Group message block hash');
  const blockNumber = uint(raw.blockNumber, 'Group message block number', UINT256_MAX, false);
  if (blockNumber < target.deploymentBlock) {
    throw new Error('Group message log predates the verified deployment.');
  }
  const logIndex = Number(raw.index ?? raw.logIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw new Error('Group message log index is invalid.');
  }
  if (raw.removed !== undefined && typeof raw.removed !== 'boolean') {
    throw new Error('Group message removed flag is invalid.');
  }
  return Object.freeze({
    protocol: 'group-v2',
    key: buildGroupChatV2MessageKey({
      chainId: target.chainId,
      contractAddress: target.contractAddress,
      groupId,
      messageId
    }),
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId,
    messageId,
    epoch,
    membershipRevision,
    senderSequence,
    sender,
    nonce,
    aadHash,
    ciphertext: encrypted.ciphertext,
    valueSent,
    feeTaken,
    transactionHash,
    blockHash,
    blockNumber,
    logIndex,
    removed: raw.removed === true,
    context,
    encrypted
  });
};

export const readGroupChatV2MessageLogPage = async ({
  deployment,
  capability,
  groupId,
  fromBlock,
  toBlock
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<GroupChatV2MessageEvent[]> => {
  const target = verified(deployment);
  const id = uint(groupId, 'Group history group ID', UINT256_MAX, false);
  const start = uint(fromBlock, 'Group history start block', UINT256_MAX, false);
  const end = uint(toBlock, 'Group history end block', UINT256_MAX, false);
  if (start < target.deploymentBlock || end < start || end - start + 1n > GROUP_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Group message history range is outside the verified bounded page.');
  }
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Group message history range is not safely representable by the provider.');
  }
  await readGroupChatV2Group({ deployment: target, capability, groupId: id });
  const binding = resolveReadCapability(capability);
  const groupTopic = `0x${id.toString(16).padStart(64, '0')}`;
  const logs = await binding.readProvider.getLogs({
    address: target.contractAddress,
    fromBlock: Number(start),
    toBlock: Number(end),
    topics: [GROUP_CHAT_V2_MESSAGE_TOPIC, groupTopic]
  });
  resolveReadCapability(capability);
  const events = logs.map((log) => parseGroupChatV2MessagePostedLog({ deployment: target, log }));
  events.sort((left, right) => left.blockNumber === right.blockNumber
    ? left.logIndex - right.logIndex
    : left.blockNumber < right.blockNumber ? -1 : 1);
  const physical = new Set<string>();
  let previousMessageId = 0n;
  for (const event of events) {
    const physicalId = `${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
    if (
      event.removed ||
      event.groupId !== id ||
      event.blockNumber < start ||
      event.blockNumber > end ||
      event.messageId <= previousMessageId ||
      physical.has(physicalId)
    ) {
      throw new Error('Group message history contains invalid order or provenance.');
    }
    physical.add(physicalId);
    previousMessageId = event.messageId;
  }
  return events;
};

export const parseGroupChatV2MetadataUpdatedLog = ({
  deployment,
  log
}: {
  deployment: VerifiedGroupChatV2Deployment;
  log: unknown;
}): GroupChatV2MetadataEvent => {
  const target = verified(deployment);
  if (!log || typeof log !== 'object') throw new Error('Group metadata log is missing.');
  const raw = log as Record<string, unknown>;
  if (
    address(raw.address, 'Group metadata log contract') !== target.contractAddress ||
    !Array.isArray(raw.topics) ||
    raw.topics.length !== 4 ||
    raw.topics.some((topic) => typeof topic !== 'string') ||
    String(raw.topics[0]).toLowerCase() !== GROUP_CHAT_V2_METADATA_TOPIC.toLowerCase() ||
    typeof raw.data !== 'string'
  ) {
    throw new Error('Group metadata log does not have canonical event data.');
  }
  let parsed;
  try {
    parsed = GROUP_INTERFACE.parseLog({ topics: raw.topics as string[], data: raw.data });
  } catch {
    throw new Error('Group metadata log ABI data is malformed.');
  }
  if (!parsed || parsed.name !== 'EncryptedGroupMetadataUpdated') {
    throw new Error('Group metadata log has the wrong event type.');
  }
  const groupId = uint(field(parsed.args, 'groupId', 0), 'Metadata group ID', UINT256_MAX, false);
  const metadataVersion = uint(
    field(parsed.args, 'metadataVersion', 1),
    'Metadata version',
    UINT64_MAX,
    false
  );
  const editor = address(field(parsed.args, 'editor', 2), 'Metadata editor');
  const epoch = uint(field(parsed.args, 'epoch', 3), 'Metadata epoch', UINT64_MAX, false);
  const membershipRevision = uint(
    field(parsed.args, 'membershipRevision', 4),
    'Metadata membership revision',
    UINT32_MAX,
    false
  );
  const nonce = bytes12(field(parsed.args, 'nonce', 5), 'Metadata nonce');
  const aadHash = bytes32(field(parsed.args, 'aadHash', 6), 'Metadata AAD');
  const encrypted = Object.freeze({
    nonce,
    aadHash,
    ciphertext: ciphertext(field(parsed.args, 'ciphertext', 7))
  });
  const context = Object.freeze({
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId,
    epoch,
    membershipRevision,
    metadataVersion,
    editor
  }) satisfies GroupChatV2MetadataContext;
  if (deriveGroupChatV2MetadataAadHash(context, nonce) !== aadHash) {
    throw new Error('Group metadata event AAD does not match its canonical context.');
  }
  const blockNumber = uint(raw.blockNumber, 'Metadata block number', UINT256_MAX, false);
  if (blockNumber < target.deploymentBlock) {
    throw new Error('Group metadata log predates the verified deployment.');
  }
  const logIndex = Number(raw.index ?? raw.logIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw new Error('Group metadata log index is invalid.');
  }
  if (raw.removed !== undefined && typeof raw.removed !== 'boolean') {
    throw new Error('Group metadata removed flag is invalid.');
  }
  return Object.freeze({
    protocol: 'group-v2',
    chainId: target.chainId,
    contractAddress: target.contractAddress,
    groupId,
    metadataVersion,
    editor,
    epoch,
    membershipRevision,
    nonce,
    aadHash,
    ciphertext: encrypted.ciphertext,
    transactionHash: bytes32(raw.transactionHash, 'Metadata transaction hash'),
    blockHash: bytes32(raw.blockHash, 'Metadata block hash'),
    blockNumber,
    logIndex,
    removed: raw.removed === true,
    context,
    encrypted
  });
};

export const readGroupChatV2MetadataLogPage = async ({
  deployment,
  capability,
  groupId,
  fromBlock,
  toBlock
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<GroupChatV2MetadataEvent[]> => {
  const target = verified(deployment);
  const id = uint(groupId, 'Metadata history group ID', UINT256_MAX, false);
  const start = uint(fromBlock, 'Metadata history start block', UINT256_MAX, false);
  const end = uint(toBlock, 'Metadata history end block', UINT256_MAX, false);
  if (start < target.deploymentBlock || end < start || end - start + 1n > GROUP_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Group metadata range is outside the verified bounded page.');
  }
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Group metadata range is not safely representable by the provider.');
  }
  await readGroupChatV2Group({ deployment: target, capability, groupId: id });
  const binding = resolveReadCapability(capability);
  const groupTopic = `0x${id.toString(16).padStart(64, '0')}`;
  const logs = await binding.readProvider.getLogs({
    address: target.contractAddress,
    fromBlock: Number(start),
    toBlock: Number(end),
    topics: [GROUP_CHAT_V2_METADATA_TOPIC, groupTopic]
  });
  resolveReadCapability(capability);
  const events = logs.map((log) => parseGroupChatV2MetadataUpdatedLog({ deployment: target, log }));
  events.sort((left, right) => left.blockNumber === right.blockNumber
    ? left.logIndex - right.logIndex
    : left.blockNumber < right.blockNumber ? -1 : 1);
  const physical = new Set<string>();
  let previousVersion = 0n;
  for (const event of events) {
    const physicalId = `${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
    if (
      event.removed ||
      event.groupId !== id ||
      event.blockNumber < start ||
      event.blockNumber > end ||
      event.metadataVersion <= previousVersion ||
      physical.has(physicalId)
    ) {
      throw new Error('Group metadata history contains invalid order or provenance.');
    }
    physical.add(physicalId);
    previousVersion = event.metadataVersion;
  }
  return events;
};

const GROUP_LIFECYCLE_KIND = Object.freeze({
  GroupCreated: 'created',
  GroupMemberAdded: 'member-added',
  GroupMemberRemoved: 'member-removed',
  GroupMemberLeft: 'member-left',
  GroupInviteCreated: 'invite-created',
  GroupInviteAccepted: 'invite-accepted',
  GroupInviteDeclined: 'invite-declined',
  GroupInviteRevoked: 'invite-revoked',
  GroupJoinedWithCode: 'joined-with-code'
} as const);

export const readGroupChatV2WalletLifecycleLogPage = async ({
  deployment,
  capability,
  walletAddress,
  fromBlock,
  toBlock
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  walletAddress: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<GroupChatV2WalletLifecycleEvent[]> => {
  const target = verified(deployment);
  const wallet = address(walletAddress, 'Group lifecycle wallet');
  const start = uint(fromBlock, 'Group lifecycle start block', UINT256_MAX, false);
  const end = uint(toBlock, 'Group lifecycle end block', UINT256_MAX, false);
  if (start < target.deploymentBlock || end < start || end - start + 1n > GROUP_CHAT_V2_MAX_LOG_BLOCK_SPAN) {
    throw new Error('Group lifecycle range is outside the verified bounded page.');
  }
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Group lifecycle range is not safely representable by the provider.');
  }
  const binding = resolveReadCapability(capability);
  if (binding.ownerAddress !== wallet) {
    throw new Error('Group lifecycle discovery is scoped to the current owner wallet.');
  }
  const walletTopic = `0x${wallet.slice(2).toLowerCase().padStart(64, '0')}`;
  const logs = await binding.readProvider.getLogs({
    address: target.contractAddress,
    fromBlock: Number(start),
    toBlock: Number(end),
    topics: [[...GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS], null, walletTopic]
  });
  resolveReadCapability(capability);
  const events = logs.map((log): GroupChatV2WalletLifecycleEvent => {
    const raw = log as unknown as Record<string, unknown>;
    if (
      address(raw.address, 'Group lifecycle log contract') !== target.contractAddress ||
      !Array.isArray(raw.topics) ||
      typeof raw.data !== 'string' ||
      raw.removed === true
    ) {
      throw new Error('Group lifecycle log has invalid provenance.');
    }
    let parsed;
    try {
      parsed = GROUP_INTERFACE.parseLog({ topics: raw.topics as string[], data: raw.data });
    } catch {
      throw new Error('Group lifecycle log ABI data is malformed.');
    }
    const kind = parsed ? GROUP_LIFECYCLE_KIND[parsed.name as keyof typeof GROUP_LIFECYCLE_KIND] : undefined;
    if (!parsed || !kind) throw new Error('Group lifecycle event is outside the reviewed discovery set.');
    const eventWallet = address(field(parsed.args, parsed.name === 'GroupCreated' ? 'admin' : 'member', 1), 'Group lifecycle member');
    if (eventWallet !== wallet) throw new Error('Group lifecycle event belongs to another wallet.');
    const blockNumber = uint(raw.blockNumber, 'Group lifecycle block number', UINT256_MAX, false);
    if (blockNumber < start || blockNumber > end) throw new Error('Group lifecycle event is outside its requested range.');
    const logIndex = Number(raw.index ?? raw.logIndex);
    if (!Number.isSafeInteger(logIndex) || logIndex < 0) throw new Error('Group lifecycle log index is invalid.');
    return Object.freeze({
      kind,
      groupId: uint(field(parsed.args, 'groupId', 0), 'Lifecycle group ID', UINT256_MAX, false),
      walletAddress: wallet,
      transactionHash: bytes32(raw.transactionHash, 'Group lifecycle transaction hash'),
      blockHash: bytes32(raw.blockHash, 'Group lifecycle block hash'),
      blockNumber,
      logIndex
    });
  });
  events.sort((left, right) => left.blockNumber === right.blockNumber
    ? left.logIndex - right.logIndex
    : left.blockNumber < right.blockNumber ? -1 : 1);
  const physical = new Set<string>();
  for (const event of events) {
    const identity = `${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
    if (physical.has(identity)) throw new Error('Group lifecycle page contains a duplicate physical log.');
    physical.add(identity);
  }
  return events;
};

export const readGroupChatV2LatestBlockNumber = async ({
  deployment,
  capability
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
}): Promise<bigint> => {
  verified(deployment);
  const binding = resolveReadCapability(capability);
  const blockNumber = uint(
    await binding.readProvider.getBlockNumber(),
    'Latest Group Chat V2 block',
    UINT256_MAX,
    false
  );
  resolveReadCapability(capability);
  return blockNumber;
};

export const readGroupChatV2CanonicalBlock = async ({
  deployment,
  capability,
  blockNumber
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  blockNumber: bigint;
}): Promise<GroupChatV2CanonicalBlock> => {
  const target = verified(deployment);
  const selected = uint(blockNumber, 'Canonical group block', UINT256_MAX, false);
  if (selected < target.deploymentBlock || selected > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Canonical group block is outside the verified provider range.');
  }
  const binding = resolveReadCapability(capability);
  const block = await binding.readProvider.getBlock(Number(selected));
  resolveReadCapability(capability);
  if (!block || BigInt(block.number) !== selected) {
    throw new Error('Canonical group block is unavailable.');
  }
  const timestamp = Number(block.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Canonical group block timestamp is invalid.');
  }
  return Object.freeze({
    blockNumber: selected,
    blockHash: bytes32(block.hash, 'Canonical group block hash'),
    timestamp
  });
};

export const readGroupChatV2MessageCountAtBlock = async ({
  deployment,
  capability,
  groupId,
  blockNumber
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  blockNumber: bigint;
}): Promise<bigint> => {
  const target = verified(deployment);
  const id = uint(groupId, 'Historical group ID', UINT256_MAX, false);
  const selected = uint(blockNumber, 'Historical group block', UINT256_MAX, false);
  if (
    selected < target.deploymentBlock ||
    selected > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error('Historical group block is outside the verified provider range.');
  }
  const contract = await groupContract(target, capability);
  const raw = await contract.getGroup(id, { blockTag: Number(selected) });
  resolveReadCapability(capability);
  if (field(raw, 'exists', 12) !== true) return 0n;
  return uint(field(raw, 'messageCount', 4), 'Historical group message count', UINT64_MAX);
};

export const readGroupChatV2MetadataVersionAtBlock = async ({
  deployment,
  capability,
  groupId,
  blockNumber
}: {
  deployment: VerifiedGroupChatV2Deployment;
  capability: GroupChatV2MetaMaskCapability;
  groupId: bigint;
  blockNumber: bigint;
}): Promise<bigint> => {
  const target = verified(deployment);
  const id = uint(groupId, 'Historical metadata group ID', UINT256_MAX, false);
  const selected = uint(blockNumber, 'Historical metadata block', UINT256_MAX, false);
  if (selected < target.deploymentBlock || selected > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Historical metadata block is outside the verified provider range.');
  }
  const contract = await groupContract(target, capability);
  const raw = await contract.getGroup(id, { blockTag: Number(selected) });
  resolveReadCapability(capability);
  if (field(raw, 'exists', 12) !== true) return 0n;
  return uint(field(raw, 'metadataVersion', 8), 'Historical group metadata version', UINT64_MAX);
};

export const decryptGroupChatV2EventMessage = async ({
  event,
  key
}: {
  event: GroupChatV2MessageEvent;
  key: GroupChatV2EpochKey;
}): Promise<string> => {
  if (
    event.chainId !== key.chainId ||
    event.contractAddress !== address(key.contractAddress, 'Group event key contract') ||
    event.groupId !== key.groupId ||
    event.epoch !== key.epoch ||
    event.membershipRevision !== key.membershipRevision
  ) {
    throw new Error('Group message event does not match the supplied epoch key.');
  }
  return decryptGroupChatV2Message(event.encrypted, key, event.context);
};

export const decryptGroupChatV2MetadataEvent = async ({
  event,
  key
}: {
  event: GroupChatV2MetadataEvent;
  key: GroupChatV2EpochKey;
}): Promise<string> => {
  if (
    event.chainId !== key.chainId ||
    event.contractAddress !== address(key.contractAddress, 'Group metadata key contract') ||
    event.groupId !== key.groupId ||
    event.epoch !== key.epoch ||
    event.membershipRevision !== key.membershipRevision
  ) {
    throw new Error('Group metadata event does not match the supplied epoch key.');
  }
  return decryptGroupChatV2Metadata(event.encrypted, key, event.context);
};

export const parseGroupChatV2MessageReceipt = ({
  deployment,
  receipt,
  expected
}: {
  deployment: VerifiedGroupChatV2Deployment;
  receipt: unknown;
  expected: GroupChatV2ExpectedMessageReceipt;
}): GroupChatV2MessageEvent => {
  const target = verified(deployment);
  if (!receipt || typeof receipt !== 'object') throw new Error('Group message receipt is missing.');
  const raw = receipt as Record<string, unknown>;
  if (uint(raw.status, 'Group message receipt status') !== 1n) {
    throw new Error('Group message transaction did not succeed.');
  }
  const receiptTransactionHash = bytes32(
    raw.hash ?? raw.transactionHash,
    'Group message receipt transaction hash'
  );
  const receiptBlockHash = bytes32(raw.blockHash, 'Group message receipt block hash');
  const receiptBlockNumber = uint(raw.blockNumber, 'Group message receipt block number', UINT256_MAX, false);
  if (!Array.isArray(raw.logs)) throw new Error('Group message receipt has no logs.');
  const candidates = raw.logs.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const value = entry as Record<string, unknown>;
    return typeof value.address === 'string' &&
      value.address.toLowerCase() === target.contractAddress.toLowerCase() &&
      Array.isArray(value.topics) &&
      typeof value.topics[0] === 'string' &&
      value.topics[0].toLowerCase() === GROUP_CHAT_V2_MESSAGE_TOPIC.toLowerCase();
  });
  if (candidates.length !== 1) {
    throw new Error('Group message receipt must contain exactly one GroupMessagePosted event.');
  }
  const event = parseGroupChatV2MessagePostedLog({ deployment: target, log: candidates[0] });
  if (
    event.removed ||
    event.transactionHash !== receiptTransactionHash ||
    event.blockHash !== receiptBlockHash ||
    event.blockNumber !== receiptBlockNumber
  ) {
    throw new Error('Group message receipt provenance does not match its event.');
  }
  const expectedTransactionHash = bytes32(expected.transactionHash, 'Expected group transaction hash');
  const expectedNonce = bytes12(expected.encrypted.nonce, 'Expected group nonce');
  const expectedAadHash = bytes32(expected.encrypted.aadHash, 'Expected group AAD');
  const expectedCiphertext = ciphertext(expected.encrypted.ciphertext);
  if (
    receiptTransactionHash !== expectedTransactionHash ||
    event.context.chainId !== expected.context.chainId ||
    event.context.contractAddress !== address(expected.context.contractAddress, 'Expected group contract') ||
    event.groupId !== expected.context.groupId ||
    event.epoch !== expected.context.epoch ||
    event.membershipRevision !== expected.context.membershipRevision ||
    event.sender !== address(expected.context.sender, 'Expected group sender') ||
    event.senderSequence !== expected.context.senderSequence ||
    event.valueSent !== expected.context.valueSent ||
    event.feeTaken !== expected.context.feeTaken ||
    event.nonce !== expectedNonce ||
    event.aadHash !== expectedAadHash ||
    event.ciphertext !== expectedCiphertext
  ) {
    throw new Error('Group message receipt does not match the submitted encrypted message.');
  }
  return event;
};

export const parseGroupChatV2CreatedReceipt = ({
  deployment,
  receipt,
  expectedTransactionHash,
  expectedAdmin
}: {
  deployment: VerifiedGroupChatV2Deployment;
  receipt: unknown;
  expectedTransactionHash: string;
  expectedAdmin: string;
}): GroupChatV2CreatedEvent => {
  const target = verified(deployment);
  if (!receipt || typeof receipt !== 'object') throw new Error('Group creation receipt is missing.');
  const raw = receipt as Record<string, unknown>;
  if (uint(raw.status, 'Group creation receipt status') !== 1n) {
    throw new Error('Group creation transaction did not succeed.');
  }
  const transactionHash = bytes32(
    raw.hash ?? raw.transactionHash,
    'Group creation transaction hash'
  );
  if (transactionHash !== bytes32(expectedTransactionHash, 'Expected group creation transaction hash')) {
    throw new Error('Group creation receipt belongs to another transaction.');
  }
  const blockHash = bytes32(raw.blockHash, 'Group creation block hash');
  const blockNumber = uint(raw.blockNumber, 'Group creation block number', UINT256_MAX, false);
  if (blockNumber < target.deploymentBlock || !Array.isArray(raw.logs)) {
    throw new Error('Group creation receipt has invalid deployment provenance.');
  }
  const candidates = raw.logs.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const value = entry as Record<string, unknown>;
    return typeof value.address === 'string' &&
      value.address.toLowerCase() === target.contractAddress.toLowerCase() &&
      Array.isArray(value.topics) &&
      typeof value.topics[0] === 'string' &&
      value.topics[0].toLowerCase() === GROUP_CHAT_V2_CREATED_TOPIC.toLowerCase();
  });
  if (candidates.length !== 1) {
    throw new Error('Group creation receipt must contain exactly one GroupCreated event.');
  }
  const log = candidates[0] as Record<string, unknown>;
  if (
    address(log.address, 'Group creation log contract') !== target.contractAddress ||
    bytes32(log.transactionHash, 'Group creation log transaction hash') !== transactionHash ||
    bytes32(log.blockHash, 'Group creation log block hash') !== blockHash ||
    uint(log.blockNumber, 'Group creation log block number', UINT256_MAX, false) !== blockNumber ||
    log.removed === true ||
    !Array.isArray(log.topics) ||
    typeof log.data !== 'string'
  ) {
    throw new Error('Group creation event provenance does not match its receipt.');
  }
  let parsed;
  try {
    parsed = GROUP_INTERFACE.parseLog({ topics: log.topics as string[], data: log.data });
  } catch {
    throw new Error('Group creation event ABI data is malformed.');
  }
  if (!parsed || parsed.name !== 'GroupCreated') throw new Error('Group creation event is invalid.');
  const admin = address(field(parsed.args, 'admin', 1), 'Group creation admin');
  if (admin !== address(expectedAdmin, 'Expected group creation admin')) {
    throw new Error('Group creation event belongs to another admin.');
  }
  const logIndex = Number(log.index ?? log.logIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw new Error('Group creation log index is invalid.');
  }
  return Object.freeze({
    groupId: uint(field(parsed.args, 'groupId', 0), 'Created group ID', UINT256_MAX, false),
    admin,
    membershipRevision: uint(
      field(parsed.args, 'membershipRevision', 2),
      'Created group membership revision',
      UINT32_MAX,
      false
    ),
    adminRevision: uint(
      field(parsed.args, 'adminRevision', 3),
      'Created group admin revision',
      UINT32_MAX,
      false
    ),
    epoch: uint(field(parsed.args, 'epoch', 4), 'Created group epoch', UINT64_MAX, false),
    transactionHash,
    blockHash,
    blockNumber,
    logIndex
  });
};
