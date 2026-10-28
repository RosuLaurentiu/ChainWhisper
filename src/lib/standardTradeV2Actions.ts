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

export const STANDARD_TRADE_V2_ACTION_ABI = [
  'function createTrade((uint8 assetType,address token,uint256 amount) offerAsset,(uint8 assetType,address token,uint256 amount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint256 minRequestAmount,uint256 maxRequestAmountPerWallet,bool oneFillPerWallet) fillPolicy,uint64 expiresAt) payable returns (uint256 tradeId)',
  'function replaceTrade(uint256 originalTradeId,(uint8 assetType,address token,uint256 amount) offerAsset,(uint8 assetType,address token,uint256 amount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint256 minRequestAmount,uint256 maxRequestAmountPerWallet,bool oneFillPerWallet) fillPolicy,uint64 expiresAt) payable returns (uint256 tradeId)',
  'function fillTrade(uint256 tradeId,uint64 expectedRevision,uint256 requestAmountIn,uint256 minOfferAmountOut) payable returns (uint256 offerAmountOut)',
  'function cancelTrade(uint256 tradeId)',
  'function reclaimExpiredTrade(uint256 tradeId)',
  'function withdrawNativeCredit()',
  'function quoteFillFor(uint256 tradeId,address filler,uint256 requestAmountIn) view returns ((uint64 revision,uint256 requestAmountIn,uint256 offerAmountOut,bool isFinalFill,uint256 remainingOfferAmountAfter,uint256 remainingRequestAmountAfter) quote)',
  'function getTradeView(uint256 tradeId) view returns (((address maker,uint8 status,(uint8 assetType,address token,uint256 amount) offerAsset,(uint8 assetType,address token,uint256 amount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint256 minRequestAmount,uint256 maxRequestAmountPerWallet,bool oneFillPerWallet) fillPolicy,uint64 createdAt,uint64 expiresAt,uint256 rootTradeId,bool offerLocked,bytes32 offerTokenCodeHash,bytes32 requestTokenCodeHash) trade,(uint256 remainingOfferAmount,uint256 remainingRequestAmount,uint256 filledOfferAmount,uint256 filledRequestAmount,uint64 revision) fillState,uint8 effectiveStatus,uint256 replacementTradeId,uint256 replacesTradeId,bytes32 pairKey) tradeView)',
  'function getRecentTradeIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getTradeIdsForMaker(address maker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getTradeIdsForFiller(address filler,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOpenTradeIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'event StandardTradeOpened(uint256 indexed tradeId,address indexed maker,bytes32 indexed pairKey,uint8 offerAssetType,address offerToken,uint256 offerAmount,uint8 requestAssetType,address requestToken,uint256 requestAmount,(bool partialFillsAllowed,uint16 minPartialFillBps,uint256 minRequestAmount,uint256 maxRequestAmountPerWallet,bool oneFillPerWallet) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint256 rootTradeId)',
  'event StandardTradeFilled(uint256 indexed tradeId,address indexed filler,address indexed maker,uint256 requestAmountIn,uint256 offerAmountOut,uint256 remainingOfferAmount,uint256 remainingRequestAmount,uint64 nextRevision,bool finalFill)',
  'event StandardTradeStatusChanged(uint256 indexed tradeId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedTradeId,uint64 revision)',
  'event StandardTradeReplaced(uint256 indexed originalTradeId,uint256 indexed replacementTradeId,uint256 indexed rootTradeId)',
  'event NativeCreditWithdrawn(address indexed recipient,uint256 amount)'
] as const;

const ACTIONS = new Interface(STANDARD_TRADE_V2_ACTION_ABI);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type StandardTradeV2Asset = Readonly<{
  assetType: 'native' | 'erc20';
  token?: string;
  amount: bigint | number | string;
}>;

export type StandardTradeV2FillPolicy = Readonly<{
  partialFillsAllowed: boolean;
  minPartialFillBps: bigint | number | string;
  minRequestAmount: bigint | number | string;
  maxRequestAmountPerWallet: bigint | number | string;
  oneFillPerWallet: boolean;
}>;

export type StandardTradeV2Action =
  | Readonly<{
      kind: 'create';
      offerAsset: StandardTradeV2Asset;
      requestAsset: StandardTradeV2Asset;
      fillPolicy: StandardTradeV2FillPolicy;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'replace';
      originalTradeId: bigint | number | string;
      offerAsset: StandardTradeV2Asset;
      requestAsset: StandardTradeV2Asset;
      fillPolicy: StandardTradeV2FillPolicy;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'fill';
      tradeId: bigint | number | string;
      expectedRevision: bigint | number | string;
      requestAmountIn: bigint | number | string;
      minOfferAmountOut: bigint | number | string;
      requestAsset: Pick<StandardTradeV2Asset, 'assetType' | 'token'>;
    }>
  | Readonly<{ kind: 'cancel' | 'reclaim-expired'; tradeId: bigint | number | string }>
  | Readonly<{ kind: 'withdraw-native-credit' }>;

export type StandardTradeV2Quote = Readonly<{
  revision: string;
  requestAmountIn: string;
  offerAmountOut: string;
  isFinalFill: boolean;
  remainingOfferAmountAfter: string;
  remainingRequestAmountAfter: string;
}>;

export type StandardTradeV2View = Readonly<{
  tradeId: string;
  maker: string;
  status: 'open' | 'filled' | 'cancelled' | 'expired' | 'replaced';
  offerAsset: Readonly<{ assetType: 'native' | 'erc20'; token: string; amount: string }>;
  requestAsset: Readonly<{ assetType: 'native' | 'erc20'; token: string; amount: string }>;
  fillPolicy: Readonly<{
    partialFillsAllowed: boolean;
    minPartialFillBps: string;
    minRequestAmount: string;
    maxRequestAmountPerWallet: string;
    oneFillPerWallet: boolean;
  }>;
  createdAt: string;
  expiresAt: string;
  rootTradeId: string;
  remainingOfferAmount: string;
  remainingRequestAmount: string;
  filledOfferAmount: string;
  filledRequestAmount: string;
  revision: string;
  replacementTradeId: string;
  replacesTradeId: string;
}>;

export type StandardTradeV2IdPage = Readonly<{
  tradeIds: readonly string[];
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

declare const STANDARD_SUBMISSION_BRAND: unique symbol;
export type StandardTradeV2Submission = Readonly<{
  action: StandardTradeV2Action['kind'];
  submittedTransactionHash: string;
  transaction: Transaction;
  readonly [STANDARD_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedStandardTradeV2Action = Readonly<{
  action: StandardTradeV2Action['kind'];
  tradeId?: string;
  transactionHash: string;
  submittedTransactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

type SubmissionBinding = Readonly<{
  deployment: AttestedTradeHistoryV2Deployment;
  ownerAddress: string;
  expectedEvent: 'StandardTradeOpened' | 'StandardTradeFilled' | 'StandardTradeStatusChanged' | 'NativeCreditWithdrawn';
  expectedTradeId?: bigint;
  expectedStatus?: bigint;
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

const tuple = (value: unknown, label: string): Record<string | number, unknown> => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  return value as Record<string | number, unknown>;
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be bytes32.`);
  return value.toLowerCase();
};

const hexBytes = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${label} must be hex bytes.`);
  return value.toLowerCase();
};

const assertScope = async (
  capability: OwnerTradeV2MetaMaskCapability,
  deployment: AttestedTradeHistoryV2Deployment
) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'standard-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) throw new Error('Standard OTC V2 capability and deployment chains differ.');
  return binding;
};

const normalizeAsset = (asset: StandardTradeV2Asset, label: string) => {
  const amount = uint(asset.amount, `${label} amount`, UINT128_MAX);
  if (amount === 0n) throw new Error(`${label} amount must be positive.`);
  return Object.freeze({
    assetType: asset.assetType === 'native' ? 0 : 1,
    token: asset.assetType === 'native' ? ZERO_ADDRESS : address(asset.token, `${label} token`),
    amount
  });
};

const normalizeFillPolicy = (policy: StandardTradeV2FillPolicy) => {
  const minPartialFillBps = uint(policy.minPartialFillBps, 'Minimum partial fill BPS', 10_000n);
  const minRequestAmount = uint(policy.minRequestAmount, 'Minimum request amount', UINT128_MAX);
  const maxRequestAmountPerWallet = uint(policy.maxRequestAmountPerWallet, 'Maximum request amount per wallet', UINT128_MAX);
  if (!policy.partialFillsAllowed && (minPartialFillBps !== 0n || minRequestAmount !== 0n || maxRequestAmountPerWallet !== 0n || policy.oneFillPerWallet)) {
    throw new Error('Full-fill Standard orders cannot configure partial-fill limits.');
  }
  return Object.freeze({
    partialFillsAllowed: policy.partialFillsAllowed,
    minPartialFillBps,
    minRequestAmount,
    maxRequestAmountPerWallet,
    oneFillPerWallet: policy.oneFillPerWallet
  });
};

const normalizeExpiry = (value: unknown): bigint => {
  const expiresAt = uint(value, 'Standard trade expiry', UINT64_MAX);
  if (expiresAt !== 0n && expiresAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error('Standard trade expiry must be in the future or zero.');
  }
  return expiresAt;
};

const transactionEnvelope = (
  value: unknown,
  expected: Omit<Transaction, 'hash' | 'wait'>,
  waitForReceipt?: (hash: string) => Promise<unknown>
): Transaction => {
  if (!value || typeof value !== 'object') throw new Error('Standard OTC V2 transaction is missing.');
  const tx = value as Record<string, unknown>;
  if (typeof tx.wait !== 'function') throw new Error('Standard OTC V2 transaction cannot be confirmed.');
  const hash = bytes32(tx.hash, 'Standard OTC V2 transaction hash');
  const normalized = Object.freeze({
    hash,
    chainId: resolveBoundTransactionChain(tx.chainId, expected.chainId, 'Standard OTC V2'),
    from: address(tx.from, 'Standard OTC V2 transaction sender'),
    to: address(tx.to, 'Standard OTC V2 transaction target'),
    data: hexBytes(tx.data, 'Standard OTC V2 transaction data'),
    value: uint(tx.value, 'Standard OTC V2 transaction value'),
    wait: waitForReceipt ? () => waitForReceipt(hash) : (tx.wait as () => Promise<unknown>).bind(value)
  });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from ||
      normalized.to !== expected.to || normalized.data !== expected.data || normalized.value !== expected.value) {
    throw new Error('Standard OTC V2 transaction does not match the intended action.');
  }
  return normalized;
};

export const readStandardTradeV2View = async ({
  capability,
  deployment,
  tradeId
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  tradeId: bigint | number | string;
}): Promise<StandardTradeV2View> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(tradeId, 'Standard trade ID');
  if (id === 0n) throw new Error('Standard trade ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, STANDARD_TRADE_V2_ACTION_ABI, getOwnerTradeV2ReadRunner(binding)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const view = tuple(await contract.getTradeView(id), 'Standard trade view');
  const trade = tuple(view.trade ?? view[0], 'Standard trade');
  const fill = tuple(view.fillState ?? view[1], 'Standard fill state');
  const parseAsset = (value: unknown, label: string) => {
    const asset = tuple(value, label);
    const type = uint(asset.assetType ?? asset[0], `${label} type`, 1n);
    return Object.freeze({
      assetType: type === 0n ? 'native' as const : 'erc20' as const,
      token: address(asset.token ?? asset[1], `${label} token`, type === 0n),
      amount: uint(asset.amount ?? asset[2], `${label} amount`).toString()
    });
  };
  const policy = tuple(trade.fillPolicy ?? trade[4], 'Standard fill policy');
  const statusValue = uint(view.effectiveStatus ?? view[2], 'Standard trade status', 5n);
  const statuses = ['none', 'open', 'filled', 'cancelled', 'expired', 'replaced'] as const;
  if (statusValue === 0n) throw new Error('Standard trade does not exist.');
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    tradeId: id.toString(),
    maker: address(trade.maker ?? trade[0], 'Standard trade maker'),
    status: statuses[Number(statusValue)] as StandardTradeV2View['status'],
    offerAsset: parseAsset(trade.offerAsset ?? trade[2], 'Standard offer asset'),
    requestAsset: parseAsset(trade.requestAsset ?? trade[3], 'Standard request asset'),
    fillPolicy: Object.freeze({
      partialFillsAllowed: (policy.partialFillsAllowed ?? policy[0]) === true,
      minPartialFillBps: uint(policy.minPartialFillBps ?? policy[1], 'Standard minimum partial fill BPS').toString(),
      minRequestAmount: uint(policy.minRequestAmount ?? policy[2], 'Standard minimum request amount').toString(),
      maxRequestAmountPerWallet: uint(policy.maxRequestAmountPerWallet ?? policy[3], 'Standard maximum per wallet').toString(),
      oneFillPerWallet: (policy.oneFillPerWallet ?? policy[4]) === true
    }),
    createdAt: uint(trade.createdAt ?? trade[5], 'Standard creation time', UINT64_MAX).toString(),
    expiresAt: uint(trade.expiresAt ?? trade[6], 'Standard expiry', UINT64_MAX).toString(),
    rootTradeId: uint(trade.rootTradeId ?? trade[7], 'Standard root trade ID').toString(),
    remainingOfferAmount: uint(fill.remainingOfferAmount ?? fill[0], 'Remaining Standard offer amount').toString(),
    remainingRequestAmount: uint(fill.remainingRequestAmount ?? fill[1], 'Remaining Standard request amount').toString(),
    filledOfferAmount: uint(fill.filledOfferAmount ?? fill[2], 'Filled Standard offer amount').toString(),
    filledRequestAmount: uint(fill.filledRequestAmount ?? fill[3], 'Filled Standard request amount').toString(),
    revision: uint(fill.revision ?? fill[4], 'Standard trade revision', UINT64_MAX).toString(),
    replacementTradeId: uint(view.replacementTradeId ?? view[3], 'Standard replacement trade ID').toString(),
    replacesTradeId: uint(view.replacesTradeId ?? view[4], 'Standard replaced trade ID').toString()
  });
};

export const readStandardTradeV2Ids = async ({
  capability,
  deployment,
  scope,
  offset = 0n,
  limit = 50n
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'recent' | 'maker' | 'filler' | 'open';
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<StandardTradeV2IdPage> => {
  const binding = await assertScope(capability, deployment);
  const pageOffset = uint(offset, 'Standard trade offset');
  const pageLimit = uint(limit, 'Standard trade limit');
  if (pageLimit > 100n) throw new Error('Standard trade limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    STANDARD_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const method = scope === 'recent'
    ? 'getRecentTradeIds'
    : scope === 'maker'
      ? 'getTradeIdsForMaker'
      : scope === 'filler'
        ? 'getTradeIdsForFiller'
        : 'getOpenTradeIds';
  const raw = scope === 'maker' || scope === 'filler'
    ? await contract[method](binding.ownerAddress, pageOffset, pageLimit)
    : await contract[method](pageOffset, pageLimit);
  const page = tuple(raw, 'Standard trade ID page');
  const rawIds = page.ids ?? page[0];
  if (!Array.isArray(rawIds)) throw new Error('Standard trade ID page is malformed.');
  const tradeIds = rawIds.map((value, index) => {
    const id = uint(value, `Standard trade ID ${index + 1}`);
    if (id === 0n) throw new Error('Standard trade ID page contains zero.');
    return id.toString();
  });
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    tradeIds: Object.freeze(tradeIds),
    nextOffset: uint(page.nextOffset ?? page[1], 'Standard trade next offset').toString()
  });
};

export const quoteStandardTradeV2Fill = async ({ capability, deployment, tradeId, requestAmountIn }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  tradeId: bigint | number | string;
  requestAmountIn: bigint | number | string;
}): Promise<StandardTradeV2Quote> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(tradeId, 'Standard trade ID');
  const amount = uint(requestAmountIn, 'Standard fill request amount', UINT128_MAX);
  if (id === 0n || amount === 0n) throw new Error('Standard fill ID and amount must be positive.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, STANDARD_TRADE_V2_ACTION_ABI, getOwnerTradeV2ReadRunner(binding)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const quote = tuple(await contract.quoteFillFor(id, binding.ownerAddress, amount), 'Standard fill quote');
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    revision: uint(quote.revision ?? quote[0], 'Standard quote revision', UINT64_MAX).toString(),
    requestAmountIn: uint(quote.requestAmountIn ?? quote[1], 'Standard quoted request amount').toString(),
    offerAmountOut: uint(quote.offerAmountOut ?? quote[2], 'Standard quoted offer amount').toString(),
    isFinalFill: (quote.isFinalFill ?? quote[3]) === true,
    remainingOfferAmountAfter: uint(quote.remainingOfferAmountAfter ?? quote[4], 'Standard remaining offer').toString(),
    remainingRequestAmountAfter: uint(quote.remainingRequestAmountAfter ?? quote[5], 'Standard remaining request').toString()
  });
};

const prepared = (action: StandardTradeV2Action) => {
  if (action.kind === 'withdraw-native-credit') {
    return { functionName: 'withdrawNativeCredit', args: [] as unknown[], value: 0n, expectedEvent: 'NativeCreditWithdrawn' as const };
  }
  if (action.kind === 'cancel' || action.kind === 'reclaim-expired') {
    const tradeId = uint(action.tradeId, 'Standard trade ID');
    if (tradeId === 0n) throw new Error('Standard trade ID cannot be zero.');
    return {
      functionName: action.kind === 'cancel' ? 'cancelTrade' : 'reclaimExpiredTrade',
      args: [tradeId],
      value: 0n,
      expectedEvent: 'StandardTradeStatusChanged' as const,
      expectedTradeId: tradeId,
      expectedStatus: action.kind === 'cancel' ? 3n : 4n
    };
  }
  if (action.kind === 'fill') {
    const tradeId = uint(action.tradeId, 'Standard trade ID');
    const expectedRevision = uint(action.expectedRevision, 'Standard expected revision', UINT64_MAX);
    const requestAmountIn = uint(action.requestAmountIn, 'Standard fill request amount', UINT128_MAX);
    const minOfferAmountOut = uint(action.minOfferAmountOut, 'Standard minimum offer output', UINT128_MAX);
    if (tradeId === 0n || requestAmountIn === 0n || minOfferAmountOut === 0n) throw new Error('Standard fill values must be positive.');
    return {
      functionName: 'fillTrade', args: [tradeId, expectedRevision, requestAmountIn, minOfferAmountOut],
      value: action.requestAsset.assetType === 'native' ? requestAmountIn : 0n,
      expectedEvent: 'StandardTradeFilled' as const, expectedTradeId: tradeId
    };
  }
  if (action.kind !== 'create' && action.kind !== 'replace') {
    throw new Error('Standard OTC V2 action is unsupported.');
  }
  const mutableAction = action as Extract<StandardTradeV2Action, { kind: 'create' | 'replace' }>;
  const offerAsset = normalizeAsset(mutableAction.offerAsset, 'Standard offer');
  const requestAsset = normalizeAsset(mutableAction.requestAsset, 'Standard request');
  const fillPolicy = normalizeFillPolicy(mutableAction.fillPolicy);
  const expiresAt = normalizeExpiry(mutableAction.expiresAt);
  if (offerAsset.assetType === requestAsset.assetType && offerAsset.token === requestAsset.token) {
    throw new Error('Standard offer and request assets must differ.');
  }
  const originalTradeId = mutableAction.kind === 'replace'
    ? uint(mutableAction.originalTradeId, 'Original Standard trade ID')
    : undefined;
  if (originalTradeId === 0n) throw new Error('Original Standard trade ID cannot be zero.');
  return {
    functionName: mutableAction.kind === 'create' ? 'createTrade' : 'replaceTrade',
    args: mutableAction.kind === 'create'
      ? [offerAsset, requestAsset, fillPolicy, expiresAt]
      : [originalTradeId!, offerAsset, requestAsset, fillPolicy, expiresAt],
    value: offerAsset.assetType === 0 ? offerAsset.amount : 0n,
    expectedEvent: 'StandardTradeOpened' as const
  };
};

export const ensureStandardTradeV2Allowance = async ({ capability, deployment, action }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: StandardTradeV2Action;
}): Promise<void> => {
  const binding = await assertScope(capability, deployment);
  const asset = action.kind === 'fill'
    ? { ...action.requestAsset, amount: action.requestAmountIn }
    : action.kind === 'create' || action.kind === 'replace'
      ? action.offerAsset
      : null;
  if (!asset || asset.assetType === 'native') return;
  const amount = uint(asset.amount, 'Standard approval amount', UINT128_MAX);
  if (amount === 0n) return;
  await ensureTradeTokenAllowance(binding.signer, binding.ownerAddress, address(asset.token, 'Standard approval token'), amount, 'erc20', deployment.contractAddress);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
};

export const submitStandardTradeV2Action = async ({ capability, deployment, action }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: StandardTradeV2Action;
}): Promise<StandardTradeV2Submission> => {
  const binding = await assertScope(capability, deployment);
  const intent = prepared(action);
  const data = ACTIONS.encodeFunctionData(intent.functionName, intent.args).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, STANDARD_TRADE_V2_ACTION_ABI, binding.signer) as unknown as Record<string, unknown>;
  const write = contract[intent.functionName];
  if (typeof write !== 'function') throw new Error('Standard OTC V2 action is unavailable.');
  const raw = await (write as (...args: unknown[]) => Promise<unknown>)(
    ...intent.args,
    ...(intent.value > 0n ? [{ value: intent.value }] : [])
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const transaction = transactionEnvelope(raw, {
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
  }) as StandardTradeV2Submission;
  SUBMISSIONS.set(submission, Object.freeze({
    deployment, ownerAddress: binding.ownerAddress, expectedEvent: intent.expectedEvent,
    expectedTradeId: intent.expectedTradeId, expectedStatus: intent.expectedStatus
  }));
  return submission;
};

export const confirmStandardTradeV2Action = async (
  submission: StandardTradeV2Submission
): Promise<ConfirmedStandardTradeV2Action> => {
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected) throw new Error('Standard OTC V2 submission is not locally prepared.');
  let receiptValue: unknown;
  let transactionHash = submission.transaction.hash;
  try {
    receiptValue = await submission.transaction.wait();
  } catch (error) {
    const replaced = error as Record<string, unknown> | null;
    if (!replaced || replaced.code !== 'TRANSACTION_REPLACED' || replaced.cancelled === true || replaced.reason === 'cancelled') throw error;
    const replacement = transactionEnvelope(replaced.replacement, submission.transaction);
    transactionHash = replacement.hash;
    receiptValue = replaced.receipt;
  }
  const receipt = tuple(receiptValue, 'Standard OTC V2 receipt');
  if (uint(receipt.status, 'Standard receipt status') !== 1n ||
      bytes32(receipt.hash ?? receipt.transactionHash, 'Standard receipt transaction hash') !== transactionHash ||
      !Array.isArray(receipt.logs)) {
    throw new Error('Standard OTC V2 receipt is unsuccessful or belongs to another transaction.');
  }
  const blockNumber = uint(receipt.blockNumber, 'Standard receipt block number', UINT64_MAX).toString();
  const blockHash = bytes32(receipt.blockHash, 'Standard receipt block hash');
  let match: { args: readonly unknown[]; logIndex: number } | undefined;
  for (const candidate of receipt.logs) {
    if (!candidate || typeof candidate !== 'object') continue;
    const log = candidate as Record<string, unknown>;
    if (address(log.address, 'Standard log address') !== expected.deployment.contractAddress ||
        bytes32(log.blockHash, 'Standard log block hash') !== blockHash ||
        bytes32(log.transactionHash, 'Standard log transaction hash') !== transactionHash ||
        String(log.blockNumber) !== String(receipt.blockNumber) || log.removed === true || !Array.isArray(log.topics)) continue;
    let parsed;
    try { parsed = ACTIONS.parseLog({ topics: log.topics as string[], data: hexBytes(log.data, 'Standard log data') }); } catch { continue; }
    if (!parsed || parsed.name !== expected.expectedEvent) continue;
    const args = parsed.args as unknown as readonly unknown[];
    if (parsed.name === 'NativeCreditWithdrawn' &&
        address(args[0], 'Standard withdrawal recipient') !== expected.ownerAddress) continue;
    if (expected.expectedTradeId !== undefined && uint(args[0], 'Standard event trade ID') !== expected.expectedTradeId) continue;
    if (expected.expectedStatus !== undefined && uint(args[3], 'Standard event status') !== expected.expectedStatus) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Standard log index'));
    if (!Number.isSafeInteger(logIndex) || match) throw new Error('Standard receipt has invalid or duplicate action events.');
    match = { args, logIndex };
  }
  if (!match) throw new Error('Standard receipt is missing the exact action event.');
  const hasTradeId = expected.expectedEvent !== 'NativeCreditWithdrawn';
  return Object.freeze({
    action: submission.action,
    ...(hasTradeId ? { tradeId: uint(match.args[0], 'Confirmed Standard trade ID').toString() } : {}),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash,
    blockNumber,
    blockHash,
    logIndex: match.logIndex
  });
};
