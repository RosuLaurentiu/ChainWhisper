import { getAddress } from '@coti-io/coti-ethers';
import type { PrivateBookV2Action } from './privateBookV2Actions';

export type PrivateBookV2AssetType = 'native' | 'erc20' | 'private-erc20';
export type PrivateBookV2Mode = 'private-pair' | 'private-offer-public-request' | 'public-offer-private-request';
export type PrivateBookV2Uint = bigint | number | string;
export type PrivateBookV2Price = Readonly<{ offerAmount: PrivateBookV2Uint; requestAmount: PrivateBookV2Uint }>;
export const PRIVATE_BOOK_V2_AMOUNT_MAX = (1n << 128n) - 1n;
const PACK_BASE = 1n << 128n;

export const privateBookV2Uint = (value: unknown, label: string, maximum = (1n << 256n) - 1n): bigint => {
  if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value)) &&
      !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) {
    throw new Error(`${label} must be an unsigned integer. Use a decimal string for large amounts.`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};
const positive = (value: unknown, label: string) => {
  const parsed = privateBookV2Uint(value, label, PRIVATE_BOOK_V2_AMOUNT_MAX);
  if (parsed === 0n) throw new Error(`${label} must be positive.`);
  return parsed;
};
export const normalizePrivateBookV2Price = (price: PrivateBookV2Price) => {
  const offerAmount = positive(price.offerAmount, 'Public price offer units');
  const requestAmount = positive(price.requestAmount, 'Public price request units');
  let a = offerAmount; let b = requestAmount;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  return Object.freeze({ offerAmount: offerAmount / a, requestAmount: requestAmount / a });
};
const validAsset = (type: PrivateBookV2AssetType) => {
  if (!['native', 'erc20', 'private-erc20'].includes(type)) throw new Error('Private book asset type is invalid.');
};
export const preparePrivateBookV2CreateTerms = (input: {
  offerAssetType: PrivateBookV2AssetType; requestAssetType: PrivateBookV2AssetType;
  offerBudget: PrivateBookV2Uint; priceTerms: PrivateBookV2Price;
}) => {
  validAsset(input.offerAssetType); validAsset(input.requestAssetType);
  const offerBudget = positive(input.offerBudget, 'Offer budget');
  const priceTerms = normalizePrivateBookV2Price(input.priceTerms);
  const totalRequestAmount = (offerBudget * priceTerms.requestAmount + priceTerms.offerAmount - 1n) / priceTerms.offerAmount;
  positive(totalRequestAmount, 'Total request amount');
  const privateOffer = input.offerAssetType === 'private-erc20';
  const privateRequest = input.requestAssetType === 'private-erc20';
  if (!privateOffer && !privateRequest) throw new Error('Private book requires at least one private token.');
  const mode: PrivateBookV2Mode = privateOffer
    ? privateRequest ? 'private-pair' : 'private-offer-public-request'
    : 'public-offer-private-request';
  return Object.freeze({ mode, priceTerms, offerBudget, totalRequestAmount,
    publicOfferAmount: privateOffer ? 0n : offerBudget, publicRequestAmount: 0n,
    privateOfferBudget: privateOffer ? offerBudget : 0n, privateInputCount: privateOffer ? 1 as const : 0 as const });
};

/** The contract can clip output to remaining inventory. There is no minimum-output input. */
export type PrivateBookV2FillTerms = Readonly<{ fillBehavior: 'remaining-at-reviewed-price'; priceTerms: PrivateBookV2Price }> & (
  | Readonly<{ mode: 'private-pair'; maxRequestAmount: PrivateBookV2Uint }>
  | Readonly<{ mode: 'private-offer-public-request'; publicRequestAmount: PrivateBookV2Uint }>
  | Readonly<{ mode: 'public-offer-private-request'; publicOfferAmount: PrivateBookV2Uint; maxPrivateRequestAmount: PrivateBookV2Uint }>
);
export const preparePrivateBookV2FillTerms = (input: PrivateBookV2FillTerms) => {
  if (input.fillBehavior !== 'remaining-at-reviewed-price') throw new Error('Private book fill behavior must be reviewed.');
  if ('minOfferAmount' in input || 'minPrivateOfferAmount' in input || 'minimumOutput' in input) {
    throw new Error('This private book contract cannot enforce a minimum output.');
  }
  const priceTerms = normalizePrivateBookV2Price(input.priceTerms);
  let publicFillAmount = 0n; let privateFill: bigint; let approvalAmount: bigint;
  if (input.mode === 'private-pair') {
    approvalAmount = positive(input.maxRequestAmount, 'Maximum private request'); privateFill = approvalAmount * PACK_BASE;
  } else if (input.mode === 'private-offer-public-request') {
    approvalAmount = positive(input.publicRequestAmount, 'Maximum public request'); publicFillAmount = approvalAmount; privateFill = 0n;
  } else if (input.mode === 'public-offer-private-request') {
    approvalAmount = positive(input.maxPrivateRequestAmount, 'Maximum private request');
    publicFillAmount = positive(input.publicOfferAmount, 'Desired public offer'); privateFill = approvalAmount;
  } else { throw new Error('Private book mode is invalid.'); }
  if (approvalAmount * priceTerms.offerAmount / priceTerms.requestAmount === 0n) throw new Error('Fill budget cannot buy one offer unit.');
  // Even the zero input requires a recipient/function-bound ciphertext on native COTI.
  return Object.freeze({ mode: input.mode, priceTerms, publicFillAmount, privateFill, approvalAmount, privateInputCount: 1 as const });
};

const recoveryRecord = (value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Private Book recovery action must contain plain data.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) ||
      required.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key)) ||
      Object.values(descriptors).some(item => !('value' in item) || !item.enumerable)) {
    throw new Error('Private Book recovery action fields are invalid.');
  }
  return value as Record<string, unknown>;
};
const recoveryPrice = (value: unknown) => {
  const price = recoveryRecord(value, ['offerAmount', 'requestAmount']);
  const normalized = normalizePrivateBookV2Price(price as PrivateBookV2Price);
  return Object.freeze({ offerAmount: normalized.offerAmount.toString(), requestAmount: normalized.requestAmount.toString() });
};
const recoveryAsset = (value: unknown, offer: boolean) => {
  const keys = offer ? ['assetType', 'token', 'amount'] : ['assetType', 'token'];
  const asset = recoveryRecord(value, keys, offer ? ['assetType', 'amount'] : ['assetType']);
  validAsset(asset.assetType as PrivateBookV2AssetType);
  const type = asset.assetType as PrivateBookV2AssetType;
  const zero = `0x${'00'.repeat(20)}`;
  let token = zero;
  if (asset.token !== undefined || type !== 'native') {
    if (typeof asset.token !== 'string') throw new Error('Private Book recovery token address is invalid.');
    try { token = getAddress(asset.token).toLowerCase(); } catch { throw new Error('Private Book recovery token address is invalid.'); }
    if ((type === 'native') !== (token === zero)) throw new Error('Private Book recovery token address is invalid.');
  }
  return Object.freeze({ assetType: type, token, ...(offer ? { amount: positive(asset.amount, 'Offer budget').toString() } : {}) });
};
const recoveryOrderId = (value: unknown) => {
  const id = privateBookV2Uint(value, 'Private order ID');
  if (id === 0n) throw new Error('Private order ID cannot be zero.');
  return id.toString();
};

/** Validate persisted plaintext terms. Live expiry and chain state are checked before each send. */
export const normalizePrivateBookV2RecoveryAction = (value: unknown): PrivateBookV2Action => {
  // Inspect descriptors before reading kind. Accessors are never part of a saved action.
  const candidate = recoveryRecord(value, ['kind', 'offerAsset', 'requestAsset', 'priceTerms', 'expiresAt', 'originalOrderId', 'orderId', 'expectedRevision', 'terms', 'visible'], ['kind']);
  const kind = candidate.kind;
  if (kind === 'withdraw-native-credit') {
    recoveryRecord(value, ['kind']); return Object.freeze({ kind });
  }
  if (kind === 'cancel' || kind === 'reclaim-expired') {
    const action = recoveryRecord(value, ['kind', 'orderId']);
    return Object.freeze({ kind, orderId: recoveryOrderId(action.orderId) });
  }
  if (kind === 'budget-visibility') {
    const action = recoveryRecord(value, ['kind', 'orderId', 'expectedRevision', 'visible']);
    if (typeof action.visible !== 'boolean') throw new Error('Private Book budget visibility must be a boolean.');
    return Object.freeze({ kind, orderId: recoveryOrderId(action.orderId),
      expectedRevision: privateBookV2Uint(action.expectedRevision, 'Private expected revision', (1n << 64n) - 1n).toString(), visible: action.visible });
  }
  if (kind === 'create' || kind === 'replace') {
    const action = recoveryRecord(value, ['kind', 'offerAsset', 'requestAsset', 'priceTerms', 'expiresAt', ...(kind === 'replace' ? ['originalOrderId'] : [])]);
    const offerAsset = recoveryAsset(action.offerAsset, true) as Extract<PrivateBookV2Action, { kind: 'create' }>['offerAsset'];
    const requestAsset = recoveryAsset(action.requestAsset, false);
    const priceTerms = recoveryPrice(action.priceTerms);
    preparePrivateBookV2CreateTerms({ offerAssetType: offerAsset.assetType, requestAssetType: requestAsset.assetType, offerBudget: offerAsset.amount, priceTerms });
    const normalized = { kind, offerAsset, requestAsset, priceTerms,
      expiresAt: privateBookV2Uint(action.expiresAt, 'Private order expiry', (1n << 64n) - 1n).toString() };
    return kind === 'replace' ? Object.freeze({ ...normalized, kind, originalOrderId: recoveryOrderId(action.originalOrderId) }) : Object.freeze({ ...normalized, kind });
  }
  if (kind === 'fill') {
    const action = recoveryRecord(value, ['kind', 'orderId', 'expectedRevision', 'terms']);
    const terms = recoveryRecord(action.terms, ['mode', 'fillBehavior', 'priceTerms', 'maxRequestAmount', 'publicRequestAmount', 'publicOfferAmount', 'maxPrivateRequestAmount'], ['mode', 'fillBehavior', 'priceTerms']);
    const fields = terms.mode === 'private-pair' ? ['maxRequestAmount'] : terms.mode === 'private-offer-public-request' ? ['publicRequestAmount'] : terms.mode === 'public-offer-private-request' ? ['publicOfferAmount', 'maxPrivateRequestAmount'] : undefined;
    if (!fields) throw new Error('Private book mode is invalid.');
    recoveryRecord(action.terms, ['mode', 'fillBehavior', 'priceTerms', ...fields]);
    const normalizedTerms = { mode: terms.mode, fillBehavior: terms.fillBehavior, priceTerms: recoveryPrice(terms.priceTerms),
      ...Object.fromEntries(fields.map(field => [field, positive(terms[field], field).toString()])) } as PrivateBookV2FillTerms;
    preparePrivateBookV2FillTerms(normalizedTerms);
    return Object.freeze({ kind, orderId: recoveryOrderId(action.orderId),
      expectedRevision: privateBookV2Uint(action.expectedRevision, 'Private expected revision', (1n << 64n) - 1n).toString(), terms: Object.freeze(normalizedTerms) });
  }
  throw new Error('Private Book recovery action kind is invalid.');
};

export const privateBookV2RecoveryActionNeedsPrivacy = (action: PrivateBookV2Action): boolean =>
  action.kind === 'fill' || action.kind === 'budget-visibility' && action.visible ||
  ((action.kind === 'create' || action.kind === 'replace') && action.offerAsset.assetType === 'private-erc20');
