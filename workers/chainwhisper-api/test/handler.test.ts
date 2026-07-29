import { describe, expect, it, vi } from 'vitest';
import { createChainWhisperApiHandler } from '../src/handler';
import { API_ROUTES } from '../src/openapi';
import { resolveVerifiedAsset } from '../src/registry';
import { RpcUnavailableError } from '../src/rpc';
import { RUNTIME_VERIFICATION_SCOPE } from '../src/source';
import type {
  ApiStatus,
  ChainWhisperApiSource,
  MarketReference,
  PublicOrder,
  SwapQuote
} from '../src/types';

const WISP = resolveVerifiedAsset('WISP')!;
const COTI = resolveVerifiedAsset('COTI')!;
const identity = {
  escrowContract: '0x7a232810f250a2c6e90895215aff826116dfdb06' as const,
  localId: '1',
  handle: 'cw_7a232810f250a2c6e90895215aff826116dfdb06_1'
};
const order: PublicOrder = {
  identity,
  kind: 'one-off',
  orderType: { id: 'one-off.public.visible-liquidity', label: 'Public one-off order with visible liquidity' },
  status: 'open',
  access: 'public',
  liquidityVisibility: 'visible',
  maker: '0x1111111111111111111111111111111111111111',
  recipient: null,
  offerAsset: WISP,
  requestAsset: COTI,
  offerAmount: '10',
  requestAmount: '9',
  remainingOfferAmount: '10',
  remainingRequestAmount: '9',
  price: '0.9',
  priceBasis: 'quote_per_base',
  createdAt: '2026-07-29T00:00:00.000Z',
  expiresAt: null,
  appUrl: 'https://chainwhisper.chat/otc/order/link/VgAB',
  fillPolicy: {
    partialFillsAllowed: true,
    minPartialFillBps: 0,
    minRequestAmount: '0',
    maxRequestAmountPerWallet: '0',
    oneFillPerWallet: false
  }
};
const quote: SwapQuote = {
  source: 'chainwhisper',
  selection: 'best-single-order',
  sellAsset: COTI,
  buyAsset: WISP,
  requestedAmount: '1',
  amountMode: 'sell',
  estimatedSellAmount: '1',
  estimatedBuyAmount: '1.111111',
  order: identity,
  orderKind: 'one-off',
  recurringSide: null,
  appUrl: order.appUrl,
  coverage: {
    complete: true,
    visiblePublicLiquidityOnly: true,
    accountEligibilityChecked: false,
    excludes: ['private-liquidity', 'unlisted', 'direct']
  },
  observedAt: '2026-07-29T00:00:00.000Z'
};

const makeSource = (): ChainWhisperApiSource => ({
  getStatus: vi.fn(async (): Promise<ApiStatus> => ({
    service: 'chainwhisper-api',
    apiVersion: 'v1',
    network: { name: 'COTI Mainnet', chainId: 2_632_500 },
    ready: true,
    runtimeVerified: true,
    verificationScope: RUNTIME_VERIFICATION_SCOPE,
    observedAt: '2026-07-29T00:00:00.000Z',
    issueCode: null
  })),
  listOrders: vi.fn(async () => ({ items: [order], nextCursor: null })),
  getOrder: vi.fn(async () => order),
  getMarketReference: vi.fn(async (baseAsset, quoteAsset): Promise<MarketReference> => ({
    source: 'carbon',
    baseAsset,
    quoteAsset,
    price: '2',
    priceBasis: 'quote_per_base',
    observedAt: '2026-07-29T00:00:00.000Z',
    executable: false,
    usedPublicCounterparts: true,
    note: 'Reference only.'
  })),
  quoteBestSingleSwap: vi.fn(async () => quote)
});

describe('ChainWhisper API handler', () => {
  it('serves a catalog and OpenAPI document from the same route definitions', async () => {
    const handler = createChainWhisperApiHandler(makeSource());
    const catalogResponse = await handler(new Request('https://chainwhisper.chat/api/v1'));
    const catalog = await catalogResponse.json();
    expect(catalogResponse.status).toBe(200);
    expect(catalog.documentation).toBe(API_ROUTES.openapi.path);
    expect(catalog.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: API_ROUTES.swapQuote.id, path: API_ROUTES.swapQuote.path })
    ]));

    const openApiResponse = await handler(
      new Request('https://chainwhisper.chat/api/v1/openapi.json')
    );
    const openApi = await openApiResponse.json();
    expect(openApiResponse.status).toBe(200);
    expect(openApi.paths['/quote/swap'].post.operationId).toBe(API_ROUTES.swapQuote.id);
    expect(openApi.components.schemas.PublicOrder.properties.recipient).toBeDefined();
  });

  it('advertises a keyless read-only boundary', async () => {
    const response = await createChainWhisperApiHandler(makeSource())(
      new Request('https://chainwhisper.chat/api/v1/capabilities')
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.access).toEqual({ public: true, apiKeyRequired: false });
    expect(body.operations.writes).toEqual([]);
    expect(body.boundaries).toMatchObject({
      privateAmounts: false,
      executionCalldata: false,
      signing: false
    });
    expect(body.verificationScope).toMatchObject({
      privacyPortalRoutes: expect.arrayContaining(['coti', 'wisp']),
      privateTokenAssets: expect.arrayContaining(['p.COTI', 'p.WISP'])
    });
    expect(JSON.stringify(body)).not.toMatch(/privateKey|aesKey|accessSecret/iu);
  });

  it('validates bounded public-order reads', async () => {
    const source = makeSource();
    const handler = createChainWhisperApiHandler(source);
    const good = await handler(new Request('https://chainwhisper.chat/api/v1/orders?limit=5&cursor=0'));
    expect(good.status).toBe(200);
    expect(source.listOrders).toHaveBeenCalledWith({ limit: 5, cursor: 0 });

    const bad = await handler(new Request('https://chainwhisper.chat/api/v1/orders?limit=500'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'invalid_query' } });
  });

  it('maps an unavailable verified RPC read to 503', async () => {
    const source = makeSource();
    source.getOrder = vi.fn(async () => {
      throw new RpcUnavailableError();
    });
    const response = await createChainWhisperApiHandler(source)(
      new Request('https://chainwhisper.chat/api/v1/orders/standard/1')
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upstream_unavailable' } });
  });

  it('accepts verified private counterparts for a public market reference', async () => {
    const source = makeSource();
    const response = await createChainWhisperApiHandler(source)(
      new Request('https://chainwhisper.chat/api/v1/market-reference?base=p.WISP&quote=p.COTI')
    );
    expect(response.status).toBe(200);
    expect(source.getMarketReference).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'p.WISP' }),
      expect.objectContaining({ symbol: 'p.COTI' })
    );
  });

  it('keeps swap quote bodies strict and secret-free', async () => {
    const handler = createChainWhisperApiHandler(makeSource());
    const response = await handler(new Request('https://chainwhisper.chat/api/v1/quote/swap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sellAsset: 'COTI',
        buyAsset: 'WISP',
        amount: '1',
        amountMode: 'sell'
      })
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selection: 'best-single-order',
      coverage: { visiblePublicLiquidityOnly: true }
    });

    const rejected = await handler(new Request('https://chainwhisper.chat/api/v1/quote/swap', {
      method: 'POST',
      body: JSON.stringify({
        sellAsset: 'COTI',
        buyAsset: 'WISP',
        amount: '1',
        amountMode: 'sell',
        privateKey: 'never'
      })
    }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'invalid_body' } });
  });

  it('rejects amounts outside uint256 after applying decimals', async () => {
    const source = makeSource();
    const response = await createChainWhisperApiHandler(source)(
      new Request('https://chainwhisper.chat/api/v1/quote/swap', {
        method: 'POST',
        body: JSON.stringify({
          sellAsset: 'COTI',
          buyAsset: 'WISP',
          amount: ((1n << 256n) - 1n).toString(),
          amountMode: 'sell'
        })
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_amount' } });
    expect(source.quoteBestSingleSwap).not.toHaveBeenCalled();
  });

  it('rate limits only the expensive public quote route', async () => {
    const source = makeSource();
    const limiter = {
      limit: vi.fn(async () => ({ success: false }))
    };
    const handler = createChainWhisperApiHandler(source, limiter);
    const response = await handler(
      new Request('https://chainwhisper.chat/api/v1/quote/swap', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.5' },
        body: JSON.stringify({
          sellAsset: 'COTI',
          buyAsset: 'WISP',
          amount: '1',
          amountMode: 'sell'
        })
      })
    );
    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.5' });
    expect(source.quoteBestSingleSwap).not.toHaveBeenCalled();

    const status = await handler(new Request('https://chainwhisper.chat/api/v1/status'));
    expect(status.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });
});
