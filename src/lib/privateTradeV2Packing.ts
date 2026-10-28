const UINT128_MAX = (1n << 128n) - 1n;
const PACK_BASE = 1n << 128n;

export type PrivateTradeV2AssetType = 'native' | 'erc20' | 'private-erc20';
export type PrivateTradeV2Mode =
  | 'fully-private'
  | 'private-offer-public-request'
  | 'public-offer-private-request';

export type PackedPrivateTradeV2Create = Readonly<{
  mode: PrivateTradeV2Mode;
  publicOfferAmount: bigint;
  publicRequestAmount: bigint;
  packedPrivateTerms: bigint;
  privateInputCount: 1;
}>;

export type PackedPrivateTradeV2Fill = Readonly<{
  mode: PrivateTradeV2Mode;
  publicFillAmount: bigint;
  packedPrivateFill: bigint;
  privateInputCount: 1;
}>;

const amount = (value: bigint | number | string, label: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed <= 0n || parsed > UINT128_MAX) {
    throw new Error(`${label} must be between 1 and uint128 max.`);
  }
  return parsed;
};

const modeFor = (
  offerAssetType: PrivateTradeV2AssetType,
  requestAssetType: PrivateTradeV2AssetType
): PrivateTradeV2Mode => {
  const privateOffer = offerAssetType === 'private-erc20';
  const privateRequest = requestAssetType === 'private-erc20';
  if (privateOffer && privateRequest) return 'fully-private';
  if (privateOffer) return 'private-offer-public-request';
  if (privateRequest) return 'public-offer-private-request';
  throw new Error('Private OTC V2 requires at least one private asset.');
};

/** Packs the exact one COTI input used by createOrder/replaceOrder. */
export const packPrivateTradeV2CreateTerms = ({
  offerAssetType,
  offerAmount,
  requestAssetType,
  requestAmount
}: {
  offerAssetType: PrivateTradeV2AssetType;
  offerAmount: bigint | number | string;
  requestAssetType: PrivateTradeV2AssetType;
  requestAmount: bigint | number | string;
}): PackedPrivateTradeV2Create => {
  const mode = modeFor(offerAssetType, requestAssetType);
  const offer = amount(offerAmount, 'Private OTC offer amount');
  const request = amount(requestAmount, 'Private OTC request amount');
  return Object.freeze({
    mode,
    publicOfferAmount: mode === 'public-offer-private-request' ? offer : 0n,
    publicRequestAmount: mode === 'private-offer-public-request' ? request : 0n,
    packedPrivateTerms: mode === 'fully-private'
      ? offer * PACK_BASE + request
      : mode === 'private-offer-public-request'
        ? offer
        : request,
    privateInputCount: 1
  });
};

/** Packs the exact one COTI input used by fillOrder for the canonical order mode. */
export const packPrivateTradeV2FillTerms = (input:
  | Readonly<{
      mode: 'fully-private';
      maxRequestAmount: bigint | number | string;
      minOfferAmount: bigint | number | string;
    }>
  | Readonly<{
      mode: 'private-offer-public-request';
      publicRequestAmount: bigint | number | string;
      minPrivateOfferAmount: bigint | number | string;
    }>
  | Readonly<{
      mode: 'public-offer-private-request';
      publicOfferAmount: bigint | number | string;
      maxPrivateRequestAmount: bigint | number | string;
    }>
): PackedPrivateTradeV2Fill => {
  if (input.mode === 'fully-private') {
    const maximumRequest = amount(input.maxRequestAmount, 'Maximum private request payment');
    const minimumOffer = amount(input.minOfferAmount, 'Minimum private offer output');
    return Object.freeze({
      mode: input.mode,
      publicFillAmount: 0n,
      packedPrivateFill: maximumRequest * PACK_BASE + minimumOffer,
      privateInputCount: 1
    });
  }
  if (input.mode === 'private-offer-public-request') {
    return Object.freeze({
      mode: input.mode,
      publicFillAmount: amount(input.publicRequestAmount, 'Maximum public request payment'),
      packedPrivateFill: amount(input.minPrivateOfferAmount, 'Minimum private offer output'),
      privateInputCount: 1
    });
  }
  return Object.freeze({
    mode: input.mode,
    publicFillAmount: amount(input.publicOfferAmount, 'Desired public offer output'),
    packedPrivateFill: amount(input.maxPrivateRequestAmount, 'Maximum private request payment'),
    privateInputCount: 1
  });
};

export const unpackPrivateTradeV2Pair = (
  packed: bigint | number | string
): Readonly<{ high: bigint; low: bigint }> => {
  let value: bigint;
  try {
    value = BigInt(packed);
  } catch {
    throw new Error('Packed Private OTC value must be an unsigned integer.');
  }
  if (value < 0n || value >= PACK_BASE * PACK_BASE) {
    throw new Error('Packed Private OTC value exceeds uint256.');
  }
  return Object.freeze({ high: value / PACK_BASE, low: value % PACK_BASE });
};
