import {
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import { describeCotiRpcQueueExpiry } from './appShared/cotiRpcPacing';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import {
  getTradeHistoryV2EventInterface,
  parseTradeHistoryV2Log,
  type ParsedTradeHistoryV2Log,
  type TradeHistoryV2EventProtocol,
  type TradeHistoryV2RawLog
} from './tradeHistoryV2Events';

const METADATA_INTERFACE = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);

const WALLET_INDEX_METHODS = {
  'standard-v2': ['getTradeIdsForMaker', 'getTradeIdsForFiller'],
  'private-v2': ['getOrderIdsForMaker', 'getOrderIdsForFiller'],
  'direct-v2': ['getTradeIdsForMaker', 'getTradeIdsForTaker']
} as const;
const WALLET_INDEX_INTERFACE = new Interface([...new Set(Object.values(WALLET_INDEX_METHODS).flat())]
  .map(name => `function ${name}(address owner,uint256 offset,uint256 limit) view returns (uint256[],uint256)`));

declare const WALLET_HISTORY_INDEX_BRAND: unique symbol;
export type TradeHistoryV2WalletIndex = Readonly<{
  readonly [WALLET_HISTORY_INDEX_BRAND]: true;
  ownerAddress: string;
  orderIds: readonly string[];
  complete: boolean;
  block: TradeHistoryV2CanonicalBlock;
}>;
const WALLET_INDEXES = new WeakMap<TradeHistoryV2WalletIndex, Readonly<{
  capability: TradeHistoryV2ReadCapability; deployment: AttestedTradeHistoryV2Deployment;
}>>();

export const assertTradeHistoryV2WalletIndex = (index: TradeHistoryV2WalletIndex,
  capability: TradeHistoryV2ReadCapability, deployment: AttestedTradeHistoryV2Deployment,
  ownerAddress?: string): void => {
  const binding = WALLET_INDEXES.get(index);
  if (!binding || binding.capability !== capability || binding.deployment !== deployment ||
      (ownerAddress !== undefined && canonicalAddress(ownerAddress, 'History viewer') !== index.ownerAddress)) {
    throw new Error('Wallet history index belongs to another capability, deployment or owner.');
  }
};

const EVENT_NAMES = {
  'standard-v2': ['StandardTradeOpened', 'StandardTradeFilled', 'StandardTradeStatusChanged', 'StandardTradeReplaced'],
  'private-v2': ['PrivateOrderOpened', 'PrivateOrderFilled', 'PrivateOrderAccountSnapshotUpdated', 'PrivateOrderStatusChanged', 'PrivateOrderReplaced'],
  'direct-v2': ['DirectTradeOpened', 'DirectTradeStatusChanged', 'DirectTradeReplaced'],
  'recurring-v2': ['RecurringOrderOpened', 'RecurringOrderEdited', 'RecurringOrderExecuted', 'RecurringOrderStatusChanged', 'RecurringInventorySettled'],
  'private-recurring-v2': [
    'PrivateRecurringOrderOpened',
    'PrivateRecurringOrderEdited',
    'PrivateRecurringOrderExecuted',
    'PrivateRecurringExecutionReceiptUpdated',
    'PrivateRecurringOrderStatusChanged',
    'PrivateRecurringInventorySettled'
  ]
} as const;

const CONTRACT_POLICY = {
  'counter-v2': { version: 'ChainWhisperCounterOTCEscrowV2', features: [] },
  'link-v2': {
    version: 'ChainWhisperLinkOTCEscrowV2',
    features: []
  },
  'standard-v2': {
    version: 'ChainWhisperStandardOTCEscrowV2',
    features: [
      'DIRECT_WALLET_AUTHORITY',
      'PUBLIC_DESK',
      'BOUNDED_PARTIAL_FILLS',
      'STALE_FILL_REVISION',
      'NO_APP_WALLET_EXECUTOR'
    ]
  },
  'private-v2': {
    version: 'ChainWhisperPrivateOTCEscrowV2',
    features: [
      'DIRECT_WALLET_AUTHORITY',
      'PUBLIC_SAFE_PRIVATE_DISCOVERY',
      'PACKED_PRIVATE_INPUTS',
      'PRIVATE_ACCOUNT_SNAPSHOTS',
      'NO_APP_WALLET_EXECUTOR'
    ]
  },
  'direct-v2': {
    version: 'ChainWhisperDirectOTCEscrowV2',
    features: [
      'DIRECT_WALLET_AUTHORITY',
      'RECIPIENT_ADDRESSED_EVENTS',
      'CANONICAL_TRADE_CARD_EVENTS',
      'PUBLIC_PRIVATE_ENTRYPOINTS',
      'NO_APP_WALLET_EXECUTOR'
    ]
  },
  'recurring-v2': {
    version: 'ChainWhisperRecurringOTCEscrowV2',
    features: [
      'DIRECT_WALLET_AUTHORITY',
      'PUBLIC_RECURRING_ORDERS',
      'CANONICAL_EXECUTION_HISTORY',
      'STALE_EXECUTION_REVISION',
      'NO_APP_WALLET_EXECUTOR'
    ]
  },
  'private-recurring-v2': {
    version: 'ChainWhisperPrivateRecurringOTCEscrowV2',
    features: [
      'DIRECT_WALLET_AUTHORITY',
      'PRIVATE_RECURRING_ORDERS',
      'PACKED_PRIVATE_INPUTS',
      'PARTICIPANT_EXECUTION_RECEIPTS',
      'NO_APP_WALLET_EXECUTOR'
    ]
  }
} as const;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export const TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS = 2_048n;
export const TRADE_HISTORY_V2_MAX_CANONICAL_LOG_RANGE_BLOCKS = 100_000n;
export const TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS = 100_000n;
export const TRADE_HISTORY_V2_MAX_LOGS_PER_RANGE = 4_096;

/** A successful, oversized response can be split; transport and validation failures cannot. */
export class TradeHistoryV2RangeLimitError extends Error {
  constructor() {
    super('Trade-history range returned too many logs; split the range.');
    this.name = 'TradeHistoryV2RangeLimitError';
  }
}

declare const TRADE_HISTORY_V2_READ_CAPABILITY_BRAND: unique symbol;
export type TradeHistoryV2ReadCapability = Readonly<{
  readonly [TRADE_HISTORY_V2_READ_CAPABILITY_BRAND]: true;
}>;

export type TradeV2DeploymentProtocol = TradeHistoryV2EventProtocol | 'link-v2' | 'counter-v2';

export type TradeHistoryV2ManifestInput<P extends TradeV2DeploymentProtocol = TradeHistoryV2EventProtocol> = Readonly<{
  protocol: P;
  chainId: bigint | number | string;
  contractAddress: string;
  deploymentBlock: bigint | number | string;
  runtimeBytecodeHash: string;
}>;

export type TradeHistoryV2CanonicalBlock = Readonly<{
  number: string;
  hash: string;
}>;

declare const ATTESTED_TRADE_HISTORY_V2_DEPLOYMENT_BRAND: unique symbol;
export type AttestedTradeHistoryV2Deployment<P extends TradeV2DeploymentProtocol = TradeHistoryV2EventProtocol> = Readonly<{
  protocol: P;
  chainId: string;
  contractAddress: string;
  deploymentBlock: string;
  runtimeBytecodeHash: string;
  contractVersion: string;
  requiredFeatures: readonly string[];
  finalityLagBlocks: string;
  attestationBlock: TradeHistoryV2CanonicalBlock;
  readonly [ATTESTED_TRADE_HISTORY_V2_DEPLOYMENT_BRAND]: true;
}>;

declare const CANONICAL_TRADE_HISTORY_V2_PAGE_BRAND: unique symbol;
export type CanonicalTradeHistoryV2LogRange = Readonly<{
  scope: Readonly<{
    protocol: TradeHistoryV2EventProtocol;
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
  safeHead: TradeHistoryV2CanonicalBlock;
  checkedBlocks: readonly TradeHistoryV2CanonicalBlock[];
  events: readonly ParsedTradeHistoryV2Log[];
  readonly [CANONICAL_TRADE_HISTORY_V2_PAGE_BRAND]: true;
}>;
export type CanonicalTradeV2RawLogRange<P extends TradeV2DeploymentProtocol = TradeV2DeploymentProtocol> =
  Pick<CanonicalTradeHistoryV2LogRange, 'range' | 'safeHead' | 'checkedBlocks'> & Readonly<{
    scope: Readonly<{ protocol: P; chainId: string; contractAddress: string; deploymentBlock: string }>;
    logs: readonly TradeHistoryV2RawLog[];
    receiptLogs: Readonly<Record<string, readonly TradeHistoryV2RawLog[]>>;
  }>;
type LogTopics = readonly (string | null | readonly string[])[];

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type CapabilityBinding = Readonly<{
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  isObservationCurrent?: () => boolean;
  observeRead?: CanonicalHistoryReadObserver;
}>;
type DeploymentBinding = Readonly<{
  capability: TradeHistoryV2ReadCapability;
  finalityLagBlocks: bigint;
}>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const DEPLOYMENTS = new WeakMap<object, DeploymentBinding>();
const CANONICAL_PAGES = new WeakSet<object>();

type ParticipantReadStage = 'preflight' | 'logs' | 'receipts' | 'view' | 'fence' | 'done' | 'failed';
const observeParticipantHistory = (protocol: TradeV2DeploymentProtocol, operation: 'range' | 'view', enabled = true) => {
  let attemptStartedAt = 0, stageStartedAt = 0, previousStage: ParticipantReadStage = 'preflight';
  return (stage: ParticipantReadStage): void => {
    try {
      if (!enabled || !['link-v2', 'counter-v2'].includes(protocol) ||
          !(import.meta.env.DEV || import.meta.env.MODE === 'coti-testnet-candidate') || typeof document === 'undefined') return;
      const at = Date.now();
      if (!attemptStartedAt) attemptStartedAt = stageStartedAt = at;
      const prior = previousStage, previousStageMs = at - stageStartedAt;
      previousStage = stage; stageStartedAt = at;
      document.documentElement.setAttribute(protocol === 'link-v2' ? 'data-p2p-link-history-read' : 'data-p2p-counter-history-read',
        JSON.stringify({ operation, attemptStartedAt, stage, stageStartedAt, previousStage: prior, previousStageMs, at }));
    } catch { /* Read-only development observation must not change history outcomes. */ }
  };
};

const CANONICAL_READ_ATTRIBUTES = {
  'standard-v2': 'data-p2p-standard-history-read',
  'private-v2': 'data-p2p-private-history-read',
  'direct-v2': 'data-p2p-direct-history-read'
} as const;
const CANONICAL_READ_OWNERS = new Map<string, (() => boolean) | undefined>();
type CanonicalHistoryReadStage = ParticipantReadStage | 'rpc' | 'head' | 'block' |
  'private-capability' | 'private-terms' | 'private-decryption';
type CanonicalHistoryReadObserver = (stage: CanonicalHistoryReadStage, method?: string,
  state?: 'pending' | 'completed' | 'failed', phase?: 'guard-before' | 'request' | 'guard-after') => void;
type ObservationDeployment = Pick<AttestedTradeHistoryV2Deployment<TradeV2DeploymentProtocol>, 'protocol' | 'contractAddress'>;

export const clearCanonicalTradeHistoryV2ReadObservation = (deployment: ObservationDeployment, owner?: () => boolean): void => {
  try {
    if (!(import.meta.env.DEV || import.meta.env.MODE === 'coti-testnet-candidate') || typeof document === 'undefined') return;
    const attribute = CANONICAL_READ_ATTRIBUTES[deployment.protocol as keyof typeof CANONICAL_READ_ATTRIBUTES];
    if (attribute && CANONICAL_READ_OWNERS.has(attribute) && CANONICAL_READ_OWNERS.get(attribute) === owner) {
      document.documentElement.removeAttribute(attribute);
      CANONICAL_READ_OWNERS.delete(attribute);
    }
  } catch { /* Observation must not affect runtime cleanup. */ }
};

export const observeCanonicalTradeHistoryV2Read = (deployment: ObservationDeployment | undefined,
  operation: 'head' | 'block' | 'range' | 'view' | 'private',
  range?: Readonly<{ fromBlock: bigint; toBlock: bigint }>,
  isCurrent?: () => boolean): CanonicalHistoryReadObserver => {
  let attemptStartedAt = 0, ordinal = 0, activeStage: CanonicalHistoryReadStage = 'preflight', lastValue = '';
  let lastMethod: string | null = null, lastPhase: Parameters<CanonicalHistoryReadObserver>[3];
  return (stage, method, state = stage === 'done' ? 'completed' : stage === 'failed' ? 'failed' : 'pending', phase) => {
    try {
      if (!deployment || !(import.meta.env.DEV || import.meta.env.MODE === 'coti-testnet-candidate') || typeof document === 'undefined') return;
      const attribute = CANONICAL_READ_ATTRIBUTES[deployment.protocol as keyof typeof CANONICAL_READ_ATTRIBUTES];
      if (!attribute) return;
      if (isCurrent && !isCurrent()) {
        if (lastValue && CANONICAL_READ_OWNERS.get(attribute) === isCurrent &&
            document.documentElement.getAttribute(attribute) === lastValue) {
          document.documentElement.removeAttribute(attribute);
          CANONICAL_READ_OWNERS.delete(attribute);
        }
        return;
      }
      const at = Date.now();
      if (!attemptStartedAt) attemptStartedAt = at;
      if (stage !== 'rpc') activeStage = stage;
      if (method && state === 'pending' && phase === 'guard-before') ordinal++;
      const safeMethod = ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
        'eth_getLogs', 'eth_getTransactionReceipt', 'eth_call'].includes(method ?? '') ? method! : stage === 'failed' ? lastMethod : null;
      if (method) { lastMethod = safeMethod; lastPhase = phase; }
      lastValue = JSON.stringify({ operation, contractAddress: deployment.contractAddress,
        fromBlock: range?.fromBlock.toString() ?? null, toBlock: range?.toBlock.toString() ?? null,
        stage: activeStage, method: safeMethod, phase: (stage === 'failed' ? lastPhase : phase) ?? null,
        state, ordinal, attemptStartedAt, at });
      document.documentElement.setAttribute(attribute, lastValue);
      CANONICAL_READ_OWNERS.set(attribute, isCurrent);
    } catch { /* Read-only observation must not change history outcomes. */ }
  };
};

const canonicalQuantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const manifestUint = (value: bigint | number | string, label: string, maximum = UINT256_MAX): bigint => {
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

const canonicalAddress = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`);
  const normalized = getAddress(value).toLowerCase();
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const canonicalBytes32 = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) {
    throw new Error(`${label} must be non-zero bytes32 hex.`);
  }
  return value.toLowerCase();
};

const canonicalBytes = (value: unknown, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  if (!allowEmpty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const quantityHex = (value: bigint): string => `0x${value.toString(16)}`;
const eip1898 = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const capabilityBinding = (capability: TradeHistoryV2ReadCapability): CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('Trade history requires an exact current EIP-1193 read capability.');
  return binding;
};

const rpcFailureDetail = (cause: unknown): string => {
  // Do not copy provider messages, request data or response bodies into the UI.
  if (cause instanceof Error) {
    if (cause.message === 'COTI RPC read expired in queue.') return describeCotiRpcQueueExpiry(cause) ?? 'request expired in queue';
    const stop = /^COTI RPC reads stopped after HTTP (403|429)\. No automatic retry\.$/.exec(cause.message);
    if (stop) return `HTTP ${stop[1]}; reads stopped`;
  }
  if (cause && typeof cause === 'object' && 'code' in cause) {
    if (cause.code === 'TIMEOUT') return 'request timed out';
    if (cause.code === 'NETWORK_ERROR') return 'network error';
  }
  return '';
};

const rpc = async (
  binding: CapabilityBinding,
  method: string,
  params: readonly unknown[] = []
): Promise<unknown> => {
  binding.observeRead?.('rpc', method, 'pending', 'guard-before');
  await binding.assertCurrent();
  let result: unknown;
  try {
    binding.observeRead?.('rpc', method, 'pending', 'request');
    result = await binding.request({ method, params: [...params] });
  } catch (cause) {
    binding.observeRead?.('rpc', method, 'failed', 'request');
    const detail = rpcFailureDetail(cause);
    throw new Error(`Trade-history RPC ${method} failed${detail ? ` (${detail})` : ''}.`);
  }
  binding.observeRead?.('rpc', method, 'pending', 'guard-after');
  await binding.assertCurrent();
  binding.observeRead?.('rpc', method, 'completed', 'guard-after');
  return result;
};

const assertChain = async (binding: CapabilityBinding): Promise<void> => {
  if (canonicalQuantity(await rpc(binding, 'eth_chainId'), 'Trade-history chain ID') !== binding.chainId) {
    throw new Error('Trade-history read capability chain changed.');
  }
};

export const bindTradeHistoryV2ReadCapability = async ({
  provider,
  expectedChainId,
  assertCurrent,
  isObservationCurrent
}: {
  provider: ReadProvider;
  expectedChainId: bigint;
  assertCurrent: () => void | Promise<void>;
  isObservationCurrent?: () => boolean;
}): Promise<TradeHistoryV2ReadCapability> => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' ||
      typeof expectedChainId !== 'bigint' || expectedChainId <= 0n || expectedChainId > UINT256_MAX) {
    throw new Error('Cannot bind an invalid trade-history read capability.');
  }
  const binding = Object.freeze({
    request: provider.request.bind(provider),
    chainId: expectedChainId,
    assertCurrent,
    ...(isObservationCurrent ? { isObservationCurrent } : {})
  });
  await assertChain(binding);
  const capability = Object.freeze({}) as TradeHistoryV2ReadCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

/** Reads the current head through the exact provider/session captured by the opaque capability. */
export const readTradeHistoryV2LatestBlockNumber = async (
  capability: TradeHistoryV2ReadCapability,
  observationDeployment?: ObservationDeployment
): Promise<string> => {
  const current = capabilityBinding(capability);
  const observe = observeCanonicalTradeHistoryV2Read(observationDeployment, 'head', undefined, current.isObservationCurrent);
  const binding = { ...current, observeRead: observe };
  observe('head');
  try {
  await assertChain(binding);
  const latest = canonicalQuantity(
    await rpc(binding, 'eth_blockNumber'),
    'Latest trade-history block',
    UINT64_MAX
  );
  await assertChain(binding);
  observe('done');
  return latest.toString();
  } catch (error) { observe('failed'); throw error; }
};

/** Reads one canonical block through the same opaque capability used for deployment attestation. */
export const readTradeHistoryV2CanonicalBlock = async ({
  capability,
  blockNumber,
  observationDeployment
}: {
  capability: TradeHistoryV2ReadCapability;
  blockNumber: bigint;
  observationDeployment?: ObservationDeployment;
}): Promise<TradeHistoryV2CanonicalBlock | null> => {
  if (typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX) {
    throw new Error('Trade-history canonical block number is out of range.');
  }
  const current = capabilityBinding(capability);
  const observe = observeCanonicalTradeHistoryV2Read(observationDeployment, 'block',
    { fromBlock: blockNumber, toBlock: blockNumber }, current.isObservationCurrent);
  const binding = { ...current, observeRead: observe };
  observe('block');
  try {
  await assertChain(binding);
  const raw = await rpc(binding, 'eth_getBlockByNumber', [quantityHex(blockNumber), false]);
  if (raw === null) {
    await assertChain(binding);
    observe('done');
    return null;
  }
  const block = parseBlock(raw, blockNumber, 'Trade-history canonical block');
  await assertChain(binding);
  observe('done');
  return Object.freeze({ number: block.number.toString(), hash: block.hash });
  } catch (error) { observe('failed'); throw error; }
};

type RpcBlock = Readonly<{
  number: bigint;
  hash: string;
  transactions: readonly string[];
}>;

const parseBlock = (value: unknown, expectedNumber: bigint, label: string): RpcBlock => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  const number = canonicalQuantity(raw.number, `${label} number`, UINT64_MAX);
  if (number !== expectedNumber) throw new Error(`${label} returned the wrong number.`);
  if (!Array.isArray(raw.transactions)) throw new Error(`${label} transaction list is missing.`);
  return Object.freeze({
    number,
    hash: canonicalBytes32(raw.hash, `${label} hash`),
    transactions: Object.freeze(raw.transactions.map((hash, index) =>
      canonicalBytes32(hash, `${label} transaction ${index}`)
    ))
  });
};

const readBlock = async (binding: CapabilityBinding, number: bigint, label: string): Promise<RpcBlock> =>
  parseBlock(await rpc(binding, 'eth_getBlockByNumber', [quantityHex(number), false]), number, label);

const readSafeHead = async (binding: CapabilityBinding, lag: bigint): Promise<RpcBlock> => {
  await assertChain(binding);
  const latest = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Latest trade-history block', UINT64_MAX);
  if (latest < lag) throw new Error('Trade-history safe head is below genesis.');
  return readBlock(binding, latest - lag, 'Trade-history safe-head block');
};

const readCode = async (
  binding: CapabilityBinding,
  contractAddress: string,
  blockHash: string
): Promise<string> => canonicalBytes(
  await rpc(binding, 'eth_getCode', [contractAddress, eip1898(blockHash)]),
  'Trade contract runtime bytecode'
);

const readGetter = async (
  binding: CapabilityBinding,
  contractAddress: string,
  functionName: 'contractVersion' | 'supportsFeature',
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => {
  const data = METADATA_INTERFACE.encodeFunctionData(functionName, [...args]);
  const raw = canonicalBytes(
    await rpc(binding, 'eth_call', [{ to: contractAddress, data }, eip1898(blockHash)]),
    `${functionName} result`,
    true
  );
  let decoded;
  try {
    decoded = METADATA_INTERFACE.decodeFunctionResult(functionName, raw);
  } catch {
    throw new Error(`${functionName} returned malformed ABI data.`);
  }
  if (METADATA_INTERFACE.encodeFunctionResult(functionName, [...decoded]).toLowerCase() !== raw) {
    throw new Error(`${functionName} returned noncanonical ABI data.`);
  }
  if (decoded.length !== 1) throw new Error(`${functionName} returned an unexpected result shape.`);
  return decoded[0];
};

const normalizeManifest = <P extends TradeV2DeploymentProtocol>(manifest: TradeHistoryV2ManifestInput<P>) => {
  if (!manifest || !Object.prototype.hasOwnProperty.call(CONTRACT_POLICY, manifest.protocol)) {
    throw new Error('Trade-history manifest protocol is unsupported.');
  }
  const chainId = manifestUint(manifest.chainId, 'Trade-history manifest chain ID');
  if (chainId === 0n) throw new Error('Trade-history manifest chain ID cannot be zero.');
  return {
    protocol: manifest.protocol,
    chainId,
    contractAddress: canonicalAddress(manifest.contractAddress, 'Trade-history manifest address'),
    deploymentBlock: manifestUint(manifest.deploymentBlock, 'Trade-history deployment block', UINT64_MAX),
    runtimeBytecodeHash: canonicalBytes32(manifest.runtimeBytecodeHash, 'Trade-history runtime hash')
  };
};

export const attestTradeHistoryV2Deployments = async <P extends TradeV2DeploymentProtocol>({
  capability,
  manifests,
  finalityLagBlocks
}: {
  capability: TradeHistoryV2ReadCapability;
  manifests: readonly TradeHistoryV2ManifestInput<P>[];
  finalityLagBlocks: bigint;
}): Promise<readonly AttestedTradeHistoryV2Deployment<P>[]> => {
  if (!Array.isArray(manifests) || manifests.length === 0) throw new Error('Trade-history attestation requires deployment manifests.');
  const expectedDeployments = manifests.map(manifest => normalizeManifest(manifest));
  if (typeof finalityLagBlocks !== 'bigint' || finalityLagBlocks <= 0n || finalityLagBlocks > UINT64_MAX) {
    throw new Error('Trade-history finality lag must be a non-zero uint64 bigint.');
  }
  const binding = capabilityBinding(capability);
  if (expectedDeployments.some(expected => binding.chainId !== expected.chainId)) throw new Error('Trade-history manifest and capability chains differ.');
  const safeHead = await readSafeHead(binding, finalityLagBlocks);
  if (expectedDeployments.some(expected => safeHead.number < expected.deploymentBlock)) {
    throw new Error('Trade-history attestation safe head predates the deployment.');
  }
  const deployments: AttestedTradeHistoryV2Deployment<P>[] = [];
  for (const expected of expectedDeployments) {
    const runtime = await readCode(binding, expected.contractAddress, safeHead.hash);
    if (keccak256(runtime).toLowerCase() !== expected.runtimeBytecodeHash) {
      throw new Error('Trade contract runtime does not match its frozen manifest.');
    }
    const policy = CONTRACT_POLICY[expected.protocol];
    const version = await readGetter(binding, expected.contractAddress, 'contractVersion', [], safeHead.hash);
    if (version !== policy.version) throw new Error('Trade contract version does not match its protocol manifest.');
    for (const feature of policy.features) {
      const supported = await readGetter(
        binding,
        expected.contractAddress,
        'supportsFeature',
        [keccak256(toUtf8Bytes(feature))],
        safeHead.hash
      );
      if (supported !== true) throw new Error(`Trade contract is missing required feature ${feature}.`);
    }
    // Link and Counter have no feature getter; both require the exact linked runtime and version above.
    if (expected.protocol !== 'link-v2' && expected.protocol !== 'counter-v2') {
      const appWalletExecutor = await readGetter(
        binding,
        expected.contractAddress,
        'supportsFeature',
        [keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR'))],
        safeHead.hash
      );
      if (appWalletExecutor !== false) throw new Error('Trade contract unexpectedly supports an app-wallet executor.');
    }
    deployments.push(Object.freeze({
      protocol: expected.protocol,
      chainId: expected.chainId.toString(),
      contractAddress: expected.contractAddress,
      deploymentBlock: expected.deploymentBlock.toString(),
      runtimeBytecodeHash: expected.runtimeBytecodeHash,
      contractVersion: policy.version,
      requiredFeatures: Object.freeze([...policy.features]),
      finalityLagBlocks: finalityLagBlocks.toString(),
      attestationBlock: Object.freeze({ number: safeHead.number.toString(), hash: safeHead.hash })
    }) as AttestedTradeHistoryV2Deployment<P>);
  }

  // Publish no deployment until the common snapshot is canonical after all reads.
  await assertChain(binding);
  const current = await readBlock(binding, safeHead.number, 'Post-attestation trade-history block');
  if (current.hash !== safeHead.hash) throw new Error('Trade-history attestation block was reorganized.');
  await assertChain(binding);
  for (const deployment of deployments) DEPLOYMENTS.set(deployment, Object.freeze({ capability, finalityLagBlocks }));
  return Object.freeze(deployments);
};

export const attestTradeHistoryV2Deployment = async <P extends TradeV2DeploymentProtocol>({
  capability, manifest, finalityLagBlocks
}: {
  capability: TradeHistoryV2ReadCapability;
  manifest: TradeHistoryV2ManifestInput<P>;
  finalityLagBlocks: bigint;
}): Promise<AttestedTradeHistoryV2Deployment<P>> =>
  (await attestTradeHistoryV2Deployments({ capability, manifests: [manifest], finalityLagBlocks }))[0];

const deploymentBinding = (
  capability: TradeHistoryV2ReadCapability,
  deployment: AttestedTradeHistoryV2Deployment<TradeV2DeploymentProtocol>
): Readonly<{ capability: CapabilityBinding; deployment: DeploymentBinding }> => {
  const capabilityState = capabilityBinding(capability);
  const deploymentState = deployment && DEPLOYMENTS.get(deployment);
  if (!deploymentState || deploymentState.capability !== capability) {
    throw new Error('Trade-history deployment is not attested by this exact read capability.');
  }
  return { capability: capabilityState, deployment: deploymentState };
};

export const assertAttestedTradeHistoryV2Deployment = (
  deployment: AttestedTradeHistoryV2Deployment<TradeV2DeploymentProtocol>,
  expectedProtocol?: TradeV2DeploymentProtocol
): void => {
  if (!deployment || !DEPLOYMENTS.has(deployment)) {
    throw new Error('Trade-history deployment is not locally attested.');
  }
  if (expectedProtocol && deployment.protocol !== expectedProtocol) {
    throw new Error(`Trade-history deployment is not ${expectedProtocol}.`);
  }
};

/** Executes one canonical block-hash-pinned view through the attested public read capability. */
export const readAttestedTradeHistoryV2View = async ({
  capability,
  deployment,
  data,
  from
}: {
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment<TradeV2DeploymentProtocol>;
  data: string;
  from?: string;
}): Promise<string> => {
  const state = deploymentBinding(capability, deployment);
  const participantObserve = observeParticipantHistory(deployment.protocol, 'view');
  const canonicalObserve = observeCanonicalTradeHistoryV2Read(deployment, 'view', undefined, state.capability.isObservationCurrent);
  const observe = (stage: ParticipantReadStage) => { participantObserve(stage); canonicalObserve(stage); };
  observe('preflight');
  try {
  const binding = { ...state.capability, observeRead: canonicalObserve };
  const calldata = canonicalBytes(data, 'Trade-history view calldata');
  await recheckAttestationBlock(binding, deployment, 'Pre-view trade-history attestation block');
  const safeHead = await readSafeHead(binding, state.deployment.finalityLagBlocks);
  if (safeHead.number < BigInt(deployment.deploymentBlock)) {
    throw new Error('Trade-history view safe head predates deployment.');
  }
  if (keccak256(await readCode(binding, deployment.contractAddress, safeHead.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Current trade runtime no longer matches its attested deployment.');
  }
  observe('view');
  const result = canonicalBytes(
    await rpc(binding, 'eth_call', [{
      to: deployment.contractAddress,
      data: calldata,
      ...(from === undefined ? {} : { from: canonicalAddress(from, 'Trade-history view caller') })
    }, eip1898(safeHead.hash)]),
    'Trade-history view result',
    true
  );
  observe('fence');
  const current = await readBlock(binding, safeHead.number, 'Post-view trade-history safe head');
  if (current.hash !== safeHead.hash) throw new Error('Trade-history view safe head was reorganized.');
  await recheckAttestationBlock(binding, deployment, 'Post-view trade-history attestation block');
  await assertChain(binding);
  observe('done');
  return result;
  } catch (error) { observe('failed'); throw error; }
};

const normalizeRpcLog = (
  value: unknown,
  label: string,
  requireRemoved: boolean
): TradeHistoryV2RawLog => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const raw = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, 'index')) {
    throw new Error(`${label} must use raw JSON-RPC logIndex.`);
  }
  if (requireRemoved ? raw.removed !== false : raw.removed !== undefined && raw.removed !== false) {
    throw new Error(`${label} cannot be a removed-log signal.`);
  }
  if (!Array.isArray(raw.topics)) throw new Error(`${label} topics are missing.`);
  return {
    address: canonicalAddress(raw.address, `${label} address`),
    topics: raw.topics.map((topic, index) => canonicalBytes32(topic, `${label} topic ${index}`)),
    data: canonicalBytes(raw.data, `${label} data`, true),
    blockNumber: quantityHex(canonicalQuantity(raw.blockNumber, `${label} block number`, UINT64_MAX)),
    blockHash: canonicalBytes32(raw.blockHash, `${label} block hash`),
    transactionHash: canonicalBytes32(raw.transactionHash, `${label} transaction hash`),
    transactionIndex: quantityHex(canonicalQuantity(raw.transactionIndex, `${label} transaction index`)),
    logIndex: quantityHex(canonicalQuantity(raw.logIndex, `${label} log index`)),
    removed: false
  };
};

const rawLogsEqual = (left: TradeHistoryV2RawLog, right: TradeHistoryV2RawLog): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
};

export const assertCanonicalTradeHistoryV2LogRange = (
  page: CanonicalTradeHistoryV2LogRange
): void => {
  if (!page || !CANONICAL_PAGES.has(page)) {
    throw new Error('Trade-history range is not a provider-owned canonical page.');
  }
};

const eventTopics = (protocol: TradeHistoryV2EventProtocol, runtimeBytecodeHash: string): readonly string[] => EVENT_NAMES[protocol].map((name) => {
  const event = getTradeHistoryV2EventInterface(protocol, runtimeBytecodeHash).getEvent(name);
  if (!event) throw new Error(`Trade-history ABI is missing ${name}.`);
  return event.topicHash.toLowerCase();
});

const recheckAttestationBlock = async (
  binding: CapabilityBinding,
  deployment: AttestedTradeHistoryV2Deployment<TradeV2DeploymentProtocol>,
  label: string
): Promise<void> => {
  const number = manifestUint(deployment.attestationBlock.number, `${label} number`, UINT64_MAX);
  const block = await readBlock(binding, number, label);
  if (block.hash !== deployment.attestationBlock.hash) {
    throw new Error('Trade-history deployment attestation block was reorganized.');
  }
};

/** Shared receipt/inclusion boundary for the existing history protocols and Link discovery. */
/** The current participant indexes retain terminal orders, including Direct counters. */
export const readTradeHistoryV2WalletIndex = async ({ capability, deployment, ownerAddress }: {
  capability: TradeHistoryV2ReadCapability; deployment: AttestedTradeHistoryV2Deployment; ownerAddress: string;
}): Promise<TradeHistoryV2WalletIndex> => {
  if (!(deployment.protocol in WALLET_INDEX_METHODS)) throw new Error('This protocol has no admitted wallet history index.');
  const owner = canonicalAddress(ownerAddress, 'Wallet history owner');
  const state = deploymentBinding(capability, deployment);
  const binding = state.capability;
  await recheckAttestationBlock(binding, deployment, 'Pre-index attestation block');
  const head = await readSafeHead(binding, state.deployment.finalityLagBlocks);
  if (head.number < BigInt(deployment.deploymentBlock)) throw new Error('Wallet index safe head predates deployment.');
  if (keccak256(await readCode(binding, deployment.contractAddress, head.hash)).toLowerCase() !== deployment.runtimeBytecodeHash) {
    throw new Error('Current trade runtime no longer matches its attested deployment.');
  }
  const ids = new Set<string>();
  let complete = true;
  for (const name of WALLET_INDEX_METHODS[deployment.protocol as keyof typeof WALLET_INDEX_METHODS]) {
    const seen = new Set<string>();
    const raw = canonicalBytes(await rpc(binding, 'eth_call', [{ to: deployment.contractAddress,
      data: WALLET_INDEX_INTERFACE.encodeFunctionData(name, [owner, 0n, 100n]) }, eip1898(head.hash)]), 'Wallet index result');
    const [page, next] = WALLET_INDEX_INTERFACE.decodeFunctionResult(name, raw) as unknown as [bigint[], bigint];
    if (page.length > 100 || (next !== 0n && (page.length === 0 || next !== BigInt(page.length)))) {
      throw new Error('Wallet history index cursor is invalid.');
    }
    for (const id of page) {
      if (id === 0n || seen.has(id.toString())) throw new Error('Wallet history index contains an invalid or duplicate ID.');
      seen.add(id.toString()); ids.add(id.toString());
    }
    complete &&= next === 0n;
  }
  const after = await readBlock(binding, head.number, 'Post-index safe head');
  if (after.hash !== head.hash) throw new Error('Wallet history index safe head was reorganized.');
  const latest = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Post-index latest block', UINT64_MAX);
  if (latest < head.number + state.deployment.finalityLagBlocks) throw new Error('Wallet history index lost finality.');
  await recheckAttestationBlock(binding, deployment, 'Post-index attestation block');
  await assertChain(binding);
  const index = Object.freeze({ ownerAddress: owner, complete,
    orderIds: Object.freeze([...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)),
    block: Object.freeze({ number: head.number.toString(), hash: head.hash }) }) as TradeHistoryV2WalletIndex;
  WALLET_INDEXES.set(index, { capability, deployment });
  return index;
};

type RawLogRangeInput<P extends TradeV2DeploymentProtocol> = {
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment<P>;
  fromBlock: bigint;
  toBlock: bigint;
  topics: LogTopics;
  participantRange?: boolean;
};

const readCanonicalTradeV2RawLogRangeInternal = async <P extends TradeV2DeploymentProtocol>({
  capability,
  deployment,
  fromBlock,
  toBlock,
  topics,
  counterTakerTopics,
  walletIndex,
  participantRange = false,
  canonicalHistoryRange = false
}: RawLogRangeInput<P> & { canonicalHistoryRange?: boolean; counterTakerTopics?: LogTopics;
  walletIndex?: TradeHistoryV2WalletIndex }): Promise<CanonicalTradeV2RawLogRange<P>> => {
  if (walletIndex) {
    assertTradeHistoryV2WalletIndex(walletIndex, capability, deployment as AttestedTradeHistoryV2Deployment);
    if (!canonicalHistoryRange || toBlock > BigInt(walletIndex.block.number)) throw new Error('History range exceeds its verified wallet index.');
  }
  if (typeof participantRange !== 'boolean' || participantRange && !['link-v2', 'counter-v2'].includes(deployment.protocol)) {
    throw new Error('Wide participant history is limited to Link and Counter readers.');
  }
  const maximumBlocks = canonicalHistoryRange ? TRADE_HISTORY_V2_MAX_CANONICAL_LOG_RANGE_BLOCKS
    : participantRange ? TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS : TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS;
  if (typeof fromBlock !== 'bigint' || typeof toBlock !== 'bigint' ||
      fromBlock < 0n || toBlock < fromBlock || toBlock > UINT64_MAX ||
      toBlock - fromBlock + 1n > maximumBlocks) {
    throw new Error('Trade-history range must be an ordered bounded uint64 bigint range.');
  }
  // An old order can receive a new fill; an incomplete index cannot filter recent events.
  const requestedFilters: LogTopics[] = walletIndex?.complete
    ? Array.from({ length: Math.ceil(walletIndex.orderIds.length / 64) }, (_, page) =>
      [topics[0], walletIndex.orderIds.slice(page * 64, (page + 1) * 64).map(id => `0x${BigInt(id).toString(16).padStart(64, '0')}`)])
    : counterTakerTopics === undefined ? [topics] : [topics, counterTakerTopics];
  const filters = requestedFilters.map(topics => {
    if (!Array.isArray(topics) || topics.length === 0 || topics.length > 4) throw new Error('Invalid bounded trade log topics.');
    return topics.map((topic, index) => topic === null ? null : Array.isArray(topic)
      ? topic.length > 0 && topic.length <= 64 ? topic.map(v => canonicalBytes32(v, `Trade log topic ${index}`)) : (() => { throw new Error('Trade log topic alternatives must contain 1 to 64 values.'); })()
      : canonicalBytes32(topic, `Trade log topic ${index}`));
  });
  const state = deploymentBinding(capability, deployment);
  const canonicalObserve = observeCanonicalTradeHistoryV2Read(canonicalHistoryRange ? deployment : undefined,
    'range', { fromBlock, toBlock }, state.capability.isObservationCurrent);
  const binding = { ...state.capability, observeRead: canonicalObserve };
  const participantObserve = observeParticipantHistory(deployment.protocol, 'range', participantRange);
  const observe = (stage: ParticipantReadStage) => { participantObserve(stage); canonicalObserve(stage); };
  observe('preflight');
  try {
  await recheckAttestationBlock(binding, deployment, 'Pre-range trade-history attestation block');
  const safeHead = await readSafeHead(binding, state.deployment.finalityLagBlocks);
  if (fromBlock < BigInt(deployment.deploymentBlock)) throw new Error('Trade-history range predates deployment.');
  if (toBlock > safeHead.number) throw new Error('Trade-history range extends above the safe head.');
  if (keccak256(await readCode(binding, deployment.contractAddress, safeHead.hash)).toLowerCase() !==
      deployment.runtimeBytecodeHash) {
    throw new Error('Current trade runtime no longer matches its attested deployment.');
  }

  const checkedBlocks = new Map<string, RpcBlock>();
  const checkedBlock = async (number: bigint, label: string): Promise<RpcBlock> => {
    const key = number.toString();
    const cached = checkedBlocks.get(key);
    if (cached) return cached;
    const block = await readBlock(binding, number, label);
    checkedBlocks.set(key, block);
    return block;
  };
  const first = await checkedBlock(fromBlock, 'Trade-history range start block');
  const last = await checkedBlock(toBlock, 'Trade-history range end block');
  if (walletIndex && (await checkedBlock(BigInt(walletIndex.block.number), 'Wallet index block')).hash !== walletIndex.block.hash) {
    throw new Error('Wallet history index block was reorganized.');
  }
  const physical = new Map<string, TradeHistoryV2RawLog>();
  const verified: TradeHistoryV2RawLog[] = [], receipts = new Map<string, Record<string, unknown>>(), receiptLogs: Record<string, readonly TradeHistoryV2RawLog[]> = {};
  for (const filter of filters) {
    observe('logs');
    const logs = await rpc(binding, 'eth_getLogs', [{
      address: deployment.contractAddress,
      fromBlock: quantityHex(fromBlock),
      toBlock: quantityHex(toBlock),
      topics: filter
    }]);
    if (!Array.isArray(logs)) throw new Error('Trade-history range query did not return a log array.');
    if (logs.length > TRADE_HISTORY_V2_MAX_LOGS_PER_RANGE) {
      throw new TradeHistoryV2RangeLimitError();
    }

    observe('receipts');
    const filterPhysical = new Set<string>();
    for (let position = 0; position < logs.length; position += 1) {
      const raw = normalizeRpcLog(logs[position], `Trade-history log ${position}`, true);
      if (raw.address !== deployment.contractAddress) throw new Error('Provider returned a trade log from another contract.');
      const blockNumber = BigInt(raw.blockNumber);
      if (blockNumber < fromBlock || blockNumber > toBlock) throw new Error('Provider returned a trade log outside the range.');
      const identity = `${raw.blockHash}:${raw.transactionHash}:${raw.logIndex}`;
      if (filterPhysical.has(identity)) throw new Error('Provider returned a duplicate physical trade log.');
      filterPhysical.add(identity);
      if (filter.some((expected, index) => expected !== null && (Array.isArray(expected) ? !expected.includes(raw.topics[index]) : expected !== raw.topics[index]))) {
        throw new Error('Provider returned a trade log outside the requested topics.');
      }
      const previous = physical.get(identity);
      if (previous) {
        if (!rawLogsEqual(previous, raw)) throw new Error('Provider returned conflicting physical trade logs.');
        continue;
      }
      physical.set(identity, raw);
      const block = await checkedBlock(blockNumber, 'Canonical trade-history event block');
      if (block.hash !== raw.blockHash) throw new Error('Trade-history log belongs to an orphan block.');
      const transactionIndex = Number(BigInt(raw.transactionIndex));
      if (transactionIndex >= block.transactions.length ||
          block.transactions[transactionIndex] !== raw.transactionHash) {
        throw new Error('Trade-history transaction slot is not canonical.');
      }
      const receiptValue = receipts.get(raw.transactionHash) ?? await rpc(binding, 'eth_getTransactionReceipt', [raw.transactionHash]);
      if (!receiptValue || typeof receiptValue !== 'object') throw new Error('Trade-history receipt is missing.');
      const receipt = receiptValue as Record<string, unknown>;
      receipts.set(raw.transactionHash, receipt);
      if (
        canonicalQuantity(receipt.status, 'Trade-history receipt status') !== 1n ||
        canonicalQuantity(receipt.blockNumber, 'Trade-history receipt block number', UINT64_MAX) !== blockNumber ||
        canonicalBytes32(receipt.blockHash, 'Trade-history receipt block hash') !== raw.blockHash ||
        canonicalBytes32(receipt.transactionHash, 'Trade-history receipt transaction hash') !== raw.transactionHash ||
        canonicalQuantity(receipt.transactionIndex, 'Trade-history receipt transaction index') !== BigInt(raw.transactionIndex) ||
        !Array.isArray(receipt.logs)
      ) {
        throw new Error('Trade-history receipt is unsuccessful or has noncanonical metadata.');
      }
      if (!receiptLogs[raw.transactionHash]) {
        const normalized = receipt.logs.map((candidate, index) => normalizeRpcLog(candidate, `Trade-history receipt log ${index}`, false));
        if (new Set(normalized.map(log => log.logIndex)).size !== normalized.length || normalized.some(log => log.transactionHash !== raw.transactionHash ||
            log.blockHash !== raw.blockHash || log.blockNumber !== raw.blockNumber || log.transactionIndex !== raw.transactionIndex)) {
          throw new Error('Trade-history receipt contains inconsistent log origins.');
        }
        receiptLogs[raw.transactionHash] = deepFreeze(normalized);
      }
      const matching = receiptLogs[raw.transactionHash].filter(candidate => candidate.logIndex === raw.logIndex);
      if (matching.length !== 1 || !rawLogsEqual(raw, matching[0])) {
        throw new Error('Trade-history log does not exactly match one successful receipt log.');
      }
      verified.push(deepFreeze(raw));
    }
  }

  observe('fence');
  await assertChain(binding);
  const latestAfter = canonicalQuantity(await rpc(binding, 'eth_blockNumber'), 'Post-range latest block', UINT64_MAX);
  if (latestAfter < safeHead.number + state.deployment.finalityLagBlocks) {
    throw new Error('Trade-history range lost its finality depth.');
  }
  const safeAfter = await readBlock(binding, safeHead.number, 'Post-range trade-history safe head');
  if (safeAfter.hash !== safeHead.hash) throw new Error('Trade-history safe head was reorganized.');
  for (const block of checkedBlocks.values()) {
    const after = await readBlock(binding, block.number, 'Rechecked trade-history block');
    if (after.hash !== block.hash) throw new Error('A trade-history block changed during verification.');
  }
  await recheckAttestationBlock(binding, deployment, 'Post-range trade-history attestation block');
  await assertChain(binding);

  verified.sort((leftLog, rightLog) => {
    return BigInt(leftLog.blockNumber) < BigInt(rightLog.blockNumber) ? -1
      : BigInt(leftLog.blockNumber) > BigInt(rightLog.blockNumber) ? 1
        : BigInt(leftLog.transactionIndex) !== BigInt(rightLog.transactionIndex)
          ? BigInt(leftLog.transactionIndex) < BigInt(rightLog.transactionIndex) ? -1 : 1
          : BigInt(leftLog.logIndex) < BigInt(rightLog.logIndex) ? -1 : BigInt(leftLog.logIndex) > BigInt(rightLog.logIndex) ? 1 : 0;
  });
  const result = Object.freeze({
    scope: Object.freeze({
      protocol: deployment.protocol,
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
    logs: Object.freeze(verified), receiptLogs: Object.freeze(receiptLogs)
  });
  observe('done');
  return result;
  } catch (error) { observe('failed'); throw error; }
};

// Keep arbitrary-topic raw reads on their existing narrow/participant boundary.
export const readCanonicalTradeV2RawLogRange = <P extends TradeV2DeploymentProtocol>(
  input: RawLogRangeInput<P>
): Promise<CanonicalTradeV2RawLogRange<P>> => readCanonicalTradeV2RawLogRangeInternal({
  capability: input.capability, deployment: input.deployment, fromBlock: input.fromBlock,
  toBlock: input.toBlock, topics: input.topics, participantRange: input.participantRange
});

/** Verifies both fixed Counter participant filters at one bounded canonical snapshot. */
export const readCanonicalCounterTradeV2ParticipantRange = async (input: Omit<RawLogRangeInput<'counter-v2'>, 'topics' | 'participantRange'> & {
  ownerAddress: string;
}): Promise<CanonicalTradeV2RawLogRange<'counter-v2'>> => {
  if (input.deployment.protocol !== 'counter-v2') throw new Error('Counter participant history requires a Counter deployment.');
  const owner = canonicalAddress(input.ownerAddress, 'Counter participant address');
  const ownerTopic = `0x${owner.slice(2).padStart(64, '0')}`;
  const opened = new Interface(COUNTER_TRADE_V2_ABI).getEvent('CounterOpened')!.topicHash;
  return readCanonicalTradeV2RawLogRangeInternal({ capability: input.capability, deployment: input.deployment,
    fromBlock: input.fromBlock, toBlock: input.toBlock, participantRange: true,
    topics: [opened, null, ownerTopic], counterTakerTopics: [opened, null, null, ownerTopic] });
};

export const readCanonicalTradeHistoryV2LogRange = async (input: {
  capability: TradeHistoryV2ReadCapability; deployment: AttestedTradeHistoryV2Deployment; fromBlock: bigint; toBlock: bigint;
  walletIndex?: TradeHistoryV2WalletIndex;
}): Promise<CanonicalTradeHistoryV2LogRange> => {
  const { logs, receiptLogs, ...raw } = await readCanonicalTradeV2RawLogRangeInternal({ ...input, canonicalHistoryRange: true,
    topics: [eventTopics(input.deployment.protocol, input.deployment.runtimeBytecodeHash)] });
  void receiptLogs;
  const events = logs.map(log => {
    const event = parseTradeHistoryV2Log({ protocol: input.deployment.protocol, chainId: input.deployment.chainId,
      contractAddress: input.deployment.contractAddress, runtimeBytecodeHash: input.deployment.runtimeBytecodeHash, log });
    if (!event) throw new Error('Provider returned a log outside the attested trade-history ABI.');
    return deepFreeze(event);
  });
  const page = Object.freeze({ ...raw, events: Object.freeze(events) }) as CanonicalTradeHistoryV2LogRange;
  CANONICAL_PAGES.add(page);
  return page;
};
