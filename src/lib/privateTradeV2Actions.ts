import { Interface, getAddress } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance } from './appChain';
import { loadCotiEthersModule } from './appShared/core';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';
import {
  packPrivateTradeV2CreateTerms,
  packPrivateTradeV2FillTerms,
  type PrivateTradeV2AssetType,
  type PrivateTradeV2Mode
} from './privateTradeV2Packing';
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

export const PRIVATE_TRADE_V2_ACTION_ABI = [
  'function createOrder((uint8 assetType,address token,uint256 publicAmount) offerAsset,(uint8 assetType,address token,uint256 publicAmount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 expiresAt,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedPrivateTerms) payable returns (uint256 orderId)',
  'function replaceOrder(uint256 originalOrderId,(uint8 assetType,address token,uint256 publicAmount) offerAsset,(uint8 assetType,address token,uint256 publicAmount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 expiresAt,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedPrivateTerms) payable returns (uint256 orderId)',
  'function fillOrder(uint256 orderId,uint64 expectedRevision,uint256 publicFillAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedPrivateFill) payable returns (bool finalFill)',
  'function cancelOrder(uint256 orderId)',
  'function reclaimExpiredOrder(uint256 orderId)',
  'function withdrawNativeCredit()',
  'function getOrderView(uint256 orderId) view returns (((address maker,uint8 status,uint8 mode,(uint8 assetType,address token,uint256 publicAmount) offerAsset,(uint8 assetType,address token,uint256 publicAmount) requestAsset,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint8 fillCount,uint256 rootOrderId,bool offerLocked,bytes32 offerTokenCodeHash,bytes32 requestTokenCodeHash) order,uint8 effectiveStatus,bytes32 pairKey,uint256 replacementOrderId,uint256 replacesOrderId) orderView)',
  'function getPrivateSnapshotForAccount(uint256 orderId) view returns ((bool initialized,uint64 sequence,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) totalOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) totalRequestAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) remainingOfferAmount) snapshot)',
  'function getOrderIdsForMaker(address maker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOrderIdsForFiller(address filler,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getOpenOrderIds(uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'event PrivateOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,uint8 mode,uint8 offerAssetType,address offerToken,uint256 publicOfferAmount,uint8 requestAssetType,address requestToken,uint256 publicRequestAmount,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint256 rootOrderId)',
  'event PrivateOrderFilled(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 mode,uint64 nextRevision,uint8 fillCount,bool finalFill,uint256 publicOfferAmount,uint256 publicRequestAmount)',
  'event PrivateOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedOrderId,uint64 revision)',
  'event NativeCreditWithdrawn(address indexed recipient,uint256 amount)'
] as const;

const ACTIONS = new Interface(PRIVATE_TRADE_V2_ACTION_ABI);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type PrivateTradeV2Asset = Readonly<{
  assetType: PrivateTradeV2AssetType;
  token?: string;
  amount: bigint | number | string;
}>;

export type PrivateTradeV2FillPolicy = Readonly<{
  partialFillsAllowed: boolean;
  minPartialFillBps: bigint | number | string;
  maxFills: bigint | number | string;
}>;

export type PrivateTradeV2FillTerms =
  | Readonly<{ mode: 'fully-private'; maxRequestAmount: bigint | number | string; minOfferAmount: bigint | number | string }>
  | Readonly<{ mode: 'private-offer-public-request'; publicRequestAmount: bigint | number | string; minPrivateOfferAmount: bigint | number | string }>
  | Readonly<{ mode: 'public-offer-private-request'; publicOfferAmount: bigint | number | string; maxPrivateRequestAmount: bigint | number | string }>;

export type PrivateTradeV2Action =
  | Readonly<{
      kind: 'create'; offerAsset: PrivateTradeV2Asset; requestAsset: PrivateTradeV2Asset;
      fillPolicy: PrivateTradeV2FillPolicy; expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'replace'; originalOrderId: bigint | number | string;
      offerAsset: PrivateTradeV2Asset; requestAsset: PrivateTradeV2Asset;
      fillPolicy: PrivateTradeV2FillPolicy; expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'fill'; orderId: bigint | number | string; expectedRevision: bigint | number | string;
      terms: PrivateTradeV2FillTerms;
    }>
  | Readonly<{ kind: 'cancel' | 'reclaim-expired'; orderId: bigint | number | string }>
  | Readonly<{ kind: 'withdraw-native-credit' }>;

export type PrivateTradeV2OrderView = Readonly<{
  orderId: string; maker: string;
  status: 'open' | 'filled' | 'cancelled' | 'expired' | 'replaced';
  mode: PrivateTradeV2Mode;
  offerAsset: Readonly<{ assetType: PrivateTradeV2AssetType; token: string; publicAmount: string }>;
  requestAsset: Readonly<{ assetType: PrivateTradeV2AssetType; token: string; publicAmount: string }>;
  fillPolicy: Readonly<{ partialFillsAllowed: boolean; minPartialFillBps: string; maxFills: string }>;
  createdAt: string; expiresAt: string; revision: string; fillCount: string; rootOrderId: string;
  replacementOrderId: string; replacesOrderId: string;
}>;

export type PrivateTradeV2AccountSnapshot = Readonly<{
  orderId: string; sequence: string; totalOfferAmount: string;
  totalRequestAmount: string; remainingOfferAmount: string;
}>;

export type PrivateTradeV2OrderIdPage = Readonly<{
  orderIds: readonly string[];
  nextOffset: string;
}>;

type Transaction = Readonly<{
  hash: string; chainId: bigint; from: string; to: string; data: string; value: bigint;
  wait: () => Promise<unknown>;
}>;

declare const PRIVATE_SUBMISSION_BRAND: unique symbol;
export type PrivateTradeV2Submission = Readonly<{
  action: PrivateTradeV2Action['kind']; submittedTransactionHash: string; transaction: Transaction;
  readonly [PRIVATE_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateTradeV2Action = Readonly<{
  action: PrivateTradeV2Action['kind']; orderId?: string; transactionHash: string;
  submittedTransactionHash: string; blockNumber: string; blockHash: string; logIndex: number;
}>;

type SubmissionBinding = Readonly<{
  deployment: AttestedTradeHistoryV2Deployment; ownerAddress: string;
  expectedEvent: 'PrivateOrderOpened' | 'PrivateOrderFilled' | 'PrivateOrderStatusChanged' | 'NativeCreditWithdrawn';
  expectedOrderId?: bigint; expectedStatus?: bigint;
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

const assertScope = async (capability: OwnerTradeV2MetaMaskCapability, deployment: AttestedTradeHistoryV2Deployment) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'private-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) throw new Error('Private OTC V2 capability and deployment chains differ.');
  return binding;
};

const assetType = (value: unknown, label: string): PrivateTradeV2AssetType => {
  const parsed = uint(value, label, 2n);
  return parsed === 0n ? 'native' : parsed === 1n ? 'erc20' : 'private-erc20';
};
const mode = (value: unknown): PrivateTradeV2Mode => {
  const parsed = uint(value, 'Private order mode', 2n);
  return parsed === 0n ? 'fully-private' : parsed === 1n ? 'private-offer-public-request' : 'public-offer-private-request';
};

const orderAsset = (asset: PrivateTradeV2Asset, publicAmount: bigint, label: string) => ({
  assetType: asset.assetType === 'native' ? 0 : asset.assetType === 'erc20' ? 1 : 2,
  token: asset.assetType === 'native' ? ZERO_ADDRESS : address(asset.token, `${label} token`),
  publicAmount
});

const fillPolicy = (value: PrivateTradeV2FillPolicy) => {
  const minPartialFillBps = uint(value.minPartialFillBps, 'Private minimum partial fill BPS', 5_000n);
  const maxFills = uint(value.maxFills, 'Private maximum fills', 64n);
  if (maxFills === 0n || (!value.partialFillsAllowed && (minPartialFillBps !== 0n || maxFills !== 1n))) {
    throw new Error('Private full-fill orders require zero minimum BPS and exactly one fill.');
  }
  return { partialFillsAllowed: value.partialFillsAllowed, minPartialFillBps, maxFills };
};

const expiry = (value: unknown): bigint => {
  const parsed = uint(value, 'Private order expiry', UINT64_MAX);
  if (parsed !== 0n && parsed <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('Private order expiry must be future or zero.');
  return parsed;
};

const userCiphertext = (value: unknown, label: string) => {
  const wrapped = tuple(value, label);
  const user = tuple(wrapped.userCiphertext ?? wrapped[1], `${label} user ciphertext`);
  return { ciphertextHigh: uint(user.ciphertextHigh ?? user[0], `${label} high`), ciphertextLow: uint(user.ciphertextLow ?? user[1], `${label} low`) };
};

export const readPrivateTradeV2OrderView = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string;
}): Promise<PrivateTradeV2OrderView> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Private order ID');
  if (id === 0n) throw new Error('Private order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, PRIVATE_TRADE_V2_ACTION_ABI, getOwnerTradeV2ReadRunner(binding)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const view = tuple(await contract.getOrderView(id), 'Private order view');
  const order = tuple(view.order ?? view[0], 'Private order');
  const parseAsset = (value: unknown, label: string) => {
    const item = tuple(value, label); const type = assetType(item.assetType ?? item[0], `${label} type`);
    return { assetType: type, token: address(item.token ?? item[1], `${label} token`, type === 'native'), publicAmount: uint(item.publicAmount ?? item[2], `${label} public amount`).toString() };
  };
  const policy = tuple(order.fillPolicy ?? order[5], 'Private fill policy');
  const status = uint(view.effectiveStatus ?? view[1], 'Private order status', 5n);
  if (status === 0n) throw new Error('Private order does not exist.');
  const statuses = ['none', 'open', 'filled', 'cancelled', 'expired', 'replaced'] as const;
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(), maker: address(order.maker ?? order[0], 'Private order maker'),
    status: statuses[Number(status)] as PrivateTradeV2OrderView['status'], mode: mode(order.mode ?? order[2]),
    offerAsset: Object.freeze(parseAsset(order.offerAsset ?? order[3], 'Private offer asset')),
    requestAsset: Object.freeze(parseAsset(order.requestAsset ?? order[4], 'Private request asset')),
    fillPolicy: Object.freeze({ partialFillsAllowed: (policy.partialFillsAllowed ?? policy[0]) === true, minPartialFillBps: uint(policy.minPartialFillBps ?? policy[1], 'Private minimum fill BPS').toString(), maxFills: uint(policy.maxFills ?? policy[2], 'Private maximum fills').toString() }),
    createdAt: uint(order.createdAt ?? order[6], 'Private creation time', UINT64_MAX).toString(),
    expiresAt: uint(order.expiresAt ?? order[7], 'Private expiry', UINT64_MAX).toString(),
    revision: uint(order.revision ?? order[8], 'Private revision', UINT64_MAX).toString(),
    fillCount: uint(order.fillCount ?? order[9], 'Private fill count', 64n).toString(), rootOrderId: uint(order.rootOrderId ?? order[10], 'Private root order ID').toString(),
    replacementOrderId: uint(view.replacementOrderId ?? view[3], 'Private replacement order ID').toString(), replacesOrderId: uint(view.replacesOrderId ?? view[4], 'Private replaced order ID').toString()
  });
};

export const readPrivateTradeV2AccountSnapshot = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; orderId: bigint | number | string;
}): Promise<PrivateTradeV2AccountSnapshot> => {
  const binding = await assertScope(capability, deployment); const id = uint(orderId, 'Private order ID');
  if (id === 0n) throw new Error('Private order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, PRIVATE_TRADE_V2_ACTION_ABI, binding.signer) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const snapshot = tuple(await contract.getPrivateSnapshotForAccount(id), 'Private account snapshot');
  if ((snapshot.initialized ?? snapshot[0]) !== true) throw new Error('Private account snapshot is not initialized.');
  const offer = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(snapshot.totalOfferAmount ?? snapshot[2], 'Private total offer')
  );
  const request = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(snapshot.totalRequestAmount ?? snapshot[3], 'Private total request')
  );
  const remaining = decryptPrivateUint256Output(
    binding.signer,
    userCiphertext(snapshot.remainingOfferAmount ?? snapshot[4], 'Private remaining offer')
  );
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ orderId: id.toString(), sequence: uint(snapshot.sequence ?? snapshot[1], 'Private snapshot sequence', UINT64_MAX).toString(), totalOfferAmount: uint(offer, 'Decrypted total offer').toString(), totalRequestAmount: uint(request, 'Decrypted total request').toString(), remainingOfferAmount: uint(remaining, 'Decrypted remaining offer').toString() });
};

export const readPrivateTradeV2OrderIds = async ({ capability, deployment, scope, offset = 0n, limit = 50n }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'maker' | 'filler' | 'open';
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<PrivateTradeV2OrderIdPage> => {
  const binding = await assertScope(capability, deployment);
  const pageOffset = uint(offset, 'Private order offset');
  const pageLimit = uint(limit, 'Private order limit');
  if (pageLimit > 100n) throw new Error('Private order limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const method = scope === 'maker'
    ? 'getOrderIdsForMaker'
    : scope === 'filler'
      ? 'getOrderIdsForFiller'
      : 'getOpenOrderIds';
  const raw = scope === 'maker' || scope === 'filler'
    ? await contract[method](binding.ownerAddress, pageOffset, pageLimit)
    : await contract[method](pageOffset, pageLimit);
  const page = tuple(raw, 'Private order ID page');
  const rawIds = page.ids ?? page[0];
  if (!Array.isArray(rawIds)) throw new Error('Private order ID page is malformed.');
  const orderIds = rawIds.map((value, index) => {
    const id = uint(value, `Private order ID ${index + 1}`);
    if (id === 0n) throw new Error('Private order ID page contains zero.');
    return id.toString();
  });
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderIds: Object.freeze(orderIds),
    nextOffset: uint(page.nextOffset ?? page[1], 'Private order next offset').toString()
  });
};

const normalizeTransaction = (value: unknown, expected: Omit<Transaction, 'hash' | 'wait'>, waitForReceipt?: (hash: string) => Promise<unknown>): Transaction => {
  const tx = tuple(value, 'Private OTC transaction'); if (typeof tx.wait !== 'function') throw new Error('Private OTC transaction cannot be confirmed.');
  const hash = bytes32(tx.hash, 'Private transaction hash');
  const normalized = Object.freeze({ hash, chainId: resolveBoundTransactionChain(tx.chainId, expected.chainId, 'Private OTC'), from: address(tx.from, 'Private transaction sender'), to: address(tx.to, 'Private transaction target'), data: hexBytes(tx.data, 'Private transaction data'), value: uint(tx.value, 'Private transaction value'), wait: waitForReceipt ? () => waitForReceipt(hash) : (tx.wait as () => Promise<unknown>).bind(value) });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from || normalized.to !== expected.to || normalized.data !== expected.data || normalized.value !== expected.value) throw new Error('Private OTC transaction does not match the exact intended action.');
  return normalized;
};

const prepared = async (action: PrivateTradeV2Action, capability: OwnerTradeV2MetaMaskCapability, deployment: AttestedTradeHistoryV2Deployment) => {
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  if (action.kind === 'withdraw-native-credit') return { functionName: 'withdrawNativeCredit', args: [] as unknown[], value: 0n, expectedEvent: 'NativeCreditWithdrawn' as const };
  if (action.kind === 'cancel' || action.kind === 'reclaim-expired') {
    const orderId = uint(action.orderId, 'Private order ID'); if (orderId === 0n) throw new Error('Private order ID cannot be zero.');
    return { functionName: action.kind === 'cancel' ? 'cancelOrder' : 'reclaimExpiredOrder', args: [orderId], value: 0n, expectedEvent: 'PrivateOrderStatusChanged' as const, expectedOrderId: orderId, expectedStatus: action.kind === 'cancel' ? 3n : 4n };
  }
  if (action.kind === 'fill') {
    const orderId = uint(action.orderId, 'Private order ID'); const expectedRevision = uint(action.expectedRevision, 'Private expected revision', UINT64_MAX);
    const view = await readPrivateTradeV2OrderView({ capability, deployment, orderId });
    if (view.status !== 'open' || view.revision !== expectedRevision.toString() || view.mode !== action.terms.mode) throw new Error('Private fill review is stale or belongs to another order mode.');
    const packed = packPrivateTradeV2FillTerms(action.terms); const selector = ACTIONS.getFunction('fillOrder')?.selector;
    if (!selector) throw new Error('Private fill selector is unavailable.');
    const encrypted = await encryptPrivateUint256Input(binding.signer, packed.packedPrivateFill, deployment.contractAddress, selector);
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return { functionName: 'fillOrder', args: [orderId, expectedRevision, packed.publicFillAmount, encrypted], value: view.requestAsset.assetType === 'native' ? packed.publicFillAmount : 0n, expectedEvent: 'PrivateOrderFilled' as const, expectedOrderId: orderId, requestAsset: view.requestAsset, approvalAmount: action.terms.mode === 'fully-private' ? uint(action.terms.maxRequestAmount, 'Private maximum request', UINT128_MAX) : action.terms.mode === 'private-offer-public-request' ? uint(action.terms.publicRequestAmount, 'Public request amount', UINT128_MAX) : uint(action.terms.maxPrivateRequestAmount, 'Maximum private request', UINT128_MAX) };
  }
  const create = action as Extract<PrivateTradeV2Action, { kind: 'create' | 'replace' }>;
  const packed = packPrivateTradeV2CreateTerms({ offerAssetType: create.offerAsset.assetType, offerAmount: create.offerAsset.amount, requestAssetType: create.requestAsset.assetType, requestAmount: create.requestAsset.amount });
  const functionName = create.kind === 'create' ? 'createOrder' : 'replaceOrder'; const selector = ACTIONS.getFunction(functionName)?.selector;
  if (!selector) throw new Error('Private create selector is unavailable.');
  const encrypted = await encryptPrivateUint256Input(binding.signer, packed.packedPrivateTerms, deployment.contractAddress, selector); await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const offer = orderAsset(create.offerAsset, packed.publicOfferAmount, 'Private offer'); const request = orderAsset(create.requestAsset, packed.publicRequestAmount, 'Private request');
  const original = create.kind === 'replace' ? uint(create.originalOrderId, 'Original private order ID') : undefined; if (original === 0n) throw new Error('Original private order ID cannot be zero.');
  return { functionName, args: create.kind === 'create' ? [offer, request, fillPolicy(create.fillPolicy), expiry(create.expiresAt), encrypted] : [original!, offer, request, fillPolicy(create.fillPolicy), expiry(create.expiresAt), encrypted], value: offer.assetType === 0 ? uint(create.offerAsset.amount, 'Native private offer', UINT128_MAX) : 0n, expectedEvent: 'PrivateOrderOpened' as const, offerAsset: create.offerAsset, approvalAmount: uint(create.offerAsset.amount, 'Private offer approval', UINT128_MAX) };
};

export const executePrivateTradeV2Action = async ({ capability, deployment, action }: { capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; action: PrivateTradeV2Action }): Promise<ConfirmedPrivateTradeV2Action> => {
  const binding = await assertScope(capability, deployment); const intent = await prepared(action, capability, deployment);
  const approvalAsset = 'offerAsset' in intent ? intent.offerAsset : 'requestAsset' in intent ? intent.requestAsset : undefined;
  if (approvalAsset && approvalAsset.assetType !== 'native') {
    if (intent.approvalAmount === undefined) throw new Error('Private token approval amount is missing.');
    await ensureTradeTokenAllowance(binding.signer, binding.ownerAddress, address(approvalAsset.token, 'Private approval token'), intent.approvalAmount, approvalAsset.assetType === 'private-erc20' ? 'private-erc20' : 'erc20', deployment.contractAddress);
  }
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const data = ACTIONS.encodeFunctionData(intent.functionName, intent.args).toLowerCase(); const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, PRIVATE_TRADE_V2_ACTION_ABI, binding.signer) as unknown as Record<string, unknown>; const write = contract[intent.functionName]; if (typeof write !== 'function') throw new Error('Private OTC action is unavailable.');
  const raw = await (write as (...args: unknown[]) => Promise<unknown>)(...intent.args, ...(intent.value > 0n ? [{ value: intent.value }] : [])); await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const transaction = normalizeTransaction(raw, { chainId: binding.chainId, from: binding.ownerAddress, to: deployment.contractAddress, data, value: intent.value }, binding.readProvider ? (hash) => waitForOwnerTradeV2Receipt(binding, hash) : undefined);
  const submission = Object.freeze({ action: action.kind, submittedTransactionHash: transaction.hash, transaction }) as PrivateTradeV2Submission; SUBMISSIONS.set(submission, Object.freeze({ deployment, ownerAddress: binding.ownerAddress, expectedEvent: intent.expectedEvent, expectedOrderId: intent.expectedOrderId, expectedStatus: intent.expectedStatus }));
  return confirmPrivateTradeV2Action(submission);
};

export const confirmPrivateTradeV2Action = async (submission: PrivateTradeV2Submission): Promise<ConfirmedPrivateTradeV2Action> => {
  const expected = submission && SUBMISSIONS.get(submission); if (!expected) throw new Error('Private OTC submission is not locally prepared.');
  let receiptValue: unknown; let transactionHash = submission.transaction.hash;
  try { receiptValue = await submission.transaction.wait(); } catch (error) { const replaced = error as Record<string, unknown> | null; if (!replaced || replaced.code !== 'TRANSACTION_REPLACED' || replaced.cancelled === true || replaced.reason === 'cancelled') throw error; const replacement = normalizeTransaction(replaced.replacement, submission.transaction); transactionHash = replacement.hash; receiptValue = replaced.receipt; }
  const receipt = tuple(receiptValue, 'Private receipt'); if (uint(receipt.status, 'Private receipt status') !== 1n || bytes32(receipt.hash ?? receipt.transactionHash, 'Private receipt hash') !== transactionHash || !Array.isArray(receipt.logs)) throw new Error('Private receipt is unsuccessful or belongs to another transaction.');
  const blockNumber = uint(receipt.blockNumber, 'Private receipt block', UINT64_MAX).toString(); const blockHash = bytes32(receipt.blockHash, 'Private receipt block hash'); let match: { args: readonly unknown[]; logIndex: number } | undefined;
  for (const candidate of receipt.logs) { if (!candidate || typeof candidate !== 'object') continue; const log = candidate as Record<string, unknown>; if (address(log.address, 'Private log address') !== expected.deployment.contractAddress || bytes32(log.blockHash, 'Private log block hash') !== blockHash || bytes32(log.transactionHash, 'Private log transaction hash') !== transactionHash || String(log.blockNumber) !== String(receipt.blockNumber) || log.removed === true || !Array.isArray(log.topics)) continue; let parsed; try { parsed = ACTIONS.parseLog({ topics: log.topics as string[], data: hexBytes(log.data, 'Private log data') }); } catch { continue; } if (!parsed || parsed.name !== expected.expectedEvent) continue; const args = parsed.args as unknown as readonly unknown[]; if (parsed.name === 'NativeCreditWithdrawn' && address(args[0], 'Private withdrawal recipient') !== expected.ownerAddress) continue; if (expected.expectedOrderId !== undefined && uint(args[0], 'Private event order ID') !== expected.expectedOrderId) continue; if (expected.expectedStatus !== undefined && uint(args[3], 'Private event status') !== expected.expectedStatus) continue; const logIndex = Number(uint(log.index ?? log.logIndex, 'Private log index')); if (!Number.isSafeInteger(logIndex) || match) throw new Error('Private receipt has invalid or duplicate action events.'); match = { args, logIndex }; }
  if (!match) throw new Error('Private receipt is missing the exact action event.'); return Object.freeze({ action: submission.action, ...(expected.expectedEvent !== 'NativeCreditWithdrawn' ? { orderId: uint(match.args[0], 'Confirmed private order ID').toString() } : {}), transactionHash, submittedTransactionHash: submission.submittedTransactionHash, blockNumber, blockHash, logIndex: match.logIndex });
};
