import { API_VERSION } from './registry';

export const API_BASE_PATH = `/api/${API_VERSION}`;

export const API_ROUTES = {
  catalog: {
    id: 'getCatalog',
    method: 'GET',
    path: API_BASE_PATH,
    summary: 'Discover the public ChainWhisper Read API'
  },
  openapi: {
    id: 'getOpenApi',
    method: 'GET',
    path: `${API_BASE_PATH}/openapi.json`,
    summary: 'Read the OpenAPI document'
  },
  status: {
    id: 'getStatus',
    method: 'GET',
    path: `${API_BASE_PATH}/status`,
    summary: 'Check COTI RPC and the stated runtime verification scope'
  },
  capabilities: {
    id: 'getCapabilities',
    method: 'GET',
    path: `${API_BASE_PATH}/capabilities`,
    summary: 'List API boundaries, verified assets, contracts, and privacy routes'
  },
  orders: {
    id: 'listPublicOrders',
    method: 'GET',
    path: `${API_BASE_PATH}/orders`,
    summary: 'List a bounded page of public ChainWhisper orders'
  },
  order: {
    id: 'getPublicOrder',
    method: 'GET',
    path: `${API_BASE_PATH}/orders/{contract}/{localId}`,
    summary: 'Look up one public order on a verified contract'
  },
  marketReference: {
    id: 'getMarketReference',
    method: 'GET',
    path: `${API_BASE_PATH}/market-reference`,
    summary: 'Get a non-executable Carbon price reference for verified assets'
  },
  swapQuote: {
    id: 'quoteBestSingleOrderSwap',
    method: 'POST',
    path: `${API_BASE_PATH}/quote/swap`,
    summary: 'Select one complete visible public ChainWhisper order'
  }
} as const;

export const API_CATALOG = {
  service: 'chainwhisper-api',
  apiVersion: API_VERSION,
  readOnly: true,
  authentication: 'none',
  documentation: API_ROUTES.openapi.path,
  routes: Object.values(API_ROUTES)
} as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = {
  description: 'Secret-safe API error',
  content: { 'application/json': { schema: ref('Error') } }
};
const jsonResponse = (description: string, schema: unknown) => ({
  description,
  content: { 'application/json': { schema } }
});
const relativePath = (path: string): string => path.slice(API_BASE_PATH.length) || '/';

const assetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'symbol', 'kind', 'address', 'decimals'],
  properties: {
    id: { type: 'string' },
    symbol: { type: 'string' },
    kind: { enum: ['native', 'erc20', 'private-erc20'] },
    address: { anyOf: [{ type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' }, { type: 'null' }] },
    decimals: { type: 'integer', minimum: 0, maximum: 36 }
  }
};
const nullableDecimal = {
  anyOf: [{ type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' }, { type: 'null' }]
};

export const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'ChainWhisper Read API',
    version: '1.0.0-beta.0',
    description: 'Public, keyless ChainWhisper discovery and verified public reads. No signing or private data.'
  },
  servers: [{ url: `https://chainwhisper.chat${API_BASE_PATH}` }],
  paths: {
    [relativePath(API_ROUTES.catalog.path)]: {
      get: {
        operationId: API_ROUTES.catalog.id,
        summary: API_ROUTES.catalog.summary,
        responses: {
          '200': jsonResponse('API catalog', ref('Catalog')),
          '400': errorResponse,
          '405': errorResponse,
          '500': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.openapi.path)]: {
      get: {
        operationId: API_ROUTES.openapi.id,
        summary: API_ROUTES.openapi.summary,
        responses: {
          '200': jsonResponse('OpenAPI 3.1 document', { type: 'object' }),
          '400': errorResponse,
          '405': errorResponse,
          '500': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.status.path)]: {
      get: {
        operationId: API_ROUTES.status.id,
        summary: API_ROUTES.status.summary,
        responses: {
          '200': jsonResponse('Runtime ready', ref('Status')),
          '400': errorResponse,
          '405': errorResponse,
          '503': jsonResponse('Runtime unavailable or mismatched', ref('Status'))
        }
      }
    },
    [relativePath(API_ROUTES.capabilities.path)]: {
      get: {
        operationId: API_ROUTES.capabilities.id,
        summary: API_ROUTES.capabilities.summary,
        responses: {
          '200': jsonResponse('Capabilities', ref('Capabilities')),
          '400': errorResponse,
          '405': errorResponse,
          '500': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.orders.path)]: {
      get: {
        operationId: API_ROUTES.orders.id,
        summary: API_ROUTES.orders.summary,
        parameters: [
          {
            in: 'query',
            name: 'cursor',
            schema: { type: 'integer', minimum: 0, maximum: 1_000_000_000, default: 0 }
          },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
          }
        ],
        responses: {
          '200': jsonResponse('Public order page', ref('OrdersPage')),
          '400': errorResponse,
          '405': errorResponse,
          '503': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.order.path)]: {
      get: {
        operationId: API_ROUTES.order.id,
        summary: API_ROUTES.order.summary,
        parameters: [
          {
            in: 'path',
            name: 'contract',
            required: true,
            schema: {
              type: 'string',
              description: 'standard, private, recurring, or the corresponding verified address'
            }
          },
          {
            in: 'path',
            name: 'localId',
            required: true,
            schema: { type: 'string', pattern: '^[1-9][0-9]*$', maxLength: 78 }
          }
        ],
        responses: {
          '200': jsonResponse('Public order', ref('PublicOrder')),
          '400': errorResponse,
          '404': errorResponse,
          '405': errorResponse,
          '503': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.marketReference.path)]: {
      get: {
        operationId: API_ROUTES.marketReference.id,
        summary: API_ROUTES.marketReference.summary,
        parameters: [
          { in: 'query', name: 'base', required: true, schema: { type: 'string', maxLength: 96 } },
          { in: 'query', name: 'quote', required: true, schema: { type: 'string', maxLength: 96 } }
        ],
        responses: {
          '200': jsonResponse('Reference in quote-per-base basis', ref('MarketReference')),
          '400': errorResponse,
          '405': errorResponse,
          '503': errorResponse
        }
      }
    },
    [relativePath(API_ROUTES.swapQuote.path)]: {
      post: {
        operationId: API_ROUTES.swapQuote.id,
        summary: API_ROUTES.swapQuote.summary,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['sellAsset', 'buyAsset', 'amount', 'amountMode'],
                properties: {
                  sellAsset: { type: 'string', maxLength: 96 },
                  buyAsset: { type: 'string', maxLength: 96 },
                  amount: {
                    type: 'string',
                    maxLength: 80,
                    pattern: '^(?:0\\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\\.[0-9]+)?)$',
                    description: 'Positive decimal whose atomic value must fit uint256.'
                  },
                  amountMode: { enum: ['sell', 'buy'] }
                }
              }
            }
          }
        },
        responses: {
          '200': jsonResponse('Best complete single-order quote; never execution calldata', ref('SwapQuote')),
          '400': errorResponse,
          '404': errorResponse,
          '405': errorResponse,
          '409': errorResponse,
          '413': errorResponse,
          '429': errorResponse,
          '503': errorResponse
        }
      }
    }
  },
  components: {
    schemas: {
      Catalog: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'apiVersion', 'readOnly', 'authentication', 'documentation', 'routes'],
        properties: {
          service: { const: 'chainwhisper-api' },
          apiVersion: { const: 'v1' },
          readOnly: { const: true },
          authentication: { const: 'none' },
          documentation: { type: 'string' },
          routes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'method', 'path', 'summary'],
              properties: {
                id: { type: 'string' },
                method: { enum: ['GET', 'POST'] },
                path: { type: 'string' },
                summary: { type: 'string' }
              }
            }
          }
        }
      },
      VerificationScope: {
        type: 'object',
        additionalProperties: false,
        required: ['registry', 'publicOrderReads', 'privacyPortalRoutes', 'privateTokenAssets', 'excluded'],
        properties: {
          registry: { const: true },
          publicOrderReads: { type: 'array', items: { type: 'string' } },
          privacyPortalRoutes: { type: 'array', items: { type: 'string' } },
          privateTokenAssets: { type: 'array', items: { type: 'string' } },
          excluded: { type: 'array', items: { type: 'string' } }
        }
      },
      Status: {
        type: 'object',
        additionalProperties: false,
        required: [
          'service',
          'apiVersion',
          'network',
          'ready',
          'runtimeVerified',
          'verificationScope',
          'observedAt',
          'issueCode'
        ],
        properties: {
          service: { const: 'chainwhisper-api' },
          apiVersion: { const: 'v1' },
          network: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'chainId'],
            properties: {
              name: { const: 'COTI Mainnet' },
              chainId: { const: 2_632_500 }
            }
          },
          ready: { type: 'boolean' },
          runtimeVerified: { type: 'boolean' },
          verificationScope: ref('VerificationScope'),
          observedAt: { type: 'string', format: 'date-time' },
          issueCode: {
            anyOf: [
              { enum: ['rpc-unavailable', 'wrong-network', 'runtime-mismatch'] },
              { type: 'null' }
            ]
          }
        }
      },
      Asset: assetSchema,
      OrderIdentity: {
        type: 'object',
        additionalProperties: false,
        required: ['escrowContract', 'localId', 'handle'],
        properties: {
          escrowContract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          localId: { type: 'string', pattern: '^[1-9][0-9]*$' },
          handle: { type: 'string' }
        }
      },
      FillPolicy: {
        type: 'object',
        additionalProperties: false,
        required: [
          'partialFillsAllowed',
          'minPartialFillBps',
          'minRequestAmount',
          'maxRequestAmountPerWallet',
          'oneFillPerWallet'
        ],
        properties: {
          partialFillsAllowed: { type: 'boolean' },
          minPartialFillBps: { type: 'integer', minimum: 0, maximum: 5_000 },
          minRequestAmount: { type: 'string' },
          maxRequestAmountPerWallet: { type: 'string' },
          oneFillPerWallet: { type: 'boolean' }
        }
      },
      RecurringOrder: {
        type: 'object',
        additionalProperties: false,
        required: [
          'baseAsset',
          'quoteAsset',
          'buyBaseAmount',
          'buyQuoteAmount',
          'sellBaseAmount',
          'sellQuoteAmount',
          'buyPrice',
          'sellPrice',
          'buyQuoteLiquidity',
          'sellBaseLiquidity',
          'buySideOpen',
          'sellSideOpen',
          'privateBaseInventory',
          'privateQuoteInventory'
        ],
        properties: {
          baseAsset: ref('Asset'),
          quoteAsset: ref('Asset'),
          buyBaseAmount: nullableDecimal,
          buyQuoteAmount: nullableDecimal,
          sellBaseAmount: nullableDecimal,
          sellQuoteAmount: nullableDecimal,
          buyPrice: nullableDecimal,
          sellPrice: nullableDecimal,
          buyQuoteLiquidity: nullableDecimal,
          sellBaseLiquidity: nullableDecimal,
          buySideOpen: { type: 'boolean' },
          sellSideOpen: { type: 'boolean' },
          privateBaseInventory: { type: 'boolean' },
          privateQuoteInventory: { type: 'boolean' }
        }
      },
      PublicOrder: {
        type: 'object',
        additionalProperties: false,
        required: [
          'identity',
          'kind',
          'orderType',
          'status',
          'access',
          'liquidityVisibility',
          'maker',
          'recipient',
          'offerAsset',
          'requestAsset',
          'offerAmount',
          'requestAmount',
          'remainingOfferAmount',
          'remainingRequestAmount',
          'price',
          'priceBasis',
          'createdAt',
          'expiresAt',
          'appUrl'
        ],
        properties: {
          identity: ref('OrderIdentity'),
          kind: { enum: ['one-off', 'recurring'] },
          orderType: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label'],
            properties: { id: { type: 'string' }, label: { type: 'string' } }
          },
          status: { enum: ['open', 'filled', 'paused', 'cancelled', 'declined', 'expired'] },
          access: { const: 'public' },
          liquidityVisibility: { enum: ['visible', 'private'] },
          maker: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          recipient: {
            anyOf: [{ type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' }, { type: 'null' }]
          },
          offerAsset: ref('Asset'),
          requestAsset: ref('Asset'),
          offerAmount: nullableDecimal,
          requestAmount: nullableDecimal,
          remainingOfferAmount: nullableDecimal,
          remainingRequestAmount: nullableDecimal,
          price: nullableDecimal,
          priceBasis: { const: 'quote_per_base' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: {
            anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }]
          },
          appUrl: {
            anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }]
          },
          fillPolicy: ref('FillPolicy'),
          recurring: ref('RecurringOrder')
        }
      },
      OrdersPage: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: ref('PublicOrder') },
          nextCursor: {
            anyOf: [{ type: 'string', pattern: '^[1-9][0-9]*$' }, { type: 'null' }]
          }
        }
      },
      MarketReference: {
        type: 'object',
        additionalProperties: false,
        required: [
          'source',
          'baseAsset',
          'quoteAsset',
          'price',
          'priceBasis',
          'observedAt',
          'executable',
          'usedPublicCounterparts',
          'note'
        ],
        properties: {
          source: { const: 'carbon' },
          baseAsset: ref('Asset'),
          quoteAsset: ref('Asset'),
          price: { type: 'string' },
          priceBasis: { const: 'quote_per_base' },
          observedAt: { type: 'string', format: 'date-time' },
          executable: { const: false },
          usedPublicCounterparts: { type: 'boolean' },
          note: { type: 'string' }
        }
      },
      SwapQuote: {
        type: 'object',
        additionalProperties: false,
        required: [
          'source',
          'selection',
          'sellAsset',
          'buyAsset',
          'requestedAmount',
          'amountMode',
          'estimatedSellAmount',
          'estimatedBuyAmount',
          'order',
          'orderKind',
          'recurringSide',
          'appUrl',
          'coverage',
          'observedAt'
        ],
        properties: {
          source: { const: 'chainwhisper' },
          selection: { const: 'best-single-order' },
          sellAsset: ref('Asset'),
          buyAsset: ref('Asset'),
          requestedAmount: { type: 'string' },
          amountMode: { enum: ['sell', 'buy'] },
          estimatedSellAmount: { type: 'string' },
          estimatedBuyAmount: { type: 'string' },
          order: ref('OrderIdentity'),
          orderKind: { enum: ['one-off', 'recurring'] },
          recurringSide: {
            anyOf: [{ enum: ['buy', 'sell'] }, { type: 'null' }]
          },
          appUrl: {
            anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }]
          },
          coverage: {
            type: 'object',
            additionalProperties: false,
            required: [
              'complete',
              'visiblePublicLiquidityOnly',
              'accountEligibilityChecked',
              'excludes'
            ],
            properties: {
              complete: { const: true },
              visiblePublicLiquidityOnly: { const: true },
              accountEligibilityChecked: { const: false },
              excludes: {
                type: 'array',
                prefixItems: [
                  { const: 'private-liquidity' },
                  { const: 'unlisted' },
                  { const: 'direct' }
                ],
                minItems: 3,
                maxItems: 3
              }
            }
          },
          observedAt: { type: 'string', format: 'date-time' }
        }
      },
      Capabilities: {
        type: 'object',
        required: [
          'apiVersion',
          'registryVersion',
          'network',
          'access',
          'operations',
          'boundaries',
          'verificationScope',
          'contracts',
          'verifiedAssets',
          'privacyRoutes'
        ],
        properties: {
          apiVersion: { const: 'v1' },
          registryVersion: { type: 'string' },
          network: { type: 'object' },
          access: { type: 'object' },
          operations: { type: 'object' },
          boundaries: { type: 'object' },
          verificationScope: ref('VerificationScope'),
          contracts: { type: 'object' },
          verifiedAssets: { type: 'array', items: { type: 'object' } },
          privacyRoutes: { type: 'array', items: { type: 'object' } }
        }
      },
      Error: {
        type: 'object',
        additionalProperties: false,
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      }
    }
  }
} as const;
