import {
  Interface,
  getAddress,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import type {
  DexV2AppManifest,
  DexV2ComponentKey
} from './dexV2Deployment';
import { assertDexV2AppManifest, CURRENT_SHARED_POOL_CANDIDATE, resolveCurrentCheapDexCandidate,
  currentCheapDexCandidateKey, currentCheapDexStages, currentCheapDexQuoteProtocol, STAGED_TWO_POOL_CANDIDATE, STAGED_POOL_REFERENCE_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE,
  type CurrentCheapDexIdentity, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { decodeCurrentDexOperation, encodeCurrentDexOperationRead, decodeCurrentDexReceipt, encodeCurrentDexReceiptRead, decodeCurrentDexQuoteIssue,
  decodeCurrentCheapDexOperation, encodeCurrentCheapDexOperationRead, type CurrentCheapDexProfile } from './currentDexOperation';
import { resolvePreparedDexScope } from './currentDexPreparedScope';

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

const CORE = new Interface([
  'function contractVersion() view returns (string)',
  'function owner() view returns (address)',
  'function poolModule() view returns (address)',
  'function limitModule() view returns (address)',
  'function recurringModule() view returns (address)',
  'function swapModule() view returns (address)',
  'function positionToken() view returns (address)',
  'function poolModuleRuntimeHash() view returns (bytes32)',
  'function limitModuleRuntimeHash() view returns (bytes32)',
  'function recurringModuleRuntimeHash() view returns (bytes32)',
  'function swapModuleRuntimeHash() view returns (bytes32)',
  'function privateTokenRuntimeManifestHash() view returns (bytes32)',
  'function privateTokenRuntimeManifestLength() view returns (uint256)',
  'function approvedPrivateTokenCodeHash(address token) view returns (bytes32)',
  'function canonicalTickTableHash() view returns (bytes32)',
  'function newActivityPaused() view returns (bool)',
  'function getPair(bytes32 key) view returns ((address baseToken,address quoteToken,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,bytes32 tickTableHash,uint128 baseLotSize,uint128 quoteLotSize,uint64 executionRevision,uint64 createdAt,uint64 lastPublicPoolPriorityId,uint64 lastPublicPoolMarginalTick,uint32 maximumAggregateLots,uint8 baseDecimals,uint8 quoteDecimals,bool initialized))'
]);

const FACTORY = new Interface([
  'function authorizedDeployer() view returns (address)',
  'function poolModule() view returns (address)',
  'function limitModule() view returns (address)',
  'function recurringModule() view returns (address)',
  'function swapModule() view returns (address)',
  'function dexCore() view returns (address)',
  'function deploymentCompleted() view returns (bool)'
]);

const MODULE = new Interface([
  'function intendedDex() view returns (address)',
  'function moduleSelf() view returns (address)',
  'function moduleVersion() view returns (string)'
]);

const POSITION_TOKEN = new Interface([
  'function dex() view returns (address)',
  'function contractVersion() view returns (string)'
]);

const SHARED_CORE = new Interface([
  'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)',
  'function feePpm() view returns (uint32)',
  'function maxWorkLifetime() view returns (uint32)',
  'function tokenAdmissionCommitment() view returns (bytes32)',
  'function inputToken() view returns (address)',
  'function outputToken() view returns (address)',
  'function inputRuntimeHash() view returns (bytes32)',
  'function outputRuntimeHash() view returns (bytes32)',
  'function fixedEngine() view returns (address)',
  'function fixedEngineRuntimeHash() view returns (bytes32)',
  'function terminalEvaluator() view returns (address)',
  'function terminalEvaluatorRuntimeHash() view returns (bytes32)',
  'function terminalEvaluatorBindingCommitment() view returns (bytes32)',
  'function positionNFT() view returns (address)',
  'function positionNFTRuntimeHash() view returns (bytes32)',
  'function fastPoolQuote() view returns (address)',
  'function poolTerms() view returns (address)'
]);
const SHARED_ENGINE = new Interface([
  'function core() view returns (address)',
  'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)',
  'function positionNFT() view returns (address)',
  'function inputToken() view returns (address)',
  'function outputToken() view returns (address)',
  'function feePpm() view returns (uint32)',
  'function maxWorkLifetime() view returns (uint32)',
  'function selector() view returns (address)',
  'function selectorRuntimeHash() view returns (bytes32)'
]);
const SHARED_FACTORY = new Interface([
  'function snapshotOwner() view returns (address)',
  'function recurringOwner() view returns (address)',
  'function ownerLifecycle() view returns (address)',
  'function orderWork() view returns (address)',
  'function workLifecycle() view returns (address)',
  'function rangeOwner() view returns (address)',
  'function rangeWork() view returns (address)',
  'function matchWork() view returns (address)'
]);
const SHARED_NFT = new Interface(['function core() view returns (address)']);
const SHARED_EVALUATOR = new Interface(['function bindingCommitment() view returns (bytes32)']);
// Exact public ABI of graph 85767f8a; checked against the frozen build in the
// prepared registry tests. This interface grants no write or signing authority.
const PREPARED_MARKET_REGISTRY = new Interface([
  'function marketForTokens(address input,address output) view returns(bytes32 selectedMarket,uint256 canonicalId,uint256 registryRevision,uint256 marketRevision,bool enabled,address engine,address terms)'
]);
const PREPARED_POOL_TERMS = new Interface([
  'function core() view returns(address)', 'function releaseId() view returns(bytes32)',
  'function marketId() view returns(bytes32)', 'function token0() view returns(address)',
  'function token1() view returns(address)', 'function sharedMath() view returns(address)'
]);

const CORE_VERSION = 'ChainWhisperDexCoreV2-discrete-bin';
const POSITION_TOKEN_VERSION = 'ChainWhisperDexPositionNFTV2';
const MODULE_VERSIONS: Readonly<Record<'pool' | 'limit' | 'recurring' | 'swap', string>> = Object.freeze({
  pool: 'ChainWhisperDexPoolModuleV2',
  limit: 'ChainWhisperDexLimitModuleV2',
  recurring: 'ChainWhisperDexRecurringModuleV2',
  swap: 'ChainWhisperDexSwapModuleV2'
});

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type Binding = Readonly<{
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}>;

declare const DEX_V2_READ_CAPABILITY_BRAND: unique symbol;
export type DexV2ReadCapability = Readonly<{
  readonly [DEX_V2_READ_CAPABILITY_BRAND]: true;
}>;

export type DexV2CanonicalBlock = Readonly<{ number: string; hash: string }>;

declare const ATTESTED_DEX_V2_DEPLOYMENT_BRAND: unique symbol;
export type AttestedDexV2Deployment = Readonly<{
  manifest: DexV2AppManifest;
  attestationBlock: DexV2CanonicalBlock;
  executionRevision: string;
  lastPublicPoolPriorityId: string;
  lastPublicPoolMarginalTick: string;
  newActivityPaused: boolean;
  readonly [ATTESTED_DEX_V2_DEPLOYMENT_BRAND]: true;
}>;

const CAPABILITIES = new WeakMap<object, Binding>();
const ATTESTED = new WeakSet<object>();

const quantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const bytes = (value: unknown, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical bytes.`);
  }
  if (!allowEmpty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hash = (value: unknown, label: string): string => {
  const normalized = bytes(value, label);
  if (normalized.length !== 66 || normalized === `0x${'00'.repeat(32)}`) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return normalized;
};

const hexQuantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockSelector = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const bindingFor = (capability: DexV2ReadCapability): Binding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('DEX V2 reads require a current wallet-scoped capability.');
  return binding;
};

const rpc = async (binding: Binding, method: string, params: readonly unknown[] = []): Promise<unknown> => {
  await binding.assertCurrent();
  return binding.request({ method, params: [...params] });
};

const assertChain = async (binding: Binding): Promise<void> => {
  const chainId = quantity(await rpc(binding, 'eth_chainId'), 'DEX V2 chain ID');
  if (chainId !== binding.chainId) throw new Error('DEX V2 provider changed networks.');
};

const readBlock = async (binding: Binding, number: bigint, label: string): Promise<Readonly<{ number: bigint; hash: string }>> => {
  const value = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(number), false]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is unavailable.`);
  const record = value as Record<string, unknown>;
  const returnedNumber = quantity(record.number, `${label} number`, UINT64_MAX);
  if (returnedNumber !== number) throw new Error(`${label} number drifted.`);
  return Object.freeze({ number, hash: hash(record.hash, `${label} hash`) });
};

const ethCall = async (
  binding: Binding,
  contractAddress: string,
  abi: Interface,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<readonly unknown[]> => {
  const data = abi.encodeFunctionData(functionName, [...args]);
  const raw = bytes(await rpc(binding, 'eth_call', [
    { to: contractAddress, data },
    blockSelector(blockHash)
  ]), `${functionName} result`);
  return abi.decodeFunctionResult(functionName, raw) as unknown as readonly unknown[];
};

const scalar = async (
  binding: Binding,
  contractAddress: string,
  abi: Interface,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => (await ethCall(binding, contractAddress, abi, functionName, args, blockHash))[0];

const requireRuntime = async (
  binding: Binding,
  contractAddress: string,
  expectedHash: string,
  blockHash: string,
  label: string
): Promise<void> => {
  const code = bytes(await rpc(binding, 'eth_getCode', [contractAddress, blockSelector(blockHash)]), `${label} runtime`);
  if (keccak256(code).toLowerCase() !== expectedHash) throw new Error(`${label} runtime hash differs from the manifest.`);
};

export const createDexV2ReadCapability = ({
  provider,
  chainId,
  assertCurrent
}: {
  provider: ReadProvider;
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
}): DexV2ReadCapability => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' || chainId <= 0n) {
    throw new Error('DEX V2 read capability input is invalid.');
  }
  const capability = Object.freeze({}) as DexV2ReadCapability;
  CAPABILITIES.set(capability, Object.freeze({ request: provider.request.bind(provider), chainId, assertCurrent }));
  return capability;
};

const assertAddressGetter = async (
  binding: Binding,
  contractAddress: string,
  abi: Interface,
  getter: string,
  expected: string,
  blockHash: string
): Promise<void> => {
  if (address(await scalar(binding, contractAddress, abi, getter, [], blockHash), getter) !== expected) {
    throw new Error(`DEX V2 ${getter} binding differs from the manifest.`);
  }
};

const assertHashGetter = async (
  binding: Binding,
  contractAddress: string,
  getter: string,
  expected: string,
  blockHash: string
): Promise<void> => {
  if (hash(await scalar(binding, contractAddress, CORE, getter, [], blockHash), getter) !== expected) {
    throw new Error(`DEX V2 ${getter} differs from the manifest.`);
  }
};

const attestFactory = async (binding: Binding, manifest: DexV2AppManifest, blockHash: string): Promise<void> => {
  const factory = manifest.addresses.factory;
  if ((await scalar(binding, factory, FACTORY, 'deploymentCompleted', [], blockHash)) !== true) {
    throw new Error('DEX V2 factory deployment is not complete.');
  }
  await assertAddressGetter(binding, factory, FACTORY, 'authorizedDeployer', manifest.operator, blockHash);
  await assertAddressGetter(binding, factory, FACTORY, 'poolModule', manifest.addresses.pool, blockHash);
  await assertAddressGetter(binding, factory, FACTORY, 'limitModule', manifest.addresses.limit, blockHash);
  await assertAddressGetter(binding, factory, FACTORY, 'recurringModule', manifest.addresses.recurring, blockHash);
  await assertAddressGetter(binding, factory, FACTORY, 'swapModule', manifest.addresses.swap, blockHash);
  await assertAddressGetter(binding, factory, FACTORY, 'dexCore', manifest.addresses.core, blockHash);
};

const attestCoreAndModules = async (binding: Binding, manifest: DexV2AppManifest, blockHash: string): Promise<boolean> => {
  const core = manifest.addresses.core;
  if ((await scalar(binding, core, CORE, 'contractVersion', [], blockHash)) !== CORE_VERSION) {
    throw new Error('DEX V2 Core version differs from the reviewed runtime.');
  }
  await assertAddressGetter(binding, core, CORE, 'owner', manifest.owner, blockHash);
  await assertAddressGetter(binding, core, CORE, 'poolModule', manifest.addresses.pool, blockHash);
  await assertAddressGetter(binding, core, CORE, 'limitModule', manifest.addresses.limit, blockHash);
  await assertAddressGetter(binding, core, CORE, 'recurringModule', manifest.addresses.recurring, blockHash);
  await assertAddressGetter(binding, core, CORE, 'swapModule', manifest.addresses.swap, blockHash);
  await assertAddressGetter(binding, core, CORE, 'positionToken', manifest.addresses.positionToken, blockHash);
  await assertHashGetter(binding, core, 'poolModuleRuntimeHash', manifest.runtimeHashes.pool, blockHash);
  await assertHashGetter(binding, core, 'limitModuleRuntimeHash', manifest.runtimeHashes.limit, blockHash);
  await assertHashGetter(binding, core, 'recurringModuleRuntimeHash', manifest.runtimeHashes.recurring, blockHash);
  await assertHashGetter(binding, core, 'swapModuleRuntimeHash', manifest.runtimeHashes.swap, blockHash);
  await assertHashGetter(
    binding,
    core,
    'privateTokenRuntimeManifestHash',
    manifest.pair.privateTokenRuntimeManifestHash,
    blockHash
  );
  const manifestLength = BigInt(await scalar(binding, core, CORE, 'privateTokenRuntimeManifestLength', [], blockHash) as bigint);
  if (manifestLength !== BigInt(manifest.pair.privateTokenRuntimeManifestLength)) {
    throw new Error('DEX V2 private-token runtime manifest length is unexpected.');
  }
  await assertHashGetter(binding, core, 'canonicalTickTableHash', manifest.pair.tickTableHash, blockHash);
  for (const token of ['baseToken', 'quoteToken'] as const) {
    const approved = hash(
      await scalar(binding, core, CORE, 'approvedPrivateTokenCodeHash', [manifest.pair[token]], blockHash),
      `approved ${token} code hash`
    );
    if (approved !== manifest.pair[`${token}RuntimeHash`]) {
      throw new Error(`DEX V2 ${token} approval differs from the manifest.`);
    }
  }
  for (const key of Object.keys(MODULE_VERSIONS) as Array<keyof typeof MODULE_VERSIONS>) {
    const moduleAddress = manifest.addresses[key];
    await assertAddressGetter(binding, moduleAddress, MODULE, 'intendedDex', core, blockHash);
    await assertAddressGetter(binding, moduleAddress, MODULE, 'moduleSelf', moduleAddress, blockHash);
    if ((await scalar(binding, moduleAddress, MODULE, 'moduleVersion', [], blockHash)) !== MODULE_VERSIONS[key]) {
      throw new Error(`DEX V2 ${key} module version differs from the reviewed runtime.`);
    }
  }
  await assertAddressGetter(binding, manifest.addresses.positionToken, POSITION_TOKEN, 'dex', core, blockHash);
  if ((await scalar(
    binding,
    manifest.addresses.positionToken,
    POSITION_TOKEN,
    'contractVersion',
    [],
    blockHash
  )) !== POSITION_TOKEN_VERSION) {
    throw new Error('DEX V2 Position NFT version differs from the reviewed runtime.');
  }
  return Boolean(await scalar(binding, core, CORE, 'newActivityPaused', [], blockHash));
};

const attestPair = async (binding: Binding, manifest: DexV2AppManifest, blockHash: string) => {
  const result = await scalar(binding, manifest.addresses.core, CORE, 'getPair', [manifest.pair.pairKey], blockHash);
  const pair = result as readonly unknown[] & Record<string, unknown>;
  const at = (name: string, index: number): unknown => pair?.[name] ?? pair?.[index];
  const checks: readonly [unknown, unknown, string][] = [
    [address(at('baseToken', 0), 'pair base token'), manifest.pair.baseToken, 'base token'],
    [address(at('quoteToken', 1), 'pair quote token'), manifest.pair.quoteToken, 'quote token'],
    [hash(at('baseTokenCodeHash', 2), 'pair base runtime'), manifest.pair.baseTokenRuntimeHash, 'base runtime'],
    [hash(at('quoteTokenCodeHash', 3), 'pair quote runtime'), manifest.pair.quoteTokenRuntimeHash, 'quote runtime'],
    [hash(at('tickTableHash', 4), 'pair tick table'), manifest.pair.tickTableHash, 'tick table'],
    [BigInt(at('baseLotSize', 5) as bigint).toString(), manifest.pair.baseLotSize, 'base lot size'],
    [BigInt(at('quoteLotSize', 6) as bigint).toString(), manifest.pair.quoteLotSize, 'quote lot size'],
    [BigInt(at('maximumAggregateLots', 11) as bigint).toString(), manifest.pair.maximumAggregateLots, 'maximum lots'],
    [Number(at('baseDecimals', 12)), manifest.pair.baseDecimals, 'base decimals'],
    [Number(at('quoteDecimals', 13)), manifest.pair.quoteDecimals, 'quote decimals'],
    [Boolean(at('initialized', 14)), true, 'initialization']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`DEX V2 pair ${label} differs from the manifest.`);
  }
  const lastPublicPoolPriorityId = BigInt(at('lastPublicPoolPriorityId', 9) as bigint);
  const lastPublicPoolMarginalTick = BigInt(at('lastPublicPoolMarginalTick', 10) as bigint);
  if (
    lastPublicPoolPriorityId > 4n ||
    (lastPublicPoolPriorityId === 0n && lastPublicPoolMarginalTick !== 0n) ||
    (lastPublicPoolPriorityId !== 0n && lastPublicPoolMarginalTick !== 7_000n + lastPublicPoolPriorityId * 1_000n)
  ) throw new Error('DEX V2 public Pool state is outside the canonical four-bin table.');
  return Object.freeze({
    executionRevision: BigInt(at('executionRevision', 7) as bigint).toString(),
    lastPublicPoolPriorityId: lastPublicPoolPriorityId.toString(),
    lastPublicPoolMarginalTick: lastPublicPoolMarginalTick.toString()
  });
};

export const attestDexV2Deployment = async ({
  capability,
  manifest,
  finalityLagBlocks
}: {
  capability: DexV2ReadCapability;
  manifest: DexV2AppManifest;
  finalityLagBlocks: bigint;
}): Promise<AttestedDexV2Deployment> => {
  const binding = bindingFor(capability);
  assertDexV2AppManifest(manifest);
  if (BigInt(manifest.chainId) !== binding.chainId || finalityLagBlocks <= 0n || finalityLagBlocks > 4_096n) {
    throw new Error('DEX V2 attestation configuration is invalid.');
  }
  await assertChain(binding);
  const latest = quantity(await rpc(binding, 'eth_blockNumber'), 'DEX V2 latest block', UINT64_MAX);
  if (latest < finalityLagBlocks) throw new Error('DEX V2 chain has no finalized head yet.');
  const safe = await readBlock(binding, latest - finalityLagBlocks, 'DEX V2 safe head');
  if (safe.number < BigInt(manifest.activation.finalBlock.number)) {
    throw new Error('DEX V2 activation is not finalized at the configured depth.');
  }
  const anchors = [
    manifest.deploymentAnchors.factory,
    manifest.deploymentAnchors.economicSuite,
    manifest.deploymentAnchors.pairRegistration,
    manifest.activation.finalBlock
  ];
  for (const anchor of anchors) {
    if ((await readBlock(binding, BigInt(anchor.number), 'DEX V2 manifest anchor')).hash !== anchor.hash) {
      throw new Error('DEX V2 manifest anchor was reorganized.');
    }
  }
  for (const key of Object.keys(manifest.addresses) as DexV2ComponentKey[]) {
    await requireRuntime(binding, manifest.addresses[key], manifest.runtimeHashes[key], safe.hash, `DEX V2 ${key}`);
  }
  await requireRuntime(binding, manifest.pair.baseToken, manifest.pair.baseTokenRuntimeHash, safe.hash, 'DEX V2 base token');
  await requireRuntime(binding, manifest.pair.quoteToken, manifest.pair.quoteTokenRuntimeHash, safe.hash, 'DEX V2 quote token');
  await attestFactory(binding, manifest, safe.hash);
  const newActivityPaused = await attestCoreAndModules(binding, manifest, safe.hash);
  const pair = await attestPair(binding, manifest, safe.hash);

  await assertChain(binding);
  const latestAfter = quantity(await rpc(binding, 'eth_blockNumber'), 'DEX V2 post-attestation block', UINT64_MAX);
  if (latestAfter < safe.number + finalityLagBlocks ||
      (await readBlock(binding, safe.number, 'Rechecked DEX V2 safe head')).hash !== safe.hash) {
    throw new Error('DEX V2 attestation lost canonical finality.');
  }
  const current = await readBlock(binding, latestAfter, 'DEX V2 current head');
  for (const key of Object.keys(manifest.addresses) as DexV2ComponentKey[]) {
    await requireRuntime(binding, manifest.addresses[key], manifest.runtimeHashes[key], current.hash, `Current DEX V2 ${key}`);
  }
  await requireRuntime(
    binding,
    manifest.pair.baseToken,
    manifest.pair.baseTokenRuntimeHash,
    current.hash,
    'Current DEX V2 base token'
  );
  await requireRuntime(
    binding,
    manifest.pair.quoteToken,
    manifest.pair.quoteTokenRuntimeHash,
    current.hash,
    'Current DEX V2 quote token'
  );
  for (const anchor of anchors) {
    if ((await readBlock(binding, BigInt(anchor.number), 'Rechecked DEX V2 manifest anchor')).hash !== anchor.hash) {
      throw new Error('DEX V2 manifest anchor changed during attestation.');
    }
  }
  await assertChain(binding);
  const deployment = Object.freeze({
    manifest,
    attestationBlock: Object.freeze({ number: safe.number.toString(), hash: safe.hash }),
    ...pair,
    newActivityPaused
  }) as AttestedDexV2Deployment;
  ATTESTED.add(deployment);
  return deployment;
};

export const assertAttestedDexV2Deployment = (
  deployment: AttestedDexV2Deployment
): AttestedDexV2Deployment => {
  if (!deployment || !ATTESTED.has(deployment)) {
    throw new Error('DEX V2 requires a deployment returned by its exact attester.');
  }
  return deployment;
};

/** Public consistency only. The hash must come from reviewed configuration, not alongside untrusted JSON.
 * Reuses native expectedBindings/expectedFactory output; does not confer write or token admission authority. */
export const readCurrentDexGraph = async ({ capability, manifestJson, expectedManifestHash, blockNumber, blockHash }: {
  capability: DexV2ReadCapability; manifestJson: string; expectedManifestHash: string;
  blockNumber: bigint; blockHash: string;
}) => {
  const binding = bindingFor(capability), manifestHash = hash(expectedManifestHash, 'Current DEX manifest');
  if (keccak256(toUtf8Bytes(manifestJson)) !== manifestHash) throw new Error('Current DEX manifest hash differs.');
  type Field = { path: string; slot: string; mask: string; expected: string };
  const m = JSON.parse(manifestJson) as {
    chainId: string; genesisHash: string;
    bindings: { graph: string; quoteVersion: number; runtimes: Record<string, { address: string; code: string; hash: string; fields: Field[] }> };
    factory: { graph: string; address: string; runtime: string; storage: Record<string, string>; chunks: Array<{ address: string; code: string }> };
    tokens: Array<{ address: string; runtimeHash: string }>;
  };
  const decimal = (s: string) => {
    if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s) || BigInt(s) > UINT256_MAX) throw new Error('Invalid graph integer.');
    return BigInt(s);
  };
  const word = (s: string) => {
    const value = bytes(s, 'Current DEX storage word');
    if (value.length !== 66) throw new Error('Invalid graph storage word.');
    return value;
  };
  const roles = ['ratio', 'selector', 'terms', 'quote', 'allocation', 'fixedOwner', 'poolOwner', 'work', 'engine', 'factory', 'nft', 'terminal', 'core',
    'operationRelease', 'fixedAdmission', 'swapAdmission', 'recurringOwner'];
  const factorySlots = ['0', '1', '2', '3'];
  if (decimal(m.chainId) !== binding.chainId || typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX ||
      !/^[a-f0-9]{64}$/.test(m.bindings.graph) || m.bindings.quoteVersion !== 2 || m.factory.graph !== m.bindings.graph ||
      Object.keys(m.bindings.runtimes).sort().join() !== roles.sort().join() || m.factory.chunks.length !== 2 || m.tokens.length !== 2 ||
      Object.keys(m.factory.storage).sort().join() !== factorySlots.join()) throw new Error('Invalid current DEX graph shape.');
  const genesis = hash(m.genesisHash, 'Current DEX genesis'), canonicalHash = hash(blockHash, 'Current DEX block');
  const records = Object.entries(m.bindings.runtimes).map(([role, r]) => {
    if (r.fields.length !== (role === 'core' ? 35 : role === 'selector' ? 1 : 0) ||
        new Set(r.fields.map(f => f.path)).size !== r.fields.length) throw new Error('Incomplete current DEX fields.');
    const codeHash = keccak256(bytes(r.code, 'Current DEX runtime'));
    if (codeHash !== hash(r.hash, 'Current DEX expected runtime')) throw new Error('Inconsistent current DEX runtime.');
    const masks = new Map<string, bigint>();
    const fields = r.fields.map(f => {
      const slot = hexQuantity(decimal(f.slot)), mask = BigInt(word(f.mask)), expected = BigInt(word(f.expected));
      if (!mask || (mask & (masks.get(slot) ?? 0n)) || (expected & ~mask)) throw new Error('Invalid graph field mask.');
      masks.set(slot, (masks.get(slot) ?? 0n) | mask);
      return { slot, mask, expected };
    });
    return { role, address: address(r.address, role), runtimeHash: codeHash, fields };
  });
  const factory = records.find(r => r.role === 'factory')!;
  if (factory.address !== address(m.factory.address, 'Factory') || factory.runtimeHash !== keccak256(bytes(m.factory.runtime, 'Factory runtime'))) {
    throw new Error('Current DEX Factory differs.');
  }
  for (const [slot, value] of Object.entries(m.factory.storage)) factory.fields.push({ slot: hexQuantity(decimal(slot)), mask: UINT256_MAX, expected: BigInt(word(value)) });
  const token = (value: unknown, label: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'address,runtimeHash') {
      throw new Error(`Invalid current DEX ${label}.`);
    }
    const entry = value as { address: unknown; runtimeHash: unknown };
    return Object.freeze({ address: address(entry.address, `${label} address`), runtimeHash: hash(entry.runtimeHash, `${label} runtime`) });
  };
  const chunk = (value: unknown, label: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'address,code') {
      throw new Error(`Invalid current DEX ${label}.`);
    }
    const entry = value as { address: unknown; code: unknown };
    return Object.freeze({ address: address(entry.address, `${label} address`), runtimeHash: keccak256(bytes(entry.code, `${label} runtime`)) });
  };
  const tokens = m.tokens.map((t, i) => token(t, `token${i}`));
  const extra = [...m.factory.chunks.map((c, i) => ({ role: `chunk${i}`, ...chunk(c, `chunk${i}`), fields: [] })),
    ...tokens.map((t, i) => ({ role: `token${i}`, ...t, fields: [] }))];
  const all = [...records, ...extra];
  if (new Set(all.map(r => r.address)).size !== 21) throw new Error('Current DEX addresses must be distinct.');
  const core = records.find(r => r.role === 'core')!;
  const releaseField = m.bindings.runtimes.core.fields.find(f => f.path === 'releaseId' && BigInt(f.mask) === UINT256_MAX);
  const releaseId = hash(releaseField?.expected, 'Current DEX release field');
  const lifetimeFields = m.bindings.runtimes.core.fields.filter(f => f.path === 'maxWorkLifetime');
  if (lifetimeFields.length !== 1) throw new Error('Missing current DEX work lifetime.');
  const lifetimeMask = BigInt(lifetimeFields[0].mask), lifetimeUnit = lifetimeMask & -lifetimeMask;
  const maxWorkLifetime = BigInt(lifetimeFields[0].expected) / lifetimeUnit;
  if (lifetimeMask / lifetimeUnit !== 0xffffffffn || maxWorkLifetime === 0n) throw new Error('Invalid current DEX work lifetime.');
  const coreField = (path: string) => {
    const fields = m.bindings.runtimes.core.fields.filter(f => f.path === path);
    if (fields.length !== 1) throw new Error(`Missing current DEX ${path}.`);
    const mask = BigInt(word(fields[0].mask)), unit = mask & -mask;
    return BigInt(word(fields[0].expected)) / unit;
  };
  const inputToken = address(toBeHex(coreField('_marketState.inputToken'), 20), 'Current DEX input token');
  const outputToken = address(toBeHex(coreField('_marketState.outputToken'), 20), 'Current DEX output token');
  const inputRuntimeHash = hash(toBeHex(coreField('_marketState.inputRuntimeHash'), 32), 'Current DEX input token runtime');
  const outputRuntimeHash = hash(toBeHex(coreField('_marketState.outputRuntimeHash'), 32), 'Current DEX output token runtime');
  if (inputToken === outputToken || tokens[0].address !== inputToken || tokens[1].address !== outputToken ||
      tokens[0].runtimeHash !== inputRuntimeHash || tokens[1].runtimeHash !== outputRuntimeHash) {
    throw new Error('Current DEX token pair differs.');
  }
  const checkAnchors = async () => {
    await assertChain(binding);
    const current = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(blockNumber), false]) as Record<string, unknown> | null;
    if ((await readBlock(binding, 0n, 'Current DEX genesis')).hash !== genesis ||
        !current || quantity(current.number, 'Current DEX graph block number', UINT64_MAX) !== blockNumber ||
        hash(current.hash, 'Current DEX graph block') !== canonicalHash) throw new Error('Current DEX graph anchor changed.');
    return quantity(current.timestamp, 'Current DEX graph timestamp');
  };
  await checkAnchors();
  for (const r of all) {
    await requireRuntime(binding, r.address, r.runtimeHash, canonicalHash, `Current DEX ${r.role}`);
    const storage = new Map<string, bigint>();
    for (const f of r.fields) {
      if (!storage.has(f.slot)) storage.set(f.slot, BigInt(word(await rpc(binding, 'eth_getStorageAt', [r.address, f.slot, blockSelector(canonicalHash)]) as string)));
      if ((storage.get(f.slot)! & f.mask) !== f.expected) throw new Error(`Current DEX ${r.role} storage differs.`);
    }
  }
  const timestamp = await checkAnchors();
  await binding.assertCurrent();
  return Object.freeze({ graph: m.bindings.graph, manifestHash, chainId: binding.chainId, genesisHash: genesis,
    core: core.address, inputToken, outputToken, maxWorkLifetime, block: Object.freeze({ number: blockNumber, hash: canonicalHash, timestamp }),
    operationReadIdentity: Object.freeze({ chainId: binding.chainId, core: core.address, runtimeHash: core.runtimeHash,
      releaseId, blockNumber, blockHash: canonicalHash }),
    runtimeCount: all.length, publicFieldCount: 36, factoryFieldCount: 4, readyToSign: false as const });
};

/** Exact deployed shared-Pool trial identity. Public reads only; no submission admission. */
export const readCurrentSharedPoolDexGraph = async ({ capability, blockNumber, blockHash, candidate = 'shared-pool' }: {
  capability: DexV2ReadCapability; blockNumber: bigint; blockHash: string;
  candidate?: 'shared-pool' | CurrentCheapDexCandidateKey;
}) => {
  const binding = bindingFor(capability), m = candidate === 'shared-pool' ? CURRENT_SHARED_POOL_CANDIDATE : resolveCurrentCheapDexCandidate(candidate);
  if (binding.chainId !== BigInt(m.chainId) || typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX) {
    throw new Error('Shared-Pool DEX read identity is invalid.');
  }
  const canonicalHash = hash(blockHash, 'Shared-Pool DEX block');
  const readAnchor = async () => {
    await assertChain(binding);
    if ((await readBlock(binding, 0n, 'Shared-Pool DEX genesis')).hash !== m.genesisHash) {
      throw new Error('Shared-Pool DEX genesis differs.');
    }
    if ('attestationBlock' in m && (blockNumber < BigInt(m.attestationBlock.number) ||
        (await readBlock(binding, BigInt(m.attestationBlock.number), 'Current DEX deployment origin')).hash !== m.attestationBlock.hash)) {
      throw new Error('Current DEX deployment origin changed or is after the read block.');
    }
    const current = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(blockNumber), false]);
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error('Shared-Pool DEX block is unavailable.');
    }
    const record = current as Record<string, unknown>;
    if (quantity(record.number, 'Shared-Pool DEX block number', UINT64_MAX) !== blockNumber ||
        hash(record.hash, 'Shared-Pool DEX block hash') !== canonicalHash) {
      throw new Error('Shared-Pool DEX block changed.');
    }
    return quantity(record.timestamp, 'Shared-Pool DEX block timestamp');
  };
  await readAnchor();
  for (const [role, at, runtimeHash] of m.runtimes) {
    await requireRuntime(binding, at, runtimeHash, canonicalHash, `Shared-Pool DEX ${role}`);
  }
  for (const [at, runtimeHash] of m.tokens) {
    await requireRuntime(binding, at, runtimeHash, canonicalHash, 'Shared-Pool DEX token');
  }
  if ('companions' in m) {
    for (const [role, at, runtimeHash] of m.companions) {
      await requireRuntime(binding, at, runtimeHash, canonicalHash, `Current DEX ${role}`);
    }
  }
  const core = m.core;
  const equal = async (at: string, abi: Interface, getter: string, expected: string | number) => {
    const actual = await scalar(binding, at, abi, getter, [], canonicalHash);
    const value = typeof expected === 'number' ? Number(actual) :
      expected.length === 42 ? address(actual, getter) : hash(actual, getter);
    if (value !== expected) throw new Error(`Shared-Pool DEX ${getter} differs from the reviewed candidate.`);
  };
  for (const [getter, expected] of [
    ['releaseId', m.releaseId], ['marketId', m.marketId], ['feePpm', m.feePpm],
    ['maxWorkLifetime', m.maxWorkLifetime], ['tokenAdmissionCommitment', m.reviewedTokenSet],
    ['inputToken', m.tokens[0][0]], ['outputToken', m.tokens[1][0]],
    ['inputRuntimeHash', m.tokens[0][1]], ['outputRuntimeHash', m.tokens[1][1]]
  ] as const) await equal(core, SHARED_CORE, getter, expected);
  const companion = async (getter: string, runtimeGetter: string, role: string) => {
    const at = address(await scalar(binding, core, SHARED_CORE, getter, [], canonicalHash), getter);
    const runtimeHash = hash(await scalar(binding, core, SHARED_CORE, runtimeGetter, [], canonicalHash), runtimeGetter);
    if ('companions' in m) {
      const pinned = m.companions.find(([name]) => name === role);
      if (!pinned || at !== pinned[1] || runtimeHash !== pinned[2]) throw new Error(`Current DEX ${getter} companion differs from the attestation.`);
    } else await requireRuntime(binding, at, runtimeHash, canonicalHash, `Shared-Pool DEX ${getter}`);
    return at;
  };
  const engine = await companion('fixedEngine', 'fixedEngineRuntimeHash', 'ChainWhisperFixedEngine');
  const evaluator = await companion('terminalEvaluator', 'terminalEvaluatorRuntimeHash', 'ChainWhisperDexWideTerminalGT');
  const nft = await companion('positionNFT', 'positionNFTRuntimeHash', 'ChainWhisperDexPositionNFT');
  await equal(nft, SHARED_NFT, 'core', core);
  const evaluatorBinding = hash(await scalar(binding, core, SHARED_CORE, 'terminalEvaluatorBindingCommitment', [], canonicalHash), 'terminalEvaluatorBindingCommitment');
  if ('evaluatorBinding' in m && evaluatorBinding !== m.evaluatorBinding) throw new Error('Current DEX terminal binding differs from the frozen constructor.');
  await equal(evaluator, SHARED_EVALUATOR, 'bindingCommitment', evaluatorBinding);
  const selector = m.runtimes.find(([role]) => role === 'ChainWhisperFixedBoundedSelector')!;
  for (const [getter, expected] of [
    ['core', core], ['releaseId', m.releaseId], ['marketId', m.marketId],
    ['positionNFT', nft], ['inputToken', m.tokens[0][0]], ['outputToken', m.tokens[1][0]],
    ['feePpm', m.feePpm], ['maxWorkLifetime', m.maxWorkLifetime],
    ['selector', selector[1]], ['selectorRuntimeHash', selector[2]]
  ] as const) await equal(engine, SHARED_ENGINE, getter, expected);
  const factory = m.runtimes.find(([role]) => role === 'ChainWhisperFixedEngineFactory')![1];
  for (const [getter, role] of [
    ['snapshotOwner', 'ChainWhisperFixedOwner'],
    ['recurringOwner', 'ChainWhisperRecurringOwnerControls'],
    ['ownerLifecycle', 'ChainWhisperOrderOwnerLifecycle'],
    ['orderWork', 'ChainWhisperOrderWork'],
    ['workLifecycle', 'ChainWhisperFixedWorkLifecycle'],
    ['rangeOwner', 'ChainWhisperRangeOwner'],
    ['rangeWork', 'ChainWhisperRangeWork']
  ] as const) await equal(factory, SHARED_FACTORY, getter, m.runtimes.find(([name]) => name === role)![1]);
  if ('companions' in m) {
    const fastQuote = m.companions.find(([role]) => role === 'ChainWhisperDexFastPoolQuote')![1];
    await equal(core, SHARED_CORE, 'fastPoolQuote', fastQuote);
    await equal(fastQuote, SHARED_NFT, 'core', core);
    await equal(core, SHARED_CORE, 'poolTerms', m.poolTerms);
    await equal(factory, SHARED_FACTORY, 'matchWork', m.runtimes.find(([role]) => role === 'ChainWhisperFixedMatchWork')![1]);
    for (const [slot, expectedWord] of m.factoryStorage) {
      const word = bytes(await rpc(binding, 'eth_getStorageAt', [factory, hexQuantity(BigInt(slot)), blockSelector(canonicalHash)]), 'Current DEX Factory storage');
      if (word !== expectedWord) throw new Error(`Current DEX Factory slot ${slot} differs from the frozen constructor.`);
    }
  }
  const timestamp = await readAnchor();
  await binding.assertCurrent();
  const coreRuntime = m.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2];
  return Object.freeze({ graph: m.graph, packageSha256: m.packageSha256, chainId: binding.chainId,
    ...('attestationBlock' in m ? { attestationSha256: m.attestationSha256, deploymentOrigin: m.attestationBlock } : {}),
    genesisHash: m.genesisHash, core, inputToken: m.tokens[0][0], outputToken: m.tokens[1][0],
    maxWorkLifetime: BigInt(m.maxWorkLifetime),
    block: Object.freeze({ number: blockNumber, hash: canonicalHash, timestamp }),
    operationReadIdentity: Object.freeze({ chainId: binding.chainId, core, runtimeHash: coreRuntime,
      releaseId: m.releaseId, blockNumber, blockHash: canonicalHash }),
    runtimeCount: m.runtimes.length + m.tokens.length + ('companions' in m ? m.companions.length : 3), readyToSign: false as const });
};

export type PreparedDexMarket = Readonly<{
  marketId: string; canonicalId: bigint; registryRevision: bigint; marketRevision: bigint;
  enabled: true; token0: string; token1: string; engine: string; poolTerms: string;
  companions: readonly Readonly<{ role: string; address: string; runtimeHash: string }>[];
}>;

/** All six accepted prepared markets at one canonical block. Public reads only. */
export const readPreparedDexMarketRegistry = async ({ capability, blockNumber, blockHash, candidate = 'cheap-prepared' }: {
  capability: DexV2ReadCapability; blockNumber: bigint; blockHash: string; candidate?: CurrentCheapDexCandidateKey;
}) => {
  const binding = bindingFor(capability), scope = resolvePreparedDexScope(candidate), m = scope.candidate;
  const graph = await readCurrentSharedPoolDexGraph({ capability, blockNumber, blockHash, candidate: scope.key });
  const canonicalHash = graph.block.hash;
  const call = async (at: string, abi: Interface, method: string, args: readonly unknown[] = []) => {
    const raw = bytes(await rpc(binding, 'eth_call', [{ to: at, data: abi.encodeFunctionData(method, [...args]) },
      blockSelector(canonicalHash)]), `Prepared market ${method}`);
    const values = abi.decodeFunctionResult(method, raw);
    if (abi.encodeFunctionResult(method, values).toLowerCase() !== raw) throw new Error('Prepared market ABI result is non-canonical.');
    return values;
  };
  const decodedUint = (value: unknown): bigint => {
    if (typeof value !== 'bigint' || value < 0n || value > UINT256_MAX) throw new Error('Prepared market revision is invalid.');
    return value;
  };
  const markets: PreparedDexMarket[] = [];
  for (const expected of m.pairs) {
    const [token0, token1] = expected.tokens;
    const forward = await call(m.core, PREPARED_MARKET_REGISTRY, 'marketForTokens', [token0, token1]);
    const reverse = await call(m.core, PREPARED_MARKET_REGISTRY, 'marketForTokens', [token1, token0]);
    if (PREPARED_MARKET_REGISTRY.encodeFunctionResult('marketForTokens', forward) !==
        PREPARED_MARKET_REGISTRY.encodeFunctionResult('marketForTokens', reverse)) throw new Error('Prepared market directions differ.');
    if (hash(forward[0], 'Prepared market ID') !== expected.marketId || forward[1] !== BigInt(expected.canonicalId) ||
        forward[4] !== true || address(forward[5], 'Prepared market Engine') !== expected.engine ||
        address(forward[6], 'Prepared market PoolTerms') !== expected.poolTerms) throw new Error('Prepared market registry identity changed or is unavailable.');
    const registryRevision = decodedUint(forward[2]), marketRevision = decodedUint(forward[3]);
    if (markets.length && markets[0].registryRevision !== registryRevision) throw new Error('Prepared registry revisions differ.');
    const companions = [];
    for (const [role, at, runtimeHash] of expected.companions) {
      await requireRuntime(binding, at, runtimeHash, canonicalHash, `Prepared market ${role}`);
      companions.push(Object.freeze({ role, address: at, runtimeHash }));
    }
    for (const [at, abi] of [[expected.engine, SHARED_ENGINE], [expected.poolTerms, PREPARED_POOL_TERMS]] as const) {
      for (const [method, value] of [['core', m.core], ['releaseId', m.releaseId], ['marketId', expected.marketId]] as const) {
        const actual = (await call(at, abi, method))[0];
        if ((method === 'core' ? address(actual, method) : hash(actual, method)) !== value) throw new Error(`Prepared market ${method} binding changed.`);
      }
    }
    const math = expected.companions.find(([role]) => role === 'ChainWhisperSharedPoolMath')![1];
    for (const [method, value] of [['token0', token0], ['token1', token1], ['sharedMath', math]] as const) {
      if (address((await call(expected.poolTerms, PREPARED_POOL_TERMS, method))[0], method) !== value) throw new Error(`Prepared market ${method} binding changed.`);
    }
    if (address((await call(math, SHARED_NFT, 'core'))[0], 'Prepared math Core') !== m.core) throw new Error('Prepared market math Core changed.');
    markets.push(Object.freeze({ marketId: expected.marketId, canonicalId: BigInt(expected.canonicalId), registryRevision, marketRevision,
      enabled: true, token0, token1, engine: expected.engine, poolTerms: expected.poolTerms, companions: Object.freeze(companions) }));
  }
  await assertChain(binding);
  if ((await readBlock(binding, 0n, 'Prepared registry genesis')).hash !== m.genesisHash ||
      (await readBlock(binding, BigInt(m.attestationBlock.number), 'Prepared registry origin')).hash !== m.attestationBlock.hash ||
      (await readBlock(binding, blockNumber, 'Prepared registry block')).hash !== canonicalHash) throw new Error('Prepared registry anchor changed.');
  await binding.assertCurrent();
  return Object.freeze({ graph: m.graph, packageSha256: m.packageSha256, chainId: graph.chainId, core: m.core, releaseId: m.releaseId,
    attestationSha256: m.attestationSha256, block: graph.block, registryRevision: markets[0].registryRevision,
    markets: Object.freeze(markets), tokens: Object.freeze(m.tokenMetadata.map((token, index) =>
      Object.freeze({ ...token, runtimeHash: m.tokens[index][1] }))), readyToSign: false as const });
};

type CurrentDexReadArgs = {
  capability: DexV2ReadCapability;
  candidate?: CurrentCheapDexIdentity;
  expected: Readonly<{ chainId: bigint; core: string; runtimeHash: string; releaseId: string;
    blockNumber?: bigint; blockHash?: string; originBlockNumber?: bigint; originBlockHash?: string }>;
  operationId: bigint;
};
type CurrentDexSnapshot<T> = Readonly<{ candidate?: CurrentCheapDexIdentity; chainId: bigint; core: string; runtimeHash: string; releaseId: string;
  operationId: bigint; block: Readonly<{ number: bigint; hash: string; timestamp: bigint }>; operation: T }>;
type HistoricalProfile = 'legacy' | 'shared-pool';
type CurrentDexProfile = HistoricalProfile | CurrentCheapDexProfile;
/** Public snapshot only; not deployment admission or write authority. */
export function readCurrentDexOperation(args: CurrentDexReadArgs & { profile: CurrentCheapDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>>>;
export function readCurrentDexOperation(args: CurrentDexReadArgs & { profile?: HistoricalProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentDexOperation>>>;
export async function readCurrentDexOperation({ capability, expected, operationId, candidate, profile = 'legacy' }: CurrentDexReadArgs & { profile?: CurrentDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation> | ReturnType<typeof decodeCurrentDexOperation>>> {
  if (!['legacy', 'shared-pool', 'fast-pool', 'cheap-async'].includes(profile)) throw new Error('Unknown current quote profile.');
  const cheapProfile = profile === 'fast-pool' || profile === 'cheap-async' ? profile : undefined;
  const binding = bindingFor(capability);
  const core = address(expected.core, 'Current DEX Core');
  const runtimeHash = hash(expected.runtimeHash, 'Current DEX runtime');
  const releaseId = hash(expected.releaseId, 'Current DEX release');
  const selected = candidate ? resolveCurrentCheapDexCandidate(currentCheapDexCandidateKey(candidate)) : undefined;
  if (selected && (!cheapProfile || core.toLowerCase() !== selected.core || expected.chainId !== BigInt(selected.chainId) ||
      runtimeHash !== selected.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2] || releaseId !== selected.releaseId)) {
    throw new Error('Current DEX read differs from its exact candidate.');
  }
  if (cheapProfile && !selected && [STAGED_TWO_POOL_CANDIDATE.core, STAGED_POOL_REFERENCE_CANDIDATE.core, STAGED_NATIVE_DEX_CANDIDATE.core, STAGED_D06_DEX_CANDIDATE.core].includes(core.toLowerCase())) {
    throw new Error('Successor DEX read requires graph, package and Core binding.');
  }
  if ((expected.blockNumber === undefined) !== (expected.blockHash === undefined) ||
      (expected.originBlockNumber === undefined) !== (expected.originBlockHash === undefined)) {
    throw new Error('Current DEX read identity is invalid.');
  }
  await assertChain(binding);
  const head = expected.blockNumber === undefined ? await rpc(binding, 'eth_getBlockByNumber', ['latest', false]) : null;
  if (expected.blockNumber === undefined && head === null) throw new Error('Current DEX head is unavailable.');
  if (head !== null && (typeof head !== 'object' || Array.isArray(head))) throw new Error('Current DEX head is unavailable.');
  const blockNumber = head ? quantity((head as Record<string, unknown>).number, 'Current DEX head number', UINT64_MAX) : expected.blockNumber;
  const blockHash = hash(head ? (head as Record<string, unknown>).hash : expected.blockHash, 'Current DEX block');
  if (expected.chainId !== binding.chainId || typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX) {
    throw new Error('Current DEX read identity is invalid.');
  }
  const originNumber = expected.originBlockNumber;
  const originHash = originNumber === undefined ? null : hash(expected.originBlockHash, 'Current DEX origin block');
  if (originNumber !== undefined && (originNumber < 0n || originNumber > UINT64_MAX || originNumber > blockNumber ||
      (await readBlock(binding, originNumber, 'Current DEX origin block')).hash !== originHash)) {
    throw new Error('Current DEX origin block changed.');
  }
  const data = cheapProfile ? encodeCurrentCheapDexOperationRead(operationId, cheapProfile) : encodeCurrentDexOperationRead(operationId);
  const release = new Interface(['function releaseId() view returns(bytes32)']);
  const block = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(blockNumber), false]);
  if (!block || typeof block !== 'object') throw new Error('Current DEX block is unavailable.');
  const record = block as Record<string, unknown>;
  if (quantity(record.number, 'Current DEX block number', UINT64_MAX) !== blockNumber || hash(record.hash, 'Current DEX block hash') !== blockHash) {
    throw new Error('Current DEX block changed.');
  }
  const timestamp = quantity(record.timestamp, 'Current DEX block timestamp');
  const checkCandidateAnchors = async () => {
    if (!selected) return;
    if ((await readBlock(binding, 0n, 'Current DEX candidate genesis')).hash !== selected.genesisHash ||
        blockNumber < BigInt(selected.attestationBlock.number) ||
        (await readBlock(binding, BigInt(selected.attestationBlock.number), 'Current DEX deployment origin')).hash !== selected.attestationBlock.hash) {
      throw new Error('Current DEX candidate genesis or deployment origin changed.');
    }
  };
  // This operation snapshot binds Core and its canonical origins. The wallet performs
  // the complete same-block module graph check separately; do not duplicate that scan.
  await checkCandidateAnchors();
  await requireRuntime(binding, core, runtimeHash, blockHash, 'Current DEX Core');
  if (hash(await scalar(binding, core, release, 'releaseId', [], blockHash), 'Current DEX release') !== releaseId) {
    throw new Error('Current DEX release changed.');
  }
  const raw = bytes(await rpc(binding, 'eth_call', [{ to: core, data }, blockSelector(blockHash)]), 'Current DEX operation');
  const operation = cheapProfile ? decodeCurrentCheapDexOperation(raw, timestamp, cheapProfile, selected) :
    decodeCurrentDexOperation(raw, timestamp, profile as HistoricalProfile);
  await assertChain(binding);
  if ((await readBlock(binding, blockNumber, 'Rechecked current DEX block')).hash !== blockHash) {
    throw new Error('Current DEX block changed during read.');
  }
  if (originNumber !== undefined && (await readBlock(binding, originNumber, 'Rechecked DEX origin block')).hash !== originHash) {
    throw new Error('Current DEX origin block changed during read.');
  }
  await checkCandidateAnchors();
  await binding.assertCurrent();
  return Object.freeze({ ...(selected ? { candidate: selected } : {}), chainId: binding.chainId, core, runtimeHash, releaseId, operationId,
    block: Object.freeze({ number: blockNumber, hash: blockHash, timestamp }), operation });
}

/** Recover the opening operation/context from the exact mined call and current canonical state. */
type CurrentDexIssuedArgs = {
  capability: DexV2ReadCapability;
  candidate?: CurrentCheapDexIdentity;
  runtimeHash: string;
  issue: Omit<Parameters<typeof decodeCurrentDexQuoteIssue>[0], 'profile'>;
};
type CurrentDexIssueOrigin = Readonly<{ originBlock: Readonly<{ number: bigint; hash: string }>; principal: string; transactionHash: string }>;
export function readCurrentDexIssuedQuote(args: CurrentDexIssuedArgs & { profile: CurrentCheapDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>> & CurrentDexIssueOrigin>;
export function readCurrentDexIssuedQuote(args: CurrentDexIssuedArgs & { profile?: HistoricalProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentDexOperation>> & CurrentDexIssueOrigin & { epochId: bigint }>;
export async function readCurrentDexIssuedQuote({ capability, runtimeHash, issue, candidate, profile = 'legacy' }: CurrentDexIssuedArgs & { profile?: CurrentDexProfile }) {
  if (!['legacy', 'shared-pool', 'fast-pool', 'cheap-async'].includes(profile)) throw new Error('Unknown current quote profile.');
  const cheapProfile = profile === 'fast-pool' || profile === 'cheap-async' ? profile : undefined;
  if (candidate && (!cheapProfile || issue.quoteProtocol !== currentCheapDexQuoteProtocol(candidate))) {
    throw new Error('Quote issue protocol differs from its exact candidate.');
  }
  const expected = Object.freeze({ ...issue.expected });
  const issued = decodeCurrentDexQuoteIssue({ ...issue, expected, profile: cheapProfile ?? 'legacy' });
  const epochId = 'epochId' in issued ? issued.epochId : undefined;
  const issueContextHash = 'contextHash' in issued ? issued.contextHash : undefined;
  const args = { capability, candidate, operationId: issued.operationId,
    expected: { chainId: expected.chainId, core: expected.core, runtimeHash, releaseId: issued.releaseId,
      originBlockNumber: issued.block.number, originBlockHash: issued.block.hash } };
  const snapshot = cheapProfile ? await readCurrentDexOperation({ ...args, profile: cheapProfile }) :
    await readCurrentDexOperation({ ...args, profile: profile as HistoricalProfile });
  const operation = snapshot.operation;
  if (operation.phase === 'not-found' || operation.deadline !== issued.deadline ||
      ('epochId' in operation && (operation.epochId !== epochId || BigInt(operation.contextHash) === 0n)) ||
      (cheapProfile === 'fast-pool' && operation.contextHash !== issueContextHash)) {
    throw new Error('Quote issue does not match Core operation state.');
  }
  return Object.freeze({ ...snapshot, originBlock: issued.block, ...(cheapProfile ? {} : { epochId }),
    principal: address(expected.principal, 'Quote principal'),
    transactionHash: issued.transactionHash });
}

/** Ciphertext read, not caller authentication or proof of payout. Decrypt only in the selected owner session. */
type CurrentDexReceiptSnapshot<T> = CurrentDexSnapshot<T> & Readonly<{ principal: string; kind: 'quote' | 'pending' | 'terminal' | 'unverified'; encrypted: ReturnType<typeof decodeCurrentDexReceipt> }>;
export function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile: CurrentCheapDexProfile }): Promise<CurrentDexReceiptSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>>>;
export function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile?: HistoricalProfile }): Promise<CurrentDexReceiptSnapshot<ReturnType<typeof decodeCurrentDexOperation>>>;
export async function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile?: CurrentDexProfile }) {
  const principal = address(args.principal, 'Current DEX principal');
  const originNumber = args.expected.originBlockNumber;
  const originHash = originNumber === undefined ? undefined : hash(args.expected.originBlockHash, 'Receipt origin hash');
  const binding = bindingFor(args.capability);
  const cheapProfile = args.profile === 'fast-pool' || args.profile === 'cheap-async' ? args.profile : undefined;
  const snapshot = cheapProfile ? await readCurrentDexOperation({ ...args, profile: cheapProfile }) :
    await readCurrentDexOperation({ ...args, profile: args.profile as HistoricalProfile | undefined });
  const operation = snapshot.operation;
  const stages = currentCheapDexStages(args.candidate);
  const available = 'status' in operation ? (operation.status === 2 && operation.quotePrepared) || operation.status === 3 || operation.status === 4 :
    operation.profile === 'fast-pool' ? operation.phase !== 'not-found' : operation.stage! >= stages.ready;
  if (!available) {
    throw new Error('Current DEX receipt is not available.');
  }
  const raw = bytes(await rpc(binding, 'eth_call', [{ from: principal, to: snapshot.core,
    data: encodeCurrentDexReceiptRead(snapshot.operationId, cheapProfile) }, blockSelector(snapshot.block.hash)]), 'Current DEX receipt');
  const encrypted = decodeCurrentDexReceipt(raw, cheapProfile);
  await assertChain(binding);
  if ((await readBlock(binding, snapshot.block.number, 'Rechecked receipt block')).hash !== snapshot.block.hash) {
    throw new Error('Current DEX receipt block changed during read.');
  }
  if (originNumber !== undefined &&
      (await readBlock(binding, originNumber, 'Rechecked receipt origin')).hash !== originHash) {
    throw new Error('Current DEX origin block changed during receipt read.');
  }
  await binding.assertCurrent();
  const kind = 'status' in operation ? operation.status === 2 ? 'quote' : 'terminal' :
    operation.profile === 'fast-pool' ? operation.ready ? 'quote' : 'unverified' :
    operation.stage === stages.ready ? 'quote' : operation.stage === stages.funded ? 'pending' : 'terminal';
  return Object.freeze({ ...snapshot, principal, kind, encrypted });
}
