import {
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import {
  CHAT_REACTIONS_V1_ABI,
  CHAT_REACTIONS_V1_DIRECT_REACTION_TOPIC,
  CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES,
  CHAT_REACTIONS_V1_GROUP_REACTION_TOPIC,
  CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES,
  CHAT_REACTIONS_V1_REQUIRED_FEATURES,
  chatReactionObservationsEqual,
  chatReactionStableTargetKey,
  chatReactionTargetOf,
  compareChatReactionObservationOrder,
  compareChatReactionsV1Provenance,
  deriveChatReactionSourceAnchor,
  isSubmittedChatReactionPending,
  normalizeChatReactionSource,
  parseChatReactionsV1Log,
  type ChatReactionCanonicalSourceResolver,
  type ChatReactionObservation,
  type ChatReactionReducedState,
  type ChatReactionSource,
  type ChatReactionsV1ContractEvidence,
  type ChatReactionsV1ManifestInput,
  type ChatReactionsV1ProvenanceEvidence,
  type ComparedChatReactionsV1Deployment,
  type SubmittedChatReactionPending
} from './chatReactionsV1';

const REACTIONS_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

declare const CHAT_REACTIONS_V1_READ_CAPABILITY_BRAND: unique symbol;
export type ChatReactionsV1ReadCapability = Readonly<{
  readonly [CHAT_REACTIONS_V1_READ_CAPABILITY_BRAND]: true;
}>;

declare const ATTESTED_CHAT_REACTIONS_V1_DEPLOYMENT_BRAND: unique symbol;
export type AttestedChatReactionsV1Deployment = ComparedChatReactionsV1Deployment & Readonly<{
  attestationBlock: ChatReactionsV1CanonicalBlock;
  readonly [ATTESTED_CHAT_REACTIONS_V1_DEPLOYMENT_BRAND]: true;
}>;

declare const CANONICAL_CHAT_REACTION_OBSERVATION_BRAND: unique symbol;
export type CanonicalChatReactionObservation = Omit<ChatReactionObservation, 'removed'> & Readonly<{
  removed: false;
  readonly [CANONICAL_CHAT_REACTION_OBSERVATION_BRAND]: true;
}>;

declare const CANONICAL_CHAT_REACTION_RANGE_PAGE_BRAND: unique symbol;
export type CanonicalChatReactionRangePage = Readonly<{
  range: Readonly<{
    fromBlock: string;
    toBlock: string;
    fromBlockHash: string;
    toBlockHash: string;
  }>;
  safeHead: ChatReactionsV1CanonicalBlock;
  checkedBlocks: readonly ChatReactionsV1CanonicalBlock[];
  finalityLagBlocks: string;
  observations: readonly CanonicalChatReactionObservation[];
  readonly [CANONICAL_CHAT_REACTION_RANGE_PAGE_BRAND]: true;
}>;

export type ChatReactionsV1CanonicalBlock = Readonly<{
  number: string;
  hash: string;
}>;

export type ChatReactionsV1FinalityPolicy = Readonly<{
  safeHeadLagBlocks: bigint;
}>;

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type CapabilityBinding = Readonly<{
  provider: ReadProvider;
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}>;
type DeploymentBinding = Readonly<{
  capability: ChatReactionsV1ReadCapability;
  compared: ComparedChatReactionsV1Deployment;
  finalityLagBlocks: bigint;
}>;
type ObservationBinding = Readonly<{
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  pageToken: object;
}>;
type PageBinding = Readonly<{
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  pageToken: object;
}>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const DEPLOYMENTS = new WeakMap<object, DeploymentBinding>();
const OBSERVATIONS = new WeakMap<object, ObservationBinding>();
const PAGES = new WeakMap<object, PageBinding>();

export const CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS = 2_048n;
export const CHAT_REACTIONS_V1_MAX_LOGS_PER_RANGE = 4_096;
const DENSE_RANGE_ERRORS = new WeakSet<object>();

export const isChatReactionsV1DenseRangeError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && DENSE_RANGE_ERRORS.has(error));

const canonicalQuantity = (value: unknown, label: string, max = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > max) throw new Error(`${label} is outside its allowed range.`);
  return parsed;
};

const manifestUint = (value: bigint | number | string, label: string, max = UINT256_MAX): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a safe unsigned integer.`);
  }
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be canonical unsigned decimal.`);
  }
  if (!['bigint', 'number', 'string'].includes(typeof value)) {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > max) throw new Error(`${label} is outside its allowed range.`);
  return parsed;
};

const quantityHex = (value: bigint): string => `0x${value.toString(16)}`;

const canonicalBytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32 hex.`);
  }
  return value.toLowerCase();
};

const canonicalAddress = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is not a canonical address.`);
  let normalized: string;
  try {
    normalized = getAddress(value);
  } catch {
    throw new Error(`${label} is not a valid address.`);
  }
  if (normalized.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const canonicalBytes = (value: unknown, label: string, empty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  if (!empty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const safeNumber = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds JavaScript's safe range.`);
  return Number(value);
};

const normalizePolicy = (policy: ChatReactionsV1FinalityPolicy): bigint => {
  if (!policy || typeof policy.safeHeadLagBlocks !== 'bigint' ||
      policy.safeHeadLagBlocks <= 0n || policy.safeHeadLagBlocks > UINT64_MAX) {
    throw new Error('Reaction safe-head lag must be a non-zero uint64 bigint.');
  }
  return policy.safeHeadLagBlocks;
};

const normalizeManifestTarget = (
  value: ChatReactionsV1ManifestInput['directChatV2'],
  label: string
) => ({
  contractAddress: canonicalAddress(value.contractAddress, `${label} address`),
  deploymentBlock: manifestUint(value.deploymentBlock, `${label} deployment block`, UINT64_MAX),
  runtimeBytecodeHash: canonicalBytes32(value.runtimeBytecodeHash, `${label} runtime hash`)
});

const normalizeManifest = (manifest: ChatReactionsV1ManifestInput) => {
  if (!manifest) throw new Error('ChatReactionsV1 manifest is required.');
  const reactions = normalizeManifestTarget(manifest, 'Reactions');
  const directChatV2 = normalizeManifestTarget(manifest.directChatV2, 'Direct Chat V2');
  const groupChatV2 = normalizeManifestTarget(manifest.groupChatV2, 'Group Chat V2');
  const chainId = manifestUint(manifest.chainId, 'Manifest chain ID');
  if (chainId === 0n) throw new Error('Manifest chain ID cannot be zero.');
  if (new Set([reactions, directChatV2, groupChatV2].map((item) => item.contractAddress.toLowerCase())).size !== 3) {
    throw new Error('Reaction and chat deployment addresses must be distinct.');
  }
  return { chainId, reactions, directChatV2, groupChatV2 };
};

const capabilityBinding = (capability: ChatReactionsV1ReadCapability): CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('ChatReactionsV1 requires an exact current EIP-1193 read capability.');
  return binding;
};

const rpc = async (
  binding: CapabilityBinding,
  method: string,
  params: readonly unknown[] = []
): Promise<unknown> => {
  await binding.assertCurrent();
  let result: unknown;
  try {
    result = await binding.request({ method, params: [...params] });
  } catch {
    throw new Error(`ChatReactionsV1 RPC ${method} failed.`);
  }
  await binding.assertCurrent();
  return result;
};

const assertChain = async (binding: CapabilityBinding): Promise<void> => {
  const chainId = canonicalQuantity(await rpc(binding, 'eth_chainId'), 'RPC chain ID');
  if (chainId !== binding.chainId) throw new Error('ChatReactionsV1 read capability chain changed.');
};

export const bindChatReactionsV1ReadCapability = async ({
  provider,
  expectedChainId,
  assertCurrent
}: {
  provider: ReadProvider;
  expectedChainId: bigint;
  assertCurrent: () => void | Promise<void>;
}): Promise<ChatReactionsV1ReadCapability> => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' ||
      typeof expectedChainId !== 'bigint' || expectedChainId <= 0n || expectedChainId > UINT256_MAX) {
    throw new Error('Cannot bind an invalid ChatReactionsV1 read capability.');
  }
  const binding = Object.freeze({
    provider,
    request: provider.request.bind(provider),
    chainId: expectedChainId,
    assertCurrent
  });
  await assertChain(binding);
  const capability = Object.freeze({}) as ChatReactionsV1ReadCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

type RpcBlock = Readonly<{
  number: bigint;
  hash: string;
  transactions: readonly string[];
}>;

const parseBlock = (value: unknown, expectedNumber: bigint, label: string): RpcBlock => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  const number = canonicalQuantity(raw.number, `${label} number`);
  if (number !== expectedNumber) throw new Error(`${label} returned the wrong number.`);
  if (!Array.isArray(raw.transactions)) throw new Error(`${label} transaction list is missing.`);
  return Object.freeze({
    number,
    hash: canonicalBytes32(raw.hash, `${label} hash`),
    transactions: Object.freeze(raw.transactions.map((value, position) =>
      canonicalBytes32(value, `${label} transaction ${position}`)
    ))
  });
};

const readBlock = async (binding: CapabilityBinding, number: bigint, label: string): Promise<RpcBlock> =>
  parseBlock(
    await rpc(binding, 'eth_getBlockByNumber', [quantityHex(number), false]),
    number,
    label
  );

const readSafeHead = async (binding: CapabilityBinding, lag: bigint) => {
  await assertChain(binding);
  const latest = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Latest block number');
  if (latest < lag) throw new Error('Reaction safe head is below genesis.');
  const safeNumber = latest - lag;
  const safeBlock = await readBlock(binding, safeNumber, 'Reaction safe-head block');
  return { latest, safeBlock };
};

const eip1898 = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const readCode = async (
  binding: CapabilityBinding,
  contractAddress: string,
  blockHash: string,
  label: string
): Promise<string> => canonicalBytes(
  await rpc(binding, 'eth_getCode', [contractAddress, eip1898(blockHash)]),
  `${label} runtime bytecode`
);

const readGetter = async (
  binding: CapabilityBinding,
  contractAddress: string,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => {
  const data = REACTIONS_INTERFACE.encodeFunctionData(functionName, [...args]);
  const raw = canonicalBytes(
    await rpc(binding, 'eth_call', [{ to: contractAddress, data }, eip1898(blockHash)]),
    `${functionName} result`,
    true
  );
  let decoded;
  try {
    decoded = REACTIONS_INTERFACE.decodeFunctionResult(functionName, raw);
  } catch {
    throw new Error(`${functionName} returned malformed ABI data.`);
  }
  const canonical = REACTIONS_INTERFACE.encodeFunctionResult(functionName, [...decoded]);
  if (canonical.toLowerCase() !== raw) throw new Error(`${functionName} returned noncanonical ABI data.`);
  if (decoded.length !== 1) throw new Error(`${functionName} returned an unexpected result shape.`);
  return decoded[0];
};

const readFeatures = async (
  binding: CapabilityBinding,
  contractAddress: string,
  required: readonly string[],
  blockHash: string
): Promise<Record<string, boolean>> => {
  const entries: Array<readonly [string, boolean]> = [];
  for (const feature of required) {
    const supported = await readGetter(
      binding,
      contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes(feature))],
      blockHash
    );
    if (typeof supported !== 'boolean') throw new Error('supportsFeature returned a non-boolean value.');
    entries.push([feature, supported]);
  }
  return Object.fromEntries(entries);
};

const readTargetEvidence = async ({
  binding,
  contractAddress,
  runtimeBytecodeHash,
  required,
  blockHash
}: {
  binding: CapabilityBinding;
  contractAddress: string;
  runtimeBytecodeHash: string;
  required: readonly string[];
  blockHash: string;
}): Promise<ChatReactionsV1ContractEvidence> => {
  const [contractVersion, protocolVersion, deploymentBlock, features, appWalletExecutor] = [
    await readGetter(binding, contractAddress, 'contractVersion', [], blockHash),
    await readGetter(binding, contractAddress, 'PROTOCOL_VERSION', [], blockHash),
    await readGetter(binding, contractAddress, 'deploymentBlock', [], blockHash),
    await readFeatures(binding, contractAddress, required, blockHash),
    await readGetter(
      binding,
      contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
      blockHash
    )
  ] as const;
  if (typeof contractVersion !== 'string' || typeof appWalletExecutor !== 'boolean') {
    throw new Error('Chat target metadata has an invalid ABI type.');
  }
  return {
    contractAddress,
    deploymentBlock: BigInt(deploymentBlock as bigint).toString(),
    runtimeBytecodeHash,
    contractVersion,
    protocolVersion: BigInt(protocolVersion as bigint).toString(),
    features,
    appWalletExecutor
  };
};

const blockView = (block: RpcBlock): ChatReactionsV1CanonicalBlock => Object.freeze({
  number: block.number.toString(),
  hash: block.hash
});

export const attestChatReactionsV1Deployment = async ({
  capability,
  manifest,
  policy
}: {
  capability: ChatReactionsV1ReadCapability;
  manifest: ChatReactionsV1ManifestInput;
  policy: ChatReactionsV1FinalityPolicy;
}): Promise<AttestedChatReactionsV1Deployment> => {
  const expected = normalizeManifest(manifest);
  const lag = normalizePolicy(policy);
  const binding = capabilityBinding(capability);
  if (binding.chainId !== expected.chainId) throw new Error('Manifest and read-capability chains differ.');
  const { safeBlock } = await readSafeHead(binding, lag);
  const latestDeployment = [
    expected.reactions.deploymentBlock,
    expected.directChatV2.deploymentBlock,
    expected.groupChatV2.deploymentBlock
  ].reduce((left, right) => left > right ? left : right);
  if (safeBlock.number < latestDeployment) throw new Error('Reaction attestation safe head predates a deployment.');

  // Feed the shared paced provider one startup read at a time. Parallel getter
  // batches consumed the queue deadline of other App initializers.
  const reactionsCode = await readCode(binding, expected.reactions.contractAddress, safeBlock.hash, 'Reactions');
  const directCode = await readCode(binding, expected.directChatV2.contractAddress, safeBlock.hash, 'Direct Chat V2');
  const groupCode = await readCode(binding, expected.groupChatV2.contractAddress, safeBlock.hash, 'Group Chat V2');
  const reactionsRuntimeHash = keccak256(reactionsCode).toLowerCase();
  const directRuntimeHash = keccak256(directCode).toLowerCase();
  const groupRuntimeHash = keccak256(groupCode).toLowerCase();
  if (reactionsRuntimeHash !== expected.reactions.runtimeBytecodeHash ||
      directRuntimeHash !== expected.directChatV2.runtimeBytecodeHash ||
      groupRuntimeHash !== expected.groupChatV2.runtimeBytecodeHash) {
    throw new Error('A ChatReactionsV1 deployment runtime does not match its frozen manifest.');
  }

  const [
    reactionsVersion,
    reactionsProtocol,
    emojiSetVersion,
    emojiCount,
    directAnchorDomain,
    groupAnchorDomain,
    pinnedDirectAddress,
    pinnedGroupAddress,
    pinnedDirectRuntimeHash,
    pinnedGroupRuntimeHash,
    pinnedDirectDeploymentBlock,
    pinnedGroupDeploymentBlock,
    reactionsDeploymentBlock,
    reactionFeatures,
    reactionAppWalletExecutor,
    directEvidence,
    groupEvidence
  ] = [
    await readGetter(binding, expected.reactions.contractAddress, 'contractVersion', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'PROTOCOL_VERSION', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'EMOJI_SET_VERSION', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'EMOJI_COUNT', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'DIRECT_MESSAGE_ANCHOR_DOMAIN', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'GROUP_MESSAGE_ANCHOR_DOMAIN', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'directChatV2', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'groupChatV2', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'directChatRuntimeHash', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'groupChatRuntimeHash', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'directChatDeploymentBlock', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'groupChatDeploymentBlock', [], safeBlock.hash),
    await readGetter(binding, expected.reactions.contractAddress, 'deploymentBlock', [], safeBlock.hash),
    await readFeatures(binding, expected.reactions.contractAddress, CHAT_REACTIONS_V1_REQUIRED_FEATURES, safeBlock.hash),
    await readGetter(
      binding,
      expected.reactions.contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
      safeBlock.hash
    ),
    await readTargetEvidence({
      binding,
      contractAddress: expected.directChatV2.contractAddress,
      runtimeBytecodeHash: directRuntimeHash,
      required: CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES,
      blockHash: safeBlock.hash
    }),
    await readTargetEvidence({
      binding,
      contractAddress: expected.groupChatV2.contractAddress,
      runtimeBytecodeHash: groupRuntimeHash,
      required: CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES,
      blockHash: safeBlock.hash
    })
  ] as const;
  if (typeof reactionsVersion !== 'string' || typeof reactionAppWalletExecutor !== 'boolean') {
    throw new Error('Reactions metadata has an invalid ABI type.');
  }
  const evidence: ChatReactionsV1ProvenanceEvidence = {
    chainId: expected.chainId.toString(),
    reactions: {
      contractAddress: expected.reactions.contractAddress,
      deploymentBlock: BigInt(reactionsDeploymentBlock as bigint).toString(),
      runtimeBytecodeHash: reactionsRuntimeHash,
      contractVersion: reactionsVersion,
      protocolVersion: BigInt(reactionsProtocol as bigint).toString(),
      features: reactionFeatures,
      appWalletExecutor: reactionAppWalletExecutor,
      emojiSetVersion: BigInt(emojiSetVersion as bigint).toString(),
      emojiCount: BigInt(emojiCount as bigint).toString(),
      directMessageAnchorDomain: String(directAnchorDomain),
      groupMessageAnchorDomain: String(groupAnchorDomain),
      pinnedDirectChatV2: {
        contractAddress: String(pinnedDirectAddress),
        deploymentBlock: BigInt(pinnedDirectDeploymentBlock as bigint).toString(),
        runtimeBytecodeHash: String(pinnedDirectRuntimeHash)
      },
      pinnedGroupChatV2: {
        contractAddress: String(pinnedGroupAddress),
        deploymentBlock: BigInt(pinnedGroupDeploymentBlock as bigint).toString(),
        runtimeBytecodeHash: String(pinnedGroupRuntimeHash)
      }
    },
    directChatV2: directEvidence,
    groupChatV2: groupEvidence
  };
  const compared = compareChatReactionsV1Provenance(manifest, evidence);

  await assertChain(binding);
  const latestAfter = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Post-attestation latest block');
  if (latestAfter < safeBlock.number + lag) throw new Error('Reaction attestation lost its safe-head depth.');
  const snapshotAfter = await readBlock(binding, safeBlock.number, 'Post-attestation snapshot block');
  if (snapshotAfter.hash !== safeBlock.hash) throw new Error('Reaction attestation snapshot was reorganized.');
  await assertChain(binding);

  const deployment = Object.freeze({
    ...compared,
    attestationBlock: blockView(safeBlock)
  }) as AttestedChatReactionsV1Deployment;
  DEPLOYMENTS.set(deployment, Object.freeze({ capability, compared, finalityLagBlocks: lag }));
  return deployment;
};

const deploymentBinding = (
  capability: ChatReactionsV1ReadCapability,
  deployment: AttestedChatReactionsV1Deployment
): { capabilityBinding: CapabilityBinding; deploymentBinding: DeploymentBinding } => {
  const capabilityState = capabilityBinding(capability);
  const deploymentState = deployment && DEPLOYMENTS.get(deployment);
  if (!deploymentState || deploymentState.capability !== capability) {
    throw new Error('ChatReactionsV1 deployment is not attested by this exact read capability.');
  }
  return { capabilityBinding: capabilityState, deploymentBinding: deploymentState };
};

export const assertAttestedChatReactionsV1Deployment = (
  deployment: AttestedChatReactionsV1Deployment
): Readonly<{ chainId: bigint }> => {
  const state = deployment && DEPLOYMENTS.get(deployment);
  if (!state) {
    throw new Error('ChatReactionsV1 requires a deployment produced by its exact attester.');
  }
  const capabilityState = capabilityBinding(state.capability);
  return Object.freeze({ chainId: capabilityState.chainId });
};

export const readChatReactionsV1LatestBlock = async (
  capability: ChatReactionsV1ReadCapability
): Promise<bigint> => {
  const binding = capabilityBinding(capability);
  await assertChain(binding);
  const latest = canonicalQuantity(
    await rpc(binding, 'eth_blockNumber'),
    'Reaction latest block',
    UINT64_MAX
  );
  await assertChain(binding);
  return latest;
};

const normalizeRpcLog = (
  value: unknown,
  label: string,
  removedRequired: boolean
): Record<string, unknown> => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, 'index')) {
    throw new Error(`${label} must use raw JSON-RPC logIndex, not an ethers index alias.`);
  }
  if (removedRequired ? raw.removed !== false : raw.removed !== undefined && raw.removed !== false) {
    throw new Error(`${label} cannot be a removed-log signal.`);
  }
  const blockNumber = canonicalQuantity(raw.blockNumber, `${label} block number`);
  const transactionIndex = canonicalQuantity(raw.transactionIndex, `${label} transaction index`);
  const logIndex = canonicalQuantity(raw.logIndex, `${label} log index`);
  return {
    address: canonicalAddress(raw.address, `${label} address`),
    topics: Array.isArray(raw.topics)
      ? raw.topics.map((topic, position) => canonicalBytes32(topic, `${label} topic ${position}`))
      : raw.topics,
    data: canonicalBytes(raw.data, `${label} data`, true),
    blockHash: canonicalBytes32(raw.blockHash, `${label} block hash`),
    blockNumber: blockNumber.toString(),
    transactionHash: canonicalBytes32(raw.transactionHash, `${label} transaction hash`),
    transactionIndex: safeNumber(transactionIndex, `${label} transaction index`),
    logIndex: safeNumber(logIndex, `${label} log index`),
    removed: false
  };
};

type ParsedReceipt = Readonly<{
  status: bigint;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logs: readonly unknown[];
}>;

const parseReceipt = (value: unknown, expectedHash: string): ParsedReceipt => {
  if (!value || typeof value !== 'object') throw new Error('Reaction transaction receipt is missing.');
  const raw = value as Record<string, unknown>;
  const transactionHash = canonicalBytes32(
    raw.transactionHash,
    'Reaction receipt transaction hash'
  );
  if (transactionHash !== expectedHash) throw new Error('Reaction receipt belongs to another transaction.');
  if (!Array.isArray(raw.logs)) throw new Error('Reaction receipt logs are missing.');
  return Object.freeze({
    status: canonicalQuantity(raw.status, 'Reaction receipt status'),
    blockNumber: canonicalQuantity(raw.blockNumber, 'Reaction receipt block number'),
    blockHash: canonicalBytes32(raw.blockHash, 'Reaction receipt block hash'),
    transactionHash,
    transactionIndex: safeNumber(
      canonicalQuantity(raw.transactionIndex, 'Reaction receipt transaction index'),
      'Reaction receipt transaction index'
    ),
    logs: Object.freeze([...raw.logs])
  });
};

const assertAttestationBlock = async (
  binding: CapabilityBinding,
  deployment: AttestedChatReactionsV1Deployment,
  label: string
): Promise<void> => {
  const number = manifestUint(deployment.attestationBlock.number, `${label} number`);
  const expectedHash = canonicalBytes32(deployment.attestationBlock.hash, `${label} hash`);
  const current = await readBlock(binding, number, label);
  if (current.hash !== expectedHash) {
    throw new Error('ChatReactionsV1 deployment attestation block was reorganized.');
  }
};

/**
 * Reads one complete, bounded, finalized provider-owned log range. Callers may
 * choose the range, but cannot supply or subset its contents. The returned page
 * authenticates only that exact range; an empty page never means global state
 * should be cleared outside the page boundaries.
 */
export const readCanonicalChatReactionsV1LogRange = async ({
  capability,
  deployment,
  fromBlock,
  toBlock
}: {
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<CanonicalChatReactionRangePage> => {
  if (typeof fromBlock !== 'bigint' || typeof toBlock !== 'bigint' ||
      fromBlock < 0n || toBlock < fromBlock || toBlock > UINT64_MAX ||
      toBlock - fromBlock + 1n > CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS) {
    throw new Error('Reaction log range must be an ordered bounded uint64 bigint range.');
  }
  const { capabilityBinding: binding, deploymentBinding: deploymentState } =
    deploymentBinding(capability, deployment);
  const lag = deploymentState.finalityLagBlocks;
  await assertAttestationBlock(binding, deployment, 'Pre-range deployment attestation block');
  const { safeBlock } = await readSafeHead(binding, lag);
  if (toBlock > safeBlock.number) throw new Error('Reaction log range extends above the attested safe head.');
  if (fromBlock < BigInt(deployment.deploymentBlock)) {
    throw new Error('Reaction log range predates the reactions deployment.');
  }

  const blocks = new Map<string, RpcBlock>();
  const readCheckedBlock = async (number: bigint, label: string): Promise<RpcBlock> => {
    const key = number.toString();
    const existing = blocks.get(key);
    if (existing) return existing;
    const block = await readBlock(binding, number, label);
    blocks.set(key, block);
    return block;
  };
  const fromBoundary = await readCheckedBlock(fromBlock, 'Reaction range start block');
  const toBoundary = await readCheckedBlock(toBlock, 'Reaction range end block');

  const [reactionsCode, directCode, groupCode] = await Promise.all([
    readCode(binding, deployment.contractAddress, safeBlock.hash, 'Current Reactions'),
    readCode(binding, deployment.directChatV2.contractAddress, safeBlock.hash, 'Current Direct Chat V2'),
    readCode(binding, deployment.groupChatV2.contractAddress, safeBlock.hash, 'Current Group Chat V2')
  ]);
  if (keccak256(reactionsCode).toLowerCase() !== deployment.runtimeBytecodeHash ||
      keccak256(directCode).toLowerCase() !== deployment.directChatV2.runtimeBytecodeHash ||
      keccak256(groupCode).toLowerCase() !== deployment.groupChatV2.runtimeBytecodeHash) {
    throw new Error('A current reaction or chat runtime no longer matches its attested deployment.');
  }

  const logs = await rpc(binding, 'eth_getLogs', [{
    address: deployment.contractAddress,
    fromBlock: quantityHex(fromBlock),
    toBlock: quantityHex(toBlock),
    topics: [[CHAT_REACTIONS_V1_DIRECT_REACTION_TOPIC, CHAT_REACTIONS_V1_GROUP_REACTION_TOPIC]]
  }]);
  if (!Array.isArray(logs)) throw new Error('Reaction range query did not return a log array.');
  if (logs.length > CHAT_REACTIONS_V1_MAX_LOGS_PER_RANGE) {
    const error = new Error('Reaction range returned too many logs; split it into smaller ranges.');
    DENSE_RANGE_ERRORS.add(error);
    throw error;
  }
  const parsed = logs.map((raw, position) => {
    const normalized = normalizeRpcLog(raw, `Reaction log ${position}`, true);
    const observation = parseChatReactionsV1Log({
      deployment: deploymentState.compared,
      observedChainId: binding.chainId,
      log: normalized
    });
    const blockNumber = BigInt(observation.blockNumber);
    if (blockNumber < fromBlock || blockNumber > toBlock) {
      throw new Error('Reaction provider returned a log outside the requested range.');
    }
    return { observation, normalized };
  });

  const receipts = new Map<string, ParsedReceipt>();
  const receiptObservations: ChatReactionObservation[] = [];
  for (const item of parsed) {
    const observation = item.observation;
    let block = blocks.get(observation.blockNumber);
    if (!block) {
      block = await readCheckedBlock(BigInt(observation.blockNumber), 'Canonical reaction block');
    }
    if (block.hash !== observation.blockHash) throw new Error('Reaction log belongs to an orphan block.');
    if (observation.transactionIndex >= block.transactions.length ||
        block.transactions[observation.transactionIndex] !== observation.transactionHash) {
      throw new Error('Reaction log transaction slot is not canonical.');
    }

    let receipt = receipts.get(observation.transactionHash);
    if (!receipt) {
      receipt = parseReceipt(
        await rpc(binding, 'eth_getTransactionReceipt', [observation.transactionHash]),
        observation.transactionHash
      );
      receipts.set(observation.transactionHash, receipt);
    }
    if (receipt.status !== 1n || receipt.blockNumber !== BigInt(observation.blockNumber) ||
        receipt.blockHash !== observation.blockHash || receipt.transactionIndex !== observation.transactionIndex) {
      throw new Error('Reaction receipt is unsuccessful or has noncanonical block metadata.');
    }

    const matchingReceiptLogs: ChatReactionObservation[] = [];
    for (let position = 0; position < receipt.logs.length; position += 1) {
      const candidate = receipt.logs[position];
      if (!candidate || typeof candidate !== 'object') throw new Error('Reaction receipt contains a malformed log.');
      const rawCandidate = candidate as Record<string, unknown>;
      const candidateIndex = canonicalQuantity(rawCandidate.logIndex, `Reaction receipt log ${position} index`);
      if (candidateIndex !== BigInt(observation.logIndex)) continue;
      const normalizedCandidate = normalizeRpcLog(
        rawCandidate,
        `Reaction receipt log ${position}`,
        false
      );
      matchingReceiptLogs.push(parseChatReactionsV1Log({
        deployment: deploymentState.compared,
        observedChainId: binding.chainId,
        log: normalizedCandidate
      }));
    }
    if (matchingReceiptLogs.length !== 1 ||
        !chatReactionObservationsEqual(observation, matchingReceiptLogs[0])) {
      throw new Error('Reaction log does not exactly match one successful receipt log.');
    }
    receiptObservations.push(matchingReceiptLogs[0]);
  }

  await assertChain(binding);
  const latestAfter = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Post-log latest block');
  if (latestAfter < safeBlock.number + lag) throw new Error('Canonical reaction range page lost its safe-head depth.');
  const safeAfter = await readBlock(binding, safeBlock.number, 'Post-log safe-head block');
  if (safeAfter.hash !== safeBlock.hash) throw new Error('Canonical reaction safe head was reorganized.');
  for (const block of blocks.values()) {
    const rechecked = await readBlock(binding, block.number, 'Rechecked canonical reaction block');
    if (rechecked.hash !== block.hash) throw new Error('A canonical reaction block changed during verification.');
  }
  await assertAttestationBlock(binding, deployment, 'Post-range deployment attestation block');
  await assertChain(binding);

  receiptObservations.sort(compareChatReactionObservationOrder);
  const token = Object.freeze({});
  const canonicalObservations = Object.freeze(receiptObservations.map((observation) =>
    observation as CanonicalChatReactionObservation
  ));
  const checkedBlocks = Object.freeze([...blocks.values()]
    .sort((left, right) => left.number < right.number ? -1 : left.number > right.number ? 1 : 0)
    .map(blockView));
  const page = Object.freeze({
    range: Object.freeze({
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      fromBlockHash: fromBoundary.hash,
      toBlockHash: toBoundary.hash
    }),
    safeHead: blockView(safeBlock),
    checkedBlocks,
    finalityLagBlocks: lag.toString(),
    observations: canonicalObservations
  }) as CanonicalChatReactionRangePage;
  const pageState = Object.freeze({ capability, deployment, pageToken: token });
  PAGES.set(page, pageState);
  for (const observation of canonicalObservations) {
    OBSERVATIONS.set(observation, Object.freeze({ capability, deployment, pageToken: token }));
  }
  return page;
};

const canonicalPageBinding = (page: CanonicalChatReactionRangePage): PageBinding => {
  const binding = page && PAGES.get(page);
  if (!binding) throw new Error('Reaction reducer requires an atomically verified canonical range page.');
  for (const observation of page.observations) {
    const observationBinding = OBSERVATIONS.get(observation);
    if (!observationBinding || observationBinding.pageToken !== binding.pageToken ||
        observationBinding.capability !== binding.capability ||
        observationBinding.deployment !== binding.deployment) {
      throw new Error('Canonical reaction range page contains an unverified or mixed observation.');
    }
  }
  return binding;
};

export const reduceCanonicalChatReactionRangePage = (
  page: CanonicalChatReactionRangePage,
  resolveCanonicalSource: ChatReactionCanonicalSourceResolver
): ChatReactionReducedState => {
  canonicalPageBinding(page);
  if (typeof resolveCanonicalSource !== 'function') throw new Error('Canonical source resolver is required.');
  const live = new Map<string, CanonicalChatReactionObservation>();
  for (const observation of page.observations) {
    if (observation.removed) throw new Error('Canonical reaction range pages cannot contain removed-log signals.');
    const duplicate = live.get(observation.rawIdentity);
    if (duplicate && !chatReactionObservationsEqual(duplicate, observation)) {
      throw new Error('Conflicting reaction logs share one physical log identity.');
    }
    live.set(observation.rawIdentity, observation);
  }

  const accepted: CanonicalChatReactionObservation[] = [];
  const ignored: Array<{
    rawIdentity: string;
    reason: 'missing-source' | 'invalid-source' | 'anchor-mismatch';
  }> = [];
  for (const observation of live.values()) {
    const target = chatReactionTargetOf(observation);
    let source: ChatReactionSource | null | undefined;
    try {
      source = resolveCanonicalSource(target);
    } catch {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
      continue;
    }
    if (!source) {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'missing-source' });
      continue;
    }
    try {
      const normalized = normalizeChatReactionSource(source);
      if (chatReactionStableTargetKey(normalized) !== chatReactionStableTargetKey(target)) {
        ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
      } else if (deriveChatReactionSourceAnchor(normalized) !== observation.messageAnchor) {
        ignored.push({ rawIdentity: observation.rawIdentity, reason: 'anchor-mismatch' });
      } else {
        accepted.push(observation);
      }
    } catch {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
    }
  }
  accepted.sort(compareChatReactionObservationOrder);
  const states = new Map<string, CanonicalChatReactionObservation>();
  for (const observation of accepted) states.set(observation.stateKey, observation);
  return Object.freeze({
    accepted: Object.freeze([...accepted]),
    states: Object.freeze([...states.values()].sort(compareChatReactionObservationOrder)),
    ignored: Object.freeze(ignored.map((item) => Object.freeze(item)))
  });
};

export const receiptConfirmsCurrentCanonicalChatReactionPending = (
  currentIdentity: string | null | undefined,
  pending: SubmittedChatReactionPending,
  receiptEvent: CanonicalChatReactionObservation
): boolean => currentIdentity === pending.identity &&
  isSubmittedChatReactionPending(pending) &&
  OBSERVATIONS.has(receiptEvent) &&
  !receiptEvent.removed &&
  receiptEvent.stateKey === pending.stateKey &&
  receiptEvent.messageAnchor === pending.messageAnchor &&
  receiptEvent.active === pending.active &&
  receiptEvent.transactionHash === pending.effectiveTransactionHash;
