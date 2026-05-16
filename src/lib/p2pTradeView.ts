import { getPreferredBrowserWalletId } from './appStorage';
import {
  buildTradeSnapshotKey,
  COTI_NETWORK,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from './appShared';
import { formatTradeRatioLabel, isZeroTradeTakerAddress } from './tradePerspective';

export const WALLET_STATUS_STORAGE_KEY = 'coti-trade-last-wallet-id';
const TRADE_ACCESS_SECRET_STORAGE_KEY = 'coti-trade-access-secrets-v1';
const PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY = 'coti-private-trade-liquidity-v1';
const PRIVATE_LIQUIDITY_LABEL = 'Private liquidity';
const PUBLIC_LIQUIDITY_LABEL = 'Public liquidity';
const HYBRID_LIQUIDITY_LABEL = 'Hybrid liquidity';

const getTradeLiquidityLabel = (offer: TradeAssetPayload, request: TradeAssetPayload): string => {
  const privateSideCount = [offer, request].filter((asset) => asset.kind === 'private-erc20').length;
  if (privateSideCount === 2) {
    return PRIVATE_LIQUIDITY_LABEL;
  }
  if (privateSideCount === 1) {
    return HYBRID_LIQUIDITY_LABEL;
  }
  return PUBLIC_LIQUIDITY_LABEL;
};

type TradeContractNamespaceInput = {
  escrowContract?: string | null;
  recurringOrder?: { orderId: number } | null;
};

type TradeContractIdInput = TradeContractNamespaceInput & {
  tradeId: number;
};

export const getTradeContractNamespaceLabel = (trade: TradeContractNamespaceInput): string => {
  const normalizedContract = trade.escrowContract?.toLowerCase() ?? '';
  if (trade.recurringOrder || normalizedContract === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()) {
    return 'Recurring OTC';
  }
  if (normalizedContract === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return 'Private OTC';
  }
  if (normalizedContract === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return 'Direct OTC';
  }
  return 'P2P OTC';
};

export const formatTradeContractIdLabel = (trade: TradeContractIdInput): string => {
  const id = trade.recurringOrder?.orderId ?? trade.tradeId;
  return `${getTradeContractNamespaceLabel(trade)} #${id}`;
};

const normalizeStoredAccessSecret = (value?: string | null): string => {
  const secret = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/.test(secret) ? secret : '';
};

const readLegacyTradeBrowserWalletId = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(WALLET_STATUS_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export const readInitialTradeBrowserWalletId = (): string =>
  getPreferredBrowserWalletId() || readLegacyTradeBrowserWalletId();

export const buildOfferFromSnapshot = (snapshot: TradeSnapshot): TradeOfferMessagePayload => ({
  version: 2,
  tradeId: snapshot.tradeId,
  escrowContract: snapshot.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS,
  maker: snapshot.maker,
  taker: snapshot.taker,
  offer: snapshot.offer,
  request: snapshot.request,
  createdAt: snapshot.createdAt,
  expiresAt: snapshot.expiresAt,
  parentTradeId: snapshot.counterParentTradeId ?? undefined,
  hiddenLiquidity: getTradeTermsVisibility(snapshot) === 'hidden-liquidity'
});

export const isDirectWalletTrade = (trade: Pick<TradeSnapshot, 'taker'>): boolean =>
  !isZeroTradeTakerAddress(trade.taker);

export type TradeTermsVisibility = 'public' | 'direct-private-terms' | 'hidden-liquidity';

const isDirectEscrowTrade = (trade: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  trade.escrowContract?.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

export const getTradeTermsVisibility = (
  trade: Pick<TradeSnapshot, 'escrowContract' | 'hiddenLiquidity' | 'recurringOrder'>
): TradeTermsVisibility => {
  if (trade.recurringOrder) {
    return trade.recurringOrder.mode === 'public' ? 'public' : 'hidden-liquidity';
  }
  if (isDirectEscrowTrade(trade)) {
    return 'direct-private-terms';
  }
  return trade.hiddenLiquidity ? 'hidden-liquidity' : 'public';
};

export const isHiddenLiquidityTrade = (
  trade: Pick<TradeSnapshot, 'escrowContract' | 'hiddenLiquidity' | 'recurringOrder'>
): boolean => getTradeTermsVisibility(trade) === 'hidden-liquidity';

const hasPositiveAssetAmount = (asset?: Pick<TradeAssetPayload, 'amount'> | null): boolean => {
  const normalizedAmount = asset?.amount?.trim() ?? '';
  return /^\d+$/.test(normalizedAmount) && BigInt(normalizedAmount) > 0n;
};

export const hasHydratedDirectTradeTerms = (
  trade: Pick<TradeSnapshot, 'escrowContract' | 'offer' | 'request'>
): boolean =>
  isDirectEscrowTrade(trade) &&
  hasPositiveAssetAmount(trade.offer) &&
  hasPositiveAssetAmount(trade.request);

export const shouldRecoverMakerTradePayload = (
  trade: Pick<TradeSnapshot, 'escrowContract' | 'maker' | 'hasAccessHash' | 'offer' | 'request'>,
  walletKey: string,
  hasKnownAccessSecret: boolean
): boolean => {
  const normalizedWallet = walletKey.trim().toLowerCase();
  if (!normalizedWallet || trade.maker.toLowerCase() !== normalizedWallet) {
    return false;
  }

  const needsDirectTermHydration = isDirectEscrowTrade(trade) && !hasHydratedDirectTradeTerms(trade);
  if (!trade.hasAccessHash && !needsDirectTermHydration) {
    return false;
  }

  return !hasKnownAccessSecret || needsDirectTermHydration;
};

export const getRemainingRequestAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (isHiddenLiquidityTrade(trade)) {
      return BigInt(trade.request.amount);
    }
    return BigInt(trade.fillState?.remainingRequestAmount ?? trade.request.amount);
  } catch {
    return 0n;
  }
};

export const getRemainingOfferAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (isHiddenLiquidityTrade(trade)) {
      return BigInt(trade.offer.amount);
    }
    return BigInt(trade.fillState?.remainingOfferAmount ?? trade.offer.amount);
  } catch {
    return 0n;
  }
};

export const shouldBlockFillAboveVisibleLiquidity = (trade: TradeSnapshot, requestAmount: bigint | null): boolean => {
  if (requestAmount === null || requestAmount <= 0n || isHiddenLiquidityTrade(trade)) {
    return false;
  }

  return requestAmount > getRemainingRequestAmount(trade);
};

export const hasAnyTradeFill = (trade: TradeSnapshot): boolean => {
  if (isHiddenLiquidityTrade(trade)) {
    return false;
  }
  try {
    return BigInt(trade.fillState?.filledOfferAmount ?? '0') > 0n || BigInt(trade.fillState?.filledRequestAmount ?? '0') > 0n;
  } catch {
    return false;
  }
};

export const canEditPublicTrade = (trade: TradeSnapshot, walletKey: string): boolean =>
  Boolean(
    walletKey &&
      trade.status === 'open' &&
      (trade.isPublic === true ||
        trade.escrowContract?.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) &&
      trade.maker.toLowerCase() === walletKey &&
      !hasAnyTradeFill(trade)
  );

export const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const withTradeAssetAmount = (asset: TradeAssetPayload, amount: bigint): TradeAssetPayload => ({
  ...asset,
  amount: amount.toString()
});

export const getTradeDisplayTerms = (
  trade: TradeSnapshot
): { offer: TradeAssetPayload; request: TradeAssetPayload; usingRemaining: boolean } => {
  const usingRemaining = trade.status === 'open' && hasAnyTradeFill(trade) && getRemainingRequestAmount(trade) > 0n;
  return {
    offer: usingRemaining ? withTradeAssetAmount(trade.offer, getRemainingOfferAmount(trade)) : trade.offer,
    request: usingRemaining ? withTradeAssetAmount(trade.request, getRemainingRequestAmount(trade)) : trade.request,
    usingRemaining
  };
};

export const getTradeCompletionSummary = (
  trade: TradeSnapshot
): { percent: number; percentLabel: string; filledLabel: string; remainingLabel: string } | null => {
  if (!hasAnyTradeFill(trade)) {
    return null;
  }

  try {
    const filledRequestAmount = BigInt(trade.fillState?.filledRequestAmount ?? '0');
    const remainingRequestAmount = getRemainingRequestAmount(trade);
    const totalRequestAmount = filledRequestAmount + remainingRequestAmount;
    if (filledRequestAmount <= 0n || totalRequestAmount <= 0n) {
      return null;
    }

    const rawPercent = Number((filledRequestAmount * 10_000n) / totalRequestAmount) / 100;
    const percent = remainingRequestAmount === 0n ? 100 : Math.max(1, Math.min(99, rawPercent));
    return {
      percent,
      percentLabel: `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}% filled`,
      filledLabel: `${formatTokenAmount(filledRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol} filled`,
      remainingLabel: `${formatTokenAmount(remainingRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol} remaining`
    };
  } catch {
    return null;
  }
};

export const loadStoredTradeAccessSecrets = (): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRADE_ACCESS_SECRET_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    window.localStorage.removeItem(TRADE_ACCESS_SECRET_STORAGE_KEY);
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([tradeId, secret]) =>
          /^0x[a-fA-F0-9]{40}:\d+$/.test(tradeId) &&
          typeof secret === 'string' &&
          normalizeStoredAccessSecret(secret)
      )
    ) as Record<string, string>;
  } catch {
    try {
      window.localStorage.removeItem(TRADE_ACCESS_SECRET_STORAGE_KEY);
    } catch {
    }
    return {};
  }
};

const isStoredTokenAmount = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n;

const buildPrivateTradeLiquidityStorageKey = (walletKey?: string | null): string => {
  const normalizedWalletKey = walletKey?.trim().toLowerCase() ?? '';
  return normalizedWalletKey
    ? `${PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY}:${normalizedWalletKey}`
    : PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY;
};

const normalizeStoredPrivateTradeLiquidity = (parsed: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(parsed).filter(
      ([tradeKey, amount]) => /^0x[a-fA-F0-9]{40}:\d+$/.test(tradeKey) && isStoredTokenAmount(amount)
    )
  ) as Record<string, string>;

export const loadStoredPrivateTradeLiquidity = (walletKey?: string | null): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  const normalizedWalletKey = walletKey?.trim().toLowerCase() ?? '';
  if (!normalizedWalletKey) {
    return {};
  }

  try {
    // Older builds stored maker reveal context globally by trade. Drop that cache so a new wallet
    // never inherits a previous account's private-liquidity reveal.
    window.localStorage.removeItem(PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY);
    const parsed = JSON.parse(
      window.localStorage.getItem(buildPrivateTradeLiquidityStorageKey(normalizedWalletKey)) ?? '{}'
    ) as Record<string, unknown>;
    return normalizeStoredPrivateTradeLiquidity(parsed);
  } catch {
    return {};
  }
};

type MakerPrivateProgressSummary = {
  percent: number;
  percentLabel: string;
  headerValueLabel?: string;
  filledLabel: string;
  remainingLabel: string;
  totalLabel: string;
  totalAmountLabel?: string;
  filledAmountLabel?: string;
  remainingAmountLabel?: string;
  paymentAmountLabel?: string;
  paymentTotalLabel?: string;
  paymentHeaderValueLabel?: string;
  paymentFilledAmountLabel?: string;
  paymentRemainingAmountLabel?: string;
  hasFills?: boolean;
};

const quoteRequestAmountForOfferAmount = (
  offerAmountOut: bigint,
  offerUnitAmount: bigint,
  requestUnitAmount: bigint
): bigint => {
  if (offerAmountOut <= 0n || offerUnitAmount <= 0n || requestUnitAmount <= 0n) {
    return 0n;
  }

  return (offerAmountOut * requestUnitAmount + offerUnitAmount - 1n) / offerUnitAmount;
};

const parsePositiveTokenAmount = (value?: string): bigint => {
  if (!/^\d+$/.test(value ?? '')) {
    return 0n;
  }
  try {
    return BigInt(value ?? '0');
  } catch {
    return 0n;
  }
};

export const getMakerPrivateProgressSummary = (trade: TradeSnapshot): MakerPrivateProgressSummary | null => {
  if (!isHiddenLiquidityTrade(trade) || !trade.makerPrivateProgress) {
    return null;
  }

  try {
    const receiptFilledOfferAmount = (trade.privateFillReceipts ?? []).reduce((total, receipt) => {
      const amount = parsePositiveTokenAmount(receipt.offerAmount);
      return amount > 0n ? total + amount : total;
    }, 0n);
    const receiptFilledRequestAmount = (trade.privateFillReceipts ?? []).reduce((total, receipt) => {
      const amount = parsePositiveTokenAmount(receipt.requestAmount);
      return amount > 0n ? total + amount : total;
    }, 0n);
    const remainingOfferAmount = BigInt(trade.makerPrivateProgress.remainingOfferAmount);
    const initialOfferAmountRaw = trade.makerPrivateProgress.initialOfferAmount;
    const initialOfferAmount = initialOfferAmountRaw && /^\d+$/.test(initialOfferAmountRaw)
      ? BigInt(initialOfferAmountRaw)
      : null;
    const filledOfferAmount =
      initialOfferAmount !== null && initialOfferAmount >= remainingOfferAmount
        ? initialOfferAmount - remainingOfferAmount
        : trade.makerPrivateProgress.filledOfferAmount && /^\d+$/.test(trade.makerPrivateProgress.filledOfferAmount)
          ? BigInt(trade.makerPrivateProgress.filledOfferAmount)
          : receiptFilledOfferAmount > 0n
            ? receiptFilledOfferAmount
            : null;
    const inferredInitialOfferAmount =
      initialOfferAmount !== null
        ? initialOfferAmount
        : filledOfferAmount !== null
          ? filledOfferAmount + remainingOfferAmount
          : null;
    const returnedCancelledLiquidity =
      trade.status === 'cancelled' &&
      !trade.acceptedTxHash &&
      inferredInitialOfferAmount !== null &&
      inferredInitialOfferAmount > 0n &&
      remainingOfferAmount === 0n &&
      filledOfferAmount === inferredInitialOfferAmount;
    const displayFilledOfferAmount = returnedCancelledLiquidity ? 0n : filledOfferAmount;
    const displayRemainingOfferAmount = returnedCancelledLiquidity ? 0n : remainingOfferAmount;
    const percent =
      inferredInitialOfferAmount !== null && inferredInitialOfferAmount > 0n && displayFilledOfferAmount !== null
        ? Number((displayFilledOfferAmount * 10_000n) / inferredInitialOfferAmount) / 100
        : 0;
    const safePercent = Math.max(0, Math.min(100, percent));
    const offerUnitAmount = parsePositiveTokenAmount(trade.offer.amount);
    const requestUnitAmount = parsePositiveTokenAmount(trade.request.amount);
    const quotedFilledRequestAmount =
      displayFilledOfferAmount !== null
        ? quoteRequestAmountForOfferAmount(displayFilledOfferAmount, offerUnitAmount, requestUnitAmount)
        : 0n;
    const quotedRemainingRequestAmount = quoteRequestAmountForOfferAmount(
      displayRemainingOfferAmount,
      offerUnitAmount,
      requestUnitAmount
    );
    const quotedTotalRequestAmount =
      inferredInitialOfferAmount !== null
        ? quoteRequestAmountForOfferAmount(inferredInitialOfferAmount, offerUnitAmount, requestUnitAmount)
        : quotedFilledRequestAmount + quotedRemainingRequestAmount;
    const filledRequestAmount = quotedFilledRequestAmount > 0n ? quotedFilledRequestAmount : receiptFilledRequestAmount;
    const totalRequestAmount =
      quotedTotalRequestAmount > 0n
        ? quotedTotalRequestAmount
        : receiptFilledRequestAmount > 0n && trade.status === 'accepted'
          ? receiptFilledRequestAmount
          : 0n;
    const remainingRequestAmount =
      quotedTotalRequestAmount > 0n
        ? quotedRemainingRequestAmount
        : totalRequestAmount > filledRequestAmount
          ? totalRequestAmount - filledRequestAmount
          : 0n;
    const totalOfferAmountLabel =
      inferredInitialOfferAmount !== null
        ? `${formatTokenAmount(inferredInitialOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`
        : `${formatTokenAmount(remainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`;
    const filledOfferAmountLabel =
      displayFilledOfferAmount !== null
        ? `${formatTokenAmount(displayFilledOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`
        : '';
    const remainingOfferAmountLabel = `${formatTokenAmount(displayRemainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`;
    const totalRequestAmountLabel =
      totalRequestAmount > 0n
        ? `${formatTokenAmount(totalRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`
        : '';
    const filledRequestAmountLabel =
      filledRequestAmount > 0n || totalRequestAmount > 0n
        ? `${formatTokenAmount(filledRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`
        : '';
    const remainingRequestAmountLabel =
      remainingRequestAmount > 0n || totalRequestAmount > 0n
        ? `${formatTokenAmount(remainingRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`
        : '';

    return {
      percent: safePercent,
      percentLabel:
        inferredInitialOfferAmount !== null && filledOfferAmount !== null
          ? `${safePercent.toFixed(safePercent % 1 === 0 ? 0 : 1)}% filled`
          : 'Live remaining',
      filledLabel:
        filledOfferAmountLabel
          ? `${filledOfferAmountLabel} filled`
          : 'Filled amount private',
      remainingLabel: `${remainingOfferAmountLabel} remaining`,
      totalLabel: `${totalOfferAmountLabel}${inferredInitialOfferAmount !== null ? ' total' : ' current order'}`,
      totalAmountLabel: totalOfferAmountLabel,
      filledAmountLabel: filledOfferAmountLabel || undefined,
      remainingAmountLabel: remainingOfferAmountLabel,
      paymentAmountLabel: totalRequestAmountLabel || undefined,
      paymentTotalLabel: totalRequestAmountLabel ? `${totalRequestAmountLabel} order value` : undefined,
      paymentFilledAmountLabel: filledRequestAmountLabel || undefined,
      paymentRemainingAmountLabel: remainingRequestAmountLabel || undefined,
      hasFills: displayFilledOfferAmount !== null && displayFilledOfferAmount > 0n
    };
  } catch {
    return null;
  }
};

export const storePrivateTradeLiquidity = (amountsByTrade: Record<string, string>, walletKey?: string | null): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedWalletKey = walletKey?.trim().toLowerCase() ?? '';
  if (!normalizedWalletKey) {
    return;
  }

  window.localStorage.setItem(
    buildPrivateTradeLiquidityStorageKey(normalizedWalletKey),
    JSON.stringify(normalizeStoredPrivateTradeLiquidity(amountsByTrade))
  );
};

export const storeTradeAccessSecrets = (secrets: Record<string, string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  void secrets;
  window.localStorage.removeItem(TRADE_ACCESS_SECRET_STORAGE_KEY);
};

export const formatTradeExpiryParts = (expiresAt: number): { date: string; time: string; title: string } => {
  if (expiresAt <= 0) {
    return { date: 'No expiration', time: '', title: 'No expiration' };
  }

  const expiryDate = new Date(expiresAt * 1000);
  const isCurrentYear = expiryDate.getFullYear() === new Date().getFullYear();
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(isCurrentYear ? {} : { year: 'numeric' })
  }).format(expiryDate);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(expiryDate);

  return {
    date,
    time,
    title: formatMessageTimestamp(expiresAt)
  };
};

export const formatTradeListTerms = (trade: TradeSnapshot): string => {
  if (trade.recurringOrder) {
    const baseSymbol = trade.recurringOrder.baseAsset.symbol;
    const quoteSymbol = trade.recurringOrder.quoteAsset.symbol;
    return `Recurring OTC ${baseSymbol}/${quoteSymbol}; buy and sell sides reuse liquidity`;
  }
  const displayTerms = getTradeDisplayTerms(trade);
  const termsVisibility = getTradeTermsVisibility(trade);
  if (termsVisibility === 'hidden-liquidity') {
    return `${getTradeLiquidityLabel(displayTerms.offer, displayTerms.request)}; price ratio ${formatTradeRatioLabel(displayTerms.offer, displayTerms.request) ?? 'unavailable'}`;
  }
  if (termsVisibility === 'direct-private-terms' && !hasHydratedDirectTradeTerms(trade)) {
    return 'Direct offer with private terms';
  }
  return `${formatTradeAssetDisplayText(displayTerms.offer)} for ${formatTradeAssetDisplayText(displayTerms.request)}`;
};

export const formatHiddenFixedPriceTerms = (offer: TradeAssetPayload, request: TradeAssetPayload): string => {
  return formatTradeRatioLabel(offer, request) ?? `${request.symbol}/${offer.symbol}`;
};

export const formatTradeRateText = (baseAsset: TradeAssetPayload, quoteAsset: TradeAssetPayload): string => {
  return formatTradeRatioLabel(baseAsset, quoteAsset) ?? 'Rate unavailable';
};

export const buildTradeAssetExplorerUrl = (asset: TradeAssetPayload): string => {
  const tokenAddress = asset.tokenAddress?.trim();
  return tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/address/${tokenAddress}` : '';
};

export const buildTransactionExplorerUrl = (txHash?: string): string =>
  txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : '';

export const getTradeHistoryKindLabel = (trade: TradeSnapshot): string => {
  if (trade.recurringOrder) {
    return 'Recurring OTC order';
  }
  if (getTradeTermsVisibility(trade) === 'hidden-liquidity') {
    return getTradeLiquidityLabel(trade.offer, trade.request);
  }
  if (trade.counterParentTradeId) {
    return `Counter to #${trade.counterParentTradeId}`;
  }
  if (trade.replacesTradeId) {
    return `Edited from #${trade.replacesTradeId}`;
  }
  if (trade.replacementTradeId) {
    return `Replaced by #${trade.replacementTradeId}`;
  }
  return getTradeLiquidityLabel(trade.offer, trade.request);
};

export const getTradeHistoryOutcomeLabel = (trade: TradeSnapshot, statusLabel: string): string => {
  if (trade.status === 'accepted') {
    return trade.acceptedTxHash ? 'Accepted on-chain' : 'Accepted';
  }
  return statusLabel;
};

export const matchesTradeSearch = (trade: TradeSnapshot, query: string): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    String(trade.tradeId),
    trade.status,
    trade.offer.symbol,
    trade.request.symbol,
    `${trade.offer.symbol}/${trade.request.symbol}`,
    `${trade.offer.symbol} / ${trade.request.symbol}`,
    trade.offer.tokenAddress,
    trade.request.tokenAddress,
    trade.maker,
    trade.taker,
    trade.parentTradeId ? String(trade.parentTradeId) : '',
    trade.counterParentTradeId ? String(trade.counterParentTradeId) : '',
    trade.replacesTradeId ? String(trade.replacesTradeId) : '',
    trade.replacementTradeId ? String(trade.replacementTradeId) : '',
    trade.recurringOrder ? 'recurring otc' : '',
    trade.recurringOrder?.mode ?? '',
    trade.recurringOrder?.baseAsset.symbol ?? '',
    trade.recurringOrder?.quoteAsset.symbol ?? ''
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
};

export type TradeDeskTypeFilter =
  | 'all'
  | 'one-off'
  | 'recurring'
  | 'private'
  | 'private-liquidity'
  | 'private-link'
  | 'direct'
  | 'counter'
  | 'visible';
export type TradeDeskAccessFilter = 'all' | 'public' | 'private-link' | 'direct';
export type TradeDeskSortMode = 'newest' | 'oldest' | 'expiring' | 'most-active';
export type RecurringTerminalActionSide = 'buy' | 'sell';

export type TradeDeskFilterOptions = {
  search?: string;
  pair?: string;
  type?: TradeDeskTypeFilter;
  access?: TradeDeskAccessFilter;
  sort?: TradeDeskSortMode;
};

export const getTradePairSymbols = (trade: TradeSnapshot): { base: string; quote: string } => {
  if (trade.recurringOrder) {
    return {
      base: trade.recurringOrder.baseAsset.symbol,
      quote: trade.recurringOrder.quoteAsset.symbol
    };
  }
  return {
    base: trade.offer.symbol,
    quote: trade.request.symbol
  };
};

export const getTradePairFilterKey = (trade: TradeSnapshot): string => {
  const pair = getTradePairSymbols(trade);
  return [pair.base, pair.quote]
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join('/');
};

export const getTradePairFilterOptions = (
  trades: TradeSnapshot[]
): Array<{ value: string; label: string }> => {
  const pairs = new Map<string, string>();
  for (const trade of trades) {
    const key = getTradePairFilterKey(trade);
    if (!key || pairs.has(key)) {
      continue;
    }
    const { base, quote } = getTradePairSymbols(trade);
    pairs.set(key, `${base}/${quote}`);
  }

  return [
    { value: 'all', label: 'All pairs' },
    ...Array.from(pairs.entries())
      .sort(([, left], [, right]) => left.localeCompare(right))
      .map(([value, label]) => ({ value, label }))
  ];
};

export const getTradeAccessFilter = (trade: TradeSnapshot): Exclude<TradeDeskAccessFilter, 'all'> => {
  if (isDirectWalletTrade(trade)) {
    return 'direct';
  }
  if (trade.isPublic === false) {
    return 'private-link';
  }
  return 'public';
};

const tradeIsPrivate = (trade: TradeSnapshot): boolean => getTradeTermsVisibility(trade) !== 'public';
const tradeUsesPrivateLiquidity = (trade: TradeSnapshot): boolean =>
  getTradeTermsVisibility(trade) === 'hidden-liquidity';

const tradeMatchesDeskType = (trade: TradeSnapshot, filter: TradeDeskTypeFilter): boolean => {
  switch (filter) {
    case 'one-off':
      return !trade.recurringOrder;
    case 'recurring':
      return Boolean(trade.recurringOrder);
    case 'private':
      return tradeIsPrivate(trade);
    case 'private-liquidity':
      return tradeUsesPrivateLiquidity(trade);
    case 'private-link':
      return getTradeAccessFilter(trade) === 'private-link';
    case 'direct':
      return getTradeAccessFilter(trade) === 'direct';
    case 'counter':
      return Boolean(trade.counterParentTradeId || trade.parentTradeId);
    case 'visible':
      return !tradeIsPrivate(trade);
    default:
      return true;
  }
};

const getTradeActivityScore = (trade: TradeSnapshot): number => {
  if (trade.recurringOrder) {
    return trade.recurringOrder.executionCount;
  }
  if (hasAnyTradeFill(trade)) {
    return 1;
  }
  return trade.status === 'accepted' ? 1 : 0;
};

export const filterAndSortTradeDesk = (
  trades: TradeSnapshot[],
  options: TradeDeskFilterOptions = {}
): TradeSnapshot[] => {
  const pair = options.pair && options.pair !== 'all' ? options.pair : '';
  const type = options.type ?? 'all';
  const access = options.access ?? 'all';
  const sort = options.sort ?? 'newest';

  const filtered = trades.filter((trade) => {
    if (!matchesTradeSearch(trade, options.search ?? '')) {
      return false;
    }
    if (pair && getTradePairFilterKey(trade) !== pair) {
      return false;
    }
    if (!tradeMatchesDeskType(trade, type)) {
      return false;
    }
    if (access !== 'all' && getTradeAccessFilter(trade) !== access) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((left, right) => {
    if (sort === 'oldest') {
      return left.createdAt - right.createdAt || left.tradeId - right.tradeId;
    }
    if (sort === 'expiring') {
      const leftExpiry = left.expiresAt > 0 ? left.expiresAt : Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt > 0 ? right.expiresAt : Number.MAX_SAFE_INTEGER;
      return leftExpiry - rightExpiry || right.createdAt - left.createdAt;
    }
    if (sort === 'most-active') {
      return getTradeActivityScore(right) - getTradeActivityScore(left) || right.createdAt - left.createdAt;
    }
    return right.createdAt - left.createdAt || right.tradeId - left.tradeId;
  });
};

export const getRecurringTerminalSideState = (
  trade: TradeSnapshot,
  side: RecurringTerminalActionSide
): { isOpen: boolean; disabledLabel: string; inputLabel: string; actionLabel: string } => {
  const recurring = trade.recurringOrder;
  if (!recurring || recurring.recurringStatus !== 'active') {
    return {
      isOpen: false,
      disabledLabel: 'Order paused',
      inputLabel: side === 'buy' ? 'Budget' : 'Amount',
      actionLabel: side === 'buy' ? 'Buy' : 'Sell'
    };
  }

  if (side === 'buy') {
    return {
      isOpen: recurring.sellSideOpen,
      disabledLabel: 'No sell liquidity',
      inputLabel: `${recurring.quoteAsset.symbol} budget`,
      actionLabel: `Buy ${recurring.baseAsset.symbol}`
    };
  }

  return {
    isOpen: recurring.buySideOpen,
    disabledLabel: 'No buy liquidity',
    inputLabel: `${recurring.baseAsset.symbol} amount`,
    actionLabel: `Sell ${recurring.baseAsset.symbol}`
  };
};
