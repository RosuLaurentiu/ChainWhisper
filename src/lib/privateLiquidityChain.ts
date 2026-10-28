import {
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import {
  PRIVATE_LIQUIDITY_V1_EVENT_ABI,
  parsePrivateLiquidityV1Log,
  type ParsedPrivateLiquidityV1Log,
  type PrivateLiquidityV1RawLog
} from './privateLiquidityEvents';
import {
  validatePrivateLiquidityPosition,
  type PrivateLiquidityPosition,
  type PrivateLiquidityPositionStatus
} from './privateLiquidity';
import {
  assertAttestedPrivateLiquidityV2Deployment,
  type AttestedPrivateLiquidityV2Deployment
} from './privateLiquidityV2Chain';

const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const EVENTS = new Interface(PRIVATE_LIQUIDITY_V1_EVENT_ABI);
const POSITION_VIEWS = new Interface([
  'function getPositionView(uint256 positionId) view returns (tuple(tuple(uint8 status,address baseToken,address quoteToken,tuple(uint256 baseAmount,uint256 quoteAmount) buyTerms,tuple(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,address privacyOwner,bool buySideAvailable,bool sellSideAvailable) position,uint256 positionId,address positionOwner,bytes32 pairKey) view_)',
  'function lastActivityBlock(uint256 positionId) view returns (uint256)',
  'function nextPositionId() view returns (uint256)'
]);
const VERSION = 'ChainWhisperPrivateLiquidityBookV1';
const VERSION_V2 = 'ChainWhisperPrivateLiquidityBookV2';
const FEATURES = Object.freeze([
  'DIRECT_WALLET_AUTHORITY',
  'POSITION_NFTS',
  'PRIVATE_TOKEN_PAIRS_ONLY',
  'PUBLIC_PRICES_PRIVATE_INVENTORY',
  'PACKED_PRIVATE_INPUTS',
  'MULTI_POSITION_EXECUTION',
  'PRIVATE_DEPTH_PARTIAL_FILL_LIMIT',
  'PARTICIPANT_RECEIPTS',
  'SELF_CHECKING_PARTICIPANT_RECEIPTS',
  'TRANSFER_PRIVACY_ACTIVATION',
  'NO_APP_WALLET_EXECUTOR',
  'CONTRIBUTOR_COUNT_MAY_LEAK'
] as const);
const EVENT_TOPICS = Object.freeze(PRIVATE_LIQUIDITY_V1_EVENT_ABI.map((fragment) => {
  const parsed = EVENTS.getEvent(fragment.slice('event '.length, fragment.indexOf('(')));
  if (!parsed) throw new Error('Private-liquidity ABI contains an invalid event.');
  return parsed.topicHash.toLowerCase();
}));
const EVENT_TOPIC_QUERY_BATCH_SIZE = 3;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const PRIVATE_LIQUIDITY_MAX_LOG_RANGE_BLOCKS = 2_048n;
export const PRIVATE_LIQUIDITY_MAX_LOGS_PER_RANGE = 4_096;

declare const PRIVATE_LIQUIDITY_READ_CAPABILITY_BRAND: unique symbol;
export type PrivateLiquidityReadCapability = Readonly<{
  readonly [PRIVATE_LIQUIDITY_READ_CAPABILITY_BRAND]: true;
}>;

export type PrivateLiquidityManifestInput = Readonly<{
  chainId: bigint | number | string;
  contractAddress: string;
  deploymentBlock: bigint | number | string;
  runtimeBytecodeHash: string;
}>;

export type PrivateLiquidityCanonicalBlock = Readonly<{ number: string; hash: string }>;

declare const ATTESTED_PRIVATE_LIQUIDITY_DEPLOYMENT_BRAND: unique symbol;
export type AttestedPrivateLiquidityDeployment = Readonly<{
  chainId: string;
  contractAddress: string;
  deploymentBlock: string;
  runtimeBytecodeHash: string;
  contractVersion: typeof VERSION | typeof VERSION_V2;
  requiredFeatures: readonly (typeof FEATURES)[number][];
  finalityLagBlocks: string;
  attestationBlock: PrivateLiquidityCanonicalBlock;
  readonly [ATTESTED_PRIVATE_LIQUIDITY_DEPLOYMENT_BRAND]: true;
}>;

declare const CANONICAL_PRIVATE_LIQUIDITY_PAGE_BRAND: unique symbol;
export type CanonicalPrivateLiquidityLogRange = Readonly<{
  scope: Readonly<{
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
  }>;
  range: Readonly<{
    fromBlock: string;
    toBlock: string;
    fromBlockHash: string;
    toBlockHash: string;
  }>;
  safeHead: PrivateLiquidityCanonicalBlock;
  checkedBlocks: readonly PrivateLiquidityCanonicalBlock[];
  events: readonly ParsedPrivateLiquidityV1Log[];
  readonly [CANONICAL_PRIVATE_LIQUIDITY_PAGE_BRAND]: true;
}>;

declare const CANONICAL_PRIVATE_LIQUIDITY_POSITIONS_BRAND: unique symbol;
export type CanonicalPrivateLiquidityPositionSnapshot = Readonly<{
  scope: Readonly<{
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
  }>;
  atBlock: PrivateLiquidityCanonicalBlock;
  positions: readonly PrivateLiquidityPosition[];
  readonly [CANONICAL_PRIVATE_LIQUIDITY_POSITIONS_BRAND]: true;
}>;

declare const CANONICAL_PRIVATE_LIQUIDITY_CATALOG_ANCHOR_BRAND: unique symbol;
export type CanonicalPrivateLiquidityCatalogAnchor = Readonly<{
  scope: Readonly<{
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
  }>;
  atBlock: PrivateLiquidityCanonicalBlock;
  nextPositionId: string;
  positionCount: string;
  readonly [CANONICAL_PRIVATE_LIQUIDITY_CATALOG_ANCHOR_BRAND]: true;
}>;

declare const COMPLETE_PRIVATE_LIQUIDITY_POSITIONS_BRAND: unique symbol;
export type CompleteCanonicalPrivateLiquidityPositionSnapshot =
  CanonicalPrivateLiquidityPositionSnapshot & Readonly<{
    positionCount: string;
    readonly [COMPLETE_PRIVATE_LIQUIDITY_POSITIONS_BRAND]: true;
  }>;

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type CapabilityBinding = Readonly<{
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}>;
type DeploymentBinding = Readonly<{
  capability: PrivateLiquidityReadCapability;
  finalityLagBlocks: bigint;
  eventContractAddresses: readonly string[];
}>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const DEPLOYMENTS = new WeakMap<object, DeploymentBinding>();
const CANONICAL_PAGES = new WeakSet<object>();
const CANONICAL_POSITION_SNAPSHOTS = new WeakSet<object>();
const CANONICAL_CATALOG_ANCHORS = new WeakSet<object>();
const COMPLETE_POSITION_SNAPSHOTS = new WeakSet<object>();

const decimalUint = (
  value: bigint | number | string,
  label: string,
  maximum = UINT256_MAX
): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a safe unsigned integer.`);
  }
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be canonical unsigned decimal.`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const rpcQuantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32 hex.`);
  }
  return value.toLowerCase();
};

const eventTopic = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be bytes32 hex.`);
  }
  return value.toLowerCase();
};

const bytes = (value: unknown, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  if (!allowEmpty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const quantityHex = (value: bigint): string => `0x${value.toString(16)}`;
const eip1898 = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const capabilityBinding = (capability: PrivateLiquidityReadCapability): CapabilityBinding => {
  const state = capability && CAPABILITIES.get(capability);
  if (!state) throw new Error('Private liquidity requires an exact current EIP-1193 read capability.');
  return state;
};

const rpc = async (
  state: CapabilityBinding,
  method: string,
  params: readonly unknown[] = []
): Promise<unknown> => {
  await state.assertCurrent();
  let result: unknown;
  try {
    result = await state.request({ method, params: [...params] });
  } catch (error) {
    const sanitizedCause = error instanceof Error &&
      /^Private-liquidity JSON-RPC (?:transport failed|transport returned an error status|response is not JSON|response is malformed|response failed validation|response was rejected(?: \(code -?[0-9]+\))?)\.$/u.test(error.message)
      ? `: ${error.message}`
      : '.';
    throw new Error(`Private-liquidity RPC ${method} failed${sanitizedCause}`);
  }
  await state.assertCurrent();
  return result;
};

const assertChain = async (state: CapabilityBinding): Promise<void> => {
  const chainId = rpcQuantity(await rpc(state, 'eth_chainId'), 'Private-liquidity chain ID');
  if (chainId !== state.chainId) throw new Error('Private-liquidity read capability chain changed.');
};

export const bindPrivateLiquidityReadCapability = async ({
  provider,
  expectedChainId,
  assertCurrent
}: {
  provider: ReadProvider;
  expectedChainId: bigint;
  assertCurrent: () => void | Promise<void>;
}): Promise<PrivateLiquidityReadCapability> => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' ||
      typeof expectedChainId !== 'bigint' || expectedChainId <= 0n || expectedChainId > UINT256_MAX) {
    throw new Error('Cannot bind an invalid private-liquidity read capability.');
  }
  const state = Object.freeze({
    request: provider.request.bind(provider),
    chainId: expectedChainId,
    assertCurrent
  });
  await assertChain(state);
  const capability = Object.freeze({}) as PrivateLiquidityReadCapability;
  CAPABILITIES.set(capability, state);
  return capability;
};

type RpcBlock = Readonly<{ number: bigint; hash: string; transactions: readonly string[] }>;

const parseBlock = (value: unknown, expectedNumber: bigint, label: string): RpcBlock => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  const number = rpcQuantity(raw.number, `${label} number`, UINT64_MAX);
  if (number !== expectedNumber) throw new Error(`${label} returned the wrong number.`);
  if (!Array.isArray(raw.transactions)) throw new Error(`${label} transaction list is missing.`);
  return Object.freeze({
    number,
    hash: bytes32(raw.hash, `${label} hash`),
    transactions: Object.freeze(raw.transactions.map((hash, index) =>
      bytes32(hash, `${label} transaction ${index}`)
    ))
  });
};

const readBlock = async (state: CapabilityBinding, number: bigint, label: string): Promise<RpcBlock> =>
  parseBlock(await rpc(state, 'eth_getBlockByNumber', [quantityHex(number), false]), number, label);

const readSafeHead = async (state: CapabilityBinding, lag: bigint): Promise<RpcBlock> => {
  await assertChain(state);
  const latest = rpcQuantity(await rpc(state, 'eth_blockNumber'), 'Latest private-liquidity block', UINT64_MAX);
  if (latest < lag) throw new Error('Private-liquidity safe head is below genesis.');
  return readBlock(state, latest - lag, 'Private-liquidity safe-head block');
};

const readCode = async (state: CapabilityBinding, contractAddress: string, blockHash: string): Promise<string> =>
  bytes(await rpc(state, 'eth_getCode', [contractAddress, eip1898(blockHash)]), 'Private-liquidity runtime');

const readGetter = async (
  state: CapabilityBinding,
  contractAddress: string,
  functionName: 'contractVersion' | 'supportsFeature',
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => {
  const data = METADATA.encodeFunctionData(functionName, [...args]);
  const raw = bytes(
    await rpc(state, 'eth_call', [{ to: contractAddress, data }, eip1898(blockHash)]),
    `${functionName} result`,
    true
  );
  let decoded;
  try {
    decoded = METADATA.decodeFunctionResult(functionName, raw);
  } catch {
    throw new Error(`${functionName} returned malformed ABI data.`);
  }
  if (decoded.length !== 1 || METADATA.encodeFunctionResult(functionName, [...decoded]).toLowerCase() !== raw) {
    throw new Error(`${functionName} returned noncanonical ABI data.`);
  }
  return decoded[0];
};

const readPositionGetter = async (
  state: CapabilityBinding,
  contractAddress: string,
  functionName: 'getPositionView' | 'lastActivityBlock' | 'nextPositionId',
  args: readonly unknown[],
  blockHash: string
): Promise<readonly unknown[]> => {
  const data = POSITION_VIEWS.encodeFunctionData(functionName, [...args]);
  const raw = bytes(
    await rpc(state, 'eth_call', [{ to: contractAddress, data }, eip1898(blockHash)]),
    `${functionName} result`,
    true
  );
  let decoded;
  try {
    decoded = POSITION_VIEWS.decodeFunctionResult(functionName, raw);
  } catch {
    throw new Error(`${functionName} returned malformed ABI data.`);
  }
  if (POSITION_VIEWS.encodeFunctionResult(functionName, [...decoded]).toLowerCase() !== raw) {
    throw new Error(`${functionName} returned noncanonical ABI data.`);
  }
  return decoded;
};

const normalizeManifest = (manifest: PrivateLiquidityManifestInput) => {
  if (!manifest) throw new Error('Private-liquidity manifest is missing.');
  const chainId = decimalUint(manifest.chainId, 'Private-liquidity manifest chain ID');
  if (chainId === 0n) throw new Error('Private-liquidity manifest chain ID cannot be zero.');
  return Object.freeze({
    chainId,
    contractAddress: address(manifest.contractAddress, 'Private-liquidity manifest address'),
    deploymentBlock: decimalUint(manifest.deploymentBlock, 'Private-liquidity deployment block', UINT64_MAX),
    runtimeBytecodeHash: bytes32(manifest.runtimeBytecodeHash, 'Private-liquidity runtime hash')
  });
};

export const attestPrivateLiquidityDeployment = async ({
  capability,
  manifest,
  finalityLagBlocks
}: {
  capability: PrivateLiquidityReadCapability;
  manifest: PrivateLiquidityManifestInput;
  finalityLagBlocks: bigint;
}): Promise<AttestedPrivateLiquidityDeployment> => {
  const expected = normalizeManifest(manifest);
  if (typeof finalityLagBlocks !== 'bigint' || finalityLagBlocks <= 0n || finalityLagBlocks > UINT64_MAX) {
    throw new Error('Private-liquidity finality lag must be a non-zero uint64 bigint.');
  }
  const state = capabilityBinding(capability);
  if (state.chainId !== expected.chainId) throw new Error('Private-liquidity manifest and capability chains differ.');
  const safeHead = await readSafeHead(state, finalityLagBlocks);
  if (safeHead.number < expected.deploymentBlock) {
    throw new Error('Private-liquidity attestation safe head predates deployment.');
  }
  if (keccak256(await readCode(state, expected.contractAddress, safeHead.hash)).toLowerCase() !==
      expected.runtimeBytecodeHash) {
    throw new Error('Private-liquidity runtime does not match its frozen manifest.');
  }
  if (await readGetter(state, expected.contractAddress, 'contractVersion', [], safeHead.hash) !== VERSION) {
    throw new Error('Private-liquidity version does not match its manifest.');
  }
  for (const feature of FEATURES) {
    const supported = await readGetter(
      state,
      expected.contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes(feature))],
      safeHead.hash
    );
    if (supported !== true) throw new Error(`Private-liquidity contract is missing required feature ${feature}.`);
  }
  const appWallet = await readGetter(
    state,
    expected.contractAddress,
    'supportsFeature',
    [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
    safeHead.hash
  );
  if (appWallet !== false) throw new Error('Private-liquidity contract unexpectedly supports an app-wallet executor.');
  await assertChain(state);
  if ((await readBlock(state, safeHead.number, 'Post-attestation private-liquidity block')).hash !== safeHead.hash) {
    throw new Error('Private-liquidity attestation block was reorganized.');
  }
  await assertChain(state);
  const deployment = Object.freeze({
    chainId: expected.chainId.toString(),
    contractAddress: expected.contractAddress,
    deploymentBlock: expected.deploymentBlock.toString(),
    runtimeBytecodeHash: expected.runtimeBytecodeHash,
    contractVersion: VERSION,
    requiredFeatures: FEATURES,
    finalityLagBlocks: finalityLagBlocks.toString(),
    attestationBlock: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash })
  }) as unknown as AttestedPrivateLiquidityDeployment;
  DEPLOYMENTS.set(deployment, Object.freeze({
    capability,
    finalityLagBlocks,
    eventContractAddresses: Object.freeze([expected.contractAddress])
  }));
  return deployment;
};

/**
 * Adopts an exactly attested V2 Book into the existing position/event reader. V2 deliberately
 * preserves the V1 position, swap, receipt, and NFT event surface, while its three-contract
 * provenance is established by the stricter V2 attester. The projection is minted here so none
 * of the existing readers can accept a structural V2-shaped object or bypass their capability
 * binding.
 */
export const adoptAttestedPrivateLiquidityV2Book = async ({
  capability,
  deployment: v2Deployment
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityV2Deployment;
}): Promise<AttestedPrivateLiquidityDeployment> => {
  assertAttestedPrivateLiquidityV2Deployment(v2Deployment);
  const state = capabilityBinding(capability);
  const expected = normalizeManifest({
    chainId: v2Deployment.manifest.chainId,
    contractAddress: v2Deployment.manifest.book.address,
    deploymentBlock: v2Deployment.manifest.book.deploymentBlock,
    runtimeBytecodeHash: v2Deployment.manifest.book.runtimeBytecodeHash
  });
  if (state.chainId !== expected.chainId) {
    throw new Error('Private Liquidity V2 Book and reader capability chains differ.');
  }
  const finalityLagBlocks = decimalUint(
    v2Deployment.finalityLagBlocks,
    'Private Liquidity V2 finality lag',
    UINT64_MAX
  );
  const attestationNumber = decimalUint(
    v2Deployment.attestationBlock.number,
    'Private Liquidity V2 attestation block',
    UINT64_MAX
  );
  const attestationHash = bytes32(
    v2Deployment.attestationBlock.hash,
    'Private Liquidity V2 attestation block hash'
  );
  if (finalityLagBlocks === 0n || attestationNumber < expected.deploymentBlock) {
    throw new Error('Private Liquidity V2 attestation cannot be projected into the position reader.');
  }
  await assertChain(state);
  const canonicalBlock = await readBlock(
    state,
    attestationNumber,
    'Private Liquidity V2 reader attestation block'
  );
  if (canonicalBlock.hash !== attestationHash ||
      keccak256(await readCode(state, expected.contractAddress, canonicalBlock.hash)).toLowerCase() !==
        expected.runtimeBytecodeHash ||
      await readGetter(state, expected.contractAddress, 'contractVersion', [], canonicalBlock.hash) !== VERSION_V2) {
    throw new Error('Private Liquidity V2 Book no longer matches its exact attestation.');
  }
  for (const feature of FEATURES) {
    if (await readGetter(
      state,
      expected.contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes(feature))],
      canonicalBlock.hash
    ) !== true) {
      throw new Error(`Private Liquidity V2 Book is missing inherited feature ${feature}.`);
    }
  }
  if (await readGetter(
    state,
    expected.contractAddress,
    'supportsFeature',
    [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
    canonicalBlock.hash
  ) !== false) {
    throw new Error('Private Liquidity V2 Book unexpectedly supports an app-wallet executor.');
  }
  await assertChain(state);
  if ((await readBlock(
    state,
    attestationNumber,
    'Rechecked Private Liquidity V2 reader attestation block'
  )).hash !== canonicalBlock.hash) {
    throw new Error('Private Liquidity V2 reader attestation block was reorganized.');
  }
  await assertChain(state);
  const deployment = Object.freeze({
    chainId: expected.chainId.toString(),
    contractAddress: expected.contractAddress,
    deploymentBlock: expected.deploymentBlock.toString(),
    runtimeBytecodeHash: expected.runtimeBytecodeHash,
    contractVersion: VERSION_V2,
    requiredFeatures: FEATURES,
    finalityLagBlocks: finalityLagBlocks.toString(),
    attestationBlock: Object.freeze({
      number: attestationNumber.toString(),
      hash: canonicalBlock.hash
    })
  }) as unknown as AttestedPrivateLiquidityDeployment;
  DEPLOYMENTS.set(deployment, Object.freeze({
    capability,
    finalityLagBlocks,
    eventContractAddresses: Object.freeze([
      expected.contractAddress,
      address(v2Deployment.manifest.positionToken.address, 'Private Liquidity V2 Position NFT address')
    ])
  }));
  return deployment;
};

const deploymentBinding = (
  capability: PrivateLiquidityReadCapability,
  deployment: AttestedPrivateLiquidityDeployment
) => {
  const capabilityState = capabilityBinding(capability);
  const deploymentState = deployment && DEPLOYMENTS.get(deployment);
  if (!deploymentState || deploymentState.capability !== capability) {
    throw new Error('Private-liquidity deployment is not attested by this exact read capability.');
  }
  return Object.freeze({ capability: capabilityState, deployment: deploymentState });
};

const normalizeRpcLog = (
  value: unknown,
  chainId: string,
  label: string,
  requireRemoved: boolean
): PrivateLiquidityV1RawLog => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, 'index')) {
    throw new Error(`${label} must use raw JSON-RPC logIndex.`);
  }
  if (requireRemoved ? raw.removed !== false : raw.removed !== undefined && raw.removed !== false) {
    throw new Error(`${label} cannot be a removed-log signal.`);
  }
  if (!Array.isArray(raw.topics)) throw new Error(`${label} topics are missing.`);
  const transactionIndex = rpcQuantity(raw.transactionIndex, `${label} transaction index`);
  const logIndex = rpcQuantity(raw.logIndex, `${label} log index`);
  if (transactionIndex > BigInt(Number.MAX_SAFE_INTEGER) || logIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} indexes exceed the app's safe integer range.`);
  }
  return Object.freeze({
    chainId,
    address: address(raw.address, `${label} address`),
    blockNumber: rpcQuantity(raw.blockNumber, `${label} block number`, UINT64_MAX).toString(),
    blockHash: bytes32(raw.blockHash, `${label} block hash`),
    transactionHash: bytes32(raw.transactionHash, `${label} transaction hash`),
    transactionIndex: Number(transactionIndex),
    logIndex: Number(logIndex),
    removed: false,
    topics: Object.freeze(raw.topics.map((topic, index) =>
      eventTopic(topic, `${label} topic ${index}`)
    )),
    data: bytes(raw.data, `${label} data`, true)
  });
};

const rawLogsEqual = (left: PrivateLiquidityV1RawLog, right: PrivateLiquidityV1RawLog): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
};

const recheckAttestationBlock = async (
  state: CapabilityBinding,
  deployment: AttestedPrivateLiquidityDeployment,
  label: string
): Promise<void> => {
  const number = decimalUint(deployment.attestationBlock.number, `${label} number`, UINT64_MAX);
  if ((await readBlock(state, number, label)).hash !== deployment.attestationBlock.hash) {
    throw new Error('Private-liquidity deployment attestation block was reorganized.');
  }
};

export const assertCanonicalPrivateLiquidityLogRange = (
  page: CanonicalPrivateLiquidityLogRange
): void => {
  if (!page || !CANONICAL_PAGES.has(page)) {
    throw new Error('Private-liquidity range is not a provider-owned canonical page.');
  }
};

export const assertAttestedPrivateLiquidityDeployment = (
  deployment: AttestedPrivateLiquidityDeployment
): void => {
  if (!deployment || !DEPLOYMENTS.has(deployment)) {
    throw new Error('Private-liquidity deployment is not an attested manifest instance.');
  }
};

export const assertCanonicalPrivateLiquidityPositionSnapshot = (
  snapshot: CanonicalPrivateLiquidityPositionSnapshot
): void => {
  if (!snapshot || !CANONICAL_POSITION_SNAPSHOTS.has(snapshot)) {
    throw new Error('Private-liquidity positions are not a provider-owned canonical snapshot.');
  }
};

export const assertCanonicalPrivateLiquidityCatalogAnchor = (
  anchor: CanonicalPrivateLiquidityCatalogAnchor
): void => {
  if (!anchor || !CANONICAL_CATALOG_ANCHORS.has(anchor)) {
    throw new Error('Private-liquidity catalog anchor is not a provider-owned canonical snapshot.');
  }
};

export const assertCompleteCanonicalPrivateLiquidityPositionSnapshot = (
  snapshot: CompleteCanonicalPrivateLiquidityPositionSnapshot
): void => {
  if (!snapshot || !COMPLETE_POSITION_SNAPSHOTS.has(snapshot)) {
    throw new Error('Private-liquidity positions are not a complete canonical snapshot.');
  }
};

/**
 * Returns an exact canonical block at or below the deployment's current safe head. Calling without
 * a block number returns the current safe head. The deployment attestation and runtime are rechecked
 * so checkpoints never rely on an unauthenticated provider number/hash pair.
 */
export const readCanonicalPrivateLiquidityBlock = async ({
  capability,
  deployment,
  blockNumber
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  blockNumber?: bigint;
}): Promise<PrivateLiquidityCanonicalBlock> => {
  const bound = deploymentBinding(capability, deployment);
  const state = bound.capability;
  await recheckAttestationBlock(state, deployment, 'Pre-block private-liquidity attestation block');
  const safeHead = await readSafeHead(state, bound.deployment.finalityLagBlocks);
  if (keccak256(await readCode(state, deployment.contractAddress, safeHead.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Private-liquidity runtime changed at the current safe head.');
  }
  const target = blockNumber ?? safeHead.number;
  if (typeof target !== 'bigint' || target < BigInt(deployment.deploymentBlock) ||
      target > safeHead.number || target > UINT64_MAX) {
    throw new Error('Private-liquidity canonical block is outside the attested safe range.');
  }
  const block = target === safeHead.number
    ? safeHead
    : await readBlock(state, target, 'Private-liquidity canonical block');
  await assertChain(state);
  if ((await readBlock(state, block.number, 'Rechecked private-liquidity canonical block')).hash !== block.hash) {
    throw new Error('Private-liquidity canonical block changed during verification.');
  }
  await recheckAttestationBlock(state, deployment, 'Post-block private-liquidity attestation block');
  await assertChain(state);
  return Object.freeze({ number: block.number.toString(), hash: block.hash });
};

const tupleField = (value: unknown, name: string, index: number): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
};

const positionStatus = (value: unknown): PrivateLiquidityPositionStatus => {
  const normalized = uintFromUnknown(value, 'Private-liquidity position status', 3n);
  if (normalized === 1n) return 'active';
  if (normalized === 2n) return 'paused';
  if (normalized === 3n) return 'closed';
  throw new Error('Private-liquidity position cannot have None status.');
};

const uintFromUnknown = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

/**
 * Binds event discovery to the contract's exact position count at one finalized block. Without
 * this anchor, an RPC provider could omit a PositionCreated log and still return individually
 * valid receipt-bound events.
 */
export const readCanonicalPrivateLiquidityCatalogAnchor = async ({
  capability,
  deployment,
  atBlock
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  atBlock?: bigint;
}): Promise<CanonicalPrivateLiquidityCatalogAnchor> => {
  const bound = deploymentBinding(capability, deployment);
  const state = bound.capability;
  await recheckAttestationBlock(state, deployment, 'Pre-catalog private-liquidity attestation block');
  const safeHead = await readSafeHead(state, bound.deployment.finalityLagBlocks);
  const blockNumber = atBlock ?? safeHead.number;
  if (typeof blockNumber !== 'bigint' || blockNumber < BigInt(deployment.deploymentBlock) ||
      blockNumber > safeHead.number || blockNumber > UINT64_MAX) {
    throw new Error('Private-liquidity catalog block is outside the attested safe range.');
  }
  const block = await readBlock(state, blockNumber, 'Private-liquidity catalog block');
  if (keccak256(await readCode(state, deployment.contractAddress, block.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Private-liquidity catalog runtime does not match the attested deployment.');
  }
  const decoded = await readPositionGetter(
    state,
    deployment.contractAddress,
    'nextPositionId',
    [],
    block.hash
  );
  if (decoded.length !== 1) throw new Error('nextPositionId returned an unexpected result shape.');
  const nextPositionId = uintFromUnknown(decoded[0], 'Next private-liquidity position ID');
  if (nextPositionId === 0n) throw new Error('Next private-liquidity position ID cannot be zero.');

  await assertChain(state);
  if ((await readBlock(state, block.number, 'Rechecked private-liquidity catalog block')).hash !== block.hash) {
    throw new Error('Private-liquidity catalog block changed during verification.');
  }
  await recheckAttestationBlock(state, deployment, 'Post-catalog private-liquidity attestation block');
  await assertChain(state);
  const anchor = Object.freeze({
    scope: Object.freeze({
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      deploymentBlock: deployment.deploymentBlock
    }),
    atBlock: Object.freeze({ number: block.number.toString(), hash: block.hash }),
    nextPositionId: nextPositionId.toString(),
    positionCount: (nextPositionId - 1n).toString()
  }) as CanonicalPrivateLiquidityCatalogAnchor;
  CANONICAL_CATALOG_ANCHORS.add(anchor);
  return anchor;
};

export const readCanonicalPrivateLiquidityPositions = async ({
  capability,
  deployment,
  positionIds,
  atBlock
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  positionIds: readonly bigint[];
  atBlock?: bigint;
}): Promise<CanonicalPrivateLiquidityPositionSnapshot> => {
  if (!Array.isArray(positionIds) || positionIds.length === 0 || positionIds.length > 128) {
    throw new Error('Private-liquidity position view batch must contain between 1 and 128 IDs.');
  }
  const ids = positionIds.map((id) => uintFromUnknown(id, 'Private-liquidity position ID'));
  if (ids.some((id) => id === 0n) || new Set(ids.map(String)).size !== ids.length) {
    throw new Error('Private-liquidity position IDs must be positive and unique.');
  }
  const bound = deploymentBinding(capability, deployment);
  const state = bound.capability;
  await recheckAttestationBlock(state, deployment, 'Pre-view private-liquidity attestation block');
  const safeHead = await readSafeHead(state, bound.deployment.finalityLagBlocks);
  const blockNumber = atBlock ?? safeHead.number;
  if (typeof blockNumber !== 'bigint' || blockNumber < BigInt(deployment.deploymentBlock) ||
      blockNumber > safeHead.number || blockNumber > UINT64_MAX) {
    throw new Error('Private-liquidity position view block is outside the attested safe range.');
  }
  const block = await readBlock(state, blockNumber, 'Private-liquidity position view block');
  if (keccak256(await readCode(state, deployment.contractAddress, block.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Private-liquidity position view runtime does not match the attested deployment.');
  }

  const positions: PrivateLiquidityPosition[] = [];
  for (const id of ids) {
    const decoded = await readPositionGetter(
      state,
      deployment.contractAddress,
      'getPositionView',
      [id],
      block.hash
    );
    if (decoded.length !== 1) throw new Error('getPositionView returned an unexpected result shape.');
    const view = decoded[0];
    const stored = tupleField(view, 'position', 0);
    const returnedId = uintFromUnknown(tupleField(view, 'positionId', 1), 'Returned position ID');
    if (returnedId !== id) throw new Error('getPositionView returned another position ID.');
    const privacyOwnerRaw = address(tupleField(stored, 'privacyOwner', 9), 'Position privacy owner', true);
    const activity = await readPositionGetter(
      state,
      deployment.contractAddress,
      'lastActivityBlock',
      [id],
      block.hash
    );
    if (activity.length !== 1) throw new Error('lastActivityBlock returned an unexpected result shape.');
    const buyTerms = tupleField(stored, 'buyTerms', 3);
    const sellTerms = tupleField(stored, 'sellTerms', 4);
    const position: PrivateLiquidityPosition = Object.freeze({
      identity: Object.freeze({
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        positionId: id.toString()
      }),
      owner: address(tupleField(view, 'positionOwner', 2), 'Position owner'),
      pairKey: bytes32(tupleField(view, 'pairKey', 3), 'Position pair key'),
      baseToken: address(tupleField(stored, 'baseToken', 1), 'Position base token'),
      quoteToken: address(tupleField(stored, 'quoteToken', 2), 'Position quote token'),
      buyTerms: Object.freeze({
        baseAmount: uintFromUnknown(tupleField(buyTerms, 'baseAmount', 0), 'Buy base terms').toString(),
        quoteAmount: uintFromUnknown(tupleField(buyTerms, 'quoteAmount', 1), 'Buy quote terms').toString()
      }),
      sellTerms: Object.freeze({
        baseAmount: uintFromUnknown(tupleField(sellTerms, 'baseAmount', 0), 'Sell base terms').toString(),
        quoteAmount: uintFromUnknown(tupleField(sellTerms, 'quoteAmount', 1), 'Sell quote terms').toString()
      }),
      status: positionStatus(tupleField(stored, 'status', 0)),
      revision: uintFromUnknown(tupleField(stored, 'revision', 6), 'Position revision', UINT64_MAX).toString(),
      buySideAvailable: tupleField(stored, 'buySideAvailable', 10) === true,
      sellSideAvailable: tupleField(stored, 'sellSideAvailable', 11) === true,
      privacyOwner: privacyOwnerRaw === ZERO_ADDRESS ? null : privacyOwnerRaw,
      createdAt: uintFromUnknown(tupleField(stored, 'createdAt', 5), 'Position creation time', UINT64_MAX).toString(),
      lastActivityBlock: uintFromUnknown(activity[0], 'Position activity block').toString()
    });
    validatePrivateLiquidityPosition(position);
    positions.push(position);
  }

  await assertChain(state);
  if ((await readBlock(state, block.number, 'Rechecked private-liquidity position view block')).hash !== block.hash) {
    throw new Error('Private-liquidity position view block changed during verification.');
  }
  await recheckAttestationBlock(state, deployment, 'Post-view private-liquidity attestation block');
  await assertChain(state);
  const snapshot = Object.freeze({
    scope: Object.freeze({
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      deploymentBlock: deployment.deploymentBlock
    }),
    atBlock: Object.freeze({ number: block.number.toString(), hash: block.hash }),
    positions: Object.freeze(positions)
  }) as unknown as CanonicalPrivateLiquidityPositionSnapshot;
  CANONICAL_POSITION_SNAPSHOTS.add(snapshot);
  return snapshot;
};

/**
 * Composes bounded position-view batches into one complete, block-consistent snapshot. The catalog
 * anchor supplies the exact position count, so the workspace cannot mistake a partial page for the
 * whole market or wallet inventory.
 */
export const composeCompleteCanonicalPrivateLiquidityPositionSnapshot = ({
  anchor,
  snapshots
}: {
  anchor: CanonicalPrivateLiquidityCatalogAnchor;
  snapshots: readonly CanonicalPrivateLiquidityPositionSnapshot[];
}): CompleteCanonicalPrivateLiquidityPositionSnapshot => {
  assertCanonicalPrivateLiquidityCatalogAnchor(anchor);
  if (!Array.isArray(snapshots)) throw new Error('Private-liquidity position snapshots are missing.');
  const positions = new Map<bigint, PrivateLiquidityPosition>();
  for (const snapshot of snapshots) {
    assertCanonicalPrivateLiquidityPositionSnapshot(snapshot);
    if (
      snapshot.scope.chainId !== anchor.scope.chainId ||
      snapshot.scope.contractAddress !== anchor.scope.contractAddress ||
      snapshot.scope.deploymentBlock !== anchor.scope.deploymentBlock ||
      snapshot.atBlock.number !== anchor.atBlock.number ||
      snapshot.atBlock.hash !== anchor.atBlock.hash
    ) {
      throw new Error('Private-liquidity position batch belongs to another catalog snapshot.');
    }
    for (const position of snapshot.positions) {
      validatePrivateLiquidityPosition(position);
      const id = uintFromUnknown(position.identity.positionId, 'Composed private-liquidity position ID');
      if (id === 0n || positions.has(id)) {
        throw new Error('Private-liquidity position batches contain a duplicate or zero ID.');
      }
      positions.set(id, position);
    }
  }
  const expectedCount = uintFromUnknown(anchor.positionCount, 'Private-liquidity catalog position count');
  if (BigInt(positions.size) !== expectedCount) {
    throw new Error('Private-liquidity position batches do not cover the complete catalog.');
  }
  const ordered = [...positions.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([id, position], index) => {
      if (id !== BigInt(index + 1)) {
        throw new Error('Private-liquidity position batches are not a contiguous catalog.');
      }
      return position;
    });
  const complete = Object.freeze({
    scope: anchor.scope,
    atBlock: anchor.atBlock,
    positionCount: expectedCount.toString(),
    positions: Object.freeze(ordered)
  }) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot;
  CANONICAL_POSITION_SNAPSHOTS.add(complete);
  COMPLETE_POSITION_SNAPSHOTS.add(complete);
  return complete;
};

export const readCanonicalPrivateLiquidityLogRange = async ({
  capability,
  deployment,
  fromBlock,
  toBlock
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<CanonicalPrivateLiquidityLogRange> => {
  if (typeof fromBlock !== 'bigint' || typeof toBlock !== 'bigint' || fromBlock < 0n ||
      toBlock < fromBlock || toBlock > UINT64_MAX ||
      toBlock - fromBlock + 1n > PRIVATE_LIQUIDITY_MAX_LOG_RANGE_BLOCKS) {
    throw new Error('Private-liquidity range must be an ordered bounded uint64 bigint range.');
  }
  const bound = deploymentBinding(capability, deployment);
  const state = bound.capability;
  await recheckAttestationBlock(state, deployment, 'Pre-range private-liquidity attestation block');
  const safeHead = await readSafeHead(state, bound.deployment.finalityLagBlocks);
  if (fromBlock < BigInt(deployment.deploymentBlock)) throw new Error('Private-liquidity range predates deployment.');
  if (toBlock > safeHead.number) throw new Error('Private-liquidity range extends above the safe head.');
  if (keccak256(await readCode(state, deployment.contractAddress, safeHead.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Current private-liquidity runtime no longer matches its attested deployment.');
  }

  const checkedBlocks = new Map<string, RpcBlock>();
  const checkedBlock = async (number: bigint, label: string): Promise<RpcBlock> => {
    const key = number.toString();
    const cached = checkedBlocks.get(key);
    if (cached) return cached;
    const block = await readBlock(state, number, label);
    checkedBlocks.set(key, block);
    return block;
  };
  const first = await checkedBlock(fromBlock, 'Private-liquidity range start block');
  const last = await checkedBlock(toBlock, 'Private-liquidity range end block');
  const logs: unknown[] = [];
  for (const eventAddress of bound.deployment.eventContractAddresses) {
    for (let offset = 0; offset < EVENT_TOPICS.length; offset += EVENT_TOPIC_QUERY_BATCH_SIZE) {
      const topicBatch = EVENT_TOPICS.slice(offset, offset + EVENT_TOPIC_QUERY_BATCH_SIZE);
      const result = await rpc(state, 'eth_getLogs', [{
        address: eventAddress,
        fromBlock: quantityHex(fromBlock),
        toBlock: quantityHex(toBlock),
        topics: [topicBatch]
      }]);
      if (!Array.isArray(result)) {
        throw new Error('Private-liquidity range query did not return a log array.');
      }
      for (const candidate of result) {
        if (!candidate || typeof candidate !== 'object') {
          throw new Error('Provider returned a private-liquidity log outside its requested filter.');
        }
        const candidateRecord = candidate as Record<string, unknown>;
        if (address(candidateRecord.address, 'Private-liquidity queried log address') !== eventAddress ||
            !Array.isArray(candidateRecord.topics) ||
            !topicBatch.includes(String(candidateRecord.topics[0]).toLowerCase())) {
          throw new Error('Provider returned a private-liquidity log outside its requested filter.');
        }
        logs.push(candidate);
        if (logs.length > PRIVATE_LIQUIDITY_MAX_LOGS_PER_RANGE) {
          throw new Error('Private-liquidity range returned too many logs; split the range.');
        }
      }
    }
  }

  const physical = new Set<string>();
  const events: ParsedPrivateLiquidityV1Log[] = [];
  const normalizedLogs = logs.map((candidate, position) =>
    normalizeRpcLog(candidate, deployment.chainId, `Private-liquidity log ${position}`, true)
  ).sort((left, right) => {
    const blockDelta = BigInt(left.blockNumber) - BigInt(right.blockNumber);
    if (blockDelta !== 0n) return blockDelta < 0n ? -1 : 1;
    if (left.transactionIndex !== right.transactionIndex) {
      return left.transactionIndex - right.transactionIndex;
    }
    return left.logIndex - right.logIndex;
  });
  for (let position = 0; position < normalizedLogs.length; position += 1) {
    const raw = normalizedLogs[position];
    const blockNumber = BigInt(raw.blockNumber);
    if (blockNumber < fromBlock || blockNumber > toBlock) {
      throw new Error('Provider returned a private-liquidity log outside the requested range.');
    }
    const identity = `${raw.blockHash}:${raw.transactionHash}:${raw.logIndex}`;
    if (physical.has(identity)) throw new Error('Provider returned a duplicate physical private-liquidity log.');
    physical.add(identity);
    const event = parsePrivateLiquidityV1Log(raw);
    const expectedEventAddress = event.kind === 'position-transfer'
      ? bound.deployment.eventContractAddresses[bound.deployment.eventContractAddresses.length - 1]
      : deployment.contractAddress;
    if (raw.address !== expectedEventAddress) {
      throw new Error('Private-liquidity event was emitted by the wrong attested component.');
    }
    const block = await checkedBlock(blockNumber, 'Canonical private-liquidity event block');
    if (block.hash !== raw.blockHash) throw new Error('Private-liquidity log belongs to an orphan block.');
    if (raw.transactionIndex >= block.transactions.length ||
        block.transactions[raw.transactionIndex] !== raw.transactionHash) {
      throw new Error('Private-liquidity transaction slot is not canonical.');
    }
    const receiptValue = await rpc(state, 'eth_getTransactionReceipt', [raw.transactionHash]);
    if (!receiptValue || typeof receiptValue !== 'object') throw new Error('Private-liquidity receipt is missing.');
    const receipt = receiptValue as Record<string, unknown>;
    if (rpcQuantity(receipt.status, 'Private-liquidity receipt status') !== 1n ||
        rpcQuantity(receipt.blockNumber, 'Private-liquidity receipt block number', UINT64_MAX) !== blockNumber ||
        bytes32(receipt.blockHash, 'Private-liquidity receipt block hash') !== raw.blockHash ||
        bytes32(receipt.transactionHash, 'Private-liquidity receipt transaction hash') !== raw.transactionHash ||
        rpcQuantity(receipt.transactionIndex, 'Private-liquidity receipt transaction index') !==
          BigInt(raw.transactionIndex) || !Array.isArray(receipt.logs)) {
      throw new Error('Private-liquidity receipt is unsuccessful or has noncanonical metadata.');
    }
    const matches = receipt.logs
      .map((candidate, index) => normalizeRpcLog(
        candidate,
        deployment.chainId,
        `Private-liquidity receipt log ${index}`,
        false
      ))
      .filter((candidate) => candidate.logIndex === raw.logIndex);
    if (matches.length !== 1 || !rawLogsEqual(raw, matches[0])) {
      throw new Error('Private-liquidity log does not exactly match one successful receipt log.');
    }
    events.push(deepFreeze(event));
  }

  await assertChain(state);
  const latestAfter = rpcQuantity(await rpc(state, 'eth_blockNumber'), 'Post-range latest block', UINT64_MAX);
  if (latestAfter < safeHead.number + bound.deployment.finalityLagBlocks) {
    throw new Error('Private-liquidity range lost its finality depth.');
  }
  if ((await readBlock(state, safeHead.number, 'Post-range private-liquidity safe head')).hash !== safeHead.hash) {
    throw new Error('Private-liquidity safe head was reorganized.');
  }
  for (const block of checkedBlocks.values()) {
    if ((await readBlock(state, block.number, 'Rechecked private-liquidity block')).hash !== block.hash) {
      throw new Error('A private-liquidity block changed during verification.');
    }
  }
  await recheckAttestationBlock(state, deployment, 'Post-range private-liquidity attestation block');
  await assertChain(state);

  events.sort((left, right) =>
    BigInt(left.provenance.blockNumber) < BigInt(right.provenance.blockNumber) ? -1
      : BigInt(left.provenance.blockNumber) > BigInt(right.provenance.blockNumber) ? 1
        : left.provenance.transactionIndex - right.provenance.transactionIndex ||
          left.provenance.logIndex - right.provenance.logIndex
  );
  const page = Object.freeze({
    scope: Object.freeze({
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      deploymentBlock: deployment.deploymentBlock
    }),
    range: Object.freeze({
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      fromBlockHash: first.hash,
      toBlockHash: last.hash
    }),
    safeHead: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash }),
    checkedBlocks: Object.freeze([...checkedBlocks.values()]
      .sort((left, right) => left.number < right.number ? -1 : left.number > right.number ? 1 : 0)
      .map((block) => Object.freeze({ number: block.number.toString(), hash: block.hash }))),
    events: Object.freeze(events)
  }) as CanonicalPrivateLiquidityLogRange;
  CANONICAL_PAGES.add(page);
  return page;
};
