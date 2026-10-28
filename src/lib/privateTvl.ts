import {
  COTI_PRIVACY_PORTAL_CHAIN_ID,
  PRIVACY_TOKEN_PAIRS,
  type PrivacyTokenPair
} from './privacyPortal';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const BAND_PRICE_DECIMALS = 18;
const DEFAULT_MAX_PRICE_AGE_SECONDS = 3_600n;

export const PRIVATE_TVL_SCHEMA = 'chainwhisper-private-tvl-v1' as const;
export const PRIVATE_TVL_BAND_QUOTE_SYMBOL = 'USD' as const;
export const PRIVATE_TVL_DEFAULT_MAX_PRICE_AGE_SECONDS = DEFAULT_MAX_PRICE_AGE_SECONDS.toString();

export const PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID = Object.freeze({
  2_632_500: '0x9503d502435f8e228b874Ba0F792301d4401b523',
  7_082_400: '0xb6256dcb23cee06eda2408e73945963606fdddd7'
} as const);

export const BAND_STANDARD_REFERENCE_ABI = Object.freeze([
  'function getReferenceData(string base,string quote) view returns (uint256 rate,uint256 lastUpdatedBase,uint256 lastUpdatedQuote)'
] as const);

export type PrivateTvlBandObservation = Readonly<{
  base: string;
  quote: typeof PRIVATE_TVL_BAND_QUOTE_SYMBOL;
  rateE18: string;
  lastUpdatedBase: string;
  lastUpdatedQuote: string;
}>;

export type PrivateTvlBridgeObservation = Readonly<{
  pairId: string;
  chainId: string;
  bridgeAddress: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  reserveAtomic: string;
  liabilityAtomic: string;
  band: PrivateTvlBandObservation | null;
}>;

export type PrivateTvlCoverageStatus =
  | 'exact'
  | 'overcollateralized'
  | 'undercollateralized'
  | 'no-liability';

export type PrivateTvlPriceStatus = 'ready' | 'stale' | 'unavailable';

export type PrivateTvlTokenRow = Readonly<{
  pairId: string;
  publicSymbol: string;
  privateSymbol: string;
  oracleSymbol: string;
  bridgeAddress: string;
  publicTokenAddress: string | null;
  privateTokenAddress: string;
  decimals: number;
  reserveAtomic: string;
  liabilityAtomic: string;
  coverageStatus: PrivateTvlCoverageStatus;
  coverageBps: string | null;
  priceStatus: PrivateTvlPriceStatus;
  priceRateE18: string | null;
  priceObservedAt: string | null;
  priceAgeSeconds: string | null;
  usdValueE18: string | null;
}>;

export type PrivateTvlSnapshot = Readonly<{
  schema: typeof PRIVATE_TVL_SCHEMA;
  scope: 'official-coti-private-bridges';
  chainId: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  bandProxyAddress: string;
  bandQuoteSymbol: typeof PRIVATE_TVL_BAND_QUOTE_SYMBOL;
  maxPriceAgeSeconds: string;
  totalUsdValueE18: string;
  pricedTokenCount: number;
  totalTokenCount: number;
  hasUnpricedValue: boolean;
  tokens: readonly PrivateTvlTokenRow[];
}>;

const canonicalDecimal = (value: string, label: string, max = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`${label} must be canonical decimal.`);
  }
  const parsed = BigInt(value);
  if (parsed > max) throw new Error(`${label} exceeds its bound.`);
  return parsed;
};

const canonicalAddress = (value: string, label: string): string => {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a nonzero address.`);
  }
  return value.toLowerCase();
};

const canonicalBytes32 = (value: string, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${label} must be nonzero bytes32.`);
  }
  return value.toLowerCase();
};

const coverage = ({
  reserve,
  liability
}: {
  reserve: bigint;
  liability: bigint;
}): Pick<PrivateTvlTokenRow, 'coverageStatus' | 'coverageBps'> => {
  if (liability === 0n) {
    return { coverageStatus: 'no-liability', coverageBps: null };
  }
  return {
    coverageStatus:
      reserve === liability ? 'exact' : reserve > liability ? 'overcollateralized' : 'undercollateralized',
    coverageBps: ((reserve * 10_000n) / liability).toString()
  };
};

const price = ({
  pair,
  observation,
  reserve,
  blockTimestamp,
  maxPriceAgeSeconds
}: {
  pair: PrivacyTokenPair;
  observation: PrivateTvlBandObservation | null;
  reserve: bigint;
  blockTimestamp: bigint;
  maxPriceAgeSeconds: bigint;
}): Pick<
  PrivateTvlTokenRow,
  'priceStatus' | 'priceRateE18' | 'priceObservedAt' | 'priceAgeSeconds' | 'usdValueE18'
> => {
  if (observation === null) {
    return {
      priceStatus: 'unavailable',
      priceRateE18: null,
      priceObservedAt: null,
      priceAgeSeconds: null,
      usdValueE18: null
    };
  }
  if (observation.base !== pair.oracleSymbol || observation.quote !== PRIVATE_TVL_BAND_QUOTE_SYMBOL) {
    throw new Error(`Private TVL Band symbol mismatch for ${pair.id}.`);
  }
  const rate = canonicalDecimal(observation.rateE18, `Private TVL ${pair.id} Band rate`);
  const lastUpdatedBase = canonicalDecimal(
    observation.lastUpdatedBase,
    `Private TVL ${pair.id} Band base timestamp`,
    UINT64_MAX
  );
  const lastUpdatedQuote = canonicalDecimal(
    observation.lastUpdatedQuote,
    `Private TVL ${pair.id} Band quote timestamp`,
    UINT64_MAX
  );
  if (rate === 0n || lastUpdatedBase === 0n || lastUpdatedQuote === 0n) {
    return {
      priceStatus: 'unavailable',
      priceRateE18: rate === 0n ? null : rate.toString(),
      priceObservedAt: null,
      priceAgeSeconds: null,
      usdValueE18: null
    };
  }
  const observedAt = lastUpdatedBase < lastUpdatedQuote ? lastUpdatedBase : lastUpdatedQuote;
  if (observedAt > blockTimestamp) {
    return {
      priceStatus: 'unavailable',
      priceRateE18: rate.toString(),
      priceObservedAt: observedAt.toString(),
      priceAgeSeconds: null,
      usdValueE18: null
    };
  }
  const age = blockTimestamp - observedAt;
  if (age > maxPriceAgeSeconds) {
    return {
      priceStatus: 'stale',
      priceRateE18: rate.toString(),
      priceObservedAt: observedAt.toString(),
      priceAgeSeconds: age.toString(),
      usdValueE18: null
    };
  }
  return {
    priceStatus: 'ready',
    priceRateE18: rate.toString(),
    priceObservedAt: observedAt.toString(),
    priceAgeSeconds: age.toString(),
    usdValueE18: ((reserve * rate) / (10n ** BigInt(pair.publicToken.decimals))).toString()
  };
};

export const buildPrivateTvlSnapshot = ({
  observations,
  bandProxyAddress = PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID[COTI_PRIVACY_PORTAL_CHAIN_ID],
  maxPriceAgeSeconds = PRIVATE_TVL_DEFAULT_MAX_PRICE_AGE_SECONDS,
  expectedPairs = PRIVACY_TOKEN_PAIRS
}: {
  observations: readonly PrivateTvlBridgeObservation[];
  bandProxyAddress?: string;
  maxPriceAgeSeconds?: string;
  expectedPairs?: readonly PrivacyTokenPair[];
}): PrivateTvlSnapshot => {
  const maxAge = canonicalDecimal(maxPriceAgeSeconds, 'Private TVL maximum price age', UINT64_MAX);
  if (maxAge === 0n) throw new Error('Private TVL maximum price age must be positive.');
  const proxyAddress = canonicalAddress(bandProxyAddress, 'Private TVL Band proxy');
  if (expectedPairs.length === 0) throw new Error('Private TVL requires at least one reviewed bridge.');
  if (observations.length !== expectedPairs.length) {
    throw new Error('Private TVL observations do not cover the complete reviewed bridge catalog.');
  }

  const observationByPair = new Map<string, PrivateTvlBridgeObservation>();
  for (const observation of observations) {
    if (observationByPair.has(observation.pairId)) {
      throw new Error(`Private TVL contains duplicate observation ${observation.pairId}.`);
    }
    observationByPair.set(observation.pairId, observation);
  }

  let sharedChainId: bigint | null = null;
  let sharedBlockNumber: bigint | null = null;
  let sharedBlockHash: string | null = null;
  let sharedBlockTimestamp: bigint | null = null;
  let totalUsdValueE18 = 0n;
  let pricedTokenCount = 0;
  const tokens: PrivateTvlTokenRow[] = [];

  for (const pair of expectedPairs) {
    const observation = observationByPair.get(pair.id);
    if (!observation) throw new Error(`Private TVL is missing reviewed bridge ${pair.id}.`);
    const chainId = canonicalDecimal(observation.chainId, `Private TVL ${pair.id} chain ID`, UINT64_MAX);
    const blockNumber = canonicalDecimal(observation.blockNumber, `Private TVL ${pair.id} block`, UINT64_MAX);
    const blockHash = canonicalBytes32(observation.blockHash, `Private TVL ${pair.id} block hash`);
    const blockTimestamp = canonicalDecimal(
      observation.blockTimestamp,
      `Private TVL ${pair.id} block timestamp`,
      UINT64_MAX
    );
    const reserve = canonicalDecimal(observation.reserveAtomic, `Private TVL ${pair.id} reserve`);
    const liability = canonicalDecimal(observation.liabilityAtomic, `Private TVL ${pair.id} liability`);
    if (chainId !== BigInt(pair.chainId)) throw new Error(`Private TVL ${pair.id} chain does not match the catalog.`);
    if (blockNumber === 0n || blockTimestamp === 0n) throw new Error(`Private TVL ${pair.id} block is incomplete.`);
    if (canonicalAddress(observation.bridgeAddress, `Private TVL ${pair.id} bridge`) !== pair.bridgeAddress.toLowerCase()) {
      throw new Error(`Private TVL ${pair.id} bridge does not match the catalog.`);
    }

    sharedChainId ??= chainId;
    sharedBlockNumber ??= blockNumber;
    sharedBlockHash ??= blockHash;
    sharedBlockTimestamp ??= blockTimestamp;
    if (
      chainId !== sharedChainId ||
      blockNumber !== sharedBlockNumber ||
      blockHash !== sharedBlockHash ||
      blockTimestamp !== sharedBlockTimestamp
    ) {
      throw new Error('Private TVL observations must share one canonical block.');
    }

    const priceFields = price({ pair, observation: observation.band, reserve, blockTimestamp, maxPriceAgeSeconds: maxAge });
    if (priceFields.usdValueE18 !== null) {
      totalUsdValueE18 += BigInt(priceFields.usdValueE18);
      pricedTokenCount += 1;
    }
    tokens.push(Object.freeze({
      pairId: pair.id,
      publicSymbol: pair.publicToken.symbol,
      privateSymbol: pair.privateToken.symbol,
      oracleSymbol: pair.oracleSymbol,
      bridgeAddress: pair.bridgeAddress.toLowerCase(),
      publicTokenAddress: pair.publicToken.address?.toLowerCase() ?? null,
      privateTokenAddress: pair.privateToken.address.toLowerCase(),
      decimals: pair.publicToken.decimals,
      reserveAtomic: reserve.toString(),
      liabilityAtomic: liability.toString(),
      ...coverage({ reserve, liability }),
      ...priceFields
    }));
  }

  if (observationByPair.size !== expectedPairs.length) {
    throw new Error('Private TVL contains an unreviewed bridge observation.');
  }
  if (sharedChainId === null || sharedBlockNumber === null || sharedBlockHash === null || sharedBlockTimestamp === null) {
    throw new Error('Private TVL canonical block is missing.');
  }
  return Object.freeze({
    schema: PRIVATE_TVL_SCHEMA,
    scope: 'official-coti-private-bridges',
    chainId: sharedChainId.toString(),
    blockNumber: sharedBlockNumber.toString(),
    blockHash: sharedBlockHash,
    blockTimestamp: sharedBlockTimestamp.toString(),
    bandProxyAddress: proxyAddress,
    bandQuoteSymbol: PRIVATE_TVL_BAND_QUOTE_SYMBOL,
    maxPriceAgeSeconds: maxAge.toString(),
    totalUsdValueE18: totalUsdValueE18.toString(),
    pricedTokenCount,
    totalTokenCount: tokens.length,
    hasUnpricedValue: pricedTokenCount !== tokens.length,
    tokens: Object.freeze(tokens)
  });
};

export const formatPrivateTvlAmount = ({
  atomic,
  decimals,
  maximumFractionDigits = 4
}: {
  atomic: string;
  decimals: number;
  maximumFractionDigits?: number;
}): string => {
  const value = canonicalDecimal(atomic, 'Private TVL display amount');
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Private TVL display decimals are invalid.');
  }
  if (!Number.isSafeInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > decimals) {
    throw new Error('Private TVL display precision is invalid.');
  }
  const scale = 10n ** BigInt(decimals);
  const integer = value / scale;
  if (maximumFractionDigits === 0) return integer.toString();
  const fractionScale = 10n ** BigInt(decimals - maximumFractionDigits);
  const fraction = ((value % scale) / fractionScale)
    .toString()
    .padStart(maximumFractionDigits, '0')
    .replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
};

export const formatPrivateTvlUsd = (usdValueE18: string, maximumFractionDigits = 2): string =>
  formatPrivateTvlAmount({
    atomic: usdValueE18,
    decimals: BAND_PRICE_DECIMALS,
    maximumFractionDigits
  });
