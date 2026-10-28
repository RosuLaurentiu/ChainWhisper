import { Interface, getAddress } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance } from './appChain';
import { loadCotiEthersModule } from './appShared/core';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import {
  assertAttestedTradeHistoryV2Deployment,
  type AttestedTradeHistoryV2Deployment
} from './tradeHistoryV2Chain';
import {
  assertOwnerTradeV2CapabilityCurrent,
  assertOwnerTradeV2CapabilitySnapshotCurrent,
  getOwnerTradeV2CapabilityBinding,
  getOwnerTradeV2ReadRunner,
  waitForOwnerTradeV2Receipt,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

export const RECURRING_TRADE_V2_ACTION_ABI = [
  'function createOrder((uint8 assetType,address token) baseAsset,(uint8 assetType,address token) quoteAsset,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 initialBaseInventory,uint256 initialQuoteInventory,uint64 expiresAt) payable returns (uint256 orderId)',
  'function execute(uint256 orderId,uint8 side,uint64 expectedRevision,uint256 maxInputAmount,uint256 minOutputAmount) payable returns ((uint64 revision,uint64 nextExecutionIndex,uint256 inputAmount,uint256 outputAmount,uint256 baseInventoryAfter,uint256 quoteInventoryAfter,bool clippedToInventory) quote)',
  'function editOrder(uint256 orderId,uint64 expectedRevision,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 baseAdded,uint256 quoteAdded,uint256 baseRemoved,uint256 quoteRemoved,uint64 expiresAt) payable',
  'function pauseOrder(uint256 orderId,uint64 expectedRevision)',
  'function resumeOrder(uint256 orderId,uint64 expectedRevision)',
  'function cancelOrder(uint256 orderId,uint64 expectedRevision)',
  'function reclaimExpiredOrder(uint256 orderId)',
  'function withdrawNativeCredit()',
  'function quoteExecutionFor(uint256 orderId,address filler,uint8 side,uint256 maxInputAmount) view returns ((uint64 revision,uint64 nextExecutionIndex,uint256 inputAmount,uint256 outputAmount,uint256 baseInventoryAfter,uint256 quoteInventoryAfter,bool clippedToInventory) quote)',
  'function getOrderView(uint256 orderId) view returns (((address maker,uint8 status,(uint8 assetType,address token) baseAsset,(uint8 assetType,address token) quoteAsset,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 expiresAt,uint64 revision,uint64 executionCount,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash) order,(uint256 baseAmount,uint256 quoteAmount) inventory,uint8 effectiveStatus,bytes32 pairKey) orderView)',
  'function getRecentOrderIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOrderIdsForMaker(address maker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOrderIdsForFiller(address filler,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getActiveOrderIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'event RecurringOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,uint8 baseAssetType,address baseToken,uint8 quoteAssetType,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 baseInventory,uint256 quoteInventory,uint64 createdAt,uint64 expiresAt,uint64 revision)',
  'event RecurringOrderEdited(uint256 indexed orderId,address indexed maker,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 baseAdded,uint256 quoteAdded,uint256 baseRemoved,uint256 quoteRemoved,uint256 baseInventory,uint256 quoteInventory,uint64 expiresAt,uint64 nextRevision)',
  'event RecurringOrderExecuted(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 side,uint64 executionIndex,uint64 nextRevision,uint256 baseAmount,uint256 quoteAmount,uint256 baseInventory,uint256 quoteInventory)',
  'event RecurringOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint64 nextRevision)',
  'event NativeCreditWithdrawn(address indexed recipient,uint256 amount)'
] as const;

const ACTIONS = new Interface(RECURRING_TRADE_V2_ACTION_ABI);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type RecurringTradeV2Asset = Readonly<{
  assetType: 'native' | 'erc20';
  token?: string;
}>;

export type RecurringTradeV2SideTerms = Readonly<{
  baseAmount: bigint | number | string;
  quoteAmount: bigint | number | string;
}>;

export type RecurringTradeV2Action =
  | Readonly<{
      kind: 'create';
      baseAsset: RecurringTradeV2Asset;
      quoteAsset: RecurringTradeV2Asset;
      buyTerms: RecurringTradeV2SideTerms;
      sellTerms: RecurringTradeV2SideTerms;
      initialBaseInventory: bigint | number | string;
      initialQuoteInventory: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'execute';
      orderId: bigint | number | string;
      side: 'buy' | 'sell';
      expectedRevision: bigint | number | string;
      maxInputAmount: bigint | number | string;
      minOutputAmount: bigint | number | string;
    }>
  | Readonly<{
      kind: 'edit';
      orderId: bigint | number | string;
      expectedRevision: bigint | number | string;
      buyTerms: RecurringTradeV2SideTerms;
      sellTerms: RecurringTradeV2SideTerms;
      baseAdded: bigint | number | string;
      quoteAdded: bigint | number | string;
      baseRemoved: bigint | number | string;
      quoteRemoved: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'pause' | 'resume' | 'cancel';
      orderId: bigint | number | string;
      expectedRevision: bigint | number | string;
    }>
  | Readonly<{ kind: 'reclaim-expired'; orderId: bigint | number | string }>
  | Readonly<{ kind: 'withdraw-native-credit' }>;

export type RecurringTradeV2OrderView = Readonly<{
  orderId: string;
  maker: string;
  status: 'active' | 'paused' | 'cancelled' | 'expired';
  baseAsset: Readonly<{ assetType: 'native' | 'erc20'; token: string }>;
  quoteAsset: Readonly<{ assetType: 'native' | 'erc20'; token: string }>;
  buyTerms: Readonly<{ baseAmount: string; quoteAmount: string }>;
  sellTerms: Readonly<{ baseAmount: string; quoteAmount: string }>;
  baseInventory: string;
  quoteInventory: string;
  createdAt: string;
  expiresAt: string;
  revision: string;
  executionCount: string;
  pairKey: string;
}>;

export type RecurringTradeV2Quote = Readonly<{
  revision: string;
  nextExecutionIndex: string;
  inputAmount: string;
  outputAmount: string;
  baseInventoryAfter: string;
  quoteInventoryAfter: string;
  clippedToInventory: boolean;
}>;

export type RecurringTradeV2OrderIdPage = Readonly<{
  orderIds: readonly string[];
  nextOffset: string;
}>;

type Transaction = Readonly<{
  hash: string;
  chainId: bigint;
  from: string;
  to: string;
  data: string;
  value: bigint;
  wait: () => Promise<unknown>;
}>;

declare const RECURRING_SUBMISSION_BRAND: unique symbol;
export type RecurringTradeV2Submission = Readonly<{
  action: RecurringTradeV2Action['kind'];
  submittedTransactionHash: string;
  transaction: Transaction;
  readonly [RECURRING_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedRecurringTradeV2Action = Readonly<{
  action: RecurringTradeV2Action['kind'];
  orderId?: string;
  transactionHash: string;
  submittedTransactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

type SubmissionBinding = Readonly<{
  deployment: AttestedTradeHistoryV2Deployment;
  ownerAddress: string;
  expectedEvent:
    | 'RecurringOrderOpened'
    | 'RecurringOrderEdited'
    | 'RecurringOrderExecuted'
    | 'RecurringOrderStatusChanged'
    | 'NativeCreditWithdrawn';
  expectedOrderId?: bigint;
  expectedStatus?: bigint;
  expectedSide?: bigint;
  expectedNextRevision?: bigint;
}>;

const SUBMISSIONS = new WeakMap<object, SubmissionBinding>();

const uint = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  let parsed: bigint;
  try { parsed = BigInt(value as bigint); } catch { throw new Error(`${label} must be an unsigned integer.`); }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try { normalized = getAddress(value.trim()).toLowerCase(); } catch { throw new Error(`${label} is invalid.`); }
  if (!allowZero && normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be bytes32.`);
  return value.toLowerCase();
};

const hexBytes = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${label} must be hex bytes.`);
  return value.toLowerCase();
};

const tuple = (value: unknown, label: string): Record<string | number, unknown> => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  return value as Record<string | number, unknown>;
};

const assertScope = async (
  capability: OwnerTradeV2MetaMaskCapability,
  deployment: AttestedTradeHistoryV2Deployment
) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'recurring-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Recurring OTC V2 capability and deployment chains differ.');
  }
  return binding;
};

const normalizeAsset = (value: RecurringTradeV2Asset, label: string) => Object.freeze({
  assetType: value.assetType === 'native' ? 0 : 1,
  token: value.assetType === 'native' ? ZERO_ADDRESS : address(value.token, `${label} token`)
});

const normalizeTerms = (value: RecurringTradeV2SideTerms, label: string) => {
  const baseAmount = uint(value.baseAmount, `${label} base amount`, UINT128_MAX);
  const quoteAmount = uint(value.quoteAmount, `${label} quote amount`, UINT128_MAX);
  if (baseAmount === 0n || quoteAmount === 0n) throw new Error(`${label} amounts must be positive.`);
  return Object.freeze({ baseAmount, quoteAmount });
};

const normalizeExpiry = (value: unknown): bigint => {
  const expiresAt = uint(value, 'Recurring order expiry', UINT64_MAX);
  if (expiresAt !== 0n && expiresAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error('Recurring order expiry must be in the future or zero.');
  }
  return expiresAt;
};

const sideValue = (side: 'buy' | 'sell'): bigint => side === 'buy' ? 0n : 1n;

const parseAsset = (value: unknown, label: string) => {
  const item = tuple(value, label);
  const type = uint(item.assetType ?? item[0], `${label} type`, 1n);
  return Object.freeze({
    assetType: type === 0n ? 'native' as const : 'erc20' as const,
    token: address(item.token ?? item[1], `${label} token`, type === 0n)
  });
};

const parseTerms = (value: unknown, label: string) => {
  const item = tuple(value, label);
  return Object.freeze({
    baseAmount: uint(item.baseAmount ?? item[0], `${label} base amount`).toString(),
    quoteAmount: uint(item.quoteAmount ?? item[1], `${label} quote amount`).toString()
  });
};

const parseQuote = (value: unknown): RecurringTradeV2Quote => {
  const quote = tuple(value, 'Recurring execution quote');
  return Object.freeze({
    revision: uint(quote.revision ?? quote[0], 'Recurring quote revision', UINT64_MAX).toString(),
    nextExecutionIndex: uint(quote.nextExecutionIndex ?? quote[1], 'Recurring quote execution index', UINT64_MAX).toString(),
    inputAmount: uint(quote.inputAmount ?? quote[2], 'Recurring quote input').toString(),
    outputAmount: uint(quote.outputAmount ?? quote[3], 'Recurring quote output').toString(),
    baseInventoryAfter: uint(quote.baseInventoryAfter ?? quote[4], 'Recurring quote base inventory').toString(),
    quoteInventoryAfter: uint(quote.quoteInventoryAfter ?? quote[5], 'Recurring quote quote inventory').toString(),
    clippedToInventory: (quote.clippedToInventory ?? quote[6]) === true
  });
};

export const readRecurringTradeV2OrderView = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
}): Promise<RecurringTradeV2OrderView> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Recurring order ID');
  if (id === 0n) throw new Error('Recurring order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    RECURRING_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const view = tuple(await contract.getOrderView(id), 'Recurring order view');
  const order = tuple(view.order ?? view[0], 'Recurring order');
  const inventory = tuple(view.inventory ?? view[1], 'Recurring inventory');
  const status = uint(view.effectiveStatus ?? view[2], 'Recurring order status', 4n);
  if (status === 0n) throw new Error('Recurring order does not exist.');
  const statuses = ['none', 'active', 'paused', 'cancelled', 'expired'] as const;
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(),
    maker: address(order.maker ?? order[0], 'Recurring maker'),
    status: statuses[Number(status)] as RecurringTradeV2OrderView['status'],
    baseAsset: parseAsset(order.baseAsset ?? order[2], 'Recurring base asset'),
    quoteAsset: parseAsset(order.quoteAsset ?? order[3], 'Recurring quote asset'),
    buyTerms: parseTerms(order.buyTerms ?? order[4], 'Recurring buy terms'),
    sellTerms: parseTerms(order.sellTerms ?? order[5], 'Recurring sell terms'),
    baseInventory: uint(inventory.baseAmount ?? inventory[0], 'Recurring base inventory').toString(),
    quoteInventory: uint(inventory.quoteAmount ?? inventory[1], 'Recurring quote inventory').toString(),
    createdAt: uint(order.createdAt ?? order[6], 'Recurring creation time', UINT64_MAX).toString(),
    expiresAt: uint(order.expiresAt ?? order[7], 'Recurring expiry', UINT64_MAX).toString(),
    revision: uint(order.revision ?? order[8], 'Recurring revision', UINT64_MAX).toString(),
    executionCount: uint(order.executionCount ?? order[9], 'Recurring execution count', UINT64_MAX).toString(),
    pairKey: bytes32(view.pairKey ?? view[3], 'Recurring pair key')
  });
};

export const readRecurringTradeV2OrderIds = async ({
  capability,
  deployment,
  scope,
  offset = 0n,
  limit = 50n
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'recent' | 'maker' | 'filler' | 'active';
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<RecurringTradeV2OrderIdPage> => {
  const binding = await assertScope(capability, deployment);
  const pageOffset = uint(offset, 'Recurring order offset');
  const pageLimit = uint(limit, 'Recurring order limit');
  if (pageLimit > 100n) throw new Error('Recurring order limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    RECURRING_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const method = scope === 'recent'
    ? 'getRecentOrderIds'
    : scope === 'maker'
      ? 'getOrderIdsForMaker'
      : scope === 'filler'
        ? 'getOrderIdsForFiller'
        : 'getActiveOrderIds';
  const raw = scope === 'maker' || scope === 'filler'
    ? await contract[method](binding.ownerAddress, pageOffset, pageLimit)
    : await contract[method](pageOffset, pageLimit);
  const page = tuple(raw, 'Recurring order ID page');
  const rawIds = page.ids ?? page[0];
  if (!Array.isArray(rawIds)) throw new Error('Recurring order ID page is malformed.');
  const orderIds = rawIds.map((value, index) => {
    const id = uint(value, `Recurring order ID ${index + 1}`);
    if (id === 0n) throw new Error('Recurring order ID page contains zero.');
    return id.toString();
  });
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderIds: Object.freeze(orderIds),
    nextOffset: uint(page.nextOffset ?? page[1], 'Recurring next offset').toString()
  });
};

export const quoteRecurringTradeV2Execution = async ({
  capability,
  deployment,
  orderId,
  side,
  maxInputAmount
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
  side: 'buy' | 'sell';
  maxInputAmount: bigint | number | string;
}): Promise<RecurringTradeV2Quote> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Recurring order ID');
  const maximum = uint(maxInputAmount, 'Recurring maximum input', UINT128_MAX);
  if (id === 0n || maximum === 0n) throw new Error('Recurring execution ID and maximum input must be positive.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    RECURRING_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const result = parseQuote(await contract.quoteExecutionFor(id, binding.ownerAddress, sideValue(side), maximum));
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return result;
};

type Prepared = Readonly<{
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  expectedEvent: SubmissionBinding['expectedEvent'];
  expectedOrderId?: bigint;
  expectedStatus?: bigint;
  expectedSide?: bigint;
  expectedNextRevision?: bigint;
  approvals: readonly Readonly<{ asset: RecurringTradeV2Asset; amount: bigint }>[];
}>;

const prepare = async (
  action: RecurringTradeV2Action,
  capability: OwnerTradeV2MetaMaskCapability,
  deployment: AttestedTradeHistoryV2Deployment
): Promise<Prepared> => {
  if (action.kind === 'withdraw-native-credit') {
    return Object.freeze({
      functionName: 'withdrawNativeCredit', args: [], value: 0n,
      expectedEvent: 'NativeCreditWithdrawn', approvals: []
    });
  }
  if (action.kind === 'reclaim-expired') {
    const orderId = uint(action.orderId, 'Recurring order ID');
    if (orderId === 0n) throw new Error('Recurring order ID cannot be zero.');
    return Object.freeze({
      functionName: 'reclaimExpiredOrder', args: [orderId], value: 0n,
      expectedEvent: 'RecurringOrderStatusChanged', expectedOrderId: orderId,
      expectedStatus: 4n, approvals: []
    });
  }
  if (action.kind === 'pause' || action.kind === 'resume' || action.kind === 'cancel') {
    const orderId = uint(action.orderId, 'Recurring order ID');
    const revision = uint(action.expectedRevision, 'Recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Recurring order ID and revision must be positive.');
    const functions = { pause: 'pauseOrder', resume: 'resumeOrder', cancel: 'cancelOrder' } as const;
    const statuses = { pause: 2n, resume: 1n, cancel: 3n } as const;
    return Object.freeze({
      functionName: functions[action.kind], args: [orderId, revision], value: 0n,
      expectedEvent: 'RecurringOrderStatusChanged', expectedOrderId: orderId,
      expectedStatus: statuses[action.kind], expectedNextRevision: revision + 1n, approvals: []
    });
  }
  if (action.kind === 'execute') {
    const orderId = uint(action.orderId, 'Recurring order ID');
    const revision = uint(action.expectedRevision, 'Recurring expected revision', UINT64_MAX);
    const maximum = uint(action.maxInputAmount, 'Recurring maximum input', UINT128_MAX);
    const minimum = uint(action.minOutputAmount, 'Recurring minimum output', UINT128_MAX);
    if (orderId === 0n || revision === 0n || maximum === 0n || minimum === 0n) {
      throw new Error('Recurring execution values must be positive.');
    }
    const [view, quote] = await Promise.all([
      readRecurringTradeV2OrderView({ capability, deployment, orderId }),
      quoteRecurringTradeV2Execution({ capability, deployment, orderId, side: action.side, maxInputAmount: maximum })
    ]);
    if (view.status !== 'active' || view.revision !== revision.toString() || quote.revision !== revision.toString()) {
      throw new Error('Recurring execution review is stale.');
    }
    if (BigInt(quote.outputAmount) < minimum) throw new Error('Recurring execution is below the selected minimum output.');
    const inputAsset = action.side === 'buy' ? view.baseAsset : view.quoteAsset;
    const inputAmount = BigInt(quote.inputAmount);
    return Object.freeze({
      functionName: 'execute', args: [orderId, sideValue(action.side), revision, maximum, minimum],
      value: inputAsset.assetType === 'native' ? inputAmount : 0n,
      expectedEvent: 'RecurringOrderExecuted', expectedOrderId: orderId,
      expectedSide: sideValue(action.side), expectedNextRevision: revision + 1n,
      approvals: inputAsset.assetType === 'erc20' ? [{ asset: inputAsset, amount: maximum }] : []
    });
  }
  if (action.kind === 'edit') {
    const orderId = uint(action.orderId, 'Recurring order ID');
    const revision = uint(action.expectedRevision, 'Recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Recurring order ID and revision must be positive.');
    const view = await readRecurringTradeV2OrderView({ capability, deployment, orderId });
    if ((view.status !== 'active' && view.status !== 'paused') || view.revision !== revision.toString()) {
      throw new Error('Recurring edit review is stale.');
    }
    const baseAdded = uint(action.baseAdded, 'Recurring base added', UINT128_MAX);
    const quoteAdded = uint(action.quoteAdded, 'Recurring quote added', UINT128_MAX);
    const baseRemoved = uint(action.baseRemoved, 'Recurring base removed', UINT128_MAX);
    const quoteRemoved = uint(action.quoteRemoved, 'Recurring quote removed', UINT128_MAX);
    const value = (view.baseAsset.assetType === 'native' ? baseAdded : 0n) +
      (view.quoteAsset.assetType === 'native' ? quoteAdded : 0n);
    return Object.freeze({
      functionName: 'editOrder',
      args: [
        orderId, revision, normalizeTerms(action.buyTerms, 'Recurring buy terms'),
        normalizeTerms(action.sellTerms, 'Recurring sell terms'), baseAdded, quoteAdded,
        baseRemoved, quoteRemoved, normalizeExpiry(action.expiresAt)
      ],
      value, expectedEvent: 'RecurringOrderEdited', expectedOrderId: orderId,
      expectedNextRevision: revision + 1n,
      approvals: [
        ...(view.baseAsset.assetType === 'erc20' && baseAdded > 0n ? [{ asset: view.baseAsset, amount: baseAdded }] : []),
        ...(view.quoteAsset.assetType === 'erc20' && quoteAdded > 0n ? [{ asset: view.quoteAsset, amount: quoteAdded }] : [])
      ]
    });
  }
  if (action.kind !== 'create') throw new Error('Recurring OTC V2 action is unsupported.');
  const create = action as Extract<RecurringTradeV2Action, { kind: 'create' }>;
  const baseAsset = normalizeAsset(create.baseAsset, 'Recurring base asset');
  const quoteAsset = normalizeAsset(create.quoteAsset, 'Recurring quote asset');
  if (baseAsset.assetType === quoteAsset.assetType && baseAsset.token === quoteAsset.token) {
    throw new Error('Recurring base and quote assets must differ.');
  }
  const baseInventory = uint(create.initialBaseInventory, 'Recurring initial base inventory', UINT128_MAX);
  const quoteInventory = uint(create.initialQuoteInventory, 'Recurring initial quote inventory', UINT128_MAX);
  if (baseInventory === 0n || quoteInventory === 0n) throw new Error('Recurring initial inventories must be positive.');
  const value = (baseAsset.assetType === 0 ? baseInventory : 0n) +
    (quoteAsset.assetType === 0 ? quoteInventory : 0n);
  return Object.freeze({
    functionName: 'createOrder',
    args: [
      baseAsset, quoteAsset, normalizeTerms(create.buyTerms, 'Recurring buy terms'),
      normalizeTerms(create.sellTerms, 'Recurring sell terms'), baseInventory, quoteInventory,
      normalizeExpiry(create.expiresAt)
    ],
    value, expectedEvent: 'RecurringOrderOpened', expectedNextRevision: 1n,
    approvals: [
      ...(baseAsset.assetType === 1 ? [{ asset: create.baseAsset, amount: baseInventory }] : []),
      ...(quoteAsset.assetType === 1 ? [{ asset: create.quoteAsset, amount: quoteInventory }] : [])
    ]
  });
};

const normalizeTransaction = (value: unknown, expected: Omit<Transaction, 'hash' | 'wait'>, waitForReceipt?: (hash: string) => Promise<unknown>): Transaction => {
  const tx = tuple(value, 'Recurring OTC V2 transaction');
  if (typeof tx.wait !== 'function') throw new Error('Recurring OTC V2 transaction cannot be confirmed.');
  const hash = bytes32(tx.hash, 'Recurring transaction hash');
  const normalized = Object.freeze({
    hash,
    chainId: resolveBoundTransactionChain(tx.chainId, expected.chainId, 'Recurring OTC V2'),
    from: address(tx.from, 'Recurring transaction sender'),
    to: address(tx.to, 'Recurring transaction target'),
    data: hexBytes(tx.data, 'Recurring transaction data'),
    value: uint(tx.value, 'Recurring transaction value'),
    wait: waitForReceipt ? () => waitForReceipt(hash) : (tx.wait as () => Promise<unknown>).bind(value)
  });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from ||
      normalized.to !== expected.to || normalized.data !== expected.data || normalized.value !== expected.value) {
    throw new Error('Recurring OTC V2 transaction does not match the exact intended action.');
  }
  return normalized;
};

export const submitRecurringTradeV2Action = async ({ capability, deployment, action }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: RecurringTradeV2Action;
}): Promise<RecurringTradeV2Submission> => {
  const binding = await assertScope(capability, deployment);
  const intent = await prepare(action, capability, deployment);
  for (const approval of intent.approvals) {
    await ensureTradeTokenAllowance(
      binding.signer,
      binding.ownerAddress,
      address(approval.asset.token, 'Recurring approval token'),
      approval.amount,
      'erc20',
      deployment.contractAddress
    );
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  }
  const data = ACTIONS.encodeFunctionData(intent.functionName, intent.args).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    RECURRING_TRADE_V2_ACTION_ABI,
    binding.signer
  ) as unknown as Record<string, unknown>;
  const write = contract[intent.functionName];
  if (typeof write !== 'function') throw new Error('Recurring OTC V2 action is unavailable.');
  const raw = await (write as (...args: unknown[]) => Promise<unknown>)(
    ...intent.args,
    ...(intent.value > 0n ? [{ value: intent.value }] : [])
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const transaction = normalizeTransaction(raw, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data,
    value: intent.value
  }, binding.readProvider ? (hash) => waitForOwnerTradeV2Receipt(binding, hash) : undefined);
  const submission = Object.freeze({
    action: action.kind,
    submittedTransactionHash: transaction.hash,
    transaction
  }) as RecurringTradeV2Submission;
  SUBMISSIONS.set(submission, Object.freeze({
    deployment,
    ownerAddress: binding.ownerAddress,
    expectedEvent: intent.expectedEvent,
    expectedOrderId: intent.expectedOrderId,
    expectedStatus: intent.expectedStatus,
    expectedSide: intent.expectedSide,
    expectedNextRevision: intent.expectedNextRevision
  }));
  return submission;
};

export const confirmRecurringTradeV2Action = async (
  submission: RecurringTradeV2Submission
): Promise<ConfirmedRecurringTradeV2Action> => {
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected) throw new Error('Recurring OTC V2 submission is not locally prepared.');
  let receiptValue: unknown;
  let transactionHash = submission.transaction.hash;
  try {
    receiptValue = await submission.transaction.wait();
  } catch (error) {
    const replaced = error as Record<string, unknown> | null;
    if (!replaced || replaced.code !== 'TRANSACTION_REPLACED' || replaced.cancelled === true ||
        replaced.reason === 'cancelled') throw error;
    const replacement = normalizeTransaction(replaced.replacement, submission.transaction);
    transactionHash = replacement.hash;
    receiptValue = replaced.receipt;
  }
  const receipt = tuple(receiptValue, 'Recurring receipt');
  if (uint(receipt.status, 'Recurring receipt status') !== 1n ||
      bytes32(receipt.hash ?? receipt.transactionHash, 'Recurring receipt hash') !== transactionHash ||
      !Array.isArray(receipt.logs)) {
    throw new Error('Recurring receipt is unsuccessful or belongs to another transaction.');
  }
  const blockNumber = uint(receipt.blockNumber, 'Recurring receipt block', UINT64_MAX).toString();
  const blockHash = bytes32(receipt.blockHash, 'Recurring receipt block hash');
  let match: { args: readonly unknown[]; logIndex: number } | undefined;
  for (const candidate of receipt.logs) {
    if (!candidate || typeof candidate !== 'object') continue;
    const log = candidate as Record<string, unknown>;
    if (address(log.address, 'Recurring log address') !== expected.deployment.contractAddress ||
        bytes32(log.blockHash, 'Recurring log block hash') !== blockHash ||
        bytes32(log.transactionHash, 'Recurring log transaction hash') !== transactionHash ||
        String(log.blockNumber) !== String(receipt.blockNumber) || log.removed === true ||
        !Array.isArray(log.topics)) continue;
    let parsed;
    try {
      parsed = ACTIONS.parseLog({
        topics: log.topics as string[],
        data: hexBytes(log.data, 'Recurring log data')
      });
    } catch { continue; }
    if (!parsed || parsed.name !== expected.expectedEvent) continue;
    const args = parsed.args as unknown as readonly unknown[];
    if (expected.expectedOrderId !== undefined && uint(args[0], 'Recurring event order ID') !== expected.expectedOrderId) continue;
    if (expected.expectedStatus !== undefined && uint(args[3], 'Recurring event status') !== expected.expectedStatus) continue;
    if (expected.expectedSide !== undefined && uint(args[3], 'Recurring event side') !== expected.expectedSide) continue;
    const revisionIndex = parsed.name === 'RecurringOrderOpened' ? 13 :
      parsed.name === 'RecurringOrderEdited' ? 11 :
        parsed.name === 'RecurringOrderExecuted' ? 5 :
          parsed.name === 'RecurringOrderStatusChanged' ? 5 : undefined;
    if (expected.expectedNextRevision !== undefined &&
        (revisionIndex === undefined || uint(args[revisionIndex], 'Recurring event revision') !== expected.expectedNextRevision)) continue;
    if (parsed.name === 'NativeCreditWithdrawn' &&
        address(args[0], 'Recurring withdrawal recipient') !== expected.ownerAddress) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Recurring log index'));
    if (!Number.isSafeInteger(logIndex) || match) {
      throw new Error('Recurring receipt has invalid or duplicate action events.');
    }
    match = { args, logIndex };
  }
  if (!match) throw new Error('Recurring receipt is missing the exact action event.');
  return Object.freeze({
    action: submission.action,
    ...(expected.expectedEvent !== 'NativeCreditWithdrawn'
      ? { orderId: uint(match.args[0], 'Confirmed recurring order ID').toString() }
      : {}),
    transactionHash,
    submittedTransactionHash: submission.submittedTransactionHash,
    blockNumber,
    blockHash,
    logIndex: match.logIndex
  });
};
