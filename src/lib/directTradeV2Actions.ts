import { Interface, getAddress } from '@coti-io/coti-ethers';
import { loadCotiEthersModule } from './appShared/core';
import { ensureTradeTokenAllowance } from './appChain';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import { assertCurrentP2PDirectActionAdmission, type CurrentP2PDirectAdmission } from './currentP2PBinding';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';
import {
  assertAttestedTradeHistoryV2Deployment,
  readAttestedTradeHistoryV2View,
  type AttestedTradeHistoryV2Deployment,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import {
  assertOwnerTradeV2CapabilityCurrent,
  assertOwnerTradeV2CapabilitySnapshotCurrent,
  bindOwnerTradeV2MetaMaskCapability,
  getOwnerTradeV2CapabilityBinding,
  getOwnerTradeV2ReadRunner,
  waitForOwnerTradeV2Receipt,
  type OwnerTradeV2CapabilityBinding,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

export const DIRECT_TRADE_V2_ACTION_ABI = [
  'function createPublicTrade((uint8 assetType,address token) offerAsset,(uint8 assetType,address token) requestAsset,(uint256 offerAmount,uint256 requestAmount) amounts,address taker,uint64 expiresAt) payable returns (uint256 tradeId)',
  'function createPrivateTrade(address offerToken,address requestToken,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedRequestAmount,address taker,uint64 expiresAt) returns (uint256 tradeId)',
  'function createPublicCounterTrade(uint256 parentTradeId,(uint8 assetType,address token) offerAsset,(uint8 assetType,address token) requestAsset,(uint256 offerAmount,uint256 requestAmount) amounts,uint64 expiresAt) payable returns (uint256 tradeId)',
  'function createPrivateCounterTrade(uint256 parentTradeId,address offerToken,address requestToken,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedRequestAmount,uint64 expiresAt) returns (uint256 tradeId)',
  'function replaceWithPublicTrade(uint256 originalTradeId,(uint8 assetType,address token) offerAsset,(uint8 assetType,address token) requestAsset,(uint256 offerAmount,uint256 requestAmount) amounts,uint64 expiresAt) payable returns (uint256 tradeId)',
  'function replaceWithPrivateTrade(uint256 originalTradeId,address offerToken,address requestToken,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedRequestAmount,uint64 expiresAt) returns (uint256 tradeId)',
  'function acceptPublicTrade(uint256 tradeId,uint256 expectedOfferAmount,uint256 expectedRequestAmount) payable',
  'function acceptPrivateTrade(uint256 tradeId,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedRequestAmount)',
  'function cancelTrade(uint256 tradeId)',
  'function declineTrade(uint256 tradeId)',
  'function reclaimExpiredTrade(uint256 tradeId)',
  'function withdrawNativeCredit()',
  'function getTradeView(uint256 tradeId) view returns (((address maker,address taker,uint8 status,uint8 amountMode,(uint8 assetType,address token) offerAsset,(uint8 assetType,address token) requestAsset,uint64 createdAt,uint64 expiresAt,uint256 parentTradeId,uint256 rootTradeId,uint8 counterDepth,bool offerLocked,bytes32 offerTokenCodeHash,bytes32 requestTokenCodeHash) trade,(uint256 offerAmount,uint256 requestAmount) publicAmounts,uint8 effectiveStatus,uint256 activeCounterTradeId,uint256 replacementTradeId,uint256 replacesTradeId) tradeView)',
  'function getPrivateTermsForAccount(uint256 tradeId) view returns ((bool initialized,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) offerAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) requestAmount) snapshot)',
  'function getTradeIdsForMaker(address maker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getTradeIdsForTaker(address taker,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getCounterTradeIdsForParent(uint256 parentTradeId,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'event DirectTradeOpened(uint256 indexed tradeId,address indexed maker,address indexed taker,address parentEscrow,uint256 parentTradeId,uint256 rootTradeId,uint8 counterDepth,uint8 offerAssetType,address offerToken,uint8 requestAssetType,address requestToken,uint8 amountMode,uint256 publicOfferAmount,uint256 publicRequestAmount,uint64 createdAt,uint64 expiresAt)',
  'event DirectTradeStatusChanged(uint256 indexed tradeId,address indexed maker,address indexed taker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedTradeId,uint64 changedAt)',
  'event DirectTradeReplaced(uint256 indexed originalTradeId,uint256 indexed replacementTradeId,uint256 indexed rootTradeId)',
  'event NativeCreditWithdrawn(address indexed recipient,uint256 amount)'
] as const;

const ACTION_INTERFACE = new Interface(DIRECT_TRADE_V2_ACTION_ABI);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
export const DIRECT_TRADE_V2_ACTION_GAS_LIMIT = 12_000_000n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type DirectTradeV2PublicAsset = Readonly<{
  assetType: 'native' | 'erc20';
  token?: string;
}>;

export type DirectTradeV2Action =
  | Readonly<{
      kind: 'create-public';
      offerAsset: DirectTradeV2PublicAsset;
      requestAsset: DirectTradeV2PublicAsset;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      taker: string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'create-private';
      offerToken: string;
      requestToken: string;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      taker: string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'counter-public';
      parentTradeId: bigint | number | string;
      offerAsset: DirectTradeV2PublicAsset;
      requestAsset: DirectTradeV2PublicAsset;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'counter-private';
      parentTradeId: bigint | number | string;
      offerToken: string;
      requestToken: string;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'replace-public';
      originalTradeId: bigint | number | string;
      offerAsset: DirectTradeV2PublicAsset;
      requestAsset: DirectTradeV2PublicAsset;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'replace-private';
      originalTradeId: bigint | number | string;
      offerToken: string;
      requestToken: string;
      offerAmount: bigint | number | string;
      requestAmount: bigint | number | string;
      expiresAt: bigint | number | string;
    }>
  | Readonly<{
      kind: 'accept-public';
      tradeId: bigint | number | string;
      expectedOfferAmount: bigint | number | string;
      expectedRequestAmount: bigint | number | string;
      requestAsset: DirectTradeV2PublicAsset;
    }>
  | Readonly<{
      kind: 'accept-private';
      tradeId: bigint | number | string;
      expectedRequestAmount: bigint | number | string;
      requestToken: string;
    }>
  | Readonly<{
      kind: 'cancel' | 'decline' | 'reclaim-expired';
      tradeId: bigint | number | string;
    }>
  | Readonly<{ kind: 'withdraw-native-credit' }>;

export type DirectTradeV2MetaMaskCapability = OwnerTradeV2MetaMaskCapability;
type CapabilityBinding = OwnerTradeV2CapabilityBinding;

type DirectTradeV2Transaction = Readonly<{
  hash: string;
  chainId: bigint;
  from: string;
  to: string;
  data: string;
  value: bigint;
  wait: () => Promise<unknown>;
}>;

declare const DIRECT_TRADE_V2_SUBMISSION_BRAND: unique symbol;
export type DirectTradeV2Submission = Readonly<{
  action: DirectTradeV2Action['kind'];
  submittedTransactionHash: string;
  transaction: DirectTradeV2Transaction;
  readonly [DIRECT_TRADE_V2_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedDirectTradeV2Action = Readonly<{
  action: DirectTradeV2Action['kind'];
  tradeId?: string;
  relatedTradeId?: string;
  nextStatus?: string;
  submittedTransactionHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

export type DirectTradeV2TradeTerms = Readonly<{
  tradeId: string;
  maker: string;
  taker: string;
  status: 'open' | 'accepted' | 'cancelled' | 'declined' | 'expired' | 'superseded' | 'replaced';
  amountMode: 'public' | 'private';
  offerAsset: Readonly<{ assetType: 'native' | 'erc20' | 'private-erc20'; token: string }>;
  requestAsset: Readonly<{ assetType: 'native' | 'erc20' | 'private-erc20'; token: string }>;
  offerAmount?: string;
  requestAmount?: string;
  createdAt: string;
  expiresAt: string;
  parentTradeId: string;
  rootTradeId: string;
  counterDepth: string;
  activeCounterTradeId: string;
  replacementTradeId: string;
  replacesTradeId: string;
}>;

export type DirectTradeV2TradeIdPage = Readonly<{
  tradeIds: readonly string[];
  nextOffset: string;
}>;

type SubmissionBinding = Readonly<{
  deployment: AttestedTradeHistoryV2Deployment;
  expectedEvent: 'DirectTradeOpened' | 'DirectTradeStatusChanged' | 'NativeCreditWithdrawn';
  expectedTradeId?: bigint;
  expectedStatus?: bigint;
  expectedRecipient?: string;
}>;

const SUBMISSIONS = new WeakMap<object, SubmissionBinding>();

const uint = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const tuple = (value: unknown, label: string): Record<string | number, unknown> => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  return value as Record<string | number, unknown>;
};

const tradeStatus = (value: unknown): DirectTradeV2TradeTerms['status'] => {
  switch (uint(value, 'Direct trade status', 7n)) {
    case 1n: return 'open';
    case 2n: return 'accepted';
    case 3n: return 'cancelled';
    case 4n: return 'declined';
    case 5n: return 'expired';
    case 6n: return 'superseded';
    case 7n: return 'replaced';
    default: throw new Error('Direct trade does not exist.');
  }
};

const tradeAsset = (value: unknown, label: string): DirectTradeV2TradeTerms['offerAsset'] => {
  const asset = tuple(value, label);
  const assetType = uint(asset.assetType ?? asset[0], `${label} type`, 2n);
  return Object.freeze({
    assetType: assetType === 0n ? 'native' as const : assetType === 1n ? 'erc20' as const : 'private-erc20' as const,
    token: address(asset.token ?? asset[1], `${label} token`, assetType === 0n)
  });
};

const userCiphertext = (value: unknown, label: string): Readonly<{
  ciphertextHigh: bigint;
  ciphertextLow: bigint;
}> => {
  const encrypted = tuple(value, label);
  const user = tuple(encrypted.userCiphertext ?? encrypted[1], `${label} user ciphertext`);
  return Object.freeze({
    ciphertextHigh: uint(user.ciphertextHigh ?? user[0], `${label} user ciphertext high`),
    ciphertextLow: uint(user.ciphertextLow ?? user[1], `${label} user ciphertext low`)
  });
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be bytes32.`);
  }
  return value.toLowerCase();
};

const hexBytes = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be hex bytes.`);
  }
  return value.toLowerCase();
};

const bindingOf = (capability: DirectTradeV2MetaMaskCapability): CapabilityBinding => {
  return getOwnerTradeV2CapabilityBinding(capability);
};

const assertBindingCurrent = async (binding: CapabilityBinding): Promise<void> => {
  await assertOwnerTradeV2CapabilityCurrent(binding);
};

const assertBindingSnapshotCurrent = async (binding: CapabilityBinding): Promise<void> => {
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
};

export const bindDirectTradeV2MetaMaskCapability = bindOwnerTradeV2MetaMaskCapability;

const allowanceRequirement = (
  action: DirectTradeV2Action
): Readonly<{
  amount: bigint;
  kind: 'erc20' | 'private-erc20';
  token: string;
}> | null => {
  if (action.kind === 'accept-public') {
    if (action.requestAsset.assetType === 'native') return null;
    return Object.freeze({
      amount: uint(action.expectedRequestAmount, 'Expected Direct request amount', UINT128_MAX),
      kind: 'erc20' as const,
      token: address(action.requestAsset.token, 'Direct request token')
    });
  }
  if (action.kind === 'accept-private') {
    return Object.freeze({
      amount: uint(action.expectedRequestAmount, 'Expected private request amount'),
      kind: 'private-erc20' as const,
      token: address(action.requestToken, 'Direct private request token')
    });
  }
  if (action.kind === 'create-public' || action.kind === 'counter-public' || action.kind === 'replace-public') {
    if (action.offerAsset.assetType === 'native') return null;
    return Object.freeze({
      amount: uint(action.offerAmount, 'Direct public offer amount', UINT128_MAX),
      kind: 'erc20' as const,
      token: address(action.offerAsset.token, 'Direct offer token')
    });
  }
  if (action.kind === 'create-private' || action.kind === 'counter-private' || action.kind === 'replace-private') {
    return Object.freeze({
      amount: uint(action.offerAmount, 'Direct private offer amount'),
      kind: 'private-erc20' as const,
      token: address(action.offerToken, 'Direct private offer token')
    });
  }
  return null;
};

/** Ensures the one-time token/escrow approval using only the opaque owner capability. */
export const ensureDirectTradeV2ActionAllowance = async ({
  capability,
  deployment,
  action,
  actionAdmission
}: {
  capability: DirectTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: DirectTradeV2Action;
  actionAdmission?: CurrentP2PDirectAdmission;
}): Promise<void> => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'direct-v2');
  assertCurrentP2PDirectActionAdmission(deployment, action.kind, actionAdmission);
  const binding = bindingOf(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Direct Trade V2 capability and deployment chains differ.');
  }
  const requirement = allowanceRequirement(action);
  if (!requirement || requirement.amount <= 0n) return;
  await ensureTradeTokenAllowance(
    binding.signer,
    binding.ownerAddress,
    requirement.token,
    requirement.amount,
    requirement.kind,
    deployment.contractAddress
  );
  await assertBindingSnapshotCurrent(binding);
};

const parseDirectTradeV2TradeView = ({
  id,
  ownerAddress,
  rawView
}: {
  id: bigint;
  ownerAddress: string;
  rawView: unknown;
}): DirectTradeV2TradeTerms => {
  const view = tuple(rawView, 'Direct Trade V2 view');
  const trade = tuple(view.trade ?? view[0], 'Direct Trade V2 trade');
  const publicAmounts = tuple(view.publicAmounts ?? view[1], 'Direct Trade V2 public amounts');
  const maker = address(trade.maker ?? trade[0], 'Direct trade maker');
  const taker = address(trade.taker ?? trade[1], 'Direct trade taker');
  if (ownerAddress !== maker && ownerAddress !== taker) {
    throw new Error('Direct trade terms are available only to its maker or intended taker.');
  }
  const amountModeRaw = uint(trade.amountMode ?? trade[3], 'Direct trade amount mode', 1n);
  const amountMode = amountModeRaw === 0n ? 'public' as const : 'private' as const;
  const offerAmount = amountMode === 'public'
    ? uint(publicAmounts.offerAmount ?? publicAmounts[0], 'Direct public offer amount')
    : undefined;
  const requestAmount = amountMode === 'public'
    ? uint(publicAmounts.requestAmount ?? publicAmounts[1], 'Direct public request amount')
    : undefined;
  return Object.freeze({
    tradeId: id.toString(),
    maker,
    taker,
    status: tradeStatus(view.effectiveStatus ?? view[2]),
    amountMode,
    offerAsset: tradeAsset(trade.offerAsset ?? trade[4], 'Direct offer asset'),
    requestAsset: tradeAsset(trade.requestAsset ?? trade[5], 'Direct request asset'),
    ...(offerAmount !== undefined ? { offerAmount: offerAmount.toString() } : {}),
    ...(requestAmount !== undefined ? { requestAmount: requestAmount.toString() } : {}),
    createdAt: uint(trade.createdAt ?? trade[6], 'Direct trade creation time', UINT64_MAX).toString(),
    expiresAt: uint(trade.expiresAt ?? trade[7], 'Direct trade expiry', UINT64_MAX).toString(),
    parentTradeId: uint(trade.parentTradeId ?? trade[8], 'Direct parent trade ID').toString(),
    rootTradeId: uint(trade.rootTradeId ?? trade[9], 'Direct root trade ID').toString(),
    counterDepth: uint(trade.counterDepth ?? trade[10], 'Direct counter depth', 255n).toString(),
    activeCounterTradeId: uint(view.activeCounterTradeId ?? view[3], 'Active Direct counter ID').toString(),
    replacementTradeId: uint(view.replacementTradeId ?? view[4], 'Direct replacement ID').toString(),
    replacesTradeId: uint(view.replacesTradeId ?? view[5], 'Replaced Direct trade ID').toString()
  });
};

/** Reads public Direct V2 terms without touching the connected wallet provider or signer. */
export const readDirectTradeV2PublicTradeTerms = async ({
  capability,
  deployment,
  ownerAddress,
  tradeId
}: {
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  ownerAddress: string;
  tradeId: bigint | number | string;
}): Promise<DirectTradeV2TradeTerms> => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'direct-v2');
  const owner = address(ownerAddress, 'Direct trade viewer');
  const id = uint(tradeId, 'Direct trade ID');
  if (id === 0n) throw new Error('Direct trade ID cannot be zero.');
  const data = ACTION_INTERFACE.encodeFunctionData('getTradeView', [id]);
  const raw = await readAttestedTradeHistoryV2View({ capability, deployment, data });
  let decoded;
  try {
    decoded = ACTION_INTERFACE.decodeFunctionResult('getTradeView', raw);
  } catch {
    throw new Error('Direct Trade V2 public view returned malformed ABI data.');
  }
  if (ACTION_INTERFACE.encodeFunctionResult('getTradeView', [...decoded]).toLowerCase() !== raw) {
    throw new Error('Direct Trade V2 public view returned noncanonical ABI data.');
  }
  return parseDirectTradeV2TradeView({ id, ownerAddress: owner, rawView: decoded[0] });
};

/** Reads current direct terms through the exact owner capability; private amounts are opt-in. */
export const readDirectTradeV2TradeTerms = async ({
  capability,
  readCapability,
  deployment,
  tradeId,
  decryptPrivateAmounts = false
}: {
  capability: DirectTradeV2MetaMaskCapability;
  readCapability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  tradeId: bigint | number | string;
  decryptPrivateAmounts?: boolean;
}): Promise<DirectTradeV2TradeTerms> => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'direct-v2');
  const binding = bindingOf(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Direct Trade V2 capability and deployment chains differ.');
  }
  const id = uint(tradeId, 'Direct trade ID');
  if (id === 0n) throw new Error('Direct trade ID cannot be zero.');
  const publicTerms = await readDirectTradeV2PublicTradeTerms({
    capability: readCapability,
    deployment,
    ownerAddress: binding.ownerAddress,
    tradeId: id
  });
  let offerAmount = publicTerms.offerAmount === undefined ? undefined : BigInt(publicTerms.offerAmount);
  let requestAmount = publicTerms.requestAmount === undefined ? undefined : BigInt(publicTerms.requestAmount);
  if (publicTerms.amountMode === 'private' && decryptPrivateAmounts) {
    const data = ACTION_INTERFACE.encodeFunctionData('getPrivateTermsForAccount', [id]);
    const raw = await readAttestedTradeHistoryV2View({
      capability: readCapability,
      deployment,
      data,
      from: binding.ownerAddress
    });
    let decoded;
    try {
      decoded = ACTION_INTERFACE.decodeFunctionResult('getPrivateTermsForAccount', raw);
    } catch {
      throw new Error('Direct private terms returned malformed ABI data.');
    }
    if (ACTION_INTERFACE.encodeFunctionResult('getPrivateTermsForAccount', [...decoded]).toLowerCase() !== raw) {
      throw new Error('Direct private terms returned noncanonical ABI data.');
    }
    const privateTerms = tuple(decoded[0], 'Direct private terms');
    if ((privateTerms.initialized ?? privateTerms[0]) !== true) {
      throw new Error('Direct private terms are not initialized for this participant.');
    }
    const offer = decryptPrivateUint256Output(binding.signer, userCiphertext(
      privateTerms.offerAmount ?? privateTerms[1],
      'Direct private offer amount'
    ));
    await assertBindingSnapshotCurrent(binding);
    const request = decryptPrivateUint256Output(binding.signer, userCiphertext(
      privateTerms.requestAmount ?? privateTerms[2],
      'Direct private request amount'
    ));
    offerAmount = uint(offer, 'Decrypted Direct private offer amount');
    requestAmount = uint(request, 'Decrypted Direct private request amount');
  }
  await assertBindingSnapshotCurrent(binding);
  return Object.freeze({
    ...publicTerms,
    ...(offerAmount !== undefined ? { offerAmount: offerAmount.toString() } : {}),
    ...(requestAmount !== undefined ? { requestAmount: requestAmount.toString() } : {})
  });
};

export const readDirectTradeV2TradeIds = async ({
  capability,
  deployment,
  scope,
  parentTradeId,
  offset = 0n,
  limit = 50n
}: {
  capability: DirectTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  scope: 'maker' | 'taker' | 'counter';
  parentTradeId?: bigint | number | string;
  offset?: bigint | number | string;
  limit?: bigint | number | string;
}): Promise<DirectTradeV2TradeIdPage> => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'direct-v2');
  const binding = bindingOf(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Direct Trade V2 capability and deployment chains differ.');
  }
  const pageOffset = uint(offset, 'Direct trade offset');
  const pageLimit = uint(limit, 'Direct trade limit');
  if (pageLimit > 100n) throw new Error('Direct trade limit cannot exceed 100.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(
    deployment.contractAddress,
    DIRECT_TRADE_V2_ACTION_ABI,
    getOwnerTradeV2ReadRunner(binding)
  ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const raw = scope === 'counter'
    ? await contract.getCounterTradeIdsForParent(
        (() => {
          const id = uint(parentTradeId, 'Direct parent trade ID');
          if (id === 0n) throw new Error('Direct parent trade ID cannot be zero.');
          return id;
        })(),
        pageOffset,
        pageLimit
      )
    : await contract[scope === 'maker' ? 'getTradeIdsForMaker' : 'getTradeIdsForTaker'](
        binding.ownerAddress,
        pageOffset,
        pageLimit
      );
  const page = tuple(raw, 'Direct trade ID page');
  const rawIds = page.ids ?? page[0];
  if (!Array.isArray(rawIds)) throw new Error('Direct trade ID page is malformed.');
  const tradeIds = rawIds.map((value, index) => {
    const id = uint(value, `Direct trade ID ${index + 1}`);
    if (id === 0n) throw new Error('Direct trade ID page contains zero.');
    return id.toString();
  });
  await assertBindingSnapshotCurrent(binding);
  return Object.freeze({
    tradeIds: Object.freeze(tradeIds),
    nextOffset: uint(page.nextOffset ?? page[1], 'Direct trade next offset').toString()
  });
};

const publicAsset = (asset: DirectTradeV2PublicAsset, label: string) => {
  if (asset.assetType === 'native') return Object.freeze({ assetType: 0, token: ZERO_ADDRESS });
  if (asset.assetType !== 'erc20') throw new Error(`${label} asset type is invalid.`);
  return Object.freeze({ assetType: 1, token: address(asset.token, `${label} token`) });
};

const transactionEnvelope = (
  value: unknown,
  expected: Readonly<{ chainId: bigint; from: string; to: string; data: string; value: bigint }>,
  label: string,
  waitForReceipt?: (hash: string) => Promise<unknown>
): DirectTradeV2Transaction => {
  if (!value || typeof value !== 'object') throw new Error(`${label} transaction is missing.`);
  const tx = value as Record<string, unknown>;
  if (typeof tx.wait !== 'function') throw new Error(`${label} transaction cannot be confirmed.`);
  const hash = bytes32(tx.hash, `${label} transaction hash`);
  const chainId = resolveBoundTransactionChain(tx.chainId, expected.chainId, label);
  const normalized = Object.freeze({
    hash,
    chainId,
    from: address(tx.from, `${label} transaction sender`),
    to: address(tx.to, `${label} transaction target`),
    data: hexBytes(tx.data, `${label} transaction data`),
    value: uint(tx.value, `${label} transaction value`),
    wait: waitForReceipt ? () => waitForReceipt(hash) : (tx.wait as () => Promise<unknown>).bind(value)
  });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from ||
      normalized.to !== expected.to || normalized.data !== expected.data.toLowerCase() ||
      normalized.value !== expected.value) {
    throw new Error(`${label} transaction does not match the exact intended action.`);
  }
  return normalized;
};

const preparedAction = async (
  action: DirectTradeV2Action,
  binding: CapabilityBinding,
  contractAddress: string
): Promise<Readonly<{
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  expectedEvent: SubmissionBinding['expectedEvent'];
  expectedTradeId?: bigint;
  expectedStatus?: bigint;
  expectedRecipient?: string;
}>> => {
  if (action.kind === 'withdraw-native-credit') {
    return { functionName: 'withdrawNativeCredit', args: [], value: 0n, expectedEvent: 'NativeCreditWithdrawn', expectedRecipient: binding.ownerAddress };
  }
  if (action.kind === 'cancel' || action.kind === 'decline' || action.kind === 'reclaim-expired') {
    const tradeId = uint(action.tradeId, 'Direct trade ID');
    if (tradeId === 0n) throw new Error('Direct trade ID cannot be zero.');
    return {
      functionName: action.kind === 'cancel' ? 'cancelTrade' : action.kind === 'decline' ? 'declineTrade' : 'reclaimExpiredTrade',
      args: [tradeId],
      value: 0n,
      expectedEvent: 'DirectTradeStatusChanged',
      expectedTradeId: tradeId,
      expectedStatus: action.kind === 'cancel' ? 3n : action.kind === 'decline' ? 4n : 5n
    };
  }
  if (action.kind === 'accept-public') {
    const tradeId = uint(action.tradeId, 'Direct trade ID');
    const offerAmount = uint(action.expectedOfferAmount, 'Expected Direct offer amount', UINT128_MAX);
    const requestAmount = uint(action.expectedRequestAmount, 'Expected Direct request amount', UINT128_MAX);
    if (tradeId === 0n || offerAmount === 0n || requestAmount === 0n) throw new Error('Direct public acceptance values must be positive.');
    return {
      functionName: 'acceptPublicTrade',
      args: [tradeId, offerAmount, requestAmount],
      value: action.requestAsset.assetType === 'native' ? requestAmount : 0n,
      expectedEvent: 'DirectTradeStatusChanged',
      expectedTradeId: tradeId,
      expectedStatus: 2n
    };
  }
  if (action.kind === 'accept-private') {
    const tradeId = uint(action.tradeId, 'Direct trade ID');
    const requestAmount = uint(action.expectedRequestAmount, 'Expected private request amount');
    if (tradeId === 0n || requestAmount === 0n) throw new Error('Direct private acceptance values must be positive.');
    const selector = ACTION_INTERFACE.getFunction('acceptPrivateTrade')?.selector;
    if (!selector) throw new Error('Direct private acceptance selector is unavailable.');
    const encryptedRequest = await encryptPrivateUint256Input(binding.signer, requestAmount, contractAddress, selector);
    await assertBindingSnapshotCurrent(binding);
    return {
      functionName: 'acceptPrivateTrade',
      args: [tradeId, encryptedRequest],
      value: 0n,
      expectedEvent: 'DirectTradeStatusChanged',
      expectedTradeId: tradeId,
      expectedStatus: 2n
    };
  }

  if (!('expiresAt' in action)) {
    throw new Error('Direct Trade V2 action is not a create, counter, or replacement action.');
  }
  const expiresAt = uint(action.expiresAt, 'Direct trade expiry', UINT64_MAX);
  if (expiresAt !== 0n && expiresAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error('Direct trade expiry must be in the future or zero.');
  }
  const parentOrOriginal = 'parentTradeId' in action
    ? uint(action.parentTradeId, 'Direct parent trade ID')
    : 'originalTradeId' in action
      ? uint(action.originalTradeId, 'Direct original trade ID')
      : undefined;
  if (parentOrOriginal === 0n) throw new Error('Direct parent/original trade ID cannot be zero.');
  const taker = 'taker' in action ? address(action.taker, 'Direct trade taker') : undefined;
  const prefixArgs = parentOrOriginal === undefined ? [] : [parentOrOriginal];

  if (action.kind.endsWith('public')) {
    const publicAction = action as Extract<DirectTradeV2Action, { kind: 'create-public' | 'counter-public' | 'replace-public' }>;
    const offerAmount = uint(publicAction.offerAmount, 'Direct public offer amount', UINT128_MAX);
    const requestAmount = uint(publicAction.requestAmount, 'Direct public request amount', UINT128_MAX);
    if (offerAmount === 0n || requestAmount === 0n) throw new Error('Direct public amounts must be positive.');
    const offerAsset = publicAsset(publicAction.offerAsset, 'Direct offer');
    const requestAsset = publicAsset(publicAction.requestAsset, 'Direct request');
    const functionName = action.kind === 'create-public'
      ? 'createPublicTrade'
      : action.kind === 'counter-public'
        ? 'createPublicCounterTrade'
        : 'replaceWithPublicTrade';
    const args = action.kind === 'create-public'
      ? [offerAsset, requestAsset, { offerAmount, requestAmount }, taker!, expiresAt]
      : [...prefixArgs, offerAsset, requestAsset, { offerAmount, requestAmount }, expiresAt];
    return {
      functionName,
      args,
      value: offerAsset.assetType === 0 ? offerAmount : 0n,
      expectedEvent: 'DirectTradeOpened'
    };
  }

  const privateAction = action as Extract<DirectTradeV2Action, { kind: 'create-private' | 'counter-private' | 'replace-private' }>;
  const offerToken = address(privateAction.offerToken, 'Direct private offer token');
  const requestToken = address(privateAction.requestToken, 'Direct private request token');
  if (offerToken === requestToken) throw new Error('Direct private tokens must differ.');
  const offerAmount = uint(privateAction.offerAmount, 'Direct private offer amount');
  const requestAmount = uint(privateAction.requestAmount, 'Direct private request amount');
  if (offerAmount === 0n || requestAmount === 0n) throw new Error('Direct private amounts must be positive.');
  const functionName = action.kind === 'create-private'
    ? 'createPrivateTrade'
    : action.kind === 'counter-private'
      ? 'createPrivateCounterTrade'
      : 'replaceWithPrivateTrade';
  const selector = ACTION_INTERFACE.getFunction(functionName)?.selector;
  if (!selector) throw new Error('Direct private action selector is unavailable.');
  const encryptedOffer = await encryptPrivateUint256Input(binding.signer, offerAmount, contractAddress, selector);
  await assertBindingSnapshotCurrent(binding);
  const encryptedRequest = await encryptPrivateUint256Input(binding.signer, requestAmount, contractAddress, selector);
  await assertBindingSnapshotCurrent(binding);
  const args = action.kind === 'create-private'
    ? [offerToken, requestToken, encryptedOffer, encryptedRequest, taker!, expiresAt]
    : [...prefixArgs, offerToken, requestToken, encryptedOffer, encryptedRequest, expiresAt];
  return { functionName, args, value: 0n, expectedEvent: 'DirectTradeOpened' };
};

export const submitDirectTradeV2Action = async ({
  capability,
  deployment,
  action,
  actionAdmission
}: {
  capability: DirectTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  action: DirectTradeV2Action;
  actionAdmission?: CurrentP2PDirectAdmission;
}): Promise<DirectTradeV2Submission> => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'direct-v2');
  assertCurrentP2PDirectActionAdmission(deployment, action.kind, actionAdmission);
  const binding = bindingOf(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Direct Trade V2 capability and deployment chains differ.');
  }
  const prepared = await preparedAction(action, binding, deployment.contractAddress);
  await assertBindingSnapshotCurrent(binding);
  const data = ACTION_INTERFACE.encodeFunctionData(prepared.functionName, [...prepared.args]).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(deployment.contractAddress, DIRECT_TRADE_V2_ACTION_ABI, binding.signer) as unknown as Record<string, unknown>;
  const write = contract[prepared.functionName];
  if (typeof write !== 'function') throw new Error('Direct Trade V2 action is unavailable.');
  const rawTransaction = await (write as (...args: unknown[]) => Promise<unknown>)(
    ...prepared.args,
    {
      gasLimit: DIRECT_TRADE_V2_ACTION_GAS_LIMIT,
      ...(prepared.value > 0n ? { value: prepared.value } : {})
    }
  );
  await assertBindingSnapshotCurrent(binding);
  const transaction = transactionEnvelope(rawTransaction, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data,
    value: prepared.value
  }, 'Direct Trade V2', binding.readProvider ? (hash) => waitForOwnerTradeV2Receipt(binding, hash) : undefined);
  const submission = Object.freeze({
    action: action.kind,
    submittedTransactionHash: transaction.hash,
    transaction
  }) as DirectTradeV2Submission;
  SUBMISSIONS.set(submission, Object.freeze({
    deployment,
    expectedEvent: prepared.expectedEvent,
    expectedTradeId: prepared.expectedTradeId,
    expectedStatus: prepared.expectedStatus,
    expectedRecipient: prepared.expectedRecipient
  }));
  return submission;
};

const confirmedReceipt = async (
  transaction: DirectTradeV2Transaction
): Promise<Readonly<{ receipt: Record<string, unknown>; transactionHash: string }>> => {
  let receiptValue: unknown;
  let effectiveHash = transaction.hash;
  try {
    receiptValue = await transaction.wait();
  } catch (error) {
    const replaced = error as Record<string, unknown> | null;
    if (!replaced || replaced.code !== 'TRANSACTION_REPLACED') throw error;
    if (replaced.cancelled === true || replaced.reason === 'cancelled') {
      throw new Error('Direct Trade V2 replacement was cancelled.');
    }
    const replacement = transactionEnvelope(replaced.replacement, transaction, 'Replacement Direct Trade V2');
    effectiveHash = replacement.hash;
    receiptValue = replaced.receipt;
  }
  if (!receiptValue || typeof receiptValue !== 'object') throw new Error('Direct Trade V2 receipt is missing.');
  const receipt = receiptValue as Record<string, unknown>;
  if (uint(receipt.status, 'Direct Trade V2 receipt status') !== 1n) {
    throw new Error('Direct Trade V2 transaction did not succeed.');
  }
  const receiptHash = bytes32(receipt.hash ?? receipt.transactionHash, 'Direct Trade V2 receipt transaction hash');
  if (receiptHash !== effectiveHash) throw new Error('Direct Trade V2 receipt belongs to another transaction.');
  return Object.freeze({ receipt, transactionHash: effectiveHash });
};

export const confirmDirectTradeV2Action = async (
  submission: DirectTradeV2Submission
): Promise<ConfirmedDirectTradeV2Action> => {
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected) throw new Error('Direct Trade V2 submission is not locally prepared.');
  const { receipt, transactionHash } = await confirmedReceipt(submission.transaction);
  const blockNumber = uint(receipt.blockNumber, 'Direct Trade V2 receipt block number', UINT64_MAX).toString();
  const blockHashValue = bytes32(receipt.blockHash, 'Direct Trade V2 receipt block hash');
  if (!Array.isArray(receipt.logs)) throw new Error('Direct Trade V2 receipt logs are missing.');

  let matched: Readonly<{ args: readonly unknown[]; logIndex: number }> | undefined;
  for (const rawLog of receipt.logs) {
    if (!rawLog || typeof rawLog !== 'object') continue;
    const log = rawLog as Record<string, unknown>;
    if (address(log.address, 'Direct Trade V2 log address') !== expected.deployment.contractAddress ||
        bytes32(log.blockHash, 'Direct Trade V2 log block hash') !== blockHashValue ||
        bytes32(log.transactionHash, 'Direct Trade V2 log transaction hash') !== transactionHash ||
        String(log.blockNumber) !== String(receipt.blockNumber) ||
        log.removed === true || !Array.isArray(log.topics)) continue;
    let description;
    try {
      description = ACTION_INTERFACE.parseLog({ topics: log.topics as string[], data: hexBytes(log.data, 'Direct Trade V2 log data') });
    } catch {
      continue;
    }
    if (!description || description.name !== expected.expectedEvent) continue;
    const args = description.args as unknown as readonly unknown[];
    if (expected.expectedTradeId !== undefined && uint(args[0], 'Direct Trade V2 event trade ID') !== expected.expectedTradeId) continue;
    if (expected.expectedStatus !== undefined && uint(args[4], 'Direct Trade V2 event status') !== expected.expectedStatus) continue;
    if (expected.expectedRecipient !== undefined && address(args[0], 'Direct Trade V2 credit recipient') !== expected.expectedRecipient) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Direct Trade V2 log index'));
    if (!Number.isSafeInteger(logIndex)) throw new Error('Direct Trade V2 log index exceeds the app safe range.');
    if (matched) throw new Error('Direct Trade V2 receipt contains duplicate matching events.');
    matched = Object.freeze({ args, logIndex });
  }
  if (!matched) throw new Error('Direct Trade V2 receipt is missing the exact action event.');
  const isOpened = expected.expectedEvent === 'DirectTradeOpened';
  const isStatus = expected.expectedEvent === 'DirectTradeStatusChanged';
  return Object.freeze({
    action: submission.action,
    ...(isOpened || isStatus ? { tradeId: uint(matched.args[0], 'Confirmed Direct trade ID').toString() } : {}),
    ...(isStatus ? {
      nextStatus: uint(matched.args[4], 'Confirmed Direct trade status').toString(),
      relatedTradeId: uint(matched.args[6], 'Confirmed related Direct trade ID').toString()
    } : {}),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash,
    blockNumber,
    blockHash: blockHashValue,
    logIndex: matched.logIndex
  });
};
