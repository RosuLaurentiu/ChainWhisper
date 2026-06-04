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
export const DEFAULT_CARBON_MCP_API_BASE_URL = 'https://mcp.carbondefi.xyz';
export const CARBON_MCP_DEV_PROXY_BASE_URL = '/carbon-mcp';
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

export type CarbonPairReferenceSource = 'market_price' | 'marginal';

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

type CarbonExplorePairResponse = {
  status?: unknown;
  market_price?: unknown;
  active_strategies?: Array<{
    base_token?: unknown;
    buy?: { marginal?: unknown };
    quote_token?: unknown;
    sell?: { marginal?: unknown };
  }>;
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
  source,
  usedPublicCounterpart
}: Pick<CarbonPairReference, 'baseSymbol' | 'quoteSymbol' | 'source' | 'usedPublicCounterpart'>): string => {
  const sourceLabel = source === 'market_price' ? 'Carbon market price' : 'Carbon strategy marginal price';
  const counterpartLabel = usedPublicCounterpart ? ' Public-token counterpart used for private tokens.' : '';
  return `${sourceLabel} for ${baseSymbol}/${quoteSymbol}.${counterpartLabel}`;
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
  const sourceLabel = reference.source === 'market_price' ? 'Carbon market price' : 'Carbon marginal price';
  const counterpartLabel = reference.usedPublicCounterpart ? ' Public-token counterpart used for private tokens.' : '';

  return {
    basisLabel,
    label: `Carbon price ${formatCarbonPriceValue(price)} ${basisLabel}`,
    title: `${sourceLabel} for ${baseSymbol}/${quoteSymbol}.${counterpartLabel}`
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

const getCarbonApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_CARBON_MCP_API_BASE_URL?.trim();
  const defaultBaseUrl = import.meta.env.DEV ? CARBON_MCP_DEV_PROXY_BASE_URL : DEFAULT_CARBON_MCP_API_BASE_URL;
  return (configured || defaultBaseUrl).replace(/\/+$/u, '');
};

const readStrategyMarginalPrice = (strategy: NonNullable<CarbonExplorePairResponse['active_strategies']>[number]): number | null => {
  const buyMarginal = readPositiveNumber(strategy.buy?.marginal);
  if (buyMarginal !== null) {
    return buyMarginal;
  }
  return readPositiveNumber(strategy.sell?.marginal);
};

const getMarginalFallbackPrice = (payload: CarbonExplorePairResponse, pair: CarbonPricePair): number | null => {
  const strategies = Array.isArray(payload.active_strategies) ? payload.active_strategies : [];
  let firstUnscopedMarginal: number | null = null;
  const pairBaseAddress = normalizeAddress(pair.base.address);
  const pairQuoteAddress = normalizeAddress(pair.quote.address);

  for (const strategy of strategies) {
    const marginal = readStrategyMarginalPrice(strategy);
    if (marginal === null) {
      continue;
    }

    const strategyBaseAddress = typeof strategy.base_token === 'string' ? normalizeAddress(strategy.base_token) : '';
    const strategyQuoteAddress = typeof strategy.quote_token === 'string' ? normalizeAddress(strategy.quote_token) : '';
    if (!strategyBaseAddress || !strategyQuoteAddress) {
      firstUnscopedMarginal ??= marginal;
      continue;
    }

    if (strategyBaseAddress === pairBaseAddress && strategyQuoteAddress === pairQuoteAddress) {
      return marginal;
    }
    if (strategyBaseAddress === pairQuoteAddress && strategyQuoteAddress === pairBaseAddress) {
      return 1 / marginal;
    }
  }
  return firstUnscopedMarginal;
};

const buildCarbonReferenceFromPayload = (
  payload: CarbonExplorePairResponse,
  pair: CarbonPricePair
): CarbonPairReference | null => {
  if (payload.status !== 'ok') {
    return null;
  }

  const marketPrice = readPositiveNumber(payload.market_price);
  const source: CarbonPairReferenceSource = marketPrice !== null ? 'market_price' : 'marginal';
  const price = marketPrice ?? getMarginalFallbackPrice(payload, pair);
  if (price === null) {
    return null;
  }

  const reference: CarbonPairReference = {
    status: 'ready',
    pairKey: pair.pairKey,
    baseSymbol: pair.base.symbol,
    quoteSymbol: pair.quote.symbol,
    price,
    source,
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
    const response = await fetcher(`${getCarbonApiBaseUrl()}/tools/explore_pair`, {
      body: JSON.stringify({
        base_token: pair.base.address,
        chain: 'coti',
        quote_token: pair.quote.address,
        top_n: 3
      }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      method: 'POST',
      signal
    });

    if (!response.ok) {
      carbonReferenceCache.set(pair.pairKey, { expiresAt: now + CARBON_PAIR_REFERENCE_CACHE_TTL_MS, reference: null });
      return null;
    }

    const payload = (await response.json()) as CarbonExplorePairResponse;
    const reference = buildCarbonReferenceFromPayload(payload, pair);
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
