import { Interface, getAddress, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import type { PrivateLiquidityDailyPriceManifest } from './privateLiquidityDailyPriceDeployment';
import DAILY_PRICE_READ_ABI from './privateLiquidityDailyPriceAbi.json';
import {
  normalizePrivateLiquidityDailyPriceSnapshot,
  type PrivateLiquidityDailyPriceSnapshot
} from './privateLiquidityDailyPrice';

export const PRIVATE_LIQUIDITY_DAILY_PRICE_READ_ABI = Object.freeze([...DAILY_PRICE_READ_ABI]);
const STORE = new Interface(PRIVATE_LIQUIDITY_DAILY_PRICE_READ_ABI);

export const PRIVATE_LIQUIDITY_DAILY_PRICE_VERSION = 'ChainWhisperPrivateLiquidityDailyPriceStoreV1';
export const PRIVATE_LIQUIDITY_DAILY_PRICE_FEATURES = Object.freeze([
  'DAILY_MARGINAL_PRICE',
  'ANALYTICS_ONLY',
  'SOURCE_PROVENANCE'
] as const);
export const PRIVATE_LIQUIDITY_DAILY_PRICE_MAX_PAGE = 366n;

const UINT64_MAX = (1n << 64n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

type Provider = Pick<Eip1193Provider, 'request'>;
type Binding = Readonly<{
  request: Provider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}>;

declare const DAILY_PRICE_READ_CAPABILITY: unique symbol;
export type PrivateLiquidityDailyPriceReadCapability = Readonly<{
  readonly [DAILY_PRICE_READ_CAPABILITY]: true;
}>;

declare const ATTESTED_DAILY_PRICE_DEPLOYMENT: unique symbol;
export type AttestedPrivateLiquidityDailyPriceDeployment = Readonly<{
  manifest: PrivateLiquidityDailyPriceManifest;
  finalityLagBlocks: string;
  attestationBlock: Readonly<{ number: string; hash: string }>;
  readonly [ATTESTED_DAILY_PRICE_DEPLOYMENT]: true;
}>;

declare const VERIFIED_DAILY_PRICE_PAGE: unique symbol;
export type VerifiedPrivateLiquidityDailyPricePage = Readonly<{
  pairKey: string;
  totalCount: string;
  start: string;
  nextStart: string;
  atBlock: Readonly<{ number: string; hash: string }>;
  snapshots: readonly PrivateLiquidityDailyPriceSnapshot[];
  readonly [VERIFIED_DAILY_PRICE_PAGE]: true;
}>;

const CAPABILITIES = new WeakMap<object, Binding>();
const DEPLOYMENTS = new WeakMap<object, Readonly<{
  capability: PrivateLiquidityDailyPriceReadCapability;
  lag: bigint;
  deploymentBlockHash: string;
}>>();

const quantity = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical RPC quantity.`);
  }
  return BigInt(value);
};

const decimal = (value: bigint | number | string, label: string, maximum = (1n << 256n) - 1n): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be canonical decimal.`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be nonzero bytes32.`);
  }
  return value.toLowerCase();
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be an address.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} must be an address.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hex = (value: unknown, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (!allowEmpty && value === '0x')) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  return value.toLowerCase();
};

const quantityHex = (value: bigint): string => `0x${value.toString(16)}`;
const pinnedBlock = (hash: string) => Object.freeze({ blockHash: hash, requireCanonical: true });

const bindingFor = (capability: PrivateLiquidityDailyPriceReadCapability): Binding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('Daily marginal-price reads require a current bound capability.');
  return binding;
};

const deploymentFor = (deployment: AttestedPrivateLiquidityDailyPriceDeployment) => {
  const binding = deployment && DEPLOYMENTS.get(deployment);
  if (!binding) throw new Error('Daily marginal-price reads require an attested deployment.');
  return binding;
};

const rpc = async (binding: Binding, method: string, params: readonly unknown[] = []): Promise<unknown> => {
  await binding.assertCurrent();
  let result: unknown;
  try {
    result = await binding.request({ method, params: [...params] });
  } catch {
    throw new Error(`Daily marginal-price RPC ${method} failed.`);
  }
  await binding.assertCurrent();
  return result;
};

const assertChain = async (binding: Binding): Promise<void> => {
  if (quantity(await rpc(binding, 'eth_chainId'), 'Daily marginal-price chain') !== binding.chainId) {
    throw new Error('Daily marginal-price read capability chain changed.');
  }
};

const block = async (binding: Binding, number: bigint) => {
  const raw = await rpc(binding, 'eth_getBlockByNumber', [quantityHex(number), false]);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Daily marginal-price block is unavailable.');
  const record = raw as Record<string, unknown>;
  const actualNumber = quantity(record.number, 'Daily marginal-price block number');
  if (actualNumber !== number) throw new Error('Daily marginal-price block number changed.');
  return Object.freeze({
    number: actualNumber,
    hash: bytes32(record.hash, 'Daily marginal-price block hash')
  });
};

const assertDeploymentReceipt = async ({
  binding,
  transactionHash,
  contractAddress,
  deploymentBlock,
  deploymentBlockHash
}: {
  binding: Binding;
  transactionHash: string;
  contractAddress: string;
  deploymentBlock: bigint;
  deploymentBlockHash: string;
}): Promise<void> => {
  const raw = await rpc(binding, 'eth_getTransactionReceipt', [transactionHash]);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Daily marginal-price deployment receipt is unavailable.');
  }
  const receipt = raw as Record<string, unknown>;
  if (
    bytes32(receipt.transactionHash, 'Daily marginal-price receipt transaction') !== transactionHash ||
    quantity(receipt.blockNumber, 'Daily marginal-price receipt block') !== deploymentBlock ||
    bytes32(receipt.blockHash, 'Daily marginal-price receipt block hash') !== deploymentBlockHash ||
    quantity(receipt.status, 'Daily marginal-price receipt status') !== 1n ||
    address(receipt.contractAddress, 'Daily marginal-price receipt contract') !== contractAddress
  ) {
    throw new Error('Daily marginal-price deployment receipt does not match its manifest.');
  }
};

const call = async (binding: Binding, to: string, data: string, blockHash: string): Promise<string> =>
  hex(await rpc(binding, 'eth_call', [{ to, data }, pinnedBlock(blockHash)]), 'Daily marginal-price call result');

const decodeSingle = (functionName: string, result: string): unknown => {
  try {
    return STORE.decodeFunctionResult(functionName, result)[0];
  } catch {
    throw new Error(`Daily marginal-price ${functionName} result is malformed.`);
  }
};

export const bindPrivateLiquidityDailyPriceReadCapability = async ({
  provider,
  expectedChainId,
  assertCurrent
}: {
  provider: Provider;
  expectedChainId: bigint;
  assertCurrent: () => void | Promise<void>;
}): Promise<PrivateLiquidityDailyPriceReadCapability> => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' || expectedChainId <= 0n) {
    throw new Error('Daily marginal-price read capability configuration is invalid.');
  }
  const binding = Object.freeze({ request: provider.request.bind(provider), chainId: expectedChainId, assertCurrent });
  await assertChain(binding);
  const capability = Object.freeze({}) as PrivateLiquidityDailyPriceReadCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

export const attestPrivateLiquidityDailyPriceDeployment = async ({
  capability,
  manifest,
  finalityLagBlocks
}: {
  capability: PrivateLiquidityDailyPriceReadCapability;
  manifest: PrivateLiquidityDailyPriceManifest;
  finalityLagBlocks: bigint;
}): Promise<AttestedPrivateLiquidityDailyPriceDeployment> => {
  const binding = bindingFor(capability);
  if (decimal(manifest.chainId, 'Daily marginal-price manifest chain') !== binding.chainId) {
    throw new Error('Daily marginal-price manifest chain does not match its capability.');
  }
  const deploymentBlock = decimal(manifest.deploymentBlock, 'Daily marginal-price deployment block', UINT64_MAX);
  if (deploymentBlock === 0n || finalityLagBlocks <= 0n || finalityLagBlocks > 4_096n) {
    throw new Error('Daily marginal-price finality configuration is invalid.');
  }
  const storeAddress = address(manifest.address, 'Daily marginal-price store');
  const sourceBook = address(manifest.sourceBook, 'Daily marginal-price source Book');
  const expectedOwner = address(manifest.owner, 'Manifest daily marginal-price owner');
  const expectedRecorder = address(manifest.recorder, 'Manifest daily marginal-price recorder');
  const latest = quantity(await rpc(binding, 'eth_blockNumber'), 'Daily marginal-price latest block');
  if (latest <= finalityLagBlocks) throw new Error('Daily marginal-price safe head is unavailable.');
  const safeHead = await block(binding, latest - finalityLagBlocks);
  if (safeHead.number < deploymentBlock) throw new Error('Daily marginal-price store is not finalized.');
  const deploymentAnchor = await block(binding, deploymentBlock);
  const deploymentBlockHash = bytes32(manifest.deploymentBlockHash, 'Daily marginal-price deployment block hash');
  const transactionHash = bytes32(manifest.transactionHash, 'Daily marginal-price deployment transaction');
  if (deploymentAnchor.hash !== deploymentBlockHash) {
    throw new Error('Daily marginal-price deployment block does not match its manifest.');
  }
  const code = hex(await rpc(binding, 'eth_getCode', [storeAddress, pinnedBlock(safeHead.hash)]), 'Daily marginal-price runtime');
  if (keccak256(code).toLowerCase() !== bytes32(manifest.runtimeBytecodeHash, 'Daily marginal-price runtime hash')) {
    throw new Error('Daily marginal-price store runtime hash does not match its manifest.');
  }
  await assertDeploymentReceipt({
    binding,
    transactionHash,
    contractAddress: storeAddress,
    deploymentBlock,
    deploymentBlockHash
  });
  const version = decodeSingle('contractVersion', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('contractVersion'),
    safeHead.hash
  ));
  if (version !== PRIVATE_LIQUIDITY_DAILY_PRICE_VERSION) throw new Error('Daily marginal-price store version is invalid.');
  const actualBook = address(decodeSingle('sourceBook', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('sourceBook'),
    safeHead.hash
  )), 'Daily marginal-price bound Book');
  const actualBookHash = bytes32(decodeSingle('sourceBookRuntimeHash', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('sourceBookRuntimeHash'),
    safeHead.hash
  )), 'Daily marginal-price bound Book runtime');
  const actualOwner = address(decodeSingle('owner', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('owner'),
    safeHead.hash
  )), 'Daily marginal-price owner');
  const actualRecorder = address(decodeSingle('recorder', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('recorder'),
    safeHead.hash
  )), 'Daily marginal-price recorder');
  if (actualBook !== sourceBook || actualBookHash !== bytes32(manifest.sourceBookRuntimeHash, 'Manifest source Book runtime')) {
    throw new Error('Daily marginal-price store is bound to the wrong Private Liquidity Book.');
  }
  if (
    actualOwner !== expectedOwner ||
    actualRecorder !== expectedRecorder
  ) {
    throw new Error('Daily marginal-price Store authority does not match its manifest.');
  }
  const bookCode = hex(await rpc(binding, 'eth_getCode', [sourceBook, pinnedBlock(safeHead.hash)]), 'Daily marginal-price source Book runtime');
  if (keccak256(bookCode).toLowerCase() !== actualBookHash) {
    throw new Error('Daily marginal-price source Book runtime changed.');
  }
  for (const feature of PRIVATE_LIQUIDITY_DAILY_PRICE_FEATURES) {
    const supported = decodeSingle('supportsFeature', await call(
      binding,
      storeAddress,
      STORE.encodeFunctionData('supportsFeature', [keccak256(toUtf8Bytes(feature))]),
      safeHead.hash
    ));
    if (supported !== true) throw new Error(`Daily marginal-price store is missing ${feature}.`);
  }
  await assertChain(binding);
  const deployment = Object.freeze({
    manifest: Object.freeze({
      ...manifest,
      address: storeAddress,
      deploymentBlockHash,
      transactionHash,
      sourceBook,
      owner: expectedOwner,
      recorder: expectedRecorder
    }),
    finalityLagBlocks: finalityLagBlocks.toString(),
    attestationBlock: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash })
  }) as AttestedPrivateLiquidityDailyPriceDeployment;
  DEPLOYMENTS.set(deployment, Object.freeze({
    capability,
    lag: finalityLagBlocks,
    deploymentBlockHash: deploymentAnchor.hash
  }));
  return deployment;
};

const readPrivateLiquidityDailyPricePageAt = async ({
  deployment,
  pairKey,
  resolveStart,
  count
}: {
  deployment: AttestedPrivateLiquidityDailyPriceDeployment;
  pairKey: string;
  resolveStart: (total: bigint) => bigint;
  count: bigint;
}): Promise<VerifiedPrivateLiquidityDailyPricePage> => {
  const deploymentBinding = deploymentFor(deployment);
  const binding = bindingFor(deploymentBinding.capability);
  const key = bytes32(pairKey, 'Daily marginal-price pair key');
  if (count <= 0n || count > PRIVATE_LIQUIDITY_DAILY_PRICE_MAX_PAGE) {
    throw new Error('Daily marginal-price page bounds are invalid.');
  }
  const latest = quantity(await rpc(binding, 'eth_blockNumber'), 'Daily marginal-price latest block');
  if (latest <= deploymentBinding.lag) throw new Error('Daily marginal-price safe head is unavailable.');
  const safeHead = await block(binding, latest - deploymentBinding.lag);
  const storeAddress = deployment.manifest.address;
  const deploymentAnchor = await block(binding, BigInt(deployment.manifest.deploymentBlock));
  if (deploymentAnchor.hash !== deploymentBinding.deploymentBlockHash) {
    throw new Error('Daily marginal-price deployment provenance was reorged.');
  }
  const code = hex(await rpc(binding, 'eth_getCode', [storeAddress, pinnedBlock(safeHead.hash)]), 'Daily marginal-price runtime');
  if (keccak256(code).toLowerCase() !== deployment.manifest.runtimeBytecodeHash) {
    throw new Error('Daily marginal-price runtime changed after attestation.');
  }
  const [actualOwner, actualRecorder] = await Promise.all([
    call(binding, storeAddress, STORE.encodeFunctionData('owner'), safeHead.hash)
      .then((value) => address(decodeSingle('owner', value), 'Daily marginal-price owner')),
    call(binding, storeAddress, STORE.encodeFunctionData('recorder'), safeHead.hash)
      .then((value) => address(decodeSingle('recorder', value), 'Daily marginal-price recorder'))
  ]);
  if (actualOwner !== deployment.manifest.owner || actualRecorder !== deployment.manifest.recorder) {
    throw new Error('Daily marginal-price Store authority changed after attestation.');
  }
  const total = decimal(decodeSingle('dayCount', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('dayCount', [key]),
    safeHead.hash
  )) as bigint, 'Daily marginal-price total count');
  const start = resolveStart(total);
  if (start < 0n) throw new Error('Daily marginal-price page bounds are invalid.');
  if (start > total) throw new Error('Daily marginal-price page starts beyond the available history.');
  const raw = decodeSingle('getSnapshots', await call(
    binding,
    storeAddress,
    STORE.encodeFunctionData('getSnapshots', [key, start, count]),
    safeHead.hash
  ));
  if (!Array.isArray(raw)) throw new Error('Daily marginal-price snapshot page is malformed.');
  const snapshots = raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Daily marginal-price snapshot ${index} is malformed.`);
    const tuple = entry as Record<number, unknown>;
    return normalizePrivateLiquidityDailyPriceSnapshot({
      day: decimal(tuple[0] as bigint, 'Daily marginal-price day', UINT64_MAX).toString(),
      capturedAt: decimal(tuple[1] as bigint, 'Daily marginal-price timestamp', UINT64_MAX).toString(),
      sourceBlockNumber: decimal(tuple[2] as bigint, 'Daily marginal-price source block', UINT64_MAX).toString(),
      sourceLogIndex: Number(decimal(tuple[3] as bigint, 'Daily marginal-price source log', (1n << 32n) - 1n)),
      direction: Number(decimal(tuple[4] as bigint, 'Daily marginal-price direction', 1n)) as 0 | 1,
      revision: decimal(tuple[5] as bigint, 'Daily marginal-price revision', UINT64_MAX).toString(),
      priceBaseAmount: decimal(tuple[6] as bigint, 'Daily marginal-price base amount', (1n << 128n) - 1n).toString(),
      priceQuoteAmount: decimal(tuple[7] as bigint, 'Daily marginal-price quote amount', (1n << 128n) - 1n).toString(),
      swapId: decimal(tuple[8] as bigint, 'Daily marginal-price swap ID').toString(),
      positionId: decimal(tuple[9] as bigint, 'Daily marginal-price position ID').toString(),
      sourceBlockHash: bytes32(tuple[10], 'Daily marginal-price source block hash'),
      sourceTransactionHash: bytes32(tuple[11], 'Daily marginal-price source transaction hash')
    });
  });
  if (start + BigInt(snapshots.length) > total) throw new Error('Daily marginal-price page exceeds the anchored total.');
  await assertChain(binding);
  return Object.freeze({
    pairKey: key,
    totalCount: total.toString(),
    start: start.toString(),
    nextStart: (start + BigInt(snapshots.length)).toString(),
    atBlock: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash }),
    snapshots: Object.freeze(snapshots)
  }) as VerifiedPrivateLiquidityDailyPricePage;
};

export const readPrivateLiquidityDailyPricePage = async ({
  deployment,
  pairKey,
  start,
  count
}: {
  deployment: AttestedPrivateLiquidityDailyPriceDeployment;
  pairKey: string;
  start: bigint;
  count: bigint;
}): Promise<VerifiedPrivateLiquidityDailyPricePage> => readPrivateLiquidityDailyPricePageAt({
  deployment,
  pairKey,
  resolveStart: () => start,
  count
});

/** Reads a trailing window from one block-hash-pinned total, so a new day cannot race pagination. */
/**
 * Reads recorder-attested snapshots from an exact safe-head-pinned store deployment. This proves
 * the store and source-Book identities, not an independent browser replay of every source trade.
 * The retained public source references allow a separate recorder/audit process to do that replay.
 */
export const readLatestPrivateLiquidityDailyPrices = async ({
  deployment,
  pairKey,
  count
}: {
  deployment: AttestedPrivateLiquidityDailyPriceDeployment;
  pairKey: string;
  count: bigint;
}): Promise<VerifiedPrivateLiquidityDailyPricePage> => readPrivateLiquidityDailyPricePageAt({
  deployment,
  pairKey,
  resolveStart: (total) => total > count ? total - count : 0n,
  count
});
