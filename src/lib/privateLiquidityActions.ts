import {
  BrowserProvider,
  Interface,
  getAddress,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { loadCotiEthersModule, type CotiReadProvider } from './appShared/core';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import {
  assertAttestedPrivateLiquidityDeployment,
  type AttestedPrivateLiquidityDeployment
} from './privateLiquidityChain';
import {
  preparePrivateLiquiditySwapQuote,
  type PrivateLiquidityCandidatePlan,
  type PrivateLiquiditySwapQuote
} from './privateLiquidityQuote';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';
import {
  buildPrivateLiquidityPairKey,
  normalizePrivateLiquidityAddress,
  validatePrivateLiquidityTerms,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';
import {
  decryptPrivateLiquidityReceiptAmount,
  isPrivateLiquidityReceiptPrivacyRefreshRequired,
  type PrivateLiquidityUserCiphertext
} from './privateLiquidityReceipt';
import type { PrivateLiquidityEncryptedUint256 } from './privateLiquidityEvents';
import { waitForPublicTransactionReceipt } from './publicTransactionReceipt';
import type { CanonicalPrivateLiquidityLogRange } from './privateLiquidityChain';
import {
  materializeCanonicalPrivateLiquidityHistory,
  type CanonicalPrivateLiquidityHistorySnapshot
} from './privateLiquidityHistoryMaterialize';
import {
  assertPreparedPrivateLiquidityHiddenIntent,
  assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes,
  materializePrivateLiquidityHiddenIntentOwnerReceipt,
  materializePrivateLiquidityHiddenIntentPublicView,
  type PrivateLiquidityHiddenIntentOwnerReceipt,
  type PrivateLiquidityHiddenIntentPublicView,
  type PrivateLiquidityHiddenIntentSettlementRoutes,
  type PreparedPrivateLiquidityHiddenIntent
} from './privateLiquidityHiddenIntents';

// MetaMask-only action boundary for the integrated private-liquidity BookV2.

export const PRIVATE_LIQUIDITY_ACTION_ABI = [
  'function createPosition(address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedInitialInventory) returns (uint256 positionId)',
  'function updatePositionTerms(uint256 positionId,uint64 expectedRevision,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms)',
  'function addLiquidity(uint256 positionId,uint64 expectedRevision,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedAmounts)',
  'function removeLiquidity(uint256 positionId,uint64 expectedRevision,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedAmounts)',
  'function pausePosition(uint256 positionId,uint64 expectedRevision)',
  'function resumePosition(uint256 positionId,uint64 expectedRevision)',
  'function activatePositionPrivacy(uint256 positionId,uint64 expectedRevision,bool resume)',
  'function transferPosition(address recipient,uint256 positionId,uint64 expectedRevision)',
  'function closePosition(uint256 positionId,uint64 expectedRevision)',
  'function getOwnerInventorySnapshot(uint256 positionId) view returns ((address recipient,uint64 sequence,bool initialized,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) baseAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) quoteAmount))',
  'function swapBest(address baseToken,address quoteToken,uint8 direction,uint256[] candidatePositionIds,uint64[] expectedRevisions,uint64 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedSwap) returns (uint256 swapId)',
  'function createHiddenIntent(address baseToken,address quoteToken,uint32 cooldownBlocks,uint64 expiresAt,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) privateTerms,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) privateBudget) returns (uint256 intentId)',
  'function cancelHiddenIntent(uint256 intentId)',
  'function reclaimExpiredHiddenIntent(uint256 intentId)',
  'function settleHiddenIntents(bytes32 pairKey,uint256[] askPositionIds,uint64[] askExpectedRevisions,uint256[] bidPositionIds,uint64[] bidExpectedRevisions,uint64 deadline) returns (uint256 settlementId)',
  'function openHiddenIntentCountByPair(bytes32 pairKey) view returns (uint256)',
  'function hiddenIntentCursorByPair(bytes32 pairKey) view returns (uint256)',
  'function hiddenIntentCountForOwner(address account) view returns (uint256)',
  'function getHiddenIntentIdsForOwner(address account,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getHiddenIntentView(uint256 intentId) view returns (((uint8 status,address owner,address baseToken,address quoteToken,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,uint64 createdAt,uint64 expiresAt,uint32 cooldownBlocks,uint32 fillCount) intent,bytes32 pairKey,uint256 lastActivityBlock,uint256 lastFillBlock,bool hasPrivateTerms) view_)',
  'function getHiddenIntentOwnerReceipt(uint256 intentId) view returns ((address recipient,uint64 sequence,bool initialized,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) packedTerms,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) packedBudget,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) lastInputAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) lastOutputAmount))',
  'event PrivateLiquidityPositionCreated(uint256 indexed positionId,address indexed positionOwner,bytes32 indexed pairKey,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision)',
  'event PrivateLiquidityPositionTermsUpdated(uint256 indexed positionId,address indexed positionOwner,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 revision)',
  'event PrivateLiquidityPositionLiquidityChanged(uint256 indexed positionId,address indexed positionOwner,address indexed actor,uint64 revision)',
  'event PrivateLiquidityPositionStatusChanged(uint256 indexed positionId,address indexed positionOwner,uint8 previousStatus,uint8 nextStatus,address actor,uint64 revision)',
  'event PrivateLiquidityPositionTransferActivationRequired(uint256 indexed positionId,address indexed previousOwner,address indexed nextOwner,uint64 revision)',
  'event PrivateLiquidityPositionPrivacyActivated(uint256 indexed positionId,address indexed positionOwner,bool resumed,uint64 revision)',
  'event PrivateLiquidityPositionClosed(uint256 indexed positionId,address indexed positionOwner)',
  'event PrivateLiquidityTraderSwapReceiptUpdated(uint256 indexed swapId,address indexed recipient,bytes32 indexed pairKey,uint8 direction,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) inputAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) outputAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) unusedInputAmount)',
  'event PrivateLiquiditySwapExecuted(uint256 indexed swapId,address indexed trader,bytes32 indexed pairKey,uint8 direction,uint256 candidateCount)',
  'event PrivateLiquidityHiddenIntentOpened(uint256 indexed intentId,address indexed intentOwner,bytes32 indexed pairKey,address baseToken,address quoteToken,uint64 createdAt,uint64 expiresAt,uint32 cooldownBlocks)',
  'event PrivateLiquidityHiddenIntentCancelled(uint256 indexed intentId,address indexed intentOwner)',
  'event PrivateLiquidityHiddenIntentExpired(uint256 indexed intentId,address indexed intentOwner,address indexed actor)',
  'event PrivateLiquidityHiddenIntentSettlementProcessed(uint256 indexed settlementId,bytes32 indexed pairKey,address indexed caller,uint256 processedIntentCount,uint256 candidateCount)'
] as const;

export const PRIVATE_LIQUIDITY_SWAP_ABI = PRIVATE_LIQUIDITY_ACTION_ABI;

const SWAP_INTERFACE = new Interface(PRIVATE_LIQUIDITY_ACTION_ABI);
const PRIVATE_TOKEN_ABI = [
  'function accountEncryptionAddress(address account) view returns (address)',
  'function setAccountEncryptionAddress(address offBoardAddress) returns (bool)',
  'function publicAmountsEnabled() view returns (bool)',
  'function allowance(address owner,address spender) view returns (((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerCiphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderCiphertext))',
  'function reencryptAllowance(address account,bool isSpender)',
  'function approve(address spender,uint256 amount)',
  'function approve(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)',
  'function increaseAllowance(address spender,uint256 amount)',
  'function increaseAllowance(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)'
] as const;
const PRIVATE_TOKEN_INTERFACE = new Interface(PRIVATE_TOKEN_ABI);
export const PRIVATE_LIQUIDITY_SWAP_SELECTOR = SWAP_INTERFACE.getFunction('swapBest')?.selector ?? '';
export const PRIVATE_LIQUIDITY_CREATE_POSITION_SELECTOR =
  SWAP_INTERFACE.getFunction('createPosition')?.selector ?? '';
export const PRIVATE_LIQUIDITY_ADD_LIQUIDITY_SELECTOR =
  SWAP_INTERFACE.getFunction('addLiquidity')?.selector ?? '';
export const PRIVATE_LIQUIDITY_REMOVE_LIQUIDITY_SELECTOR =
  SWAP_INTERFACE.getFunction('removeLiquidity')?.selector ?? '';
export const PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR =
  SWAP_INTERFACE.getFunction('createHiddenIntent')?.selector ?? '';
// COTI MPC writes cannot be preflighted reliably with eth_estimateGas: the RPC simulation can
// reject a valid authenticated ciphertext before MetaMask ever broadcasts it. Keep an explicit,
// bounded ceiling (the same ceiling used by the reviewed testnet proof) and let the receipt report
// actual gas used. This is a limit, not an amount the transaction automatically spends.
export const PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT = 12_000_000n;
export const PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT = 12_000_000n;
export const PRIVATE_LIQUIDITY_SWAP_BASE_GAS_LIMIT = 16_000_000n;
export const PRIVATE_LIQUIDITY_SWAP_GAS_PER_CANDIDATE = 8_000_000n;
export const getPrivateLiquiditySwapGasLimit = (candidateCount: number): bigint => {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1 || candidateCount > 8) {
    throw new Error('Private-liquidity swap candidate count is out of range.');
  }
  return PRIVATE_LIQUIDITY_SWAP_BASE_GAS_LIMIT +
    PRIVATE_LIQUIDITY_SWAP_GAS_PER_CANDIDATE * BigInt(candidateCount);
};
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const PACK_BASE = 1n << 128n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

declare const PRIVATE_LIQUIDITY_METAMASK_CAPABILITY_BRAND: unique symbol;
export type PrivateLiquidityMetaMaskCapability = Readonly<{
  readonly [PRIVATE_LIQUIDITY_METAMASK_CAPABILITY_BRAND]: true;
}>;

type CapabilityBinding = Readonly<{
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent: () => void | Promise<void>;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider;
  chainId: bigint;
  ownerAddress: string;
  signer: JsonRpcSigner;
}>;

export type PrivateLiquidityTransaction = Readonly<{
  hash: string;
  chainId: bigint;
  from: string;
  to: string;
  data: string;
  value: bigint;
  wait: () => Promise<unknown>;
}>;

declare const PRIVATE_LIQUIDITY_SWAP_SUBMISSION_BRAND: unique symbol;
export type PrivateLiquiditySwapSubmission = Readonly<{
  quote: PrivateLiquiditySwapQuote;
  transaction: PrivateLiquidityTransaction;
  submittedTransactionHash: string;
  readonly [PRIVATE_LIQUIDITY_SWAP_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateLiquiditySwap = Readonly<{
  swapId: string;
  trader: string;
  pairKey: string;
  direction: PrivateLiquiditySwapQuote['direction'];
  candidateCount: number;
  quote: PrivateLiquiditySwapQuote;
  inputAmount: string;
  outputAmount: string;
  unusedInputAmount: string;
  submittedTransactionHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

export type PrivateLiquidityAllowancePreparation = Readonly<{
  accountSetupTransactionHash?: string;
  allowanceRefreshTransactionHash?: string;
  approvalTransactionHash?: string;
  usedPrivateApproval: boolean;
}>;

export type PrivateLiquidityPositionAction =
  | Readonly<{
      kind: 'create';
      baseToken: string;
      quoteToken: string;
      buyTerms: PrivateLiquiditySideTerms;
      sellTerms: PrivateLiquiditySideTerms;
      baseInventory: bigint | number | string;
      quoteInventory: bigint | number | string;
    }>
  | Readonly<{
      kind: 'update-terms';
      positionId: bigint | number | string;
      expectedRevision: bigint | number | string;
      buyTerms: PrivateLiquiditySideTerms;
      sellTerms: PrivateLiquiditySideTerms;
    }>
  | Readonly<{
      kind: 'add-liquidity' | 'remove-liquidity';
      positionId: bigint | number | string;
      expectedRevision: bigint | number | string;
      baseAmount: bigint | number | string;
      quoteAmount: bigint | number | string;
    }>
  | Readonly<{
      kind: 'pause' | 'resume' | 'close';
      positionId: bigint | number | string;
      expectedRevision: bigint | number | string;
    }>
  | Readonly<{
      kind: 'activate-privacy';
      positionId: bigint | number | string;
      expectedRevision: bigint | number | string;
      resume: boolean;
    }>
  | Readonly<{
      kind: 'transfer';
      positionId: bigint | number | string;
      expectedRevision: bigint | number | string;
      recipient: string;
    }>;

declare const PRIVATE_LIQUIDITY_POSITION_SUBMISSION_BRAND: unique symbol;
export type PrivateLiquidityPositionActionSubmission = Readonly<{
  action: PrivateLiquidityPositionAction['kind'];
  transaction: PrivateLiquidityTransaction;
  submittedTransactionHash: string;
  readonly [PRIVATE_LIQUIDITY_POSITION_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateLiquidityPositionAction = Readonly<{
  action: PrivateLiquidityPositionAction['kind'];
  positionId: string;
  submittedTransactionHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

export type PrivateLiquidityHiddenIntentAction =
  | Readonly<{ kind: 'create-hidden-intent'; prepared: PreparedPrivateLiquidityHiddenIntent }>
  | Readonly<{
      kind: 'cancel-hidden-intent' | 'reclaim-expired-hidden-intent';
      intentId: bigint | number | string;
    }>;

declare const PRIVATE_LIQUIDITY_HIDDEN_INTENT_SUBMISSION_BRAND: unique symbol;
export type PrivateLiquidityHiddenIntentSubmission = Readonly<{
  action: PrivateLiquidityHiddenIntentAction['kind'];
  transaction: PrivateLiquidityTransaction;
  submittedTransactionHash: string;
  readonly [PRIVATE_LIQUIDITY_HIDDEN_INTENT_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateLiquidityHiddenIntentAction = Readonly<{
  action: PrivateLiquidityHiddenIntentAction['kind'];
  intentId: string;
  submittedTransactionHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

declare const PRIVATE_LIQUIDITY_HIDDEN_SETTLEMENT_SUBMISSION_BRAND: unique symbol;
export type PrivateLiquidityHiddenIntentSettlementSubmission = Readonly<{
  routes: PrivateLiquidityHiddenIntentSettlementRoutes;
  transaction: PrivateLiquidityTransaction;
  submittedTransactionHash: string;
  readonly [PRIVATE_LIQUIDITY_HIDDEN_SETTLEMENT_SUBMISSION_BRAND]: true;
}>;

export type ConfirmedPrivateLiquidityHiddenIntentSettlement = Readonly<{
  settlementId: string;
  pairKey: string;
  caller: string;
  processedIntentCount: number;
  candidateCount: number;
  submittedTransactionHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}>;

export type PrivateLiquidityHiddenIntentPairStatus = Readonly<{
  pairKey: string;
  openIntentCount: string;
  cursor: string;
  atBlock: Readonly<{ number: string; hash: string }>;
}>;

export type PrivateLiquidityHiddenIntentOwnerItem = Readonly<{
  view: PrivateLiquidityHiddenIntentPublicView;
  receipt: PrivateLiquidityHiddenIntentOwnerReceipt;
}>;

export type PrivateLiquidityHiddenIntentOwnerPage = Readonly<{
  items: readonly PrivateLiquidityHiddenIntentOwnerItem[];
  totalCount: string;
  nextOffset: string;
  atBlock: Readonly<{ number: string; hash: string }>;
}>;

export type PrivateLiquidityOwnerInventorySnapshot = Readonly<{
  positionId: string;
  recipient: string;
  sequence: string;
  baseAmount: string;
  quoteAmount: string;
  atBlock: Readonly<{ number: string; hash: string }>;
}>;

export type PrivateLiquidityOwnerPrivateData = Readonly<{
  inventory: PrivateLiquidityOwnerInventorySnapshot;
  history: CanonicalPrivateLiquidityHistorySnapshot;
}>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const SUBMISSIONS = new WeakSet<object>();
const POSITION_SUBMISSIONS = new WeakMap<object, Readonly<{
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  eventName: string;
  matches: (args: readonly unknown[]) => boolean;
}>>();
const HIDDEN_INTENT_SUBMISSIONS = new WeakMap<object, Readonly<{
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  eventName: string;
  matches: (args: readonly unknown[]) => boolean;
}>>();
const HIDDEN_SETTLEMENT_SUBMISSIONS = new WeakMap<object, Readonly<{
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  routes: PrivateLiquidityHiddenIntentSettlementRoutes;
}>>();

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

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const encryptedAmount = (value: unknown, label: string): PrivateLiquidityEncryptedUint256 => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is invalid.`);
  const tuple = value as Record<string | number, unknown>;
  const ciphertext = (tuple.ciphertext ?? tuple[0]) as Record<string | number, unknown> | undefined;
  const userCiphertext = (tuple.userCiphertext ?? tuple[1]) as Record<string | number, unknown> | undefined;
  if (!ciphertext || !userCiphertext) throw new Error(`${label} is missing ciphertext fields.`);
  return Object.freeze({
    ciphertextHigh: uint(ciphertext.ciphertextHigh ?? ciphertext[0], `${label} authenticated high`).toString(),
    ciphertextLow: uint(ciphertext.ciphertextLow ?? ciphertext[1], `${label} authenticated low`).toString(),
    userCiphertextHigh: uint(userCiphertext.ciphertextHigh ?? userCiphertext[0], `${label} user high`).toString(),
    userCiphertextLow: uint(userCiphertext.ciphertextLow ?? userCiphertext[1], `${label} user low`).toString()
  });
};

const addressAllowZero = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be bytes32.`);
  }
  return value.toLowerCase();
};

const hexBytes = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  return value.toLowerCase();
};

const encryptedReceiptUint256 = (
  value: unknown,
  label: string
): PrivateLiquidityEncryptedUint256 => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as {
    0?: { 0?: unknown; 1?: unknown };
    1?: { 0?: unknown; 1?: unknown };
  };
  if (!tuple[0] || !tuple[1]) throw new Error(`${label} is malformed.`);
  return Object.freeze({
    ciphertextHigh: uint(tuple[0][0], `${label} ciphertext high`).toString(),
    ciphertextLow: uint(tuple[0][1], `${label} ciphertext low`).toString(),
    userCiphertextHigh: uint(tuple[1][0], `${label} user ciphertext high`).toString(),
    userCiphertextLow: uint(tuple[1][1], `${label} user ciphertext low`).toString()
  });
};

const capabilityBinding = (capability: PrivateLiquidityMetaMaskCapability): CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('Private liquidity requires a current owner browser-wallet capability.');
  return binding;
};

const assertBindingCurrent = async (binding: CapabilityBinding): Promise<void> => {
  if (!(binding.browserProvider instanceof BrowserProvider) || binding.signer.provider !== binding.browserProvider) {
    throw new Error('Private-liquidity capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertCurrent();
};

const assertBindingSnapshotCurrent = async (binding: CapabilityBinding): Promise<void> => {
  if (!(binding.browserProvider instanceof BrowserProvider) || binding.signer.provider !== binding.browserProvider) {
    throw new Error('Private-liquidity capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertSnapshotCurrent();
};

const attestBindingScope = async (
  binding: CapabilityBinding,
  assertSnapshotCurrent?: () => void
): Promise<void> => {
  const [ownerValue, network] = await Promise.all([
    binding.signer.getAddress(),
    binding.browserProvider.getNetwork()
  ]);
  if (assertSnapshotCurrent) assertSnapshotCurrent();
  else await binding.assertCurrent();
  const owner = address(ownerValue, 'Connected private-liquidity owner');
  if (owner !== binding.ownerAddress || uint(network.chainId, 'Connected private-liquidity chain') !== binding.chainId) {
    throw new Error('Private-liquidity capability account or chain changed.');
  }
};

export const bindPrivateLiquidityMetaMaskCapability = async ({
  signer,
  browserProvider,
  readProvider,
  ownerAddress,
  chainId,
  assertCurrent,
  assertSnapshotCurrent
}: {
  signer: JsonRpcSigner;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider;
  ownerAddress: string;
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
}): Promise<PrivateLiquidityMetaMaskCapability> => {
  const candidate = signer as JsonRpcSigner & {
    privateKey?: unknown;
    sendUncheckedTransaction?: unknown;
  };
  if (!(browserProvider instanceof BrowserProvider) || !candidate || candidate.provider !== browserProvider ||
      typeof candidate.getAddress !== 'function' || typeof candidate.sendUncheckedTransaction !== 'function' ||
      typeof candidate.getUserOnboardInfo !== 'function' || typeof assertCurrent !== 'function' ||
      (assertSnapshotCurrent !== undefined && typeof assertSnapshotCurrent !== 'function') ||
      'privateKey' in candidate) {
    throw new Error('Private liquidity requires the owner signer from the exact COTI BrowserProvider session.');
  }
  const binding = Object.freeze({
    assertCurrent,
    assertSnapshotCurrent: assertSnapshotCurrent ?? assertCurrent,
    browserProvider,
    ...(readProvider ? { readProvider } : {}),
    chainId: uint(chainId, 'Expected private-liquidity chain'),
    ownerAddress: address(ownerAddress, 'Expected private-liquidity owner'),
    signer: candidate
  });
  if (binding.chainId === 0n) throw new Error('Expected private-liquidity chain cannot be zero.');
  await attestBindingScope(binding, assertSnapshotCurrent);
  const capability = Object.freeze({}) as PrivateLiquidityMetaMaskCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

export const assertPrivateLiquidityMetaMaskCapabilityCurrent = async ({
  capability,
  ownerAddress,
  chainId
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  ownerAddress: string;
  chainId: bigint;
}): Promise<void> => {
  const binding = capabilityBinding(capability);
  if (binding.ownerAddress !== address(ownerAddress, 'Expected private-liquidity owner') ||
      binding.chainId !== uint(chainId, 'Expected private-liquidity chain')) {
    throw new Error('Private-liquidity capability belongs to another account or chain.');
  }
  await assertBindingCurrent(binding);
};

const directionCode = (direction: PrivateLiquiditySwapQuote['direction']): number =>
  direction === 'base-to-quote' ? 0 : 1;

const transactionEnvelope = (
  value: unknown,
  expected: Readonly<{ chainId: bigint; from: string; to: string; data: string }>,
  label: string,
  binding?: CapabilityBinding
): PrivateLiquidityTransaction => {
  if (!value || typeof value !== 'object') throw new Error(`${label} transaction is missing.`);
  const tx = value as Record<string, unknown>;
  if (typeof tx.wait !== 'function') throw new Error(`${label} transaction cannot be confirmed.`);
  const transactionHash = bytes32(tx.hash, `${label} transaction hash`);
  const nativeWait = (tx.wait as () => Promise<unknown>).bind(value);
  const normalized = Object.freeze({
    hash: transactionHash,
    chainId: resolveBoundTransactionChain(tx.chainId, expected.chainId, label),
    from: address(tx.from, `${label} transaction sender`),
    to: address(tx.to, `${label} transaction target`),
    data: hexBytes(tx.data, `${label} transaction data`),
    value: uint(tx.value, `${label} transaction value`),
    wait: binding?.readProvider
      ? () => waitForPublicTransactionReceipt({
          transactionHash,
          label,
          readProvider: binding.readProvider
        })
      : nativeWait
  });
  if (normalized.chainId !== expected.chainId || normalized.from !== expected.from ||
      normalized.to !== expected.to || normalized.data !== expected.data || normalized.value !== 0n) {
    throw new Error(`${label} transaction does not match the exact intended action.`);
  }
  return normalized;
};

const normalizedTerms = (
  terms: PrivateLiquiditySideTerms,
  label: string
): Readonly<{ baseAmount: bigint; quoteAmount: bigint }> => {
  const parsed = validatePrivateLiquidityTerms(terms, label);
  if (parsed.baseAmount > UINT128_MAX || parsed.quoteAmount > UINT128_MAX) {
    throw new Error(`${label} terms exceed the private-liquidity uint128 limit.`);
  }
  return parsed;
};

const normalizedSpread = (
  buyTerms: PrivateLiquiditySideTerms,
  sellTerms: PrivateLiquiditySideTerms
): Readonly<{
  buyTerms: Readonly<{ baseAmount: bigint; quoteAmount: bigint }>;
  sellTerms: Readonly<{ baseAmount: bigint; quoteAmount: bigint }>;
}> => {
  const buy = normalizedTerms(buyTerms, 'Buy');
  const sell = normalizedTerms(sellTerms, 'Sell');
  if (buy.quoteAmount * sell.baseAmount > sell.quoteAmount * buy.baseAmount) {
    throw new Error('Private-liquidity buy terms cannot cross the sell terms.');
  }
  return Object.freeze({ buyTerms: buy, sellTerms: sell });
};

const packedPair = (
  baseAmount: bigint | number | string,
  quoteAmount: bigint | number | string,
  label: string
): bigint => {
  const base = uint(baseAmount, `${label} base amount`, UINT128_MAX);
  const quote = uint(quoteAmount, `${label} quote amount`, UINT128_MAX);
  if (base === 0n && quote === 0n) throw new Error(`${label} must include at least one positive amount.`);
  return base * PACK_BASE + quote;
};

const positionIdAndRevision = (
  positionId: bigint | number | string,
  expectedRevision: bigint | number | string
): Readonly<{ positionId: bigint; expectedRevision: bigint }> => {
  const id = uint(positionId, 'Private-liquidity position ID');
  const revision = uint(expectedRevision, 'Private-liquidity expected revision', UINT64_MAX);
  if (id === 0n || revision === 0n) {
    throw new Error('Private-liquidity position ID and revision must be positive.');
  }
  return Object.freeze({ positionId: id, expectedRevision: revision });
};

export const submitPrivateLiquidityPositionAction = async ({
  capability,
  deployment,
  action
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  action: PrivateLiquidityPositionAction;
}): Promise<PrivateLiquidityPositionActionSubmission> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Private-liquidity capability and deployment chains differ.');
  }

  let method: string;
  let args: readonly unknown[];
  let eventName: string;
  let matches: (eventArgs: readonly unknown[]) => boolean;

  if (action.kind === 'create') {
    const baseToken = address(action.baseToken, 'Private-liquidity base token');
    const quoteToken = address(action.quoteToken, 'Private-liquidity quote token');
    const pairKey = buildPrivateLiquidityPairKey(baseToken, quoteToken).toLowerCase();
    const spread = normalizedSpread(action.buyTerms, action.sellTerms);
    const packedInventory = packedPair(action.baseInventory, action.quoteInventory, 'Initial inventory');
    const encryptedInventory = await encryptPrivateUint256Input(
      binding.signer,
      packedInventory,
      deployment.contractAddress,
      PRIVATE_LIQUIDITY_CREATE_POSITION_SELECTOR
    );
    await assertBindingSnapshotCurrent(binding);
    method = 'createPosition';
    args = [baseToken, quoteToken, spread.buyTerms, spread.sellTerms, encryptedInventory];
    eventName = 'PrivateLiquidityPositionCreated';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Created position ID') > 0n &&
      address(eventArgs[1], 'Created position owner') === binding.ownerAddress &&
      bytes32(eventArgs[2], 'Created position pair') === pairKey &&
      address(eventArgs[3], 'Created base token') === baseToken &&
      address(eventArgs[4], 'Created quote token') === quoteToken &&
      uint((eventArgs[5] as { baseAmount?: unknown }).baseAmount, 'Created buy base') === spread.buyTerms.baseAmount &&
      uint((eventArgs[5] as { quoteAmount?: unknown }).quoteAmount, 'Created buy quote') === spread.buyTerms.quoteAmount &&
      uint((eventArgs[6] as { baseAmount?: unknown }).baseAmount, 'Created sell base') === spread.sellTerms.baseAmount &&
      uint((eventArgs[6] as { quoteAmount?: unknown }).quoteAmount, 'Created sell quote') === spread.sellTerms.quoteAmount &&
      uint(eventArgs[7], 'Created position timestamp', UINT64_MAX) > 0n &&
      uint(eventArgs[8], 'Created position revision', UINT64_MAX) === 1n;
  } else if (action.kind === 'update-terms') {
    const identity = positionIdAndRevision(action.positionId, action.expectedRevision);
    const spread = normalizedSpread(action.buyTerms, action.sellTerms);
    method = 'updatePositionTerms';
    args = [identity.positionId, identity.expectedRevision, spread.buyTerms, spread.sellTerms];
    eventName = 'PrivateLiquidityPositionTermsUpdated';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Updated position ID') === identity.positionId &&
      address(eventArgs[1], 'Updated position owner') === binding.ownerAddress &&
      uint((eventArgs[2] as { baseAmount?: unknown }).baseAmount, 'Updated buy base') === spread.buyTerms.baseAmount &&
      uint((eventArgs[2] as { quoteAmount?: unknown }).quoteAmount, 'Updated buy quote') === spread.buyTerms.quoteAmount &&
      uint((eventArgs[3] as { baseAmount?: unknown }).baseAmount, 'Updated sell base') === spread.sellTerms.baseAmount &&
      uint((eventArgs[3] as { quoteAmount?: unknown }).quoteAmount, 'Updated sell quote') === spread.sellTerms.quoteAmount &&
      uint(eventArgs[4], 'Updated position revision', UINT64_MAX) === identity.expectedRevision + 1n;
  } else if (action.kind === 'add-liquidity' || action.kind === 'remove-liquidity') {
    const identity = positionIdAndRevision(action.positionId, action.expectedRevision);
    const packedAmounts = packedPair(action.baseAmount, action.quoteAmount, 'Liquidity change');
    method = action.kind === 'add-liquidity' ? 'addLiquidity' : 'removeLiquidity';
    const selector = action.kind === 'add-liquidity'
      ? PRIVATE_LIQUIDITY_ADD_LIQUIDITY_SELECTOR
      : PRIVATE_LIQUIDITY_REMOVE_LIQUIDITY_SELECTOR;
    const encryptedAmounts = await encryptPrivateUint256Input(
      binding.signer,
      packedAmounts,
      deployment.contractAddress,
      selector
    );
    await assertBindingSnapshotCurrent(binding);
    args = [identity.positionId, identity.expectedRevision, encryptedAmounts];
    eventName = 'PrivateLiquidityPositionLiquidityChanged';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Liquidity position ID') === identity.positionId &&
      address(eventArgs[1], 'Liquidity position owner') === binding.ownerAddress &&
      address(eventArgs[2], 'Liquidity actor') === binding.ownerAddress &&
      uint(eventArgs[3], 'Liquidity position revision', UINT64_MAX) === identity.expectedRevision + 1n;
  } else if (action.kind === 'activate-privacy') {
    const identity = positionIdAndRevision(action.positionId, action.expectedRevision);
    method = 'activatePositionPrivacy';
    args = [identity.positionId, identity.expectedRevision, action.resume];
    eventName = 'PrivateLiquidityPositionPrivacyActivated';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Activated position ID') === identity.positionId &&
      address(eventArgs[1], 'Activated position owner') === binding.ownerAddress &&
      eventArgs[2] === action.resume &&
      uint(eventArgs[3], 'Activated position revision', UINT64_MAX) === identity.expectedRevision + 1n;
  } else if (action.kind === 'transfer') {
    const identity = positionIdAndRevision(action.positionId, action.expectedRevision);
    const recipient = address(action.recipient, 'Private-liquidity transfer recipient');
    if (recipient === binding.ownerAddress) {
      throw new Error('Private-liquidity transfer recipient must differ from the current owner.');
    }
    method = 'transferPosition';
    args = [recipient, identity.positionId, identity.expectedRevision];
    eventName = 'PrivateLiquidityPositionTransferActivationRequired';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Transferred position ID') === identity.positionId &&
      address(eventArgs[1], 'Previous position owner') === binding.ownerAddress &&
      address(eventArgs[2], 'Next position owner') === recipient &&
      uint(eventArgs[3], 'Transferred position revision', UINT64_MAX) === identity.expectedRevision + 1n;
  } else {
    const identity = positionIdAndRevision(action.positionId, action.expectedRevision);
    method = action.kind === 'pause'
      ? 'pausePosition'
      : action.kind === 'resume'
        ? 'resumePosition'
        : 'closePosition';
    args = [identity.positionId, identity.expectedRevision];
    if (action.kind === 'close') {
      eventName = 'PrivateLiquidityPositionClosed';
      matches = (eventArgs) =>
        uint(eventArgs[0], 'Closed position ID') === identity.positionId &&
        address(eventArgs[1], 'Closed position owner') === binding.ownerAddress;
    } else {
      const previousStatus = action.kind === 'pause' ? 0n : 1n;
      const nextStatus = action.kind === 'pause' ? 1n : 0n;
      eventName = 'PrivateLiquidityPositionStatusChanged';
      matches = (eventArgs) =>
        uint(eventArgs[0], 'Status position ID') === identity.positionId &&
        address(eventArgs[1], 'Status position owner') === binding.ownerAddress &&
        uint(eventArgs[2], 'Previous position status') === previousStatus &&
        uint(eventArgs[3], 'Next position status') === nextStatus &&
        address(eventArgs[4], 'Status actor') === binding.ownerAddress &&
        uint(eventArgs[5], 'Status position revision', UINT64_MAX) === identity.expectedRevision + 1n;
    }
  }

  const data = SWAP_INTERFACE.encodeFunctionData(method, [...args]).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  await assertBindingSnapshotCurrent(binding);
  const contract = new Contract(deployment.contractAddress, PRIVATE_LIQUIDITY_ACTION_ABI, binding.signer) as unknown as Record<
    string,
    (...values: readonly unknown[]) => Promise<unknown>
  >;
  const rawTransaction = await contract[method](...args, {
    gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT
  });
  await assertBindingSnapshotCurrent(binding);
  const transaction = transactionEnvelope(rawTransaction, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data
  }, `Private-liquidity ${action.kind}`, binding);
  const submission = Object.freeze({
    action: action.kind,
    transaction,
    submittedTransactionHash: transaction.hash
  }) as unknown as PrivateLiquidityPositionActionSubmission;
  POSITION_SUBMISSIONS.set(submission, Object.freeze({
    capability,
    deployment,
    eventName,
    matches
  }));
  return submission;
};

export const submitPrivateLiquiditySwap = async ({
  capability,
  deployment,
  plan,
  inputAmount,
  slippageBps,
  minimumFillBps,
  deadline
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  plan: PrivateLiquidityCandidatePlan;
  inputAmount: bigint | number | string;
  slippageBps: number;
  minimumFillBps: number;
  deadline: bigint;
}): Promise<PrivateLiquiditySwapSubmission> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Private-liquidity capability and deployment chains differ.');
  }
  if (plan.chainId !== deployment.chainId || plan.contractAddress !== deployment.contractAddress) {
    throw new Error('Private-liquidity candidate plan belongs to another deployment.');
  }
  if (plan.candidates.length === 0 || plan.candidates.length > 8) {
    throw new Error('Private-liquidity candidate plan is empty or exceeds the contract cap.');
  }
  if (plan.baseToken !== address(plan.baseToken, 'Private-liquidity base token') ||
      plan.quoteToken !== address(plan.quoteToken, 'Private-liquidity quote token')) {
    throw new Error('Private-liquidity candidate plan token addresses are not canonical.');
  }
  const deadlineValue = uint(deadline, 'Private-liquidity deadline', UINT64_MAX);
  if (deadlineValue === 0n) throw new Error('Private-liquidity deadline cannot be zero.');
  const quote = preparePrivateLiquiditySwapQuote({ plan, inputAmount, slippageBps, minimumFillBps });
  const candidateIds = quote.candidates.map(({ positionId }) => uint(positionId, 'Candidate position ID'));
  const expectedRevisions = quote.candidates.map(({ expectedRevision }) => {
    const revision = uint(expectedRevision, 'Candidate revision', UINT64_MAX);
    if (revision === 0n) throw new Error('Candidate revision cannot be zero.');
    return revision;
  });
  const encryptedSwap = await encryptPrivateUint256Input(
    binding.signer,
    BigInt(quote.packedSwapValue),
    deployment.contractAddress,
    PRIVATE_LIQUIDITY_SWAP_SELECTOR
  );
  await assertBindingSnapshotCurrent(binding);
  const args = [
    plan.baseToken,
    plan.quoteToken,
    directionCode(plan.direction),
    candidateIds,
    expectedRevisions,
    deadlineValue,
    encryptedSwap
  ] as const;
  const data = SWAP_INTERFACE.encodeFunctionData('swapBest', [...args]).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  await assertBindingSnapshotCurrent(binding);
  const contract = new Contract(deployment.contractAddress, PRIVATE_LIQUIDITY_SWAP_ABI, binding.signer);
  const rawTransaction = await contract.swapBest(...args, {
    // A two-position COTI testnet swap consumes about 20.7M gas. Scale the
    // ceiling with the bounded route instead of reusing the 12M CRUD limit.
    gasLimit: getPrivateLiquiditySwapGasLimit(candidateIds.length)
  });
  await assertBindingSnapshotCurrent(binding);
  const transaction = transactionEnvelope(rawTransaction, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data
  }, 'Private-liquidity swap', binding);
  const submission = Object.freeze({
    quote,
    transaction,
    submittedTransactionHash: transaction.hash
  }) as unknown as PrivateLiquiditySwapSubmission;
  SUBMISSIONS.add(submission);
  return submission;
};

export const submitPrivateLiquidityHiddenIntentAction = async ({
  capability,
  deployment,
  action
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  action: PrivateLiquidityHiddenIntentAction;
}): Promise<PrivateLiquidityHiddenIntentSubmission> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  if (deployment.contractVersion !== 'ChainWhisperPrivateLiquidityBookV2') {
    throw new Error('Hidden intents require the exactly attested Private Liquidity V2 Book.');
  }
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Hidden-intent capability and deployment chains differ.');
  }

  let method: string;
  let args: readonly unknown[];
  let eventName: string;
  let matches: (eventArgs: readonly unknown[]) => boolean;
  if (action.kind === 'create-hidden-intent') {
    assertPreparedPrivateLiquidityHiddenIntent(action.prepared);
    const prepared = action.prepared;
    const baseToken = address(prepared.baseToken, 'Hidden-intent base token');
    const quoteToken = address(prepared.quoteToken, 'Hidden-intent quote token');
    const pairKey = buildPrivateLiquidityPairKey(baseToken, quoteToken).toLowerCase();
    if (pairKey !== bytes32(prepared.pairKey, 'Hidden-intent pair')) {
      throw new Error('Hidden-intent prepared pair is inconsistent.');
    }
    const cooldownBlocks = uint(prepared.cooldownBlocks, 'Hidden-intent cooldown blocks', (1n << 32n) - 1n);
    const expiresAt = uint(prepared.expiresAt, 'Hidden-intent expiry', UINT64_MAX);
    const privateTerms = await encryptPrivateUint256Input(
      binding.signer,
      BigInt(prepared.privateTermsPlaintext),
      deployment.contractAddress,
      PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR
    );
    await assertBindingSnapshotCurrent(binding);
    const privateBudget = await encryptPrivateUint256Input(
      binding.signer,
      BigInt(prepared.privateBudgetPlaintext),
      deployment.contractAddress,
      PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR
    );
    await assertBindingSnapshotCurrent(binding);
    method = 'createHiddenIntent';
    args = [baseToken, quoteToken, cooldownBlocks, expiresAt, privateTerms, privateBudget];
    eventName = 'PrivateLiquidityHiddenIntentOpened';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Opened hidden-intent ID') > 0n &&
      address(eventArgs[1], 'Opened hidden-intent owner') === binding.ownerAddress &&
      bytes32(eventArgs[2], 'Opened hidden-intent pair') === pairKey &&
      address(eventArgs[3], 'Opened hidden-intent base token') === baseToken &&
      address(eventArgs[4], 'Opened hidden-intent quote token') === quoteToken &&
      uint(eventArgs[5], 'Opened hidden-intent timestamp', UINT64_MAX) > 0n &&
      uint(eventArgs[6], 'Opened hidden-intent expiry', UINT64_MAX) === expiresAt &&
      uint(eventArgs[7], 'Opened hidden-intent cooldown', (1n << 32n) - 1n) === cooldownBlocks;
  } else {
    const intentId = uint(action.intentId, 'Hidden-intent ID');
    if (intentId === 0n) throw new Error('Hidden-intent ID must be positive.');
    method = action.kind === 'cancel-hidden-intent'
      ? 'cancelHiddenIntent'
      : 'reclaimExpiredHiddenIntent';
    args = [intentId];
    eventName = action.kind === 'cancel-hidden-intent'
      ? 'PrivateLiquidityHiddenIntentCancelled'
      : 'PrivateLiquidityHiddenIntentExpired';
    matches = (eventArgs) =>
      uint(eventArgs[0], 'Updated hidden-intent ID') === intentId &&
      address(eventArgs[1], 'Updated hidden-intent owner') === binding.ownerAddress &&
      (action.kind === 'cancel-hidden-intent' ||
        address(eventArgs[2], 'Hidden-intent expiry actor') === binding.ownerAddress);
  }

  const data = SWAP_INTERFACE.encodeFunctionData(method, [...args]).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  await assertBindingSnapshotCurrent(binding);
  const contract = new Contract(deployment.contractAddress, PRIVATE_LIQUIDITY_ACTION_ABI, binding.signer) as unknown as Record<
    string,
    (...values: readonly unknown[]) => Promise<unknown>
  >;
  const rawTransaction = await contract[method](...args, {
    gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT
  });
  await assertBindingSnapshotCurrent(binding);
  const transaction = transactionEnvelope(rawTransaction, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data
  }, `Private-liquidity ${action.kind}`, binding);
  const submission = Object.freeze({
    action: action.kind,
    transaction,
    submittedTransactionHash: transaction.hash
  }) as unknown as PrivateLiquidityHiddenIntentSubmission;
  HIDDEN_INTENT_SUBMISSIONS.set(submission, Object.freeze({
    capability,
    deployment,
    eventName,
    matches
  }));
  return submission;
};

export const submitPrivateLiquidityHiddenIntentSettlement = async ({
  capability,
  deployment,
  routes,
  deadline
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  routes: PrivateLiquidityHiddenIntentSettlementRoutes;
  deadline: bigint | number | string;
}): Promise<PrivateLiquidityHiddenIntentSettlementSubmission> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes(routes);
  if (deployment.contractVersion !== 'ChainWhisperPrivateLiquidityBookV2') {
    throw new Error('Hidden-intent settlement requires the exactly attested Private Liquidity V2 Book.');
  }
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (
    binding.chainId !== BigInt(deployment.chainId) ||
    routes.chainId !== deployment.chainId ||
    routes.contractAddress !== deployment.contractAddress
  ) {
    throw new Error('Hidden-intent settlement routes belong to another deployment.');
  }
  const pairKey = bytes32(routes.pairKey, 'Hidden-intent settlement pair');
  const candidateCount = routes.asks.positionIds.length;
  if (
    candidateCount === 0 ||
    candidateCount > 8 ||
    routes.asks.expectedRevisions.length !== candidateCount ||
    routes.bids.positionIds.length !== candidateCount ||
    routes.bids.expectedRevisions.length !== candidateCount
  ) {
    throw new Error('Hidden-intent settlement routes have an invalid candidate count.');
  }
  const askPositionIds = routes.asks.positionIds.map((value) => {
    const parsed = uint(value, 'Hidden-intent ask position ID');
    if (parsed === 0n) throw new Error('Hidden-intent position IDs must be positive.');
    return parsed;
  });
  const bidPositionIds = routes.bids.positionIds.map((value) => {
    const parsed = uint(value, 'Hidden-intent bid position ID');
    if (parsed === 0n) throw new Error('Hidden-intent position IDs must be positive.');
    return parsed;
  });
  const askExpectedRevisions = routes.asks.expectedRevisions.map((value) =>
    uint(value, 'Hidden-intent ask revision', UINT64_MAX)
  );
  const bidExpectedRevisions = routes.bids.expectedRevisions.map((value) =>
    uint(value, 'Hidden-intent bid revision', UINT64_MAX)
  );
  if ([...askExpectedRevisions, ...bidExpectedRevisions].some((revision) => revision === 0n)) {
    throw new Error('Hidden-intent settlement revisions must be positive.');
  }
  const settlementDeadline = uint(deadline, 'Hidden-intent settlement deadline', UINT64_MAX);
  if (settlementDeadline === 0n) throw new Error('Hidden-intent settlement deadline must be positive.');
  const args = [
    pairKey,
    askPositionIds,
    askExpectedRevisions,
    bidPositionIds,
    bidExpectedRevisions,
    settlementDeadline
  ] as const;
  const data = SWAP_INTERFACE.encodeFunctionData('settleHiddenIntents', [...args]).toLowerCase();
  const { Contract } = await loadCotiEthersModule();
  await assertBindingSnapshotCurrent(binding);
  const contract = new Contract(
    deployment.contractAddress,
    PRIVATE_LIQUIDITY_ACTION_ABI,
    binding.signer
  ) as unknown as Record<string, (...values: readonly unknown[]) => Promise<unknown>>;
  const rawTransaction = await contract.settleHiddenIntents(...args, {
    gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT
  });
  await assertBindingSnapshotCurrent(binding);
  const transaction = transactionEnvelope(rawTransaction, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    data
  }, 'Private-liquidity hidden-intent settlement', binding);
  const submission = Object.freeze({
    routes,
    transaction,
    submittedTransactionHash: transaction.hash
  }) as unknown as PrivateLiquidityHiddenIntentSettlementSubmission;
  HIDDEN_SETTLEMENT_SUBMISSIONS.set(submission, Object.freeze({
    capability,
    deployment,
    routes
  }));
  return submission;
};

const confirmedReceipt = async (
  transaction: PrivateLiquidityTransaction,
  label: string
): Promise<Readonly<{ receipt: Record<string, unknown>; transactionHash: string }>> => {
  let receiptValue: unknown;
  let effectiveHash = transaction.hash;
  try {
    receiptValue = await transaction.wait();
  } catch (error) {
    const replaced = error as Record<string, unknown> | null;
    if (!replaced || replaced.code !== 'TRANSACTION_REPLACED') throw error;
    if (replaced.cancelled === true || replaced.reason === 'cancelled') {
      throw new Error(`${label} replacement was cancelled.`);
    }
    const replacement = transactionEnvelope(replaced.replacement, transaction, `Replacement ${label}`);
    effectiveHash = replacement.hash;
    receiptValue = replaced.receipt;
  }
  if (!receiptValue || typeof receiptValue !== 'object') {
    throw new Error(`${label} did not return a receipt.`);
  }
  const receipt = receiptValue as Record<string, unknown>;
  if (uint(receipt.status, 'Private-liquidity receipt status') !== 1n) {
    throw new Error(`${label} transaction did not succeed.`);
  }
  const receiptHash = bytes32(
    receipt.hash ?? receipt.transactionHash,
    'Private-liquidity receipt transaction hash'
  );
  if (receiptHash !== effectiveHash) throw new Error('Private-liquidity receipt belongs to another transaction.');
  return Object.freeze({ receipt, transactionHash: effectiveHash });
};

const privateTokenAllowance = async ({
  binding,
  spenderAddress,
  contract
}: {
  binding: CapabilityBinding;
  spenderAddress: string;
  contract: Record<string, unknown>;
}): Promise<bigint | null> => {
  const read = contract['allowance(address,address)'];
  if (typeof read !== 'function') throw new Error('Private token allowance reader is unavailable.');
  const raw = await (read as (owner: string, spender: string) => Promise<unknown>)(
    binding.ownerAddress,
    spenderAddress
  );
  if (!raw || typeof raw !== 'object') throw new Error('Private token allowance is malformed.');
  const tuple = raw as { ownerCiphertext?: unknown; 1?: unknown };
  const ownerCiphertext = tuple.ownerCiphertext ?? tuple[1];
  if (!ownerCiphertext || typeof ownerCiphertext !== 'object') return null;
  const ciphertext = ownerCiphertext as {
    ciphertextHigh?: bigint | number | string;
    ciphertextLow?: bigint | number | string;
  };
  let ciphertextHigh: bigint;
  let ciphertextLow: bigint;
  try {
    ciphertextHigh = BigInt(ciphertext.ciphertextHigh ?? -1);
    ciphertextLow = BigInt(ciphertext.ciphertextLow ?? -1);
  } catch {
    return null;
  }
  // PrivateERC20 uses the all-zero ciphertext as the unset allowance sentinel. It is not an
  // AES ciphertext: decrypting it produces a deterministic, key-dependent garbage value that can
  // look like a very large allowance and incorrectly suppress the first approval transaction.
  if (ciphertextHigh === 0n && ciphertextLow === 0n) return 0n;
  let decrypted: unknown;
  try {
    decrypted = decryptPrivateUint256Output(
      binding.signer,
      { ciphertextHigh, ciphertextLow }
    );
  } catch {
    await assertBindingSnapshotCurrent(binding);
    return null;
  }
  await assertBindingSnapshotCurrent(binding);
  const allowance = uint(decrypted, 'Decrypted private token allowance');
  // BookV2 accepts only uint128 private amounts. A larger decrypted allowance cannot be relevant
  // to this protocol and overwhelmingly indicates ciphertext from an older COTI AES key.
  return allowance <= UINT128_MAX || allowance === UINT256_MAX ? allowance : null;
};

/**
 * The allowance ciphertext was refreshed on-chain but the capability's cached AES key still
 * could not decrypt it. Callers must reacquire the capability with a fresh wallet privacy key;
 * repeating reencryptAllowance with the same cached key only creates another useless transaction.
 */
export class PrivateLiquidityAllowancePrivacyRefreshRequiredError extends Error {
  constructor() {
    super('Refresh the wallet privacy key before reading this private-token allowance again.');
    this.name = 'PrivateLiquidityAllowancePrivacyRefreshRequiredError';
  }
}

export const isPrivateLiquidityAllowancePrivacyRefreshRequired = (
  error: unknown
): error is PrivateLiquidityAllowancePrivacyRefreshRequiredError =>
  error instanceof PrivateLiquidityAllowancePrivacyRefreshRequiredError;

export { isPrivateLiquidityReceiptPrivacyRefreshRequired };

/**
 * Ensures the selected private input token can fund this escrow. The default policy approves only
 * the missing exact amount. The reuse-existing policy is strictly read-only and fails before any
 * token setup, ciphertext refresh, or approval transaction when the current allowance is unusable.
 * Keeping approvals within the protocol's uint128 amount domain avoids asking COTI's MPC layer to
 * validate uint256.max.
 */
export const ensurePrivateLiquidityInputAllowance = async ({
  capability,
  deployment,
  tokenAddress: tokenAddressInput,
  requiredAmount,
  approvalPolicy = 'approve-exact',
  onStage
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  tokenAddress: string;
  requiredAmount: bigint | number | string;
  approvalPolicy?: 'approve-exact' | 'reuse-existing';
  onStage?: (stage: 'setting-up-token' | 'refreshing-allowance' | 'approving-token') => void;
}): Promise<PrivateLiquidityAllowancePreparation> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Private-liquidity capability and deployment chains differ.');
  }
  const tokenAddress = address(tokenAddressInput, 'Private-liquidity input token');
  const amount = uint(requiredAmount, 'Private-liquidity approval requirement', UINT128_MAX);
  if (amount === 0n) throw new Error('Private-liquidity approval requirement must be positive.');
  const { Contract } = await loadCotiEthersModule();
  const contract = new Contract(tokenAddress, PRIVATE_TOKEN_ABI, binding.signer) as unknown as Record<string, unknown>;
  let accountSetupTransactionHash: string | undefined;
  const readEncryptionAddress = contract.accountEncryptionAddress;
  if (typeof readEncryptionAddress !== 'function') {
    throw new Error('Private token encryption-address reader is unavailable.');
  }
  const configuredAddress = addressAllowZero(
    await (readEncryptionAddress as (owner: string) => Promise<unknown>)(binding.ownerAddress),
    'Private token encryption address'
  );
  await assertBindingSnapshotCurrent(binding);
  if (configuredAddress !== binding.ownerAddress) {
    if (approvalPolicy === 'reuse-existing') {
      throw new Error('This token is not set up for the current privacy account. Choose exact approval to set it up.');
    }
    onStage?.('setting-up-token');
    const setup = contract.setAccountEncryptionAddress;
    if (typeof setup !== 'function') throw new Error('Private token account setup is unavailable.');
    const data = PRIVATE_TOKEN_INTERFACE.encodeFunctionData('setAccountEncryptionAddress', [
      binding.ownerAddress
    ]).toLowerCase();
    const raw = await (setup as (
      owner: string,
      overrides: { gasLimit: bigint }
    ) => Promise<unknown>)(binding.ownerAddress, {
      gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT
    });
    const transaction = transactionEnvelope(raw, {
      chainId: binding.chainId,
      from: binding.ownerAddress,
      to: tokenAddress,
      data
    }, 'Private token account setup', binding);
    accountSetupTransactionHash = (await confirmedReceipt(transaction, 'Private token account setup')).transactionHash;
    await assertBindingSnapshotCurrent(binding);
  }

  // A newly configured account may not yet have a recipient ciphertext. The following approval
  // creates one; the mandatory post-approval read must then decrypt successfully.
  let currentAllowance = await privateTokenAllowance({
    binding,
    spenderAddress: deployment.contractAddress,
    contract
  });
  let allowanceRefreshTransactionHash: string | undefined;
  if (currentAllowance === null) {
    if (approvalPolicy === 'reuse-existing') {
      throw new Error('The existing private allowance cannot be verified. Choose exact approval to refresh it.');
    }
    onStage?.('refreshing-allowance');
    const refresh = contract.reencryptAllowance;
    if (typeof refresh !== 'function') {
      throw new Error('Private token allowance refresh is unavailable.');
    }
    const data = PRIVATE_TOKEN_INTERFACE.encodeFunctionData('reencryptAllowance', [
      deployment.contractAddress,
      false
    ]).toLowerCase();
    const rawRefresh = await (refresh as (
      spender: string,
      isSpender: boolean,
      overrides: { gasLimit: bigint }
    ) => Promise<unknown>)(deployment.contractAddress, false, {
      gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT
    });
    const refreshTransaction = transactionEnvelope(rawRefresh, {
      chainId: binding.chainId,
      from: binding.ownerAddress,
      to: tokenAddress,
      data
    }, 'Private token allowance refresh', binding);
    allowanceRefreshTransactionHash = (
      await confirmedReceipt(refreshTransaction, 'Private token allowance refresh')
    ).transactionHash;
    await assertBindingSnapshotCurrent(binding);
    currentAllowance = await privateTokenAllowance({
      binding,
      spenderAddress: deployment.contractAddress,
      contract
    });
    if (currentAllowance === null) {
      throw new PrivateLiquidityAllowancePrivacyRefreshRequiredError();
    }
  }
  if (currentAllowance !== null && currentAllowance >= amount) {
    return Object.freeze({
      ...(accountSetupTransactionHash ? { accountSetupTransactionHash } : {}),
      ...(allowanceRefreshTransactionHash ? { allowanceRefreshTransactionHash } : {}),
      usedPrivateApproval: false
    });
  }

  if (approvalPolicy === 'reuse-existing') {
    throw new Error('The existing private allowance is below the required deposit. Choose exact approval to continue.');
  }

  onStage?.('approving-token');
  const publicAmountsEnabled = contract.publicAmountsEnabled;
  if (typeof publicAmountsEnabled !== 'function') {
    throw new Error('Private token public-amount policy is unavailable.');
  }
  const publicApproval = await (publicAmountsEnabled as () => Promise<unknown>)() === true;
  await assertBindingSnapshotCurrent(binding);
  const increasing = currentAllowance > 0n;
  const approvalSignature = publicApproval
    ? increasing
      ? 'increaseAllowance(address,uint256)'
      : 'approve(address,uint256)'
    : increasing
      ? 'increaseAllowance(address,((uint256,uint256),bytes))'
      : 'approve(address,((uint256,uint256),bytes))';
  const approval = contract[approvalSignature];
  if (typeof approval !== 'function') throw new Error('Private token approval method is unavailable.');
  const approvalAmount = publicApproval
    ? increasing
      ? amount - currentAllowance
      : amount
    : increasing
      ? amount - currentAllowance
      : amount;
  const approvalValue = publicApproval
    ? approvalAmount
    : await encryptPrivateUint256Input(
        binding.signer,
        approvalAmount,
        tokenAddress,
        PRIVATE_TOKEN_INTERFACE.getFunction(approvalSignature)?.selector ?? ''
      );
  await assertBindingSnapshotCurrent(binding);
  const data = PRIVATE_TOKEN_INTERFACE.encodeFunctionData(approvalSignature, [
    deployment.contractAddress,
    approvalValue
  ]).toLowerCase();
  const rawApproval = await (approval as (
    spender: string,
    value: unknown,
    overrides: { gasLimit: bigint }
  ) => Promise<unknown>)(
    deployment.contractAddress,
    approvalValue,
    { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT }
  );
  const approvalTransaction = transactionEnvelope(rawApproval, {
    chainId: binding.chainId,
    from: binding.ownerAddress,
    to: tokenAddress,
    data
  }, 'Private token approval', binding);
  const approvalTransactionHash = (
    await confirmedReceipt(approvalTransaction, 'Private token approval')
  ).transactionHash;
  await assertBindingSnapshotCurrent(binding);
  // The exact approval calldata and successful receipt are already bound above. COTI testnet RPC
  // replicas can briefly return the pre-transaction private ciphertext after that receipt. A
  // second immediate allowance read therefore creates a false failure and an unnecessary repeat
  // approval. The Position Book remains the final enforcement boundary when it consumes allowance.
  return Object.freeze({
    ...(accountSetupTransactionHash ? { accountSetupTransactionHash } : {}),
    ...(allowanceRefreshTransactionHash ? { allowanceRefreshTransactionHash } : {}),
    approvalTransactionHash,
    usedPrivateApproval: !publicApproval
  });
};

const hiddenIntentCall = async (
  binding: CapabilityBinding,
  deployment: AttestedPrivateLiquidityDeployment,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<readonly unknown[]> => {
  const data = SWAP_INTERFACE.encodeFunctionData(functionName, [...args]).toLowerCase();
  const raw = await binding.browserProvider.send('eth_call', [
    Object.freeze({ from: binding.ownerAddress, to: deployment.contractAddress, data }),
    Object.freeze({ blockHash, requireCanonical: true })
  ]);
  await assertBindingSnapshotCurrent(binding);
  const canonical = hexBytes(raw, `${functionName} response`);
  const decoded = SWAP_INTERFACE.decodeFunctionResult(functionName, canonical);
  if (SWAP_INTERFACE.encodeFunctionResult(functionName, [...decoded]).toLowerCase() !== canonical) {
    throw new Error(`${functionName} returned noncanonical ABI data.`);
  }
  return decoded;
};

const tupleField = (
  value: unknown,
  name: string,
  index: number,
  label: string
): unknown => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
};

const hiddenIntentUserCiphertext = (value: unknown, label: string): unknown => {
  const userCiphertext = tupleField(value, 'userCiphertext', 1, label);
  if (!userCiphertext || typeof userCiphertext !== 'object') {
    throw new Error(`${label} owner ciphertext is missing.`);
  }
  return userCiphertext;
};

export const readPrivateLiquidityHiddenIntentPairStatus = async ({
  capability,
  deployment,
  pairKey: pairKeyInput,
  atBlock
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  pairKey: string;
  atBlock: Readonly<{ number: string; hash: string }>;
}): Promise<PrivateLiquidityHiddenIntentPairStatus> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  if (deployment.contractVersion !== 'ChainWhisperPrivateLiquidityBookV2') {
    throw new Error('Hidden-intent pair status requires the exactly attested Private Liquidity V2 Book.');
  }
  const binding = capabilityBinding(capability);
  await assertBindingSnapshotCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Hidden-intent pair reader and deployment chains differ.');
  }
  const blockNumber = uint(atBlock.number, 'Hidden-intent pair-status block number', UINT64_MAX);
  const blockHash = bytes32(atBlock.hash, 'Hidden-intent pair-status block hash');
  const pairKey = bytes32(pairKeyInput, 'Hidden-intent pair-status pair');
  if (blockNumber === 0n) throw new Error('Hidden-intent pair status requires a non-zero canonical block.');
  const [countResult, cursorResult] = await Promise.all([
    hiddenIntentCall(binding, deployment, 'openHiddenIntentCountByPair', [pairKey], blockHash),
    hiddenIntentCall(binding, deployment, 'hiddenIntentCursorByPair', [pairKey], blockHash)
  ]);
  const openIntentCount = uint(countResult[0], 'Open hidden-intent count');
  const cursor = uint(cursorResult[0], 'Hidden-intent pair cursor');
  if ((openIntentCount === 0n && cursor !== 0n) || (openIntentCount !== 0n && cursor >= openIntentCount)) {
    throw new Error('Hidden-intent pair cursor is inconsistent with its open count.');
  }
  await assertBindingCurrent(binding);
  return Object.freeze({
    pairKey,
    openIntentCount: openIntentCount.toString(),
    cursor: cursor.toString(),
    atBlock: Object.freeze({ number: blockNumber.toString(), hash: blockHash })
  });
};

/**
 * Reads one bounded newest-first page of the connected owner's intents at the exact finalized
 * workspace block. Public lifecycle data and owner-only encrypted receipts are returned together;
 * no private term is exposed through the public provider or retained outside the caller's state.
 */
export const readPrivateLiquidityHiddenIntentOwnerPage = async ({
  capability,
  deployment,
  atBlock,
  offset = 0n,
  limit = 20n
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  atBlock: Readonly<{ number: string; hash: string }>;
  offset?: bigint;
  limit?: bigint;
}): Promise<PrivateLiquidityHiddenIntentOwnerPage> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  if (deployment.contractVersion !== 'ChainWhisperPrivateLiquidityBookV2') {
    throw new Error('Hidden-intent reads require the exactly attested Private Liquidity V2 Book.');
  }
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId)) {
    throw new Error('Hidden-intent reader and deployment chains differ.');
  }
  const blockNumber = uint(atBlock.number, 'Hidden-intent owner page block number', UINT64_MAX);
  const blockHash = bytes32(atBlock.hash, 'Hidden-intent owner page block hash');
  const pageOffset = uint(offset, 'Hidden-intent owner page offset');
  const pageLimit = uint(limit, 'Hidden-intent owner page limit', 64n);
  if (blockNumber === 0n || pageLimit === 0n) {
    throw new Error('Hidden-intent owner page requires a non-zero block and limit.');
  }
  const [countResult, idsResult] = await Promise.all([
    hiddenIntentCall(binding, deployment, 'hiddenIntentCountForOwner', [binding.ownerAddress], blockHash),
    hiddenIntentCall(
      binding,
      deployment,
      'getHiddenIntentIdsForOwner',
      [binding.ownerAddress, pageOffset, pageLimit],
      blockHash
    )
  ]);
  const totalCount = uint(countResult[0], 'Hidden-intent owner count');
  const rawIds = idsResult[0];
  if (!Array.isArray(rawIds) || rawIds.length > Number(pageLimit)) {
    throw new Error('Hidden-intent owner ID page is malformed.');
  }
  const ids = rawIds.map((value) => {
    const id = uint(value, 'Hidden-intent owner ID');
    if (id === 0n) throw new Error('Hidden-intent owner ID cannot be zero.');
    return id;
  });
  if (new Set(ids.map(String)).size !== ids.length) {
    throw new Error('Hidden-intent owner ID page contains duplicates.');
  }
  const nextOffset = uint(idsResult[1], 'Hidden-intent next offset');
  if ((nextOffset !== 0n && nextOffset !== pageOffset + BigInt(ids.length)) ||
      pageOffset + BigInt(ids.length) > totalCount) {
    throw new Error('Hidden-intent owner pagination is inconsistent.');
  }
  const items: PrivateLiquidityHiddenIntentOwnerItem[] = [];
  for (let start = 0; start < ids.length; start += 4) {
    const batch = ids.slice(start, start + 4);
    items.push(...await Promise.all(batch.map(async (intentId) => {
      const [viewResult, receiptResult] = await Promise.all([
        hiddenIntentCall(binding, deployment, 'getHiddenIntentView', [intentId], blockHash),
        hiddenIntentCall(binding, deployment, 'getHiddenIntentOwnerReceipt', [intentId], blockHash)
      ]);
      const rawView = viewResult[0];
      const rawIntent = tupleField(rawView, 'intent', 0, 'Hidden-intent view');
      const rawReceipt = receiptResult[0];
      const recipient = address(
        tupleField(rawReceipt, 'recipient', 0, 'Hidden-intent owner receipt'),
        'Hidden-intent owner receipt recipient'
      );
      if (recipient !== binding.ownerAddress ||
          tupleField(rawReceipt, 'initialized', 2, 'Hidden-intent owner receipt') !== true) {
        throw new Error('Hidden-intent owner receipt is not initialized for this connected owner.');
      }
      const encryptedFields = [
        hiddenIntentUserCiphertext(tupleField(rawReceipt, 'packedTerms', 3, 'Hidden-intent owner receipt'), 'Packed terms'),
        hiddenIntentUserCiphertext(tupleField(rawReceipt, 'packedBudget', 4, 'Hidden-intent owner receipt'), 'Packed budget'),
        hiddenIntentUserCiphertext(tupleField(rawReceipt, 'lastInputAmount', 5, 'Hidden-intent owner receipt'), 'Last input'),
        hiddenIntentUserCiphertext(tupleField(rawReceipt, 'lastOutputAmount', 6, 'Hidden-intent owner receipt'), 'Last output')
      ];
      const [packedTerms, packedBudget, lastInputAmount, lastOutputAmount] = encryptedFields.map(
        (ciphertext) => decryptPrivateUint256Output(
          binding.signer,
          ciphertext as { ciphertextHigh: bigint; ciphertextLow: bigint }
        )
      );
      await assertBindingSnapshotCurrent(binding);
      const view = materializePrivateLiquidityHiddenIntentPublicView({
        intentId,
        status: tupleField(rawIntent, 'status', 0, 'Hidden-intent state') as bigint,
        owner: tupleField(rawIntent, 'owner', 1, 'Hidden-intent state') as string,
        baseToken: tupleField(rawIntent, 'baseToken', 2, 'Hidden-intent state') as string,
        quoteToken: tupleField(rawIntent, 'quoteToken', 3, 'Hidden-intent state') as string,
        pairKey: tupleField(rawView, 'pairKey', 1, 'Hidden-intent view') as string,
        createdAt: tupleField(rawIntent, 'createdAt', 6, 'Hidden-intent state') as bigint,
        expiresAt: tupleField(rawIntent, 'expiresAt', 7, 'Hidden-intent state') as bigint,
        cooldownBlocks: tupleField(rawIntent, 'cooldownBlocks', 8, 'Hidden-intent state') as bigint,
        fillCount: tupleField(rawIntent, 'fillCount', 9, 'Hidden-intent state') as bigint,
        lastActivityBlock: tupleField(rawView, 'lastActivityBlock', 2, 'Hidden-intent view') as bigint,
        lastFillBlock: tupleField(rawView, 'lastFillBlock', 3, 'Hidden-intent view') as bigint,
        hasPrivateTerms: tupleField(rawView, 'hasPrivateTerms', 4, 'Hidden-intent view') as boolean
      });
      if (view.owner !== binding.ownerAddress || view.intentId !== intentId.toString()) {
        throw new Error('Hidden-intent owner view belongs to another wallet or ID.');
      }
      return Object.freeze({
        view,
        receipt: materializePrivateLiquidityHiddenIntentOwnerReceipt({
          intentId,
          recipient,
          sequence: tupleField(rawReceipt, 'sequence', 1, 'Hidden-intent owner receipt') as bigint,
          packedTerms: packedTerms as bigint,
          packedBudget: packedBudget as bigint,
          lastInputAmount: lastInputAmount as bigint,
          lastOutputAmount: lastOutputAmount as bigint
        })
      });
    })));
  }
  await assertBindingSnapshotCurrent(binding);
  return Object.freeze({
    items: Object.freeze(items),
    totalCount: totalCount.toString(),
    nextOffset: nextOffset.toString(),
    atBlock: Object.freeze({ number: blockNumber.toString(), hash: blockHash })
  });
};

/**
 * Reads complete finalized fill history without a transaction. History pages carry their own
 * provider-owned canonical safe-head proof and may legitimately trail the newer public workspace
 * snapshot by a few blocks. Every revealed amount retains the contract's uint128 complement
 * self-check before it reaches the UI.
 */
export const readPrivateLiquidityPrivateHistory = async ({
  capability,
  deployment,
  pages
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  pages: readonly CanonicalPrivateLiquidityLogRange[];
}): Promise<CanonicalPrivateLiquidityHistorySnapshot> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  if (binding.chainId !== BigInt(deployment.chainId) || pages.length === 0) {
    throw new Error('Wallet-private history requires the complete attested deployment history.');
  }
  const history = await materializeCanonicalPrivateLiquidityHistory({
    pages,
    viewer: binding.ownerAddress,
    decrypt: async (ciphertext) => decryptPrivateUint256Output(binding.signer, ciphertext)
  });
  await assertBindingSnapshotCurrent(binding);
  if (!history.coverage.completeFromDeploymentThroughSafeHead) {
    throw new Error('Wallet-private history does not completely cover its canonical safe head.');
  }
  return history;
};

export const readPrivateLiquidityOwnerPrivateData = async ({
  capability,
  deployment,
  position,
  atBlock,
  pages
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  position: PrivateLiquidityPosition;
  atBlock: Readonly<{ number: string; hash: string }>;
  pages: readonly CanonicalPrivateLiquidityLogRange[];
}): Promise<PrivateLiquidityOwnerPrivateData> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const binding = capabilityBinding(capability);
  await assertBindingCurrent(binding);
  const positionId = uint(position.identity.positionId, 'Owner inventory position ID');
  if (positionId === 0n || position.identity.chainId !== deployment.chainId ||
      normalizePrivateLiquidityAddress(position.identity.contractAddress, 'Owner inventory contract') !== deployment.contractAddress) {
    throw new Error('Owner inventory position belongs to another deployment.');
  }
  if (normalizePrivateLiquidityAddress(position.owner, 'Owner inventory NFT owner') !== binding.ownerAddress) {
    throw new Error('Owner inventory can only be revealed by the current Position NFT owner.');
  }
  if (!position.privacyOwner ||
      normalizePrivateLiquidityAddress(position.privacyOwner, 'Owner inventory privacy owner') !== binding.ownerAddress) {
    throw new Error('Position privacy must be activated by the current NFT owner before inventory can be revealed.');
  }
  if (binding.chainId !== BigInt(deployment.chainId) || pages.length === 0) {
    throw new Error('Owner private data requires the complete attested deployment history.');
  }
  const blockNumber = uint(atBlock.number, 'Owner inventory block number');
  const blockHash = bytes32(atBlock.hash, 'Owner inventory block hash');
  if (blockNumber === 0n || /^0x0{64}$/.test(blockHash)) {
    throw new Error('Owner inventory requires a non-zero canonical block.');
  }

  const decrypt = async (ciphertext: PrivateLiquidityUserCiphertext) =>
    decryptPrivateUint256Output(binding.signer, ciphertext);
  const inventoryPromise = (async (): Promise<PrivateLiquidityOwnerInventorySnapshot> => {
    const data = SWAP_INTERFACE.encodeFunctionData('getOwnerInventorySnapshot', [positionId]).toLowerCase();
    const raw = await binding.browserProvider.send('eth_call', [
      Object.freeze({ from: binding.ownerAddress, to: deployment.contractAddress, data }),
      Object.freeze({ blockHash, requireCanonical: true })
    ]);
    await assertBindingSnapshotCurrent(binding);
    const decoded = SWAP_INTERFACE.decodeFunctionResult(
      'getOwnerInventorySnapshot',
      hexBytes(raw, 'Owner inventory response')
    );
    const snapshot = decoded[0] as Record<string | number, unknown> | undefined;
    if (!snapshot) throw new Error('Owner inventory snapshot is missing.');
    const recipient = address(snapshot.recipient ?? snapshot[0], 'Owner inventory recipient');
    const sequence = uint(snapshot.sequence ?? snapshot[1], 'Owner inventory sequence', UINT64_MAX);
    if (recipient !== binding.ownerAddress || sequence === 0n || (snapshot.initialized ?? snapshot[2]) !== true) {
      throw new Error('Owner inventory snapshot is not initialized for this connected owner.');
    }
    const baseAmount = encryptedAmount(snapshot.baseAmount ?? snapshot[3], 'Owner base inventory');
    const quoteAmount = encryptedAmount(snapshot.quoteAmount ?? snapshot[4], 'Owner quote inventory');
    const [base, quote] = await Promise.all([
      decryptPrivateLiquidityReceiptAmount({ encrypted: baseAmount, decrypt }),
      decryptPrivateLiquidityReceiptAmount({ encrypted: quoteAmount, decrypt })
    ]);
    return Object.freeze({
      positionId: positionId.toString(),
      recipient,
      sequence: sequence.toString(),
      baseAmount: base.toString(),
      quoteAmount: quote.toString(),
      atBlock: Object.freeze({ number: blockNumber.toString(), hash: blockHash })
    });
  })();
  const historyPromise = readPrivateLiquidityPrivateHistory({
    capability,
    deployment,
    pages,
  });
  const [inventory, history] = await Promise.all([inventoryPromise, historyPromise]);
  await assertBindingSnapshotCurrent(binding);
  return Object.freeze({ inventory, history });
};

export const confirmPrivateLiquidityPositionAction = async ({
  capability,
  deployment,
  submission
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  submission: PrivateLiquidityPositionActionSubmission;
}): Promise<ConfirmedPrivateLiquidityPositionAction> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const expected = submission && POSITION_SUBMISSIONS.get(submission);
  if (!expected || expected.capability !== capability || expected.deployment !== deployment) {
    throw new Error('Private-liquidity position confirmation requires its exact local submission.');
  }
  const binding = capabilityBinding(capability);
  if (binding.chainId !== BigInt(deployment.chainId) ||
      submission.transaction.to !== deployment.contractAddress ||
      submission.transaction.from !== binding.ownerAddress) {
    throw new Error('Private-liquidity position submission belongs to another owner or deployment.');
  }
  const confirmation = await confirmedReceipt(submission.transaction, `Private-liquidity ${submission.action}`);
  const receipt = confirmation.receipt;
  if (!Array.isArray(receipt.logs)) throw new Error('Private-liquidity receipt logs are missing.');
  const matches: Array<Readonly<{
    positionId: bigint;
    blockNumber: bigint;
    blockHash: string;
    logIndex: number;
  }>> = [];
  for (const raw of receipt.logs) {
    if (!raw || typeof raw !== 'object') continue;
    const log = raw as Record<string, unknown>;
    let logAddress: string;
    try {
      logAddress = address(log.address, 'Private-liquidity receipt log address');
    } catch {
      continue;
    }
    if (logAddress !== deployment.contractAddress || log.removed === true || !Array.isArray(log.topics)) continue;
    let parsed;
    try {
      parsed = SWAP_INTERFACE.parseLog({
        topics: log.topics as string[],
        data: hexBytes(log.data, 'Private-liquidity action log data')
      });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== expected.eventName || !expected.matches(Array.from(parsed.args))) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Private-liquidity action log index'));
    if (!Number.isSafeInteger(logIndex)) throw new Error('Private-liquidity action log index is unsafe.');
    const logTransactionHash = bytes32(
      log.transactionHash ?? receipt.hash ?? receipt.transactionHash,
      'Private-liquidity action log transaction hash'
    );
    if (logTransactionHash !== confirmation.transactionHash) {
      throw new Error('Private-liquidity action log belongs to another transaction.');
    }
    matches.push(Object.freeze({
      positionId: uint(parsed.args[0], 'Confirmed position ID'),
      blockNumber: uint(log.blockNumber ?? receipt.blockNumber, 'Confirmed action block number', UINT64_MAX),
      blockHash: bytes32(log.blockHash ?? receipt.blockHash, 'Confirmed action block hash'),
      logIndex
    }));
  }
  if (matches.length !== 1 || matches[0].positionId === 0n) {
    throw new Error('Private-liquidity receipt must contain exactly one matching position marker.');
  }
  const event = matches[0];
  return Object.freeze({
    action: submission.action,
    positionId: event.positionId.toString(),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash: confirmation.transactionHash,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    logIndex: event.logIndex
  });
};

export const confirmPrivateLiquidityHiddenIntentAction = async ({
  capability,
  deployment,
  submission
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  submission: PrivateLiquidityHiddenIntentSubmission;
}): Promise<ConfirmedPrivateLiquidityHiddenIntentAction> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const expected = submission && HIDDEN_INTENT_SUBMISSIONS.get(submission);
  if (!expected || expected.capability !== capability || expected.deployment !== deployment) {
    throw new Error('Hidden-intent confirmation requires its exact local submission.');
  }
  const binding = capabilityBinding(capability);
  if (binding.chainId !== BigInt(deployment.chainId) ||
      submission.transaction.to !== deployment.contractAddress ||
      submission.transaction.from !== binding.ownerAddress) {
    throw new Error('Hidden-intent submission belongs to another owner or deployment.');
  }
  const confirmation = await confirmedReceipt(submission.transaction, `Private-liquidity ${submission.action}`);
  const receipt = confirmation.receipt;
  if (!Array.isArray(receipt.logs)) throw new Error('Hidden-intent receipt logs are missing.');
  const matches: Array<Readonly<{
    intentId: bigint;
    blockNumber: bigint;
    blockHash: string;
    logIndex: number;
  }>> = [];
  for (const raw of receipt.logs) {
    if (!raw || typeof raw !== 'object') continue;
    const log = raw as Record<string, unknown>;
    let logAddress: string;
    try {
      logAddress = address(log.address, 'Hidden-intent receipt log address');
    } catch {
      continue;
    }
    if (logAddress !== deployment.contractAddress || log.removed === true || !Array.isArray(log.topics)) continue;
    const logTransactionHash = bytes32(
      log.transactionHash ?? receipt.hash ?? receipt.transactionHash,
      'Hidden-intent action log transaction hash'
    );
    if (logTransactionHash !== confirmation.transactionHash) {
      throw new Error('Hidden-intent action log belongs to another transaction.');
    }
    let parsed;
    try {
      parsed = SWAP_INTERFACE.parseLog({
        topics: log.topics as string[],
        data: hexBytes(log.data, 'Hidden-intent action log data')
      });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== expected.eventName || !expected.matches(Array.from(parsed.args))) continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Hidden-intent action log index'));
    if (!Number.isSafeInteger(logIndex)) throw new Error('Hidden-intent action log index is unsafe.');
    matches.push(Object.freeze({
      intentId: uint(parsed.args[0], 'Confirmed hidden-intent ID'),
      blockNumber: uint(log.blockNumber ?? receipt.blockNumber, 'Hidden-intent action block number', UINT64_MAX),
      blockHash: bytes32(log.blockHash ?? receipt.blockHash, 'Hidden-intent action block hash'),
      logIndex
    }));
  }
  if (matches.length !== 1 || matches[0].intentId === 0n) {
    throw new Error('Hidden-intent receipt must contain exactly one matching action marker.');
  }
  const event = matches[0];
  return Object.freeze({
    action: submission.action,
    intentId: event.intentId.toString(),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash: confirmation.transactionHash,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    logIndex: event.logIndex
  });
};

export const confirmPrivateLiquidityHiddenIntentSettlement = async ({
  capability,
  deployment,
  submission
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  submission: PrivateLiquidityHiddenIntentSettlementSubmission;
}): Promise<ConfirmedPrivateLiquidityHiddenIntentSettlement> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  const expected = submission && HIDDEN_SETTLEMENT_SUBMISSIONS.get(submission);
  if (
    !expected ||
    expected.capability !== capability ||
    expected.deployment !== deployment ||
    expected.routes !== submission.routes
  ) {
    throw new Error('Hidden-intent settlement confirmation requires its exact local submission.');
  }
  const binding = capabilityBinding(capability);
  if (
    binding.chainId !== BigInt(deployment.chainId) ||
    submission.transaction.to !== deployment.contractAddress ||
    submission.transaction.from !== binding.ownerAddress
  ) {
    throw new Error('Hidden-intent settlement belongs to another caller or deployment.');
  }
  const confirmation = await confirmedReceipt(
    submission.transaction,
    'Private-liquidity hidden-intent settlement'
  );
  const receipt = confirmation.receipt;
  if (!Array.isArray(receipt.logs)) throw new Error('Hidden-intent settlement receipt logs are missing.');
  const matches: Array<Readonly<{
    settlementId: bigint;
    pairKey: string;
    caller: string;
    processedIntentCount: bigint;
    candidateCount: bigint;
    blockNumber: bigint;
    blockHash: string;
    logIndex: number;
  }>> = [];
  for (const raw of receipt.logs) {
    if (!raw || typeof raw !== 'object') continue;
    const log = raw as Record<string, unknown>;
    let logAddress: string;
    try {
      logAddress = address(log.address, 'Hidden-intent settlement log address');
    } catch {
      continue;
    }
    if (logAddress !== deployment.contractAddress || log.removed === true || !Array.isArray(log.topics)) continue;
    const logTransactionHash = bytes32(
      log.transactionHash ?? receipt.hash ?? receipt.transactionHash,
      'Hidden-intent settlement log transaction hash'
    );
    if (logTransactionHash !== confirmation.transactionHash) {
      throw new Error('Hidden-intent settlement log belongs to another transaction.');
    }
    let parsed;
    try {
      parsed = SWAP_INTERFACE.parseLog({
        topics: log.topics as string[],
        data: hexBytes(log.data, 'Hidden-intent settlement log data')
      });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== 'PrivateLiquidityHiddenIntentSettlementProcessed') continue;
    const pairKey = bytes32(parsed.args[1], 'Confirmed hidden-intent settlement pair');
    const caller = address(parsed.args[2], 'Confirmed hidden-intent settlement caller');
    const processedIntentCount = uint(parsed.args[3], 'Processed hidden-intent count', 4n);
    const candidateCount = uint(parsed.args[4], 'Hidden-intent settlement candidate count', 8n);
    if (
      pairKey !== submission.routes.pairKey ||
      caller !== binding.ownerAddress ||
      candidateCount !== BigInt(submission.routes.asks.positionIds.length)
    ) {
      continue;
    }
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Hidden-intent settlement log index'));
    if (!Number.isSafeInteger(logIndex)) throw new Error('Hidden-intent settlement log index is unsafe.');
    matches.push(Object.freeze({
      settlementId: uint(parsed.args[0], 'Confirmed hidden-intent settlement ID'),
      pairKey,
      caller,
      processedIntentCount,
      candidateCount,
      blockNumber: uint(log.blockNumber ?? receipt.blockNumber, 'Hidden-intent settlement block number', UINT64_MAX),
      blockHash: bytes32(log.blockHash ?? receipt.blockHash, 'Hidden-intent settlement block hash'),
      logIndex
    }));
  }
  if (matches.length !== 1 || matches[0].settlementId === 0n) {
    throw new Error('Hidden-intent settlement receipt must contain exactly one matching marker.');
  }
  const event = matches[0];
  return Object.freeze({
    settlementId: event.settlementId.toString(),
    pairKey: event.pairKey,
    caller: event.caller,
    processedIntentCount: Number(event.processedIntentCount),
    candidateCount: Number(event.candidateCount),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash: confirmation.transactionHash,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    logIndex: event.logIndex
  });
};

export const confirmPrivateLiquiditySwap = async ({
  capability,
  deployment,
  submission
}: {
  capability: PrivateLiquidityMetaMaskCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  submission: PrivateLiquiditySwapSubmission;
}): Promise<ConfirmedPrivateLiquiditySwap> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  if (!submission || !SUBMISSIONS.has(submission)) {
    throw new Error('Private-liquidity swap confirmation requires an exact local submission.');
  }
  const binding = capabilityBinding(capability);
  if (binding.chainId !== BigInt(deployment.chainId) ||
      submission.transaction.to !== deployment.contractAddress ||
      submission.transaction.from !== binding.ownerAddress) {
    throw new Error('Private-liquidity swap submission belongs to another owner or deployment.');
  }
  const confirmation = await confirmedReceipt(submission.transaction, 'Private-liquidity swap');
  const receipt = confirmation.receipt;
  if (!Array.isArray(receipt.logs)) throw new Error('Private-liquidity receipt logs are missing.');
  const matches: Array<{
    swapId: bigint;
    trader: string;
    pairKey: string;
    direction: number;
    candidateCount: bigint;
    blockNumber: bigint;
    blockHash: string;
    logIndex: number;
  }> = [];
  const privateReceipts: Array<{
    swapId: bigint;
    recipient: string;
    pairKey: string;
    direction: number;
    inputAmount: PrivateLiquidityEncryptedUint256;
    outputAmount: PrivateLiquidityEncryptedUint256;
    unusedInputAmount: PrivateLiquidityEncryptedUint256;
  }> = [];
  for (const raw of receipt.logs) {
    if (!raw || typeof raw !== 'object') continue;
    const log = raw as Record<string, unknown>;
    if (address(log.address, 'Private-liquidity receipt log address') !== deployment.contractAddress ||
        log.removed === true || !Array.isArray(log.topics)) continue;
    const logTransactionHash = bytes32(
      log.transactionHash ?? receipt.hash ?? receipt.transactionHash,
      'Private-liquidity receipt log transaction hash'
    );
    if (logTransactionHash !== confirmation.transactionHash) {
      throw new Error('Private-liquidity receipt log belongs to another transaction.');
    }
    const logBlockNumber = uint(
      log.blockNumber ?? receipt.blockNumber,
      'Private-liquidity receipt log block number',
      UINT64_MAX
    );
    const logBlockHash = bytes32(
      log.blockHash ?? receipt.blockHash,
      'Private-liquidity receipt log block hash'
    );
    if (
      logBlockNumber !== uint(receipt.blockNumber, 'Private-liquidity receipt block number', UINT64_MAX) ||
      logBlockHash !== bytes32(receipt.blockHash, 'Private-liquidity receipt block hash')
    ) {
      throw new Error('Private-liquidity receipt log block provenance is inconsistent.');
    }
    let parsed;
    try {
      parsed = SWAP_INTERFACE.parseLog({ topics: log.topics as string[], data: hexBytes(log.data, 'Swap log data') });
    } catch {
      continue;
    }
    if (!parsed) continue;
    if (parsed.name === 'PrivateLiquidityTraderSwapReceiptUpdated') {
      privateReceipts.push({
        swapId: uint(parsed.args[0], 'Private receipt swap ID'),
        recipient: address(parsed.args[1], 'Private receipt recipient'),
        pairKey: bytes32(parsed.args[2], 'Private receipt pair'),
        direction: Number(uint(parsed.args[3], 'Private receipt direction')),
        inputAmount: encryptedReceiptUint256(parsed.args[4], 'Private receipt input'),
        outputAmount: encryptedReceiptUint256(parsed.args[5], 'Private receipt output'),
        unusedInputAmount: encryptedReceiptUint256(parsed.args[6], 'Private receipt unused input')
      });
      continue;
    }
    if (parsed.name !== 'PrivateLiquiditySwapExecuted') continue;
    const logIndex = Number(uint(log.index ?? log.logIndex, 'Private-liquidity swap log index'));
    if (!Number.isSafeInteger(logIndex)) throw new Error('Private-liquidity swap log index is unsafe.');
    matches.push({
      swapId: uint(parsed.args[0], 'Confirmed swap ID'),
      trader: address(parsed.args[1], 'Confirmed swap trader'),
      pairKey: bytes32(parsed.args[2], 'Confirmed swap pair'),
      direction: Number(uint(parsed.args[3], 'Confirmed swap direction')),
      candidateCount: uint(parsed.args[4], 'Confirmed candidate count'),
      blockNumber: logBlockNumber,
      blockHash: logBlockHash,
      logIndex
    });
  }
  if (matches.length !== 1) throw new Error('Private-liquidity receipt must contain exactly one swap marker.');
  const event = matches[0];
  if (event.swapId === 0n || event.trader !== binding.ownerAddress ||
      event.pairKey !== submission.quote.pairKey) {
    throw new Error('Private-liquidity swap marker is invalid.');
  }
  const expectedDirection = directionCode(submission.quote.direction);
  const expectedCandidateCount = BigInt(submission.quote.selectedCandidateCount);
  if (event.direction !== expectedDirection || event.candidateCount !== expectedCandidateCount) {
    throw new Error('Private-liquidity swap marker does not match the submitted route.');
  }
  if (privateReceipts.length !== 1) {
    throw new Error('Private-liquidity receipt must contain exactly one participant swap receipt.');
  }
  const privateReceipt = privateReceipts[0];
  if (
    privateReceipt.swapId !== event.swapId ||
    privateReceipt.recipient !== binding.ownerAddress ||
    privateReceipt.pairKey !== event.pairKey ||
    privateReceipt.direction !== event.direction
  ) {
    throw new Error('Private-liquidity participant receipt does not match the confirmed swap.');
  }
  const decrypt = async (ciphertext: PrivateLiquidityUserCiphertext) =>
    decryptPrivateUint256Output(binding.signer, ciphertext);
  const [inputAmount, outputAmount, unusedInputAmount] = await Promise.all([
    decryptPrivateLiquidityReceiptAmount({ encrypted: privateReceipt.inputAmount, decrypt }),
    decryptPrivateLiquidityReceiptAmount({ encrypted: privateReceipt.outputAmount, decrypt }),
    decryptPrivateLiquidityReceiptAmount({ encrypted: privateReceipt.unusedInputAmount, decrypt })
  ]);
  if (inputAmount + unusedInputAmount !== BigInt(submission.quote.maximumInput) || outputAmount <= 0n) {
    throw new Error('Private-liquidity participant receipt amounts do not reconcile with the submitted maximum.');
  }
  return Object.freeze({
    swapId: event.swapId.toString(),
    trader: event.trader,
    pairKey: event.pairKey,
    direction: submission.quote.direction,
    candidateCount: Number(event.candidateCount),
    quote: submission.quote,
    inputAmount: inputAmount.toString(),
    outputAmount: outputAmount.toString(),
    unusedInputAmount: unusedInputAmount.toString(),
    submittedTransactionHash: submission.submittedTransactionHash,
    transactionHash: confirmation.transactionHash,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    logIndex: event.logIndex
  });
};
