import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  BURNER_PIN_MIN_LENGTH,
  buildTradeSnapshotKey,
  createBurnerWalletVault,
  createCotiBrowserProvider,
  formatCotiAmount,
  formatExpiryCountdown,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  getCotiWsLastHealthyAt,
  getInjectedWalletOptions,
  getProviderErrorMessage,
  isWalletAddress,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  looksLikePrivateKeyInput,
  markCotiWsHealthyNow,
  mergeOnboardInfo,
  normalizeChainId,
  normalizeImportInput,
  normalizeMnemonicInput,
  normalizePrivateKeyInput,
  normalizeTokenDecimals,
  parseTokenAmountInput,
  parseBurnerWalletStorageState,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  rememberInjectedWalletProvider,
  resetCotiWsProvider,
  saveEncryptedBurnerWalletVault,
  sanitizeTokenAmountInput,
  shortenAddress,
  upsertBurnerWalletInVault,
  withTimeout,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS,
  type BurnerInitMode,
  type BurnerPinMode,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type TradeAssetPayload,
  type TradeFeeModeSelection,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import {
  fetchRecentTradeSnapshots,
  fetchTradeAccessMetadataById,
  fetchTradeSnapshotById,
  fetchWalletTradeSnapshots,
  readPrivateTradeRemainingOfferWei,
  readPrivateTokenBalanceWei
} from '../lib/appChain';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  getOnChainFailureMessage,
  isVerifiedEcosystemToken,
  resolveTradePresetKind,
  type ResolvedTradeToken,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import { deriveTradeComposerModel } from '../lib/tradeComposer';
import {
  acceptCounterTradeAndCloseParentOnChain,
  acceptTradeOnChain,
  cancelTradeOnChain,
  counterTradeAndCloseCounteredTradeOnChain,
  createTradeOnChain,
  declineTradeOnChain,
  editTradeOnChain,
  fillPrivateFixedPriceTradeOnChain,
  fillTradeOnChain,
  replacePrivateFixedPriceTradeOnChain
} from '../lib/tradeActions';
import { decodeTradeLink, encodeTradeLink } from '../lib/tradeLinks';
import {
  filterAllowedBrowserWalletOptions,
  isPreferredMetaMaskWalletOption,
  orderInjectedWalletOptions
} from '../lib/walletOptions';
import {
  formatTradeRatioLabel,
  groupWalletTradesByPerspective,
  isZeroTradeTakerAddress,
  resolveTradeOrderSummary,
  ZERO_TRADE_TAKER_ADDRESS
} from '../lib/tradePerspective';
import BurnerImportModal from './BurnerImportModal';
import BurnerPinModal from './BurnerPinModal';
import TradeComposerPanel from './TradeComposerPanel';
import TradeOfferCard from './TradeOfferCard';
import WalletHeaderPanel from './WalletHeaderPanel';

type TradePageView = 'public' | 'create' | 'trade' | 'mine';
type TradeVisibility = 'public' | 'unlisted' | 'direct';
type MyTradeGroupView = 'received' | 'active' | 'history';
type PendingBurnerWalletAction = 'connect' | 'generate' | 'import';

type P2PTradingPageProps = {
  onHeaderWalletControlChange?: (walletControl: ReactNode | null) => void;
  onHeaderNavigationControlChange?: (navigationControl: ReactNode | null) => void;
};

type TradeRouteState = {
  view: TradePageView;
  tradeId: number | null;
  escrowContract?: string;
  accessSecret: string;
  routeError: string;
};

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const WALLET_STATUS_STORAGE_KEY = 'coti-trade-last-wallet-id';
const TRADE_ACCESS_SECRET_STORAGE_KEY = 'coti-trade-access-secrets-v1';
const PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY = 'coti-private-trade-liquidity-v1';
const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;
const P2P_VISIBLE_SYNC_INTERVAL_MS = 10_000;
type TradeSigner = JsonRpcSigner | Wallet;

const normalizeTradePathname = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || '/';
};

const normalizeTradeSearch = (value: string): string => {
  if (!value.trim()) {
    return '';
  }
  return value.startsWith('?') ? value : `?${value}`;
};

const normalizeTradeHash = (value: string): string => value.replace(/^#/, '').trim();

const normalizeAccessSecret = (value?: string | null): string => {
  const secret = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/.test(secret) ? secret : '';
};

const resolveLegacyTradeSecret = (searchValue = '', hashValue = ''): string => {
  const searchSecret = new URLSearchParams(normalizeTradeSearch(searchValue)).get('secret')?.trim() ?? '';
  const normalizedHash = normalizeTradeHash(hashValue);
  const hashSecret =
    normalizedHash.startsWith('secret=')
      ? new URLSearchParams(normalizedHash).get('secret')?.trim() ?? ''
      : normalizedHash;
  return normalizeAccessSecret(searchSecret || hashSecret);
};

const resolveRouteEscrowContract = (searchValue = ''): string | undefined => {
  const params = new URLSearchParams(normalizeTradeSearch(searchValue));
  const raw = params.get('escrow')?.trim() || params.get('contract')?.trim() || '';
  if (!raw) {
    return undefined;
  }
  if (raw.toLowerCase() === 'private') {
    return PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  if (raw.toLowerCase() === 'v2') {
    return TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  return isWalletAddress(raw) ? raw : undefined;
};

const resolveTradeRouteFromParts = (pathnameValue: string, searchValue = '', hashValue = ''): TradeRouteState => {
  const pathname = normalizeTradePathname(pathnameValue);
  const lowerPathname = pathname.toLowerCase();
  const escrowContract = resolveRouteEscrowContract(searchValue);

  if (lowerPathname === '/trades/create') {
    return { view: 'create', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/mine') {
    return { view: 'mine', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/open') {
    return { view: 'trade', tradeId: null, accessSecret: '', routeError: '' };
  }

  const encodedMatch = pathname.match(/^\/trades\/l\/([^/?#]+)$/i);
  if (encodedMatch) {
    let linkCode = encodedMatch[1];
    try {
      linkCode = decodeURIComponent(linkCode);
    } catch {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    const decoded = decodeTradeLink(linkCode);
    if (!decoded) {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    return {
      view: 'trade',
      tradeId: decoded.tradeId,
      escrowContract,
      accessSecret: decoded.accessSecret ?? '',
      routeError: ''
    };
  }

  const legacyMatch = pathname.match(/^\/trades\/(\d+)$/i);
  if (legacyMatch) {
    const tradeId = Number.parseInt(legacyMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0
      ? { view: 'trade', tradeId, escrowContract, accessSecret: resolveLegacyTradeSecret(searchValue, hashValue), routeError: '' }
      : { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade id is not valid.' };
  }

  return { view: 'public', tradeId: null, accessSecret: '', routeError: '' };
};

const resolveTradeRouteFromLocation = (): TradeRouteState => {
  if (typeof window === 'undefined') {
    return { view: 'public', tradeId: null, accessSecret: '', routeError: '' };
  }

  const redirectedPath = new URLSearchParams(window.location.search).get('p');
  if (redirectedPath) {
    try {
      const redirectedUrl = new URL(redirectedPath, window.location.origin);
      return resolveTradeRouteFromParts(
        redirectedUrl.pathname,
        redirectedUrl.search || window.location.search,
        redirectedUrl.hash || window.location.hash
      );
    } catch {
      return resolveTradeRouteFromParts(redirectedPath, window.location.search, window.location.hash);
    }
  }

  return resolveTradeRouteFromParts(window.location.pathname, window.location.search, window.location.hash);
};

const buildOfferFromSnapshot = (snapshot: TradeSnapshot): TradeOfferMessagePayload => ({
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
  hiddenLiquidity: snapshot.hiddenLiquidity
});

const isPrivateTradeAsset = (asset?: Pick<TradeAssetPayload, 'kind'> | null): boolean => asset?.kind === 'private-erc20';

const isDirectWalletTrade = (trade: Pick<TradeSnapshot, 'taker'>): boolean => !isZeroTradeTakerAddress(trade.taker);

const getRemainingRequestAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (trade.hiddenLiquidity) {
      return BigInt(trade.request.amount);
    }
    return BigInt(trade.fillState?.remainingRequestAmount ?? trade.request.amount);
  } catch {
    return 0n;
  }
};

const getRemainingOfferAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (trade.hiddenLiquidity) {
      return BigInt(trade.offer.amount);
    }
    return BigInt(trade.fillState?.remainingOfferAmount ?? trade.offer.amount);
  } catch {
    return 0n;
  }
};

const hasAnyTradeFill = (trade: TradeSnapshot): boolean => {
  if (trade.hiddenLiquidity) {
    return false;
  }
  try {
    return BigInt(trade.fillState?.filledOfferAmount ?? '0') > 0n || BigInt(trade.fillState?.filledRequestAmount ?? '0') > 0n;
  } catch {
    return false;
  }
};

const canEditPublicTrade = (trade: TradeSnapshot, walletKey: string): boolean =>
  Boolean(
    walletKey &&
      trade.status === 'open' &&
      trade.isPublic === true &&
      trade.maker.toLowerCase() === walletKey &&
      !hasAnyTradeFill(trade)
  );

const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const withTradeAssetAmount = (asset: TradeAssetPayload, amount: bigint): TradeAssetPayload => ({
  ...asset,
  amount: amount.toString()
});

const quotePrivateRequestAmountForOffer = (
  offerAmountOut: bigint,
  offerUnitAmount: bigint,
  requestUnitAmount: bigint
): bigint => {
  if (offerAmountOut <= 0n || offerUnitAmount <= 0n || requestUnitAmount <= 0n) {
    return 0n;
  }

  return (offerAmountOut * requestUnitAmount + offerUnitAmount - 1n) / offerUnitAmount;
};

const getTradeDisplayTerms = (trade: TradeSnapshot): { offer: TradeAssetPayload; request: TradeAssetPayload; usingRemaining: boolean } => {
  const usingRemaining = trade.status === 'open' && hasAnyTradeFill(trade) && getRemainingRequestAmount(trade) > 0n;
  return {
    offer: usingRemaining ? withTradeAssetAmount(trade.offer, getRemainingOfferAmount(trade)) : trade.offer,
    request: usingRemaining ? withTradeAssetAmount(trade.request, getRemainingRequestAmount(trade)) : trade.request,
    usingRemaining
  };
};

const getTradeCompletionSummary = (
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

const createTradeAccessSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const loadStoredTradeAccessSecrets = (): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRADE_ACCESS_SECRET_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([tradeId, secret]) =>
          (/^\d+$/.test(tradeId) || /^0x[a-fA-F0-9]{40}:\d+$/.test(tradeId)) &&
          typeof secret === 'string' &&
          normalizeAccessSecret(secret)
      )
    ) as Record<string, string>;
  } catch {
    return {};
  }
};

const isStoredTokenAmount = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n;

const loadStoredPrivateTradeLiquidity = (): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([tradeKey, amount]) => /^0x[a-fA-F0-9]{40}:\d+$/.test(tradeKey) && isStoredTokenAmount(amount)
      )
    ) as Record<string, string>;
  } catch {
    return {};
  }
};

const getMakerPrivateProgressSummary = (
  trade: TradeSnapshot
): { percent: number; percentLabel: string; filledLabel: string; remainingLabel: string; totalLabel?: string } | null => {
  if (!trade.hiddenLiquidity || !trade.makerPrivateProgress) {
    return null;
  }

  try {
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
          : null;
    const percent =
      initialOfferAmount !== null && initialOfferAmount > 0n && filledOfferAmount !== null
        ? Number((filledOfferAmount * 10_000n) / initialOfferAmount) / 100
        : 0;
    const safePercent = Math.max(0, Math.min(100, percent));

    return {
      percent: safePercent,
      percentLabel:
        initialOfferAmount !== null && filledOfferAmount !== null
          ? `${safePercent.toFixed(safePercent % 1 === 0 ? 0 : 1)}% filled`
          : 'Live remaining',
      filledLabel:
        filledOfferAmount !== null
          ? `${formatTokenAmount(filledOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} filled`
          : 'Filled amount private',
      remainingLabel: `${formatTokenAmount(remainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} remaining`,
      totalLabel:
        initialOfferAmount !== null
          ? `${formatTokenAmount(initialOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} total`
          : `${formatTokenAmount(remainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} current liquidity`
    };
  } catch {
    return null;
  }
};

const storePrivateTradeLiquidity = (amountsByTrade: Record<string, string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY, JSON.stringify(amountsByTrade));
};

const storeTradeAccessSecrets = (secrets: Record<string, string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(TRADE_ACCESS_SECRET_STORAGE_KEY, JSON.stringify(secrets));
};

const sortTrades = (trades: TradeSnapshot[]): TradeSnapshot[] =>
  [...trades].sort((left, right) => {
    if (left.status === 'open' && right.status !== 'open') {
      return -1;
    }
    if (left.status !== 'open' && right.status === 'open') {
      return 1;
    }
    return right.tradeId - left.tradeId;
  });

const formatTradeExpiryParts = (expiresAt: number): { date: string; time: string; title: string } => {
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

const resolveTradeLinkInput = (value: string): { tradeId: number; escrowContract?: string; accessSecret?: string } | null => {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const decodedDirect = decodeTradeLink(raw);
  if (decodedDirect) {
    return decodedDirect;
  }

  const resolveFromRoute = (
    pathname: string,
    search = '',
    hash = ''
  ): { tradeId: number; escrowContract?: string; accessSecret?: string } | null => {
    const redirectedPath = new URLSearchParams(normalizeTradeSearch(search)).get('p');
    if (redirectedPath) {
      try {
        const redirectedUrl = new URL(redirectedPath, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
        return resolveFromRoute(redirectedUrl.pathname, redirectedUrl.search || search, redirectedUrl.hash || hash);
      } catch {
        return resolveFromRoute(redirectedPath, search, hash);
      }
    }

    const parsedRoute = resolveTradeRouteFromParts(pathname, search, hash);
    return parsedRoute.view === 'trade' && parsedRoute.tradeId
      ? {
          tradeId: parsedRoute.tradeId,
          escrowContract: parsedRoute.escrowContract,
          accessSecret: parsedRoute.accessSecret || undefined
        }
      : null;
  };

  try {
    const parsedUrl = new URL(raw, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
    const parsedFromUrl = resolveFromRoute(parsedUrl.pathname, parsedUrl.search, parsedUrl.hash);
    if (parsedFromUrl) {
      return parsedFromUrl;
    }
  } catch {
  }

  if (raw.startsWith('?') || raw.startsWith('p=')) {
    const parsedFromSearch = resolveFromRoute('/', raw.startsWith('?') ? raw : `?${raw}`);
    if (parsedFromSearch) {
      return parsedFromSearch;
    }
  }

  const parsedFromBarePath = resolveFromRoute(raw.startsWith('/') ? raw : `/${raw}`);
  if (parsedFromBarePath) {
    return parsedFromBarePath;
  }

  const legacyIdMatch = raw.match(/^#?(\d+)$/);
  if (legacyIdMatch) {
    const tradeId = Number.parseInt(legacyIdMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0 ? { tradeId } : null;
  }

  return null;
};

const formatTradeListTerms = (trade: TradeSnapshot): string => {
  const displayTerms = getTradeDisplayTerms(trade);
  if (trade.hiddenLiquidity) {
    return `Hidden liquidity; price ratio ${formatTradeRatioLabel(displayTerms.offer, displayTerms.request) ?? 'unavailable'}`;
  }
  return `${formatTradeAssetDisplayText(displayTerms.offer)} for ${formatTradeAssetDisplayText(displayTerms.request)}`;
};

const formatHiddenFixedPriceTerms = (offer: TradeAssetPayload, request: TradeAssetPayload): string => {
  return formatTradeRatioLabel(offer, request) ?? `${offer.symbol} / ${request.symbol}`;
};

const formatTradeRateText = (baseAsset: TradeAssetPayload, quoteAsset: TradeAssetPayload): string => {
  return formatTradeRatioLabel(baseAsset, quoteAsset) ?? 'Rate unavailable';
};

const formatTradeAmountInput = (asset: TradeAssetPayload): string => {
  try {
    return formatTokenAmount(BigInt(asset.amount), asset.decimals, 18);
  } catch {
    return '';
  }
};

const buildTradeAssetExplorerUrl = (asset: TradeAssetPayload): string => {
  const tokenAddress = asset.tokenAddress?.trim();
  return tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : '';
};

const buildTransactionExplorerUrl = (txHash?: string): string => (txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : '');

const matchesTradeSearch = (trade: TradeSnapshot, query: string): boolean => {
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
    trade.replacementTradeId ? String(trade.replacementTradeId) : ''
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
};

const resolveTradeAssetSelection = (
  asset: TradeAssetPayload
): { selection: TradeTokenPresetKey; customAddress: string } => {
  if (asset.kind === 'native') {
    return { selection: 'coti', customAddress: '' };
  }

  const tokenAddress = asset.tokenAddress?.trim() ?? '';
  if (tokenAddress.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'wisp', customAddress: '' };
  }
  if (tokenAddress.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'pwisp', customAddress: '' };
  }

  if (isVerifiedEcosystemToken(tokenAddress)) {
    return { selection: tokenAddress.toLowerCase(), customAddress: '' };
  }

  return {
    selection: asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public',
    customAddress: tokenAddress
  };
};

export default function P2PTradingPage({ onHeaderWalletControlChange, onHeaderNavigationControlChange }: P2PTradingPageProps) {
  const [route, setRoute] = useState<TradeRouteState>(() => resolveTradeRouteFromLocation());
  const [walletAddress, setWalletAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState(
    () => window.localStorage.getItem(WALLET_STATUS_STORAGE_KEY) ?? ''
  );
  const [connectingWalletId, setConnectingWalletId] = useState('');
  const [connectedWalletLabel, setConnectedWalletLabel] = useState('Wallet');
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>([]);
  const [selectedBurnerWalletId, setSelectedBurnerWalletId] = useState('');
  const [pendingBurnerWalletId, setPendingBurnerWalletId] = useState('');
  const [pendingBurnerAction, setPendingBurnerAction] = useState<PendingBurnerWalletAction>('connect');
  const [burnerPinMode, setBurnerPinMode] = useState<BurnerPinMode>('unlock');
  const [burnerPinInput, setBurnerPinInput] = useState('');
  const [burnerImportInput, setBurnerImportInput] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
  const [unlockingBurner, setUnlockingBurner] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [onboardInfoByAddress, setOnboardInfoByAddress] = useState<Record<string, OnboardInfo>>({});
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeVisibility, setTradeVisibility] = useState<TradeVisibility>('public');
  const [directTradeRecipient, setDirectTradeRecipient] = useState('');
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>('wisp');
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>('coti');
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradeExpiryHoursInput, setTradeExpiryHoursInput] = useState(DEFAULT_TRADE_EXPIRY_HOURS);
  const [tradeHidePrivateLiquidity, setTradeHidePrivateLiquidity] = useState(false);
  const [customTradeTokenInfoByAddress, setCustomTradeTokenInfoByAddress] = useState<Record<string, TradeCustomTokenInfo>>({});
  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenBalanceWei, setRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceWei, setPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState(FALLBACK_REWARD_TOKEN_SYMBOL);
  const [privateRewardTokenSymbol, setPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privateRewardTokenDecimals, setPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [tradeRequiredFeeWei, setTradeRequiredFeeWei] = useState<bigint | null>(null);
  const [publicTrades, setPublicTrades] = useState<TradeSnapshot[]>([]);
  const [myTrades, setMyTrades] = useState<TradeSnapshot[]>([]);
  const [detailTrade, setDetailTrade] = useState<TradeSnapshot | null>(null);
  const [loadingPublicTrades, setLoadingPublicTrades] = useState(false);
  const [loadingMyTrades, setLoadingMyTrades] = useState(false);
  const [loadingDetailTrade, setLoadingDetailTrade] = useState(false);
  const [tradeAccessBlocked, setTradeAccessBlocked] = useState(false);
  const [publicTradesError, setPublicTradesError] = useState('');
  const [myTradesError, setMyTradesError] = useState('');
  const [detailTradeError, setDetailTradeError] = useState('');
  const [tradeActionError, setTradeActionError] = useState('');
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [processingTradeActionId, setProcessingTradeActionId] = useState('');
  const [revealingPrivateTradeKey, setRevealingPrivateTradeKey] = useState('');
  const [createdTradeId, setCreatedTradeId] = useState<number | null>(null);
  const [createdTradeLink, setCreatedTradeLink] = useState('');
  const [lastCopiedKey, setLastCopiedKey] = useState('');
  const [tradeLinkInput, setTradeLinkInput] = useState('');
  const [tradeSearchInput, setTradeSearchInput] = useState('');
  const [myTradeGroupView, setMyTradeGroupView] = useState<MyTradeGroupView>('received');
  const [reversedRateTradeIds, setReversedRateTradeIds] = useState<Record<string, boolean>>({});
  const [knownTradeAccessSecrets, setKnownTradeAccessSecrets] = useState<Record<string, string>>(
    () => loadStoredTradeAccessSecrets()
  );
  const [knownPrivateLiquidityByTrade, setKnownPrivateLiquidityByTrade] = useState<Record<string, string>>(
    () => loadStoredPrivateTradeLiquidity()
  );
  const [counterParentTrade, setCounterParentTrade] = useState<TradeSnapshot | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeSnapshot | null>(null);
  const [injectedWalletOptions, setInjectedWalletOptions] = useState(() => getInjectedWalletOptions());

  const providerRef = useRef<Eip1193Provider | null>(null);
  const burnerWalletRef = useRef<Wallet | null>(null);
  const signerCacheRef = useRef<Record<string, TradeSigner>>({});
  const feeRequestRef = useRef<Promise<bigint> | null>(null);
  const counterPanelRef = useRef<HTMLDivElement | null>(null);
  const publicTradesRefreshRef = useRef<Promise<void> | null>(null);
  const myTradesRefreshRef = useRef<Promise<void> | null>(null);
  const publicTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedRef = useRef(false);

  const allowedBrowserWalletOptions = useMemo(
    () => filterAllowedBrowserWalletOptions(injectedWalletOptions),
    [injectedWalletOptions]
  );
  const browserWalletOptions = useMemo(
    () => orderInjectedWalletOptions(allowedBrowserWalletOptions, selectedWalletId, 'metamask'),
    [allowedBrowserWalletOptions, selectedWalletId]
  );
  const preferredWalletOption = useMemo(
    () => allowedBrowserWalletOptions.find(isPreferredMetaMaskWalletOption) ?? allowedBrowserWalletOptions[0] ?? null,
    [allowedBrowserWalletOptions]
  );
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const walletKey = walletAddress.trim().toLowerCase();
  const connectedWithBurner = Boolean(burnerWalletRef.current && walletKey === burnerWalletRef.current.address.toLowerCase());
  const walletHasAes = Boolean(walletKey && onboardInfoByAddress[walletKey]?.aesKey);
  const openPublicTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;
  const routeView = route.view;
  const routeTradeId = route.tradeId;
  const routeEscrowContract = route.escrowContract;
  const routeAccessSecret = route.accessSecret;
  const storedRouteAccessSecret =
    routeTradeId !== null
      ? knownTradeAccessSecrets[buildTradeSnapshotKey(routeTradeId, routeEscrowContract)] ??
        knownTradeAccessSecrets[String(routeTradeId)] ??
        ''
      : '';
  const resolvedRouteAccessSecret = routeAccessSecret || storedRouteAccessSecret;
  const routeError = route.routeError;
  const directTradeRecipientNormalized = directTradeRecipient.trim();
  const directTradeRecipientIsValid =
    directTradeRecipientNormalized.length > 0 && isWalletAddress(directTradeRecipientNormalized);

  const toggleTradeRateDirection = useCallback((tradeId: number, escrowContract?: string) => {
    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setReversedRateTradeIds((current) => ({
      ...current,
      [key]: !current[key]
    }));
  }, []);

  const navigateToTradePath = useCallback((path: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetUrl = new URL(path, window.location.origin);
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = targetUrl.pathname;
    nextUrl.search = targetUrl.search;
    nextUrl.hash = targetUrl.hash;
    window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setRoute(resolveTradeRouteFromLocation());
  }, []);

  const buildTradeShareUrl = useCallback((tradeId: number, accessSecret?: string, escrowContract?: string): string => {
    const code = encodeTradeLink(tradeId, accessSecret);
    const path = `/trades/l/${code}`;
    const search =
      escrowContract && escrowContract.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
        ? '?escrow=private'
        : '';
    if (typeof window === 'undefined') {
      return `${path}${search}`;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = path;
    nextUrl.search = search;
    nextUrl.hash = '';
    return nextUrl.toString();
  }, []);

  const rememberTradeAccessSecret = useCallback((tradeId: number, accessSecret?: string, escrowContract?: string) => {
    const normalizedSecret = normalizeAccessSecret(accessSecret);
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !normalizedSecret) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setKnownTradeAccessSecrets((previous) => {
      if (previous[key] === normalizedSecret) {
        return previous;
      }

      const next = {
        ...previous,
        [key]: normalizedSecret
      };
      storeTradeAccessSecrets(next);
      return next;
    });
  }, []);

  const rememberPrivateTradeLiquidity = useCallback((tradeId: number, escrowContract: string | undefined, amountWei: bigint) => {
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || amountWei <= 0n) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    const amount = amountWei.toString();
    setKnownPrivateLiquidityByTrade((previous) => {
      if (previous[key] === amount) {
        return previous;
      }

      const next = {
        ...previous,
        [key]: amount
      };
      storePrivateTradeLiquidity(next);
      return next;
    });
  }, []);

  const resolveKnownTradeAccessSecret = useCallback(
    (tradeId: number, escrowContract?: string): string =>
      knownTradeAccessSecrets[buildTradeSnapshotKey(tradeId, escrowContract)] ?? knownTradeAccessSecrets[String(tradeId)] ?? '',
    [knownTradeAccessSecrets]
  );

  const copyWithFeedback = useCallback(async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setLastCopiedKey(key);
    window.setTimeout(() => {
      setLastCopiedKey((current) => (current === key ? '' : current));
    }, 1400);
  }, []);

  const syncVisibleBurnerWallets = useCallback(() => {
    const storageState = parseBurnerWalletStorageState();
    if (storageState.kind === 'legacy') {
      setBurnerWallets([storageState.record]);
      return;
    }
    if (storageState.kind === 'legacy-vault') {
      setBurnerWallets(storageState.record.wallets);
      setSelectedBurnerWalletId(storageState.record.activeWalletId ?? storageState.record.wallets[0]?.id ?? '');
      return;
    }
    if (storageState.kind === 'none') {
      setBurnerWallets([]);
      setSelectedBurnerWalletId('');
    }
  }, []);

  useEffect(() => {
    syncVisibleBurnerWallets();
    const handleFocus = () => syncVisibleBurnerWallets();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [syncVisibleBurnerWallets]);

  const chooseBurnerPinMode = useCallback((): BurnerPinMode => {
    const storageState = parseBurnerWalletStorageState();
    return storageState.kind === 'encrypted' ? 'unlock' : 'set';
  }, []);

  const buildNewBurnerRecord = useCallback(async (mode: Exclude<BurnerInitMode, 'stored'>, seedOrPrivateKey = '') => {
    const cotiEthers = await loadCotiEthersModule();
    if (mode === 'generate') {
      const createdWallet = cotiEthers.Wallet.createRandom();
      return {
        privateKey: createdWallet.privateKey,
        mnemonic: createdWallet.mnemonic?.phrase
      } satisfies BurnerWalletRecord;
    }

    const normalizedSeed = normalizeImportInput(seedOrPrivateKey);
    if (!normalizedSeed) {
      throw new Error('Enter a mnemonic phrase or private key.');
    }

    const normalizedPrivateKey = normalizePrivateKeyInput(normalizedSeed);
    if (normalizedPrivateKey) {
      return { privateKey: normalizedPrivateKey } satisfies BurnerWalletRecord;
    }

    if (looksLikePrivateKeyInput(normalizedSeed)) {
      throw new Error('Invalid private key. Use exactly 64 hex characters, optionally prefixed with 0x.');
    }

    const normalizedMnemonic = normalizeMnemonicInput(normalizedSeed);
    try {
      const importedWallet = cotiEthers.Wallet.fromPhrase(normalizedMnemonic);
      return {
        privateKey: importedWallet.privateKey,
        mnemonic: normalizedMnemonic
      } satisfies BurnerWalletRecord;
    } catch {
      throw new Error('Invalid mnemonic phrase.');
    }
  }, []);

  const saveBurnerRecordWithPin = useCallback(
    async (record: BurnerWalletRecord, pin: string) => {
      const storageState = parseBurnerWalletStorageState();
      const existingVault =
        storageState.kind === 'none'
          ? null
          : await loadBurnerWalletVaultFromStorage(storageState.kind === 'encrypted' ? pin : '');
      const nextVault = existingVault
        ? await upsertBurnerWalletInVault(existingVault, record)
        : await createBurnerWalletVault([record]);
      await saveEncryptedBurnerWalletVault(nextVault, pin);
      return nextVault.activeWalletId;
    },
    []
  );

  const ensureCotiNetwork = useCallback(async (provider: Eip1193Provider) => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
    } catch (switchError) {
      const errorWithCode = switchError as { code?: number; message?: string };
      if (errorWithCode.code !== 4902) {
        throw new Error(errorWithCode.message ?? 'Could not switch to COTI network.');
      }

      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: COTI_NETWORK.chainIdHex,
            chainName: COTI_NETWORK.chainName,
            rpcUrls: [COTI_NETWORK.rpcUrl],
            blockExplorerUrls: [COTI_NETWORK.blockExplorerUrl],
            nativeCurrency: COTI_NETWORK.nativeCurrency
          }
        ]
      });
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
    }
  }, []);

  const attachWallet = useCallback(
    async (provider: Eip1193Provider, address: string, walletLabel: string, walletId?: string) => {
      providerRef.current = provider;
      setWalletAddress(address);
      setConnectedWalletLabel(walletLabel);
      if (walletId) {
        setSelectedWalletId(walletId);
        window.localStorage.setItem(WALLET_STATUS_STORAGE_KEY, walletId);
      }
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
      setChainId(normalizeChainId(currentChain));
    },
    [onboardInfoByAddress]
  );

  const onboardTradeWalletAes = useCallback(
    async (provider: Eip1193Provider, address: string): Promise<JsonRpcSigner> => {
      await ensureCotiNetwork(provider);

      const cacheKey = address.toLowerCase();
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(address, onboardInfoByAddress[cacheKey]);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (onboardInfoByAddress[cacheKey]) {
        signer.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
      }

      signer.disableAutoOnboard();
      let onboardInfo = signer.getUserOnboardInfo();
      if (!onboardInfo?.aesKey) {
        await signer.generateOrRecoverAes();
        onboardInfo = signer.getUserOnboardInfo();
      }

      if (!onboardInfo?.aesKey) {
        throw new Error('AES key was not returned during signing.');
      }

      setOnboardInfoByAddress((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      return signer;
    },
    [ensureCotiNetwork, onboardInfoByAddress]
  );

  const connectWallet = useCallback(
    async (walletId?: string, forceAccountPicker = false) => {
      const walletOption =
        (walletId ? browserWalletOptions.find((option) => option.id === walletId) ?? null : preferredWalletOption) ??
        preferredWalletOption;
      const provider = walletOption?.provider ?? null;
      const walletLabel = walletOption?.label ?? 'Wallet';

      setWalletError('');
      setTradeActionError('');
      setConnectingWalletId(walletOption?.id ?? 'wallet');

      if (!provider) {
        setWalletError('MetaMask or CypherTrade is required to connect a browser wallet.');
        setConnectingWalletId('');
        return;
      }

      try {
        if (forceAccountPicker) {
          await provider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
        const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
        const selected = accounts[0] ?? '';
        if (!selected) {
          throw new Error('No wallet account selected.');
        }
        await ensureCotiNetwork(provider);
        burnerWalletRef.current = null;
        await attachWallet(provider, selected, walletLabel, walletOption?.id);
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect wallet.'));
      } finally {
        setConnectingWalletId('');
      }
    },
    [attachWallet, browserWalletOptions, ensureCotiNetwork, preferredWalletOption]
  );

  const unlockBurnerWalletWithPin = useCallback(
    async (walletId?: string, pin = '') => {
      setWalletError('');
      setTradeActionError('');
      setConnectingWalletId('burner');
      setUnlockingBurner(true);

      try {
        const vault = await loadBurnerWalletVaultFromStorage(pin);
        const selectedRecord =
          vault.wallets.find((walletRecord) => walletRecord.id === walletId) ??
          vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ??
          vault.wallets[0];
        if (!selectedRecord) {
          throw new Error('No saved burner wallet found.');
        }

        const cotiEthers = await loadCotiEthersModule();
        const rpcProvider = new cotiEthers.JsonRpcProvider(COTI_NETWORK.rpcUrl, {
          name: COTI_NETWORK.chainName,
          chainId: COTI_NETWORK.chainIdDecimal
        });
        const signer = new cotiEthers.Wallet(selectedRecord.privateKey, rpcProvider);
        const cacheKey = signer.address.toLowerCase();
        const cachedOnboardInfo = onboardInfoByAddress[cacheKey];
        if (cachedOnboardInfo) {
          signer.setUserOnboardInfo(cachedOnboardInfo);
        }

        signer.disableAutoOnboard();
        let onboardInfo = signer.getUserOnboardInfo();
        if (!onboardInfo?.aesKey) {
          await signer.generateOrRecoverAes();
          onboardInfo = signer.getUserOnboardInfo();
        }
        if (!onboardInfo?.aesKey) {
          throw new Error('AES key was not returned for burner wallet.');
        }

        burnerWalletRef.current = signer;
        signerCacheRef.current[cacheKey] = signer;
        providerRef.current = null;
        setBurnerWallets(vault.wallets);
        setSelectedBurnerWalletId(selectedRecord.id ?? '');
        setWalletAddress(signer.address);
        setConnectedWalletLabel('App wallet');
        setSelectedWalletId('');
        setChainId(COTI_NETWORK.chainIdDecimal);
        setOnboardInfoByAddress((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
        setShowBurnerPinModal(false);
        setPendingBurnerWalletId('');
        setBurnerPinInput('');
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect app wallet.'));
      } finally {
        setUnlockingBurner(false);
        setConnectingWalletId('');
      }
    },
    [onboardInfoByAddress]
  );

  const connectBurnerWallet = useCallback(
    async (walletId?: string) => {
      setWalletError('');
      setTradeActionError('');
      const storageState = parseBurnerWalletStorageState();
      if (storageState.kind === 'none') {
        setWalletError('No saved app wallet found. Generate or import one from the wallet panel first.');
        return;
      }

      if (storageState.kind === 'encrypted') {
        setPendingBurnerAction('connect');
        setPendingBurnerWalletId(walletId ?? '');
        setBurnerPinMode('unlock');
        setBurnerPinInput('');
        setShowBurnerPinModal(true);
        return;
      }

      await unlockBurnerWalletWithPin(walletId, '');
    },
    [unlockBurnerWalletWithPin]
  );

  const beginGenerateBurnerWallet = useCallback(() => {
    setWalletError('');
    setTradeActionError('');
    setPendingBurnerAction('generate');
    setPendingBurnerWalletId('');
    setBurnerPinMode(chooseBurnerPinMode());
    setBurnerPinInput('');
    setWalletMenuOpen(false);
    setShowBurnerPinModal(true);
  }, [chooseBurnerPinMode]);

  const beginImportBurnerWallet = useCallback(() => {
    setWalletError('');
    setTradeActionError('');
    setBurnerImportInput('');
    setWalletMenuOpen(false);
    setShowBurnerImportModal(true);
  }, []);

  const submitBurnerImport = useCallback(async () => {
    setWalletError('');
    setPendingBurnerAction('import');
    setPendingBurnerWalletId('');
    setBurnerPinMode(chooseBurnerPinMode());
    setBurnerPinInput('');
    setShowBurnerImportModal(false);
    setShowBurnerPinModal(true);
  }, [chooseBurnerPinMode]);

  const closeBurnerPinModal = useCallback(() => {
    if (unlockingBurner) {
      return;
    }
    setShowBurnerPinModal(false);
    setPendingBurnerAction('connect');
    setPendingBurnerWalletId('');
    setBurnerPinInput('');
  }, [unlockingBurner]);

  const submitBurnerPin = useCallback(async () => {
    const pin = burnerPinInput.trim();
    if (pin.length < BURNER_PIN_MIN_LENGTH) {
      setWalletError(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
      return;
    }

    if (pendingBurnerAction === 'connect') {
      await unlockBurnerWalletWithPin(pendingBurnerWalletId || undefined, pin);
      return;
    }

    setUnlockingBurner(true);
    setConnectingWalletId('burner');
    try {
      const record = await buildNewBurnerRecord(
        pendingBurnerAction === 'generate' ? 'generate' : 'import',
        burnerImportInput
      );
      const walletId = await saveBurnerRecordWithPin(record, pin);
      await unlockBurnerWalletWithPin(walletId, pin);
      setShowBurnerImportModal(false);
      setPendingBurnerAction('connect');
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'Failed to save burner wallet.'));
    } finally {
      setUnlockingBurner(false);
      setConnectingWalletId('');
    }
  }, [
    buildNewBurnerRecord,
    burnerImportInput,
    burnerPinInput,
    pendingBurnerAction,
    pendingBurnerWalletId,
    saveBurnerRecordWithPin,
    unlockBurnerWalletWithPin
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const refreshInjectedWalletOptions = () => {
      setInjectedWalletOptions(getInjectedWalletOptions());
    };
    const handleProviderAnnouncement = (event: Event) => {
      const detail = (
        event as CustomEvent<{ provider?: Eip1193Provider; info?: { name?: string; rdns?: string; uuid?: string } }>
      ).detail;
      rememberInjectedWalletProvider(detail?.provider, detail?.info);
      refreshInjectedWalletOptions();
    };

    refreshInjectedWalletOptions();
    window.addEventListener('ethereum#initialized', refreshInjectedWalletOptions);
    window.addEventListener('eip6963:announceProvider', handleProviderAnnouncement);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const refreshTimers = [250, 1000, 2500].map((delay) => window.setTimeout(refreshInjectedWalletOptions, delay));

    return () => {
      window.removeEventListener('ethereum#initialized', refreshInjectedWalletOptions);
      window.removeEventListener('eip6963:announceProvider', handleProviderAnnouncement);
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (providerRef.current || walletAddress || connectingWalletId || !preferredWalletOption?.provider?.request) {
      return;
    }

    let cancelled = false;
    const restoreAuthorizedWallet = async () => {
      try {
        const accounts = (await preferredWalletOption.provider.request({ method: 'eth_accounts' })) as string[];
        const selected = accounts[0] ?? '';
        if (cancelled || !selected) {
          return;
        }

        await attachWallet(preferredWalletOption.provider, selected, preferredWalletOption.label, preferredWalletOption.id);
        setWalletError('');
      } catch {
      }
    };

    restoreAuthorizedWallet();
    return () => {
      cancelled = true;
    };
  }, [attachWallet, connectingWalletId, preferredWalletOption, walletAddress]);

  const getTradeSigner = useCallback(
    async (requireAes: boolean): Promise<TradeSigner> => {
      const burnerSigner = burnerWalletRef.current;
      if (burnerSigner && walletAddress && burnerSigner.address.toLowerCase() === walletAddress.toLowerCase()) {
        const cacheKey = burnerSigner.address.toLowerCase();
        if (onboardInfoByAddress[cacheKey]) {
          burnerSigner.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
        }
        burnerSigner.disableAutoOnboard();
        if (requireAes && !burnerSigner.getUserOnboardInfo()?.aesKey) {
          await burnerSigner.generateOrRecoverAes();
        }
        const onboardInfo = burnerSigner.getUserOnboardInfo();
        if (onboardInfo?.aesKey) {
          setOnboardInfoByAddress((previous) => ({
            ...previous,
            [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
          }));
        }
        return burnerSigner;
      }

      const provider = providerRef.current;
      if (!provider || !walletAddress) {
        throw new Error('Connect a wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        await ensureCotiNetwork(provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const cacheKey = walletAddress.toLowerCase();
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(walletAddress, onboardInfoByAddress[cacheKey]);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (onboardInfoByAddress[cacheKey]) {
        signer.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
      }

      signer.disableAutoOnboard();
      if (requireAes && !signer.getUserOnboardInfo()?.aesKey) {
        await signer.generateOrRecoverAes();
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setOnboardInfoByAddress((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
      }

      return signer;
    },
    [chainId, connectedWalletLabel, ensureCotiNetwork, onboardInfoByAddress, walletAddress]
  );

  const resolveRequiredFeeForTradeCreate = useCallback(async (): Promise<bigint> => {
    if (tradeRequiredFeeWei !== null) {
      return tradeRequiredFeeWei;
    }

    if (!feeRequestRef.current) {
      feeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
        return (await readContract.feeAmount()) as bigint;
      })();
    }

    try {
      const fee = await feeRequestRef.current;
      setTradeRequiredFeeWei(fee);
      return fee;
    } finally {
      feeRequestRef.current = null;
    }
  }, [tradeRequiredFeeWei]);

  const enrichMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      if (!snapshot.hiddenLiquidity || !walletKey || snapshot.maker.toLowerCase() !== walletKey) {
        return snapshot;
      }
      if (!forceReveal && !walletHasAes) {
        return snapshot;
      }

      const tradeKey = getSnapshotKey(snapshot);
      const knownInitialAmount = knownPrivateLiquidityByTrade[tradeKey];
      try {
        const signer = await getTradeSigner(forceReveal);
        const remainingOfferAmount = await readPrivateTradeRemainingOfferWei({
          tradeId: snapshot.tradeId,
          escrowContract: snapshot.escrowContract,
          makerAddress: snapshot.maker,
          signer
        });
        if (remainingOfferAmount === null) {
          return snapshot;
        }

        let filledOfferAmount: string | undefined;
        if (knownInitialAmount && /^\d+$/.test(knownInitialAmount)) {
          const initial = BigInt(knownInitialAmount);
          filledOfferAmount = initial >= remainingOfferAmount ? (initial - remainingOfferAmount).toString() : '0';
        }

        return {
          ...snapshot,
          makerPrivateProgress: {
            initialOfferAmount: knownInitialAmount,
            remainingOfferAmount: remainingOfferAmount.toString(),
            filledOfferAmount
          }
        };
      } catch {
        return snapshot;
      }
    },
    [getTradeSigner, knownPrivateLiquidityByTrade, walletHasAes, walletKey]
  );

  const enrichMakerPrivateProgressForList = useCallback(
    async (snapshots: TradeSnapshot[]): Promise<TradeSnapshot[]> =>
      Promise.all(snapshots.map((snapshot) => enrichMakerPrivateProgress(snapshot))),
    [enrichMakerPrivateProgress]
  );

  const refreshPublicTrades = useCallback(async () => {
    if (publicTradesRefreshRef.current) {
      publicTradesRefreshQueuedRef.current = true;
      return publicTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        publicTradesRefreshQueuedRef.current = false;
        setLoadingPublicTrades(true);
        setPublicTradesError('');
        try {
          const snapshots = await fetchRecentTradeSnapshots({
            rewardTokenSymbol,
            rewardTokenDecimals,
            privateRewardTokenSymbol,
            privateRewardTokenDecimals,
            limit: 80
          });
          setPublicTrades(sortTrades(snapshots));
        } catch {
          setPublicTradesError('Failed to load public trades.');
        } finally {
          setLoadingPublicTrades(false);
        }
      } while (publicTradesRefreshQueuedRef.current);

      publicTradesRefreshRef.current = null;
    })();

    publicTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]);

  const refreshMyTrades = useCallback(async () => {
    if (!walletAddress) {
      setMyTrades([]);
      return;
    }
    if (myTradesRefreshRef.current) {
      myTradesRefreshQueuedRef.current = true;
      return myTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        myTradesRefreshQueuedRef.current = false;
        setLoadingMyTrades(true);
        setMyTradesError('');
        try {
          const snapshotsRaw = await fetchWalletTradeSnapshots(walletAddress, {
            rewardTokenSymbol,
            rewardTokenDecimals,
            privateRewardTokenSymbol,
            privateRewardTokenDecimals,
            limit: 80
          });
          const snapshots = await enrichMakerPrivateProgressForList(snapshotsRaw);
          setMyTrades(sortTrades(snapshots));
        } catch {
          setMyTradesError('Failed to load your trades.');
        } finally {
          setLoadingMyTrades(false);
        }
      } while (myTradesRefreshQueuedRef.current);

      myTradesRefreshRef.current = null;
    })();

    myTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress
  ]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot) => {
      const snapshotKey = getSnapshotKey(snapshot);
      setDetailTrade((current) => (current && getSnapshotKey(current) === snapshotKey ? snapshot : current));
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
        if (snapshot.isPublic && snapshot.status === 'open') {
          return sortTrades([snapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      if (walletKey && [snapshot.maker.toLowerCase(), snapshot.taker.toLowerCase()].includes(walletKey)) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
          return sortTrades([snapshot, ...withoutCurrent]);
        });
      }
    },
    [walletKey]
  );

  const refreshTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string): Promise<TradeSnapshot | null> => {
      const snapshotRaw = await fetchTradeSnapshotById(tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        escrowContract
      });
      const snapshot = await enrichMakerPrivateProgress(snapshotRaw);
      mergeTradeSnapshot(snapshot);
      return snapshot;
    },
    [
      enrichMakerPrivateProgress,
      mergeTradeSnapshot,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol
    ]
  );

  const revealMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot) => {
      const tradeKey = getSnapshotKey(snapshot);
      setTradeActionError('');
      try {
        setRevealingPrivateTradeKey(tradeKey);
        const revealedSnapshot = await enrichMakerPrivateProgress(snapshot, true);
        if (!revealedSnapshot.makerPrivateProgress) {
          throw new Error('Unable to reveal this trade liquidity. Make sure this is your trade and your wallet AES key is available.');
        }
        mergeTradeSnapshot(revealedSnapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reveal this trade liquidity.';
        setTradeActionError(message);
      } finally {
        setRevealingPrivateTradeKey('');
      }
    },
    [enrichMakerPrivateProgress, mergeTradeSnapshot]
  );

  const openTrade = useCallback(
    (tradeId: number, accessSecret?: string, escrowContract?: string) => {
      const code = encodeTradeLink(tradeId, accessSecret);
      const search =
        escrowContract && escrowContract.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
          ? '?escrow=private'
          : '';
      navigateToTradePath(`/trades/l/${code}${search}`);
    },
    [navigateToTradePath]
  );

  const openTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot, accessSecret?: string) => {
      const knownAccessSecret =
        accessSecret ||
        (snapshot.isPublic === false || snapshot.hasAccessHash
          ? resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract)
          : '');
      setDetailTrade(snapshot);
      openTrade(snapshot.tradeId, knownAccessSecret || undefined, snapshot.escrowContract);
    },
    [openTrade, resolveKnownTradeAccessSecret]
  );

  const openTradeFromInput = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const parsedLink = resolveTradeLinkInput(tradeLinkInput);
      if (!parsedLink) {
        setDetailTradeError(tradeLinkInput.trim() ? 'Paste a valid trade link, compact code, or trade id.' : '');
        setRoute({ view: 'trade', tradeId: null, accessSecret: '', routeError: '' });
        return;
      }

      setDetailTradeError('');
      rememberTradeAccessSecret(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      openTrade(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      setTradeLinkInput('');
    },
    [openTrade, rememberTradeAccessSecret, tradeLinkInput]
  );

  const hashTradeAccessSecret = useCallback(async (accessSecret: string): Promise<string> => {
    const cotiEthers = await loadCotiEthersModule();
    return cotiEthers.keccak256(accessSecret);
  }, []);

  const tradeComposerModel = useMemo(
    () =>
      deriveTradeComposerModel({
        activeContact: null,
        walletAddress,
        isSelfChat: false,
        onCotiNetwork,
        creatingTrade,
        sending: false,
        tipping: false,
        tradeFeeModeSelection,
        tradeOfferTokenSelection,
        tradeRequestTokenSelection,
        tradeOfferCustomTokenAddress,
        tradeRequestCustomTokenAddress,
        tradeCustomOfferTokenKind:
          resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20',
        tradeCustomRequestTokenKind:
          resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20',
        customTradeTokenInfoByAddress,
        tradeOfferAmountInput,
        tradeRequestAmountInput,
        tradeExpiryHoursInput,
        tradeHidePrivateLiquidity,
        hiddenLiquidityUnavailableMessage:
          counterParentTrade
            ? 'Hidden liquidity is only available for fixed-price listings.'
            : editingTrade && !editingTrade.hiddenLiquidity
              ? 'Hidden liquidity cannot be added to a visible-liquidity edit.'
              : '',
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        tipNativeBalanceWei: nativeBalanceWei,
        rewardTokenBalanceWei,
        privateRewardTokenBalanceWei,
        tradeRequiredFeeWei,
        counterpartyRequired: false
      }),
    [
      creatingTrade,
      counterParentTrade,
      customTradeTokenInfoByAddress,
      editingTrade,
      nativeBalanceWei,
      onCotiNetwork,
      privateRewardTokenBalanceWei,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenBalanceWei,
      rewardTokenDecimals,
      rewardTokenSymbol,
      tradeExpiryHoursInput,
      tradeFeeModeSelection,
      tradeOfferAmountInput,
      tradeOfferCustomTokenAddress,
      tradeOfferTokenSelection,
      tradeHidePrivateLiquidity,
      tradeRequestAmountInput,
      tradeRequestCustomTokenAddress,
      tradeRequestTokenSelection,
      tradeRequiredFeeWei,
      walletAddress
    ]
  );

  const loadWalletBalances = useCallback(async () => {
    const readProvider = await loadCotiReadProvider(true);
    const cotiEthers = await loadCotiEthersModule();
    const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
    const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_TOKEN_BALANCE_ABI, readProvider);

    const [rewardSymbolRaw, rewardDecimalsRaw, privateSymbolRaw, privateDecimalsRaw] = await Promise.all([
      rewardTokenContract.symbol().catch(() => null),
      rewardTokenContract.decimals().catch(() => null),
      privateTokenContract.symbol().catch(() => null),
      privateTokenContract.decimals().catch(() => null)
    ]);

    setRewardTokenSymbol(typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim() ? rewardSymbolRaw.trim().slice(0, 12) : FALLBACK_REWARD_TOKEN_SYMBOL);
    setPrivateRewardTokenSymbol(
      typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
        ? privateSymbolRaw.trim().slice(0, 12)
        : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL
    );
    setRewardTokenDecimals(normalizeTokenDecimals(Number(rewardDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));
    setPrivateRewardTokenDecimals(normalizeTokenDecimals(Number(privateDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      setNativeBalanceWei(null);
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
      return;
    }

    const [nativeBalanceRaw, rewardBalanceRaw] = await Promise.all([
      readProvider.getBalance(walletAddress).catch(() => null),
      rewardTokenContract.balanceOf(walletAddress).catch(() => null)
    ]);
    setNativeBalanceWei(typeof nativeBalanceRaw === 'bigint' ? nativeBalanceRaw : null);
    setRewardTokenBalanceWei(typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null);

    if (walletHasAes) {
      const signer = await getTradeSigner(false).catch(() => null);
      const privateBalance =
        signer !== null ? await readPrivateTokenBalanceWei(PRIVATE_REWARD_TOKEN_ADDRESS, walletAddress, signer).catch(() => null) : null;
      setPrivateRewardTokenBalanceWei(privateBalance);
    } else {
      setPrivateRewardTokenBalanceWei(null);
    }
  }, [getTradeSigner, walletAddress, walletHasAes]);

  const refreshTradeDataInBackground = useCallback(
    (tradeId?: number, escrowContract?: string) => {
      void Promise.allSettled([
        loadWalletBalances(),
        refreshMyTrades(),
        refreshPublicTrades(),
        tradeId ? refreshTradeDetail(tradeId, escrowContract).catch(() => null) : Promise.resolve(null)
      ]);
    },
    [loadWalletBalances, refreshMyTrades, refreshPublicTrades, refreshTradeDetail]
  );

  const signAesForCurrentWallet = useCallback(async () => {
    const provider = providerRef.current;
    const burnerSigner = burnerWalletRef.current;
    if (!provider && !burnerSigner) {
      setWalletError('Connect a wallet first.');
      return;
    }
    if (!walletAddress) {
      setWalletError('Connect a wallet first.');
      return;
    }

    setWalletError('');
    setConnectingWalletId('aes');
    try {
      if (burnerSigner && burnerSigner.address.toLowerCase() === walletAddress.toLowerCase()) {
        await getTradeSigner(true);
      } else if (provider) {
        await onboardTradeWalletAes(provider, walletAddress);
      }
      await loadWalletBalances().catch(() => {});
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'AES signature was not completed.'));
    } finally {
      setConnectingWalletId('');
    }
  }, [connectedWalletLabel, getTradeSigner, loadWalletBalances, onboardTradeWalletAes, walletAddress]);

  const loadCustomTokenInfo = useCallback(
    async (token: { address: string; kind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'> }) => {
      const normalizedAddress = token.address.trim();
      if (!isWalletAddress(normalizedAddress)) {
        return;
      }

      const tokenKey = buildTradeCustomTokenInfoKey(token.kind, normalizedAddress);
      setCustomTradeTokenInfoByAddress((previous) => ({
        ...previous,
        [tokenKey]: {
          kind: token.kind,
          address: normalizedAddress,
          symbol: shortenAddress(normalizedAddress),
          decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
          balanceWei: null,
          loading: true,
          walletKey,
          aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
        }
      }));

      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const tokenAbi = token.kind === 'private-erc20' ? PRIVATE_TOKEN_BALANCE_ABI : ERC20_TOKEN_ABI;
        const tokenContract = new cotiEthers.Contract(normalizedAddress, tokenAbi, readProvider);
        const [symbolRaw, decimalsRaw] = await Promise.all([
          tokenContract.symbol().catch(() => null),
          tokenContract.decimals().catch(() => null)
        ]);
        const symbol =
          typeof symbolRaw === 'string' && symbolRaw.trim() ? symbolRaw.trim().slice(0, 16) : shortenAddress(normalizedAddress);
        const decimals =
          typeof decimalsRaw === 'number' || typeof decimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(decimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        let balanceWei: bigint | null = null;
        if (walletAddress) {
          if (token.kind === 'private-erc20') {
            const signer = walletHasAes ? await getTradeSigner(false).catch(() => null) : null;
            balanceWei =
              signer !== null ? await readPrivateTokenBalanceWei(normalizedAddress, walletAddress, signer).catch(() => null) : null;
          } else {
            const rawBalance = await tokenContract.balanceOf(walletAddress).catch(() => null);
            balanceWei = typeof rawBalance === 'bigint' ? rawBalance : null;
          }
        }

        setCustomTradeTokenInfoByAddress((previous) => ({
          ...previous,
          [tokenKey]: {
            kind: token.kind,
            address: normalizedAddress,
            symbol,
            decimals,
            balanceWei,
            loading: false,
            walletKey,
            aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
          }
        }));
      } catch {
        setCustomTradeTokenInfoByAddress((previous) => ({
          ...previous,
          [tokenKey]: {
            kind: token.kind,
            address: normalizedAddress,
            symbol: shortenAddress(normalizedAddress),
            decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
            balanceWei: null,
            loading: false,
            error: 'Unable to load token.',
            walletKey,
            aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
          }
        }));
      }
    },
    [getTradeSigner, walletAddress, walletHasAes, walletKey]
  );

  const beginCounterTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet before countering.');
        return;
      }
      if (snapshot.maker.toLowerCase() === walletKey) {
        setTradeActionError('This is your offer. Cancel it and create a new one to change the terms.');
        return;
      }
      if (snapshot.status !== 'open') {
        setTradeActionError('Only open trades can receive counter offers.');
        return;
      }
      if (snapshot.counterParentTradeId && snapshot.taker.toLowerCase() !== walletKey) {
        setTradeActionError('Only the recipient of a counter offer can replace it with a new counter.');
        return;
      }

      const nextOfferSelection = resolveTradeAssetSelection(snapshot.request);
      const nextRequestSelection = resolveTradeAssetSelection(snapshot.offer);
      setCounterParentTrade(snapshot);
      setEditingTrade(null);
      setTradeVisibility('unlisted');
      setTradeOfferTokenSelection(nextOfferSelection.selection);
      setTradeRequestTokenSelection(nextRequestSelection.selection);
      setTradeOfferCustomTokenAddress(nextOfferSelection.customAddress);
      setTradeRequestCustomTokenAddress(nextRequestSelection.customAddress);
      setTradeOfferAmountInput(formatTradeAmountInput(snapshot.request));
      setTradeRequestAmountInput(formatTradeAmountInput(snapshot.offer));
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHidePrivateLiquidity(false);
      setTradeActionError('');
      openTradeSnapshot(snapshot);
    },
    [openTradeSnapshot, walletAddress, walletKey]
  );

  const clearCounterTrade = useCallback(() => {
    setCounterParentTrade(null);
    setTradeHidePrivateLiquidity(false);
    setTradeActionError('');
  }, []);

  const beginEditTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect the maker wallet before editing.');
        return;
      }
      if (!canEditPublicTrade(snapshot, walletKey)) {
        setTradeActionError('Only your open, unfilled public trades can be edited.');
        return;
      }

      const nextOfferSelection = resolveTradeAssetSelection(snapshot.offer);
      const nextRequestSelection = resolveTradeAssetSelection(snapshot.request);
      setEditingTrade(snapshot);
      setCounterParentTrade(null);
      setTradeVisibility('public');
      setTradeOfferTokenSelection(nextOfferSelection.selection);
      setTradeRequestTokenSelection(nextRequestSelection.selection);
      setTradeOfferCustomTokenAddress(nextOfferSelection.customAddress);
      setTradeRequestCustomTokenAddress(nextRequestSelection.customAddress);
      if (snapshot.hiddenLiquidity) {
        const hiddenOfferAmountRaw =
          snapshot.makerPrivateProgress?.remainingOfferAmount ?? snapshot.makerPrivateProgress?.initialOfferAmount;
        const hiddenOfferAmount =
          hiddenOfferAmountRaw && /^\d+$/.test(hiddenOfferAmountRaw) ? BigInt(hiddenOfferAmountRaw) : null;
        const hiddenRequestAmount =
          hiddenOfferAmount !== null
            ? quotePrivateRequestAmountForOffer(
                hiddenOfferAmount,
                BigInt(snapshot.offer.amount),
                BigInt(snapshot.request.amount)
              )
            : null;
        setTradeOfferAmountInput(
          hiddenOfferAmount !== null ? formatTokenAmount(hiddenOfferAmount, snapshot.offer.decimals, 18) : ''
        );
        setTradeRequestAmountInput(
          hiddenRequestAmount !== null ? formatTokenAmount(hiddenRequestAmount, snapshot.request.decimals, 18) : ''
        );
      } else {
        setTradeOfferAmountInput(formatTradeAmountInput(snapshot.offer));
        setTradeRequestAmountInput(formatTradeAmountInput(snapshot.request));
      }
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHidePrivateLiquidity(Boolean(snapshot.hiddenLiquidity));
      setTradeActionError('');
      navigateToTradePath('/trades/create');
    },
    [navigateToTradePath, walletAddress, walletKey]
  );

  const clearEditTrade = useCallback(() => {
    setEditingTrade(null);
    setTradeHidePrivateLiquidity(false);
    setTradeActionError('');
  }, []);

  const startFreshTrade = useCallback(() => {
    clearCounterTrade();
    clearEditTrade();
    setTradeHidePrivateLiquidity(false);
    navigateToTradePath('/trades/create');
  }, [clearCounterTrade, clearEditTrade, navigateToTradePath]);

  const createTrade = useCallback(async () => {
    setTradeActionError('');
    setCreatedTradeId(null);
    setCreatedTradeLink('');

    if (tradeComposerModel.tradeComposerValidationMessage) {
      setTradeActionError(tradeComposerModel.tradeComposerValidationMessage);
      return;
    }

    const offerToken = tradeComposerModel.selectedTradeOfferToken;
    const requestToken = tradeComposerModel.selectedTradeRequestToken;
    const offerAmount = tradeComposerModel.parsedTradeOfferAmountWei;
    const requestAmount = tradeComposerModel.parsedTradeRequestAmountWei;
    if (!offerToken || !requestToken || !offerAmount || !requestAmount) {
      setTradeActionError('Complete the trade terms first.');
      return;
    }
    if (editingTrade && !canEditPublicTrade(editingTrade, walletKey)) {
      setTradeActionError('Only your open, unfilled public trades can be edited.');
      return;
    }
    if (!editingTrade && tradeVisibility === 'direct') {
      if (!directTradeRecipientIsValid) {
        setTradeActionError('Enter a valid wallet address for the direct trade.');
        return;
      }
      if (directTradeRecipientNormalized.toLowerCase() === walletAddress.toLowerCase()) {
        setTradeActionError('Choose a different wallet for the direct trade.');
        return;
      }
    }

    try {
      setCreatingTrade(true);
      const isCounterTrade = counterParentTrade !== null;
      const isCounterReplacement = Boolean(counterParentTrade?.counterParentTradeId);
      const editSourceTrade = editingTrade;
      const isEditTrade = editSourceTrade !== null;
      const hiddenLiquidity = Boolean(
        tradeHidePrivateLiquidity &&
        tradeComposerModel.hiddenLiquidityActive &&
          tradeComposerModel.hiddenPriceOfferAmountWei !== null &&
          tradeComposerModel.hiddenPriceRequestAmountWei !== null &&
          !isCounterTrade &&
          (!isEditTrade || editSourceTrade?.hiddenLiquidity)
      );
      if (isEditTrade && editSourceTrade.hiddenLiquidity && !hiddenLiquidity) {
        setTradeActionError('Hidden-liquidity trades must stay hidden when edited. Cancel the edit to create a visible-liquidity trade.');
        return;
      }
      const accessSecret = tradeVisibility === 'unlisted' && !isCounterTrade && !isEditTrade ? createTradeAccessSecret() : '';
      const accessHash = accessSecret ? await hashTradeAccessSecret(accessSecret) : ZERO_BYTES32;
      const signer = await getTradeSigner(isPrivateTradeAsset(offerToken));
      const nativeFeeWei = await resolveRequiredFeeForTradeCreate();
      const expiresAt = Math.floor(Date.now() / 1000) + tradeComposerModel.parsedTradeExpiryHours * 3600;
      const publicOfferAmount = hiddenLiquidity ? tradeComposerModel.hiddenPriceOfferAmountWei! : offerAmount;
      const publicRequestAmount = hiddenLiquidity ? tradeComposerModel.hiddenPriceRequestAmountWei! : requestAmount;
      const takerAddress =
        counterParentTrade?.maker ??
        (isEditTrade
          ? ZERO_TRADE_TAKER_ADDRESS
          : tradeVisibility === 'direct'
            ? directTradeRecipientNormalized
            : ZERO_TRADE_TAKER_ADDRESS);
      const createResult = isEditTrade
        ? hiddenLiquidity
          ? await replacePrivateFixedPriceTradeOnChain({
              signer,
              makerAddress: walletAddress,
              originalTradeId: editSourceTrade.tradeId,
              takerAddress: ZERO_TRADE_TAKER_ADDRESS,
              offerAsset: offerToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: requestToken,
              requestAmountWei: publicRequestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: true,
              hiddenOfferAmountWei: offerAmount,
              publicOfferAmountWei: publicOfferAmount
            })
          : await editTradeOnChain({
              signer,
              makerAddress: walletAddress,
              originalTradeId: editSourceTrade.tradeId,
              takerAddress: ZERO_TRADE_TAKER_ADDRESS,
              offerAsset: offerToken,
              offerAmountWei: offerAmount,
              requestAsset: requestToken,
              requestAmountWei: requestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: true
            })
        : isCounterReplacement && counterParentTrade
          ? await counterTradeAndCloseCounteredTradeOnChain({
              signer,
              makerAddress: walletAddress,
              counteredTradeId: counterParentTrade.tradeId,
              offerAsset: offerToken,
              offerAmountWei: offerAmount,
              requestAsset: requestToken,
              requestAmountWei: requestAmount,
              expiresAt,
              nativeFeeWei
            })
          : await createTradeOnChain({
              signer,
              makerAddress: walletAddress,
              takerAddress,
              offerAsset: offerToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: requestToken,
              requestAmountWei: publicRequestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: !isCounterTrade && tradeVisibility === 'public',
              accessHash: accessHash !== ZERO_BYTES32 ? accessHash : undefined,
              parentTradeId: counterParentTrade?.tradeId,
              hidePrivateLiquidity: hiddenLiquidity,
              hiddenOfferAmountWei: hiddenLiquidity ? offerAmount : undefined,
              publicOfferAmountWei: hiddenLiquidity ? publicOfferAmount : undefined
            });
      const tradeId = createResult.tradeId;
      if (hiddenLiquidity) {
        rememberPrivateTradeLiquidity(tradeId, createResult.escrowContract, offerAmount);
      }
      const createdAt = Math.floor(Date.now() / 1000);
      const counterParentTradeId = isCounterReplacement
        ? counterParentTrade?.counterParentTradeId
        : counterParentTrade?.tradeId;
      const snapshot: TradeSnapshot = {
        tradeId,
        escrowContract: createResult.escrowContract,
        maker: walletAddress,
        taker: takerAddress,
        offer: { ...offerToken, amount: publicOfferAmount.toString() },
        request: { ...requestToken, amount: publicRequestAmount.toString() },
        createdAt,
        expiresAt,
        status: 'open',
        isPublic: isEditTrade || (!isCounterTrade && tradeVisibility === 'public'),
        hasAccessHash: Boolean(accessSecret),
        parentTradeId: isEditTrade ? editSourceTrade.tradeId : counterParentTradeId,
        counterParentTradeId: isCounterTrade ? counterParentTradeId : undefined,
        replacesTradeId: isEditTrade ? editSourceTrade.tradeId : undefined,
        fillState: {
          remainingOfferAmount: hiddenLiquidity ? '0' : offerAmount.toString(),
          remainingRequestAmount: hiddenLiquidity ? '0' : requestAmount.toString(),
          filledOfferAmount: '0',
          filledRequestAmount: '0'
        },
        hiddenLiquidity,
        makerPrivateProgress: hiddenLiquidity
          ? {
              initialOfferAmount: offerAmount.toString(),
              remainingOfferAmount: offerAmount.toString(),
              filledOfferAmount: '0'
            }
          : undefined
      };
      const shareUrl = buildTradeShareUrl(tradeId, accessSecret || undefined, createResult.escrowContract);
      rememberTradeAccessSecret(tradeId, accessSecret || undefined, createResult.escrowContract);
      if (isEditTrade) {
        mergeTradeSnapshot({
          ...editSourceTrade,
          status: 'cancelled',
          replacementTradeId: tradeId
        });
      }
      if (isCounterReplacement && counterParentTrade) {
        mergeTradeSnapshot({
          ...counterParentTrade,
          status: 'declined'
        });
      }
      mergeTradeSnapshot(snapshot);
      setDetailTrade(snapshot);
      setCreatedTradeId(tradeId);
      setCreatedTradeLink(shareUrl);
      setCounterParentTrade(null);
      setEditingTrade(null);
      if (tradeVisibility === 'direct') {
        setDirectTradeRecipient('');
      }
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHidePrivateLiquidity(false);
      openTrade(tradeId, accessSecret || undefined, createResult.escrowContract);
      await Promise.all([
        loadWalletBalances(),
        refreshMyTrades(),
        snapshot.isPublic ? refreshPublicTrades() : Promise.resolve()
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create trade.';
      setTradeActionError(getOnChainFailureMessage(error, message));
    } finally {
      setCreatingTrade(false);
    }
  }, [
    buildTradeShareUrl,
    counterParentTrade,
    directTradeRecipientIsValid,
    directTradeRecipientNormalized,
    editingTrade,
    getTradeSigner,
    hashTradeAccessSecret,
    loadWalletBalances,
    mergeTradeSnapshot,
    openTrade,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    refreshMyTrades,
    refreshPublicTrades,
    resolveRequiredFeeForTradeCreate,
    tradeComposerModel,
    tradeHidePrivateLiquidity,
    tradeVisibility,
    walletAddress,
    walletKey
  ]);

  const acceptTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }

      if (connectedWithBurner) {
        const confirmed = window.confirm('Accept this trade using your app wallet? This will submit an on-chain transaction.');
        if (!confirmed) {
          return;
        }
      }

      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const latestSnapshot = (await refreshTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        const signer = await getTradeSigner(isPrivateTradeAsset(latestSnapshot.request));
        const accessSecret =
          route.tradeId === snapshot.tradeId &&
          buildTradeSnapshotKey(route.tradeId, route.escrowContract) === getSnapshotKey(snapshot) &&
          resolvedRouteAccessSecret
            ? resolvedRouteAccessSecret
            : resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
        if (latestSnapshot.hasAccessHash && !accessSecret) {
          throw new Error('This trade needs its full private link before it can be accepted.');
        }
        const remainingRequestAmount = getRemainingRequestAmount(latestSnapshot);
        if (remainingRequestAmount <= 0n) {
          throw new Error('This trade has no remaining amount to accept.');
        }
        const acceptRequestAsset = withTradeAssetAmount(latestSnapshot.request, remainingRequestAmount);
        const hiddenFillResult = latestSnapshot.hiddenLiquidity
          ? await fillPrivateFixedPriceTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: acceptRequestAsset,
              requestAmountWei: remainingRequestAmount,
              escrowContract: latestSnapshot.escrowContract,
              accessSecret: accessSecret || undefined
            })
          : null;
        const { acceptedTxHash } =
          hiddenFillResult !== null
            ? { acceptedTxHash: hiddenFillResult.filledTxHash }
            : latestSnapshot.counterParentTradeId
              ? await acceptCounterTradeAndCloseParentOnChain({
                  signer,
                  ownerAddress: walletAddress,
                  tradeId: snapshot.tradeId,
                  requestAsset: acceptRequestAsset,
                  requestAmountWei: remainingRequestAmount,
                  accessSecret: accessSecret || undefined
                })
              : await acceptTradeOnChain({
                  signer,
                  ownerAddress: walletAddress,
                  tradeId: snapshot.tradeId,
                  requestAsset: acceptRequestAsset,
                  requestAmountWei: remainingRequestAmount,
                  accessSecret: accessSecret || undefined
                });
        const nextSnapshot: TradeSnapshot = {
          ...latestSnapshot,
          taker:
            (!latestSnapshot.hiddenLiquidity || hiddenFillResult?.fullyFilled) &&
            latestSnapshot.taker.toLowerCase() === ZERO_TRADE_TAKER_ADDRESS.toLowerCase()
              ? walletAddress
              : latestSnapshot.taker,
          status: latestSnapshot.hiddenLiquidity
            ? hiddenFillResult?.fullyFilled
              ? 'accepted'
              : 'open'
            : 'accepted',
          fillState: latestSnapshot.hiddenLiquidity
            ? latestSnapshot.fillState
            : {
                remainingOfferAmount: '0',
                remainingRequestAmount: '0',
                filledOfferAmount: latestSnapshot.offer.amount,
                filledRequestAmount: latestSnapshot.request.amount
          },
          acceptedTxHash
        };
        mergeTradeSnapshot(nextSnapshot);
        if (latestSnapshot.counterParentTradeId) {
          refreshTradeDataInBackground(latestSnapshot.counterParentTradeId);
        }
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to accept trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [
      getTradeSigner,
      loadWalletBalances,
      mergeTradeSnapshot,
      refreshTradeDataInBackground,
      refreshMyTrades,
      refreshPublicTrades,
      refreshTradeDetail,
      resolveKnownTradeAccessSecret,
      resolvedRouteAccessSecret,
      route.escrowContract,
      route.tradeId,
      walletAddress,
      connectedWithBurner,
      walletKey
    ]
  );

  const partialFillTrade = useCallback(
    async (snapshot: TradeSnapshot, amountInput: string) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }
      if (snapshot.counterParentTradeId) {
        setTradeActionError('Counter offers must be accepted in full so the original trade can close atomically.');
        return;
      }

      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const latestSnapshot = (await refreshTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        if (latestSnapshot.counterParentTradeId) {
          throw new Error('Counter offers must be accepted in full so the original trade can close atomically.');
        }

        let requestedAmount: bigint;
        let remainingRequestAmount = 0n;
        if (latestSnapshot.hiddenLiquidity) {
          const desiredOfferAmount = parseTokenAmountInput(amountInput, latestSnapshot.offer.decimals);
          if (desiredOfferAmount === null || desiredOfferAmount <= 0n) {
            throw new Error(`Enter a valid ${latestSnapshot.offer.symbol} amount to fill.`);
          }
          requestedAmount = quotePrivateRequestAmountForOffer(
            desiredOfferAmount,
            BigInt(latestSnapshot.offer.amount),
            BigInt(latestSnapshot.request.amount)
          );
          if (requestedAmount <= 0n) {
            throw new Error('This trade price cannot be filled.');
          }
        } else {
          const parsedRequestAmount = parseTokenAmountInput(amountInput, latestSnapshot.request.decimals);
          if (parsedRequestAmount === null || parsedRequestAmount <= 0n) {
            throw new Error(`Enter a valid ${latestSnapshot.request.symbol} amount to fill.`);
          }
          requestedAmount = parsedRequestAmount;
          remainingRequestAmount = getRemainingRequestAmount(latestSnapshot);
          if (requestedAmount > remainingRequestAmount) {
            throw new Error(
              `Only ${formatTokenAmount(remainingRequestAmount, latestSnapshot.request.decimals, 6)} ${latestSnapshot.request.symbol} remains.`
            );
          }
        }

        const accessSecret =
          route.tradeId === snapshot.tradeId &&
          buildTradeSnapshotKey(route.tradeId, route.escrowContract) === getSnapshotKey(snapshot) &&
          resolvedRouteAccessSecret
            ? resolvedRouteAccessSecret
            : resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
        if (latestSnapshot.hasAccessHash && !accessSecret) {
          throw new Error('This trade needs its full private link before it can be filled.');
        }

        const signer = await getTradeSigner(isPrivateTradeAsset(latestSnapshot.request));
        const fillResult = latestSnapshot.hiddenLiquidity
          ? await fillPrivateFixedPriceTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: withTradeAssetAmount(latestSnapshot.request, requestedAmount),
              requestAmountWei: requestedAmount,
              escrowContract: latestSnapshot.escrowContract,
              accessSecret: accessSecret || undefined
            })
          : await fillTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: withTradeAssetAmount(latestSnapshot.request, requestedAmount),
              requestAmountWei: requestedAmount,
              accessSecret: accessSecret || undefined
            });
        if (latestSnapshot.hiddenLiquidity) {
          mergeTradeSnapshot({
            ...latestSnapshot,
            taker:
              'fullyFilled' in fillResult &&
              fillResult.fullyFilled &&
              latestSnapshot.taker.toLowerCase() === ZERO_TRADE_TAKER_ADDRESS.toLowerCase()
                ? walletAddress
                : latestSnapshot.taker,
            status: 'fullyFilled' in fillResult && fillResult.fullyFilled ? 'accepted' : latestSnapshot.status,
            acceptedTxHash: fillResult.filledTxHash
          });
        } else {
          const remainingAfterFill =
            requestedAmount >= remainingRequestAmount ? 0n : remainingRequestAmount - requestedAmount;
          const remainingOfferBeforeFill = getRemainingOfferAmount(latestSnapshot);
          const offerAmountOut =
            remainingAfterFill === 0n
              ? remainingOfferBeforeFill
              : (requestedAmount * remainingOfferBeforeFill) / remainingRequestAmount;
          const remainingOfferAfterFill =
            offerAmountOut >= remainingOfferBeforeFill ? 0n : remainingOfferBeforeFill - offerAmountOut;
          mergeTradeSnapshot({
            ...latestSnapshot,
            status: remainingAfterFill === 0n ? 'accepted' : latestSnapshot.status,
            fillState: {
              remainingOfferAmount: remainingOfferAfterFill.toString(),
              remainingRequestAmount: remainingAfterFill.toString(),
              filledOfferAmount: (BigInt(latestSnapshot.fillState?.filledOfferAmount ?? '0') + offerAmountOut).toString(),
              filledRequestAmount: (BigInt(latestSnapshot.fillState?.filledRequestAmount ?? '0') + requestedAmount).toString()
            }
          });
        }
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fill trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [
      getTradeSigner,
      loadWalletBalances,
      mergeTradeSnapshot,
      refreshTradeDataInBackground,
      refreshMyTrades,
      refreshPublicTrades,
      refreshTradeDetail,
      resolveKnownTradeAccessSecret,
      resolvedRouteAccessSecret,
      route.escrowContract,
      route.tradeId,
      walletAddress
    ]
  );

  const cancelTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const signer = await getTradeSigner(false);
        await cancelTradeOnChain({ signer, tradeId: snapshot.tradeId, escrowContract: snapshot.escrowContract });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'cancelled' };
        mergeTradeSnapshot(nextSnapshot);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, mergeTradeSnapshot, refreshTradeDataInBackground]
  );

  const declineTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const signer = await getTradeSigner(false);
        await declineTradeOnChain({ signer, tradeId: snapshot.tradeId, escrowContract: snapshot.escrowContract });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'declined' };
        mergeTradeSnapshot(nextSnapshot);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refuse trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, mergeTradeSnapshot, refreshTradeDataInBackground]
  );

  const renderTradeCard = (snapshot: TradeSnapshot, collapsed = false) => {
    const snapshotKey = getSnapshotKey(snapshot);
    const accessSecret =
      route.tradeId === snapshot.tradeId &&
      buildTradeSnapshotKey(route.tradeId, route.escrowContract) === snapshotKey &&
      resolvedRouteAccessSecret
        ? resolvedRouteAccessSecret
        : resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
    const shareUrl =
      snapshot.isPublic === false && snapshot.hasAccessHash && !accessSecret
        ? undefined
        : buildTradeShareUrl(snapshot.tradeId, accessSecret, snapshot.escrowContract);
    const shareKey = `trade-link:${snapshotKey}:${accessSecret ? 'secret' : 'public'}`;

    return (
      <TradeOfferCard
        key={snapshotKey}
        offer={buildOfferFromSnapshot(snapshot)}
        snapshot={snapshot}
        currentWalletAddress={walletAddress}
        actionPending={processingTradeActionId === snapshotKey}
        collapsed={collapsed}
        shareUrl={shareUrl}
        shareLabel={accessSecret ? 'Private Link' : 'Share Link'}
        shareCopied={lastCopiedKey === shareKey}
        onCopyShareLink={shareUrl ? () => copyWithFeedback(shareUrl, shareKey).catch(() => {}) : undefined}
        showCounterAction={snapshot.status === 'open'}
        showEditAction={canEditPublicTrade(snapshot, walletKey)}
        onAccept={() => acceptTrade(snapshot).catch(() => {})}
        onPartialFill={
          snapshot.counterParentTradeId ? undefined : (amountInput) => partialFillTrade(snapshot, amountInput).catch(() => {})
        }
        onDecline={() => declineTrade(snapshot).catch(() => {})}
        onCounter={() => beginCounterTrade(snapshot)}
        onCancel={() => cancelTrade(snapshot).catch(() => {})}
        onEdit={() => beginEditTrade(snapshot)}
      />
    );
  };

  useEffect(() => {
    const syncRoute = () => {
      setRoute(resolveTradeRouteFromLocation());
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    if (routeTradeId !== null && routeAccessSecret) {
      rememberTradeAccessSecret(routeTradeId, routeAccessSecret, routeEscrowContract);
    }
  }, [rememberTradeAccessSecret, routeAccessSecret, routeEscrowContract, routeTradeId]);

  useEffect(() => {
    if (!counterParentTrade) {
      return;
    }

    window.requestAnimationFrame(() => {
      counterPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      counterPanelRef.current?.focus({ preventScroll: true });
    });
  }, [counterParentTrade]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider?.on || !provider?.removeListener) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      const selected = nextAccounts[0] ?? '';
      setWalletAddress(selected);
      if (!selected) {
        setChainId(null);
      }
    };
    const handleChainChanged = (newChainId: unknown) => {
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        setChainId(normalizeChainId(newChainId));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [walletAddress]);

  useEffect(() => {
    resolveRequiredFeeForTradeCreate().catch(() => {});
  }, [resolveRequiredFeeForTradeCreate]);

  useEffect(() => {
    loadWalletBalances().catch(() => {});
  }, [loadWalletBalances]);

  useEffect(() => {
    refreshPublicTrades().catch(() => {});
  }, [refreshPublicTrades]);

  useEffect(() => {
    refreshMyTrades().catch(() => {});
  }, [refreshMyTrades]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let visibleSyncIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;

    const dispatchRealtimeSync = () => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }
      lastRealtimeSyncDispatchAt = Date.now();
      refreshPublicTrades().catch(() => {});
      if (walletAddress) {
        refreshMyTrades().catch(() => {});
      }
      if (routeTradeId !== null) {
        refreshTradeDetail(routeTradeId, routeEscrowContract).catch(() => {});
      }
    };

    const scheduleRealtimeSync = () => {
      if (cancelled) {
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        publicTradesRefreshRef.current === null &&
        myTradesRefreshRef.current === null &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync();
        return;
      }

      if (realtimeSyncTimerId !== null) {
        return;
      }

      const nextDelay = Math.max(
        REALTIME_SYNC_DEBOUNCE_MS,
        REALTIME_SYNC_BURST_THROTTLE_MS - elapsedSinceLastDispatch
      );
      realtimeSyncTimerId = window.setTimeout(() => {
        realtimeSyncTimerId = null;
        dispatchRealtimeSync();
      }, nextDelay);
    };

    const clearPollFallback = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (wsReconnectIntervalId !== null) {
        window.clearInterval(wsReconnectIntervalId);
        wsReconnectIntervalId = null;
      }
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      scheduleRealtimeSync();
    };

    if (typeof window !== 'undefined') {
      visibleSyncIntervalId = window.setInterval(scheduleRealtimeSync, P2P_VISIBLE_SYNC_INTERVAL_MS);
      window.addEventListener('focus', handleVisibilityOrFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    const setupTradeRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();

        const contract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, wsProvider);
        const handleTradeEvent = () => {
          scheduleRealtimeSync();
        };

        const openedFilter = contract.filters.TradeOpened();
        const acceptedFilter = contract.filters.TradeAccepted();
        const cancelledFilter = contract.filters.TradeCancelled();
        const declinedFilter = contract.filters.TradeDeclined();
        const expiredFilter = contract.filters.TradeExpired();

        contract.on(openedFilter, handleTradeEvent);
        contract.on(acceptedFilter, handleTradeEvent);
        contract.on(cancelledFilter, handleTradeEvent);
        contract.on(declinedFilter, handleTradeEvent);
        contract.on(expiredFilter, handleTradeEvent);

        if (cancelled) {
          contract.off(openedFilter, handleTradeEvent);
          contract.off(acceptedFilter, handleTradeEvent);
          contract.off(cancelledFilter, handleTradeEvent);
          contract.off(declinedFilter, handleTradeEvent);
          contract.off(expiredFilter, handleTradeEvent);
          return;
        }

        unsubscribe = () => {
          contract.off(openedFilter, handleTradeEvent);
          contract.off(acceptedFilter, handleTradeEvent);
          contract.off(cancelledFilter, handleTradeEvent);
          contract.off(declinedFilter, handleTradeEvent);
          contract.off(expiredFilter, handleTradeEvent);
        };
        clearPollFallback();
      } catch {
        await resetCotiWsProvider();
        if (cancelled) {
          return;
        }

        if (pollIntervalId === null) {
          pollIntervalId = window.setInterval(scheduleRealtimeSync, REALTIME_SYNC_FALLBACK_INTERVAL_MS);
        }

        if (wsReconnectIntervalId === null) {
          wsReconnectIntervalId = window.setInterval(() => {
            if (wsReconnectInFlight || cancelled) {
              return;
            }

            wsReconnectInFlight = true;
            setupTradeRealtimeSubscription()
              .catch(() => {})
              .finally(() => {
                wsReconnectInFlight = false;
              });
          }, WS_RETRY_COOLDOWN_MS);
        }
      }
    };

    setupTradeRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearPollFallback();
      if (visibleSyncIntervalId !== null) {
        window.clearInterval(visibleSyncIntervalId);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
    };
  }, [refreshMyTrades, refreshPublicTrades, refreshTradeDetail, routeEscrowContract, routeTradeId, walletAddress]);

  useEffect(() => {
    const requestedTokens = [
      {
        address: tradeOfferCustomTokenAddress,
        kind: resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      },
      {
        address: tradeRequestCustomTokenAddress,
        kind: resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      }
    ].filter(
      (token): token is { address: string; kind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'> } =>
        Boolean(token.address.trim()) && isWalletAddress(token.address.trim())
    );

    for (const token of requestedTokens) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      const shouldRefreshPrivateBalance =
        token.kind === 'private-erc20' && existing?.aesReady !== walletHasAes && !existing?.loading;
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token).catch(() => {});
      }
    }
  }, [
    customTradeTokenInfoByAddress,
    loadCustomTokenInfo,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    walletHasAes,
    walletKey
  ]);

  useEffect(() => {
    for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      const shouldRefreshPrivateBalance =
        token.kind === 'private-erc20' && existing?.aesReady !== walletHasAes && !existing?.loading;
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token).catch(() => {});
      }
    }
  }, [customTradeTokenInfoByAddress, loadCustomTokenInfo, walletHasAes, walletKey]);

  useEffect(() => {
    if (routeView !== 'trade' || routeTradeId === null) {
      setDetailTrade(null);
      setDetailTradeError(routeError);
      setTradeAccessBlocked(false);
      setLoadingDetailTrade(false);
      return;
    }

    let cancelled = false;
    setLoadingDetailTrade(true);
    setDetailTradeError('');
    setTradeAccessBlocked(false);

    const loadDetail = async () => {
      try {
        const metadata = await withTimeout(
          fetchTradeAccessMetadataById(routeTradeId, routeEscrowContract),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while reading trade access.'
        ).catch(() => null);
        if (cancelled) {
          return;
        }

        const snapshot = await withTimeout(
          refreshTradeDetail(routeTradeId, routeEscrowContract),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while loading trade.'
        );
        const isParticipant =
          Boolean(walletKey) &&
          [snapshot?.maker.toLowerCase(), snapshot?.taker.toLowerCase()].includes(walletKey);
        const isUnlisted = metadata?.isPublic === false || snapshot?.isPublic === false;
        if (isUnlisted && !resolvedRouteAccessSecret && !isParticipant) {
          setTradeAccessBlocked(true);
          setDetailTrade(null);
          return;
        }
        if (!cancelled) {
          setDetailTrade(snapshot);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDetailTradeError(loadError instanceof Error ? loadError.message : 'Trade was not found on the escrow contract.');
        }
      } finally {
        if (!cancelled) {
          setLoadingDetailTrade(false);
        }
      }
    };

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [refreshTradeDetail, resolvedRouteAccessSecret, routeError, routeEscrowContract, routeTradeId, routeView, walletKey]);

  const tradeComposer = (
    <TradeComposerPanel
      title={
        editingTrade
          ? `Edit public trade #${editingTrade.tradeId}`
          : counterParentTrade
            ? `Counter trade #${counterParentTrade.tradeId}`
            : 'Create trade'
      }
      metaLabel={
        editingTrade
          ? 'Cancel and replace public listing'
          : counterParentTrade
          ? `Linked counter to ${shortenAddress(counterParentTrade.maker)}`
          : tradeVisibility === 'public'
            ? 'Listed escrow trade'
            : tradeVisibility === 'direct'
              ? directTradeRecipientIsValid
                ? `Direct to ${shortenAddress(directTradeRecipientNormalized)}`
                : 'Direct wallet offer'
              : 'Unlisted escrow trade'
      }
      safetyNote={
        editingTrade
          ? 'Editing creates a new public trade and cancels the original listing in the same transaction.'
          : counterParentTrade
          ? 'The counter offer is created as a linked private trade for the original maker.'
          : 'Escrow settlement and trade terms are stored on-chain.'
      }
      sendLabel={editingTrade ? 'Save Edit' : counterParentTrade ? 'Send Counter' : 'Create Trade'}
      sendingLabel="Creating..."
      sendTitle={
        editingTrade
          ? 'Cancel the old public listing and create the replacement trade.'
          : counterParentTrade
            ? 'Create a linked counter trade on chain.'
            : 'Create the escrow trade on chain.'
      }
      feeMode={tradeFeeModeSelection}
      onFeeModeChange={setTradeFeeModeSelection}
      feeSummaryLabel={tradeComposerModel.tradeFeeSummaryLabel}
      feeError={tradeComposerModel.tradeComposerFieldErrors.fee}
      offerTokenOptions={tradeComposerModel.tradeTokenOptions}
      requestTokenOptions={tradeComposerModel.tradeTokenOptions}
      offerTokenSelection={tradeOfferTokenSelection}
      onOfferTokenSelectionChange={(value) => setTradeOfferTokenSelection(value as TradeTokenPresetKey)}
      requestTokenSelection={tradeRequestTokenSelection}
      onRequestTokenSelectionChange={(value) => setTradeRequestTokenSelection(value as TradeTokenPresetKey)}
      offerAssetError={tradeComposerModel.tradeComposerFieldErrors.offerAsset}
      requestAssetError={tradeComposerModel.tradeComposerFieldErrors.requestAsset}
      offerCustomAddress={tradeOfferCustomTokenAddress}
      onOfferCustomAddressChange={setTradeOfferCustomTokenAddress}
      requestCustomAddress={tradeRequestCustomTokenAddress}
      onRequestCustomAddressChange={setTradeRequestCustomTokenAddress}
      offerCustomMetaLabel={tradeComposerModel.tradeOfferCustomMetaLabel}
      requestCustomMetaLabel={tradeComposerModel.tradeRequestCustomMetaLabel}
      offerVerifyUrl={tradeComposerModel.tradeOfferVerifyUrl}
      requestVerifyUrl={tradeComposerModel.tradeRequestVerifyUrl}
      offerAmountInput={tradeOfferAmountInput}
      onOfferAmountInputChange={(value) => setTradeOfferAmountInput(sanitizeTokenAmountInput(value))}
      requestAmountInput={tradeRequestAmountInput}
      onRequestAmountInputChange={(value) => setTradeRequestAmountInput(sanitizeTokenAmountInput(value))}
      offerAmountLabel={tradeComposerModel.tradeOfferAmountLabel}
      requestAmountLabel={tradeComposerModel.tradeRequestAmountLabel}
      offerAmountPlaceholder={tradeComposerModel.tradeOfferAmountPlaceholder}
      requestAmountPlaceholder={tradeComposerModel.tradeRequestAmountPlaceholder}
      offerAmountError={tradeComposerModel.tradeComposerFieldErrors.offerAmount}
      requestAmountError={tradeComposerModel.tradeComposerFieldErrors.requestAmount}
      canUseMaxOfferAmount={tradeComposerModel.canUseTradeOfferMax}
      onUseMaxOfferAmount={() => setTradeOfferAmountInput(tradeComposerModel.tradeOfferMaxInputValue)}
      offerAmountSummaryLabel={tradeComposerModel.tradeOfferAmountSummaryLabel}
      requestAmountSummaryLabel={tradeComposerModel.tradeRequestAmountSummaryLabel}
      offerBalanceSummaryLabel={tradeComposerModel.tradeOfferBalanceSummaryLabel}
      onSwapSides={() => {
        const nextOfferToken = tradeRequestTokenSelection;
        const nextRequestToken = tradeOfferTokenSelection;
        const nextOfferCustomAddress = tradeRequestCustomTokenAddress;
        const nextRequestCustomAddress = tradeOfferCustomTokenAddress;
        const nextOfferAmount = tradeRequestAmountInput;
        const nextRequestAmount = tradeOfferAmountInput;
        setTradeOfferTokenSelection(nextOfferToken);
        setTradeRequestTokenSelection(nextRequestToken);
        setTradeOfferCustomTokenAddress(nextOfferCustomAddress);
        setTradeRequestCustomTokenAddress(nextRequestCustomAddress);
        setTradeOfferAmountInput(nextOfferAmount);
        setTradeRequestAmountInput(nextRequestAmount);
      }}
      swapDisabled={creatingTrade}
      tradePreviewLabel={tradeComposerModel.tradePreviewLabel}
      tradeRateLabel={tradeComposerModel.tradeRateLabel}
      tradeReverseRateLabel={tradeComposerModel.tradeReverseRateLabel}
      expiresHoursInput={tradeExpiryHoursInput}
      onExpiresHoursInputChange={(value) => setTradeExpiryHoursInput(value.replace(/[^0-9]/g, ''))}
      expiryError={tradeComposerModel.tradeComposerFieldErrors.expiry}
      hidePrivateLiquidity={tradeHidePrivateLiquidity}
      canHidePrivateLiquidity={tradeComposerModel.canHidePrivateLiquidity}
      hiddenLiquidityUnavailableMessage={tradeComposerModel.hiddenLiquidityUnavailableMessage}
      onHidePrivateLiquidityChange={setTradeHidePrivateLiquidity}
      sending={creatingTrade}
      canSend={tradeComposerModel.canSendTradeOffer}
      onSendTradeOffer={() => {
        createTrade().catch(() => {});
      }}
      generalError={tradeComposerModel.tradeComposerFieldErrors.general}
      validationMessage={tradeComposerModel.tradeComposerValidationMessage || undefined}
    />
  );

  const renderTradeOverviewCard = (trade: TradeSnapshot) => {
    const tradeKey = getSnapshotKey(trade);
    const displayTerms = getTradeDisplayTerms(trade);
    const displayTrade = {
      ...trade,
      offer: displayTerms.offer,
      request: displayTerms.request
    };
    const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
    const perspective = orderSummary.perspective;
    const isCounterTrade = Boolean(trade.counterParentTradeId);
    const canCounter =
      walletKey.length > 0 &&
      !perspective.isMaker &&
      trade.status === 'open' &&
      (!isCounterTrade || trade.taker.toLowerCase() === walletKey);
    const canEdit = canEditPublicTrade(trade, walletKey);
    const completionSummary = getTradeCompletionSummary(trade);
    const makerPrivateProgressSummary = route.view === 'public' ? null : getMakerPrivateProgressSummary(trade);
    const visibleCompletionSummary = makerPrivateProgressSummary ?? completionSummary;
    const canRevealMakerPrivateProgress = Boolean(
      route.view !== 'public' && trade.hiddenLiquidity && perspective.isMaker && !makerPrivateProgressSummary
    );
    const accessSecret =
      route.tradeId === trade.tradeId &&
      buildTradeSnapshotKey(route.tradeId, route.escrowContract) === tradeKey &&
      resolvedRouteAccessSecret
        ? resolvedRouteAccessSecret
        : resolveKnownTradeAccessSecret(trade.tradeId, trade.escrowContract);
    const shareUrl =
      trade.isPublic === false && trade.hasAccessHash && !accessSecret
        ? ''
        : buildTradeShareUrl(trade.tradeId, accessSecret || undefined, trade.escrowContract);
    const isDirectTrade = isDirectWalletTrade(trade);
    const shareKey = `offer-trade-link:${tradeKey}:${accessSecret ? 'secret' : 'public'}`;
    const visibilityLabel =
      trade.isPublic === false
        ? isDirectTrade
          ? 'Direct offer'
          : trade.hasAccessHash
          ? accessSecret
            ? 'Private link saved'
            : 'Private link'
          : 'Unlisted offer'
        : 'Public listing';
    const takerLabel = isZeroTradeTakerAddress(trade.taker) ? 'Any wallet' : shortenAddress(trade.taker);
    const statusLabel =
      trade.status === 'open'
        ? 'Active'
        : trade.status === 'unknown'
          ? 'Unknown'
          : trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
    const statusClassName = `p2p-offer-status-${trade.status}`;
    const acceptedTxExplorerUrl = buildTransactionExplorerUrl(trade.acceptedTxHash);
    const isFinishedTrade = trade.status !== 'open';
    const leftSide = orderSummary.primarySide;
    const rightSide = orderSummary.secondarySide;
    const leftExplorerUrl = buildTradeAssetExplorerUrl(leftSide.asset);
    const rightExplorerUrl = buildTradeAssetExplorerUrl(rightSide.asset);
    const pairLabel = trade.hiddenLiquidity ? orderSummary.actionLabel : orderSummary.directionLabel;
    const leftToneClass = `p2p-offer-term-${leftSide.tone}`;
    const rightToneClass = `p2p-offer-term-${rightSide.tone}`;
    const isRateReversed = Boolean(reversedRateTradeIds[tradeKey]);
    const hiddenFixedPriceTerms = trade.hiddenLiquidity
      ? isRateReversed
        ? orderSummary.reverseRatioLabel ?? formatHiddenFixedPriceTerms(displayTerms.request, displayTerms.offer)
        : orderSummary.ratioLabel ?? formatHiddenFixedPriceTerms(displayTerms.offer, displayTerms.request)
      : '';
    const showHiddenPriceSummary = Boolean(trade.hiddenLiquidity);
    const showExplorerHiddenPriceOnly = route.view === 'public' && Boolean(trade.hiddenLiquidity);
    const tradeRateText = trade.hiddenLiquidity
      ? hiddenFixedPriceTerms
      : isRateReversed
        ? orderSummary.reverseRatioLabel ?? formatTradeRateText(displayTerms.request, displayTerms.offer)
        : orderSummary.ratioLabel ?? formatTradeRateText(displayTerms.offer, displayTerms.request);
    const hiddenDirectionLabel = trade.hiddenLiquidity ? orderSummary.directionLabel : '';
    const formatVisibleTermText = (asset: TradeAssetPayload): string =>
      trade.hiddenLiquidity
        ? asset.symbol
        : formatTradeAssetDisplayText(asset);
    const leftMetaLabel =
      trade.hiddenLiquidity
        ? 'Amount hidden'
        : leftSide.role === 'offer'
        ? displayTerms.usingRemaining
          ? 'Remaining now'
          : trade.status === 'open'
            ? 'Available now'
            : statusLabel
        : takerLabel;
    const rightMetaLabel =
      trade.hiddenLiquidity
        ? 'Amount hidden'
        : rightSide.role === 'offer'
        ? displayTerms.usingRemaining
          ? 'Remaining now'
          : trade.status === 'open'
            ? 'Available now'
            : statusLabel
        : takerLabel;
    const expiryParts = formatTradeExpiryParts(trade.expiresAt);
    const expiryCountdown = trade.status === 'open' ? formatExpiryCountdown(trade.expiresAt) : null;

    return (
      <article key={tradeKey} className={`p2p-offer-card p2p-offer-card-${trade.status}`}>
        <div className="p2p-offer-card-head">
          <div className="p2p-offer-title">
            <h3 title={formatTradeListTerms(trade)}>{pairLabel}</h3>
            <p>
              #{trade.tradeId}
              {trade.hiddenLiquidity ? <span>Hidden liquidity</span> : null}
              {trade.counterParentTradeId ? <span>Counter to #{trade.counterParentTradeId}</span> : null}
              {trade.replacesTradeId ? <span>Edited from #{trade.replacesTradeId}</span> : null}
              {trade.replacementTradeId ? <span>Replaced by #{trade.replacementTradeId}</span> : null}
            </p>
          </div>
          <strong className={`p2p-offer-status ${statusClassName}`}>{statusLabel}</strong>
        </div>

        {showHiddenPriceSummary ? (
          <button
            type="button"
            className="p2p-hidden-price-card"
            onClick={() => toggleTradeRateDirection(trade.tradeId, trade.escrowContract)}
            title="Flip price ratio"
            aria-label={`Flip price ratio for trade ${trade.tradeId}. Current ratio: ${hiddenFixedPriceTerms}`}
          >
            <span>Price ratio</span>
            <strong>{hiddenFixedPriceTerms}</strong>
            <small>{hiddenDirectionLabel}. Liquidity and fill amounts stay private.</small>
          </button>
        ) : null}

        {!showExplorerHiddenPriceOnly ? (
          <div className="p2p-offer-terms" aria-label={formatTradeListTerms(trade)}>
          <div className={`p2p-offer-term p2p-offer-term-offered ${leftToneClass}`}>
            <span>{leftSide.label}</span>
            <strong>{formatVisibleTermText(leftSide.asset)}</strong>
            <small>{leftMetaLabel}</small>
            {leftExplorerUrl ? (
              <a className="p2p-offer-token-link" href={leftExplorerUrl} target="_blank" rel="noreferrer">
                Token Explorer
              </a>
            ) : null}
          </div>
          <div className="p2p-offer-term-link" aria-hidden="true">
            →
          </div>
          <div className={`p2p-offer-term p2p-offer-term-requested ${rightToneClass}`}>
            <span>{rightSide.label}</span>
            <strong>{formatVisibleTermText(rightSide.asset)}</strong>
            <small>{rightMetaLabel}</small>
            {rightExplorerUrl ? (
              <a className="p2p-offer-token-link" href={rightExplorerUrl} target="_blank" rel="noreferrer">
                Token Explorer
              </a>
            ) : null}
          </div>
          </div>
        ) : null}

        {visibleCompletionSummary ? (
          <div className="p2p-offer-completion" aria-label={visibleCompletionSummary.percentLabel}>
            <div className="p2p-offer-completion-head">
              <span>{makerPrivateProgressSummary ? 'Your liquidity' : 'Completion'}</span>
              <strong>{makerPrivateProgressSummary?.totalLabel ?? visibleCompletionSummary.percentLabel}</strong>
            </div>
            <div className="p2p-offer-completion-bar">
              <span style={{ width: `${visibleCompletionSummary.percent}%` }} />
            </div>
            <div className="p2p-offer-completion-meta">
              <span>{visibleCompletionSummary.filledLabel}</span>
              <span>{visibleCompletionSummary.remainingLabel}</span>
            </div>
          </div>
        ) : null}

        <div className={trade.hiddenLiquidity ? 'p2p-offer-facts p2p-offer-facts-compact' : 'p2p-offer-facts'}>
          {!trade.hiddenLiquidity ? (
            <div>
              <span>Price ratio</span>
              <button
                type="button"
                className="p2p-offer-rate-toggle"
                onClick={() => toggleTradeRateDirection(trade.tradeId, trade.escrowContract)}
                title="Flip rate"
                aria-label={`Flip rate for trade ${trade.tradeId}`}
              >
                {tradeRateText}
              </button>
            </div>
          ) : null}
          <div>
            <span>Expires</span>
            {expiryCountdown ? (
              <strong
                className={`p2p-offer-expiry trade-card-expiry-${expiryCountdown.urgency}`}
                title={`Created: ${formatMessageTimestamp(trade.createdAt)}`}
              >
                {expiryCountdown.label.replace(/^Expires /, '')}
              </strong>
            ) : (
              <strong className="p2p-offer-expiry" title={expiryParts.title}>
                {expiryParts.date}
                {expiryParts.time ? <small>{expiryParts.time}</small> : null}
              </strong>
            )}
          </div>
          <div>
            <span>Access</span>
            <strong>{visibilityLabel}</strong>
          </div>
        </div>

        {isFinishedTrade ? (
          <div className="p2p-offer-parties">
            <div>
              <span>Maker</span>
              <strong>{shortenAddress(trade.maker)}</strong>
            </div>
            <div>
              <span>Taker</span>
              <strong>{isZeroTradeTakerAddress(trade.taker) ? 'Unfilled' : shortenAddress(trade.taker)}</strong>
            </div>
          </div>
        ) : null}

        <div className="p2p-offer-footer">
          {isFinishedTrade ? (
            <>
              <span className="p2p-offer-final-state">
                {statusLabel} trade #{trade.tradeId}
                {acceptedTxExplorerUrl ? ' with on-chain settlement' : ''}
              </span>
              {acceptedTxExplorerUrl ? (
                <a className="p2p-offer-footer-link" href={acceptedTxExplorerUrl} target="_blank" rel="noreferrer">
                  View Tx
                </a>
              ) : null}
            </>
          ) : (
            <>
              <span>{perspective.isMaker ? 'Created by you' : perspective.isTaker ? 'Reserved for you' : 'Open order'}</span>
              <div>
                <button type="button" className="p2p-offer-open-btn" onClick={() => openTradeSnapshot(trade)} title="Open trade">
                  Open
                </button>
                {canRevealMakerPrivateProgress ? (
                  <button
                    type="button"
                    className="p2p-offer-counter-btn"
                    onClick={() => revealMakerPrivateProgress(trade).catch(() => {})}
                    disabled={revealingPrivateTradeKey === tradeKey}
                    title="Reveal your hidden liquidity with your wallet AES key"
                  >
                    {revealingPrivateTradeKey === tradeKey ? 'Revealing...' : 'Reveal Liquidity'}
                  </button>
                ) : null}
                {shareUrl && (perspective.isMaker || accessSecret) ? (
                  <button
                    type="button"
                    className={lastCopiedKey === shareKey ? 'copied' : undefined}
                    onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                    title={accessSecret ? 'Copy private trade link' : 'Copy trade link'}
                  >
                    {lastCopiedKey === shareKey ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
                {canCounter ? (
                  <button type="button" className="p2p-offer-counter-btn" onClick={() => beginCounterTrade(trade)}>
                    Counter
                  </button>
                ) : null}
                {canEdit ? (
                  <button type="button" className="p2p-offer-counter-btn" onClick={() => beginEditTrade(trade)}>
                    Edit
                  </button>
                ) : null}
                {perspective.isMaker ? (
                  <button
                    type="button"
                    className="p2p-offer-cancel-btn"
                    onClick={() => cancelTrade(trade).catch(() => {})}
                    disabled={processingTradeActionId === tradeKey}
                  >
                    {processingTradeActionId === tradeKey ? 'Cancelling...' : 'Cancel'}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </article>
    );
  };

  const renderTradeList = (trades: TradeSnapshot[], emptyLabel: string, gridClassName = '') =>
    trades.length > 0 ? (
      <div className={`p2p-offer-grid${gridClassName ? ` ${gridClassName}` : ''}`}>
        {trades.map((trade) => renderTradeOverviewCard(trade))}
      </div>
    ) : (
      <p className="standalone-trade-state">{emptyLabel}</p>
    );
  const walletPrimaryButtonLabel =
    connectingWalletId === 'aes'
      ? 'Signing AES...'
      : connectingWalletId
        ? 'Connecting...'
        : walletAddress && !onCotiNetwork
          ? 'Switch to COTI'
        : walletAddress
            ? shortenAddress(walletAddress)
            : preferredWalletOption
              ? `Connect ${preferredWalletOption.label}`
              : 'Wallet unavailable';
  const walletAddressCopyKey = walletAddress ? `trade-wallet-address:${walletAddress.toLowerCase()}` : '';
  const handleWalletPrimaryAction = useCallback(() => {
    if (walletAddress && !onCotiNetwork) {
      const provider = providerRef.current;
      if (provider) {
        ensureCotiNetwork(provider).catch((error) => {
          setWalletError(getProviderErrorMessage(error, 'Failed to switch network.'));
        });
      }
      return;
    }

    if (walletAddress) {
      copyWithFeedback(walletAddress, walletAddressCopyKey).catch(() => {});
      return;
    }

    connectWallet(preferredWalletOption?.id).catch(() => {});
  }, [
    connectWallet,
    copyWithFeedback,
    ensureCotiNetwork,
    onCotiNetwork,
    preferredWalletOption?.id,
    walletAddress,
    walletAddressCopyKey
  ]);
  const disconnectWallet = useCallback(() => {
    providerRef.current = null;
    burnerWalletRef.current = null;
    signerCacheRef.current = {};
    setWalletAddress('');
    setChainId(null);
    setConnectedWalletLabel('Wallet');
    setSelectedWalletId('');
    setSelectedBurnerWalletId('');
    setWalletError('');
    setTradeActionError('');
    setNativeBalanceWei(null);
    setRewardTokenBalanceWei(null);
    setPrivateRewardTokenBalanceWei(null);
    setMyTrades([]);
    window.localStorage.removeItem(WALLET_STATUS_STORAGE_KEY);
  }, []);
  const walletPrimaryButtonClass =
    !walletAddress || !onCotiNetwork
      ? 'connect-btn wallet-inline-btn wallet-primary-action'
      : 'connect-btn wallet-inline-btn';
  const walletPrimaryButtonCopied = lastCopiedKey === walletAddressCopyKey;
  const walletPrimaryButtonIsAddress = Boolean(walletAddress && onCotiNetwork);
  const showInlineAesAction = Boolean(walletAddress && onCotiNetwork && !walletHasAes);
  const walletAesButtonLabel = connectingWalletId === 'aes' ? 'Signing...' : 'Sign AES key';
  const walletModeLabel = walletAddress ? (connectedWithBurner ? 'App wallet' : connectedWalletLabel) : 'No wallet connected';
  const walletStatusLabel = !walletAddress
    ? 'Disconnected'
    : !onCotiNetwork
      ? 'Switch network'
      : walletHasAes
        ? 'Ready'
        : 'Connected';
  const tradeWalletHeaderControl = useMemo(
    () => (
      <WalletHeaderPanel
        primaryButtonClassName={
          walletPrimaryButtonCopied
            ? `${walletPrimaryButtonClass} p2p-wallet-address copied`
            : `${walletPrimaryButtonClass} p2p-wallet-address`
        }
        primaryButtonLabel={walletPrimaryButtonLabel}
        primaryMetaLabel={walletPrimaryButtonIsAddress ? (walletPrimaryButtonCopied ? 'Copied' : 'Copy') : undefined}
        primaryButtonTitle={walletAddress || undefined}
        primaryDisabled={Boolean(connectingWalletId) || (!walletAddress && !preferredWalletOption)}
        onPrimaryAction={handleWalletPrimaryAction}
        modeLabel={walletModeLabel}
        statusLabel={walletStatusLabel}
        action={
          showInlineAesAction ? (
            <button
              type="button"
              className="p2p-wallet-aes-action"
              onClick={() => signAesForCurrentWallet().catch(() => {})}
              disabled={Boolean(connectingWalletId)}
              title="Sign once to unlock encrypted balances and private messaging features."
            >
              {walletAesButtonLabel}
            </button>
          ) : null
        }
        menuOpen={walletMenuOpen}
        onToggleMenu={() => setWalletMenuOpen((previous) => !previous)}
        menuDisabled={Boolean(connectingWalletId)}
        menu={
          <>
            <div className="p2p-wallet-menu-section">
              <span>Browser wallet</span>
              {browserWalletOptions.length > 0 ? (
                browserWalletOptions.map((option) => {
                  const isCurrentBrowserWallet =
                    !connectedWithBurner && walletAddress && option.id === (selectedWalletId || preferredWalletOption?.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={isCurrentBrowserWallet ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                      onClick={() => {
                        setWalletMenuOpen(false);
                        connectWallet(option.id, true).catch(() => {});
                      }}
                      disabled={Boolean(connectingWalletId)}
                      role="menuitem"
                    >
                      {connectingWalletId === option.id ? 'Connecting...' : option.label}
                    </button>
                  );
                })
              ) : (
                <button type="button" className="p2p-wallet-action" disabled role="menuitem">
                  MetaMask or CypherTrade not detected
                </button>
              )}
            </div>

            <div className="p2p-wallet-menu-section">
              <span>App wallet</span>
              <button
                type="button"
                className={connectedWithBurner ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                onClick={() => {
                  setWalletMenuOpen(false);
                  connectBurnerWallet(selectedBurnerWalletId || undefined).catch(() => {});
                }}
                disabled={Boolean(connectingWalletId)}
                role="menuitem"
              >
                {connectingWalletId === 'burner' ? 'Unlocking...' : 'Connect app wallet'}
              </button>
              {burnerWallets.length > 1 ? (
                <select
                  className="p2p-wallet-select"
                  value={selectedBurnerWalletId}
                  onChange={(event) => {
                    setSelectedBurnerWalletId(event.target.value);
                    setWalletMenuOpen(false);
                    connectBurnerWallet(event.target.value).catch(() => {});
                  }}
                  disabled={Boolean(connectingWalletId)}
                  aria-label="Switch burner wallet"
                >
                  {burnerWallets.map((walletRecord, index) => (
                    <option key={walletRecord.id ?? `${walletRecord.privateKey}-${index}`} value={walletRecord.id ?? ''}>
                      {walletRecord.name?.trim() || (walletRecord.address ? shortenAddress(walletRecord.address) : `Wallet ${index + 1}`)}
                    </option>
                  ))}
                </select>
              ) : null}
              <button type="button" className="p2p-wallet-action" onClick={beginGenerateBurnerWallet} role="menuitem">
                Generate wallet
              </button>
              <button type="button" className="p2p-wallet-action" onClick={beginImportBurnerWallet} role="menuitem">
                Import wallet
              </button>
            </div>

            <button
              type="button"
              className="p2p-wallet-action danger"
              onClick={() => {
                setWalletMenuOpen(false);
                disconnectWallet();
              }}
              disabled={Boolean(connectingWalletId) || !walletAddress}
              role="menuitem"
            >
              Disconnect
            </button>
          </>
        }
      />
    ),
    [
      beginGenerateBurnerWallet,
      beginImportBurnerWallet,
      browserWalletOptions,
      burnerWallets,
      connectBurnerWallet,
      connectWallet,
      connectedWithBurner,
      connectingWalletId,
      disconnectWallet,
      handleWalletPrimaryAction,
      preferredWalletOption,
      selectedBurnerWalletId,
      selectedWalletId,
      showInlineAesAction,
      signAesForCurrentWallet,
      walletAddress,
      walletAesButtonLabel,
      walletMenuOpen,
      walletModeLabel,
      walletPrimaryButtonClass,
      walletPrimaryButtonCopied,
      walletPrimaryButtonIsAddress,
      walletPrimaryButtonLabel,
      walletStatusLabel
    ]
  );
  useEffect(() => {
    onHeaderWalletControlChange?.(tradeWalletHeaderControl);
    return () => {
      onHeaderWalletControlChange?.(null);
    };
  }, [onHeaderWalletControlChange, tradeWalletHeaderControl]);
  const tradeHeaderNavigationControl = useMemo(
    () => (
      <nav className="p2p-trade-tabs" aria-label="P2P trade views">
        <button type="button" className={route.view === 'public' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades')}>
          <span>Explore</span>
        </button>
        <button
          type="button"
          className={route.view === 'create' ? 'active' : undefined}
          onClick={startFreshTrade}
        >
          <span>Create Trade</span>
        </button>
        <button type="button" className={route.view === 'trade' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades/open')}>
          <span>Trade</span>
        </button>
        <button type="button" className={route.view === 'mine' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades/mine')}>
          <span>My Trades</span>
        </button>
      </nav>
    ),
    [navigateToTradePath, route.view, startFreshTrade]
  );
  useEffect(() => {
    onHeaderNavigationControlChange?.(tradeHeaderNavigationControl);
    return () => {
      onHeaderNavigationControlChange?.(null);
    };
  }, [onHeaderNavigationControlChange, tradeHeaderNavigationControl]);
  const filteredPublicTrades = useMemo(
    () => publicTrades.filter((trade) => trade.status === 'open' && matchesTradeSearch(trade, tradeSearchInput)),
    [publicTrades, tradeSearchInput]
  );
  const filteredMyTrades = useMemo(
    () => myTrades.filter((trade) => matchesTradeSearch(trade, tradeSearchInput)),
    [myTrades, tradeSearchInput]
  );
  const walletTradeGroups = useMemo(
    () => groupWalletTradesByPerspective(filteredMyTrades, walletAddress),
    [filteredMyTrades, walletAddress]
  );
  const receivedOpenTradeOffers = walletTradeGroups.needsAction;
  const myOpenTrades = walletTradeGroups.myActiveOffers;
  const walletTradeHistory = walletTradeGroups.history;
  const myTradeGroupOptions: Array<{
    id: MyTradeGroupView;
    label: string;
    count: number;
    trades: TradeSnapshot[];
    emptyMessage: string;
    emptySearchMessage: string;
  }> = [
    {
      id: 'received',
      label: 'Received Offers',
      count: receivedOpenTradeOffers.length,
      trades: receivedOpenTradeOffers,
      emptyMessage: 'No trade offers waiting for you.',
      emptySearchMessage: 'No received offers match that search.'
    },
    {
      id: 'active',
      label: 'My Active Trades',
      count: myOpenTrades.length,
      trades: myOpenTrades,
      emptyMessage: 'No active trades created by you.',
      emptySearchMessage: 'No trades you created match that search.'
    },
    {
      id: 'history',
      label: 'Trade History',
      count: walletTradeHistory.length,
      trades: walletTradeHistory,
      emptyMessage: 'No completed, cancelled, or declined trades yet.',
      emptySearchMessage: 'No history matches that search.'
    }
  ];
  const selectedMyTradeGroup =
    myTradeGroupOptions.find((group) => group.id === myTradeGroupView) ?? myTradeGroupOptions[0];
  const tradeSearchPlaceholder =
    route.view === 'mine'
      ? 'Search your trades by token, wallet, status, or id'
      : 'Search public offers by token, pair, wallet, status, or id';
  const createdTradeCopyKey = 'created-trade-link';

  return (
    <main className="standalone-trades-shell p2p-trading-shell">
      {route.view !== 'create' ? (
        <section className={`p2p-market-overview p2p-market-overview-${route.view}`}>
          {route.view === 'public' || route.view === 'mine' ? (
            <div className="p2p-stats-strip" aria-label="P2P trading statistics">
              {route.view === 'public' ? (
                <div>
                  <span>Open offers</span>
                  <strong>{openPublicTradeCount}</strong>
                </div>
              ) : null}
              {route.view === 'mine' ? (
                <>
                  <div>
                    <span>Needs action</span>
                    <strong>{receivedOpenTradeOffers.length}</strong>
                  </div>
                  <div>
                    <span>My active</span>
                    <strong>{myOpenTrades.length}</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{walletTradeHistory.length}</strong>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {route.view === 'public' || route.view === 'mine' ? (
            <label className="p2p-token-search">
              <span>Search trades</span>
              <input
                type="search"
                value={tradeSearchInput}
                onChange={(event) => setTradeSearchInput(event.target.value)}
                placeholder={tradeSearchPlaceholder}
              />
            </label>
          ) : null}

          {route.view === 'trade' ? (
            <form className="p2p-link-open-form p2p-action-open-form" onSubmit={openTradeFromInput}>
              <input
                type="text"
                value={tradeLinkInput}
                onChange={(event) => setTradeLinkInput(event.target.value)}
                placeholder="Paste trade link, compact code, or id"
                aria-label="Trade link, compact code, or trade id"
              />
              <button type="submit">Open Trade</button>
            </form>
          ) : null}

          {walletError || tradeActionError ? <p className="error p2p-market-status">{walletError || tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'public' ? (
        <section className="standalone-trades-section p2p-public-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Directory</p>
              <h2>Open public trades</h2>
            </div>
            <div className="standalone-trades-toolbar">
              <button type="button" className="standalone-trade-secondary-btn" onClick={() => refreshPublicTrades().catch(() => {})}>
                {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {publicTradesError ? <p className="standalone-trade-error">{publicTradesError}</p> : null}
          {loadingPublicTrades && publicTrades.length === 0 ? <p className="standalone-trade-state">Loading public trades...</p> : null}
          {(!loadingPublicTrades || publicTrades.length > 0)
            ? renderTradeList(
              filteredPublicTrades,
              tradeSearchInput ? 'No public trades match that search.' : 'No open public trades found.',
              'p2p-public-trade-grid'
            )
            : null}
        </section>
      ) : null}

      {route.view === 'create' ? (
        <section className="standalone-trade-create-panel">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Create</p>
              <h2>{editingTrade ? `Edit public trade #${editingTrade.tradeId}` : 'New trade'}</h2>
            </div>
            {editingTrade ? (
              <button type="button" className="standalone-trade-secondary-btn" onClick={clearEditTrade}>
                Cancel Edit
              </button>
            ) : (
            <div className="standalone-trade-visibility" role="group" aria-label="Trade visibility">
              <button
                type="button"
                className={tradeVisibility === 'public' ? 'active' : undefined}
                onClick={() => setTradeVisibility('public')}
                aria-pressed={tradeVisibility === 'public'}
              >
                Public
              </button>
              <button
                type="button"
                className={tradeVisibility === 'unlisted' ? 'active' : undefined}
                onClick={() => setTradeVisibility('unlisted')}
                aria-pressed={tradeVisibility === 'unlisted'}
              >
                Private Link
              </button>
              <button
                type="button"
                className={tradeVisibility === 'direct' ? 'active' : undefined}
                onClick={() => setTradeVisibility('direct')}
                aria-pressed={tradeVisibility === 'direct'}
              >
                Direct
              </button>
            </div>
            )}
          </div>
          {!editingTrade && tradeVisibility === 'direct' ? (
            <label className="standalone-trade-recipient p2p-direct-recipient">
              <span>Recipient wallet</span>
              <input
                type="text"
                value={directTradeRecipient}
                onChange={(event) => setDirectTradeRecipient(event.target.value)}
                placeholder="0x..."
                aria-invalid={directTradeRecipientNormalized && !directTradeRecipientIsValid ? 'true' : 'false'}
              />
            </label>
          ) : null}
          <div className="standalone-trade-access-summary">
            <span>Access</span>
            <strong>
              {editingTrade
                ? 'Replacement will be listed publicly'
                : tradeVisibility === 'public'
                ? 'Listed publicly while open'
                : tradeVisibility === 'direct'
                  ? directTradeRecipientIsValid
                    ? `Sent to ${shortenAddress(directTradeRecipientNormalized)}`
                    : 'Visible in the recipient wallet inbox'
                  : 'Full private link required to accept'}
            </strong>
            <p>
              {editingTrade
                ? 'The original public listing is cancelled and the replacement keeps a link back to it.'
                : tradeVisibility === 'direct'
                  ? 'Direct trades are not public listings. The recipient can find the offer under received trades.'
                  : tradeVisibility === 'public'
                    ? 'Public trades appear in the directory while open. On-chain terms remain public to direct contract reads.'
                    : 'Unlisted trades are not shown in the public directory. On-chain terms remain public to direct contract reads.'}
            </p>
          </div>
          {tradeComposer}
          {createdTradeLink ? (
            <div className="standalone-trade-created">
              <div>
                <span>Trade {createdTradeId ? 'created' : 'ready'}</span>
                <strong>{createdTradeLink.replace(/^https?:\/\//, '')}</strong>
              </div>
              <button
                type="button"
                className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
              >
                {lastCopiedKey === createdTradeCopyKey
                  ? 'Copied'
                  : tradeVisibility === 'unlisted'
                    ? 'Copy Private Link'
                    : tradeVisibility === 'direct'
                      ? 'Copy Trade Link'
                      : 'Copy Link'}
              </button>
            </div>
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'trade' ? (
        <section className="standalone-trades-section standalone-trade-detail-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Trade Window</p>
              <h2>{route.tradeId ? 'Review trade' : 'Open a trade link'}</h2>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={() => navigateToTradePath('/trades')}>
              Browse Public
            </button>
          </div>
          <div className="trade-compose-warning p2p-trade-window-warning" role="alert">
            <p>
              <strong>P2P trading risks:</strong> Always verify token contract addresses, amounts, and exchange rates before
              confirming. Only the escrowed asset transfer is enforced on-chain — only trade with parties you trust.
            </p>
          </div>
          {counterParentTrade ? (
            <div className="p2p-counter-panel" ref={counterPanelRef} tabIndex={-1}>
              <div className="p2p-counter-panel-head">
                <div>
                  <p className="landing-eyebrow">Counter Offer</p>
                  <h3>Reply with new terms</h3>
                </div>
                <button type="button" className="standalone-trade-secondary-btn" onClick={clearCounterTrade}>
                  Close Counter
                </button>
              </div>
              <p className="p2p-counter-note">
                {counterParentTrade.counterParentTradeId
                  ? 'This creates a new counter against the original trade and cancels the counter you are replying to in the same transaction.'
                  : 'This creates a linked private trade for the original maker. They can accept it from My Trades or the copied link.'}
              </p>
              {tradeComposer}
            </div>
          ) : null}
          {createdTradeLink && createdTradeId === route.tradeId ? (
            <div className="standalone-trade-created">
              <div>
                <span>Trade #{createdTradeId}</span>
                <strong>{resolvedRouteAccessSecret ? 'Private link ready' : 'Share link ready'}</strong>
              </div>
              <button
                type="button"
                className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
              >
                {lastCopiedKey === createdTradeCopyKey ? 'Copied' : resolvedRouteAccessSecret ? 'Copy Private Link' : 'Copy Link'}
              </button>
            </div>
          ) : null}
          {route.routeError || detailTradeError ? <p className="standalone-trade-error">{route.routeError || detailTradeError}</p> : null}
          {loadingDetailTrade && !detailTrade ? <p className="standalone-trade-state">Loading trade...</p> : null}
          {!loadingDetailTrade && tradeAccessBlocked ? (
            <div className="standalone-trade-state p2p-private-link-state">
              <strong>Private link required</strong>
              <span>Open the full shared link, not only the trade id.</span>
            </div>
          ) : null}
          {!tradeAccessBlocked && detailTrade ? renderTradeCard(detailTrade) : null}
          {!loadingDetailTrade && !detailTrade && !tradeAccessBlocked && !route.routeError && !detailTradeError ? (
            <p className="standalone-trade-state">Paste a trade link or open a public trade from the directory.</p>
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'mine' ? (
        <section className="standalone-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Wallet</p>
              <h2>My trades</h2>
              {walletAddress ? (
                <p className="p2p-wallet-trade-summary">
                  {receivedOpenTradeOffers.length} received offers | {myOpenTrades.length} active trades | {walletTradeHistory.length} history
                </p>
              ) : null}
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={() => refreshMyTrades().catch(() => {})} disabled={!walletAddress}>
              {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {!walletAddress ? <p className="standalone-trade-state">Connect a wallet to view your trades.</p> : null}
          {myTradesError ? <p className="standalone-trade-error">{myTradesError}</p> : null}
          {walletAddress && loadingMyTrades && myTrades.length === 0 ? <p className="standalone-trade-state">Loading your trades...</p> : null}
          {walletAddress && (!loadingMyTrades || myTrades.length > 0) ? (
            <div className="p2p-wallet-trade-groups">
              <div className="p2p-wallet-trade-switcher" role="tablist" aria-label="My trade groups">
                {myTradeGroupOptions.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={group.id === selectedMyTradeGroup.id ? 'active' : undefined}
                    onClick={() => setMyTradeGroupView(group.id)}
                    role="tab"
                    aria-selected={group.id === selectedMyTradeGroup.id}
                  >
                    <span>{group.label}</span>
                    <strong>{group.count}</strong>
                  </button>
                ))}
              </div>
              <section className="p2p-wallet-trade-group" role="tabpanel">
                {renderTradeList(
                  selectedMyTradeGroup.trades,
                  tradeSearchInput ? selectedMyTradeGroup.emptySearchMessage : selectedMyTradeGroup.emptyMessage,
                  'p2p-wallet-trade-grid'
                )}
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="p2p-footer-links">
        <div className="p2p-footer-balances">
          <span>{nativeBalanceWei !== null ? `${formatCotiAmount(nativeBalanceWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : `-- ${TIP_NATIVE_TOKEN_SYMBOL}`}</span>
          <span>{rewardTokenBalanceWei !== null ? `${formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4)} ${rewardTokenSymbol}` : `-- ${rewardTokenSymbol}`}</span>
          <span>{privateRewardTokenBalanceWei !== null ? `${formatTokenAmount(privateRewardTokenBalanceWei, privateRewardTokenDecimals, 4)} ${privateRewardTokenSymbol}` : `-- ${privateRewardTokenSymbol}`}</span>
        </div>
        <a href={`${COTI_NETWORK.blockExplorerUrl}/address/${TRADE_ESCROW_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
          Escrow contract
        </a>
      </div>
      <BurnerPinModal
        isOpen={showBurnerPinModal}
        burnerPinMode={burnerPinMode}
        burnerPinInput={burnerPinInput}
        onBurnerPinInputChange={setBurnerPinInput}
        pinMinLength={BURNER_PIN_MIN_LENGTH}
        error={showBurnerPinModal ? walletError : ''}
        initializingBurner={unlockingBurner}
        onClose={closeBurnerPinModal}
        onSubmit={submitBurnerPin}
      />
      <BurnerImportModal
        isOpen={showBurnerImportModal}
        initializingBurner={unlockingBurner}
        burnerImportInput={burnerImportInput}
        onBurnerImportInputChange={setBurnerImportInput}
        error={showBurnerImportModal ? walletError : ''}
        onClose={() => {
          if (!unlockingBurner) {
            setShowBurnerImportModal(false);
            setBurnerImportInput('');
          }
        }}
        onImport={submitBurnerImport}
      />
    </main>
  );
}
