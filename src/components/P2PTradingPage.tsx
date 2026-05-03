import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  COTI_NETWORK,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  BURNER_PIN_MIN_LENGTH,
  buildTradeSnapshotKey,
  createCotiBrowserProvider,
  formatCotiAmount,
  formatExpiryCountdown,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  getCotiWsLastHealthyAt,
  getProviderErrorMessage,
  hasInsufficientFundsError,
  isWalletAddress,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  mergeOnboardInfo,
  normalizeChainId,
  parseBurnerWalletStorageState,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  resetCotiWsProvider,
  sanitizeTokenAmountInput,
  shortenAddress,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS,
  type BurnerPinMode,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type TradeAssetPayload,
  type TradeFeeModeSelection,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import { getPreferredBrowserWalletId, saveWalletPreference } from '../lib/appStorage';
import { readPrivateTradeRemainingOfferWei } from '../lib/appChain';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  resolveTradePresetKind,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import { deriveTradeComposerModel } from '../lib/tradeComposer';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  orderInjectedWalletOptions
} from '../lib/walletOptions';
import { hasSessionAesKey, type SharedWalletSession } from '../lib/walletSession';
import useP2PWalletHeaderControl from '../hooks/useP2PWalletHeaderControl';
import useP2PTradeRoute, { normalizeAccessSecret, resolveTradeLinkInput } from '../hooks/useP2PTradeRoute';
import useP2PTradeData from '../hooks/useP2PTradeData';
import useP2PTradeActions from '../hooks/useP2PTradeActions';
import useP2PTradeComposerActions from '../hooks/useP2PTradeComposerActions';
import useP2PTradeSigner from '../hooks/useP2PTradeSigner';
import useP2PTradeTokenData from '../hooks/useP2PTradeTokenData';
import useP2PWalletDisconnect from '../hooks/useP2PWalletDisconnect';
import useInjectedWalletOptions from '../hooks/useInjectedWalletOptions';
import { useStoredWalletPreference } from '../hooks/useStoredWalletPreference';
import {
  buildNewBurnerWalletRecord,
  saveBurnerWalletRecordWithPin,
  selectBurnerWalletFromVault
} from '../lib/burnerWalletVault';
import {
  formatTradeRatioLabel,
  groupWalletTradesByPerspective,
  isZeroTradeTakerAddress,
  resolveTradeOrderSummary
} from '../lib/tradePerspective';
import BurnerImportModal from './BurnerImportModal';
import BurnerPinModal from './BurnerPinModal';
import TradeComposerPanel from './TradeComposerPanel';
import TradeOfferCard from './TradeOfferCard';

type TradeVisibility = 'public' | 'unlisted' | 'direct';
type MyTradeGroupView = 'received' | 'active' | 'history';
type PendingBurnerWalletAction = 'connect' | 'generate' | 'import';
type P2PEmptyStateTone = 'default' | 'error' | 'loading' | 'locked';

type P2PTradingPageProps = {
  sharedWalletSession?: SharedWalletSession;
  onDisconnectWallet?: () => Promise<void> | void;
  onHeaderWalletControlChange?: (walletControl: ReactNode | null) => void;
  onHeaderNavigationControlChange?: (navigationControl: ReactNode | null) => void;
};

const WALLET_STATUS_STORAGE_KEY = 'coti-trade-last-wallet-id';
const TRADE_ACCESS_SECRET_STORAGE_KEY = 'coti-trade-access-secrets-v1';
const PRIVATE_TRADE_LIQUIDITY_STORAGE_KEY = 'coti-private-trade-liquidity-v1';
const P2P_VISIBLE_SYNC_INTERVAL_MS = 10_000;
type TradeSigner = JsonRpcSigner | Wallet;

const bytesEqual = (left?: Uint8Array | null, right?: Uint8Array | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

const onboardInfoEqual = (left?: OnboardInfo, right?: OnboardInfo): boolean =>
  (left?.aesKey ?? null) === (right?.aesKey ?? null) &&
  (left?.txHash ?? null) === (right?.txHash ?? null) &&
  bytesEqual(left?.rsaKey?.publicKey, right?.rsaKey?.publicKey) &&
  bytesEqual(left?.rsaKey?.privateKey, right?.rsaKey?.privateKey);

const mergeOnboardInfoByAddress = (
  previous: Record<string, OnboardInfo>,
  cacheKey: string,
  onboardInfo?: OnboardInfo
): Record<string, OnboardInfo> => {
  if (!onboardInfo) {
    return previous;
  }

  const merged = mergeOnboardInfo(previous[cacheKey], onboardInfo);
  if (onboardInfoEqual(previous[cacheKey], merged)) {
    return previous;
  }

  return {
    ...previous,
    [cacheKey]: merged
  };
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

const readInitialTradeBrowserWalletId = (): string => getPreferredBrowserWalletId() || readLegacyTradeBrowserWalletId();

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

const formatTradeListTerms = (trade: TradeSnapshot): string => {
  const displayTerms = getTradeDisplayTerms(trade);
  if (trade.hiddenLiquidity) {
    return `Private liquidity; price ratio ${formatTradeRatioLabel(displayTerms.offer, displayTerms.request) ?? 'unavailable'}`;
  }
  return `${formatTradeAssetDisplayText(displayTerms.offer)} for ${formatTradeAssetDisplayText(displayTerms.request)}`;
};

const formatHiddenFixedPriceTerms = (offer: TradeAssetPayload, request: TradeAssetPayload): string => {
  return formatTradeRatioLabel(offer, request) ?? `${request.symbol}/${offer.symbol}`;
};

const formatTradeRateText = (baseAsset: TradeAssetPayload, quoteAsset: TradeAssetPayload): string => {
  return formatTradeRatioLabel(baseAsset, quoteAsset) ?? 'Rate unavailable';
};

const buildTradeAssetExplorerUrl = (asset: TradeAssetPayload): string => {
  const tokenAddress = asset.tokenAddress?.trim();
  return tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : '';
};

const buildTransactionExplorerUrl = (txHash?: string): string => (txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : '');

const getTradeHistoryKindLabel = (trade: TradeSnapshot): string => {
  if (trade.hiddenLiquidity) {
    return 'Private liquidity';
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
  return trade.isPublic === false ? 'Private offer' : 'Public listing';
};

const getTradeHistoryOutcomeLabel = (trade: TradeSnapshot, statusLabel: string): string => {
  if (trade.status === 'accepted') {
    return trade.acceptedTxHash ? 'Accepted on-chain' : 'Accepted';
  }
  return statusLabel;
};

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

export default function P2PTradingPage({
  sharedWalletSession,
  onDisconnectWallet,
  onHeaderWalletControlChange,
  onHeaderNavigationControlChange
}: P2PTradingPageProps) {
  const { buildTradeShareUrl, navigateToTradePath, openTrade, route, showEmptyTradeRoute } = useP2PTradeRoute();
  const walletPreference = useStoredWalletPreference();
  const preferredBrowserWalletId = getPreferredBrowserWalletId(walletPreference);
  const [walletAddress, setWalletAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState(() => readInitialTradeBrowserWalletId());
  const [connectingWalletId, setConnectingWalletId] = useState('');
  const [connectedWalletLabel, setConnectedWalletLabel] = useState('Wallet');
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>([]);
  const [, setSelectedBurnerWalletId] = useState('');
  const [pendingBurnerWalletId, setPendingBurnerWalletId] = useState('');
  const [pendingBurnerAction, setPendingBurnerAction] = useState<PendingBurnerWalletAction>('connect');
  const [burnerPinMode, setBurnerPinMode] = useState<BurnerPinMode>('unlock');
  const [burnerPinInput, setBurnerPinInput] = useState('');
  const [burnerImportInput, setBurnerImportInput] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
  const [unlockingBurner, setUnlockingBurner] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [appWalletMenuOpen, setAppWalletMenuOpen] = useState(false);
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
  const [tradeActionError, setTradeActionError] = useState('');
  const [creatingTrade, setCreatingTrade] = useState(false);
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
  const injectedWalletOptions = useInjectedWalletOptions();

  const providerRef = useRef<Eip1193Provider | null>(null);
  const burnerWalletRef = useRef<Wallet | null>(null);
  const burnerPinRef = useRef('');
  const signerCacheRef = useRef<Record<string, TradeSigner>>({});
  const skippedSharedWalletKeyRef = useRef('');
  const counterPanelRef = useRef<HTMLDivElement | null>(null);
  const tradeLinkInputRef = useRef<HTMLInputElement | null>(null);

  const allowedBrowserWalletOptions = useMemo(
    () => filterAllowedBrowserWalletOptions(injectedWalletOptions),
    [injectedWalletOptions]
  );
  const prioritizedBrowserWalletId = selectedWalletId || preferredBrowserWalletId;
  const browserWalletOptions = useMemo(
    () => orderInjectedWalletOptions(allowedBrowserWalletOptions, prioritizedBrowserWalletId, 'metamask'),
    [allowedBrowserWalletOptions, prioritizedBrowserWalletId]
  );
  const preferredWalletOption = useMemo(
    () => getPreferredInjectedWalletOption(allowedBrowserWalletOptions, prioritizedBrowserWalletId, 'metamask'),
    [allowedBrowserWalletOptions, prioritizedBrowserWalletId]
  );
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const walletKey = walletAddress.trim().toLowerCase();
  const connectedWithBurner = Boolean(burnerWalletRef.current && walletKey === burnerWalletRef.current.address.toLowerCase());
  const walletHasAes = hasSessionAesKey(walletAddress, onboardInfoByAddress);
  const tradePrimaryWalletKind = walletPreference?.kind === 'app' ? 'app' : 'browser';
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
  const markSharedWalletSkippedAfterLocalAppSwitch = useCallback(
    (nextWalletKey: string) => {
      const sharedWalletKey =
        sharedWalletSession?.activeSignerSource === 'burner'
          ? sharedWalletSession.walletAddress.trim().toLowerCase()
          : '';
      skippedSharedWalletKeyRef.current =
        sharedWalletKey && sharedWalletKey !== nextWalletKey ? sharedWalletKey : '';
    },
    [sharedWalletSession?.activeSignerSource, sharedWalletSession?.walletAddress]
  );

  useEffect(() => {
    if (preferredBrowserWalletId && !walletAddress && !connectingWalletId) {
      setSelectedWalletId(preferredBrowserWalletId);
    }
  }, [connectingWalletId, preferredBrowserWalletId, walletAddress]);

  useEffect(() => {
    const sharedAddress = sharedWalletSession?.walletAddress.trim() ?? '';
    const sharedWalletKey = sharedAddress.toLowerCase();
    if (!sharedAddress) {
      skippedSharedWalletKeyRef.current = '';
    }
    const shouldApplySharedWallet =
      !walletAddress ||
      (sharedWalletSession?.activeSignerSource === 'burner' && connectedWithBurner && walletKey !== sharedWalletKey);

    if (
      !sharedAddress ||
      !shouldApplySharedWallet ||
      connectingWalletId ||
      skippedSharedWalletKeyRef.current === sharedWalletKey
    ) {
      return;
    }

    const sharedOnboardInfo = sharedWalletSession?.sessionOnboardInfo[sharedWalletKey];
    const mergeSharedOnboardInfo = () => {
      if (!sharedOnboardInfo) {
        return;
      }
      setOnboardInfoByAddress((previous) =>
        mergeOnboardInfoByAddress(previous, sharedWalletKey, sharedOnboardInfo)
      );
    };

    if (sharedWalletSession?.activeSignerSource === 'metamask' && sharedWalletSession.browserProvider) {
      providerRef.current = sharedWalletSession.browserProvider;
      burnerWalletRef.current = null;
      signerCacheRef.current = {};
      setWalletAddress(sharedAddress);
      setChainId(sharedWalletSession.chainId);
      setConnectedWalletLabel(sharedWalletSession.browserWalletLabel || 'Browser wallet');
      if (sharedWalletSession.browserWalletId) {
        setSelectedWalletId(sharedWalletSession.browserWalletId);
        saveWalletPreference({ kind: 'browser', browserWalletId: sharedWalletSession.browserWalletId });
      }
      mergeSharedOnboardInfo();
      setWalletError('');
      return;
    }

    if (
      sharedWalletSession?.activeSignerSource === 'burner' &&
      sharedWalletSession.burnerWallet &&
      sharedWalletSession.burnerWallet.address.toLowerCase() === sharedWalletKey
    ) {
      burnerWalletRef.current = sharedWalletSession.burnerWallet;
      providerRef.current = null;
      signerCacheRef.current = { [sharedWalletKey]: sharedWalletSession.burnerWallet };
      if (sharedWalletSession.burnerWallets?.length) {
        setBurnerWallets(sharedWalletSession.burnerWallets);
      }
      setSelectedBurnerWalletId(sharedWalletSession.activeBurnerWalletId ?? '');
      setWalletAddress(sharedAddress);
      setChainId(COTI_NETWORK.chainIdDecimal);
      setConnectedWalletLabel('App wallet');
      setSelectedWalletId('');
      mergeSharedOnboardInfo();
      saveWalletPreference({ kind: 'app' });
      setWalletError('');
    }
  }, [
    connectingWalletId,
    connectedWithBurner,
    sharedWalletSession?.activeSignerSource,
    sharedWalletSession?.activeBurnerWalletId,
    sharedWalletSession?.browserProvider,
    sharedWalletSession?.browserWalletId,
    sharedWalletSession?.browserWalletLabel,
    sharedWalletSession?.burnerWallet,
    sharedWalletSession?.burnerWallets,
    sharedWalletSession?.chainId,
    sharedWalletSession?.sessionOnboardInfo,
    sharedWalletSession?.walletAddress,
    walletAddress,
    walletKey
  ]);

  const toggleTradeRateDirection = useCallback((tradeId: number, escrowContract?: string) => {
    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setReversedRateTradeIds((current) => ({
      ...current,
      [key]: !current[key]
    }));
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
      setSelectedBurnerWalletId('');
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
      skippedSharedWalletKeyRef.current = '';
      providerRef.current = provider;
      setWalletAddress(address);
      setConnectedWalletLabel(walletLabel);
      if (walletId) {
        setSelectedWalletId(walletId);
        saveWalletPreference({ kind: 'browser', browserWalletId: walletId });
        try {
          window.localStorage.setItem(WALLET_STATUS_STORAGE_KEY, walletId);
        } catch {
        }
      }
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
      setChainId(normalizeChainId(currentChain));
    },
    []
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

      setOnboardInfoByAddress((previous) =>
        mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo)
      );
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
        setWalletError('MetaMask or CipherTrade is required to connect a browser wallet.');
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
        const selectedRecord = selectBurnerWalletFromVault(vault, walletId);
        if (!selectedRecord) {
          throw new Error('No saved burner wallet found.');
        }
        if (pin.trim().length >= BURNER_PIN_MIN_LENGTH) {
          burnerPinRef.current = pin.trim();
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

        burnerWalletRef.current = signer;
        signerCacheRef.current[cacheKey] = signer;
        markSharedWalletSkippedAfterLocalAppSwitch(cacheKey);
        setBurnerWallets(vault.wallets);
        setSelectedBurnerWalletId(selectedRecord.id ?? '');
        setWalletAddress(signer.address);
        setConnectedWalletLabel('App wallet');
        setSelectedWalletId('');
        setChainId(COTI_NETWORK.chainIdDecimal);
        setShowBurnerPinModal(false);
        setPendingBurnerWalletId('');
        setBurnerPinInput('');
        saveWalletPreference({ kind: 'app' });

        signer.disableAutoOnboard();
        let onboardInfo = signer.getUserOnboardInfo();
        if (!onboardInfo?.aesKey) {
          const appWalletBalance = await rpcProvider.getBalance(signer.address).catch(() => null);
          if (appWalletBalance !== null && appWalletBalance <= 0n) {
            setWalletError('App wallet selected. Fund it with COTI to unlock privacy and pay gas.');
            return;
          }

          try {
            await signer.generateOrRecoverAes();
          } catch (aesError) {
            const message = aesError instanceof Error ? aesError.message : String(aesError);
            if (hasInsufficientFundsError(message)) {
              setWalletError('App wallet selected. Fund it with COTI to unlock privacy and pay gas.');
              return;
            }
            throw aesError;
          }
          onboardInfo = signer.getUserOnboardInfo();
        }
        if (!onboardInfo?.aesKey) {
          throw new Error('AES key was not returned for burner wallet.');
        }

        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo)
        );
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect app wallet.'));
      } finally {
        setUnlockingBurner(false);
        setConnectingWalletId('');
      }
    },
    [markSharedWalletSkippedAfterLocalAppSwitch, onboardInfoByAddress]
  );

  const connectBurnerWallet = useCallback(
    async (walletId?: string) => {
      setWalletError('');
      setTradeActionError('');
      const warmBurnerWallet = burnerWalletRef.current;
      const walletSelector = walletId?.trim() ?? '';
      const walletSelectorKey = walletSelector.toLowerCase();
      const selectedWalletRecord = burnerWallets.find(
        (walletRecord) =>
          walletRecord.id === walletSelector || walletRecord.address?.toLowerCase() === walletSelectorKey
      );
      const selectedWalletKey = selectedWalletRecord?.address?.toLowerCase() ?? '';
      const firstSavedWalletKey = burnerWallets[0]?.address?.toLowerCase() ?? '';
      const shouldUseWarmBurnerWallet =
        Boolean(warmBurnerWallet) &&
        (
          !walletSelector
            ? !firstSavedWalletKey || firstSavedWalletKey === warmBurnerWallet?.address.toLowerCase()
            : walletSelectorKey === warmBurnerWallet?.address.toLowerCase() ||
              selectedWalletKey === warmBurnerWallet?.address.toLowerCase()
        );
      if (
        warmBurnerWallet &&
        shouldUseWarmBurnerWallet
      ) {
        const cacheKey = warmBurnerWallet.address.toLowerCase();
        markSharedWalletSkippedAfterLocalAppSwitch(cacheKey);
        setWalletAddress(warmBurnerWallet.address);
        setConnectedWalletLabel('App wallet');
        setSelectedWalletId('');
        setChainId(COTI_NETWORK.chainIdDecimal);
        setOnboardInfoByAddress((previous) => {
          const onboardInfo = warmBurnerWallet.getUserOnboardInfo();
          return onboardInfo?.aesKey ? mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo) : previous;
        });
        saveWalletPreference({ kind: 'app' });
        return;
      }

      const storageState = parseBurnerWalletStorageState();
      if (storageState.kind === 'none') {
        setWalletError('No saved app wallet found. Generate or import one from the wallet panel first.');
        return;
      }

      if (storageState.kind === 'encrypted') {
        if (burnerPinRef.current) {
          await unlockBurnerWalletWithPin(walletId, burnerPinRef.current);
          return;
        }

        setPendingBurnerAction('connect');
        setPendingBurnerWalletId(walletId ?? '');
        setBurnerPinMode('unlock');
        setBurnerPinInput('');
        setShowBurnerPinModal(true);
        return;
      }

      await unlockBurnerWalletWithPin(walletId, '');
    },
    [burnerWallets, markSharedWalletSkippedAfterLocalAppSwitch, unlockBurnerWalletWithPin]
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
      const record = await buildNewBurnerWalletRecord(
        pendingBurnerAction === 'generate' ? 'generate' : 'import',
        burnerImportInput
      );
      const vault = await saveBurnerWalletRecordWithPin(record, pin);
      await unlockBurnerWalletWithPin(vault.activeWalletId, pin);
      setShowBurnerImportModal(false);
      setPendingBurnerAction('connect');
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'Failed to save burner wallet.'));
    } finally {
      setUnlockingBurner(false);
      setConnectingWalletId('');
    }
  }, [
    burnerImportInput,
    burnerPinInput,
    pendingBurnerAction,
    pendingBurnerWalletId,
    unlockBurnerWalletWithPin
  ]);

  useEffect(() => {
    if (
      tradePrimaryWalletKind === 'app' ||
      providerRef.current ||
      walletAddress ||
      connectingWalletId ||
      !preferredWalletOption?.provider?.request
    ) {
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
  }, [attachWallet, connectingWalletId, preferredWalletOption, tradePrimaryWalletKind, walletAddress]);

  const getTradeSigner = useP2PTradeSigner({
    burnerWalletRef,
    chainId,
    ensureCotiNetwork,
    mergeOnboardInfoByAddress,
    onboardInfoByAddress,
    providerRef,
    setChainId,
    setOnboardInfoByAddress,
    signerCacheRef,
    walletAddress
  });

  const {
    clearWalletBalances,
    customTradeTokenInfoByAddress,
    loadWalletBalances,
    nativeBalanceWei,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    resolveRequiredFeeForTradeCreate,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    tradeRequiredFeeWei
  } = useP2PTradeTokenData({
    getTradeSigner,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    walletAddress,
    walletHasAes,
    walletKey
  });

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

  const {
    clearMyTrades,
    detailTrade,
    detailTradeError,
    hasActiveListRefresh,
    loadingDetailTrade,
    loadingMyTrades,
    loadingPublicTrades,
    mergeTradeSnapshot,
    myTrades,
    myTradesError,
    publicTrades,
    publicTradesError,
    refreshMyTrades,
    refreshPublicTrades,
    refreshTradeDetail,
    setDetailTrade,
    setDetailTradeError,
    tradeAccessBlocked
  } = useP2PTradeData({
    enrichMakerPrivateProgress,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    resolvedRouteAccessSecret,
    rewardTokenDecimals,
    rewardTokenSymbol,
    routeError,
    routeEscrowContract,
    routeTradeId,
    routeView,
    walletAddress,
    walletKey
  });
  const openPublicTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;

  const revealMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot) => {
      const tradeKey = getSnapshotKey(snapshot);
      setTradeActionError('');
      try {
        setRevealingPrivateTradeKey(tradeKey);
        const revealedSnapshot = await enrichMakerPrivateProgress(snapshot, true);
        if (!revealedSnapshot.makerPrivateProgress) {
          throw new Error('Unable to reveal this private liquidity. Make sure this is your trade and your wallet AES key is available.');
        }
        mergeTradeSnapshot(revealedSnapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reveal this private liquidity.';
        setTradeActionError(message);
      } finally {
        setRevealingPrivateTradeKey('');
      }
    },
    [enrichMakerPrivateProgress, mergeTradeSnapshot]
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
        showEmptyTradeRoute();
        return;
      }

      setDetailTradeError('');
      rememberTradeAccessSecret(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      openTrade(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      setTradeLinkInput('');
    },
    [openTrade, rememberTradeAccessSecret, showEmptyTradeRoute, tradeLinkInput]
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
            ? 'Private liquidity is only available for fixed-price listings.'
            : editingTrade && !editingTrade.hiddenLiquidity
              ? 'Private liquidity cannot be added to a visible-liquidity edit.'
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
  }, [getTradeSigner, loadWalletBalances, onboardTradeWalletAes, walletAddress]);

  const {
    beginCounterTrade,
    beginEditTrade,
    clearCounterTrade,
    clearEditTrade,
    createTrade,
    startFreshTrade
  } = useP2PTradeComposerActions({
    buildTradeShareUrl,
    canEditPublicTrade,
    counterParentTrade,
    directTradeRecipientIsValid,
    directTradeRecipientNormalized,
    editingTrade,
    getTradeSigner,
    hashTradeAccessSecret,
    loadWalletBalances,
    mergeTradeSnapshot,
    navigateToTradePath,
    openTrade,
    openTradeSnapshot,
    refreshMyTrades,
    refreshPublicTrades,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveRequiredFeeForTradeCreate,
    setCounterParentTrade,
    setCreatedTradeId,
    setCreatedTradeLink,
    setCreatingTrade,
    setDetailTrade,
    setDirectTradeRecipient,
    setEditingTrade,
    setTradeActionError,
    setTradeExpiryHoursInput,
    setTradeHidePrivateLiquidity,
    setTradeOfferAmountInput,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestAmountInput,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    setTradeVisibility,
    tradeComposerModel,
    tradeHidePrivateLiquidity,
    tradeVisibility,
    walletAddress,
    walletKey
  });

  const {
    acceptTrade,
    cancelTrade,
    declineTrade,
    partialFillTrade,
    processingTradeActionId
  } = useP2PTradeActions({
    connectedWithBurner,
    getTradeSigner,
    mergeTradeSnapshot,
    refreshTradeDataInBackground,
    refreshTradeDetail,
    resolveKnownTradeAccessSecret,
    resolvedRouteAccessSecret,
    routeEscrowContract,
    routeTradeId,
    setTradeActionError,
    walletAddress
  });

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
        tradeWindowLayout={true}
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
        !hasActiveListRefresh() &&
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
  }, [hasActiveListRefresh, refreshMyTrades, refreshPublicTrades, refreshTradeDetail, routeEscrowContract, routeTradeId, walletAddress]);

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
    const showOpenTradeAction = !isFinishedTrade && !perspective.isMaker;
    const leftSide = orderSummary.primarySide;
    const rightSide = orderSummary.secondarySide;
    const leftExplorerUrl = buildTradeAssetExplorerUrl(leftSide.asset);
    const rightExplorerUrl = buildTradeAssetExplorerUrl(rightSide.asset);
    const pairLabel = orderSummary.directionLabel;
    const leftToneClass = `p2p-offer-term-${leftSide.tone}`;
    const rightToneClass = `p2p-offer-term-${rightSide.tone}`;
    const isRateReversed = Boolean(reversedRateTradeIds[tradeKey]);
    const defaultRatioLabel = formatTradeRatioLabel(leftSide.asset, rightSide.asset);
    const reverseRatioLabel = formatTradeRatioLabel(rightSide.asset, leftSide.asset);
    const hiddenFixedPriceTerms = trade.hiddenLiquidity
      ? isRateReversed
        ? reverseRatioLabel ?? formatHiddenFixedPriceTerms(rightSide.asset, leftSide.asset)
        : defaultRatioLabel ?? formatHiddenFixedPriceTerms(leftSide.asset, rightSide.asset)
      : '';
    const showHiddenPriceSummary = Boolean(trade.hiddenLiquidity);
    const showExplorerHiddenPriceOnly = route.view === 'public' && Boolean(trade.hiddenLiquidity);
    const tradeRateText = trade.hiddenLiquidity
      ? hiddenFixedPriceTerms
      : isRateReversed
        ? reverseRatioLabel ?? formatTradeRateText(rightSide.asset, leftSide.asset)
        : defaultRatioLabel ?? formatTradeRateText(leftSide.asset, rightSide.asset);
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
    const historyFillLabel = trade.hiddenLiquidity
      ? makerPrivateProgressSummary?.filledLabel ?? 'Private fill'
      : completionSummary?.filledLabel ?? (trade.status === 'accepted' ? 'Filled' : 'No fill recorded');
    const historyRemainingLabel = trade.hiddenLiquidity
      ? makerPrivateProgressSummary?.remainingLabel ?? 'Amounts hidden'
      : completionSummary?.remainingLabel ?? (trade.status === 'accepted' ? 'Settled' : 'No remaining fill data');

    return (
      <article
        key={tradeKey}
        className={[
          'p2p-offer-card',
          `p2p-offer-card-${trade.status}`,
          trade.hiddenLiquidity ? 'p2p-offer-card-private-liquidity' : ''
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="p2p-offer-card-head">
          <div className="p2p-offer-title">
            <h3 title={formatTradeListTerms(trade)}>{pairLabel}</h3>
            <p>
              #{trade.tradeId}
              {trade.hiddenLiquidity ? <span>Private liquidity</span> : null}
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
            aria-label={`Flip price ratio for trade ${trade.tradeId}. Current ratio: ${hiddenFixedPriceTerms}.`}
          >
            <span>Price ratio</span>
            <strong>{hiddenFixedPriceTerms}</strong>
            <small>Amounts and fills stay private.</small>
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
              <span>{makerPrivateProgressSummary ? 'Your private liquidity' : 'Completion'}</span>
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
                aria-label={`Flip rate for trade ${trade.tradeId}. Current ratio: ${tradeRateText}.`}
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
          <>
            <div className="p2p-offer-history-details">
              <div>
                <span>Created</span>
                <strong>{formatMessageTimestamp(trade.createdAt)}</strong>
              </div>
              <div>
                <span>Outcome</span>
                <strong>{getTradeHistoryOutcomeLabel(trade, statusLabel)}</strong>
              </div>
              <div>
                <span>Fill</span>
                <strong>{historyFillLabel}</strong>
                <small>{historyRemainingLabel}</small>
              </div>
              <div>
                <span>Type</span>
                <strong>{getTradeHistoryKindLabel(trade)}</strong>
              </div>
            </div>
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
          </>
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
                {showOpenTradeAction ? (
                  <button type="button" className="p2p-offer-open-btn" onClick={() => openTradeSnapshot(trade)} title="Open trade">
                    Open trade
                  </button>
                ) : null}
                {canRevealMakerPrivateProgress ? (
                  <button
                    type="button"
                    className="p2p-offer-counter-btn"
                    onClick={() => revealMakerPrivateProgress(trade).catch(() => {})}
                    disabled={revealingPrivateTradeKey === tradeKey}
                    title="Reveal your private liquidity with your wallet AES key"
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

  const renderP2PEmptyState = (
    title: string,
    description: string,
    actions?: ReactNode,
    tone: P2PEmptyStateTone = 'default'
  ) => (
    <div className={`p2p-empty-state${tone !== 'default' ? ` p2p-empty-state-${tone}` : ''}`}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {actions ? <div className="p2p-empty-actions">{actions}</div> : null}
    </div>
  );

  const renderTradeList = (trades: TradeSnapshot[], emptyLabel: string, gridClassName = '', emptyState?: ReactNode) =>
    trades.length > 0 ? (
      <div className={`p2p-offer-grid${gridClassName ? ` ${gridClassName}` : ''}`}>
        {trades.map((trade) => renderTradeOverviewCard(trade))}
      </div>
    ) : (
      emptyState ?? <p className="standalone-trade-state">{emptyLabel}</p>
    );
  const disconnectP2PWallet = useP2PWalletDisconnect({
    burnerWalletRef,
    clearMyTrades,
    clearWalletBalances,
    onDisconnectWallet,
    providerRef,
    selectedSharedWalletAddress: sharedWalletSession?.walletAddress,
    setChainId,
    setConnectedWalletLabel,
    setSelectedBurnerWalletId,
    setSelectedWalletId,
    setSkippedSharedWalletKey: (walletKey) => {
      skippedSharedWalletKeyRef.current = walletKey;
    },
    setTradeActionError,
    setWalletAddress,
    setWalletError,
    signerCacheRef,
    walletAddress,
    walletStatusStorageKey: WALLET_STATUS_STORAGE_KEY
  });
  const disconnectWallet = useCallback(async () => {
    burnerPinRef.current = '';
    await disconnectP2PWallet();
  }, [disconnectP2PWallet]);
  const getConnectedProvider = useCallback(() => providerRef.current, []);
  const {
    handleWalletPrimaryAction,
    tradePrimaryConnectsAppWallet,
    tradeWalletHeaderControl,
    walletPrimaryButtonLabel
  } = useP2PWalletHeaderControl({
    appWalletMenuOpen,
    beginGenerateBurnerWallet,
    beginImportBurnerWallet,
    browserWalletOptions,
    burnerWallets,
    chainId,
    connectedWalletLabel,
    connectedWithBurner,
    connectingWalletId,
    connectBurnerWallet,
    connectWallet,
    copyWithFeedback,
    disconnectWallet,
    ensureCotiNetwork,
    getConnectedProvider,
    hasConnectedAppWallet: Boolean(burnerWalletRef.current),
    hasConnectedBrowserWallet: Boolean(providerRef.current),
    lastCopiedKey,
    onCotiNetwork,
    preferredWalletOption,
    selectedWalletId,
    setAppWalletMenuOpen,
    setSelectedBurnerWalletId,
    setWalletError,
    setWalletMenuOpen,
    sharedWalletSession,
    signAesForCurrentWallet,
    tradePrimaryWalletKind,
    walletAddress,
    walletHasAes,
    walletMenuOpen
  });
  useEffect(() => {
    onHeaderWalletControlChange?.(tradeWalletHeaderControl);
    return () => {
      onHeaderWalletControlChange?.(null);
    };
  }, [onHeaderWalletControlChange, tradeWalletHeaderControl]);
  const tradeHeaderNavigationControl = useMemo(
    () => (
      <nav className="p2p-trade-tabs" aria-label="P2P trade views">
        <button
          type="button"
          className={route.view === 'public' ? 'active' : undefined}
          aria-current={route.view === 'public' ? 'page' : undefined}
          onClick={() => navigateToTradePath('/trades')}
        >
          <span>Market</span>
        </button>
        <button
          type="button"
          className={route.view === 'create' ? 'active' : undefined}
          aria-current={route.view === 'create' ? 'page' : undefined}
          onClick={startFreshTrade}
        >
          <span>Create</span>
        </button>
        <button
          type="button"
          className={route.view === 'trade' ? 'active' : undefined}
          aria-current={route.view === 'trade' ? 'page' : undefined}
          onClick={() => navigateToTradePath('/trades/open')}
        >
          <span>Trade</span>
        </button>
        <button
          type="button"
          className={route.view === 'mine' ? 'active' : undefined}
          aria-current={route.view === 'mine' ? 'page' : undefined}
          onClick={() => navigateToTradePath('/trades/mine')}
        >
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
  const showTradeSearch = route.view === 'public' || (route.view === 'mine' && Boolean(walletAddress));
  const tradeSearchPlaceholder =
    route.view === 'mine'
      ? 'Search your trades by token, wallet, status, or id'
      : 'Search public offers by token, pair, wallet, status, or id';
  const tradeSearchSummary =
    route.view === 'mine'
      ? `${selectedMyTradeGroup.trades.length} ${selectedMyTradeGroup.label.toLowerCase()}`
      : `${filteredPublicTrades.length} of ${openPublicTradeCount} open`;
  const createdTradeCopyKey = 'created-trade-link';
  const focusTradeLinkInput = () => {
    tradeLinkInputRef.current?.focus();
  };

  return (
    <main className="standalone-trades-shell p2p-trading-shell">
      {route.view !== 'create' ? (
        <section
          className={`p2p-market-overview p2p-market-overview-${route.view}${
            route.view === 'mine' && !showTradeSearch ? ' p2p-market-overview-summary-only' : ''
          }`}
        >
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

          {showTradeSearch ? (
            <label className="p2p-token-search">
              <span className="p2p-token-search-head">
                <span className="p2p-token-search-label">Search trades</span>
                <small>{tradeSearchSummary}</small>
              </span>
              <span className="p2p-token-search-input-wrap">
                <input
                  type="search"
                  value={tradeSearchInput}
                  onChange={(event) => setTradeSearchInput(event.target.value)}
                  placeholder={tradeSearchPlaceholder}
                />
                {tradeSearchInput ? (
                  <button type="button" onClick={() => setTradeSearchInput('')} aria-label="Clear trade search">
                    Clear
                  </button>
                ) : null}
              </span>
            </label>
          ) : null}

          {route.view === 'trade' ? (
            <form className="p2p-link-open-form p2p-action-open-form" onSubmit={openTradeFromInput}>
              <input
                ref={tradeLinkInputRef}
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
          {publicTradesError
            ? renderP2PEmptyState(
              'Market refresh failed',
              publicTradesError,
              <button type="button" onClick={() => refreshPublicTrades().catch(() => {})} disabled={loadingPublicTrades}>
                {loadingPublicTrades ? 'Refreshing...' : 'Retry'}
              </button>,
              'error'
            )
            : null}
          {loadingPublicTrades && publicTrades.length === 0
            ? renderP2PEmptyState(
              'Loading public trades',
              'Reading open offers from escrow events.',
              undefined,
              'loading'
            )
            : null}
          {(!publicTradesError || publicTrades.length > 0) && (!loadingPublicTrades || publicTrades.length > 0)
            ? renderTradeList(
              filteredPublicTrades,
              tradeSearchInput ? 'No public trades match that search.' : 'No open public trades found.',
              'p2p-public-trade-grid',
              renderP2PEmptyState(
                tradeSearchInput ? 'No matching public offers' : 'No public offers right now',
                tradeSearchInput
                  ? 'Try a token symbol, wallet address, status, or trade id.'
                  : 'The directory is live, but there are no open public listings to review yet.',
                tradeSearchInput ? (
                  <>
                    <button type="button" onClick={() => setTradeSearchInput('')}>
                      Clear search
                    </button>
                    <button type="button" onClick={() => refreshPublicTrades().catch(() => {})} disabled={loadingPublicTrades}>
                      {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={startFreshTrade}>
                      Create Trade
                    </button>
                    <button type="button" onClick={() => refreshPublicTrades().catch(() => {})} disabled={loadingPublicTrades}>
                      {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </>
                )
              )
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
            ) : null}
          </div>
          <div className="standalone-trade-options">
            {!editingTrade ? (
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
          {route.routeError || detailTradeError
            ? renderP2PEmptyState(
              'Trade could not load',
              route.routeError || detailTradeError,
              <>
                {routeTradeId !== null ? (
                  <button
                    type="button"
                    onClick={() => refreshTradeDetail(routeTradeId, routeEscrowContract).catch(() => {})}
                    disabled={loadingDetailTrade}
                  >
                    {loadingDetailTrade ? 'Loading...' : 'Retry'}
                  </button>
                ) : (
                  <button type="button" onClick={focusTradeLinkInput}>
                    Paste Link
                  </button>
                )}
                <button type="button" onClick={() => navigateToTradePath('/trades')}>
                  Open Market
                </button>
              </>,
              'error'
            )
            : null}
          {loadingDetailTrade && !detailTrade
            ? renderP2PEmptyState(
              'Loading trade',
              'Reading escrow terms and access rules.',
              undefined,
              'loading'
            )
            : null}
          {!loadingDetailTrade && tradeAccessBlocked ? (
            renderP2PEmptyState(
              'Private link required',
              'Paste the full shared link, not only the trade id.',
              <>
                <button type="button" onClick={focusTradeLinkInput}>
                  Paste Link
                </button>
                <button type="button" onClick={() => navigateToTradePath('/trades')}>
                  Open Market
                </button>
              </>,
              'locked'
            )
          ) : null}
          {!tradeAccessBlocked && detailTrade ? renderTradeCard(detailTrade) : null}
          {!loadingDetailTrade && !detailTrade && !tradeAccessBlocked && !route.routeError && !detailTradeError ? (
            renderP2PEmptyState(
              'Open a trade window',
              'Paste a shared trade link, compact code, or trade id above.',
              <>
                <button type="button" onClick={focusTradeLinkInput}>
                  Paste Link
                </button>
                <button type="button" onClick={() => navigateToTradePath('/trades')}>
                  Open Market
                </button>
              </>
            )
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
          {!walletAddress
            ? renderP2PEmptyState(
              'Connect to see your trades',
              'Received offers, active listings, counters, and history are grouped here once your trading wallet is connected.',
              <button
                type="button"
                onClick={handleWalletPrimaryAction}
                disabled={Boolean(connectingWalletId) || (!preferredWalletOption && !tradePrimaryConnectsAppWallet)}
              >
                {walletPrimaryButtonLabel}
              </button>,
              'locked'
            )
            : null}
          {myTradesError
            ? renderP2PEmptyState(
              'My trades could not load',
              myTradesError,
              walletAddress ? (
                <button type="button" onClick={() => refreshMyTrades().catch(() => {})} disabled={loadingMyTrades}>
                  {loadingMyTrades ? 'Refreshing...' : 'Retry'}
                </button>
              ) : undefined,
              'error'
            )
            : null}
          {walletAddress && loadingMyTrades && myTrades.length === 0
            ? renderP2PEmptyState(
              'Loading your trades',
              'Checking received offers, active listings, counters, and history.',
              undefined,
              'loading'
            )
            : null}
          {walletAddress && (!myTradesError || myTrades.length > 0) && (!loadingMyTrades || myTrades.length > 0) ? (
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
                  'p2p-wallet-trade-grid',
                  renderP2PEmptyState(
                    tradeSearchInput ? `No ${selectedMyTradeGroup.label.toLowerCase()} match` : selectedMyTradeGroup.emptyMessage,
                    tradeSearchInput
                      ? 'Clear the search or try another token, wallet, status, or id.'
                      : selectedMyTradeGroup.id === 'received'
                        ? 'Direct and counter offers sent to this wallet will appear here for review.'
                        : selectedMyTradeGroup.id === 'active'
                          ? 'Create a public, private-link, or direct offer to start tracking it here.'
                          : 'Settled, cancelled, declined, and expired trades will collect here.',
                    tradeSearchInput ? (
                      <>
                        <button type="button" onClick={() => setTradeSearchInput('')}>
                          Clear search
                        </button>
                        <button type="button" onClick={() => refreshMyTrades().catch(() => {})} disabled={loadingMyTrades}>
                          {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </>
                    ) : selectedMyTradeGroup.id === 'active' ? (
                      <button type="button" onClick={startFreshTrade}>
                        Create Trade
                      </button>
                    ) : (
                      <button type="button" onClick={() => refreshMyTrades().catch(() => {})} disabled={loadingMyTrades}>
                        {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
                      </button>
                    )
                  )
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
