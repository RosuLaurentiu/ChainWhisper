import { Interface, getAddress } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance } from './appChain';
import { loadCotiEthersModule } from './appShared/core';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';
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

export const PRIVATE_RECURRING_TRADE_V2_ACTION_ABI = [
  'function createOrder(address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 expiresAt,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedInitialInventory) returns (uint256 orderId)',
  'function execute(uint256 orderId,uint8 side,uint64 expectedRevision,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedFill)',
  'function editPrices(uint256 orderId,uint64 expectedRevision,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 expiresAt)',
  'function adjustLiquidity(uint256 orderId,uint64 expectedRevision,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedAdjustment)',
  'function pauseOrder(uint256 orderId,uint64 expectedRevision)',
  'function resumeOrder(uint256 orderId,uint64 expectedRevision)',
  'function cancelOrder(uint256 orderId,uint64 expectedRevision)',
  'function reclaimExpiredOrder(uint256 orderId)',
  'function getOrderView(uint256 orderId) view returns (((address maker,uint8 status,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 expiresAt,uint64 revision,uint64 executionCount,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash) order,uint8 effectiveStatus,bytes32 pairKey) orderView)',
  'function getMyMakerInventorySnapshot(uint256 orderId) view returns ((uint64 sequence,bool initialized,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) baseAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) quoteAmount) snapshot)',
  'function getMyLatestExecutionReceipt(uint256 orderId) view returns ((uint64 executionIndex,bool initialized,uint8 side,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) baseAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) quoteAmount) receipt)',
  'function getOrderIdsForMaker(address maker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOrderIdsForFiller(address filler,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getActiveOrderIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'event PrivateRecurringOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 expiresAt,uint64 revision)',
  'event PrivateRecurringOrderEdited(uint256 indexed orderId,address indexed maker,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,bool liquidityChanged,uint64 expiresAt,uint64 nextRevision)',
  'event PrivateRecurringOrderExecuted(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 side,uint64 executionIndex,uint64 nextRevision)',
  'event PrivateRecurringOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint64 nextRevision)'
] as const;

const ACTIONS = new Interface(PRIVATE_RECURRING_TRADE_V2_ACTION_ABI);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT127_MAX = (1n << 127n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const PACK_BASE = 1n << 128n;
const BASE_REMOVE_FLAG = 1n << 255n;
const QUOTE_REMOVE_FLAG = 1n << 127n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type PrivateRecurringTradeV2SideTerms = Readonly<{
  baseAmount: bigint | number | string;
  quoteAmount: bigint | number | string;
}>;

export type PrivateRecurringLiquidityChange = Readonly<{
  direction: 'add' | 'remove';
  amount: bigint | number | string;
}>;

export type PrivateRecurringTradeV2Action =
  | Readonly<{
      kind: 'create';
      baseToken: string;
      quoteToken: string;
      buyTerms: PrivateRecurringTradeV2SideTerms;
      sellTerms: PrivateRecurringTradeV2SideTerms;
      baseInventory: bigint | number | string;
      quoteInventory: bigint | number | string;
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
      kind: 'edit-prices';
      orderId: bigint | number | string;
      expectedRevision: bigint | number | string;
      buyTerms: PrivateRecurringTradeV2SideTerms;
      sellTerms: PrivateRecurringTradeV2SideTerms;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'adjust-liquidity';
      orderId: bigint | number | string;
      expectedRevision: bigint | number | string;
      base: PrivateRecurringLiquidityChange;
      quote: PrivateRecurringLiquidityChange;
    }>
  | Readonly<{
      kind: 'pause' | 'resume' | 'cancel';
      orderId: bigint | number | string;
      expectedRevision: bigint | number | string;
    }>
  | Readonly<{ kind: 'reclaim-expired'; orderId: bigint | number | string }>;

export type PrivateRecurringTradeV2OrderView = Readonly<{
  orderId: string;
  maker: string;
  status: 'active' | 'paused' | 'cancelled' | 'expired';
  baseToken: string;
  quoteToken: string;
  buyTerms: Readonly<{ baseAmount: string; quoteAmount: string }>;
  sellTerms: Readonly<{ baseAmount: string; quoteAmount: string }>;
  createdAt: string;
  expiresAt: string;
  revision: string;
  executionCount: string;
  pairKey: string;
}>;

export type PrivateRecurringTradeV2Inventory = Readonly<{
  orderId: string;
  sequence: string;
  baseAmount: string;
  quoteAmount: string;
}>;

export type PrivateRecurringTradeV2ExecutionReceipt = Readonly<{
  orderId: string;
  executionIndex: string;
  side: 'buy' | 'sell';
  baseAmount: string;
  quoteAmount: string;
}>;

export type PrivateRecurringTradeV2OrderIdPage = Readonly<{
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

declare const PRIVATE_RECURRING_SUBMISSION_BRAND: unique symbol;
export type PrivateRecurringTradeV2Submission = Readonly<{
  action: PrivateRecurringTradeV2Action['kind'];
  submittedTransactionHash: string;
  transaction: Transaction;
  readonly [PRIVATE_RECURRING_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateRecurringTradeV2Action = Readonly<{
  action: PrivateRecurringTradeV2Action['kind'];
  orderId: string;
  transactionHash: string;
  submittedTransactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

type SubmissionBinding = Readonly<{
  deployment: AttestedTradeHistoryV2Deployment;
  expectedEvent:
    | 'PrivateRecurringOrderOpened'
    | 'PrivateRecurringOrderEdited'
    | 'PrivateRecurringOrderExecuted'
    | 'PrivateRecurringOrderStatusChanged';
  expectedOrderId?: bigint;
  expectedStatus?: bigint;
  expectedSide?: bigint;
  expectedNextRevision: bigint;
  expectedLiquidityChanged?: boolean;
}>;

const SUBMISSIONS = new WeakMap<object, SubmissionBinding>();

const uint = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  let parsed: bigint;
  try { parsed = BigInt(value as bigint); } catch { throw new Error(`${label} must be an unsigned integer.`); }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try { normalized = getAddress(value.trim()).toLowerCase(); } catch { throw new Error(`${label} is invalid.`); }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
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
  assertAttestedTradeHistoryV2Deployment(deployment, 'private-recurring-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Private Recurring OTC V2 capability and deployment chains differ.');
  }
  return binding;
};

const normalizeTerms = (value: PrivateRecurringTradeV2SideTerms, label: string) => {
  const baseAmount = uint(value.baseAmount, `${label} base amount`, UINT128_MAX);
  const quoteAmount = uint(value.quoteAmount, `${label} quote amount`, UINT128_MAX);
  if (baseAmount === 0n || quoteAmount === 0n) throw new Error(`${label} amounts must be positive.`);
  return Object.freeze({ baseAmount, quoteAmount });
};

const normalizeExpiry = (value: unknown): bigint => {
  const expiresAt = uint(value, 'Private recurring expiry', UINT64_MAX);
  if (expiresAt !== 0n && expiresAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error('Private recurring expiry must be in the future or zero.');
  }
  return expiresAt;
};

const parseTerms = (value: unknown, label: string) => {
  const item = tuple(value, label);
  return Object.freeze({
    baseAmount: uint(item.baseAmount ?? item[0], `${label} base amount`).toString(),
    quoteAmount: uint(item.quoteAmount ?? item[1], `${label} quote amount`).toString()
  });
};

const userCiphertext = (value: unknown, label: string) => {
  const wrapped = tuple(value, label);
  const user = tuple(wrapped.userCiphertext ?? wrapped[1], `${label} user ciphertext`);
  return {
    ciphertextHigh: uint(user.ciphertextHigh ?? user[0], `${label} high`),
    ciphertextLow: uint(user.ciphertextLow ?? user[1], `${label} low`)
  };
};

export const packPrivateRecurringInventory = (
  baseAmount: bigint | number | string,
  quoteAmount: bigint | number | string
): bigint => {
  const base = uint(baseAmount, 'Private recurring base inventory', UINT128_MAX);
  const quote = uint(quoteAmount, 'Private recurring quote inventory', UINT128_MAX);
  if (base === 0n || quote === 0n) throw new Error('Private recurring inventories must be positive.');
  return base * PACK_BASE + quote;
};

export const packPrivateRecurringExecution = (
  maxInputAmount: bigint | number | string,
  minOutputAmount: bigint | number | string
): bigint => {
  const maximum = uint(maxInputAmount, 'Private recurring maximum input', UINT128_MAX);
  const minimum = uint(minOutputAmount, 'Private recurring minimum output', UINT128_MAX);
  if (maximum === 0n) throw new Error('Private recurring maximum input must be positive.');
  return maximum * PACK_BASE + minimum;
};

export const packPrivateRecurringLiquidityAdjustment = ({ base, quote }: {
  base: PrivateRecurringLiquidityChange;
  quote: PrivateRecurringLiquidityChange;
}): bigint => {
  const baseAmount = uint(base.amount, 'Private recurring base adjustment', UINT127_MAX);
  const quoteAmount = uint(quote.amount, 'Private recurring quote adjustment', UINT127_MAX);
  if (baseAmount === 0n && quoteAmount === 0n) throw new Error('Private recurring adjustment cannot be empty.');
  return (base.direction === 'remove' ? BASE_REMOVE_FLAG : 0n) + baseAmount * PACK_BASE +
    (quote.direction === 'remove' ? QUOTE_REMOVE_FLAG : 0n) + quoteAmount;
};

export const readPrivateRecurringTradeV2OrderView = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
}): Promise<PrivateRecurringTradeV2OrderView> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Private recurring order ID');
  if (id === 0n) throw new Error('Private recurring order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const view = tuple(await contract.getOrderView(id), 'Private recurring order view');
  const order = tuple(view.order ?? view[0], 'Private recurring order');
  const status = uint(view.effectiveStatus ?? view[1], 'Private recurring status', 4n);
  if (status === 0n) throw new Error('Private recurring order does not exist.');
  const statuses = ['none', 'active', 'paused', 'cancelled', 'expired'] as const;
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(),
    maker: address(order.maker ?? order[0], 'Private recurring maker'),
    status: statuses[Number(status)] as PrivateRecurringTradeV2OrderView['status'],
    baseToken: address(order.baseToken ?? order[2], 'Private recurring base token'),
    quoteToken: address(order.quoteToken ?? order[3], 'Private recurring quote token'),
    buyTerms: parseTerms(order.buyTerms ?? order[4], 'Private recurring buy terms'),
    sellTerms: parseTerms(order.sellTerms ?? order[5], 'Private recurring sell terms'),
    createdAt: uint(order.createdAt ?? order[6], 'Private recurring creation time', UINT64_MAX).toString(),
    expiresAt: uint(order.expiresAt ?? order[7], 'Private recurring expiry', UINT64_MAX).toString(),
    revision: uint(order.revision ?? order[8], 'Private recurring revision', UINT64_MAX).toString(),
    executionCount: uint(order.executionCount ?? order[9], 'Private recurring execution count', UINT64_MAX).toString(),
    pairKey: bytes32(view.pairKey ?? view[2], 'Private recurring pair key')
  });
};

export const readPrivateRecurringTradeV2OrderIds = async ({
  capability,
  deployment,
  scope,
  offset = 0n,
  limit = 50n
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'maker' | 'filler' | 'active';
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<PrivateRecurringTradeV2OrderIdPage> => {
  const binding = await assertScope(capability, deployment);
  const pageOffset = uint(offset, 'Private recurring order offset');
  const pageLimit = uint(limit, 'Private recurring order limit');
  if (pageLimit > 100n) throw new Error('Private recurring order limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const method = scope === 'maker'
    ? 'getOrderIdsForMaker'
    : scope === 'filler'
      ? 'getOrderIdsForFiller'
      : 'getActiveOrderIds';
  const raw = scope === 'active'
    ? await contract[method](pageOffset, pageLimit)
    : await contract[method](binding.ownerAddress, pageOffset, pageLimit);
  const page = tuple(raw, 'Private recurring order ID page');
  const rawIds = page.ids ?? page[0];
  if (!Array.isArray(rawIds)) throw new Error('Private recurring order ID page is malformed.');
  const orderIds = rawIds.map((value, index) => {
    const id = uint(value, `Private recurring order ID ${index + 1}`);
    if (id === 0n) throw new Error('Private recurring order ID page contains zero.');
    return id.toString();
  });
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderIds: Object.freeze(orderIds),
    nextOffset: uint(page.nextOffset ?? page[1], 'Private recurring next offset').toString()
  });
};

export const readPrivateRecurringTradeV2MakerInventory = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
}): Promise<PrivateRecurringTradeV2Inventory> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Private recurring order ID');
  if (id === 0n) throw new Error('Private recurring order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
    binding.signer
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const snapshot = tuple(await contract.getMyMakerInventorySnapshot(id), 'Private recurring inventory');
  if ((snapshot.initialized ?? snapshot[1]) !== true) throw new Error('Private recurring inventory is not initialized.');
  const baseAmount = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(snapshot.baseAmount ?? snapshot[2], 'Private recurring base inventory')
  );
  const quoteAmount = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(snapshot.quoteAmount ?? snapshot[3], 'Private recurring quote inventory')
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(),
    sequence: uint(snapshot.sequence ?? snapshot[0], 'Private recurring inventory sequence', UINT64_MAX).toString(),
    baseAmount: uint(baseAmount, 'Decrypted private recurring base inventory').toString(),
    quoteAmount: uint(quoteAmount, 'Decrypted private recurring quote inventory').toString()
  });
};

export const readPrivateRecurringTradeV2ExecutionReceipt = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
}): Promise<PrivateRecurringTradeV2ExecutionReceipt> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Private recurring order ID');
  if (id === 0n) throw new Error('Private recurring order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
    binding.signer
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const receipt = tuple(await contract.getMyLatestExecutionReceipt(id), 'Private recurring execution receipt');
  if ((receipt.initialized ?? receipt[1]) !== true) throw new Error('Private recurring execution receipt is not initialized.');
  const side = uint(receipt.side ?? receipt[2], 'Private recurring receipt side', 1n);
  const baseAmount = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(receipt.baseAmount ?? receipt[3], 'Private recurring receipt base')
  );
  const quoteAmount = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(receipt.quoteAmount ?? receipt[4], 'Private recurring receipt quote')
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(),
    executionIndex: uint(receipt.executionIndex ?? receipt[0], 'Private recurring execution index', UINT64_MAX).toString(),
    side: side === 0n ? 'buy' : 'sell',
    baseAmount: uint(baseAmount, 'Decrypted private recurring base amount').toString(),
    quoteAmount: uint(quoteAmount, 'Decrypted private recurring quote amount').toString()
  });
};

type Prepared = Readonly<{
  functionName: string;
  args: readonly unknown[];
  expectedEvent: SubmissionBinding['expectedEvent'];
  expectedOrderId?: bigint;
  expectedStatus?: bigint;
  expectedSide?: bigint;
  expectedNextRevision: bigint;
  expectedLiquidityChanged?: boolean;
  approvals: readonly Readonly<{ token: string; amount: bigint }>[];
}>;

const prepareEncrypted = async (
  functionName: string,
  values: readonly unknown[],
  plaintext: bigint,
  binding: ReturnType<typeof getOwnerTradeV2CapabilityBinding>,
  deployment: AttestedTradeHistoryV2Deployment
): Promise<readonly unknown[]> => {
  const selector = ACTIONS.getFunction(functionName)?.selector;
  if (!selector) throw new Error('Private recurring selector is unavailable.');
  const encrypted = await encryptPrivateUint256Input(
    binding.signer,
    plaintext,
    deployment.contractAddress,
    selector
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return [...values, encrypted];
};

const prepare = async (
  action: PrivateRecurringTradeV2Action,
  capability: OwnerTradeV2MetaMaskCapability,
  deployment: AttestedTradeHistoryV2Deployment
): Promise<Prepared> => {
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  if (action.kind === 'reclaim-expired') {
    const orderId = uint(action.orderId, 'Private recurring order ID');
    if (orderId === 0n) throw new Error('Private recurring order ID cannot be zero.');
    const order = await readPrivateRecurringTradeV2OrderView({ capability, deployment, orderId });
    if (order.status !== 'expired') throw new Error('Private recurring order is not expired.');
    return Object.freeze({
      functionName: 'reclaimExpiredOrder', args: [orderId],
      expectedEvent: 'PrivateRecurringOrderStatusChanged', expectedOrderId: orderId,
      expectedStatus: 4n, expectedNextRevision: BigInt(order.revision) + 1n, approvals: []
    });
  }
  if (action.kind === 'pause' || action.kind === 'resume' || action.kind === 'cancel') {
    const orderId = uint(action.orderId, 'Private recurring order ID');
    const revision = uint(action.expectedRevision, 'Private recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Private recurring order ID and revision must be positive.');
    const functions = { pause: 'pauseOrder', resume: 'resumeOrder', cancel: 'cancelOrder' } as const;
    const statuses = { pause: 2n, resume: 1n, cancel: 3n } as const;
    return Object.freeze({
      functionName: functions[action.kind], args: [orderId, revision],
      expectedEvent: 'PrivateRecurringOrderStatusChanged', expectedOrderId: orderId,
      expectedStatus: statuses[action.kind], expectedNextRevision: revision + 1n, approvals: []
    });
  }
  if (action.kind === 'execute') {
    const orderId = uint(action.orderId, 'Private recurring order ID');
    const revision = uint(action.expectedRevision, 'Private recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Private recurring execution identity must be positive.');
    const order = await readPrivateRecurringTradeV2OrderView({ capability, deployment, orderId });
    if (order.status !== 'active' || order.revision !== revision.toString()) {
      throw new Error('Private recurring execution review is stale.');
    }
    const maximum = uint(action.maxInputAmount, 'Private recurring maximum input', UINT128_MAX);
    const args = await prepareEncrypted(
      'execute',
      [orderId, action.side === 'buy' ? 0n : 1n, revision],
      packPrivateRecurringExecution(maximum, action.minOutputAmount),
      binding,
      deployment
    );
    return Object.freeze({
      functionName: 'execute', args,
      expectedEvent: 'PrivateRecurringOrderExecuted', expectedOrderId: orderId,
      expectedSide: action.side === 'buy' ? 0n : 1n, expectedNextRevision: revision + 1n,
      approvals: [{ token: action.side === 'buy' ? order.baseToken : order.quoteToken, amount: maximum }]
    });
  }
  if (action.kind === 'edit-prices') {
    const orderId = uint(action.orderId, 'Private recurring order ID');
    const revision = uint(action.expectedRevision, 'Private recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Private recurring edit identity must be positive.');
    return Object.freeze({
      functionName: 'editPrices',
      args: [
        orderId, revision, normalizeTerms(action.buyTerms, 'Private recurring buy terms'),
        normalizeTerms(action.sellTerms, 'Private recurring sell terms'), normalizeExpiry(action.expiresAt)
      ],
      expectedEvent: 'PrivateRecurringOrderEdited', expectedOrderId: orderId,
      expectedNextRevision: revision + 1n, expectedLiquidityChanged: false, approvals: []
    });
  }
  if (action.kind === 'adjust-liquidity') {
    const orderId = uint(action.orderId, 'Private recurring order ID');
    const revision = uint(action.expectedRevision, 'Private recurring expected revision', UINT64_MAX);
    if (orderId === 0n || revision === 0n) throw new Error('Private recurring adjustment identity must be positive.');
    const order = await readPrivateRecurringTradeV2OrderView({ capability, deployment, orderId });
    if ((order.status !== 'active' && order.status !== 'paused') || order.revision !== revision.toString()) {
      throw new Error('Private recurring adjustment review is stale.');
    }
    const baseAmount = uint(action.base.amount, 'Private recurring base adjustment', UINT127_MAX);
    const quoteAmount = uint(action.quote.amount, 'Private recurring quote adjustment', UINT127_MAX);
    const args = await prepareEncrypted(
      'adjustLiquidity',
      [orderId, revision],
      packPrivateRecurringLiquidityAdjustment(action),
      binding,
      deployment
    );
    return Object.freeze({
      functionName: 'adjustLiquidity', args,
      expectedEvent: 'PrivateRecurringOrderEdited', expectedOrderId: orderId,
      expectedNextRevision: revision + 1n, expectedLiquidityChanged: true,
      approvals: [
        ...(action.base.direction === 'add' && baseAmount > 0n ? [{ token: order.baseToken, amount: baseAmount }] : []),
        ...(action.quote.direction === 'add' && quoteAmount > 0n ? [{ token: order.quoteToken, amount: quoteAmount }] : [])
      ]
    });
  }
  if (action.kind !== 'create') throw new Error('Private Recurring OTC V2 action is unsupported.');
  const baseToken = address(action.baseToken, 'Private recurring base token');
  const quoteToken = address(action.quoteToken, 'Private recurring quote token');
  if (baseToken === quoteToken) throw new Error('Private recurring tokens must differ.');
  const baseInventory = uint(action.baseInventory, 'Private recurring base inventory', UINT128_MAX);
  const quoteInventory = uint(action.quoteInventory, 'Private recurring quote inventory', UINT128_MAX);
  const args = await prepareEncrypted(
    'createOrder',
    [
      baseToken, quoteToken, normalizeTerms(action.buyTerms, 'Private recurring buy terms'),
      normalizeTerms(action.sellTerms, 'Private recurring sell terms'), normalizeExpiry(action.expiresAt)
    ],
    packPrivateRecurringInventory(baseInventory, quoteInventory),
    binding,
    deployment
  );
  return Object.freeze({
    functionName: 'createOrder', args,
    expectedEvent: 'PrivateRecurringOrderOpened', expectedNextRevision: 1n,
    approvals: [
      { token: baseToken, amount: baseInventory },
      { token: quoteToken, amount: quoteInventory }
    ]
  });
};

const normalizeTransaction = (value: unknown, expected: Omit<Transaction, 'hash' | 'wait'>, waitForReceipt?: (hash: string) => Promise<unknown>): Transaction => {
  const tx = tuple(value, 'Private recurring transaction');
  if (typeof tx.wait !== 'function') throw new Error('Private recurring transaction cannot be confirmed.');
  const hash = bytes32(tx.hash, 'Private recurring transaction hash');
  const normalized = Object.freeze({
    hash,
    chainId: resolveBoundTransactionChain(tx.chainId, expected.chainId, 'Private recurring OTC V2'),
    from: address(tx.from, 'Private recurring transaction sender'),
    to: address(tx.to, 'Private recurring transaction target'),
    data: hexBytes(tx.data, 'Private recurring transaction data'),
    value: uint(tx.value, 'Private recurring transaction value'),
    wait: waitForReceipt ? () => waitForReceipt(hash) : (tx.wait as () => Promise<unknown>).bind(value)
  });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from ||
      normalized.to !== expected.to || normalized.data !== expected.data || normalized.value !== expected.value) {
    throw new Error('Private recurring transaction does not match the exact intended action.');
  }
  return normalized;
};

export const submitPrivateRecurringTradeV2Action = async ({ capability, deployment, action }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: PrivateRecurringTradeV2Action;
}): Promise<PrivateRecurringTradeV2Submission> => {
  const binding = await assertScope(capability, deployment);
  const intent = await prepare(action, capability, deployment);
  for (const approval of intent.approvals) {
    await ensureTradeTokenAllowance(
      binding.signer,
      binding.ownerAddress,
      approval.token,
      approval.amount,
      'private-erc20',
      deployment.contractAddress
    );
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  }
  const data = ACTIONS.encodeFunctionData(intent.functionName, intent.args).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
    binding.signer
  ) as unknown as Record<string, unknown>;
  const write = contract[intent.functionName];
  if (typeof write !== 'function') throw new Error('Private Recurring OTC V2 action is unavailable.');
  const raw = await (write as (...args: unknown[]) => Promise<unknown>)(...intent.args);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const transaction = normalizeTransaction(raw, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data,
    value: 0n
  }, binding.readProvider ? (hash) => waitForOwnerTradeV2Receipt(binding, hash) : undefined);
  const submission = Object.freeze({
    action: action.kind,
    submittedTransactionHash: transaction.hash,
    transaction
  }) as PrivateRecurringTradeV2Submission;
  SUBMISSIONS.set(submission, Object.freeze({
    deployment,
    expectedEvent: intent.expectedEvent,
    expectedOrderId: intent.expectedOrderId,
    expectedStatus: intent.expectedStatus,
    expectedSide: intent.expectedSide,
    expectedNextRevision: intent.expectedNextRevision,
    expectedLiquidityChanged: intent.expectedLiquidityChanged
  }));
  return submission;
};

export const confirmPrivateRecurringTradeV2Action = async (
  submission: PrivateRecurringTradeV2Submission
): Promise<ConfirmedPrivateRecurringTradeV2Action> => {
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected) throw new Error('Private recurring submission is not locally prepared.');
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
  const receipt = tuple(receiptValue, 'Private recurring receipt');
  if (uint(receipt.status, 'Private recurring receipt status') !== 1n ||
      bytes32(receipt.hash ?? receipt.transactionHash, 'Private recurring receipt hash') !== transactionHash ||
      !Array.isArray(receipt.logs)) {
    throw new Error('Private recurring receipt is unsuccessful or belongs to another transaction.');
  }
  const blockNumber = uint(receipt.blockNumber, 'Private recurring receipt block', UINT64_MAX).toString();
  const blockHash = bytes32(receipt.blockHash, 'Private recurring receipt block hash');
  let match: { args: readonly unknown[]; logIndex: number } | undefined;
  for (const candidate of receipt.logs) {
    if (!candidate || typeof candidate !== 'object') continue;
    const log = candidate as Record<string, unknown>;
    if (address(log.address, 'Private recurring log address') !== expected.deployment.contractAddress ||
        bytes32(log.blockHash, 'Private recurring log block hash') !== blockHash ||
        bytes32(log.transactionHash, 'Private recurring log transaction hash') !== transactionHash ||
        String(log.blockNumber) !== String(receipt.blockNumber) || log.removed === true ||
        !Array.isArray(log.topics)) continue;
    let parsed;
    try {
      parsed = ACTIONS.parseLog({
        topics: log.topics as string[],
        data: hexBytes(log.data, 'Private recurring log data')
      });
    } catch { continue; }
    if (!parsed || parsed.name !== expected.expectedEvent) continue;
    const args = parsed.args as unknown as readonly unknown[];
    if (expected.expectedOrderId !== undefined && uint(args[0], 'Private recurring event order ID') !== expected.expectedOrderId) continue;
    if (expected.expectedStatus !== undefined && uint(args[3], 'Private recurring event status') !== expected.expectedStatus) continue;
    if (expected.expectedSide !== undefined && uint(args[3], 'Private recurring event side') !== expected.expectedSide) continue;
    const revisionIndex = parsed.name === 'PrivateRecurringOrderOpened' ? 9 :
      parsed.name === 'PrivateRecurringOrderEdited' ? 6 : 5;
    if (uint(args[revisionIndex], 'Private recurring event revision') !== expected.expectedNextRevision) continue;
    if (expected.expectedLiquidityChanged !== undefined &&
        args[4] !== expected.expectedLiquidityChanged) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Private recurring log index'));
    if (!Number.isSafeInteger(logIndex) || match) {
      throw new Error('Private recurring receipt has invalid or duplicate action events.');
    }
    match = { args, logIndex };
  }
  if (!match) throw new Error('Private recurring receipt is missing the exact action event.');
  return Object.freeze({
    action: submission.action,
    orderId: uint(match.args[0], 'Confirmed private recurring order ID').toString(),
    transactionHash,
    submittedTransactionHash: submission.submittedTransactionHash,
    blockNumber,
    blockHash,
    logIndex: match.logIndex
  });
};
