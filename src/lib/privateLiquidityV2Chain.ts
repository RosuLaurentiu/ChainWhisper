import {
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import type { PrivateLiquidityV2Manifest } from './privateLiquidityV2Deployment';

const ABI = new Interface([
  'function contractVersion() view returns (string)',
  'function moduleVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function positionToken() view returns (address)',
  'function hiddenIntentModule() view returns (address)',
  'function hiddenIntentModuleRuntimeHash() view returns (bytes32)',
  'function positionBook() view returns (address)',
  'function intendedBook() view returns (address)',
  'function intendedPositionToken() view returns (address)',
  'function moduleSelf() view returns (address)'
]);

export const PRIVATE_LIQUIDITY_V2_BOOK_VERSION = 'ChainWhisperPrivateLiquidityBookV2';
export const PRIVATE_LIQUIDITY_V2_MODULE_VERSION =
  'ChainWhisperPrivateLiquidityHiddenIntentModuleV2';
export const PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION =
  'ChainWhisperPrivateLiquidityPositionNFTV2';

export const PRIVATE_LIQUIDITY_V2_BOOK_FEATURES = Object.freeze([
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
  'CONTRIBUTOR_COUNT_MAY_LEAK',
  'HIDDEN_INTENTS',
  'IMMUTABLE_HIDDEN_INTENT_MODULE',
  'CONTRACT_SELECTED_INTENT_QUEUE',
  'COMPLETE_BOUNDED_HIDDEN_ROUTES'
] as const);

export const PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES = Object.freeze([
  'IMMUTABLE_POSITION_BOOK',
  'TRANSFER_CALLBACK',
  'NO_ADMIN_UPGRADE'
] as const);

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type Binding = Readonly<{
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}>;

declare const PRIVATE_LIQUIDITY_V2_READ_CAPABILITY_BRAND: unique symbol;
export type PrivateLiquidityV2ReadCapability = Readonly<{
  readonly [PRIVATE_LIQUIDITY_V2_READ_CAPABILITY_BRAND]: true;
}>;

export type PrivateLiquidityV2CanonicalBlock = Readonly<{ number: string; hash: string }>;

declare const ATTESTED_PRIVATE_LIQUIDITY_V2_DEPLOYMENT_BRAND: unique symbol;
export type AttestedPrivateLiquidityV2Deployment = Readonly<{
  manifest: PrivateLiquidityV2Manifest;
  bookVersion: typeof PRIVATE_LIQUIDITY_V2_BOOK_VERSION;
  moduleVersion: typeof PRIVATE_LIQUIDITY_V2_MODULE_VERSION;
  positionTokenVersion: typeof PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION;
  bookFeatures: typeof PRIVATE_LIQUIDITY_V2_BOOK_FEATURES;
  positionTokenFeatures: typeof PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES;
  finalityLagBlocks: string;
  attestationBlock: PrivateLiquidityV2CanonicalBlock;
  readonly [ATTESTED_PRIVATE_LIQUIDITY_V2_DEPLOYMENT_BRAND]: true;
}>;

const CAPABILITIES = new WeakMap<object, Binding>();
const DEPLOYMENTS = new WeakMap<object, Readonly<{
  capability: PrivateLiquidityV2ReadCapability;
  finalityLagBlocks: bigint;
}>>();

const uint = (value: bigint | number | string, label: string, maximum = UINT256_MAX): bigint => {
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

const quantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) ||
      value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32.`);
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

const bindingFor = (capability: PrivateLiquidityV2ReadCapability): Binding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('Private Liquidity V2 requires an exact current read capability.');
  return binding;
};

const rpc = async (
  binding: Binding,
  method: string,
  params: readonly unknown[] = []
): Promise<unknown> => {
  await binding.assertCurrent();
  let result: unknown;
  try {
    result = await binding.request({ method, params: [...params] });
  } catch (error) {
    const sanitizedCause = error instanceof Error &&
      /^Private-liquidity JSON-RPC (?:transport failed|transport returned an error status|response is not JSON|response is malformed|response failed validation|response was rejected(?: \(code -?[0-9]+\))?)\.$/u.test(error.message)
      ? `: ${error.message}`
      : '.';
    throw new Error(`Private Liquidity V2 RPC ${method} failed${sanitizedCause}`);
  }
  await binding.assertCurrent();
  return result;
};

const assertChain = async (binding: Binding): Promise<void> => {
  const actual = quantity(await rpc(binding, 'eth_chainId'), 'Private Liquidity V2 chain ID');
  if (actual !== binding.chainId) throw new Error('Private Liquidity V2 read capability chain changed.');
};

export const bindPrivateLiquidityV2ReadCapability = async ({
  provider,
  expectedChainId,
  assertCurrent
}: {
  provider: ReadProvider;
  expectedChainId: bigint;
  assertCurrent: () => void | Promise<void>;
}): Promise<PrivateLiquidityV2ReadCapability> => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' ||
      typeof expectedChainId !== 'bigint' || expectedChainId <= 0n || expectedChainId > UINT256_MAX) {
    throw new Error('Cannot bind an invalid Private Liquidity V2 read capability.');
  }
  const binding = Object.freeze({
    request: provider.request.bind(provider),
    chainId: expectedChainId,
    assertCurrent
  });
  await assertChain(binding);
  const capability = Object.freeze({}) as PrivateLiquidityV2ReadCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

type RpcBlock = Readonly<{ number: bigint; hash: string }>;

const readBlock = async (binding: Binding, number: bigint, label: string): Promise<RpcBlock> => {
  const value = await rpc(binding, 'eth_getBlockByNumber', [quantityHex(number), false]);
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  const returnedNumber = quantity(raw.number, `${label} number`, UINT64_MAX);
  if (returnedNumber !== number) throw new Error(`${label} returned another block.`);
  return Object.freeze({ number, hash: bytes32(raw.hash, `${label} hash`) });
};

const readCode = async (
  binding: Binding,
  contractAddress: string,
  blockHash: string,
  label: string,
  allowEmpty = false
): Promise<string> => bytes(
  await rpc(binding, 'eth_getCode', [contractAddress, eip1898(blockHash)]),
  `${label} runtime`,
  allowEmpty
);

const readGetter = async (
  binding: Binding,
  contractAddress: string,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => {
  const data = ABI.encodeFunctionData(functionName, [...args]);
  const raw = bytes(
    await rpc(binding, 'eth_call', [{ to: contractAddress, data }, eip1898(blockHash)]),
    `${functionName} result`,
    true
  );
  let decoded;
  try {
    decoded = ABI.decodeFunctionResult(functionName, raw);
  } catch {
    throw new Error(`${functionName} returned malformed ABI data.`);
  }
  if (ABI.encodeFunctionResult(functionName, [...decoded]).toLowerCase() !== raw || decoded.length !== 1) {
    throw new Error(`${functionName} returned noncanonical ABI data.`);
  }
  return decoded[0];
};

const normalizeManifest = (manifest: PrivateLiquidityV2Manifest): Readonly<{
  chainId: bigint;
  book: Readonly<{
    address: string;
    deploymentBlock: bigint;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
  hiddenIntentModule: Readonly<{
    address: string;
    deploymentBlock: bigint;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
  positionToken: Readonly<{
    address: string;
    deploymentBlock: bigint;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
}> => {
  if (!manifest || typeof manifest !== 'object') throw new Error('Private Liquidity V2 manifest is missing.');
  const normalizeContract = (
    input: PrivateLiquidityV2Manifest['book'],
    label: string
  ) => Object.freeze({
    address: address(input?.address, `${label} address`),
    deploymentBlock: uint(input?.deploymentBlock, `${label} deployment block`, UINT64_MAX),
    deploymentBlockHash: bytes32(input?.deploymentBlockHash, `${label} deployment block hash`),
    creationTransactionHash: bytes32(
      input?.creationTransactionHash,
      `${label} creation transaction hash`
    ),
    runtimeBytecodeHash: bytes32(input?.runtimeBytecodeHash, `${label} runtime hash`)
  });
  const normalized = Object.freeze({
    chainId: uint(manifest.chainId, 'Private Liquidity V2 manifest chain ID'),
    book: normalizeContract(manifest.book, 'Private Liquidity V2 Book'),
    hiddenIntentModule: normalizeContract(
      manifest.hiddenIntentModule,
      'Private Liquidity V2 hidden-intent module'
    ),
    positionToken: normalizeContract(manifest.positionToken, 'Private Liquidity V2 Position NFT')
  });
  if (normalized.chainId === 0n || normalized.book.deploymentBlock === 0n ||
      normalized.hiddenIntentModule.deploymentBlock === 0n ||
      normalized.positionToken.deploymentBlock !== normalized.book.deploymentBlock ||
      normalized.positionToken.deploymentBlockHash !== normalized.book.deploymentBlockHash ||
      normalized.positionToken.creationTransactionHash !== normalized.book.creationTransactionHash ||
      normalized.hiddenIntentModule.deploymentBlock > normalized.book.deploymentBlock) {
    throw new Error('Private Liquidity V2 manifest has impossible deployment ordering.');
  }
  if (new Set([
    normalized.book.address,
    normalized.hiddenIntentModule.address,
    normalized.positionToken.address
  ]).size !== 3) {
    throw new Error('Private Liquidity V2 manifest contract addresses must be distinct.');
  }
  return normalized;
};

const requireFeatures = async (
  binding: Binding,
  contractAddress: string,
  features: readonly string[],
  blockHash: string
): Promise<void> => {
  for (const feature of features) {
    const supported = await readGetter(
      binding,
      contractAddress,
      'supportsFeature',
      [keccak256(toUtf8Bytes(feature))],
      blockHash
    );
    if (supported !== true) throw new Error(`Private Liquidity V2 is missing ${feature}.`);
  }
};

const requireCreationProvenance = async ({
  binding,
  contractAddress,
  deploymentBlock,
  deploymentBlockHash,
  creationTransactionHash,
  label
}: {
  binding: Binding;
  contractAddress: string;
  deploymentBlock: bigint;
  deploymentBlockHash: string;
  creationTransactionHash: string;
  label: string;
}): Promise<RpcBlock> => {
  const deployment = await readBlock(binding, deploymentBlock, `${label} deployment block`);
  if (deployment.hash !== deploymentBlockHash) {
    throw new Error(`${label} deployment block differs from its manifest.`);
  }
  const rawReceipt = await rpc(binding, 'eth_getTransactionReceipt', [creationTransactionHash]);
  if (!rawReceipt || typeof rawReceipt !== 'object') throw new Error(`${label} creation receipt is missing.`);
  const receipt = rawReceipt as Record<string, unknown>;
  if (bytes32(receipt.transactionHash, `${label} receipt transaction hash`) !== creationTransactionHash ||
      quantity(receipt.blockNumber, `${label} receipt block number`, UINT64_MAX) !== deploymentBlock ||
      bytes32(receipt.blockHash, `${label} receipt block hash`) !== deploymentBlockHash ||
      quantity(receipt.status, `${label} receipt status`) !== 1n ||
      address(receipt.contractAddress, `${label} receipt contract`) !== contractAddress) {
    throw new Error(`${label} creation receipt differs from its manifest.`);
  }
  return deployment;
};

export const attestPrivateLiquidityV2Deployment = async ({
  capability,
  manifest,
  finalityLagBlocks
}: {
  capability: PrivateLiquidityV2ReadCapability;
  manifest: PrivateLiquidityV2Manifest;
  finalityLagBlocks: bigint;
}): Promise<AttestedPrivateLiquidityV2Deployment> => {
  const binding = bindingFor(capability);
  const expected = normalizeManifest(manifest);
  if (binding.chainId !== expected.chainId) throw new Error('Private Liquidity V2 manifest chain differs.');
  if (typeof finalityLagBlocks !== 'bigint' || finalityLagBlocks <= 0n || finalityLagBlocks > 4_096n) {
    throw new Error('Private Liquidity V2 finality lag is invalid.');
  }
  await assertChain(binding);
  const latest = quantity(await rpc(binding, 'eth_blockNumber'), 'Latest Private Liquidity V2 block', UINT64_MAX);
  if (latest < finalityLagBlocks) throw new Error('Private Liquidity V2 safe head is below genesis.');
  const safeHead = await readBlock(
    binding,
    latest - finalityLagBlocks,
    'Private Liquidity V2 safe-head block'
  );
  if (safeHead.number < expected.book.deploymentBlock) {
    throw new Error('Private Liquidity V2 safe head predates the deployment.');
  }

  const creationBlocks = await Promise.all([
    requireCreationProvenance({
      binding,
      contractAddress: expected.book.address,
      deploymentBlock: expected.book.deploymentBlock,
      deploymentBlockHash: expected.book.deploymentBlockHash,
      creationTransactionHash: expected.book.creationTransactionHash,
      label: 'Private Liquidity V2 Book'
    }),
    requireCreationProvenance({
      binding,
      contractAddress: expected.hiddenIntentModule.address,
      deploymentBlock: expected.hiddenIntentModule.deploymentBlock,
      deploymentBlockHash: expected.hiddenIntentModule.deploymentBlockHash,
      creationTransactionHash: expected.hiddenIntentModule.creationTransactionHash,
      label: 'Private Liquidity V2 hidden-intent module'
    })
  ]);
  const safeCodes = await Promise.all([
    readCode(binding, expected.book.address, safeHead.hash, 'Private Liquidity V2 Book'),
    readCode(binding, expected.hiddenIntentModule.address, safeHead.hash, 'Private Liquidity V2 module'),
    readCode(binding, expected.positionToken.address, safeHead.hash, 'Private Liquidity V2 Position NFT')
  ]);
  if (keccak256(safeCodes[0]).toLowerCase() !== expected.book.runtimeBytecodeHash ||
      keccak256(safeCodes[1]).toLowerCase() !== expected.hiddenIntentModule.runtimeBytecodeHash ||
      keccak256(safeCodes[2]).toLowerCase() !== expected.positionToken.runtimeBytecodeHash) {
    throw new Error('A current Private Liquidity V2 runtime differs from its manifest.');
  }

  const [bookVersion, positionVersion, moduleVersion, positionToken, module, pinnedModuleHash,
    positionBook, intendedBook, intendedPositionToken, moduleSelf, appWalletExecutor] = await Promise.all([
    readGetter(binding, expected.book.address, 'contractVersion', [], safeHead.hash),
    readGetter(binding, expected.positionToken.address, 'contractVersion', [], safeHead.hash),
    readGetter(binding, expected.hiddenIntentModule.address, 'moduleVersion', [], safeHead.hash),
    readGetter(binding, expected.book.address, 'positionToken', [], safeHead.hash),
    readGetter(binding, expected.book.address, 'hiddenIntentModule', [], safeHead.hash),
    readGetter(binding, expected.book.address, 'hiddenIntentModuleRuntimeHash', [], safeHead.hash),
    readGetter(binding, expected.positionToken.address, 'positionBook', [], safeHead.hash),
    readGetter(binding, expected.hiddenIntentModule.address, 'intendedBook', [], safeHead.hash),
    readGetter(binding, expected.hiddenIntentModule.address, 'intendedPositionToken', [], safeHead.hash),
    readGetter(binding, expected.hiddenIntentModule.address, 'moduleSelf', [], safeHead.hash),
    readGetter(
      binding,
      expected.book.address,
      'supportsFeature',
      [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
      safeHead.hash
    )
  ]);
  if (bookVersion !== PRIVATE_LIQUIDITY_V2_BOOK_VERSION ||
      positionVersion !== PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION ||
      moduleVersion !== PRIVATE_LIQUIDITY_V2_MODULE_VERSION) {
    throw new Error('A Private Liquidity V2 component version is incorrect.');
  }
  if (address(positionToken, 'Book Position NFT') !== expected.positionToken.address ||
      address(module, 'Book hidden-intent module') !== expected.hiddenIntentModule.address ||
      bytes32(pinnedModuleHash, 'Book module runtime hash') !== expected.hiddenIntentModule.runtimeBytecodeHash ||
      address(positionBook, 'Position NFT Book') !== expected.book.address ||
      address(intendedBook, 'Module intended Book') !== expected.book.address ||
      address(intendedPositionToken, 'Module intended Position NFT') !== expected.positionToken.address ||
      address(moduleSelf, 'Module self address') !== expected.hiddenIntentModule.address ||
      appWalletExecutor !== false) {
    throw new Error('Private Liquidity V2 immutable component bindings are inconsistent.');
  }
  await requireFeatures(binding, expected.book.address, PRIVATE_LIQUIDITY_V2_BOOK_FEATURES, safeHead.hash);
  await requireFeatures(
    binding,
    expected.positionToken.address,
    PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES,
    safeHead.hash
  );

  await assertChain(binding);
  const latestAfter = quantity(
    await rpc(binding, 'eth_blockNumber'),
    'Post-attestation Private Liquidity V2 block',
    UINT64_MAX
  );
  if (latestAfter < safeHead.number + finalityLagBlocks ||
      (await readBlock(binding, safeHead.number, 'Rechecked Private Liquidity V2 safe head')).hash !== safeHead.hash) {
    throw new Error('Private Liquidity V2 attestation lost canonical finality.');
  }
  for (const creationBlock of creationBlocks) {
    if ((await readBlock(binding, creationBlock.number, 'Rechecked deployment block')).hash !==
        creationBlock.hash) {
      throw new Error('A Private Liquidity V2 deployment boundary was reorganized.');
    }
  }
  await assertChain(binding);

  const frozenManifest = Object.freeze({
    chainId: expected.chainId.toString(),
    book: Object.freeze({
      address: expected.book.address,
      deploymentBlock: expected.book.deploymentBlock.toString(),
      deploymentBlockHash: expected.book.deploymentBlockHash,
      creationTransactionHash: expected.book.creationTransactionHash,
      runtimeBytecodeHash: expected.book.runtimeBytecodeHash
    }),
    hiddenIntentModule: Object.freeze({
      address: expected.hiddenIntentModule.address,
      deploymentBlock: expected.hiddenIntentModule.deploymentBlock.toString(),
      deploymentBlockHash: expected.hiddenIntentModule.deploymentBlockHash,
      creationTransactionHash: expected.hiddenIntentModule.creationTransactionHash,
      runtimeBytecodeHash: expected.hiddenIntentModule.runtimeBytecodeHash
    }),
    positionToken: Object.freeze({
      address: expected.positionToken.address,
      deploymentBlock: expected.positionToken.deploymentBlock.toString(),
      deploymentBlockHash: expected.positionToken.deploymentBlockHash,
      creationTransactionHash: expected.positionToken.creationTransactionHash,
      runtimeBytecodeHash: expected.positionToken.runtimeBytecodeHash
    })
  });
  const deployment = Object.freeze({
    manifest: frozenManifest,
    bookVersion: PRIVATE_LIQUIDITY_V2_BOOK_VERSION,
    moduleVersion: PRIVATE_LIQUIDITY_V2_MODULE_VERSION,
    positionTokenVersion: PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION,
    bookFeatures: PRIVATE_LIQUIDITY_V2_BOOK_FEATURES,
    positionTokenFeatures: PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES,
    finalityLagBlocks: finalityLagBlocks.toString(),
    attestationBlock: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash })
  }) as AttestedPrivateLiquidityV2Deployment;
  DEPLOYMENTS.set(deployment, Object.freeze({ capability, finalityLagBlocks }));
  return deployment;
};

export const assertAttestedPrivateLiquidityV2Deployment = (
  deployment: AttestedPrivateLiquidityV2Deployment
): AttestedPrivateLiquidityV2Deployment => {
  if (!deployment || !DEPLOYMENTS.has(deployment)) {
    throw new Error('Private Liquidity V2 requires a deployment from its exact attester.');
  }
  return deployment;
};
