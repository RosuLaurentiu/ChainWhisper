import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARBON_NATIVE_TOKEN_ADDRESS,
  CARBON_MARKET_RATE_PATH,
  DEFAULT_CARBON_COTI_API_BASE_URL,
  clearCarbonPairReferenceCache,
  fetchCarbonPairReference,
  formatCarbonPairReferenceDisplay,
  resolveCarbonMarketRateUrl,
  resolveCarbonPricePair,
  resolveCarbonToken
} from './carbonMarketPrice';
import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type TradeAssetPayload
} from './appShared';
import {
  GCOTI_TOKEN_ADDRESS,
  HOTDOG_PRIVATE_TOKEN_ADDRESS,
  PRIVATE_COTI_TOKEN_ADDRESS,
  PRIVATE_GCOTI_TOKEN_ADDRESS,
  USDC_E_TOKEN_ADDRESS
} from './appHelpers';

const asset = (
  symbol: string,
  kind: TradeAssetPayload['kind'],
  tokenAddress?: string
): Pick<TradeAssetPayload, 'kind' | 'symbol' | 'tokenAddress'> => ({
  kind,
  symbol,
  tokenAddress
});

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status
  });

const marketRateResponse = (usd: number | null, status = 200): Response =>
  jsonResponse({ data: usd === null ? {} : { USD: usd }, provider: 'carbon' }, status);

const marketRateFetcher = ({
  baseAddress,
  baseUsd,
  quoteAddress,
  quoteUsd
}: {
  baseAddress: string;
  baseUsd: number | null;
  quoteAddress: string;
  quoteUsd: number | null;
}): ReturnType<typeof vi.fn<typeof fetch>> =>
  vi.fn(async (input) => {
    const url = String(input);
    if (url.includes(baseAddress)) {
      return marketRateResponse(baseUsd);
    }
    if (url.includes(quoteAddress)) {
      return marketRateResponse(quoteUsd);
    }
    return marketRateResponse(null, 404);
  });

describe('carbonMarketPrice helpers', () => {
  beforeEach(() => {
    clearCarbonPairReferenceCache();
    vi.restoreAllMocks();
  });

  it('normalizes native and public ERC-20 assets for Carbon', () => {
    expect(resolveCarbonToken(asset('COTI', 'native'))).toMatchObject({
      address: CARBON_NATIVE_TOKEN_ADDRESS,
      symbol: COTI_NETWORK.nativeCurrency.symbol,
      usedPublicCounterpart: false
    });
    expect(resolveCarbonToken(asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS))).toMatchObject({
      address: REWARD_TOKEN_ADDRESS,
      symbol: 'WISP',
      usedPublicCounterpart: false
    });
    expect(resolveCarbonToken(asset('CUSTOM', 'erc20', '0x1111111111111111111111111111111111111111'))).toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'CUSTOM',
      usedPublicCounterpart: false
    });
  });

  it('resolves Carbon market-rate API URLs', () => {
    expect(resolveCarbonMarketRateUrl({ address: REWARD_TOKEN_ADDRESS })).toBe(
      `${DEFAULT_CARBON_COTI_API_BASE_URL}${CARBON_MARKET_RATE_PATH}?address=${REWARD_TOKEN_ADDRESS}&convert=USD`
    );
    expect(resolveCarbonMarketRateUrl({
      address: REWARD_TOKEN_ADDRESS,
      configuredBaseUrl: 'https://carbon-api.example/coti/'
    })).toBe(
      `https://carbon-api.example/coti${CARBON_MARKET_RATE_PATH}?address=${REWARD_TOKEN_ADDRESS}&convert=USD`
    );
  });

  it('maps verified private tokens to their public Carbon counterpart', () => {
    expect(resolveCarbonToken(asset('pWISP', 'private-erc20', PRIVATE_REWARD_TOKEN_ADDRESS))).toMatchObject({
      address: REWARD_TOKEN_ADDRESS,
      symbol: 'WISP',
      sourceSymbol: 'pWISP',
      usedPublicCounterpart: true
    });
    expect(resolveCarbonToken(asset('p.COTI', 'private-erc20', PRIVATE_COTI_TOKEN_ADDRESS))).toMatchObject({
      address: CARBON_NATIVE_TOKEN_ADDRESS,
      symbol: 'COTI',
      sourceSymbol: 'p.COTI',
      usedPublicCounterpart: true
    });
    expect(resolveCarbonToken(asset('p.gCOTI', 'private-erc20', PRIVATE_GCOTI_TOKEN_ADDRESS))).toMatchObject({
      address: GCOTI_TOKEN_ADDRESS,
      symbol: 'gCOTI',
      sourceSymbol: 'p.gCOTI',
      usedPublicCounterpart: true
    });
  });

  it('skips private tokens without an explicit public counterpart', () => {
    expect(resolveCarbonToken(asset('HOTDOG', 'private-erc20', HOTDOG_PRIVATE_TOKEN_ADDRESS))).toBeNull();
    expect(resolveCarbonToken(asset('pCUSTOM', 'private-erc20', '0x2222222222222222222222222222222222222222'))).toBeNull();
  });

  it('builds Carbon pair keys for public, mixed, and fully private mapped pairs', () => {
    expect(resolveCarbonPricePair(asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS), asset('COTI', 'native'))).toMatchObject({
      base: { address: REWARD_TOKEN_ADDRESS, symbol: 'WISP' },
      quote: { address: CARBON_NATIVE_TOKEN_ADDRESS, symbol: 'COTI' },
      usedPublicCounterpart: false
    });
    expect(resolveCarbonPricePair(asset('pWISP', 'private-erc20', PRIVATE_REWARD_TOKEN_ADDRESS), asset('COTI', 'native'))).toMatchObject({
      base: { address: REWARD_TOKEN_ADDRESS, symbol: 'WISP' },
      quote: { address: CARBON_NATIVE_TOKEN_ADDRESS, symbol: 'COTI' },
      usedPublicCounterpart: true
    });
    expect(resolveCarbonPricePair(asset('p.gCOTI', 'private-erc20', PRIVATE_GCOTI_TOKEN_ADDRESS), asset('p.COTI', 'private-erc20', PRIVATE_COTI_TOKEN_ADDRESS))).toMatchObject({
      base: { address: GCOTI_TOKEN_ADDRESS, symbol: 'gCOTI' },
      quote: { address: CARBON_NATIVE_TOKEN_ADDRESS, symbol: 'COTI' },
      usedPublicCounterpart: true
    });
  });

  it('does not query Carbon when the normalized pair collapses to one asset', () => {
    expect(resolveCarbonPricePair(asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS), asset('pWISP', 'private-erc20', PRIVATE_REWARD_TOKEN_ADDRESS))).toBeNull();
    expect(resolveCarbonPricePair(asset('USDC.e', 'erc20', USDC_E_TOKEN_ADDRESS), asset('USDC.e', 'erc20', USDC_E_TOKEN_ADDRESS))).toBeNull();
  });

  it('uses Carbon market price when available', async () => {
    const fetcher = marketRateFetcher({
      baseAddress: REWARD_TOKEN_ADDRESS,
      baseUsd: 0.00000286,
      quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
      quoteUsd: 0.01
    });

    const reference = await fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher,
      quoteAsset: asset('COTI', 'native')
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(`${CARBON_MARKET_RATE_PATH}?address=${REWARD_TOKEN_ADDRESS}`),
      expect.objectContaining({ method: 'GET' })
    );
    expect(reference).toMatchObject({
      baseSymbol: 'WISP',
      label: 'Carbon price 0.000286 COTI/WISP',
      quoteSymbol: 'COTI',
      source: 'market_price'
    });
  });

  it('computes pair price from Carbon token market rates', async () => {
    const reference = await fetchCarbonPairReference({
      baseAsset: asset('Pengo', 'erc20', '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8'),
      fetcher: marketRateFetcher({
        baseAddress: '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8',
        baseUsd: 0.000000000003153,
        quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
        quoteUsd: 0.01
      }),
      quoteAsset: asset('COTI', 'native')
    });

    expect(reference).toMatchObject({
      label: 'Carbon price 3.153e-10 COTI/Pengo',
      source: 'market_price'
    });
  });

  it('formats inverted Carbon reference basis for flipped price displays', async () => {
    const reference = await fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: marketRateFetcher({
        baseAddress: REWARD_TOKEN_ADDRESS,
        baseUsd: 0.0000025,
        quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
        quoteUsd: 0.01
      }),
      quoteAsset: asset('COTI', 'native')
    });

    expect(formatCarbonPairReferenceDisplay(reference, { inverted: true })).toMatchObject({
      basisLabel: 'WISP/COTI',
      label: 'Carbon price 4000 WISP/COTI'
    });
  });

  it('fails soft for no data, malformed responses, and request failures', async () => {
    await expect(fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: marketRateFetcher({
        baseAddress: REWARD_TOKEN_ADDRESS,
        baseUsd: null,
        quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
        quoteUsd: 0.01
      }),
      quoteAsset: asset('COTI', 'native')
    })).resolves.toBeNull();

    clearCarbonPairReferenceCache();
    await expect(fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: marketRateFetcher({
        baseAddress: REWARD_TOKEN_ADDRESS,
        baseUsd: 0.00000286,
        quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
        quoteUsd: null
      }),
      quoteAsset: asset('COTI', 'native')
    })).resolves.toBeNull();

    clearCarbonPairReferenceCache();
    await expect(fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: vi.fn(async () => {
        throw new Error('CORS blocked');
      }),
      quoteAsset: asset('COTI', 'native')
    })).resolves.toBeNull();
  });

  it('does not cache aborted requests as missing Carbon data', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortedFetcher = vi.fn(async () => {
      throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    });

    await expect(fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: abortedFetcher,
      now: 1000,
      quoteAsset: asset('COTI', 'native'),
      signal: controller.signal
    })).resolves.toBeNull();

    const successfulFetcher = marketRateFetcher({
      baseAddress: REWARD_TOKEN_ADDRESS,
      baseUsd: 0.00000286,
      quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
      quoteUsd: 0.01
    });

    await expect(fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher: successfulFetcher,
      now: 1001,
      quoteAsset: asset('COTI', 'native')
    })).resolves.toMatchObject({
      label: 'Carbon price 0.000286 COTI/WISP'
    });
    expect(successfulFetcher).toHaveBeenCalledTimes(2);
  });

  it('caches pair references for the TTL window', async () => {
    const fetcher = marketRateFetcher({
      baseAddress: REWARD_TOKEN_ADDRESS,
      baseUsd: 0.00000286,
      quoteAddress: CARBON_NATIVE_TOKEN_ADDRESS,
      quoteUsd: 0.01
    });

    const first = await fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher,
      now: 1000,
      quoteAsset: asset('COTI', 'native')
    });
    const second = await fetchCarbonPairReference({
      baseAsset: asset('WISP', 'erc20', REWARD_TOKEN_ADDRESS),
      fetcher,
      now: 2000,
      quoteAsset: asset('COTI', 'native')
    });

    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
