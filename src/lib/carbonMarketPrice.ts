import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type TradeAssetKind
} from './appShared';
import {
  GCOTI_TOKEN_ADDRESS,
  PRIVATE_COTI_TOKEN_ADDRESS,
  PRIVATE_GCOTI_TOKEN_ADDRESS,
  PRIVATE_USDC_E_TOKEN_ADDRESS,
  PRIVATE_USDT_TOKEN_ADDRESS,
  PRIVATE_WADA_TOKEN_ADDRESS,
  PRIVATE_WBTC_TOKEN_ADDRESS,
  PRIVATE_WETH_TOKEN_ADDRESS,
  USDC_E_TOKEN_ADDRESS,
  getVerifiedEcosystemToken
} from './appHelpers';

export const CARBON_NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const DEFAULT_CARBON_COTI_API_BASE_URL = 'https://api.carbondefi.xyz/v1/coti';
export const CARBON_MARKET_RATE_PATH = '/market-rate';
export const CARBON_PAIR_REFERENCE_CACHE_TTL_MS = 60_000;

export type CarbonPriceAsset = {
  kind: TradeAssetKind;
  tokenAddress?: string;
  symbol: string;
};

export type CarbonResolvedToken = {
  address: string;
  symbol: string;
  sourceSymbol: string;
  usedPublicCounterpart: boolean;
};

export type CarbonPricePair = {
  base: CarbonResolvedToken;
  quote: CarbonResolvedToken;
  pairKey: string;
  usedPublicCounterpart: boolean;
};

export type CarbonPairReferenceSource = 'market_price';

export type CarbonPairReference = {
  status: 'ready';
  pairKey: string;
  baseSymbol: string;
  quoteSymbol: string;
  price: number;
  source: CarbonPairReferenceSource;
  usedPublicCounterpart: boolean;
  label: string;
  title: string;
};

export type CarbonPairReferenceDisplay = {
  label: string;
  title: string;
  basisLabel: string;
};

type CarbonMarketRateResponse = {
  data?: Record<string, unknown>;
  provider?: unknown;
};

type CarbonReferenceCacheEntry = {
  expiresAt: number;
  reference: CarbonPairReference | null;
};

const carbonReferenceCache = new Map<string, CarbonReferenceCacheEntry>();

const PUBLIC_TOKEN_BY_SYMBOL = new Map(
  [
    ['gCOTI', GCOTI_TOKEN_ADDRESS],
    ['USDC.e', USDC_E_TOKEN_ADDRESS],
    ['WETH', '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1'],
    ['WBTC', '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA'],
    ['USDT', '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E'],
    ['wADA', '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331'],
    ['Pengo', '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8']
  ].map(([symbol, address]) => [symbol.toLowerCase(), { address, symbol }])
);

const PRIVATE_COUNTERPART_BY_SYMBOL = new Map<string, { address: string; symbol: string }>([
  ['p.coti', { address: CARBON_NATIVE_TOKEN_ADDRESS, symbol: COTI_NETWORK.nativeCurrency.symbol }],
  ['pwisp', { address: REWARD_TOKEN_ADDRESS, symbol: 'WISP' }],
  ['p.gcoti', PUBLIC_TOKEN_BY_SYMBOL.get('gcoti')!],
  ['p.usdc.e', PUBLIC_TOKEN_BY_SYMBOL.get('usdc.e')!],
  ['p.weth', PUBLIC_TOKEN_BY_SYMBOL.get('weth')!],
  ['p.wbtc', PUBLIC_TOKEN_BY_SYMBOL.get('wbtc')!],
  ['p.usdt', PUBLIC_TOKEN_BY_SYMBOL.get('usdt')!],
  ['p.wada', PUBLIC_TOKEN_BY_SYMBOL.get('wada')!],
  ['ppengo', PUBLIC_TOKEN_BY_SYMBOL.get('pengo')!]
]);

const PRIVATE_COUNTERPART_BY_ADDRESS = new Map<string, { address: string; symbol: string }>([
  [PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase(), { address: CARBON_NATIVE_TOKEN_ADDRESS, symbol: COTI_NETWORK.nativeCurrency.symbol }],
  [PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase(), { address: REWARD_TOKEN_ADDRESS, symbol: 'WISP' }],
  [PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('gcoti')!],
  [PRIVATE_USDC_E_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('usdc.e')!],
  [PRIVATE_WETH_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('weth')!],
  [PRIVATE_WBTC_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('wbtc')!],
  [PRIVATE_USDT_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('usdt')!],
  [PRIVATE_WADA_TOKEN_ADDRESS.toLowerCase(), PUBLIC_TOKEN_BY_SYMBOL.get('wada')!]
]);

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const isPositiveFiniteNumber = (value: number): boolean => Number.isFinite(value) && value > 0;

const readPositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return isPositiveFiniteNumber(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value.trim());
  return isPositiveFiniteNumber(parsed) ? parsed : null;
};

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    String((error as { name?: unknown }).name) === 'AbortError'
  );
};

const stripTrailingZeros = (value: string): string => value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');

export const formatCarbonPriceValue = (price: number): string => {
  if (!isPositiveFiniteNumber(price)) {
    return '';
  }
  if (price >= 1e9 || price < 0.000001) {
    return price.toExponential(3).replace(/\.?0+e/u, 'e').replace(/e\+/u, 'e');
  }

  const maximumFractionDigits = price >= 1_000 ? 2 : price >= 1 ? 4 : price >= 0.001 ? 5 : price >= 0.000001 ? 6 : 8;
  return stripTrailingZeros(
    price.toLocaleString('en-US', {
      maximumFractionDigits,
      minimumFractionDigits: 0,
      useGrouping: false
    })
  );
};

const buildCarbonPairReferenceTitle = ({
  baseSymbol,
  quoteSymbol,
  usedPublicCounterpart
}: Pick<CarbonPairReference, 'baseSymbol' | 'quoteSymbol' | 'usedPublicCounterpart'>): string => {
  const counterpartLabel = usedPublicCounterpart ? ' Public-token counterpart used for private tokens.' : '';
  return `Carbon market price for ${baseSymbol}/${quoteSymbol}.${counterpartLabel}`;
};

export const formatCarbonPairReferenceDisplay = (
  reference: CarbonPairReference | null | undefined,
  { inverted = false }: { inverted?: boolean } = {}
): CarbonPairReferenceDisplay | null => {
  if (!reference || !isPositiveFiniteNumber(reference.price)) {
    return null;
  }

  const price = inverted ? 1 / reference.price : reference.price;
  if (!isPositiveFiniteNumber(price)) {
    return null;
  }

  const baseSymbol = inverted ? reference.quoteSymbol : reference.baseSymbol;
  const quoteSymbol = inverted ? reference.baseSymbol : reference.quoteSymbol;
  const basisLabel = `${quoteSymbol}/${baseSymbol}`;
  const counterpartLabel = reference.usedPublicCounterpart ? ' Public-token counterpart used for private tokens.' : '';

  return {
    basisLabel,
    label: `Carbon price ${formatCarbonPriceValue(price)} ${basisLabel}`,
    title: `Carbon market price for ${baseSymbol}/${quoteSymbol}.${counterpartLabel}`
  };
};

export const resolveCarbonToken = (asset?: CarbonPriceAsset | null): CarbonResolvedToken | null => {
  if (!asset) {
    return null;
  }

  const sourceSymbol = asset.symbol.trim() || 'Asset';
  if (asset.kind === 'native') {
    return {
      address: CARBON_NATIVE_TOKEN_ADDRESS,
      symbol: COTI_NETWORK.nativeCurrency.symbol,
      sourceSymbol,
      usedPublicCounterpart: false
    };
  }

  const normalizedAddress = normalizeAddress(asset.tokenAddress);
  if (!normalizedAddress) {
    return null;
  }

  if (asset.kind === 'erc20') {
    return {
      address: asset.tokenAddress!.trim(),
      symbol: sourceSymbol,
      sourceSymbol,
      usedPublicCounterpart: false
    };
  }

  const verifiedToken = getVerifiedEcosystemToken(normalizedAddress);
  if (verifiedToken?.kind !== 'private-erc20') {
    return null;
  }

  const counterpart =
    PRIVATE_COUNTERPART_BY_ADDRESS.get(normalizedAddress) ??
    PRIVATE_COUNTERPART_BY_SYMBOL.get(verifiedToken.symbol.trim().toLowerCase());
  if (!counterpart) {
    return null;
  }

  return {
    address: counterpart.address,
    symbol: counterpart.symbol,
    sourceSymbol,
    usedPublicCounterpart: true
  };
};

export const resolveCarbonPricePair = (
  baseAsset?: CarbonPriceAsset | null,
  quoteAsset?: CarbonPriceAsset | null
): CarbonPricePair | null => {
  const base = resolveCarbonToken(baseAsset);
  const quote = resolveCarbonToken(quoteAsset);
  if (!base || !quote) {
    return null;
  }

  const normalizedBaseAddress = normalizeAddress(base.address);
  const normalizedQuoteAddress = normalizeAddress(quote.address);
  if (!normalizedBaseAddress || !normalizedQuoteAddress || normalizedBaseAddress === normalizedQuoteAddress) {
    return null;
  }

  return {
    base,
    quote,
    pairKey: `${normalizedBaseAddress}:${normalizedQuoteAddress}`,
    usedPublicCounterpart: base.usedPublicCounterpart || quote.usedPublicCounterpart
  };
};

export const resolveCarbonMarketRateUrl = ({
  address,
  configuredBaseUrl
}: {
  address: string;
  configuredBaseUrl?: string;
}): string => {
  const baseUrl = (configuredBaseUrl?.trim() || DEFAULT_CARBON_COTI_API_BASE_URL).replace(/\/+$/u, '');
  const url = new URL(`${baseUrl}${CARBON_MARKET_RATE_PATH}`);
  url.searchParams.set('address', address);
  url.searchParams.set('convert', 'USD');
  return url.toString();
};

const getCarbonMarketRateUrl = (address: string): string => {
  return resolveCarbonMarketRateUrl({
    address,
    configuredBaseUrl: import.meta.env.VITE_CARBON_MARKET_API_BASE_URL
  });
};

const buildCarbonReferenceFromMarketRate = (
  baseUsd: number,
  quoteUsd: number,
  pair: CarbonPricePair
): CarbonPairReference | null => {
  const price = baseUsd / quoteUsd;
  if (!isPositiveFiniteNumber(price)) {
    return null;
  }

  const reference: CarbonPairReference = {
    status: 'ready',
    pairKey: pair.pairKey,
    baseSymbol: pair.base.symbol,
    quoteSymbol: pair.quote.symbol,
    price,
    source: 'market_price',
    usedPublicCounterpart: pair.usedPublicCounterpart,
    label: '',
    title: ''
  };
  const display = formatCarbonPairReferenceDisplay(reference);
  if (!display) {
    return null;
  }

  return {
    ...reference,
    label: display.label,
    title: buildCarbonPairReferenceTitle(reference)
  };
};

const fetchCarbonUsdMarketRate = async ({
  address,
  fetcher,
  signal
}: {
  address: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}): Promise<number | null> => {
  const response = await fetcher(getCarbonMarketRateUrl(address), {
    headers: {
      accept: 'application/json'
    },
    method: 'GET',
    signal
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as CarbonMarketRateResponse;
  return readPositiveNumber(payload.data?.USD);
};

const fetchCarbonMarketRateReference = async ({
  fetcher,
  pair,
  signal
}: {
  fetcher: typeof fetch;
  pair: CarbonPricePair;
  signal?: AbortSignal;
}): Promise<CarbonPairReference | null> => {
  const [baseUsd, quoteUsd] = await Promise.all([
    fetchCarbonUsdMarketRate({ address: pair.base.address, fetcher, signal }),
    fetchCarbonUsdMarketRate({ address: pair.quote.address, fetcher, signal })
  ]);

  if (baseUsd === null || quoteUsd === null) {
    return null;
  }

  return buildCarbonReferenceFromMarketRate(baseUsd, quoteUsd, pair);
};

export const clearCarbonPairReferenceCache = (): void => {
  carbonReferenceCache.clear();
};

export const fetchCarbonPairReference = async ({
  baseAsset,
  quoteAsset,
  signal,
  fetcher = fetch,
  now = Date.now()
}: {
  baseAsset?: CarbonPriceAsset | null;
  quoteAsset?: CarbonPriceAsset | null;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: number;
}): Promise<CarbonPairReference | null> => {
  const pair = resolveCarbonPricePair(baseAsset, quoteAsset);
  if (!pair) {
    return null;
  }

  const cached = carbonReferenceCache.get(pair.pairKey);
  if (cached && cached.expiresAt > now) {
    return cached.reference;
  }

  try {
    const reference = await fetchCarbonMarketRateReference({ fetcher, pair, signal });
    carbonReferenceCache.set(pair.pairKey, { expiresAt: now + CARBON_PAIR_REFERENCE_CACHE_TTL_MS, reference });
    return reference;
  } catch (error) {
    if (isAbortError(error, signal)) {
      return null;
    }
    carbonReferenceCache.set(pair.pairKey, { expiresAt: now + CARBON_PAIR_REFERENCE_CACHE_TTL_MS, reference: null });
    return null;
  }
};
