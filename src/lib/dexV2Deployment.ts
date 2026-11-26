import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';
export { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const COTI_TESTNET_CHAIN_ID = '7082400';
const UINT64_MAX = (1n << 64n) - 1n;

export const DEX_V2_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_DEX_V2_ENABLED',
  manifest: 'VITE_CHAINWHISPER_DEX_V2_MANIFEST',
  finalityLagBlocks: 'VITE_CHAINWHISPER_DEX_V2_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_DEX_V2_RPC_URL'
} as const);

export const DEX_V2_COMPONENT_KEYS = Object.freeze([
  'factory',
  'pool',
  'limit',
  'recurring',
  'swap',
  'core',
  'positionToken'
] as const);

// Exact shared-Pool trial deployment: unsigned package 1efdd9c5..., confirmed journal of 33 rows.
// This is a read identity only. It does not admit a transaction.
// Staged identity only. This record does not change the active deployment or admit writes.
type WidenCandidate<T> = T extends string ? string : T extends number ? number
  : T extends object ? { readonly [K in keyof T]: WidenCandidate<T[K]> } : T;
export type CurrentCheapDexCandidate = WidenCandidate<typeof STAGED_SHARED_HISTORY_DEX_CANDIDATE>;
export type CurrentCheapDexIdentity = Readonly<{ graph: string; packageSha256: string; core: string }>;
// decision-034 (owner, 2026-11-26): the App uses one contract version, the current build 13 graph.
export type CurrentCheapDexCandidateKey = 'cheap-history';
export const resolveCurrentCheapDexCandidate = (key: CurrentCheapDexCandidateKey): CurrentCheapDexCandidate => {
  if (key !== 'cheap-history') throw new Error('Unknown current DEX candidate.');
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE;
};
const sameIdentity = (identity: CurrentCheapDexIdentity, c: CurrentCheapDexIdentity) =>
  identity.graph === c.graph && identity.packageSha256 === c.packageSha256 && identity.core.toLowerCase() === c.core.toLowerCase();
export const currentCheapDexCandidateKey = (identity: CurrentCheapDexIdentity): CurrentCheapDexCandidateKey => {
  if (sameIdentity(identity, STAGED_SHARED_HISTORY_DEX_CANDIDATE)) return 'cheap-history';
  throw new Error('Current DEX graph, package and Core do not match a reviewed candidate.');
};
export const currentCheapDexStages = (identity: CurrentCheapDexIdentity = STAGED_SHARED_HISTORY_DEX_CANDIDATE): Readonly<{
  workCalls: number; ready: number; funded: number; settled: number; released: number
}> => {
  currentCheapDexCandidateKey(identity);
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.stages;
};
export const currentCheapDexQuoteProtocol = (candidate: CurrentCheapDexIdentity) => {
  currentCheapDexCandidateKey(candidate);
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.name;
};
// decision-034: the current graph has no general native App submission admission (it has 4 work calls).
// Each proved phase is admitted at its own call site; any other phase stops here.
export const rejectUnprovenNativeAdmission = (): never => {
  throw new Error('Successor DEX native App submission admission is absent.');
};
export const currentCheapDexOwnerActionEligible = (candidate: CurrentCheapDexIdentity | undefined, stage: number | undefined, action: 'cancel' | 'recover') => {
  const stages = currentCheapDexStages(candidate);
  return action === 'cancel' ? Number.isInteger(stage) && stage! >= 1 && stage! <= stages.ready : stage === stages.funded;
};

export type DexV2ComponentKey = typeof DEX_V2_COMPONENT_KEYS[number];

export type DexV2AppManifest = Readonly<{
  schemaVersion: 1;
  status: 'activated-testnet';
  network: 'cotiTestnet';
  chainId: typeof COTI_TESTNET_CHAIN_ID;
  productionActivationEvidence: false;
  operator: string;
  owner: string;
  deploymentPlanHash: string;
  deploymentCandidateHash: string;
  activationPlanHash: string;
  activationReportHash: string;
  addresses: Readonly<Record<DexV2ComponentKey, string>>;
  runtimeHashes: Readonly<Record<DexV2ComponentKey, string>>;
  deploymentAnchors: Readonly<{
    factory: Readonly<{ number: string; hash: string }>;
    economicSuite: Readonly<{ number: string; hash: string }>;
    pairRegistration: Readonly<{ number: string; hash: string }>;
  }>;
  pair: Readonly<{
    pairKey: string;
    baseToken: string;
    quoteToken: string;
    baseTokenRuntimeHash: string;
    quoteTokenRuntimeHash: string;
    privateTokenRuntimeManifestHash: string;
    privateTokenRuntimeManifestLength: number;
    baseDecimals: number;
    quoteDecimals: number;
    baseLotSize: string;
    quoteLotSize: string;
    maximumAggregateLots: string;
    tickTableHash: string;
  }>;
  activation: Readonly<{
    result: 'pass';
    transactionCount: 16;
    measuredRouteCount: 4;
    finalBlock: Readonly<{ number: string; hash: string }>;
    allProofsPassed: true;
    routeGasP95Passed: true;
    routeGasMaximumPassed: true;
    routeLatencyP95Passed: true;
  }>;
  manifestHash: string;
}>;

export type DexV2DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: DexV2AppManifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
    }>;

const MANIFESTS = new WeakSet<object>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid.`);
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

export const hashDexV2AppManifestBody = (body: unknown): string =>
  keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))).toLowerCase();

const required = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`DEX V2 requires ${key}.`);
  }
  return value;
};

const decimal = (value: unknown, label: string, maximum = UINT64_MAX, allowZero = false): string => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`${label} must be canonical decimal.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is out of range.`);
  }
  return value;
};

const integer = (value: unknown, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return Number(value);
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

const hash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return value.toLowerCase();
};

const booleanLiteral = <T extends boolean>(value: unknown, expected: T, label: string): T => {
  if (value !== expected) throw new Error(`${label} must be exactly ${String(expected)}.`);
  return expected;
};

const parseBlock = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  exactKeys(value, ['number', 'hash'], label);
  return Object.freeze({
    number: decimal(value.number, `${label} number`),
    hash: hash(value.hash, `${label} hash`)
  });
};

const parseComponents = <T extends 'address' | 'hash'>(
  value: unknown,
  kind: T
): Readonly<Record<DexV2ComponentKey, string>> => {
  if (!isRecord(value)) throw new Error(`DEX V2 component ${kind}s are invalid.`);
  exactKeys(value, DEX_V2_COMPONENT_KEYS, `DEX V2 component ${kind}s`);
  const entries = DEX_V2_COMPONENT_KEYS.map((key) => [
    key,
    kind === 'address'
      ? address(value[key], `DEX V2 ${key} address`)
      : hash(value[key], `DEX V2 ${key} runtime hash`)
  ] as const);
  if (kind === 'address' && new Set(entries.map(([, item]) => item)).size !== entries.length) {
    throw new Error('DEX V2 component addresses must be distinct.');
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<DexV2ComponentKey, string>>;
};

export const parseDexV2AppManifest = (text: string): DexV2AppManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('DEX V2 manifest must be valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('DEX V2 manifest must be an object.');
  exactKeys(parsed, [
    'schemaVersion',
    'status',
    'network',
    'chainId',
    'productionActivationEvidence',
    'operator',
    'owner',
    'deploymentPlanHash',
    'deploymentCandidateHash',
    'activationPlanHash',
    'activationReportHash',
    'addresses',
    'runtimeHashes',
    'deploymentAnchors',
    'pair',
    'activation',
    'manifestHash'
  ], 'DEX V2 manifest');
  if (
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'activated-testnet' ||
    parsed.network !== 'cotiTestnet' ||
    parsed.chainId !== COTI_TESTNET_CHAIN_ID
  ) {
    throw new Error('DEX V2 manifest identity is invalid.');
  }
  booleanLiteral(parsed.productionActivationEvidence, false, 'DEX V2 production activation evidence');
  const addresses = parseComponents(parsed.addresses, 'address');
  const runtimeHashes = parseComponents(parsed.runtimeHashes, 'hash');

  if (!isRecord(parsed.deploymentAnchors)) throw new Error('DEX V2 deployment anchors are invalid.');
  exactKeys(parsed.deploymentAnchors, ['factory', 'economicSuite', 'pairRegistration'], 'DEX V2 deployment anchors');
  const deploymentAnchors = Object.freeze({
    factory: parseBlock(parsed.deploymentAnchors.factory, 'DEX V2 factory deployment anchor'),
    economicSuite: parseBlock(parsed.deploymentAnchors.economicSuite, 'DEX V2 economic deployment anchor'),
    pairRegistration: parseBlock(parsed.deploymentAnchors.pairRegistration, 'DEX V2 pair-registration anchor')
  });
  if (
    BigInt(deploymentAnchors.factory.number) > BigInt(deploymentAnchors.economicSuite.number) ||
    BigInt(deploymentAnchors.economicSuite.number) > BigInt(deploymentAnchors.pairRegistration.number)
  ) {
    throw new Error('DEX V2 deployment anchors are out of order.');
  }

  if (!isRecord(parsed.pair)) throw new Error('DEX V2 pair is invalid.');
  exactKeys(parsed.pair, [
    'pairKey', 'baseToken', 'quoteToken', 'baseTokenRuntimeHash', 'quoteTokenRuntimeHash',
    'privateTokenRuntimeManifestHash', 'privateTokenRuntimeManifestLength',
    'baseDecimals', 'quoteDecimals', 'baseLotSize', 'quoteLotSize', 'maximumAggregateLots',
    'tickTableHash'
  ], 'DEX V2 pair');
  const baseToken = address(parsed.pair.baseToken, 'DEX V2 base token');
  const quoteToken = address(parsed.pair.quoteToken, 'DEX V2 quote token');
  if (BigInt(baseToken) >= BigInt(quoteToken)) {
    throw new Error('DEX V2 pair tokens are not in canonical address order.');
  }
  const expectedPairKey = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [baseToken, quoteToken]
  )).toLowerCase();
  const pairKey = hash(parsed.pair.pairKey, 'DEX V2 pair key');
  if (pairKey !== expectedPairKey) {
    throw new Error('DEX V2 pair key does not match its canonical token addresses.');
  }
  const pair = Object.freeze({
    pairKey,
    baseToken,
    quoteToken,
    baseTokenRuntimeHash: hash(parsed.pair.baseTokenRuntimeHash, 'DEX V2 base-token runtime hash'),
    quoteTokenRuntimeHash: hash(parsed.pair.quoteTokenRuntimeHash, 'DEX V2 quote-token runtime hash'),
    privateTokenRuntimeManifestHash: hash(
      parsed.pair.privateTokenRuntimeManifestHash,
      'DEX V2 private-token runtime-manifest hash'
    ),
    privateTokenRuntimeManifestLength: integer(
      parsed.pair.privateTokenRuntimeManifestLength,
      'DEX V2 private-token runtime-manifest length',
      256
    ),
    baseDecimals: integer(parsed.pair.baseDecimals, 'DEX V2 base decimals', 18),
    quoteDecimals: integer(parsed.pair.quoteDecimals, 'DEX V2 quote decimals', 18),
    baseLotSize: decimal(parsed.pair.baseLotSize, 'DEX V2 base lot size', (1n << 128n) - 1n),
    quoteLotSize: decimal(parsed.pair.quoteLotSize, 'DEX V2 quote lot size', (1n << 128n) - 1n),
    maximumAggregateLots: decimal(parsed.pair.maximumAggregateLots, 'DEX V2 maximum aggregate lots', (1n << 32n) - 1n),
    tickTableHash: hash(parsed.pair.tickTableHash, 'DEX V2 tick-table hash')
  });

  if (!isRecord(parsed.activation)) throw new Error('DEX V2 activation is invalid.');
  exactKeys(parsed.activation, [
    'result', 'transactionCount', 'measuredRouteCount', 'finalBlock', 'allProofsPassed',
    'routeGasP95Passed', 'routeGasMaximumPassed', 'routeLatencyP95Passed'
  ], 'DEX V2 activation');
  if (parsed.activation.result !== 'pass' || parsed.activation.transactionCount !== 16 ||
      parsed.activation.measuredRouteCount !== 4) {
    throw new Error('DEX V2 activation did not complete the frozen live journey.');
  }
  const activation = Object.freeze({
    result: 'pass' as const,
    transactionCount: 16 as const,
    measuredRouteCount: 4 as const,
    finalBlock: parseBlock(parsed.activation.finalBlock, 'DEX V2 activation final block'),
    allProofsPassed: booleanLiteral(parsed.activation.allProofsPassed, true, 'DEX V2 activation proofs'),
    routeGasP95Passed: booleanLiteral(parsed.activation.routeGasP95Passed, true, 'DEX V2 route p95 gas gate'),
    routeGasMaximumPassed: booleanLiteral(parsed.activation.routeGasMaximumPassed, true, 'DEX V2 route maximum gas gate'),
    routeLatencyP95Passed: booleanLiteral(parsed.activation.routeLatencyP95Passed, true, 'DEX V2 route latency gate')
  });
  if (BigInt(activation.finalBlock.number) < BigInt(deploymentAnchors.pairRegistration.number)) {
    throw new Error('DEX V2 activation final block predates pair registration.');
  }

  const manifestHash = hash(parsed.manifestHash, 'DEX V2 manifest hash');
  const { manifestHash: _ignored, ...body } = parsed;
  if (hashDexV2AppManifestBody(body) !== manifestHash) {
    throw new Error('DEX V2 manifest hash is invalid.');
  }

  const manifest = Object.freeze({
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: COTI_TESTNET_CHAIN_ID,
    productionActivationEvidence: false,
    operator: address(parsed.operator, 'DEX V2 operator'),
    owner: address(parsed.owner, 'DEX V2 owner'),
    deploymentPlanHash: hash(parsed.deploymentPlanHash, 'DEX V2 deployment-plan hash'),
    deploymentCandidateHash: hash(parsed.deploymentCandidateHash, 'DEX V2 deployment-candidate hash'),
    activationPlanHash: hash(parsed.activationPlanHash, 'DEX V2 activation-plan hash'),
    activationReportHash: hash(parsed.activationReportHash, 'DEX V2 activation-report hash'),
    addresses,
    runtimeHashes,
    deploymentAnchors,
    pair,
    activation,
    manifestHash
  }) as DexV2AppManifest;
  MANIFESTS.add(manifest);
  return manifest;
};

export const assertDexV2AppManifest = (manifest: DexV2AppManifest): DexV2AppManifest => {
  if (!manifest || !MANIFESTS.has(manifest)) {
    throw new Error('DEX V2 requires a manifest returned by its exact parser.');
  }
  return manifest;
};

const parseRpcUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (
      parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    ) throw new Error('unsupported');
    return parsed.toString();
  } catch {
    throw new Error('DEX V2 RPC URL must be HTTPS or credential-free local HTTP.');
  }
};

export const parseDexV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): DexV2DeploymentConfig => {
  const enabled = env[DEX_V2_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${DEX_V2_ENV_KEYS.enabled} must be exactly true or false.`);
  }
  const manifest = parseDexV2AppManifest(required(env, DEX_V2_ENV_KEYS.manifest));
  const finalityLagBlocks = BigInt(decimal(
    required(env, DEX_V2_ENV_KEYS.finalityLagBlocks),
    'DEX V2 finality lag',
    4_096n
  ));
  const rpcUrl = parseRpcUrl(required(env, DEX_V2_ENV_KEYS.rpcUrl));
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    rpcUrl,
    fingerprint: [
      'chainwhisper-dex-v2-activated-testnet',
      manifest.manifestHash,
      manifest.deploymentCandidateHash,
      manifest.activationReportHash,
      manifest.activation.finalBlock.number,
      manifest.activation.finalBlock.hash,
      finalityLagBlocks.toString(),
      rpcUrl
    ].join(':')
  });
};

export const resolveDexV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): DexV2DeploymentConfig => {
  try {
    return parseDexV2DeploymentConfig(env);
  } catch {
    return Object.freeze({ status: 'invalid', error: 'ChainWhisper DEX V2 deployment configuration is invalid.' });
  }
};

export const DEX_V2_DEPLOYMENT_CONFIG = resolveDexV2DeploymentConfig(import.meta.env);
