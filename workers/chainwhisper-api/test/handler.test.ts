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
  PrivateLiquidityDailyPriceApiSource,
  PrivateLiquidityV2ApiSource,
  PublicPrivateLiquidityDailyPricePage,
  PublicPrivateLiquidityPair,
  PublicTestnetRegistryV2,
  PublicOrder,
  SwapQuote,
  TestnetRegistryV2ApiSource
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

const privateLiquidityPair: PublicPrivateLiquidityPair = {
  protocol: 'PrivateLiquidityV2',
  network: 'COTI Testnet',
  chainId: 7_082_400,
  manifestHash: `0x${'11'.repeat(32)}`,
  contractAddress: '0x1111111111111111111111111111111111111111',
  pairKey: `0x${'22'.repeat(32)}`,
  baseToken: '0x2222222222222222222222222222222222222222',
  quoteToken: '0x3333333333333333333333333333333333333333',
  atBlock: { number: '100', hash: `0x${'33'.repeat(32)}`, timestamp: '1800000000' },
  complete: true,
  discoveredPositionCount: 1,
  activeContributorCount: 1,
  positions: [{
    positionId: '1',
    owner: '0x4444444444444444444444444444444444444444',
    revision: '2',
    createdAt: '1799999999',
    lastActivityBlock: '99',
    buyTerms: { baseAmount: '1', quoteAmount: '10' },
    sellTerms: { baseAmount: '1', quoteAmount: '11' },
    buySideAvailable: true,
    sellSideAvailable: true
  }],
  askRoute: { positionIds: ['1'], expectedRevisions: ['2'] },
  bidRoute: { positionIds: ['1'], expectedRevisions: ['2'] },
  hiddenIntentQueue: { openCount: '1', cursor: '0' },
  privacyBoundary: {
    inventory: 'not-returned',
    hiddenIntentTerms: 'not-returned',
    hiddenIntentSelection: 'contract-selected-only'
  }
};

const privateLiquiditySource: PrivateLiquidityV2ApiSource = {
  getPair: vi.fn(async () => privateLiquidityPair)
};

const testnetRegistry: PublicTestnetRegistryV2 = {
  protocol: 'ChainWhisperTestnetRegistryV2',
  schemaVersion: 1,
  network: 'COTI Testnet',
  chainId: 7_082_400,
  manifestHash: `0x${'91'.repeat(32)}`,
  owner: '0x1111111111111111111111111111111111111111',
  attestationBlock: { number: '100', hash: `0x${'92'.repeat(32)}` },
  atBlock: { number: '105', hash: `0x${'93'.repeat(32)}`, timestamp: '1800000105' },
  complete: true,
  components: [],
  privacyBoundary: {
    eventDataReturned: false,
    ciphertextReturned: false,
    privateAmountsReturned: false,
    participantReceiptsReturned: false,
    hiddenIntentIdentifiersReturned: false,
    walletActivityReturned: false
  },
  notificationPolicy: {
    incomingDirectTradesAndCounters: {
      componentKey: 'directOtcV2',
      eventName: 'DirectTradeOpened',
      recipientField: 'taker',
      counterWhenParentTradeIdNonzero: true
    },
    otherTradingEvents: 'none'
  }
};

const testnetRegistrySource: TestnetRegistryV2ApiSource = {
  getRegistry: vi.fn(async () => testnetRegistry)
};

const dailyPricePage: PublicPrivateLiquidityDailyPricePage = {
  protocol: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
  network: 'COTI Testnet',
  chainId: 7_082_400,
  analyticsManifestHash: `0x${'44'.repeat(32)}`,
  storeAddress: '0x5555555555555555555555555555555555555555',
  sourceBook: privateLiquidityPair.contractAddress,
  pairKey: privateLiquidityPair.pairKey,
  atBlock: { number: '110', hash: `0x${'66'.repeat(32)}`, timestamp: '1800000110' },
  totalCount: '1',
  start: '0',
  nextStart: null,
  completeRange: true,
  points: [{
    day: '20832',
    capturedAt: '1799884860',
    direction: 'base-to-quote',
    revision: '1',
    price: { baseUnits: '1000000', quoteUnits: '1100000', basis: 'quote_per_base' },
    source: {
      blockNumber: '105',
      blockHash: `0x${'77'.repeat(32)}`,
      transactionHash: `0x${'88'.repeat(32)}`,
      logIndex: 0,
      swapId: '1',
      positionId: '2'
    }
  }],
  privacyBoundary: {
    publicFields: ['daily-marginal-price', 'utc-day', 'source-provenance'],
    excluded: ['liquidity-depth', 'inventory', 'traded-amounts', 'volume', 'participants'],
    recorderReplayVerifiedByApi: false
  }
};

const dailyPriceSource: PrivateLiquidityDailyPriceApiSource = {
  getDailyPrices: vi.fn(async () => dailyPricePage)
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
      expect.objectContaining({ id: API_ROUTES.swapQuote.id, path: API_ROUTES.swapQuote.path }),
      expect.objectContaining({
        id: API_ROUTES.testnetRegistryV2.id,
        path: API_ROUTES.testnetRegistryV2.path
      })
    ]));

    const openApiResponse = await handler(
      new Request('https://chainwhisper.chat/api/v1/openapi.json')
    );
    const openApi = await openApiResponse.json();
    expect(openApiResponse.status).toBe(200);
    expect(openApi.paths['/quote/swap'].post.operationId).toBe(API_ROUTES.swapQuote.id);
    expect(openApi.paths['/testnet/registry-v2'].get.operationId)
      .toBe(API_ROUTES.testnetRegistryV2.id);
    expect(openApi.components.schemas.PublicOrder.properties.recipient).toBeDefined();
  });

  it('serves the V2 registry only through the manifest-attested source and sanitizes failures', async () => {
    const unavailable = await createChainWhisperApiHandler(makeSource())(
      new Request(`https://chainwhisper.chat${API_ROUTES.testnetRegistryV2.path}`)
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: { code: 'testnet_registry_unavailable' }
    });

    const available = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      undefined,
      undefined,
      testnetRegistrySource
    )(new Request(`https://chainwhisper.chat${API_ROUTES.testnetRegistryV2.path}`));
    expect(available.status).toBe(200);
    expect(await available.json()).toEqual(testnetRegistry);

    const failing: TestnetRegistryV2ApiSource = {
      getRegistry: vi.fn(async () => {
        throw new Error('RPC host and deployment internals must not escape');
      })
    };
    const failure = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      undefined,
      undefined,
      failing
    )(new Request(`https://chainwhisper.chat${API_ROUTES.testnetRegistryV2.path}`));
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain('RPC host');
  });

  it('advertises a keyless read-only boundary', async () => {
    const response = await createChainWhisperApiHandler(makeSource())(
      new Request('https://chainwhisper.chat/api/v1/capabilities')
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.access).toEqual({ public: true, apiKeyRequired: false });
    expect(body.operations.writes).toEqual([]);
    expect(body.operations.testnetRegistryV2).toEqual([]);
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

    const withRegistry = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      undefined,
      undefined,
      testnetRegistrySource
    )(new Request('https://chainwhisper.chat/api/v1/capabilities'));
    const registryCapabilities = await withRegistry.json();
    expect(registryCapabilities.operations.testnetRegistryV2)
      .toEqual(['deployment-and-event-policy']);
    expect(registryCapabilities.boundaries).toMatchObject({
      rawEventData: false,
      encryptedEventContent: false,
      participantEncryptedReceipts: false
    });
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

  it('fails closed when the unified testnet candidate is absent and returns only the safe projection when present', async () => {
    const unavailable = await createChainWhisperApiHandler(makeSource())(
      new Request('https://chainwhisper.chat/api/v1/testnet/private-liquidity/pair')
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: { code: 'testnet_candidate_unavailable' }
    });

    const available = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      privateLiquiditySource
    )(new Request('https://chainwhisper.chat/api/v1/testnet/private-liquidity/pair'));
    const body = await available.json();
    expect(available.status).toBe(200);
    expect(body).toEqual(privateLiquidityPair);
    expect(JSON.stringify(body)).not.toMatch(/inventoryAmount|budget|minimumFill|intentId|privateTerms/iu);
  });

  it('fails closed without leaking verification errors when the testnet candidate read is not canonical', async () => {
    const failingSource = {
      getPair: vi.fn(async () => {
        throw new Error('sensitive upstream verification detail');
      })
    };
    const response = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      failingSource
    )(new Request('https://chainwhisper.chat/api/v1/testnet/private-liquidity/pair'));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'testnet_candidate_unavailable' } });
    expect(JSON.stringify(body)).not.toContain('sensitive upstream verification detail');
  });

  it('keeps daily-price history bounded, public-only, and separately activation-gated', async () => {
    const path = `https://chainwhisper.chat${API_ROUTES.privateLiquidityDailyPrices.path}`;
    const unavailable = await createChainWhisperApiHandler(makeSource())(
      new Request(`${path}?pairKey=${privateLiquidityPair.pairKey}`)
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: { code: 'testnet_analytics_unavailable' }
    });

    const available = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      privateLiquiditySource,
      dailyPriceSource
    )(new Request(`${path}?pairKey=${privateLiquidityPair.pairKey}&start=0&limit=90`));
    expect(available.status).toBe(200);
    expect(await available.json()).toEqual(dailyPricePage);
    expect(dailyPriceSource.getDailyPrices).toHaveBeenCalledWith({
      pairKey: privateLiquidityPair.pairKey,
      start: 0,
      limit: 90
    });

    const invalid = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      privateLiquiditySource,
      dailyPriceSource
    )(new Request(`${path}?pairKey=0x${'00'.repeat(32)}&limit=367`));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_query' } });
  });

  it('sanitizes a daily-price upstream outage without exposing RPC or secret details', async () => {
    const raw = 'https://testnet.invalid/rpc privateKey=never eth_getTransactionReceipt failed';
    const failingDailyPriceSource: PrivateLiquidityDailyPriceApiSource = {
      getDailyPrices: vi.fn(async () => { throw new Error(raw); })
    };
    const response = await createChainWhisperApiHandler(
      makeSource(),
      undefined,
      undefined,
      failingDailyPriceSource
    )(new Request(
      `https://chainwhisper.chat${API_ROUTES.privateLiquidityDailyPrices.path}?pairKey=0x${'12'.repeat(32)}`,
      { method: 'GET' }
    ));
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('testnet_analytics_unavailable');
    expect(body).not.toContain(raw);
    expect(body).not.toContain('privateKey');
    expect(body).not.toContain('eth_getTransactionReceipt');
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
