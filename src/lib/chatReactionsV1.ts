import { AbiCoder, getAddress, Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';

export const CHAT_REACTIONS_V1_ABI = [
  'function contractVersion() view returns (string)',
  'function PROTOCOL_VERSION() view returns (uint16)',
  'function EMOJI_SET_VERSION() view returns (uint8)',
  'function EMOJI_COUNT() view returns (uint8)',
  'function DIRECT_MESSAGE_ANCHOR_DOMAIN() view returns (bytes32)',
  'function GROUP_MESSAGE_ANCHOR_DOMAIN() view returns (bytes32)',
  'function directChatV2() view returns (address)',
  'function groupChatV2() view returns (address)',
  'function directChatRuntimeHash() view returns (bytes32)',
  'function groupChatRuntimeHash() view returns (bytes32)',
  'function directChatDeploymentBlock() view returns (uint64)',
  'function groupChatDeploymentBlock() view returns (uint64)',
  'function deploymentBlock() view returns (uint64)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function setDirectReaction(bytes32 conversationId,uint64 messageId,bytes32 expectedMessageAnchor,uint8 emojiId,bool active)',
  'function setGroupReaction(uint256 groupId,uint64 messageId,bytes32 expectedMessageAnchor,uint8 emojiId,bool active)',
  'event DirectReactionSet(bytes32 indexed conversationId,uint64 indexed messageId,address indexed reactor,uint8 emojiId,bool active,bytes32 messageAnchor)',
  'event GroupReactionSet(uint256 indexed groupId,uint64 indexed messageId,address indexed reactor,uint8 emojiId,bool active,bytes32 messageAnchor)'
] as const;

const REACTIONS_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);
const ABI_CODER = AbiCoder.defaultAbiCoder();

export const CHAT_REACTIONS_V1_DIRECT_REACTION_TOPIC =
  REACTIONS_INTERFACE.getEvent('DirectReactionSet')?.topicHash ?? '';
export const CHAT_REACTIONS_V1_GROUP_REACTION_TOPIC =
  REACTIONS_INTERFACE.getEvent('GroupReactionSet')?.topicHash ?? '';
export const CHAT_REACTIONS_V1_EMOJI_SET_VERSION = 1;
export const CHAT_REACTIONS_V1_EMOJIS = Object.freeze([
  '👍', '❤️', '😂', '😮', '😢', '🔥', '🫡',
  '🤯', '🌭', '✍️', '🤷‍♂️', '🤪', '💯'
] as const);

export const CHAT_REACTIONS_V1_REQUIRED_FEATURES = Object.freeze([
  'CHAT_REACTIONS_V1', 'EVENT_ONLY_REACTIONS', 'DESIRED_REACTION_STATE',
  'FIXED_EMOJI_IDS', 'IMMUTABLE_CHAT_TARGETS', 'SOURCE_MESSAGE_ANCHORS'
] as const);
export const CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES = Object.freeze([
  'DIRECT_CHAT_V2', 'STABLE_CONVERSATION_MESSAGE_IDS',
  'REACTION_AUTHORIZATION', 'DIRECT_WALLET_AUTHORITY'
] as const);
export const CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES = Object.freeze([
  'GROUP_CHAT_V2', 'STABLE_GROUP_MESSAGE_IDS',
  'REACTION_AUTHORIZATION', 'DIRECT_WALLET_AUTHORITY'
] as const);

export const CHAT_REACTIONS_V1_DIRECT_MESSAGE_ANCHOR_DOMAIN = keccak256(
  toUtf8Bytes('chainwhisper.chat-reactions.v1.direct-message-anchor')
);
export const CHAT_REACTIONS_V1_GROUP_MESSAGE_ANCHOR_DOMAIN = keccak256(
  toUtf8Bytes('chainwhisper.chat-reactions.v1.group-message-anchor')
);

const UINT8_MAX = (1n << 8n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

type Numeric = bigint | number | string;
type FeatureEvidence = Readonly<Record<string, boolean>>;

export type ChatReactionsV1TargetManifestInput = {
  contractAddress: string;
  deploymentBlock: Numeric;
  runtimeBytecodeHash: string;
};

export type ChatReactionsV1ManifestInput = ChatReactionsV1TargetManifestInput & {
  chainId: Numeric;
  directChatV2: ChatReactionsV1TargetManifestInput;
  groupChatV2: ChatReactionsV1TargetManifestInput;
};

export type ChatReactionsV1ContractEvidence = ChatReactionsV1TargetManifestInput & {
  contractVersion: string;
  protocolVersion: Numeric;
  features: FeatureEvidence;
  appWalletExecutor: boolean;
  emojiSetVersion?: Numeric;
  emojiCount?: Numeric;
};

export type ChatReactionsV1ReactionsEvidence = ChatReactionsV1ContractEvidence & {
  directMessageAnchorDomain: string;
  groupMessageAnchorDomain: string;
  pinnedDirectChatV2: ChatReactionsV1TargetManifestInput;
  pinnedGroupChatV2: ChatReactionsV1TargetManifestInput;
};

export type ChatReactionsV1ProvenanceEvidence = {
  chainId: Numeric;
  reactions: ChatReactionsV1ReactionsEvidence;
  directChatV2: ChatReactionsV1ContractEvidence;
  groupChatV2: ChatReactionsV1ContractEvidence;
};

export type ComparedChatReactionsV1Target = Readonly<{
  contractAddress: string;
  deploymentBlock: string;
  runtimeBytecodeHash: string;
}>;

export type ComparedChatReactionsV1Deployment = ComparedChatReactionsV1Target &
  Readonly<{
    chainId: string;
    directChatV2: ComparedChatReactionsV1Target;
    groupChatV2: ComparedChatReactionsV1Target;
  }>;

const DRAFT_PENDING = new WeakSet<object>();
const SUBMITTED_PENDING = new WeakSet<object>();

export type ChatReactionKind = 'direct' | 'group';

export type ChatReactionSource = Readonly<{
  kind: ChatReactionKind;
  chainId: string;
  contractAddress: string;
  conversationId?: string;
  groupId?: string;
  messageId: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}>;

export type ChatReactionTarget = Readonly<{
  kind: ChatReactionKind;
  chainId: string;
  reactionsContract: string;
  targetContract: string;
  conversationId?: string;
  groupId?: string;
  messageId: string;
}>;

export type ChatReactionObservation = Readonly<{
  kind: ChatReactionKind;
  chainId: string;
  reactionsContract: string;
  targetContract: string;
  conversationId?: string;
  groupId?: string;
  messageId: string;
  reactor: string;
  emojiId: number;
  emoji: (typeof CHAT_REACTIONS_V1_EMOJIS)[number];
  active: boolean;
  messageAnchor: string;
  blockHash: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  removed: boolean;
  rawIdentity: string;
  stateKey: string;
}>;

export type ChatReactionCanonicalSourceResolver = (
  target: ChatReactionTarget
) => ChatReactionSource | null | undefined;

export type ChatReactionReducedState = Readonly<{
  accepted: readonly ChatReactionObservation[];
  states: readonly ChatReactionObservation[];
  ignored: readonly Readonly<{
    rawIdentity: string;
    reason: 'missing-source' | 'invalid-source' | 'anchor-mismatch';
  }>[];
}>;

const uint = (value: Numeric, label: string, max: bigint, zero = false): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a safe unsigned integer.`);
  }
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be canonical unsigned decimal.`);
  }
  if (!['bigint', 'number', 'string'].includes(typeof value)) {
    throw new Error(`${label} is not an integer.`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer.`);
  }
  if (parsed < 0n || parsed > max || (!zero && parsed === 0n)) {
    throw new Error(`${label} is outside its allowed range.`);
  }
  return parsed;
};
const uint256 = (value: Numeric, label: string, zero = false) => uint(value, label, UINT256_MAX, zero);
const uint64 = (value: Numeric, label: string, zero = false) => uint(value, label, UINT64_MAX, zero);
const uint8 = (value: Numeric, label: string, zero = false) => uint(value, label, UINT8_MAX, zero);

const address = (value: string, label: string): string => {
  let normalized: string;
  try {
    normalized = getAddress(value.trim());
  } catch {
    throw new Error(`${label} is not a valid address.`);
  }
  if (normalized.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes32 = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized) || normalized === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero canonical bytes32 hex.`);
  }
  return normalized;
};

const index = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
};

const field = (value: unknown, name: string, position: number): unknown => {
  const record = value && typeof value === 'object'
    ? value as Record<string | number, unknown>
    : {};
  return record[name] ?? record[position];
};

const targetManifest = (
  value: ChatReactionsV1TargetManifestInput,
  label: string
): ComparedChatReactionsV1Target => Object.freeze({
  contractAddress: address(value.contractAddress, `${label} address`),
  deploymentBlock: uint64(value.deploymentBlock, `${label} deployment block`).toString(),
  runtimeBytecodeHash: bytes32(value.runtimeBytecodeHash, `${label} runtime hash`)
});

const features = (value: FeatureEvidence, required: readonly string[], label: string): void => {
  if (!value || required.some((feature) => value[feature] !== true)) {
    throw new Error(`${label} is missing a required feature.`);
  }
};

const sameTarget = (
  left: ComparedChatReactionsV1Target,
  right: ComparedChatReactionsV1Target
): boolean => left.contractAddress === right.contractAddress &&
  left.deploymentBlock === right.deploymentBlock &&
  left.runtimeBytecodeHash === right.runtimeBytecodeHash;

const verifyTargetEvidence = (
  expected: ComparedChatReactionsV1Target,
  evidence: ChatReactionsV1ContractEvidence,
  version: string,
  required: readonly string[],
  label: string
): void => {
  if (!sameTarget(expected, targetManifest(evidence, label))) {
    throw new Error(`${label} provenance does not match its frozen manifest.`);
  }
  if (evidence.contractVersion !== version || uint(evidence.protocolVersion, `${label} protocol`, 65_535n) !== 2n) {
    throw new Error(`${label} version or protocol is invalid.`);
  }
  features(evidence.features, required, label);
  if (evidence.appWalletExecutor !== false) throw new Error(`${label} advertises app-wallet execution.`);
};

/**
 * Pure, untrusted comparison only. This function proves that two caller-owned
 * structures agree; it does not prove that either structure came from a chain.
 * Only chatReactionsV1Chain can attest and brand a usable deployment.
 */
export const compareChatReactionsV1Provenance = (
  manifest: ChatReactionsV1ManifestInput,
  evidence: ChatReactionsV1ProvenanceEvidence
): ComparedChatReactionsV1Deployment => {
  const reactions = targetManifest(manifest, 'Reactions');
  const directChatV2 = targetManifest(manifest.directChatV2, 'Direct Chat V2');
  const groupChatV2 = targetManifest(manifest.groupChatV2, 'Group Chat V2');
  if (new Set([reactions, directChatV2, groupChatV2].map((item) => item.contractAddress.toLowerCase())).size !== 3) {
    throw new Error('Reactions and chat target addresses must be distinct.');
  }
  const chainId = uint256(manifest.chainId, 'Manifest chain ID').toString();
  if (uint256(evidence.chainId, 'Evidence chain ID').toString() !== chainId ||
      !sameTarget(reactions, targetManifest(evidence.reactions, 'Observed reactions'))) {
    throw new Error('Reactions provenance does not match its frozen manifest.');
  }
  const own = evidence.reactions;
  if (!sameTarget(directChatV2, targetManifest(own.pinnedDirectChatV2, 'Pinned Direct Chat V2')) ||
      !sameTarget(groupChatV2, targetManifest(own.pinnedGroupChatV2, 'Pinned Group Chat V2'))) {
    throw new Error('Reactions immutable chat targets do not match the frozen manifests.');
  }
  if (own.contractVersion !== 'ChatReactionsV1' ||
      uint(own.protocolVersion, 'Reactions protocol', 65_535n) !== 1n ||
      uint8(own.emojiSetVersion as Numeric, 'Emoji set version') !== 1n ||
      uint8(own.emojiCount as Numeric, 'Emoji count') !== BigInt(CHAT_REACTIONS_V1_EMOJIS.length) ||
      bytes32(own.directMessageAnchorDomain, 'Direct anchor domain') !==
        CHAT_REACTIONS_V1_DIRECT_MESSAGE_ANCHOR_DOMAIN ||
      bytes32(own.groupMessageAnchorDomain, 'Group anchor domain') !==
        CHAT_REACTIONS_V1_GROUP_MESSAGE_ANCHOR_DOMAIN) {
    throw new Error('Reactions version or emoji set is invalid.');
  }
  features(own.features, CHAT_REACTIONS_V1_REQUIRED_FEATURES, 'Reactions');
  if (own.appWalletExecutor !== false) throw new Error('Reactions advertises app-wallet execution.');
  verifyTargetEvidence(
    directChatV2, evidence.directChatV2, 'ChainWhisperChatV2',
    CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES, 'Direct Chat V2'
  );
  verifyTargetEvidence(
    groupChatV2, evidence.groupChatV2, 'ChainWhisperGroupChatV2',
    CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES, 'Group Chat V2'
  );
  return Object.freeze({ ...reactions, chainId, directChatV2, groupChatV2 });
};

export const getChatReactionEmoji = (emojiId: Numeric) => {
  const id = uint8(emojiId, 'Emoji ID');
  if (id > BigInt(CHAT_REACTIONS_V1_EMOJIS.length)) throw new Error('Emoji ID is outside set version 1.');
  return CHAT_REACTIONS_V1_EMOJIS[Number(id) - 1];
};

export const getChatReactionEmojiId = (emoji: string): number => {
  const id = CHAT_REACTIONS_V1_EMOJIS.findIndex((item) => item === emoji) + 1;
  if (!id) throw new Error('Emoji is outside ChatReactionsV1 set version 1.');
  return id;
};

export const deriveDirectChatReactionAnchor = (source: {
  chainId: Numeric;
  contractAddress: string;
  conversationId: string;
  messageId: Numeric;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}): string => keccak256(ABI_CODER.encode(
  ['bytes32', 'uint16', 'uint256', 'address', 'bytes32', 'uint64', 'bytes32', 'bytes32', 'uint256'],
  [CHAT_REACTIONS_V1_DIRECT_MESSAGE_ANCHOR_DOMAIN, 1, uint256(source.chainId, 'Source chain ID'),
    address(source.contractAddress, 'Direct target'), bytes32(source.conversationId, 'Conversation ID'),
    uint64(source.messageId, 'Source message ID'), bytes32(source.blockHash, 'Source block hash'),
    bytes32(source.transactionHash, 'Source transaction hash'), BigInt(index(source.logIndex, 'Source log index'))]
));

export const deriveGroupChatReactionAnchor = (source: {
  chainId: Numeric;
  contractAddress: string;
  groupId: Numeric;
  messageId: Numeric;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}): string => keccak256(ABI_CODER.encode(
  ['bytes32', 'uint16', 'uint256', 'address', 'uint256', 'uint64', 'bytes32', 'bytes32', 'uint256'],
  [CHAT_REACTIONS_V1_GROUP_MESSAGE_ANCHOR_DOMAIN, 1, uint256(source.chainId, 'Source chain ID'),
    address(source.contractAddress, 'Group target'), uint256(source.groupId, 'Group ID'),
    uint64(source.messageId, 'Source message ID'), bytes32(source.blockHash, 'Source block hash'),
    bytes32(source.transactionHash, 'Source transaction hash'), BigInt(index(source.logIndex, 'Source log index'))]
));

export const normalizeChatReactionSource = (source: ChatReactionSource): ChatReactionSource => {
  const normalized = {
    kind: source.kind,
    chainId: uint256(source.chainId, 'Source chain ID').toString(),
    contractAddress: address(source.contractAddress, 'Source contract'),
    messageId: uint64(source.messageId, 'Source message ID').toString(),
    blockHash: bytes32(source.blockHash, 'Source block hash'),
    transactionHash: bytes32(source.transactionHash, 'Source transaction hash'),
    logIndex: index(source.logIndex, 'Source log index')
  };
  if (source.kind === 'direct') return Object.freeze({
    ...normalized,
    conversationId: bytes32(source.conversationId ?? '', 'Source conversation ID')
  });
  if (source.kind === 'group') return Object.freeze({
    ...normalized,
    groupId: uint256(source.groupId as string, 'Source group ID').toString()
  });
  throw new Error('Source kind is invalid.');
};

export const chatReactionStableTargetKey = (value: ChatReactionSource | ChatReactionTarget): string => {
  const stableId = value.kind === 'direct' ? value.conversationId : value.groupId;
  return `${value.kind}:${value.chainId}:${
    'targetContract' in value ? value.targetContract.toLowerCase() : value.contractAddress.toLowerCase()
  }:${stableId}:${value.messageId}`;
};

const normalizeTarget = (target: ChatReactionTarget): ChatReactionTarget => {
  const normalized = {
    kind: target.kind,
    chainId: uint256(target.chainId, 'Reaction target chain ID').toString(),
    reactionsContract: address(target.reactionsContract, 'Reactions contract'),
    targetContract: address(target.targetContract, 'Chat target contract'),
    messageId: uint64(target.messageId, 'Reaction target message ID').toString()
  };
  if (target.kind === 'direct') return Object.freeze({
    ...normalized,
    conversationId: bytes32(target.conversationId ?? '', 'Reaction target conversation ID')
  });
  if (target.kind === 'group') return Object.freeze({
    ...normalized,
    groupId: uint256(target.groupId as string, 'Reaction target group ID').toString()
  });
  throw new Error('Reaction target kind is invalid.');
};

export const deriveChatReactionSourceAnchor = (input: ChatReactionSource): string => {
  const source = normalizeChatReactionSource(input);
  return source.kind === 'direct'
    ? deriveDirectChatReactionAnchor({
        ...source,
        conversationId: source.conversationId ?? ''
      })
    : deriveGroupChatReactionAnchor({
        ...source,
        groupId: source.groupId as string
      });
};

export const createChatReactionSourceResolver = (
  sources: readonly ChatReactionSource[]
): ChatReactionCanonicalSourceResolver => {
  const map = new Map<string, ChatReactionSource>();
  for (const input of sources) {
    const source = normalizeChatReactionSource(input);
    const key = chatReactionStableTargetKey(source);
    if (map.has(key)) throw new Error('Canonical sources contain a duplicate stable message ID.');
    map.set(key, source);
  }
  return (target) => map.get(chatReactionStableTargetKey(target)) ?? null;
};

export const chatReactionTargetOf = (observation: ChatReactionObservation): ChatReactionTarget => ({
  kind: observation.kind,
  chainId: observation.chainId,
  reactionsContract: observation.reactionsContract,
  targetContract: observation.targetContract,
  conversationId: observation.conversationId,
  groupId: observation.groupId,
  messageId: observation.messageId
});

const stateKey = (target: ChatReactionTarget, reactor: string, emojiId: number): string =>
  `reaction-state-v1:${chatReactionStableTargetKey(target)}:${target.reactionsContract.toLowerCase()}:${reactor.toLowerCase()}:${emojiId}`;

export const parseChatReactionsV1Log = ({
  deployment: inputDeployment,
  observedChainId,
  log
}: {
  deployment: ComparedChatReactionsV1Deployment;
  observedChainId: Numeric;
  log: unknown;
}): ChatReactionObservation => {
  const deployment = inputDeployment;
  if (!deployment || typeof deployment !== 'object') {
    throw new Error('A compared ChatReactionsV1 deployment is required to decode logs.');
  }
  if (uint256(observedChainId, 'Observed chain ID').toString() !== deployment.chainId) {
    throw new Error('Reaction log chain does not match the verified deployment.');
  }
  if (!log || typeof log !== 'object') throw new Error('Reaction log is missing.');
  const raw = log as Record<string, unknown>;
  const reactionsContract = address(String(raw.address ?? ''), 'Reaction log address');
  if (reactionsContract !== deployment.contractAddress) throw new Error('Reaction log address is unverified.');
  const topics = raw.topics;
  if (!Array.isArray(topics) || topics.length !== 4 ||
      topics.some((topic) => typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic))) {
    throw new Error('Reaction topics are not canonical.');
  }
  const topic = String(topics[0]).toLowerCase();
  const kind: ChatReactionKind = topic === CHAT_REACTIONS_V1_DIRECT_REACTION_TOPIC.toLowerCase()
    ? 'direct'
    : topic === CHAT_REACTIONS_V1_GROUP_REACTION_TOPIC.toLowerCase()
      ? 'group'
      : (() => { throw new Error('Reaction event topic is unknown.'); })();
  if (typeof raw.data !== 'string' || !/^0x[0-9a-fA-F]{192}$/.test(raw.data)) {
    throw new Error('Reaction data is not the exact canonical ABI length.');
  }
  let parsed;
  try {
    parsed = REACTIONS_INTERFACE.parseLog({ topics: topics as string[], data: raw.data });
  } catch {
    throw new Error('Reaction ABI data is malformed.');
  }
  const eventName = kind === 'direct' ? 'DirectReactionSet' : 'GroupReactionSet';
  if (!parsed || parsed.name !== eventName) throw new Error(`Reaction log is not ${eventName}.`);
  const canonical = REACTIONS_INTERFACE.encodeEventLog(parsed.fragment, [
    field(parsed.args, kind === 'direct' ? 'conversationId' : 'groupId', 0),
    field(parsed.args, 'messageId', 1),
    field(parsed.args, 'reactor', 2),
    field(parsed.args, 'emojiId', 3),
    field(parsed.args, 'active', 4),
    field(parsed.args, 'messageAnchor', 5)
  ]);
  if (canonical.data.toLowerCase() !== raw.data.toLowerCase() ||
      canonical.topics.length !== topics.length ||
      canonical.topics.some((value, position) => value.toLowerCase() !== String(topics[position]).toLowerCase())) {
    throw new Error('Reaction log is not canonical ABI encoding.');
  }

  const messageId = uint64(field(parsed.args, 'messageId', 1) as Numeric, 'Reaction message ID').toString();
  const reactor = address(String(field(parsed.args, 'reactor', 2)), 'Reactor');
  const emojiId = Number(uint8(field(parsed.args, 'emojiId', 3) as Numeric, 'Emoji ID'));
  const active = field(parsed.args, 'active', 4);
  if (typeof active !== 'boolean') throw new Error('Reaction desired state is malformed.');
  const messageAnchor = bytes32(String(field(parsed.args, 'messageAnchor', 5)), 'Message anchor');
  const blockHash = bytes32(String(raw.blockHash ?? ''), 'Reaction block hash');
  const transactionHash = bytes32(String(raw.transactionHash ?? ''), 'Reaction transaction hash');
  const blockNumber = uint256(raw.blockNumber as Numeric, 'Reaction block number').toString();
  if (BigInt(blockNumber) < BigInt(deployment.deploymentBlock)) throw new Error('Reaction predates deployment.');
  const transactionIndex = index(raw.transactionIndex, 'Reaction transaction index');
  const hasIndex = Object.prototype.hasOwnProperty.call(raw, 'index');
  const hasLogIndex = Object.prototype.hasOwnProperty.call(raw, 'logIndex');
  if (!hasIndex && !hasLogIndex) throw new Error('Reaction log index is missing.');
  const parsedIndex = hasIndex ? index(raw.index, 'Reaction log index') : undefined;
  const parsedLogIndex = hasLogIndex ? index(raw.logIndex, 'Reaction log index') : undefined;
  if (parsedIndex !== undefined && parsedLogIndex !== undefined && parsedIndex !== parsedLogIndex) {
    throw new Error('Reaction index and logIndex disagree.');
  }
  const logIndex = parsedIndex ?? parsedLogIndex as number;
  if (typeof raw.removed !== 'boolean') throw new Error('Reaction removed flag must be explicit.');
  const targetContract = kind === 'direct'
    ? deployment.directChatV2.contractAddress
    : deployment.groupChatV2.contractAddress;
  const stableId = field(parsed.args, kind === 'direct' ? 'conversationId' : 'groupId', 0);
  const conversationId = kind === 'direct' ? bytes32(String(stableId), 'Conversation ID') : undefined;
  const groupId = kind === 'group' ? uint256(stableId as Numeric, 'Group ID').toString() : undefined;
  const target: ChatReactionTarget = {
    kind, chainId: deployment.chainId, reactionsContract, targetContract,
    conversationId, groupId, messageId
  };
  const rawIdentity = [
    'reaction-log-v1', deployment.chainId, reactionsContract.toLowerCase(),
    blockHash, transactionHash, logIndex
  ].join(':');
  const observation = Object.freeze({
    ...target,
    reactor,
    emojiId,
    emoji: getChatReactionEmoji(emojiId),
    active,
    messageAnchor,
    blockHash,
    blockNumber,
    transactionHash,
    transactionIndex,
    logIndex,
    removed: raw.removed,
    rawIdentity,
    stateKey: stateKey(target, reactor, emojiId)
  });
  return observation;
};

export const compareChatReactionObservationOrder = (left: ChatReactionObservation, right: ChatReactionObservation): number => {
  const blockDifference = BigInt(left.blockNumber) - BigInt(right.blockNumber);
  if (blockDifference) return blockDifference < 0n ? -1 : 1;
  return left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex || left.rawIdentity.localeCompare(right.rawIdentity);
};

export const chatReactionObservationsEqual = (
  left: ChatReactionObservation,
  right: ChatReactionObservation
): boolean => left.kind === right.kind &&
  left.chainId === right.chainId &&
  left.reactionsContract === right.reactionsContract &&
  left.targetContract === right.targetContract &&
  left.conversationId === right.conversationId &&
  left.groupId === right.groupId &&
  left.messageId === right.messageId &&
  left.reactor === right.reactor &&
  left.emojiId === right.emojiId &&
  left.emoji === right.emoji &&
  left.active === right.active &&
  left.messageAnchor === right.messageAnchor &&
  left.blockHash === right.blockHash &&
  left.blockNumber === right.blockNumber &&
  left.transactionHash === right.transactionHash &&
  left.transactionIndex === right.transactionIndex &&
  left.logIndex === right.logIndex &&
  left.removed === right.removed &&
  left.rawIdentity === right.rawIdentity &&
  left.stateKey === right.stateKey;

export type ChatReactionPendingInput = {
  target: ChatReactionTarget;
  reactor: string;
  emojiId: Numeric;
  active: boolean;
  messageAnchor: string;
  operationId: string;
};

type ChatReactionPendingBase = Readonly<{
  identity: string;
  stateKey: string;
  messageAnchor: string;
  active: boolean;
  operationIdHash: string;
}>;

export type DraftChatReactionPending = ChatReactionPendingBase & Readonly<{
  stage: 'draft';
  originalTransactionHash: null;
  effectiveTransactionHash: null;
}>;

export type SubmittedChatReactionPending = ChatReactionPendingBase & Readonly<{
  stage: 'submitted';
  originalTransactionHash: string;
  effectiveTransactionHash: string;
}>;

export const buildChatReactionPending = (input: ChatReactionPendingInput): DraftChatReactionPending => {
  if (typeof input.active !== 'boolean') throw new Error('Pending desired state must be boolean.');
  const emojiId = Number(uint8(input.emojiId, 'Pending emoji ID'));
  getChatReactionEmoji(emojiId);
  const reactor = address(input.reactor, 'Pending reactor');
  const messageAnchor = bytes32(input.messageAnchor, 'Pending message anchor');
  const operationId = input.operationId.trim();
  if (!operationId || operationId.length > 256) throw new Error('Operation ID must contain 1 to 256 characters.');
  const key = stateKey(normalizeTarget(input.target), reactor, emojiId);
  const operationIdHash = keccak256(toUtf8Bytes(operationId));
  const pending = Object.freeze({
    identity: ['reaction-pending-v1', key, messageAnchor, input.active ? 1 : 0, operationIdHash, 'draft'].join(':'),
    stage: 'draft',
    stateKey: key,
    messageAnchor,
    active: input.active,
    operationIdHash,
    originalTransactionHash: null,
    effectiveTransactionHash: null
  });
  DRAFT_PENDING.add(pending);
  return pending;
};

const submittedPending = (
  pending: DraftChatReactionPending | SubmittedChatReactionPending,
  originalTransactionHash: string,
  effectiveTransactionHash: string
): SubmittedChatReactionPending => {
  const submitted = Object.freeze({
    ...pending,
    identity: [
      'reaction-pending-v1', pending.stateKey, pending.messageAnchor, pending.active ? 1 : 0,
      pending.operationIdHash, originalTransactionHash, effectiveTransactionHash
    ].join(':'),
    stage: 'submitted' as const,
    originalTransactionHash,
    effectiveTransactionHash
  });
  SUBMITTED_PENDING.add(submitted);
  return submitted;
};

export const bindChatReactionPendingTransaction = (
  pending: DraftChatReactionPending,
  transactionHash: string
): SubmittedChatReactionPending => {
  if (pending.stage !== 'draft' || !DRAFT_PENDING.has(pending)) {
    throw new Error('Only a verified draft reaction can bind its original transaction.');
  }
  const hash = bytes32(transactionHash, 'Pending transaction hash');
  return submittedPending(pending, hash, hash);
};

export const replaceChatReactionPendingTransaction = (
  pending: SubmittedChatReactionPending,
  replacementTransactionHash: string
): SubmittedChatReactionPending => {
  if (pending.stage !== 'submitted' || !SUBMITTED_PENDING.has(pending)) {
    throw new Error('Only a verified submitted reaction can bind a replacement.');
  }
  // The future transaction session must first prove that the replacement kept
  // the exact chain/from/to/value/calldata; this pure identity helper has no provider.
  return submittedPending(
    pending,
    pending.originalTransactionHash,
    bytes32(replacementTransactionHash, 'Replacement transaction hash')
  );
};

/** Used only by the chain-attested pending receipt sink. */
export const isSubmittedChatReactionPending = (
  pending: SubmittedChatReactionPending
): boolean => pending.stage === 'submitted' && SUBMITTED_PENDING.has(pending);
