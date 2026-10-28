import {
  buildPrivateLiquidityPairKey,
  normalizePrivateLiquidityAddress,
  parsePrivateLiquidityUint,
  validatePrivateLiquidityPosition,
  validatePrivateLiquidityTerms,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';
import {
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot,
  type CompleteCanonicalPrivateLiquidityPositionSnapshot
} from './privateLiquidityChain';
import { unpackSelfCheckingPrivateLiquidityAmount } from './privateLiquidityReceipt';

export const PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_ACTIVE_POSITIONS = 8;
export const PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_INTENTS_PER_SETTLEMENT = 4;
export const PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT127_MAX = (1n << 127n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const LIMIT_BASE = 1n << 127n;
const PACK_BASE = 1n << 128n;
const SIDE_BASE = 1n << 254n;

export type PrivateLiquidityHiddenIntentSide = 'sell-base' | 'buy-base';
export type PrivateLiquidityHiddenIntentStatus = 'open' | 'filled' | 'cancelled' | 'expired';

export type PreparePrivateLiquidityHiddenIntentInput = Readonly<{
  baseToken: string;
  quoteToken: string;
  side: PrivateLiquidityHiddenIntentSide;
  limitTerms: PrivateLiquiditySideTerms;
  maximumBudget: bigint | number | string;
  minimumFill: bigint | number | string;
  cooldownBlocks: bigint | number | string;
  expiresAt: bigint | number | string;
  currentTimestamp: bigint | number | string;
}>;

declare const PRIVATE_LIQUIDITY_HIDDEN_DRAFT_BRAND: unique symbol;
export type PreparedPrivateLiquidityHiddenIntent = Readonly<{
  baseToken: string;
  quoteToken: string;
  pairKey: string;
  cooldownBlocks: string;
  expiresAt: string;
  privateTermsPlaintext: string;
  privateBudgetPlaintext: string;
  readonly [PRIVATE_LIQUIDITY_HIDDEN_DRAFT_BRAND]: true;
}>;

export type PrivateLiquidityHiddenIntentRoute = Readonly<{
  positionIds: readonly string[];
  expectedRevisions: readonly string[];
}>;

export type PrivateLiquidityHiddenIntentSettlementRoutes = Readonly<{
  chainId: string;
  contractAddress: string;
  pairKey: string;
  atBlock: Readonly<{ number: string; hash: string }>;
  activePositionCount: number;
  asks: PrivateLiquidityHiddenIntentRoute;
  bids: PrivateLiquidityHiddenIntentRoute;
  completeActiveSet: true;
  readonly [PRIVATE_LIQUIDITY_HIDDEN_SETTLEMENT_ROUTES_BRAND]: true;
}>;

export type PrivateLiquidityHiddenIntentPublicView = Readonly<{
  intentId: string;
  status: PrivateLiquidityHiddenIntentStatus;
  owner: string;
  baseToken: string;
  quoteToken: string;
  pairKey: string;
  createdAt: string;
  expiresAt: string;
  cooldownBlocks: string;
  fillCount: string;
  lastActivityBlock: string;
  lastFillBlock: string;
  hasPrivateTerms: boolean;
}>;

export type PrivateLiquidityHiddenIntentOwnerReceipt = Readonly<{
  intentId: string;
  recipient: string;
  sequence: string;
  side: PrivateLiquidityHiddenIntentSide;
  limitTerms: PrivateLiquiditySideTerms;
  remainingBudget: string;
  minimumFill: string;
  lastInputAmount: string;
  lastOutputAmount: string;
}>;

const PREPARED_DRAFTS = new WeakSet<object>();
declare const PRIVATE_LIQUIDITY_HIDDEN_SETTLEMENT_ROUTES_BRAND: unique symbol;
const PREPARED_SETTLEMENT_ROUTES = new WeakSet<object>();

const unsigned = (
  value: bigint | number | string,
  label: string,
  maximum = UINT256_MAX
): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a safe unsigned integer.`);
  }
  const normalized = typeof value === 'string' ? value : value.toString();
  const parsed = parsePrivateLiquidityUint(normalized, label);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const compareTerms = (
  left: PrivateLiquiditySideTerms,
  right: PrivateLiquiditySideTerms
): -1 | 0 | 1 => {
  const normalizedLeft = validatePrivateLiquidityTerms(left, 'Left hidden-route price');
  const normalizedRight = validatePrivateLiquidityTerms(right, 'Right hidden-route price');
  const leftCross = normalizedLeft.quoteAmount * normalizedRight.baseAmount;
  const rightCross = normalizedRight.quoteAmount * normalizedLeft.baseAmount;
  return leftCross < rightCross ? -1 : leftCross > rightCross ? 1 : 0;
};

const compareIds = (left: PrivateLiquidityPosition, right: PrivateLiquidityPosition): -1 | 0 | 1 => {
  const leftId = parsePrivateLiquidityUint(left.identity.positionId, 'Left hidden-route position ID');
  const rightId = parsePrivateLiquidityUint(right.identity.positionId, 'Right hidden-route position ID');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};

const route = (positions: readonly PrivateLiquidityPosition[]): PrivateLiquidityHiddenIntentRoute =>
  Object.freeze({
    positionIds: Object.freeze(positions.map((position) => position.identity.positionId)),
    expectedRevisions: Object.freeze(positions.map((position) => position.revision))
  });

export const preparePrivateLiquidityHiddenIntent = ({
  baseToken,
  quoteToken,
  side,
  limitTerms,
  maximumBudget,
  minimumFill,
  cooldownBlocks,
  expiresAt,
  currentTimestamp
}: PreparePrivateLiquidityHiddenIntentInput): PreparedPrivateLiquidityHiddenIntent => {
  const normalizedBase = normalizePrivateLiquidityAddress(baseToken, 'Hidden-intent base token');
  const normalizedQuote = normalizePrivateLiquidityAddress(quoteToken, 'Hidden-intent quote token');
  const pairKey = buildPrivateLiquidityPairKey(normalizedBase, normalizedQuote);
  const limit = validatePrivateLiquidityTerms(limitTerms, 'Hidden-intent limit');
  if (limit.baseAmount > UINT127_MAX || limit.quoteAmount > UINT127_MAX) {
    throw new Error('Hidden-intent limit limbs must fit positive uint127 values.');
  }
  const budget = unsigned(maximumBudget, 'Hidden-intent maximum budget', UINT128_MAX);
  const minimum = unsigned(minimumFill, 'Hidden-intent minimum fill', UINT128_MAX);
  if (budget === 0n || minimum > budget) {
    throw new Error('Hidden-intent budget must be positive and at least its minimum fill.');
  }
  const cooldown = unsigned(cooldownBlocks, 'Hidden-intent cooldown blocks', UINT32_MAX);
  const expiry = unsigned(expiresAt, 'Hidden-intent expiry', UINT64_MAX);
  const now = unsigned(currentTimestamp, 'Hidden-intent current timestamp', UINT64_MAX);
  if (expiry !== 0n && (expiry <= now || expiry > now + BigInt(PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_TTL_SECONDS))) {
    throw new Error('Hidden-intent expiry must be in the future and no more than 30 days away.');
  }
  const sideBit = side === 'sell-base' ? 0n : side === 'buy-base' ? 1n : -1n;
  if (sideBit < 0n) throw new Error('Hidden-intent side is invalid.');
  const privateTerms = sideBit * SIDE_BASE + limit.baseAmount * LIMIT_BASE + limit.quoteAmount;
  const privateBudget = budget * PACK_BASE + minimum;
  const prepared = Object.freeze({
    baseToken: normalizedBase,
    quoteToken: normalizedQuote,
    pairKey,
    cooldownBlocks: cooldown.toString(),
    expiresAt: expiry.toString(),
    privateTermsPlaintext: privateTerms.toString(),
    privateBudgetPlaintext: privateBudget.toString()
  }) as PreparedPrivateLiquidityHiddenIntent;
  PREPARED_DRAFTS.add(prepared);
  return prepared;
};

export const assertPreparedPrivateLiquidityHiddenIntent = (
  prepared: PreparedPrivateLiquidityHiddenIntent
): void => {
  if (!prepared || !PREPARED_DRAFTS.has(prepared)) {
    throw new Error('Hidden-intent submission requires an exact locally prepared draft.');
  }
};

export const buildPrivateLiquidityHiddenIntentSettlementRoutes = ({
  snapshot,
  baseToken,
  quoteToken
}: {
  snapshot: CompleteCanonicalPrivateLiquidityPositionSnapshot;
  baseToken: string;
  quoteToken: string;
}): PrivateLiquidityHiddenIntentSettlementRoutes => {
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot(snapshot);
  const normalizedBase = normalizePrivateLiquidityAddress(baseToken, 'Hidden-route base token');
  const normalizedQuote = normalizePrivateLiquidityAddress(quoteToken, 'Hidden-route quote token');
  const pairKey = buildPrivateLiquidityPairKey(normalizedBase, normalizedQuote);
  const active = snapshot.positions.filter((position) => {
    validatePrivateLiquidityPosition(position);
    return position.pairKey.toLowerCase() === pairKey.toLowerCase() && position.status === 'active';
  });
  if (active.length === 0 || active.length > PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_ACTIVE_POSITIONS) {
    throw new Error('Hidden-intent settlement requires between one and eight active pair positions.');
  }
  for (const position of active) {
    const owner = normalizePrivateLiquidityAddress(position.owner, 'Hidden-route position owner');
    if (!position.privacyOwner ||
        normalizePrivateLiquidityAddress(position.privacyOwner, 'Hidden-route privacy owner') !== owner) {
      throw new Error('Every active hidden-route position must have current NFT-owner privacy authority.');
    }
    const revision = parsePrivateLiquidityUint(position.revision, 'Hidden-route position revision');
    if (revision === 0n || revision > UINT64_MAX) {
      throw new Error('Hidden-route position revision is out of uint64 range.');
    }
  }
  const asks = [...active].sort((left, right) => {
    const price = compareTerms(left.sellTerms, right.sellTerms);
    return price === 0 ? compareIds(left, right) : price;
  });
  const bids = [...active].sort((left, right) => {
    const price = compareTerms(left.buyTerms, right.buyTerms);
    return price === 0 ? compareIds(left, right) : -price;
  });
  const prepared = Object.freeze({
    chainId: snapshot.scope.chainId,
    contractAddress: snapshot.scope.contractAddress,
    pairKey,
    atBlock: snapshot.atBlock,
    activePositionCount: active.length,
    asks: route(asks),
    bids: route(bids),
    completeActiveSet: true
  }) as unknown as PrivateLiquidityHiddenIntentSettlementRoutes;
  PREPARED_SETTLEMENT_ROUTES.add(prepared);
  return prepared;
};

export const assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes = (
  routes: PrivateLiquidityHiddenIntentSettlementRoutes
): void => {
  if (!routes || !PREPARED_SETTLEMENT_ROUTES.has(routes)) {
    throw new Error('Hidden-intent settlement requires exact routes derived from a complete canonical snapshot.');
  }
};

export const decodePrivateLiquidityHiddenIntentTerms = (
  packedValue: bigint | number | string
): Readonly<{ side: PrivateLiquidityHiddenIntentSide; limitTerms: PrivateLiquiditySideTerms }> => {
  const packed = unsigned(packedValue, 'Decrypted hidden-intent terms');
  if (packed >= 1n << 255n) throw new Error('Hidden-intent terms set the reserved high bit.');
  const side = packed / SIDE_BASE;
  if (side > 1n) throw new Error('Hidden-intent terms contain an invalid side.');
  const remainder = packed % SIDE_BASE;
  const baseAmount = remainder / LIMIT_BASE;
  const quoteAmount = remainder % LIMIT_BASE;
  if (baseAmount === 0n || quoteAmount === 0n || baseAmount > UINT127_MAX || quoteAmount > UINT127_MAX) {
    throw new Error('Hidden-intent terms contain invalid rational-price limbs.');
  }
  return Object.freeze({
    side: side === 0n ? 'sell-base' : 'buy-base',
    limitTerms: Object.freeze({ baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString() })
  });
};

export const decodePrivateLiquidityHiddenIntentBudget = (
  packedValue: bigint | number | string
): Readonly<{ remainingBudget: string; minimumFill: string }> => {
  const packed = unsigned(packedValue, 'Decrypted hidden-intent budget');
  const remainingBudget = packed / PACK_BASE;
  const minimumFill = packed % PACK_BASE;
  if (remainingBudget > UINT128_MAX || minimumFill > UINT128_MAX) {
    throw new Error('Hidden-intent budget is out of uint128 range.');
  }
  return Object.freeze({
    remainingBudget: remainingBudget.toString(),
    minimumFill: minimumFill.toString()
  });
};

export const materializePrivateLiquidityHiddenIntentOwnerReceipt = ({
  intentId,
  recipient,
  sequence,
  packedTerms,
  packedBudget,
  lastInputAmount,
  lastOutputAmount
}: {
  intentId: bigint | number | string;
  recipient: string;
  sequence: bigint | number | string;
  packedTerms: bigint | number | string;
  packedBudget: bigint | number | string;
  lastInputAmount: bigint | number | string;
  lastOutputAmount: bigint | number | string;
}): PrivateLiquidityHiddenIntentOwnerReceipt => {
  const id = unsigned(intentId, 'Hidden-intent receipt ID');
  const receiptSequence = unsigned(sequence, 'Hidden-intent receipt sequence', UINT64_MAX);
  if (id === 0n || receiptSequence === 0n) {
    throw new Error('Hidden-intent receipt ID and sequence must be positive.');
  }
  const terms = decodePrivateLiquidityHiddenIntentTerms(packedTerms);
  const budget = decodePrivateLiquidityHiddenIntentBudget(packedBudget);
  return Object.freeze({
    intentId: id.toString(),
    recipient: normalizePrivateLiquidityAddress(recipient, 'Hidden-intent receipt recipient'),
    sequence: receiptSequence.toString(),
    side: terms.side,
    limitTerms: terms.limitTerms,
    remainingBudget: budget.remainingBudget,
    minimumFill: budget.minimumFill,
    lastInputAmount: unpackSelfCheckingPrivateLiquidityAmount(lastInputAmount).toString(),
    lastOutputAmount: unpackSelfCheckingPrivateLiquidityAmount(lastOutputAmount).toString()
  });
};

const statusFromCode = (value: bigint | number | string): PrivateLiquidityHiddenIntentStatus => {
  const code = unsigned(value, 'Hidden-intent status', 4n);
  if (code === 1n) return 'open';
  if (code === 2n) return 'filled';
  if (code === 3n) return 'cancelled';
  if (code === 4n) return 'expired';
  throw new Error('Hidden-intent status cannot be uninitialized.');
};

export const materializePrivateLiquidityHiddenIntentPublicView = ({
  intentId,
  status,
  owner,
  baseToken,
  quoteToken,
  pairKey,
  createdAt,
  expiresAt,
  cooldownBlocks,
  fillCount,
  lastActivityBlock,
  lastFillBlock,
  hasPrivateTerms
}: {
  intentId: bigint | number | string;
  status: bigint | number | string;
  owner: string;
  baseToken: string;
  quoteToken: string;
  pairKey: string;
  createdAt: bigint | number | string;
  expiresAt: bigint | number | string;
  cooldownBlocks: bigint | number | string;
  fillCount: bigint | number | string;
  lastActivityBlock: bigint | number | string;
  lastFillBlock: bigint | number | string;
  hasPrivateTerms: boolean;
}): PrivateLiquidityHiddenIntentPublicView => {
  const id = unsigned(intentId, 'Hidden-intent ID');
  const normalizedBase = normalizePrivateLiquidityAddress(baseToken, 'Hidden-intent base token');
  const normalizedQuote = normalizePrivateLiquidityAddress(quoteToken, 'Hidden-intent quote token');
  const expectedPair = buildPrivateLiquidityPairKey(normalizedBase, normalizedQuote);
  if (id === 0n || pairKey.toLowerCase() !== expectedPair.toLowerCase() || typeof hasPrivateTerms !== 'boolean') {
    throw new Error('Hidden-intent public view is inconsistent with its canonical pair.');
  }
  return Object.freeze({
    intentId: id.toString(),
    status: statusFromCode(status),
    owner: normalizePrivateLiquidityAddress(owner, 'Hidden-intent owner'),
    baseToken: normalizedBase,
    quoteToken: normalizedQuote,
    pairKey: expectedPair,
    createdAt: unsigned(createdAt, 'Hidden-intent creation time', UINT64_MAX).toString(),
    expiresAt: unsigned(expiresAt, 'Hidden-intent expiry', UINT64_MAX).toString(),
    cooldownBlocks: unsigned(cooldownBlocks, 'Hidden-intent cooldown', UINT32_MAX).toString(),
    fillCount: unsigned(fillCount, 'Hidden-intent fill count', UINT32_MAX).toString(),
    lastActivityBlock: unsigned(lastActivityBlock, 'Hidden-intent activity block').toString(),
    lastFillBlock: unsigned(lastFillBlock, 'Hidden-intent fill block').toString(),
    hasPrivateTerms
  });
};
