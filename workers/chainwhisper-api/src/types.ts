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
