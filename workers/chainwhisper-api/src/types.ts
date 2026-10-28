export type Address = `0x${string}`;
export type AssetKind = 'native' | 'erc20' | 'private-erc20';

export type VerifiedAsset = {
  id: string;
  symbol: string;
  kind: AssetKind;
  address: Address | null;
  decimals: number;
  publicCounterpartId: string | null;
};

export type PrivacyRoute = {
  id: string;
  bridgeAddress: Address;
  publicAssetId: string;
  privateAssetId: string;
  directions: readonly ['public-to-private', 'private-to-public'];
  provider: 'coti' | 'chainwhisper';
};

export type PublicOrderAsset = Pick<
  VerifiedAsset,
  'id' | 'symbol' | 'kind' | 'address' | 'decimals'
>;

export type PublicOrderIdentity = {
  escrowContract: Address;
  localId: string;
  handle: string;
};

export type PublicOrder = {
  identity: PublicOrderIdentity;
  kind: 'one-off' | 'recurring';
  orderType: {
    id: string;
    label: string;
  };
  status: 'open' | 'filled' | 'paused' | 'cancelled' | 'declined' | 'expired';
  access: 'public';
  liquidityVisibility: 'visible' | 'private';
  maker: Address;
  recipient: Address | null;
  offerAsset: PublicOrderAsset;
  requestAsset: PublicOrderAsset;
  offerAmount: string | null;
  requestAmount: string | null;
  remainingOfferAmount: string | null;
  remainingRequestAmount: string | null;
  price: string | null;
  priceBasis: 'quote_per_base';
  createdAt: string;
  expiresAt: string | null;
  appUrl: string | null;
  fillPolicy?: {
    partialFillsAllowed: boolean;
    minPartialFillBps: number;
    minRequestAmount: string;
    maxRequestAmountPerWallet: string;
    oneFillPerWallet: boolean;
  };
  recurring?: {
    baseAsset: PublicOrderAsset;
    quoteAsset: PublicOrderAsset;
    buyBaseAmount: string | null;
    buyQuoteAmount: string | null;
    sellBaseAmount: string | null;
    sellQuoteAmount: string | null;
    buyPrice: string | null;
    sellPrice: string | null;
    buyQuoteLiquidity: string | null;
    sellBaseLiquidity: string | null;
    buySideOpen: boolean;
    sellSideOpen: boolean;
    privateBaseInventory: boolean;
    privateQuoteInventory: boolean;
  };
};

export type OrdersPage = {
  items: PublicOrder[];
  nextCursor: string | null;
};

export type ApiStatus = {
  service: 'chainwhisper-api';
  apiVersion: 'v1';
  network: {
    name: 'COTI Mainnet';
    chainId: 2632500;
  };
  ready: boolean;
  runtimeVerified: boolean;
  verificationScope: {
    registry: true;
    publicOrderReads: readonly ['standardEscrow', 'privateEscrow', 'recurringEscrow', 'reader'];
    privacyPortalRoutes: readonly string[];
    privateTokenAssets: readonly string[];
    excluded: readonly ['directEscrow', 'historyReader', 'publicTokenContracts', 'carbonMarketData'];
  };
  observedAt: string;
  issueCode: 'rpc-unavailable' | 'wrong-network' | 'runtime-mismatch' | null;
};

export type MarketReference = {
  source: 'carbon';
  baseAsset: PublicOrderAsset;
  quoteAsset: PublicOrderAsset;
  price: string;
  priceBasis: 'quote_per_base';
  observedAt: string;
  executable: false;
  usedPublicCounterparts: boolean;
  note: string;
};

export type SwapQuoteInput = {
  sellAsset: VerifiedAsset;
  buyAsset: VerifiedAsset;
  amount: string;
  amountMode: 'sell' | 'buy';
};

export type SwapQuote = {
  source: 'chainwhisper';
  selection: 'best-single-order';
  sellAsset: PublicOrderAsset;
  buyAsset: PublicOrderAsset;
  requestedAmount: string;
  amountMode: 'sell' | 'buy';
  estimatedSellAmount: string;
  estimatedBuyAmount: string;
  order: PublicOrderIdentity;
  orderKind: 'one-off' | 'recurring';
  recurringSide: 'buy' | 'sell' | null;
  appUrl: string | null;
  coverage: {
    complete: true;
    visiblePublicLiquidityOnly: true;
    accountEligibilityChecked: false;
    excludes: readonly ['private-liquidity', 'unlisted', 'direct'];
  };
  observedAt: string;
};

export type PublicPrivateLiquidityPosition = {
  positionId: string;
  owner: Address;
  revision: string;
  createdAt: string;
  lastActivityBlock: string;
  buyTerms: { baseAmount: string; quoteAmount: string };
  sellTerms: { baseAmount: string; quoteAmount: string };
  buySideAvailable: boolean;
  sellSideAvailable: boolean;
};

export type PublicPrivateLiquidityPair = {
  protocol: 'PrivateLiquidityV2';
  network: 'COTI Testnet';
  chainId: 7_082_400;
  manifestHash: `0x${string}`;
  contractAddress: Address;
  pairKey: `0x${string}`;
  baseToken: Address;
  quoteToken: Address;
  atBlock: { number: string; hash: `0x${string}`; timestamp: string };
  complete: true;
  discoveredPositionCount: number;
  activeContributorCount: number;
  positions: PublicPrivateLiquidityPosition[];
  askRoute: { positionIds: string[]; expectedRevisions: string[] };
  bidRoute: { positionIds: string[]; expectedRevisions: string[] };
  hiddenIntentQueue: { openCount: string; cursor: string };
  privacyBoundary: {
    inventory: 'not-returned';
    hiddenIntentTerms: 'not-returned';
    hiddenIntentSelection: 'contract-selected-only';
  };
};

export interface PrivateLiquidityV2ApiSource {
  getPair(): Promise<PublicPrivateLiquidityPair>;
}

export type PublicPrivateLiquidityDailyPricePoint = {
  day: string;
  capturedAt: string;
  direction: 'base-to-quote' | 'quote-to-base';
  revision: string;
  price: {
    baseUnits: string;
    quoteUnits: string;
    basis: 'quote_per_base';
  };
  source: {
    blockNumber: string;
    blockHash: `0x${string}`;
    transactionHash: `0x${string}`;
    logIndex: number;
    swapId: string;
    positionId: string;
  };
};

export type PublicPrivateLiquidityDailyPricePage = {
  protocol: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1';
  network: 'COTI Testnet';
  chainId: 7_082_400;
  analyticsManifestHash: `0x${string}`;
  storeAddress: Address;
  sourceBook: Address;
  pairKey: `0x${string}`;
  atBlock: { number: string; hash: `0x${string}`; timestamp: string };
  totalCount: string;
  start: string;
  nextStart: string | null;
  completeRange: true;
  points: PublicPrivateLiquidityDailyPricePoint[];
  privacyBoundary: {
    publicFields: readonly ['daily-marginal-price', 'utc-day', 'source-provenance'];
    excluded: readonly ['liquidity-depth', 'inventory', 'traded-amounts', 'volume', 'participants'];
    recorderReplayVerifiedByApi: false;
  };
};

export interface PrivateLiquidityDailyPriceApiSource {
  getDailyPrices(input: {
    pairKey: `0x${string}`;
    start: number | null;
    limit: number;
  }): Promise<PublicPrivateLiquidityDailyPricePage>;
}

export type TestnetRegistryComponentSurface =
  | 'direct-chat'
  | 'group-chat'
  | 'chat-reactions'
  | 'direct-otc'
  | 'standard-otc'
  | 'private-otc'
  | 'recurring-otc'
  | 'private-recurring-otc'
  | 'private-liquidity-book'
  | 'private-liquidity-hidden-intents'
  | 'private-liquidity-position-nft'
  | 'public-test-token'
  | 'private-test-token';

export type TestnetRegistryEventPolicy = {
  publicIndexable: readonly string[];
  encryptedContentNotReturned: readonly string[];
  participantEncryptedNotReturned: readonly string[];
  catalogOnlyNotReturned: readonly string[];
  incomingDirectTradeNotification: readonly string[];
};

export type PublicTestnetRegistryComponent = {
  key: string;
  contract: string;
  surface: TestnetRegistryComponentSurface;
  address: Address;
  runtimeBytecodeHash: `0x${string}`;
  deploymentBlock: string;
  events: TestnetRegistryEventPolicy;
};

export type PublicTestnetRegistryV2 = {
  protocol: 'ChainWhisperTestnetRegistryV2';
  schemaVersion: 1;
  network: 'COTI Testnet';
  chainId: 7_082_400;
  manifestHash: `0x${string}`;
  owner: Address;
  attestationBlock: { number: string; hash: `0x${string}` };
  atBlock: { number: string; hash: `0x${string}`; timestamp: string };
  complete: true;
  components: readonly PublicTestnetRegistryComponent[];
  privacyBoundary: {
    eventDataReturned: false;
    ciphertextReturned: false;
    privateAmountsReturned: false;
    participantReceiptsReturned: false;
    hiddenIntentIdentifiersReturned: false;
    walletActivityReturned: false;
  };
  notificationPolicy: {
    incomingDirectTradesAndCounters: {
      componentKey: 'directOtcV2';
      eventName: 'DirectTradeOpened';
      recipientField: 'taker';
      counterWhenParentTradeIdNonzero: true;
    };
    otherTradingEvents: 'none';
  };
};

export interface TestnetRegistryV2ApiSource {
  getRegistry(): Promise<PublicTestnetRegistryV2>;
}

export interface ChainWhisperApiSource {
  getStatus(): Promise<ApiStatus>;
  listOrders(input: { cursor: number; limit: number }): Promise<OrdersPage>;
  getOrder(contract: string, localId: bigint): Promise<PublicOrder | null>;
  getMarketReference(baseAsset: VerifiedAsset, quoteAsset: VerifiedAsset): Promise<MarketReference | null>;
  quoteBestSingleSwap(input: SwapQuoteInput): Promise<SwapQuote | null>;
}

export class ApiFault extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
