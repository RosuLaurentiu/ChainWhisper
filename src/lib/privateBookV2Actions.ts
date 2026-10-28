import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { CURRENT_P2P_BINDING, isPrivateBookV2RuntimeHash } from './currentP2PBinding';
export { PRIVATE_BOOK_V2_RUNTIME_HASH, isPrivateBookV2RuntimeHash } from './currentP2PBinding';
import { ensureLinkTradeV2Allowance, readLinkTradeV2Allowance, sendLinkTradeV2Transaction, confirmLinkTradeV2Transaction, type LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';
import { createPrivateBookV2Journal, type PrivateBookV2RecoveryMeta } from './linkTradeV2CreationJournal';
import { loadCotiEthersModule } from './appShared/core';
import { decryptPrivateUint256Output, encryptPrivateUint256Input, EMPTY_PRIVATE_UINT256_INPUT, type PrivateUint256Input } from './privateUint256';
import {
  preparePrivateBookV2CreateTerms, preparePrivateBookV2FillTerms, normalizePrivateBookV2Price,
  privateBookV2Uint, normalizePrivateBookV2RecoveryAction, type PrivateBookV2AssetType, type PrivateBookV2Mode,
  type PrivateBookV2Price, type PrivateBookV2FillTerms
} from './privateBookV2Terms';
import {
  assertAttestedTradeHistoryV2Deployment,
  type AttestedTradeHistoryV2Deployment
} from './tradeHistoryV2Chain';
import {
  assertOwnerTradeV2CapabilityCurrent,
  assertOwnerTradeV2CapabilitySnapshotCurrent,
  getOwnerTradeV2CapabilityBinding,
  getOwnerTradeV2ReadRunner,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

export const PRIVATE_BOOK_V2_ACTION_ABI = [
  "event NativeCreditWithdrawn(address indexed recipient, uint256 amount)",
  "event PrivateOrderFilled(uint256 indexed orderId, address indexed filler, address indexed maker, uint8 mode, uint64 nextRevision, uint64 fillCount, uint256 publicOfferAmount, uint256 publicRequestAmount)",
  "event PrivateOrderOpened(uint256 indexed orderId, address indexed maker, bytes32 indexed pairKey, uint8 mode, uint8 offerAssetType, address offerToken, uint256 publicOfferAmount, uint8 requestAssetType, address requestToken, uint256 publicRequestAmount, (uint128 offerAmount, uint128 requestAmount) priceTerms, (bool partialFillsAllowed, uint16 minPartialFillBps, uint8 maxFills) fillPolicy, uint64 createdAt, uint64 expiresAt, uint64 revision, uint256 rootOrderId)",
  "event PrivateOrderStatusChanged(uint256 indexed orderId, address indexed maker, uint8 previousStatus, uint8 nextStatus, address actor, uint256 relatedOrderId, uint64 revision)",
  "function cancelOrder(uint256 orderId)",
  "function createOrder((uint8 assetType, address token, uint256 publicAmount) offerAsset, (uint8 assetType, address token, uint256 publicAmount) requestAsset, (uint128 offerAmount, uint128 requestAmount) priceTerms, (bool partialFillsAllowed, uint16 minPartialFillBps, uint8 maxFills) fillPolicy, uint64 expiresAt, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) encryptedOfferBudget) payable returns (uint256 orderId)",
  "function fillOrder(uint256 orderId, uint64 expectedRevision, uint256 publicFillAmount, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) encryptedPrivateFill) payable",
  "function getOpenOrderIds(uint256 offset, uint256 limit) view returns (uint256[], uint256)",
  "function getOrderIdsForFiller(address filler, uint256 offset, uint256 limit) view returns (uint256[], uint256)",
  "function getOrderIdsForMaker(address maker, uint256 offset, uint256 limit) view returns (uint256[], uint256)",
  "function getOrderView(uint256 orderId) view returns (((address maker, uint8 status, uint8 mode, (uint8 assetType, address token, uint256 publicAmount) offerAsset, (uint8 assetType, address token, uint256 publicAmount) requestAsset, (uint128 offerAmount, uint128 requestAmount) priceTerms, (bool partialFillsAllowed, uint16 minPartialFillBps, uint8 maxFills) fillPolicy, uint64 createdAt, uint64 expiresAt, uint64 revision, uint64 fillCount, uint256 rootOrderId, bool offerLocked, bytes32 offerTokenCodeHash, bytes32 requestTokenCodeHash) order, uint8 effectiveStatus, bytes32 pairKey, uint256 replacementOrderId, uint256 replacesOrderId) orderView)",
  "function getPublicBudget(uint256 orderId) view returns ((bool visible, uint256 amount))",
  "function getPrivateSnapshotForAccount(uint256 orderId) view returns ((bool initialized, uint64 sequence, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) totalOfferAmount, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) totalRequestAmount, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) remainingOfferAmount) snapshot)",
  "function reclaimExpiredOrder(uint256 orderId)",
  "function replaceOrder(uint256 originalOrderId, (uint8 assetType, address token, uint256 publicAmount) offerAsset, (uint8 assetType, address token, uint256 publicAmount) requestAsset, (uint128 offerAmount, uint128 requestAmount) priceTerms, (bool partialFillsAllowed, uint16 minPartialFillBps, uint8 maxFills) fillPolicy, uint64 expiresAt, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) encryptedOfferBudget) payable returns (uint256 orderId)",
  "function setPublicBudgetVisibility(uint256 orderId, bool visible)",
  "function withdrawNativeCredit()"
] as const;

// The linked disclosure library emits this event in the Book's address space.
const ACTIONS = new Interface([...PRIVATE_BOOK_V2_ACTION_ABI, 'event TradeBudgetVisibility(uint256 indexed tradeId, bool visible, uint256 amount)']);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type PrivateBookV2Asset = Readonly<{
  assetType: PrivateBookV2AssetType;
  token?: string;
  amount: bigint | number | string;
}>;

export type PrivateBookV2Action =
  | Readonly<{
      kind: 'create'; offerAsset: PrivateBookV2Asset; requestAsset: Omit<PrivateBookV2Asset, 'amount'>;
      priceTerms: PrivateBookV2Price; expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'replace'; originalOrderId: bigint | number | string;
      offerAsset: PrivateBookV2Asset; requestAsset: Omit<PrivateBookV2Asset, 'amount'>;
      priceTerms: PrivateBookV2Price; expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'fill'; orderId: bigint | number | string; expectedRevision: bigint | number | string;
      terms: PrivateBookV2FillTerms;
    }>
  | Readonly<{ kind: 'cancel' | 'reclaim-expired'; orderId: bigint | number | string }>
  | Readonly<{ kind: 'budget-visibility'; orderId: bigint | number | string; expectedRevision: bigint | number | string; visible: boolean }>
  | Readonly<{ kind: 'withdraw-native-credit' }>;

export type PrivateBookV2OrderView = Readonly<{
  orderId: string; maker: string;
  status: 'open' | 'filled' | 'cancelled' | 'expired' | 'replaced';
  mode: PrivateBookV2Mode;
  offerAsset: Readonly<{ assetType: PrivateBookV2AssetType; token: string; publicAmount: string }>;
  requestAsset: Readonly<{ assetType: PrivateBookV2AssetType; token: string; publicAmount: string }>;
  fillPolicy: Readonly<{ partialFillsAllowed: boolean; minPartialFillBps: string; maxFills: string }>;
  priceTerms: Readonly<{ offerAmount: string; requestAmount: string }>;
  offerLocked: boolean; offerTokenCodeHash: string; requestTokenCodeHash: string; pairKey: string;
  createdAt: string; expiresAt: string; revision: string; fillCount: string; rootOrderId: string;
  replacementOrderId: string; replacesOrderId: string;
  publicBudget?: Readonly<{ visible: boolean; amount: string }>;
}>;

export type PrivateBookV2AccountSnapshot = Readonly<{
  orderId: string; sequence: string; totalOfferAmount: string;
  totalRequestAmount: string; remainingOfferAmount: string;
}>;

export type PrivateBookV2OrderIdPage = Readonly<{
  orderIds: readonly string[];
  nextOffset: string;
}>;

export type ConfirmedPrivateBookV2Action = Readonly<{
  action: PrivateBookV2Action['kind']; orderId?: string; transactionHash: string;
  submittedTransactionHash: string; blockNumber: string; blockHash: string; logIndex: number;
}>;

const uint = privateBookV2Uint;

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
  if (!isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)) {
    throw new Error('Private book runtime is not the promoted public-price contract.');
  }
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) throw new Error('Private OTC V2 capability and deployment chains differ.');
  return binding;
};

const assetType = (value: unknown, label: string): PrivateBookV2AssetType => {
  const parsed = uint(value, label, 2n);
  return parsed === 0n ? 'native' : parsed === 1n ? 'erc20' : 'private-erc20';
};
const mode = (value: unknown): PrivateBookV2Mode => {
  const parsed = uint(value, 'Private order mode', 2n);
  return parsed === 0n ? 'private-pair' : parsed === 1n ? 'private-offer-public-request' : 'public-offer-private-request';
};

const orderAsset = (asset: Pick<PrivateBookV2Asset, 'assetType' | 'token'>, publicAmount: bigint, label: string) => ({
  assetType: asset.assetType === 'native' ? 0 : asset.assetType === 'erc20' ? 1 : 2,
  token: asset.assetType === 'native' ? ZERO_ADDRESS : address(asset.token, `${label} token`),
  publicAmount
});

const expiry = (value: unknown): bigint => {
  const parsed = uint(value, 'Private order expiry', UINT64_MAX);
  if (parsed !== 0n && (parsed <= BigInt(Math.floor(Date.now() / 1000)) || parsed > BigInt(Math.floor(Date.now() / 1000)) + 30n * 24n * 60n * 60n)) throw new Error('Private order expiry must be within 30 days or zero.');
  return parsed;
};

const userCiphertext = (value: unknown, label: string) => {
  const wrapped = tuple(value, label);
  const user = tuple(wrapped.userCiphertext ?? wrapped[1], `${label} user ciphertext`);
  return { ciphertextHigh: uint(user.ciphertextHigh ?? user[0], `${label} high`), ciphertextLow: uint(user.ciphertextLow ?? user[1], `${label} low`) };
};

export const readPrivateBookV2OrderView = async ({ capability, deployment, orderId, includePublicBudget = true }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment;
  orderId: bigint | number | string; includePublicBudget?: boolean;
}): Promise<PrivateBookV2OrderView> => {
  const binding = await assertScope(capability, deployment);
  const id = uint(orderId, 'Private order ID');
  if (id === 0n) throw new Error('Private order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, PRIVATE_BOOK_V2_ACTION_ABI, getOwnerTradeV2ReadRunner(binding)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const view = tuple(await contract.getOrderView(id), 'Private order view');
  const order = tuple(view.order ?? view[0], 'Private order');
  const parseAsset = (value: unknown, label: string) => {
    const item = tuple(value, label); const type = assetType(item.assetType ?? item[0], `${label} type`);
    return { assetType: type, token: address(item.token ?? item[1], `${label} token`, type === 'native'), publicAmount: uint(item.publicAmount ?? item[2], `${label} public amount`).toString() };
  };
  const policy = tuple(order.fillPolicy ?? order[6], 'Private fill policy');
  const price = tuple(order.priceTerms ?? order[5], 'Private public price');
  const status = uint(view.effectiveStatus ?? view[1], 'Private order status', 5n);
  if (status === 0n) throw new Error('Private order does not exist.');
  const statuses = ['none', 'open', 'filled', 'cancelled', 'expired', 'replaced'] as const;
  let publicBudget: PrivateBookV2OrderView['publicBudget'];
  if (includePublicBudget) {
    const budget = tuple(await contract.getPublicBudget(id), 'Public trade budget');
    const visible = budget.visible ?? budget[0], amount = uint(budget.amount ?? budget[1], 'Public trade budget amount').toString();
    if (typeof visible !== 'boolean' || !visible && amount !== '0') throw new Error('Public trade budget is invalid.');
    publicBudget = Object.freeze({ visible, amount });
  }
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({
    orderId: id.toString(), maker: address(order.maker ?? order[0], 'Private order maker'),
    status: statuses[Number(status)] as PrivateBookV2OrderView['status'], mode: mode(order.mode ?? order[2]),
    offerAsset: Object.freeze(parseAsset(order.offerAsset ?? order[3], 'Private offer asset')),
    requestAsset: Object.freeze(parseAsset(order.requestAsset ?? order[4], 'Private request asset')),
    fillPolicy: Object.freeze({ partialFillsAllowed: (policy.partialFillsAllowed ?? policy[0]) === true, minPartialFillBps: uint(policy.minPartialFillBps ?? policy[1], 'Private minimum fill BPS').toString(), maxFills: uint(policy.maxFills ?? policy[2], 'Private maximum fills').toString() }),
    priceTerms: Object.freeze({ offerAmount: uint(price.offerAmount ?? price[0], 'Public price offer units', UINT128_MAX).toString(), requestAmount: uint(price.requestAmount ?? price[1], 'Public price request units', UINT128_MAX).toString() }),
    offerLocked: (order.offerLocked ?? order[12]) === true,
    offerTokenCodeHash: bytes32(order.offerTokenCodeHash ?? order[13], 'Offer token hash'),
    requestTokenCodeHash: bytes32(order.requestTokenCodeHash ?? order[14], 'Request token hash'),
    pairKey: bytes32(view.pairKey ?? view[2], 'Private pair key'),
    createdAt: uint(order.createdAt ?? order[7], 'Private creation time', UINT64_MAX).toString(),
    expiresAt: uint(order.expiresAt ?? order[8], 'Private expiry', UINT64_MAX).toString(),
    revision: uint(order.revision ?? order[9], 'Private revision', UINT64_MAX).toString(),
    fillCount: uint(order.fillCount ?? order[10], 'Private fill count', UINT64_MAX).toString(), rootOrderId: uint(order.rootOrderId ?? order[11], 'Private root order ID').toString(),
    replacementOrderId: uint(view.replacementOrderId ?? view[3], 'Private replacement order ID').toString(), replacesOrderId: uint(view.replacesOrderId ?? view[4], 'Private replaced order ID').toString(),
    ...(publicBudget ? { publicBudget } : {})
  });
};

export const readPrivateBookV2AccountSnapshot = async ({ capability, deployment, orderId }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; orderId: bigint | number | string;
}): Promise<PrivateBookV2AccountSnapshot> => {
  const binding = await assertScope(capability, deployment); const id = uint(orderId, 'Private order ID');
  if (id === 0n) throw new Error('Private order ID cannot be zero.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, PRIVATE_BOOK_V2_ACTION_ABI, binding.signer) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
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

export const readPrivateBookV2OrderIds = async ({ capability, deployment, scope, offset = 0n, limit = 50n }: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'maker' | 'filler' | 'open';
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<PrivateBookV2OrderIdPage> => {
  const binding = await assertScope(capability, deployment);
  const pageOffset = uint(offset, 'Private order offset');
  const pageLimit = uint(limit, 'Private order limit');
  if (pageLimit > 100n) throw new Error('Private order limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_BOOK_V2_ACTION_ABI,
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

/** Pure validation precedes encryption. The caller supplies the bound encryptor. */
export const preparePrivateBookV2Intent = async (
  action: PrivateBookV2Action,
  encrypt: (value: bigint, selector: string) => Promise<PrivateUint256Input>,
  view?: PrivateBookV2OrderView
) => {
  if (action.kind === 'budget-visibility') {
    const id = uint(action.orderId, 'Private order ID'), revision = uint(action.expectedRevision, 'Private expected revision', UINT64_MAX);
    if (id === 0n || typeof action.visible !== 'boolean') throw new Error('Budget visibility terms are invalid.');
    if (!view || view.orderId !== id.toString() || view.revision !== revision.toString()) throw new Error('Budget visibility review is stale.');
    return { functionName: 'setPublicBudgetVisibility', args: [id, action.visible], value: 0n,
      expectedEvent: 'TradeBudgetVisibility' as const, expectedOrderId: id, expectedVisible: action.visible };
  }
  if (action.kind === 'withdraw-native-credit') return { functionName: 'withdrawNativeCredit', args: [] as unknown[], value: 0n, expectedEvent: 'NativeCreditWithdrawn' as const };
  if (action.kind === 'cancel' || action.kind === 'reclaim-expired') {
    const orderId = uint(action.orderId, 'Private order ID'); if (orderId === 0n) throw new Error('Private order ID cannot be zero.');
    return { functionName: action.kind === 'cancel' ? 'cancelOrder' : 'reclaimExpiredOrder', args: [orderId], value: 0n, expectedEvent: 'PrivateOrderStatusChanged' as const, expectedOrderId: orderId, expectedStatus: action.kind === 'cancel' ? 3n : 4n };
  }
  if (action.kind === 'fill') {
    const orderId = uint(action.orderId, 'Private order ID');
    const expectedRevision = uint(action.expectedRevision, 'Private expected revision', UINT64_MAX);
    const terms = preparePrivateBookV2FillTerms(action.terms);
    if (!view || view.orderId !== orderId.toString() || view.status !== 'open' || view.revision !== expectedRevision.toString() || view.mode !== terms.mode) throw new Error('Private fill review is stale or belongs to another order mode.');
    const reviewedPrice = normalizePrivateBookV2Price(view.priceTerms);
    if (reviewedPrice.offerAmount !== terms.priceTerms.offerAmount || reviewedPrice.requestAmount !== terms.priceTerms.requestAmount) throw new Error('Private fill price differs from the reviewed order.');
    const encrypted = await encrypt(terms.privateFill, ACTIONS.getFunction('fillOrder')!.selector);
    return { functionName: 'fillOrder', args: [orderId, expectedRevision, terms.publicFillAmount, encrypted], value: view.requestAsset.assetType === 'native' ? terms.publicFillAmount : 0n, expectedEvent: 'PrivateOrderFilled' as const, expectedOrderId: orderId, requestAsset: view.requestAsset, approvalAmount: terms.approvalAmount };
  }
  const create = action as Extract<PrivateBookV2Action, { kind: 'create' | 'replace' }>;
  if ('fillPolicy' in create || 'amount' in create.requestAsset) throw new Error('Legacy private order terms are not supported by this adapter.');
  const terms = preparePrivateBookV2CreateTerms({ offerAssetType: create.offerAsset.assetType, requestAssetType: create.requestAsset.assetType, offerBudget: create.offerAsset.amount, priceTerms: create.priceTerms });
  const offer = orderAsset(create.offerAsset, terms.publicOfferAmount, 'Private offer');
  const request = orderAsset(create.requestAsset, terms.publicRequestAmount, 'Private request');
  if (offer.token === request.token) throw new Error('Offer and request tokens must differ.');
  const expiresAt = expiry(create.expiresAt);
  const original = create.kind === 'replace' ? uint(create.originalOrderId, 'Original private order ID') : undefined;
  if (original === 0n) throw new Error('Original private order ID cannot be zero.');
  const functionName = create.kind === 'create' ? 'createOrder' : 'replaceOrder';
  const encrypted = terms.privateInputCount === 0 ? EMPTY_PRIVATE_UINT256_INPUT : await encrypt(terms.privateOfferBudget, ACTIONS.getFunction(functionName)!.selector);
  const common = [offer, request, terms.priceTerms, { partialFillsAllowed: false, minPartialFillBps: 0n, maxFills: 0n }, expiresAt, encrypted];
  return { functionName, args: create.kind === 'create' ? common : [original!, ...common], value: offer.assetType === 0 ? terms.offerBudget : 0n, expectedEvent: 'PrivateOrderOpened' as const, offerAsset: create.offerAsset, approvalAmount: terms.offerBudget };
};

const prepared = async (action: PrivateBookV2Action, capability: OwnerTradeV2MetaMaskCapability, deployment: AttestedTradeHistoryV2Deployment) => {
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  const view = action.kind === 'fill' || action.kind === 'budget-visibility' ? await readPrivateBookV2OrderView({ capability, deployment, orderId: action.orderId, includePublicBudget: false }) : undefined;
  if (action.kind === 'budget-visibility' && view?.maker !== binding.ownerAddress.toLowerCase()) throw new Error('Only the maker can change budget visibility.');
  // Validate and determine the public recovery scope before any encrypted-input signature.
  const intent = await preparePrivateBookV2Intent(action, async () => EMPTY_PRIVATE_UINT256_INPUT, view);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return { intent, view };
};

type BookJournal = ReturnType<typeof createPrivateBookV2Journal>;
type BookActionInput = { capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment;
  action: PrivateBookV2Action; journal?: BookJournal };
const assertBookCodeCurrent = async (binding: ReturnType<typeof getOwnerTradeV2CapabilityBinding>, deployment: AttestedTradeHistoryV2Deployment) => {
  if (!binding.readProvider || keccak256(await binding.readProvider.getCode(deployment.contractAddress)).toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase()) {
    throw new Error('Book runtime changed or is unavailable. Keep the saved action on hold.');
  }
};

export const executePrivateBookV2Action = async ({ capability, deployment, action: reviewed, journal: suppliedJournal }: BookActionInput): Promise<ConfirmedPrivateBookV2Action> => {
  let action = reviewed;
  if (CURRENT_P2P_BINDING.retainedBooks.some(book => book.chainId === deployment.chainId && book.contractAddress === deployment.contractAddress.toLowerCase()) &&
      (action.kind === 'create' || action.kind === 'replace' || action.kind === 'fill')) {
    throw new Error('This replaced Book is recovery-only. Use the current Book for new trades.');
  }
  if (deployment.runtimeBytecodeHash.toLowerCase() === CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash &&
      (action.kind === 'create' || action.kind === 'replace') &&
      (action.offerAsset.assetType !== 'private-erc20' || action.requestAsset.assetType !== 'private-erc20')) {
    throw new Error('This private book requires private tokens on both sides.');
  }
  action = normalizePrivateBookV2RecoveryAction(action);
  const binding = await assertScope(capability, deployment);
  const journal = suppliedJournal ?? createPrivateBookV2Journal({ capability, deployment: deployment as AttestedTradeHistoryV2Deployment<'private-v2'> });
  let began = false;
  try {
    const saved = await journal.read();
    if (saved?.active) {
      const funding = await readPrivateBookV2PreparedAction({ capability, deployment, journal });
      if (!funding || JSON.stringify(funding) !== JSON.stringify(action)) throw new Error('The pending Book funding differs from this review. Reconcile the saved action first.');
    }
    const validation = await prepared(action, capability, deployment), intent = validation.intent;
    const approvalAsset = 'offerAsset' in intent ? intent.offerAsset : 'requestAsset' in intent ? intent.requestAsset : undefined;
    const approvalToken = approvalAsset && approvalAsset.assetType !== 'native' ? address(approvalAsset.token, 'Private approval token') : undefined;
    const meta: PrivateBookV2RecoveryMeta = Object.freeze({ kind: action.kind, expectedEvent: intent.expectedEvent,
      ...(intent.expectedOrderId === undefined ? {} : { expectedOrderId: intent.expectedOrderId.toString() }),
      ...(intent.expectedStatus === undefined ? {} : { expectedStatus: intent.expectedStatus.toString() }),
      ...(intent.expectedVisible === undefined ? {} : { expectedVisible: intent.expectedVisible }),
      ...(approvalToken ? { approvalToken, approvalPrivate: approvalAsset!.assetType === 'private-erc20' } : {}) });
    if (saved?.active && JSON.stringify(saved.book) !== JSON.stringify(meta)) throw new Error('The pending Book scope changed after review.');
    if (!saved?.active) { await journal.beginBook(meta, ['create', 'replace', 'fill'].includes(action.kind) ? action : undefined); began = true; }
    const admit = async (timestamp: bigint) => {
      await assertScope(capability, deployment);
      await assertBookCodeCurrent(binding, deployment);
      if ((action.kind === 'create' || action.kind === 'replace') && BigInt(action.expiresAt) !== 0n && BigInt(action.expiresAt) <= timestamp) throw new Error('The reviewed Book expiry has passed.');
      if (action.kind === 'budget-visibility') {
        const current = await readPrivateBookV2OrderView({ capability, deployment, orderId: action.orderId, includePublicBudget: false });
        if (current.maker !== binding.ownerAddress.toLowerCase() || current.revision !== String(action.expectedRevision)) throw new Error('Budget visibility review is stale.');
      } else if (action.kind === 'fill') {
        const current = await readPrivateBookV2OrderView({ capability, deployment, orderId: action.orderId, includePublicBudget: false });
        if (current.status !== 'open' || current.revision !== String(action.expectedRevision) ||
            current.priceTerms.offerAmount !== String(action.terms.priceTerms.offerAmount) || current.priceTerms.requestAmount !== String(action.terms.priceTerms.requestAmount) ||
            current.expiresAt !== '0' && BigInt(current.expiresAt) <= timestamp) throw new Error('The reviewed Book fill is stale.');
      }
    };
    const send = (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: (receipt: unknown) => Promise<void>, value = 0n) =>
      sendLinkTradeV2Transaction({ binding, step, to, data, value, onPending: journal.onPending, admit, complete });
    if (approvalToken) {
      if (intent.approvalAmount === undefined) throw new Error('Private token approval amount is missing.');
      await ensureLinkTradeV2Allowance(binding, { offerToken: approvalToken, privatePair: meta.approvalPrivate! }, deployment.contractAddress,
        intent.approvalAmount, send);
    }
    // Obtain fresh Book inputs after the approval sequence. Never persist them or replay them on recovery.
    const signedIntent = await preparePrivateBookV2Intent(action, (value, selector) =>
      encryptPrivateUint256Input(binding.signer, value, deployment.contractAddress, selector), validation.view);
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    let confirmed: ConfirmedPrivateBookV2Action | undefined;
    await send(action.kind, deployment.contractAddress, ACTIONS.encodeFunctionData(signedIntent.functionName, signedIntent.args).toLowerCase(), async receipt => {
      const hash = bytes32(tuple(receipt, 'Private receipt').hash ?? tuple(receipt, 'Private receipt').transactionHash, 'Private receipt hash');
      confirmed = parsePrivateBookV2Receipt(action.kind, meta, deployment, binding.ownerAddress, hash, receipt);
    }, signedIntent.value);
    if (!confirmed) throw new Error('The Book receipt was not accounted. Keep the saved hash; do not resend.');
    return confirmed;
  } catch (error) {
    // Only a preparation with no transaction intent can be released. Submitted/uncertain calls remain locked.
    if (began) await journal.releaseUnsent();
    throw error;
  } finally { if (!suppliedJournal) journal.close(); }
};

const parsePrivateBookV2Receipt = (action: PrivateBookV2Action['kind'], expected: PrivateBookV2RecoveryMeta,
  deployment: AttestedTradeHistoryV2Deployment, ownerAddress: string, submittedTransactionHash: string, receiptValue: unknown): ConfirmedPrivateBookV2Action => {
  const transactionHash = bytes32(tuple(receiptValue, 'Private receipt').hash ?? tuple(receiptValue, 'Private receipt').transactionHash, 'Private receipt hash');
  const receipt = tuple(receiptValue, 'Private receipt'); if (uint(receipt.status, 'Private receipt status') !== 1n || bytes32(receipt.hash ?? receipt.transactionHash, 'Private receipt hash') !== transactionHash || !Array.isArray(receipt.logs)) throw new Error('Private receipt is unsuccessful or belongs to another transaction.');
  const blockNumber = uint(receipt.blockNumber, 'Private receipt block', UINT64_MAX).toString(); const blockHash = bytes32(receipt.blockHash, 'Private receipt block hash'); let match: { args: readonly unknown[]; logIndex: number } | undefined;
  for (const candidate of receipt.logs) {
    if (!candidate || typeof candidate !== 'object') continue;
    const log = candidate as Record<string, unknown>;
    if (address(log.address, 'Private log address') !== deployment.contractAddress || bytes32(log.blockHash, 'Private log block hash') !== blockHash ||
        bytes32(log.transactionHash, 'Private log transaction hash') !== transactionHash || String(log.blockNumber) !== String(receipt.blockNumber) || log.removed === true || !Array.isArray(log.topics)) continue;
    let parsed; try { parsed = ACTIONS.parseLog({ topics: log.topics as string[], data: hexBytes(log.data, 'Private log data') }); } catch { continue; }
    if (!parsed || parsed.name !== expected.expectedEvent) continue;
    const args = parsed.args as unknown as readonly unknown[];
    const actor = parsed.name === 'NativeCreditWithdrawn' ? args[0] : parsed.name === 'PrivateOrderStatusChanged' ? args[4] : args[1];
    if (parsed.name === 'TradeBudgetVisibility' ? args[1] !== expected.expectedVisible ||
        !expected.expectedVisible && uint(args[2], 'Hidden public budget') !== 0n : address(actor, 'Private action actor') !== ownerAddress.toLowerCase()) continue;
    if (
        expected.expectedOrderId !== undefined && uint(args[0], 'Private event order ID').toString() !== expected.expectedOrderId ||
        expected.expectedStatus !== undefined && uint(args[3], 'Private event status').toString() !== expected.expectedStatus) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Private log index'));
    if (!Number.isSafeInteger(logIndex) || match) throw new Error('Private receipt has invalid or duplicate action events.');
    match = { args, logIndex };
  }
  if (!match) throw new Error('Private receipt is missing the exact action event.');
  return Object.freeze({ action, ...(expected.expectedEvent !== 'NativeCreditWithdrawn' ? { orderId: uint(match.args[0], 'Confirmed private order ID').toString() } : {}),
    transactionHash, submittedTransactionHash, blockNumber, blockHash, logIndex: match.logIndex });
};

/** Verify the bounded approval sequence without decrypting its saved funding terms. */
const readConfirmedBookPreparation = async ({ capability, deployment, journal }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; journal: BookJournal;
}, cleanup = false) => {
  const binding = await assertScope(capability, deployment), saved = await journal.read();
  const last = saved?.records[saved.records.length - 1];
  const approvals = cleanup && last?.step === 'cleanup' ? saved!.records.slice(0, -1) : saved?.records;
  if (!saved?.active || !saved.book.approvalToken || !['create', 'replace', 'fill'].includes(saved.book.kind) ||
      !cleanup && saved.cleanupOnly || cleanup && last?.step === 'cleanup' && !['rejected', 'failed'].includes(last.state) ||
      saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.chainId !== binding.chainId.toString() ||
      saved.scope.escrow !== deployment.contractAddress || saved.scope.runtimeHash !== deployment.runtimeBytecodeHash ||
      !approvals?.length || approvals.some(record => record.state !== 'confirmed' ||
      !['approval', 'approval-reset'].includes(record.step) || record.to !== saved.book.approvalToken ||
      record.chainId !== saved.scope.chainId || record.owner !== saved.scope.owner || (record.value ?? '0') !== '0')) throw new Error('A Book transaction is pending. Reconcile it before another send.');
  if (!binding.readProvider) throw new Error('Independent Book chain access is unavailable.');
  await assertBookCodeCurrent(binding, deployment);
  for (const record of approvals) {
    const found = await findLinkTradeV2Transaction(binding.readProvider, record, journal);
    if (!found) throw new Error('A saved Book approval receipt is unavailable. Keep the operation on hold.');
    await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, async () => {}, async () => {});
  }
  const failures = [...saved.priorCleanup ?? [], ...(last?.step === 'cleanup' ? [last] : [])];
  for (const record of failures) {
    if (record.step !== 'cleanup' || record.to !== saved.book.approvalToken || record.chainId !== saved.scope.chainId ||
        record.owner !== saved.scope.owner || (record.value ?? '0') !== '0') throw new Error('Saved cleanup scope changed.');
    if (record.state === 'rejected' && !record.transactionHash && !record.feeWei && !record.mined) continue;
    if (record.state !== 'failed') throw new Error('Cleanup is uncertain. Reconcile it before another send.');
    const found = await findLinkTradeV2Transaction(binding.readProvider, record, journal);
    if (!found || !['reverted', 'cancelled'].includes(found.record.mined?.outcome ?? '')) throw new Error('Saved cleanup failure is not canonical. Keep it on hold.');
    await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, async () => {},
      async () => { throw new Error('Saved cleanup is not a proved failure.'); }, async () => {});
  }
  const latest = await journal.read();
  if (!latest?.active || latest.id !== saved.id || JSON.stringify(latest.records) !== JSON.stringify(saved.records) ||
      JSON.stringify(latest.book) !== JSON.stringify(saved.book) || JSON.stringify(latest.scope) !== JSON.stringify(saved.scope)) throw new Error('The saved Book preparation changed during confirmation.');
  if (latest.cleanupOnly !== saved.cleanupOnly || JSON.stringify(latest.priorCleanup) !== JSON.stringify(saved.priorCleanup)) throw new Error('The saved cleanup history changed during confirmation.');
  return { binding, saved };
};

/** Saved public confirmation flags cannot authorize continuation. Check the small saved approval sequence. */
export const readPrivateBookV2PreparedAction = async (input: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; journal: BookJournal;
}): Promise<PrivateBookV2Action | undefined> => {
  await readConfirmedBookPreparation(input);
  const { journal } = input;
  return journal.readFunding();
};

/** Clear only the saved token approval. Never decrypt funding, fund the Book, or retry an uncertain send. */
export const cleanupPrivateBookV2Preparation = async ({ capability, deployment, journal, preparationId }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; journal: BookJournal; preparationId: string;
}): Promise<void> => {
  const { binding, saved: original } = await readConfirmedBookPreparation({ capability, deployment, journal }, true);
  if (original.id !== preparationId) throw new Error('The saved Book preparation changed.');
  await journal.beginCleanup(preparationId);
  const saved = await journal.read();
  const last = original.records[original.records.length - 1];
  const expectedRecords = last?.step === 'cleanup' ? original.records.slice(0, -1) : original.records;
  const expectedPrior = [...original.priorCleanup ?? [], ...(last?.step === 'cleanup' ? [last] : [])];
  if (!saved?.active || saved.id !== preparationId || !saved.cleanupOnly || JSON.stringify(saved.scope) !== JSON.stringify(original.scope) || JSON.stringify(saved.book) !== JSON.stringify(original.book) ||
      JSON.stringify(saved.records) !== JSON.stringify(expectedRecords) || JSON.stringify(saved.priorCleanup ?? []) !== JSON.stringify(expectedPrior)) {
    throw new Error('The saved cleanup preparation changed.');
  }
  const assertCleanupCurrent = async () => {
    const latest = await journal.read();
    if (!latest?.active || latest.id !== saved.id || !latest.cleanupOnly || JSON.stringify(latest.scope) !== JSON.stringify(saved.scope) ||
        JSON.stringify(latest.book) !== JSON.stringify(saved.book) || JSON.stringify(latest.records) !== JSON.stringify(saved.records) ||
        JSON.stringify(latest.priorCleanup) !== JSON.stringify(saved.priorCleanup)) throw new Error('The saved Book preparation changed before cleanup.');
  };
  const terms = { offerToken: saved.book.approvalToken!, privatePair: Boolean(saved.book.approvalPrivate) };
  const allowance = () => readLinkTradeV2Allowance(binding, terms, deployment.contractAddress);
  const before = await allowance();
  if (before === null) throw new Error('Book approval is unavailable. Keep the preparation on hold.');
  if (before === 0n) {
    await assertOwnerTradeV2CapabilityCurrent(binding);
    await assertCleanupCurrent();
    await journal.finishPreparation(preparationId); return;
  }
  let sent = false;
  await ensureLinkTradeV2Allowance(binding, terms, deployment.contractAddress, 0n, async (_step, to, data, complete) => {
    if (sent || to !== saved.book.approvalToken) throw new Error('Book cleanup call differs from its saved token.');
    sent = true;
    return sendLinkTradeV2Transaction({ binding, step: 'cleanup', to, data, onPending: journal.onPending,
      admit: async () => {
        await assertScope(capability, deployment); await assertBookCodeCurrent(binding, deployment);
        await assertCleanupCurrent();
      }, complete: async () => {
        await complete();
        if (await allowance() !== 0n) throw new Error('Book approval cleanup is not zero. Keep the saved hash.');
      } });
  });
  if (!sent) {
    if (await allowance() !== 0n) throw new Error('Book approval cleanup is unavailable.');
    await assertCleanupCurrent();
    await journal.finishPreparation(preparationId);
  }
};

/** Reconcile one saved call. It uses the existing finite hash/nonce search; it never signs or resends. */
export const reconcilePrivateBookV2Action = async ({ capability, deployment, journal, transactionHash }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment; journal: BookJournal; transactionHash?: string;
}): Promise<ConfirmedPrivateBookV2Action | null> => {
  const binding = await assertScope(capability, deployment), saved = await journal.read(), last = saved?.records[saved.records.length - 1];
  if (!saved || !last || last.state === 'rejected') return null;
  if (!binding.readProvider) throw new Error('Independent Book chain access is unavailable.');
  await assertBookCodeCurrent(binding, deployment);
  const found = await findLinkTradeV2Transaction(binding.readProvider, last, journal, transactionHash);
  if (!found) return null;
  let result: ConfirmedPrivateBookV2Action | null = null;
  await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, ['confirmed', 'failed'].includes(last.state) ? async () => {} : journal.onPending,
    async receipt => {
      if (last.step === 'cleanup') {
        if (!saved.book.approvalToken || await readLinkTradeV2Allowance(binding,
          { offerToken: saved.book.approvalToken, privatePair: Boolean(saved.book.approvalPrivate) }, deployment.contractAddress) !== 0n) {
          throw new Error('Book approval cleanup is not zero. Keep the saved hash.');
        }
      } else if (last.step === saved.book.kind) result = parsePrivateBookV2Receipt(saved.book.kind, saved.book, deployment, binding.ownerAddress, last.transactionHash ?? found.record.transactionHash!, receipt);
      // For approvals, exact canonical call + receipt/fee accounting is sufficient to keep this preparation.
      // A later fresh review reads the current allowance before it can fund the Book.
    }, async () => {
      if (found.record.mined?.outcome !== 'reverted' && found.record.mined?.outcome !== 'cancelled') throw new Error('The Book call was replaced by another action. Keep it on hold for accounting.');
    });
  return result;
};
