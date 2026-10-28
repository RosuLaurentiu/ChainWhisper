import { API_CATALOG, API_ROUTES, OPENAPI_DOCUMENT } from './openapi';
import {
  API_VERSION,
  CONTRACTS,
  EXPLORER_URL,
  PRIVACY_ROUTES,
  REGISTRY_VERSION,
  VERIFIED_ASSETS,
  publicAsset,
  resolveVerifiedAsset
} from './registry';
import { RpcUnavailableError } from './rpc';
import { RUNTIME_VERIFICATION_SCOPE } from './source';
import {
  ApiFault,
  type ChainWhisperApiSource,
  type PrivateLiquidityDailyPriceApiSource,
  type PrivateLiquidityV2ApiSource,
  type TestnetRegistryV2ApiSource,
  type VerifiedAsset
} from './types';

const MAX_BODY_BYTES = 4_096;
const MAX_ORDER_LIMIT = 20;
const MAX_DAILY_PRICE_LIMIT = 366;
const MAX_CURSOR = 1_000_000_000;
const MAX_UINT256 = (1n << 256n) - 1n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export type QuoteRateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

const baseHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff'
} as const;

const json = (
  value: unknown,
  status = 200,
  cacheControl = 'no-store'
): Response =>
  Response.json(value, {
    status,
    headers: {
      ...baseHeaders,
      'cache-control': cacheControl
    }
  });

const errorResponse = (fault: ApiFault): Response =>
  json({ error: { code: fault.code, message: fault.message } }, fault.status);

const assertQueryKeys = (url: URL, allowed: readonly string[]): void => {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      throw new ApiFault('invalid_query', `Unsupported query parameter: ${key}.`, 400);
    }
  }
};

const parseBoundedInteger = (
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): number => {
  if (raw === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new ApiFault('invalid_query', `${label} must be an integer.`, 400);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ApiFault('invalid_query', `${label} is outside the supported range.`, 400);
  }
  return value;
};

const requireAsset = (value: string | null, fieldName: string): VerifiedAsset => {
  const asset = value ? resolveVerifiedAsset(value) : null;
  if (!asset) {
    throw new ApiFault('unsupported_asset', `${fieldName} must be a verified ChainWhisper asset.`, 400);
  }
  return asset;
};

const readJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ApiFault('body_too_large', 'Request body is too large.', 413);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ApiFault('body_too_large', 'Request body is too large.', 413);
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiFault('invalid_json', 'Request body must be a JSON object.', 400);
  }
};

const parseAmount = (raw: unknown, decimals: number): string => {
  if (
    typeof raw !== 'string' ||
    raw.length > 80 ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(raw)
  ) {
    throw new ApiFault('invalid_amount', 'amount must be a positive decimal string.', 400);
  }
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > decimals || !/[1-9]/u.test(`${whole}${fraction}`)) {
    throw new ApiFault('invalid_amount', 'amount precision or value is invalid for the selected asset.', 400);
  }
  const atomic = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (atomic > MAX_UINT256) {
    throw new ApiFault('invalid_amount', 'amount is outside uint256 after applying asset decimals.', 400);
  }
  return raw;
};

export const createChainWhisperApiHandler = (
  source: ChainWhisperApiSource,
  quoteRateLimiter?: QuoteRateLimiter,
  privateLiquidityV2Source?: PrivateLiquidityV2ApiSource,
  privateLiquidityDailyPriceSource?: PrivateLiquidityDailyPriceApiSource,
  testnetRegistryV2Source?: TestnetRegistryV2ApiSource
): ((request: Request) => Promise<Response>) =>
  async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders,
          'cache-control': 'public, max-age=86400'
        }
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/u, '') || '/';

      if (path === API_ROUTES.catalog.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        return json(API_CATALOG, 200, 'public, max-age=3600, stale-while-revalidate=86400');
      }

      if (path === API_ROUTES.openapi.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        return json(OPENAPI_DOCUMENT, 200, 'public, max-age=3600, stale-while-revalidate=86400');
      }

      if (path === API_ROUTES.status.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        const status = await source.getStatus();
        return json(status, status.ready ? 200 : 503, 'public, max-age=10');
      }

      if (path === API_ROUTES.capabilities.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        return json({
          apiVersion: API_VERSION,
          registryVersion: REGISTRY_VERSION,
          network: {
            name: 'COTI Mainnet',
            chainId: 2_632_500,
            explorerUrl: EXPLORER_URL
          },
          access: {
            public: true,
            apiKeyRequired: false
          },
          operations: {
            reads: ['status', 'capabilities', 'public-orders', 'market-reference', 'best-single-order-swap-quote'],
            writes: [],
            testnetRegistryV2: testnetRegistryV2Source ? ['deployment-and-event-policy'] : [],
            testnetPrivateLiquidityV2: privateLiquidityV2Source ? ['complete-public-pair'] : [],
            testnetPrivateLiquidityAnalytics: privateLiquidityDailyPriceSource
              ? ['daily-marginal-price-history']
              : []
          },
          boundaries: {
            accountData: false,
            privateAmounts: false,
            unlistedOrders: false,
            directOrders: false,
            rawEventData: false,
            encryptedEventContent: false,
            participantEncryptedReceipts: false,
            executionCalldata: false,
            signing: false
          },
          verificationScope: RUNTIME_VERIFICATION_SCOPE,
          contracts: {
            standardEscrow: CONTRACTS.standardEscrow,
            privateEscrow: CONTRACTS.privateEscrow,
            recurringEscrow: CONTRACTS.recurringEscrow,
            reader: CONTRACTS.reader
          },
          verifiedAssets: VERIFIED_ASSETS.map((asset) => ({
            ...publicAsset(asset),
            publicCounterpartId: asset.publicCounterpartId
          })),
          privacyRoutes: PRIVACY_ROUTES
        }, 200, 'public, max-age=3600, stale-while-revalidate=86400');
      }

      if (path === API_ROUTES.testnetRegistryV2.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        if (!testnetRegistryV2Source) {
          throw new ApiFault(
            'testnet_registry_unavailable',
            'The reviewed ChainWhisper V2 testnet registry is not active for public reads.',
            503
          );
        }
        try {
          return json(
            await testnetRegistryV2Source.getRegistry(),
            200,
            'public, max-age=30, stale-while-revalidate=120'
          );
        } catch {
          throw new ApiFault(
            'testnet_registry_unavailable',
            'The reviewed ChainWhisper V2 testnet registry could not be verified.',
            503
          );
        }
      }

      if (path === API_ROUTES.privateLiquidityPair.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        if (!privateLiquidityV2Source) {
          throw new ApiFault(
            'testnet_candidate_unavailable',
            'The unified Private Liquidity V2 testnet candidate is not active for public reads.',
            503
          );
        }
        try {
          return json(
            await privateLiquidityV2Source.getPair(),
            200,
            'public, max-age=5, stale-while-revalidate=15'
          );
        } catch {
          throw new ApiFault(
            'testnet_candidate_unavailable',
            'The unified Private Liquidity V2 testnet candidate could not be verified.',
            503
          );
        }
      }

      if (path === API_ROUTES.privateLiquidityDailyPrices.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, ['pairKey', 'start', 'limit']);
        if (!privateLiquidityDailyPriceSource) {
          throw new ApiFault(
            'testnet_analytics_unavailable',
            'The reviewed Private Liquidity daily-price store is not active for public reads.',
            503
          );
        }
        const rawPairKey = url.searchParams.get('pairKey');
        if (
          !rawPairKey ||
          !BYTES32.test(rawPairKey) ||
          rawPairKey.toLowerCase() === ZERO_BYTES32
        ) throw new ApiFault('invalid_query', 'pairKey must be a nonzero bytes32 value.', 400);
        const rawStart = url.searchParams.get('start');
        const start = rawStart === null
          ? null
          : parseBoundedInteger(rawStart, 0, 0, MAX_CURSOR, 'start');
        const limit = parseBoundedInteger(
          url.searchParams.get('limit'),
          90,
          1,
          MAX_DAILY_PRICE_LIMIT,
          'limit'
        );
        try {
          return json(
            await privateLiquidityDailyPriceSource.getDailyPrices({
              pairKey: rawPairKey.toLowerCase() as `0x${string}`,
              start,
              limit
            }),
            200,
            'public, max-age=30, stale-while-revalidate=120'
          );
        } catch {
          throw new ApiFault(
            'testnet_analytics_unavailable',
            'The reviewed Private Liquidity daily-price history could not be verified.',
            503
          );
        }
      }

      if (path === API_ROUTES.orders.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, ['cursor', 'limit']);
        const cursor = parseBoundedInteger(url.searchParams.get('cursor'), 0, 0, MAX_CURSOR, 'cursor');
        const limit = parseBoundedInteger(url.searchParams.get('limit'), 10, 1, MAX_ORDER_LIMIT, 'limit');
        return json(
          await source.listOrders({ cursor, limit }),
          200,
          'public, max-age=5, stale-while-revalidate=15'
        );
      }

      const orderMatch = new RegExp(
        `^${API_ROUTES.orders.path}/([^/]+)/([1-9]\\d*)$`,
        'u'
      ).exec(path);
      if (orderMatch) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        const contract = decodeURIComponent(orderMatch[1]!);
        const localId = BigInt(orderMatch[2]!);
        if (localId > MAX_UINT256) throw new ApiFault('invalid_order_id', 'Order id is outside uint256.', 400);
        const order = await source.getOrder(contract, localId);
        if (!order) throw new ApiFault('order_not_found', 'Public order was not found.', 404);
        return json(order, 200, 'public, max-age=5, stale-while-revalidate=15');
      }

      if (path === API_ROUTES.marketReference.path) {
        if (request.method !== 'GET') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, ['base', 'quote']);
        const base = requireAsset(url.searchParams.get('base'), 'base');
        const quote = requireAsset(url.searchParams.get('quote'), 'quote');
        if (base.id === quote.id) throw new ApiFault('invalid_pair', 'base and quote must be different assets.', 400);
        const reference = await source.getMarketReference(base, quote);
        if (!reference) throw new ApiFault('market_unavailable', 'Market reference is unavailable for this pair.', 503);
        return json(reference, 200, 'public, max-age=30, stale-while-revalidate=60');
      }

      if (path === API_ROUTES.swapQuote.path) {
        if (request.method !== 'POST') throw new ApiFault('method_not_allowed', 'Method not allowed.', 405);
        assertQueryKeys(url, []);
        if (quoteRateLimiter) {
          let rateLimit;
          try {
            rateLimit = await quoteRateLimiter.limit({
              key: request.headers.get('cf-connecting-ip')?.trim().slice(0, 64) || 'anonymous'
            });
          } catch {
            throw new ApiFault('rate_limit_unavailable', 'Swap quotes are temporarily unavailable.', 503);
          }
          if (!rateLimit.success) {
            throw new ApiFault('rate_limited', 'Too many swap quote requests. Try again shortly.', 429);
          }
        }
        const body = await readJsonObject(request);
        const allowed = ['sellAsset', 'buyAsset', 'amount', 'amountMode'];
        const unknownKey = Object.keys(body).find((key) => !allowed.includes(key));
        if (unknownKey) throw new ApiFault('invalid_body', `Unsupported body field: ${unknownKey}.`, 400);
        const sellAsset = requireAsset(typeof body.sellAsset === 'string' ? body.sellAsset : null, 'sellAsset');
        const buyAsset = requireAsset(typeof body.buyAsset === 'string' ? body.buyAsset : null, 'buyAsset');
        if (sellAsset.id === buyAsset.id) throw new ApiFault('invalid_pair', 'sellAsset and buyAsset must differ.', 400);
        const amountMode = body.amountMode;
        if (amountMode !== 'sell' && amountMode !== 'buy') {
          throw new ApiFault('invalid_body', 'amountMode must be "sell" or "buy".', 400);
        }
        const amount = parseAmount(
          body.amount,
          amountMode === 'sell' ? sellAsset.decimals : buyAsset.decimals
        );
        const quote = await source.quoteBestSingleSwap({
          sellAsset,
          buyAsset,
          amount,
          amountMode
        });
        if (!quote) throw new ApiFault('no_executable_order', 'No complete visible public order can fill this amount.', 404);
        return json(quote);
      }

      throw new ApiFault('not_found', 'API route not found.', 404);
    } catch (error) {
      if (error instanceof ApiFault) return errorResponse(error);
      if (error instanceof RpcUnavailableError) {
        return errorResponse(
          new ApiFault('upstream_unavailable', 'Verified public reads are temporarily unavailable.', 503)
        );
      }
      return errorResponse(new ApiFault('internal_error', 'The API could not complete this request.', 500));
    }
  };
