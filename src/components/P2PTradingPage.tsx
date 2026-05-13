import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { ArrowLeftRight, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  COTI_NETWORK,
  TIP_NATIVE_TOKEN_SYMBOL,
  DIRECT_TRADE_ESCROW_CONTRACT_ABI,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  BURNER_PIN_MIN_LENGTH,
  buildTradeSnapshotKey,
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
  loadCotiReadProvider,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  mergeOnboardInfo,
  normalizeChainId,
  parseTokenAmountInput,
  parseBurnerWalletStorageState,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  REWARD_TOKEN_ADDRESS,
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
  type TradeSnapshot
} from '../lib/appShared';
import { getPreferredBrowserWalletId, saveWalletPreference } from '../lib/appStorage';
import {
  buildWalletAesHealthState,
  clearCotiAesUnlockRequest,
  clearFallbackAesSessionOnboardInfo,
  createWalletScopedSnapAesState,
  getOrRecoverAesForWalletResult,
  readFallbackAesSessionOnboardInfo,
  resetOnboardInfoForFreshAes,
  resetSignerOnboardInfoForFreshAes,
  resolveWalletScopedSnapAesState,
  type WalletScopedSnapAesState
} from '../lib/cotiAesUnlock';
import { getCotiSnapAesStatus, type CotiSnapAesStatus } from '../lib/cotiSnap';
import {
  fetchPrivateOrderFillReceiptsForWallet,
  fetchRecurringExecutionRowsForWallet,
  fetchRecurringPrivateInventorySnapshotsForWallet,
  fetchRecurringPrivateFillReceiptsForWallet,
  readCurrentPrivateErc20BalanceWei,
  readPrivateTradeRemainingOfferWei,
  recoverTradeAccessPayloadForMaker,
  revealDirectTradeTermsForWallet,
  resolveTradeEscrowContractConfig
} from '../lib/appChain';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  HOTDOG_PRIVATE_TOKEN_ADDRESS,
  buildTradeCustomTokenInfoKey,
  getOnChainFailureMessage,
  resolvePrivateTokenBalancePrivacyAction,
  type ResolvedTradeToken,
  resolveTradePresetKind,
  type PrivateTokenBalancePrivacyAction,
  type PrivateTokenBalanceState,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import { deriveTradeComposerModel } from '../lib/tradeComposer';
import {
  deriveRecurringLiquidityInputFromReceive,
  deriveRecurringReceiveAmountInput,
  deriveTradePricingUpdate,
  nextTradePricingEditedFields,
  type TradePricingField
} from '../lib/tradePricing';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  isMobileBrowserUserAgent,
  orderInjectedWalletOptions
} from '../lib/walletOptions';
import {
  connectMetaMaskMobile,
  logMetaMaskMobileProviderSelection,
  logMetaMaskMobileRequestMethod,
  METAMASK_CONNECT_MOBILE_WALLET_ID,
  METAMASK_CONNECT_MOBILE_WALLET_LABEL,
  resolveMetaMaskMobileInjectedWalletOption,
  shouldUseMetaMaskConnectMobile,
  waitForMetaMaskMobileInjectedWalletOption
} from '../lib/metamaskConnectMobile';
import { ensureProviderOnCotiNetwork } from '../lib/walletNetwork';
import {
  hasSessionAesKey,
  resolveTradingBrowserWalletState,
  type SharedWalletSession
} from '../lib/walletSession';
import useP2PWalletHeaderControl from '../hooks/useP2PWalletHeaderControl';
import useP2PTradeRoute, {
  clearPendingTradeTerminalRoute,
  normalizeAccessSecret,
  resolveTradeLinkInput,
  resolveTradeRouteFromParts
} from '../hooks/useP2PTradeRoute';
import useP2PTradeData from '../hooks/useP2PTradeData';
import useP2PTradeActions from '../hooks/useP2PTradeActions';
import useP2PTradeComposerActions from '../hooks/useP2PTradeComposerActions';
import useP2PTradeSigner from '../hooks/useP2PTradeSigner';
import useP2PTradeTokenData from '../hooks/useP2PTradeTokenData';
import useP2PWalletDisconnect from '../hooks/useP2PWalletDisconnect';
import useBlockTimestampCache from '../hooks/useBlockTimestampCache';
import useInjectedWalletOptions from '../hooks/useInjectedWalletOptions';
import { useStoredWalletPreference } from '../hooks/useStoredWalletPreference';
import { doesAccessSecretMatchHash, normalizeAccessHash, PRIVATE_LINK_SECRET_MISMATCH_MESSAGE } from '../lib/tradeLinks';
import {
  mergeP2PSyncRequests,
  shouldUseSilentP2PSync,
  type P2PSyncDomain,
  type P2PSyncReason,
  type P2PSyncRequest
} from '../lib/p2pSyncCoordinator';
import {
  createRecurringOrderOnChain,
  editRecurringOrderOnChain,
  fillRecurringOrderSideOnChain,
  updateRecurringOrderStatusOnChain
} from '../lib/tradeActions';
import {
  buildNewBurnerWalletRecord,
  saveBurnerWalletRecordWithPin,
  selectBurnerWalletFromVault
} from '../lib/burnerWalletVault';
import {
  formatTradeRatioLabel,
  groupWalletTradesByPerspective,
  isZeroTradeTakerAddress,
  resolveRecurringPriceDeskDisplay,
  resolveTradePriceRatioDisplay,
  resolveTradeOrderSummary
} from '../lib/tradePerspective';
import {
  buildTradeLifecycleHistoryRows,
  buildTradeTransactionHistoryRows,
  type TradeLifecycleHistoryRow,
  type TradeTransactionHistoryRow
} from '../lib/tradeHistory';
import {
  PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE,
  canUseWalletAuthorityForDirectAccess,
  canCreateCounterOffer,
  getCounterOfferUnavailableReason
} from '../lib/tradeCounterSupport';
import { applyTradeRecoveryPayloadToSnapshot } from '../lib/tradeRecoveryPayload';
import {
  isWalletTransactionFlowActive,
  readWalletTransactionFlowTrace,
  recordWalletTransactionFlowStage,
  runWalletTransactionFlow
} from '../lib/walletTransactionFlow';
import {
  getCurrentRouteForDiagnostics,
  logMobileWalletDiagnostic
} from '../lib/mobileWalletDiagnostics';
import {
  isWalletBootstrapRoute,
  isWalletBootstrapStableUrl,
  resolveWalletBootstrapActiveRoute
} from '../lib/walletBootstrapRoute';
import {
  WALLET_STATUS_STORAGE_KEY,
  buildTradeAssetExplorerUrl,
  buildTransactionExplorerUrl,
  canEditPublicTrade,
  formatHiddenFixedPriceTerms,
  formatTradeExpiryParts,
  formatTradeListTerms,
  formatTradeRateText,
  filterAndSortTradeDesk,
  getMakerPrivateProgressSummary,
  getRemainingOfferAmount,
  getRemainingRequestAmount,
  getRecurringTerminalSideState,
  getSnapshotKey,
  getTradeCompletionSummary,
  getTradeDisplayTerms,
  getTradeHistoryKindLabel,
  getTradeHistoryOutcomeLabel,
  getTradePairFilterOptions,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms,
  isDirectWalletTrade,
  isHiddenLiquidityTrade,
  loadStoredPrivateTradeLiquidity,
  loadStoredTradeAccessSecrets,
  readInitialTradeBrowserWalletId,
  shouldRecoverMakerTradePayload,
  storePrivateTradeLiquidity,
  storeTradeAccessSecrets,
  type RecurringTerminalActionSide,
  type TradeDeskSortMode,
  type TradeDeskTypeFilter
} from '../lib/p2pTradeView';
import BurnerImportModal from './BurnerImportModal';
import BurnerPinModal from './BurnerPinModal';
import TradingContractsModal from './TradingContractsModal';
import TradeComposerPanel, { TradeTokenSelect } from './TradeComposerPanel';

type TradeVisibility = 'public' | 'unlisted' | 'direct';
type MyTradeGroupView = 'received' | 'active' | 'history';
type PendingBurnerWalletAction = 'connect' | 'generate' | 'import';
type P2PEmptyStateTone = 'default' | 'error' | 'loading' | 'locked';
type TradeCreateMode = 'one-off' | 'recurring';
type TerminalFillInputSide = 'pay' | 'buy';
type MakerControlsSurface = 'desk' | 'terminal';
type TradeOpenActionCta =
  | { kind: 'direction'; fromSymbol: string; toSymbol: string; label: string }
  | { kind: 'cycle'; fromSymbol: string; toSymbol: string; label: string }
  | { kind: 'manage' | 'view'; label: string };
type TradeOverviewCardOptions = {
  canOpenTerminal?: boolean;
  groupId?: MyTradeGroupView;
  onOpenTerminal?: (snapshot: TradeSnapshot) => void;
  selected?: boolean;
};
type TradeProgressSummary = {
  percent: number;
  percentLabel: string;
  filledLabel: string;
  remainingLabel: string;
  totalLabel: string;
  filledAmountLabel?: string;
  remainingAmountLabel?: string;
  paymentAmountLabel?: string;
  paymentTotalLabel?: string;
  hasFills?: boolean;
};
type TerminalHistoryPanelConfig = {
  tradeKey: string;
  title: string;
  count: number;
  emptyCopy: string;
  children?: ReactNode;
  revealAction?: () => void;
  revealLabel?: string;
  revealPending?: boolean;
};

const buildMakerControlsKey = (surface: MakerControlsSurface, tradeKey: string): string => `${surface}:${tradeKey}`;

type P2PTradingPageProps = {
  isMobileNav?: boolean;
  sharedWalletSession?: SharedWalletSession;
  onDisconnectWallet?: () => Promise<void> | void;
  onHeaderWalletControlChange?: (walletControl: ReactNode | null) => void;
};

const P2P_VISIBLE_SYNC_INTERVAL_MS = 20_000;
const EMPTY_STALE_TOKEN_ADDRESSES: string[] = [];
type TradeSigner = JsonRpcSigner | Wallet;
type QueuedTradeDataRefresh = P2PSyncRequest<TradeSigner>;
type RecurringFundingBalanceResult = {
  balanceWei: bigint | null;
  unavailableMessage?: string;
};

const decimalScale = (decimals: number): bigint => 10n ** BigInt(Math.max(0, Math.floor(decimals)));

const formatDecimalInput = (wholeUnits: bigint, decimals: number): string => {
  if (wholeUnits <= 0n) {
    return '';
  }
  const scale = decimalScale(decimals);
  const whole = wholeUnits / scale;
  const fraction = wholeUnits % scale;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText}`;
};

const parseTokenAmountString = (value?: string): bigint => {
  const normalizedValue = value?.trim() ?? '';
  if (!/^\d+$/.test(normalizedValue)) {
    return 0n;
  }
  try {
    return BigInt(normalizedValue);
  } catch {
    return 0n;
  }
};

const formatExactTokenAmountInput = (amount: bigint, decimals: number): string => {
  if (amount <= 0n) {
    return '';
  }
  if (decimals <= 0) {
    return amount.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
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

const getVisibleOfferLiquiditySummary = (trade: TradeSnapshot): TradeProgressSummary | null => {
  try {
    const filledOfferAmount = BigInt(trade.fillState?.filledOfferAmount ?? '0');
    const remainingOfferAmount = getRemainingOfferAmount(trade);
    const filledRequestAmount = BigInt(trade.fillState?.filledRequestAmount ?? '0');
    const remainingRequestAmount = getRemainingRequestAmount(trade);
    const totalOfferAmount = filledOfferAmount + remainingOfferAmount;
    if (totalOfferAmount <= 0n) {
      return null;
    }

    const rawPercent = Number((filledOfferAmount * 10_000n) / totalOfferAmount) / 100;
    const percent =
      filledOfferAmount <= 0n
        ? 0
        : remainingOfferAmount <= 0n
          ? 100
          : Math.max(1, Math.min(99, rawPercent));
    const percentLabel = `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}% filled`;
    const totalRequestAmount = filledRequestAmount + remainingRequestAmount;
    const paymentAmountLabel = `${formatTokenAmount(totalRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`;

    return {
      percent,
      percentLabel,
      totalLabel: `${formatTokenAmount(totalOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} total`,
      paymentAmountLabel,
      paymentTotalLabel: `${paymentAmountLabel} order value`,
      filledAmountLabel: `${formatTokenAmount(filledOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`,
      remainingAmountLabel: `${formatTokenAmount(remainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`,
      filledLabel: `${formatTokenAmount(filledOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} filled`,
      remainingLabel: `${formatTokenAmount(remainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol} remaining`,
      hasFills: filledOfferAmount > 0n
    };
  } catch {
    return null;
  }
};

const formatPriceInputFromTerms = (
  baseAmountRaw: string,
  quoteAmountRaw: string,
  baseDecimals: number,
  quoteDecimals: number
): string => {
  const baseAmount = BigInt(baseAmountRaw || '0');
  const quoteAmount = BigInt(quoteAmountRaw || '0');
  if (baseAmount <= 0n || quoteAmount <= 0n) {
    return '';
  }
  const priceScale = decimalScale(RECURRING_PRICE_DECIMALS);
  const scaledPrice =
    (quoteAmount * decimalScale(baseDecimals) * priceScale) / (baseAmount * decimalScale(quoteDecimals));
  return formatDecimalInput(scaledPrice, RECURRING_PRICE_DECIMALS);
};

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

const pricingFieldsEqual = (left: TradePricingField[], right: TradePricingField[]): boolean =>
  left.length === right.length && left.every((field, index) => field === right[index]);

const RECURRING_PRICE_DECIMALS = 18;
const RECURRING_PRICE_SCALE = 10n ** BigInt(RECURRING_PRICE_DECIMALS);

const tokenUnitWei = (decimals: number): bigint => {
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.min(36, Math.trunc(decimals))) : 18;
  return 10n ** BigInt(safeDecimals);
};

const resolveRecurringSideTerms = ({
  baseAmountWei,
  quoteAmountWei,
  priceInput,
  baseDecimals,
  quoteDecimals,
  forcePriceOnly = false
}: {
  baseAmountWei: bigint | null;
  quoteAmountWei: bigint | null;
  priceInput: string;
  baseDecimals: number;
  quoteDecimals: number;
  forcePriceOnly?: boolean;
}): { baseAmountWei: bigint; quoteAmountWei: bigint } | null => {
  if (!forcePriceOnly && baseAmountWei && quoteAmountWei && baseAmountWei > 0n && quoteAmountWei > 0n) {
    return { baseAmountWei, quoteAmountWei };
  }

  const priceScaled = parseTokenAmountInput(priceInput, RECURRING_PRICE_DECIMALS);
  if (!priceScaled || priceScaled <= 0n) {
    return null;
  }

  const priceQuoteAmountWei = (priceScaled * tokenUnitWei(quoteDecimals)) / RECURRING_PRICE_SCALE;
  if (priceQuoteAmountWei <= 0n) {
    return null;
  }

  return {
    baseAmountWei: tokenUnitWei(baseDecimals),
    quoteAmountWei: priceQuoteAmountWei
  };
};

function RecurringCycleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 7h9.5a3.5 3.5 0 0 1 0 7H15" />
      <path d="M8.5 4.5 6 7l2.5 2.5" />
      <path d="M17 17H7.5a3.5 3.5 0 0 1 0-7H9" />
      <path d="M15.5 19.5 18 17l-2.5-2.5" />
    </svg>
  );
}

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

export default function P2PTradingPage({
  isMobileNav = false,
  sharedWalletSession,
  onDisconnectWallet,
  onHeaderWalletControlChange
}: P2PTradingPageProps) {
  const {
    buildTradeShareUrl,
    navigateToTradePath,
    openTrade,
    rememberTradeTerminalReturn,
    route,
    showEmptyTradeRoute
  } = useP2PTradeRoute();
  const { resolveBlockTimestampMap } = useBlockTimestampCache();
  const walletPreference = useStoredWalletPreference();
  const preferredBrowserWalletId = getPreferredBrowserWalletId(walletPreference);
  const initialSharedWalletAddress = sharedWalletSession?.walletAddress.trim() ?? '';
  const initialSharedWalletKey = initialSharedWalletAddress.toLowerCase();
  const initialSharedBrowserWallet =
    sharedWalletSession?.activeSignerSource === 'metamask' ? sharedWalletSession : null;
  const initialSharedAppWallet =
    sharedWalletSession?.activeSignerSource === 'burner' ? sharedWalletSession : null;
  const sharedWalletActions = sharedWalletSession?.actions;
  const sharedWalletActionsAvailable = Boolean(sharedWalletActions);
  const [localWalletAddress, setWalletAddress] = useState(() => initialSharedWalletAddress);
  const [localChainId, setChainId] = useState<number | null>(() =>
    initialSharedWalletAddress ? sharedWalletSession?.chainId ?? null : null
  );
  const [walletError, setWalletError] = useState('');
  const [localSelectedWalletId, setSelectedWalletId] = useState(() =>
    initialSharedBrowserWallet?.browserWalletId || readInitialTradeBrowserWalletId()
  );
  const [connectingWalletId, setConnectingWalletId] = useState('');
  const [localConnectedWalletLabel, setConnectedWalletLabel] = useState(
    () => initialSharedBrowserWallet?.browserWalletLabel || (initialSharedAppWallet ? 'App wallet' : 'Wallet')
  );
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>(
    () => initialSharedAppWallet?.burnerWallets ?? []
  );
  const [, setSelectedBurnerWalletId] = useState(
    () => initialSharedAppWallet?.activeBurnerWalletId ?? ''
  );
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
  const [onboardInfoByAddress, setOnboardInfoByAddress] = useState<Record<string, OnboardInfo>>(
    () => sharedWalletSession?.sessionOnboardInfo ?? {}
  );
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeCreateMode, setTradeCreateMode] = useState<TradeCreateMode>('one-off');
  const [tradeVisibility, setTradeVisibility] = useState<TradeVisibility>('public');
  const [directTradeRecipient, setDirectTradeRecipient] = useState('');
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>('wisp');
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>('coti');
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradePriceInput, setTradePriceInput] = useState('');
  const [tradePricingEditedFields, setTradePricingEditedFields] = useState<TradePricingField[]>([]);
  const [tradeHasNoExpiry, setTradeHasNoExpiry] = useState(false);
  const [recurringBuyPriceInput, setRecurringBuyPriceInput] = useState('');
  const [recurringSellPriceInput, setRecurringSellPriceInput] = useState('');
  const [recurringHidePrivateAmounts, setRecurringHidePrivateAmounts] = useState(false);
  const [editingRecurringOrder, setEditingRecurringOrder] = useState<TradeSnapshot | null>(null);
  const [recurringAddBuyBudgetInput, setRecurringAddBuyBudgetInput] = useState('');
  const [recurringAddSellInventoryInput, setRecurringAddSellInventoryInput] = useState('');
  const [recurringBuyReceiveInput, setRecurringBuyReceiveInput] = useState('');
  const [recurringSellReceiveInput, setRecurringSellReceiveInput] = useState('');
  const [recurringBuyReceiveEditable, setRecurringBuyReceiveEditable] = useState(false);
  const [recurringSellReceiveEditable, setRecurringSellReceiveEditable] = useState(false);
  const [recurringRemoveBuyBudgetInput, setRecurringRemoveBuyBudgetInput] = useState('');
  const [recurringRemoveSellInventoryInput, setRecurringRemoveSellInventoryInput] = useState('');
  const [tradeExpiryHoursInput, setTradeExpiryHoursInput] = useState(DEFAULT_TRADE_EXPIRY_HOURS);
  const [tradeHidePrivateLiquidity, setTradeHidePrivateLiquidity] = useState(false);
  const [tradeActionError, setTradeActionError] = useState('');
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [creatingRecurringOrder, setCreatingRecurringOrder] = useState(false);
  const [createdRecurringOrderId, setCreatedRecurringOrderId] = useState<number | null>(null);
  const [createdRecurringOrderLink, setCreatedRecurringOrderLink] = useState('');
  const [recurringBuyFillInput, setRecurringBuyFillInput] = useState('');
  const [recurringSellFillInput, setRecurringSellFillInput] = useState('');
  const [processingRecurringAction, setProcessingRecurringAction] = useState('');
  const [revealingPrivateTradeKey, setRevealingPrivateTradeKey] = useState('');
  const [createdTradeId, setCreatedTradeId] = useState<number | null>(null);
  const [createdTradeLink, setCreatedTradeLink] = useState('');
  const [lastCopiedKey, setLastCopiedKey] = useState('');
  const [tradeLinkInput, setTradeLinkInput] = useState('');
  const [tradeSearchInput, setTradeSearchInput] = useState('');
  const [tradePairFilter, setTradePairFilter] = useState('all');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<TradeDeskTypeFilter>('all');
  const [tradeSortMode, setTradeSortMode] = useState<TradeDeskSortMode>('newest');
  const [recurringTerminalSide, setRecurringTerminalSide] = useState<RecurringTerminalActionSide>('buy');
  const [terminalFillInputSide, setTerminalFillInputSide] = useState<TerminalFillInputSide>('pay');
  const [terminalPayInput, setTerminalPayInput] = useState('');
  const [terminalBuyInput, setTerminalBuyInput] = useState('');
  const [terminalHistorySheetKey, setTerminalHistorySheetKey] = useState('');
  const [expandedMakerControls, setExpandedMakerControls] = useState<Record<string, boolean>>({});
  const [myTradeGroupView, setMyTradeGroupView] = useState<MyTradeGroupView>('received');
  const [selectedMyTradeDetailKey, setSelectedMyTradeDetailKey] = useState('');
  const [historyTransactionTimestamps, setHistoryTransactionTimestamps] = useState<Record<string, number>>({});
  const [reversedRateTradeIds, setReversedRateTradeIds] = useState<Record<string, boolean>>({});
  const [knownTradeAccessSecrets, setKnownTradeAccessSecrets] = useState<Record<string, string>>(
    () => loadStoredTradeAccessSecrets()
  );
  const [knownPrivateLiquidityByTrade, setKnownPrivateLiquidityByTrade] = useState<Record<string, string>>(
    () => loadStoredPrivateTradeLiquidity()
  );
  const [walletScopedSnapAesState, setWalletScopedSnapAesState] = useState<WalletScopedSnapAesState | null>(null);
  const [counterParentTrade, setCounterParentTrade] = useState<TradeSnapshot | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeSnapshot | null>(null);
  const [showTradingContractsModal, setShowTradingContractsModal] = useState(false);
  const injectedWalletOptions = useInjectedWalletOptions();

  const providerRef = useRef<Eip1193Provider | null>(initialSharedBrowserWallet?.browserProvider ?? null);
  const burnerWalletRef = useRef<Wallet | null>(initialSharedAppWallet?.burnerWallet ?? null);
  const burnerPinRef = useRef('');
  const signerCacheRef = useRef<Record<string, TradeSigner>>(
    initialSharedAppWallet?.burnerWallet && initialSharedWalletKey
      ? { [initialSharedWalletKey]: initialSharedAppWallet.burnerWallet }
      : {}
  );
  const skippedSharedWalletKeyRef = useRef('');
  const tradeLinkInputRef = useRef<HTMLInputElement | null>(null);
  const terminalPublicRecurringHistoryHydrationRef = useRef<Record<string, boolean>>({});

  const allowedBrowserWalletOptions = useMemo(
    () => filterAllowedBrowserWalletOptions(injectedWalletOptions),
    [injectedWalletOptions]
  );
  const tradingBrowserWalletState = resolveTradingBrowserWalletState({
    localBrowserProvider: providerRef.current,
    localChainId,
    localConnectedWalletLabel,
    localSelectedWalletId,
    localWalletAddress,
    sharedWalletSession
  });
  const walletAddress = tradingBrowserWalletState.walletAddress;
  const chainId = tradingBrowserWalletState.chainId;
  const selectedWalletId = tradingBrowserWalletState.selectedWalletId;
  const connectedWalletLabel = tradingBrowserWalletState.connectedWalletLabel;
  const effectiveBrowserProvider = tradingBrowserWalletState.browserProvider;
  useEffect(() => {
    if (!tradingBrowserWalletState.usesSharedBrowserWallet) {
      return;
    }
    providerRef.current = effectiveBrowserProvider;
  }, [effectiveBrowserProvider, tradingBrowserWalletState.usesSharedBrowserWallet]);
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
  const previousWalletKeyRef = useRef(walletKey);
  const appWalletAesOnboardingKeyRef = useRef('');
  const sharedWalletKey = sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '';
  const localBurnerMatchesWallet = Boolean(
    burnerWalletRef.current && walletKey === burnerWalletRef.current.address.toLowerCase()
  );
  const sharedBurnerMatchesWallet = Boolean(
    walletKey &&
    sharedWalletKey === walletKey &&
    sharedWalletSession?.activeSignerSource === 'burner'
  );
  const connectedWithBurner = localBurnerMatchesWallet || sharedBurnerMatchesWallet;
  const sharedWalletAesHealth = walletKey
    ? sharedWalletSession?.walletAesHealthByAddress?.[walletKey] ?? null
    : null;
  const sharedWalletHasAes = Boolean(
    walletKey &&
    sharedWalletKey === walletKey &&
    sharedWalletSession?.sessionOnboardInfo?.[walletKey]?.aesKey &&
    sharedWalletAesHealth?.status !== 'key-mismatch'
  );
  const effectiveOnboardInfoByAddress = useMemo(() => {
    if (!walletKey || sharedWalletKey !== walletKey) {
      return onboardInfoByAddress;
    }
    return mergeOnboardInfoByAddress(
      onboardInfoByAddress,
      walletKey,
      sharedWalletSession?.sessionOnboardInfo?.[walletKey]
    );
  }, [onboardInfoByAddress, sharedWalletKey, sharedWalletSession?.sessionOnboardInfo, walletKey]);
  const walletHasAes = hasSessionAesKey(walletAddress, effectiveOnboardInfoByAddress) || sharedWalletHasAes;
  const activeWalletScopedSnapAesState = resolveWalletScopedSnapAesState(
    walletScopedSnapAesState,
    walletAddress,
    effectiveBrowserProvider
  );
  const cotiSnapAesStatus = activeWalletScopedSnapAesState?.status ?? 'unknown';
  const activeStaleTokenAddresses =
    activeWalletScopedSnapAesState?.staleTokenAddresses ?? EMPTY_STALE_TOKEN_ADDRESSES;
  const stalePrivateTokenAddressSet = useMemo(
    () => new Set(activeStaleTokenAddresses.map((address) => address.toLowerCase())),
    [activeStaleTokenAddresses]
  );
  const setActiveCotiSnapAesStatus = useCallback(
    (status: CotiSnapAesStatus, staleTokenAddresses: string[] = []) => {
      setWalletScopedSnapAesState(
        createWalletScopedSnapAesState({
          provider: effectiveBrowserProvider,
          staleTokenAddresses,
          status,
          walletAddress
        })
      );
    },
    [effectiveBrowserProvider, walletAddress]
  );
  const isPrivateTokenSnapStale = useCallback(
    (tokenAddress: string): boolean =>
      (cotiSnapAesStatus === 'installed-aes-stale' ||
        cotiSnapAesStatus === 'key-mismatch' ||
        cotiSnapAesStatus === 'repair-needed') &&
      stalePrivateTokenAddressSet.has(tokenAddress.toLowerCase()),
    [cotiSnapAesStatus, stalePrivateTokenAddressSet]
  );
  const routeView = route.view;
  const routeTradeId = route.tradeId;
  const routeEscrowContract = route.escrowContract;
  const routeIsRecurringOrder = routeEscrowContract?.toLowerCase() === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase();
  const routeAccessSecret = route.accessSecret;
  const queuedTradeDataRefreshRef = useRef<QueuedTradeDataRefresh | null>(null);
  const flushQueuedTradeDataRefreshRef = useRef<() => void>(() => {});
  const p2pSyncTimerRef = useRef<number | null>(null);
  const storedRouteAccessSecret =
    routeTradeId !== null
      ? knownTradeAccessSecrets[buildTradeSnapshotKey(routeTradeId, routeEscrowContract)] ??
        ''
      : '';
  const resolvedRouteAccessSecret = routeAccessSecret || storedRouteAccessSecret;
  const routeError = route.routeError;
  const getTradeWalletFlowInput = useCallback(
    () => ({
      chainId,
      provider: connectedWithBurner ? null : effectiveBrowserProvider,
      providerKey: connectedWithBurner
        ? 'app-wallet'
        : sharedWalletSession?.browserWalletId || selectedWalletId || undefined,
      walletAddress
    }),
    [
      chainId,
      connectedWithBurner,
      effectiveBrowserProvider,
      selectedWalletId,
      sharedWalletSession?.browserWalletId,
      walletAddress
    ]
  );
  const assertMetaMaskMobilePromptReady = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || !isWalletBootstrapRoute(window.location.pathname)) {
      return;
    }

    const routeKey = `${route.view}:${route.tradeId ?? ''}:${route.escrowContract ? 'contract' : 'default'}`;
    const buildRouteIdentity = (candidate: typeof route): string =>
      [
        candidate.view,
        candidate.tradeId ?? '',
        candidate.escrowContract?.toLowerCase() ?? '',
        candidate.accessSecret ?? ''
      ].join(':');
    const activeRoutePath = resolveWalletBootstrapActiveRoute();
    let activeTradeRoute = null as typeof route | null;
    try {
      const activeUrl = new URL(activeRoutePath, window.location.origin);
      activeTradeRoute = resolveTradeRouteFromParts(activeUrl.pathname, activeUrl.search, activeUrl.hash);
    } catch {
      activeTradeRoute = null;
    }
    const routeReady =
      isWalletBootstrapStableUrl(window.location.pathname, window.location.search) &&
      !window.location.hash &&
      activeRoutePath.toLowerCase().startsWith('/trades') &&
      activeTradeRoute !== null &&
      buildRouteIdentity(activeTradeRoute) === buildRouteIdentity(route);

    if (!routeReady) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        reason: 'bootstrap-route-not-stable',
        routeKey
      });
      throw new Error('MetaMask Mobile is still preparing this trading page. Wait a moment and try again.');
    }

    if (connectedWithBurner) {
      logMobileWalletDiagnostic('prompt-readiness-pass', {
        providerSource: 'app-wallet',
        routeKey
      });
      return;
    }

    if (!effectiveBrowserProvider || !walletAddress) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        reason: 'wallet-not-connected',
        routeKey
      });
      throw new Error('Connect MetaMask Mobile before signing this trade action.');
    }

    logMetaMaskMobileRequestMethod('eth_accounts', 'injected-metamask', {
      reason: 'prompt-readiness'
    });
    const accounts = ((await effectiveBrowserProvider.request({ method: 'eth_accounts' })) as string[] | unknown) ?? [];
    const connectedWalletKey = walletAddress.trim().toLowerCase();
    const accountReady = Array.isArray(accounts) && accounts.some((account) =>
      typeof account === 'string' && account.toLowerCase() === connectedWalletKey
    );
    if (!accountReady) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        accountsCount: Array.isArray(accounts) ? accounts.length : 0,
        reason: 'account-mismatch',
        routeKey
      });
      throw new Error('MetaMask Mobile is not connected to the active ChainWhisper wallet. Reconnect MetaMask before signing.');
    }

    logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
      reason: 'prompt-readiness'
    });
    const currentChain = (await effectiveBrowserProvider.request({ method: 'eth_chainId' })) as string | number;
    const currentChainId = normalizeChainId(currentChain);
    if (currentChainId !== COTI_NETWORK.chainIdDecimal) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        chainId: currentChainId,
        reason: 'wrong-chain',
        routeKey
      });
      throw new Error('Switch MetaMask Mobile to COTI Mainnet before signing this trade action.');
    }

    logMobileWalletDiagnostic('prompt-readiness-pass', {
      providerSource: 'injected-metamask',
      routeKey
    });
  }, [
    connectedWithBurner,
    effectiveBrowserProvider,
    route,
    walletAddress
  ]);
  const runTradeWalletPromptFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const activeWalletFlow = sharedWalletActions?.runWalletTransactionFlow;
      const routeBefore = getCurrentRouteForDiagnostics();
      try {
        if (activeWalletFlow) {
          return await activeWalletFlow(async () => {
            const flowInput = getTradeWalletFlowInput();
            recordWalletTransactionFlowStage(flowInput, 'trading-flow-requested');
            logMobileWalletDiagnostic('trading-flow-start', {
              routeBefore,
              trace: readWalletTransactionFlowTrace(flowInput)
            });
            await assertMetaMaskMobilePromptReady();
            return await operation();
          });
        }

        const input = getTradeWalletFlowInput();
        recordWalletTransactionFlowStage(input, 'trading-flow-requested');
        logMobileWalletDiagnostic('trading-flow-start', {
          routeBefore,
          trace: readWalletTransactionFlowTrace(input)
        });
        return await runWalletTransactionFlow(input, async () => {
          await assertMetaMaskMobilePromptReady();
          return await operation();
        });
      } finally {
        const flowInput = getTradeWalletFlowInput();
        logMobileWalletDiagnostic('trading-flow-finish', {
          routeAfter: getCurrentRouteForDiagnostics(),
          routeBefore,
          trace: readWalletTransactionFlowTrace(flowInput)
        });
        logMobileWalletDiagnostic('write-finished', {
          routeAfter: getCurrentRouteForDiagnostics(),
          routeBefore
        });
        globalThis.setTimeout(() => {
          flushQueuedTradeDataRefreshRef.current();
        }, 0);
      }
    },
    [
      assertMetaMaskMobilePromptReady,
      getTradeWalletFlowInput,
      sharedWalletActions,
    ]
  );
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
    let cancelled = false;
    const provider = effectiveBrowserProvider;

    if (!walletAddress) {
      setActiveCotiSnapAesStatus('unknown');
      return () => {
        cancelled = true;
      };
    }

    if (connectedWithBurner) {
      setActiveCotiSnapAesStatus('unknown');
      return () => {
        cancelled = true;
      };
    }

    if (walletHasAes || !provider) {
      if (
        cotiSnapAesStatus !== 'installed-aes-stale' &&
        cotiSnapAesStatus !== 'key-mismatch' &&
        cotiSnapAesStatus !== 'repair-needed'
      ) {
        setActiveCotiSnapAesStatus(walletHasAes ? 'installed-aes-ready' : 'unknown');
      }
      return () => {
        cancelled = true;
      };
    }

    getCotiSnapAesStatus(provider)
      .then((status) => {
        if (!cancelled) {
          setActiveCotiSnapAesStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveCotiSnapAesStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    connectedWithBurner,
    cotiSnapAesStatus,
    effectiveBrowserProvider,
    setActiveCotiSnapAesStatus,
    walletAddress,
    walletHasAes
  ]);

  useEffect(() => {
    const provider = effectiveBrowserProvider;
    if (
      connectedWithBurner ||
      !provider ||
      !walletAddress ||
      !walletKey ||
      walletHasAes ||
      chainId !== COTI_NETWORK.chainIdDecimal
    ) {
      return;
    }

    const storedOnboardInfo = readFallbackAesSessionOnboardInfo(walletAddress, provider);
    if (!storedOnboardInfo?.aesKey) {
      return;
    }

    setOnboardInfoByAddress((previous) =>
      mergeOnboardInfoByAddress(previous, walletKey, storedOnboardInfo)
    );
    const cachedSigner = signerCacheRef.current[walletKey];
    if (cachedSigner) {
      cachedSigner.setUserOnboardInfo(mergeOnboardInfo(cachedSigner.getUserOnboardInfo(), storedOnboardInfo));
    }
    setActiveCotiSnapAesStatus('installed-aes-ready');
    sharedWalletSession?.onWalletAesHealthChange?.(
      walletAddress,
      buildWalletAesHealthState({
        status: 'ready-unverified',
        walletAddress
      })
    );
  }, [
    chainId,
    connectedWithBurner,
    effectiveBrowserProvider,
    setActiveCotiSnapAesStatus,
    sharedWalletSession,
    walletAddress,
    walletHasAes,
    walletKey
  ]);

  useEffect(() => {
    if (!connectedWithBurner || !walletKey || walletHasAes) {
      return;
    }

    const signer = burnerWalletRef.current;
    if (!signer || signer.address.toLowerCase() !== walletKey) {
      return;
    }

    if (appWalletAesOnboardingKeyRef.current === walletKey) {
      return;
    }

    let cancelled = false;
    appWalletAesOnboardingKeyRef.current = walletKey;
    setConnectingWalletId((current) => current || 'aes');

    const autoOnboardAppWalletAes = async () => {
      try {
        signer.disableAutoOnboard();
        let onboardInfo = signer.getUserOnboardInfo();
        if (!onboardInfo?.aesKey) {
          const signerProvider = (signer as { provider?: { getBalance?: (address: string) => Promise<bigint> } }).provider;
          const appWalletBalance = signerProvider?.getBalance
            ? await signerProvider.getBalance(signer.address).catch(() => null)
            : null;
          if (appWalletBalance !== null && appWalletBalance <= 0n) {
            if (!cancelled) {
              setWalletError('App wallet selected. Fund it with COTI to unlock privacy and pay gas.');
            }
            return;
          }

          await signer.generateOrRecoverAes();
          onboardInfo = signer.getUserOnboardInfo();
        }

        if (!cancelled && onboardInfo?.aesKey) {
          setOnboardInfoByAddress((previous) =>
            mergeOnboardInfoByAddress(previous, walletKey, onboardInfo)
          );
          sharedWalletSession?.onWalletAesHealthChange?.(
            signer.address,
            buildWalletAesHealthState({
              status: 'ready',
              walletAddress: signer.address
            })
          );
          setActiveCotiSnapAesStatus('unknown');
        }
      } catch (error) {
        if (!cancelled) {
          setWalletError(getProviderErrorMessage(error, 'Failed to auto-unlock app wallet privacy.'));
        }
      } finally {
        if (!cancelled) {
          setConnectingWalletId((current) => (current === 'aes' ? '' : current));
        }
      }
    };

    autoOnboardAppWalletAes().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    connectedWithBurner,
    mergeOnboardInfoByAddress,
    setActiveCotiSnapAesStatus,
    sharedWalletSession,
    walletHasAes,
    walletKey
  ]);

  useEffect(() => {
    const sharedAddress = sharedWalletSession?.walletAddress.trim() ?? '';
    const sharedWalletKey = sharedAddress.toLowerCase();
    if (sharedWalletActionsAvailable && sharedWalletSession?.activeSignerSource === 'metamask') {
      const sharedOnboardInfo = sharedWalletSession?.sessionOnboardInfo[sharedWalletKey];
      if (sharedAddress && sharedOnboardInfo) {
        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, sharedWalletKey, sharedOnboardInfo)
        );
        signerCacheRef.current[sharedWalletKey]?.setUserOnboardInfo(sharedOnboardInfo);
      }
      if (sharedWalletSession.browserWalletId) {
        saveWalletPreference({ kind: 'browser', browserWalletId: sharedWalletSession.browserWalletId });
      }
      return;
    }
    if (!sharedAddress) {
      skippedSharedWalletKeyRef.current = '';
      if (sharedWalletSession && walletAddress && !connectingWalletId) {
        if (isWalletTransactionFlowActive(getTradeWalletFlowInput())) {
          recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-shared-empty-ignored');
          return;
        }
        providerRef.current = null;
        burnerWalletRef.current = null;
        signerCacheRef.current = {};
        setWalletAddress('');
        setChainId(null);
        setConnectedWalletLabel('Wallet');
        setSelectedWalletId('');
        setSelectedBurnerWalletId('');
        setWalletError('');
      }
    }
    const localBurnerWalletKey = burnerWalletRef.current?.address.toLowerCase() ?? '';
    const sharedBurnerIsNotLocal =
      sharedWalletSession?.activeSignerSource === 'burner' &&
      (!localBurnerWalletKey || localBurnerWalletKey !== sharedWalletKey);
    const sharedBrowserIsNotLocal =
      !sharedWalletActionsAvailable &&
      sharedWalletSession?.activeSignerSource === 'metamask' &&
      Boolean(sharedWalletSession.browserProvider) &&
      (
        providerRef.current !== sharedWalletSession.browserProvider ||
        walletKey !== sharedWalletKey
      );
    const shouldApplySharedWallet =
      !walletAddress ||
      sharedBurnerIsNotLocal ||
      sharedBrowserIsNotLocal;

    const sharedOnboardInfo = sharedWalletSession?.sessionOnboardInfo[sharedWalletKey];
    const mergeSharedOnboardInfo = () => {
      if (!sharedOnboardInfo) {
        return;
      }
      setOnboardInfoByAddress((previous) =>
        mergeOnboardInfoByAddress(previous, sharedWalletKey, sharedOnboardInfo)
      );
      signerCacheRef.current[sharedWalletKey]?.setUserOnboardInfo(sharedOnboardInfo);
    };

    if (sharedAddress && sharedWalletKey === walletKey) {
      mergeSharedOnboardInfo();
    }

    if (
      !sharedAddress ||
      !shouldApplySharedWallet ||
      connectingWalletId ||
      skippedSharedWalletKeyRef.current === sharedWalletKey
    ) {
      return;
    }

    if (
      !sharedWalletActionsAvailable &&
      sharedWalletSession?.activeSignerSource === 'metamask' &&
      sharedWalletSession.browserProvider
    ) {
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
    getTradeWalletFlowInput,
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
    sharedWalletActionsAvailable,
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

  const toggleMakerControls = useCallback((surface: MakerControlsSurface, tradeKey: string) => {
    const controlsKey = buildMakerControlsKey(surface, tradeKey);
    setExpandedMakerControls((current) => ({
      ...current,
      [controlsKey]: !current[controlsKey]
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

  const forgetTradeAccessSecret = useCallback((tradeId: number, escrowContract?: string) => {
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setKnownTradeAccessSecrets((previous) => {
      if (!previous[key]) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
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
      knownTradeAccessSecrets[buildTradeSnapshotKey(tradeId, escrowContract)] ?? '',
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
    await ensureProviderOnCotiNetwork(provider);
  }, []);

  const attachWallet = useCallback(
    async (provider: Eip1193Provider, address: string, walletLabel: string, walletId?: string) => {
      skippedSharedWalletKeyRef.current = '';
      if (providerRef.current !== provider) {
        signerCacheRef.current = {};
      }
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

  const connectWallet = useCallback(
    async (walletId?: string, forceAccountPicker = false) => {
      let walletOption = walletId
        ? browserWalletOptions.find((option) => option.id === walletId) ?? null
        : preferredWalletOption;
      if (!walletOption && walletId !== 'metamask' && walletId !== METAMASK_CONNECT_MOBILE_WALLET_ID) {
        walletOption = preferredWalletOption;
      }
      const useMetaMaskConnectMobileContext = shouldUseMetaMaskConnectMobile({ walletId, walletOption });
      const mobileInjectedOption = useMetaMaskConnectMobileContext
        ? await waitForMetaMaskMobileInjectedWalletOption({
            initialOptions: walletOption ? [walletOption] : undefined,
            timeoutMs: 3000
          })
        : null;
      const useMetaMaskConnectMobile = useMetaMaskConnectMobileContext && !mobileInjectedOption;
      if (mobileInjectedOption) {
        walletOption = mobileInjectedOption;
      } else if (!useMetaMaskConnectMobileContext) {
        const injectedMetaMaskOption = walletOption
          ? resolveMetaMaskMobileInjectedWalletOption([walletOption])
          : resolveMetaMaskMobileInjectedWalletOption();
        if (injectedMetaMaskOption && (!walletId || walletId === 'metamask' || walletId === METAMASK_CONNECT_MOBILE_WALLET_ID)) {
          walletOption = injectedMetaMaskOption;
        }
      }
      const provider = walletOption?.provider ?? null;
      const walletLabel = useMetaMaskConnectMobile
        ? METAMASK_CONNECT_MOBILE_WALLET_LABEL
        : walletOption?.label ?? 'Wallet';

      setWalletError('');
      setTradeActionError('');
      setConnectingWalletId(useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? 'wallet');

      if (sharedWalletActions?.connectBrowserWallet) {
        try {
          await sharedWalletActions.connectBrowserWallet(walletOption?.id ?? walletId, {
            forceAccountPicker
          });
          if (walletOption?.id) {
            setSelectedWalletId(walletOption.id);
            saveWalletPreference({ kind: 'browser', browserWalletId: walletOption.id });
            try {
              window.localStorage.setItem(WALLET_STATUS_STORAGE_KEY, walletOption.id);
            } catch {
            }
          }
          setWalletError('');
        } catch (error) {
          setWalletError(getProviderErrorMessage(error, 'Failed to connect wallet.'));
        } finally {
          setConnectingWalletId('');
        }
        return;
      }

      if (!provider && !useMetaMaskConnectMobile) {
        setWalletError(
          isMobileBrowserUserAgent()
            ? 'Open this page in MetaMask Mobile or a supported wallet app, then connect again.'
            : 'MetaMask or CipherTrade is required to connect a browser wallet.'
        );
        setConnectingWalletId('');
        return;
      }

      try {
        const mobileSession = useMetaMaskConnectMobile
          ? await connectMetaMaskMobile({ forceAccountPicker })
          : null;
        const activeWalletProvider = mobileSession?.provider ?? provider;
        if (!activeWalletProvider) {
          throw new Error('Wallet provider is not available.');
        }
        const usingInjectedMetaMaskMobile = Boolean(
          !mobileSession && walletOption && resolveMetaMaskMobileInjectedWalletOption([walletOption])
        );
        if (!mobileSession && forceAccountPicker && !usingInjectedMetaMaskMobile) {
          await activeWalletProvider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
        if (usingInjectedMetaMaskMobile && walletOption) {
          logMetaMaskMobileProviderSelection('injected-metamask', {
            walletId: walletOption.id
          });
          logMetaMaskMobileRequestMethod('eth_requestAccounts', 'injected-metamask', {
            walletId: walletOption.id
          });
        }
        const accounts = mobileSession
          ? [mobileSession.address]
          : ((await activeWalletProvider.request({ method: 'eth_requestAccounts' })) as string[]);
        const selected = accounts[0] ?? '';
        if (!selected) {
          throw new Error('No wallet account selected.');
        }
        await ensureCotiNetwork(activeWalletProvider);
        await attachWallet(
          activeWalletProvider,
          selected,
          walletLabel,
          mobileSession?.walletId ?? walletOption?.id
        );
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect wallet.'));
      } finally {
        setConnectingWalletId('');
      }
    },
    [attachWallet, browserWalletOptions, ensureCotiNetwork, preferredWalletOption, sharedWalletActions]
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
        const cachedOnboardInfo = effectiveOnboardInfoByAddress[cacheKey];
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
    [effectiveOnboardInfoByAddress, markSharedWalletSkippedAfterLocalAppSwitch]
  );

  const connectBurnerWallet = useCallback(
    async (walletId?: string) => {
      setWalletError('');
      setTradeActionError('');
      if (sharedWalletActions?.connectAppWallet || sharedWalletActions?.switchAppWallet) {
        setConnectingWalletId('burner');
        try {
          if (walletId && sharedWalletActions.switchAppWallet) {
            await Promise.resolve(sharedWalletActions.switchAppWallet(walletId));
          } else if (sharedWalletActions.connectAppWallet) {
            await Promise.resolve(sharedWalletActions.connectAppWallet(walletId));
          }
          setWalletError('');
        } catch (error) {
          setWalletError(getProviderErrorMessage(error, 'Failed to connect app wallet.'));
        } finally {
          setConnectingWalletId('');
        }
        return;
      }

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
    [burnerWallets, markSharedWalletSkippedAfterLocalAppSwitch, sharedWalletActions, unlockBurnerWalletWithPin]
  );

  const beginGenerateBurnerWallet = useCallback(() => {
    setWalletError('');
    setTradeActionError('');
    if (sharedWalletActions?.generateAppWallet) {
      setWalletMenuOpen(false);
      Promise.resolve(sharedWalletActions.generateAppWallet()).catch((error) => {
        setWalletError(getProviderErrorMessage(error, 'Failed to generate app wallet.'));
      });
      return;
    }

    setPendingBurnerAction('generate');
    setPendingBurnerWalletId('');
    setBurnerPinMode(chooseBurnerPinMode());
    setBurnerPinInput('');
    setWalletMenuOpen(false);
    setShowBurnerPinModal(true);
  }, [chooseBurnerPinMode, sharedWalletActions]);

  const beginImportBurnerWallet = useCallback(() => {
    setWalletError('');
    setTradeActionError('');
    if (sharedWalletActions?.importAppWallet) {
      setWalletMenuOpen(false);
      Promise.resolve(sharedWalletActions.importAppWallet()).catch((error) => {
        setWalletError(getProviderErrorMessage(error, 'Failed to import app wallet.'));
      });
      return;
    }

    setBurnerImportInput('');
    setWalletMenuOpen(false);
    setShowBurnerImportModal(true);
  }, [sharedWalletActions]);

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

  const getTradeSigner = useP2PTradeSigner({
    burnerWalletRef,
    chainId,
    ensureCotiNetwork,
    mergeOnboardInfoByAddress,
    onboardInfoByAddress: effectiveOnboardInfoByAddress,
    providerRef,
    setChainId,
    setOnboardInfoByAddress,
    signerCacheRef,
    sharedGetSigner: sharedWalletActions?.getSigner,
    walletAddress
  });

  const recoverMakerTradeAccessSecret = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      const knownAccessSecret = Boolean(resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract));
      if (!shouldRecoverMakerTradePayload(snapshot, walletKey, knownAccessSecret)) {
        return snapshot;
      }
      if (!forceReveal && !walletHasAes) {
        return snapshot;
      }

      const signer = await getTradeSigner(forceReveal);
      const recoveryPayload = await recoverTradeAccessPayloadForMaker({
        tradeId: snapshot.tradeId,
        escrowContract: snapshot.escrowContract,
        signer,
        callerAddress: walletAddress
      });
      const recoveredSecret = normalizeAccessSecret(recoveryPayload.accessSecret);
      if (recoveredSecret) {
        const cotiEthers = await loadCotiEthersModule();
        if (
          !snapshot.accessHash ||
          doesAccessSecretMatchHash(recoveredSecret, snapshot.accessHash, () => cotiEthers.keccak256(recoveredSecret))
        ) {
          rememberTradeAccessSecret(snapshot.tradeId, recoveredSecret, snapshot.escrowContract);
        }
      }
      if (recoveryPayload.kind === 'private-order' && recoveryPayload.offer?.amount) {
        try {
          rememberPrivateTradeLiquidity(snapshot.tradeId, snapshot.escrowContract, BigInt(recoveryPayload.offer.amount));
        } catch {
        }
      }
      return applyTradeRecoveryPayloadToSnapshot(snapshot, recoveryPayload);
    },
    [
      getTradeSigner,
      rememberPrivateTradeLiquidity,
      rememberTradeAccessSecret,
      resolveKnownTradeAccessSecret,
      walletAddress,
      walletHasAes,
      walletKey
    ]
  );

  const enrichDirectVisibleTermsForWallet = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      if (!walletKey) {
        return snapshot;
      }
      const escrowConfig = resolveTradeEscrowContractConfig(snapshot.escrowContract);
      if (!escrowConfig.directVisible) {
        return snapshot;
      }
      if (hasHydratedDirectTradeTerms(snapshot)) {
        return snapshot;
      }

      const knownAccessSecret = resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
      const isParticipant =
        snapshot.maker.toLowerCase() === walletKey || snapshot.taker.toLowerCase() === walletKey;
      const signer = await getTradeSigner(forceReveal);
      const result = await revealDirectTradeTermsForWallet({
        snapshot,
        walletAddress,
        signer,
        accessSecret: knownAccessSecret
      });
      if (result.ok) {
        if (result.recoveredAccessSecret) {
          rememberTradeAccessSecret(snapshot.tradeId, result.recoveredAccessSecret, snapshot.escrowContract);
        }
        return result.snapshot;
      }
      if (forceReveal) {
        throw new Error(result.message);
      }
      if (!isParticipant && !knownAccessSecret) {
        return snapshot;
      }
      return snapshot;
    },
    [
      getTradeSigner,
      rememberTradeAccessSecret,
      resolveKnownTradeAccessSecret,
      walletAddress,
      walletKey
    ]
  );

  const walletBalanceRefreshSessionKey = useMemo(
    () =>
      [
        walletKey || 'no-wallet',
        chainId ?? 'no-chain',
        connectedWithBurner ? 'app' : selectedWalletId || 'browser',
        walletHasAes ? 'aes' : 'locked'
      ].join(':'),
    [chainId, connectedWithBurner, selectedWalletId, walletHasAes, walletKey]
  );

  const tradeFeeEscrowContract = useMemo(() => {
    if ((tradeCreateMode === 'recurring' && !editingTrade && !counterParentTrade) || editingRecurringOrder) {
      return RECURRING_OTC_CONTRACT_ADDRESS;
    }
    if (editingTrade?.escrowContract) {
      return editingTrade.escrowContract;
    }
    if (counterParentTrade) {
      return DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
    }
    if (tradeHidePrivateLiquidity) {
      return PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
    }
    if (tradeVisibility !== 'public') {
      return DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
    }
    return TRADE_ESCROW_CONTRACT_ADDRESS;
  }, [
    counterParentTrade,
    editingRecurringOrder,
    editingTrade,
    tradeCreateMode,
    tradeHidePrivateLiquidity,
    tradeVisibility
  ]);

  const tradeFeeEscrowContractLabel = useMemo(() => {
    const normalizedContract = tradeFeeEscrowContract.toLowerCase();
    if (normalizedContract === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()) {
      return 'Recurring contract';
    }
    if (normalizedContract === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
      return 'Private escrow';
    }
    if (normalizedContract === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
      return 'Direct escrow';
    }
    if (normalizedContract === TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
      return 'Public escrow';
    }
    return 'Escrow';
  }, [tradeFeeEscrowContract]);
  const tradeFeeEscrowContractTitleLabel = tradeFeeEscrowContractLabel.toLowerCase().includes('contract')
    ? tradeFeeEscrowContractLabel
    : `${tradeFeeEscrowContractLabel} contract`;

  const {
    clearWalletBalances,
    customTradeTokenInfoByAddress,
    nativeBalanceWei,
    privateRewardTokenBalanceState,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    reloadPrivateBalancesWithUnlockedSigner,
    refreshWalletBalances,
    resolveRequiredFeeForTradeCreate,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    tradeRequiredFeeWei
  } = useP2PTradeTokenData({
    balanceRefreshSessionKey: walletBalanceRefreshSessionKey,
    getTradeSigner,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    tradeFeeEscrowContract,
    walletAddress,
    walletHasAes,
    walletKey
  });
  const hotdogPrivateTokenInfo =
    customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('private-erc20', HOTDOG_PRIVATE_TOKEN_ADDRESS)];
  const hotdogPrivateTokenSymbol = hotdogPrivateTokenInfo?.symbol?.trim() || 'HOTDOG';
  const hotdogPrivateTokenDecimals = hotdogPrivateTokenInfo?.decimals ?? 6;
  const hotdogPrivateTokenBalanceWei = hotdogPrivateTokenInfo?.balanceWei ?? null;
  const pWispFooterBalanceState =
    isPrivateTokenSnapStale(PRIVATE_REWARD_TOKEN_ADDRESS)
      ? ({ status: 'snap-stale' } as const)
      : privateRewardTokenBalanceState;
  const hotdogPrivateTokenBalanceState =
    isPrivateTokenSnapStale(HOTDOG_PRIVATE_TOKEN_ADDRESS)
      ? ({ status: 'snap-stale' } as const)
      : hotdogPrivateTokenInfo?.privateBalanceState ?? { status: 'locked' as const };
  const walletPrivateTokenPrivacyAction = useMemo<PrivateTokenBalancePrivacyAction>(() => {
    if (!walletAddress || !walletHasAes) {
      return 'none';
    }
    const states = [
      pWispFooterBalanceState,
      hotdogPrivateTokenBalanceState,
      ...Object.values(customTradeTokenInfoByAddress)
        .filter((info) => info.kind === 'private-erc20' && info.walletKey === walletKey)
        .map((info) => info.privateBalanceState)
    ];
    let hasSetupNeeded = false;
    for (const state of states) {
      const action = resolvePrivateTokenBalancePrivacyAction(state);
      if (action === 'repair') {
        return 'repair';
      }
      if (action === 'setup') {
        hasSetupNeeded = true;
      }
    }
    return hasSetupNeeded ? 'setup' : 'none';
  }, [
    customTradeTokenInfoByAddress,
    hotdogPrivateTokenBalanceState,
    pWispFooterBalanceState,
    walletAddress,
    walletHasAes,
    walletKey
  ]);

  useEffect(() => {
    const previousWalletKey = previousWalletKeyRef.current;
    if (previousWalletKey === walletKey) {
      return;
    }
    if (
      sharedWalletActionsAvailable &&
      previousWalletKey &&
      !walletKey &&
      isWalletTransactionFlowActive({
        chainId,
        provider: effectiveBrowserProvider,
        providerKey: selectedWalletId,
        walletAddress: previousWalletKey
      })
    ) {
      recordWalletTransactionFlowStage(
        {
          chainId,
          provider: effectiveBrowserProvider,
          providerKey: selectedWalletId,
          walletAddress: previousWalletKey
        },
        'trading-wallet-clear-held'
      );
      return;
    }
    previousWalletKeyRef.current = walletKey;
    const provider = effectiveBrowserProvider;
    if (previousWalletKey) {
      clearCotiAesUnlockRequest(previousWalletKey, provider);
    }
    if (walletKey) {
      clearCotiAesUnlockRequest(walletKey, provider);
    }
    appWalletAesOnboardingKeyRef.current = '';
    signerCacheRef.current = {};
    setWalletScopedSnapAesState(null);
    clearWalletBalances();
    const sharedWalletKey = sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '';
    const sharedHasNextWalletAes = Boolean(
      walletKey &&
      sharedWalletKey === walletKey &&
      sharedWalletSession?.sessionOnboardInfo?.[walletKey]?.aesKey
    );
    if (!connectedWithBurner && !sharedHasNextWalletAes) {
      setOnboardInfoByAddress((previous) => {
        const next = { ...previous };
        if (previousWalletKey) {
          delete next[previousWalletKey];
        }
        if (walletKey) {
          delete next[walletKey];
        }
        return next;
      });
    }
  }, [
    clearWalletBalances,
    chainId,
    connectedWithBurner,
    effectiveBrowserProvider,
    selectedWalletId,
    sharedWalletActionsAvailable,
    sharedWalletSession?.sessionOnboardInfo,
    sharedWalletSession?.walletAddress,
    walletKey
  ]);

  useEffect(() => {
    if (!walletKey || !sharedWalletAesHealth) {
      return;
    }
    if (sharedWalletAesHealth.status === 'repair-needed') {
      setActiveCotiSnapAesStatus('repair-needed');
      return;
    }
    if (sharedWalletAesHealth.status !== 'key-mismatch') {
      return;
    }
    const signer = signerCacheRef.current[walletKey];
    if (signer) {
      resetSignerOnboardInfoForFreshAes(signer);
    }
    setOnboardInfoByAddress((previous) => {
      const current = previous[walletKey];
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        [walletKey]: resetOnboardInfoForFreshAes(current) ?? current
      };
    });
    setActiveCotiSnapAesStatus('key-mismatch');
  }, [setActiveCotiSnapAesStatus, sharedWalletAesHealth, walletKey]);

  const formatPrivateFooterBalance = useCallback(
    (
      balanceWei: bigint | null,
      decimals: number,
      symbol: string,
      state: PrivateTokenBalanceState
    ): string => {
      if (state.status === 'ready' && balanceWei !== null) {
        return `${formatTokenAmount(balanceWei, decimals, 4)} ${symbol}`;
      }
      if (state.status === 'setup-needed') {
        return `Setup ${symbol}`;
      }
      if (state.status === 'decrypt-failed') {
        return `Unlock ${symbol}`;
      }
      if (state.status === 'snap-stale') {
        return `Refresh ${symbol}`;
      }
      if (state.status === 'unsupported') {
        return `Unsupported ${symbol}`;
      }
      return `-- ${symbol}`;
    },
    []
  );

  const resolveTerminalAssetBalanceLabel = useCallback(
    (asset: TradeAssetPayload): string => {
      const formatBalanceLabel = (balanceWei: bigint): string =>
        `Bal ${asset.kind === 'native' ? formatCotiAmount(balanceWei, 2) : formatTokenAmount(balanceWei, asset.decimals, 2)}`;

      if (!walletAddress) {
        return 'Connect';
      }

      if (asset.kind === 'native') {
        return nativeBalanceWei !== null ? formatBalanceLabel(nativeBalanceWei) : 'Bal --';
      }

      const tokenAddress = asset.tokenAddress?.trim() ?? '';
      if (!isWalletAddress(tokenAddress)) {
        return 'Bal --';
      }

      const tokenKey = tokenAddress.toLowerCase();
      if (asset.kind === 'erc20') {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          return rewardTokenBalanceWei !== null ? formatBalanceLabel(rewardTokenBalanceWei) : 'Bal --';
        }
        const publicInfo = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('erc20', tokenAddress)];
        return publicInfo?.balanceWei !== null && publicInfo?.balanceWei !== undefined
          ? formatBalanceLabel(publicInfo.balanceWei)
          : 'Bal --';
      }

      const privateInfo = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('private-erc20', tokenAddress)];
      const privateState: PrivateTokenBalanceState =
        tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
          ? pWispFooterBalanceState
          : privateInfo?.privateBalanceState ?? { status: 'locked' };
      if (privateState.status === 'ready') {
        return formatBalanceLabel(privateState.balanceWei);
      }
      if (privateState.status === 'setup-needed') {
        return 'Set up';
      }
      if (privateState.status === 'decrypt-failed' || privateState.status === 'snap-stale') {
        return 'Refresh';
      }
      if (privateState.status === 'unsupported') {
        return 'Unsupported';
      }
      if (privateInfo?.loading || privateState.status === 'setup-pending') {
        return 'Loading';
      }
      return 'Unlock';
    },
    [
      customTradeTokenInfoByAddress,
      nativeBalanceWei,
      pWispFooterBalanceState,
      rewardTokenBalanceWei,
      walletAddress
    ]
  );

  const enrichMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      if (snapshot.recurringOrder) {
        if (!walletKey) {
          return snapshot;
        }

        const recurring = snapshot.recurringOrder;
        const isMaker = snapshot.maker.toLowerCase() === walletKey;
        if (recurring.mode === 'public') {
          if (recurring.executionCount === 0) {
            return snapshot;
          }
          const existingPublicExecutions = recurring.publicExecutions ?? [];
          const publicExecutions = await fetchRecurringExecutionRowsForWallet({
            orderId: recurring.orderId,
            walletAddress: isMaker ? undefined : walletAddress
          }).catch(() => existingPublicExecutions);
          const resolvedPublicExecutions =
            publicExecutions.length > 0 || existingPublicExecutions.length === 0
              ? publicExecutions
              : existingPublicExecutions;
          return {
            ...snapshot,
            walletHasFill: Boolean(snapshot.walletHasFill || (!isMaker && resolvedPublicExecutions.length > 0)),
            recurringOrder: {
              ...recurring,
              publicExecutions: resolvedPublicExecutions
            }
          };
        }
        if (!forceReveal) {
          return snapshot;
        }

        const revealBaseInventory =
          recurring.baseAsset.kind === 'private-erc20' && recurring.hasPrivateBaseInventory;
        const revealQuoteInventory =
          recurring.quoteAsset.kind === 'private-erc20' && recurring.hasPrivateQuoteInventory;

        const signer = await getTradeSigner(forceReveal);
        const [privateInventorySnapshotsResult, privateExecutionsResult] = await Promise.allSettled([
          isMaker
            ? fetchRecurringPrivateInventorySnapshotsForWallet({
                orderId: recurring.orderId,
                walletAddress,
                signer
              })
            : Promise.resolve([]),
          fetchRecurringPrivateFillReceiptsForWallet({
            orderId: recurring.orderId,
            walletAddress,
            signer
          })
        ]);
        const fetchedPrivateExecutions =
          privateExecutionsResult.status === 'fulfilled'
            ? privateExecutionsResult.value
            : [];
        const existingPrivateExecutions = recurring.privateExecutions ?? [];
        const privateExecutions =
          fetchedPrivateExecutions.length > 0 || existingPrivateExecutions.length === 0
            ? fetchedPrivateExecutions
            : existingPrivateExecutions;
        const privateInventorySnapshots =
          privateInventorySnapshotsResult.status === 'fulfilled'
            ? privateInventorySnapshotsResult.value
            : [];
        const latestInventorySnapshot = privateInventorySnapshots[privateInventorySnapshots.length - 1];
        const latestExecutionWithRemaining = [...privateExecutions]
          .reverse()
          .find((execution) => execution.remainingBaseInventory !== undefined || execution.remainingQuoteInventory !== undefined);
        const fallbackBaseInventory =
          latestInventorySnapshot?.baseInventory ??
          latestExecutionWithRemaining?.remainingBaseInventory;
        const fallbackQuoteInventory =
          latestInventorySnapshot?.quoteInventory ??
          latestExecutionWithRemaining?.remainingQuoteInventory;
        const baseInventoryForMaker =
          recurring.baseAsset.kind === 'private-erc20'
            ? fallbackBaseInventory
            : recurring.publicBaseInventory;
        const quoteInventoryForMaker =
          recurring.quoteAsset.kind === 'private-erc20'
            ? fallbackQuoteInventory
            : recurring.publicQuoteInventory;

        if (
          privateInventorySnapshotsResult.status === 'rejected' &&
          privateExecutionsResult.status === 'rejected'
        ) {
          throw privateInventorySnapshotsResult.reason instanceof Error
            ? privateInventorySnapshotsResult.reason
            : new Error('Private recurring reveal failed. AES may need to be refreshed.');
        }
        const hasRevealedPrivateData =
          (isMaker && (fallbackBaseInventory !== undefined || fallbackQuoteInventory !== undefined)) ||
          privateExecutions.length > 0;
        if (!hasRevealedPrivateData) {
          const revealError =
            privateInventorySnapshotsResult.status === 'rejected'
              ? privateInventorySnapshotsResult.reason
              : privateExecutionsResult.status === 'rejected'
                ? privateExecutionsResult.reason
                : null;
          if (revealError instanceof Error) {
            throw revealError;
          }
          if (revealBaseInventory || revealQuoteInventory) {
            throw new Error(
              isMaker
                ? 'No maker reveal snapshot or private fill history was found for this recurring order. Create or edit the order on the latest recurring contract so it can publish maker-readable private liquidity snapshots.'
                : 'No private buy/sell receipts were found for this wallet on the active recurring contract.'
            );
          }
        }

        return {
          ...snapshot,
          recurringOrder: {
            ...recurring,
            ...(isMaker
              ? {
                  makerPrivateInventory: {
                    ...(baseInventoryForMaker !== undefined
                      ? { baseInventory: baseInventoryForMaker }
                      : {}),
                    ...(quoteInventoryForMaker !== undefined
                      ? { quoteInventory: quoteInventoryForMaker }
                      : {})
                  }
                }
              : {}),
            privateExecutions
          }
        };
      }
      let recoveredSnapshot = snapshot;
      const initialEscrowConfig = resolveTradeEscrowContractConfig(recoveredSnapshot.escrowContract);
      if (initialEscrowConfig.directVisible) {
        return enrichDirectVisibleTermsForWallet(recoveredSnapshot, forceReveal);
      }
      if (walletKey && snapshot.maker.toLowerCase() === walletKey && snapshot.hasAccessHash) {
        try {
          recoveredSnapshot = await recoverMakerTradeAccessSecret(snapshot, forceReveal);
        } catch {
          recoveredSnapshot = snapshot;
        }
      }
      const escrowConfig = resolveTradeEscrowContractConfig(recoveredSnapshot.escrowContract);
      if (escrowConfig.directVisible) {
        return enrichDirectVisibleTermsForWallet(recoveredSnapshot, forceReveal);
      }
      if (!isHiddenLiquidityTrade(recoveredSnapshot) || !walletKey) {
        return recoveredSnapshot;
      }
      if (!forceReveal && !walletHasAes) {
        return recoveredSnapshot;
      }

      const isMaker = recoveredSnapshot.maker.toLowerCase() === walletKey;
      if (!forceReveal && !isMaker && !recoveredSnapshot.walletHasFill) {
        return recoveredSnapshot;
      }
      const tradeKey = getSnapshotKey(recoveredSnapshot);
      const knownInitialAmount = knownPrivateLiquidityByTrade[tradeKey];
      const signer = await getTradeSigner(forceReveal);
      const [remainingOfferAmountResult, privateFillReceiptsResult] = await Promise.allSettled([
        isMaker
          ? readPrivateTradeRemainingOfferWei({
              tradeId: recoveredSnapshot.tradeId,
              escrowContract: recoveredSnapshot.escrowContract,
              makerAddress: recoveredSnapshot.maker,
              signer
            })
          : Promise.resolve(null),
        fetchPrivateOrderFillReceiptsForWallet({
          tradeId: recoveredSnapshot.tradeId,
          escrowContract: recoveredSnapshot.escrowContract,
          walletAddress,
          signer
        })
      ]);
      const fetchedPrivateFillReceipts =
        privateFillReceiptsResult.status === 'fulfilled'
          ? privateFillReceiptsResult.value
          : [];
      const existingPrivateFillReceipts = recoveredSnapshot.privateFillReceipts ?? [];
      const privateFillReceipts =
        fetchedPrivateFillReceipts.length > 0 || existingPrivateFillReceipts.length === 0
          ? fetchedPrivateFillReceipts
          : existingPrivateFillReceipts;
      const latestPrivateReceiptWithRemaining = [...privateFillReceipts]
        .reverse()
        .find((receipt) => receipt.remainingOfferAmount !== undefined);
      const remainingOfferAmount =
        remainingOfferAmountResult.status === 'fulfilled'
          ? remainingOfferAmountResult.value
          : null;
      const resolvedRemainingOfferAmount =
        isMaker
          ? remainingOfferAmount ?? (
              latestPrivateReceiptWithRemaining?.remainingOfferAmount &&
              /^\d+$/.test(latestPrivateReceiptWithRemaining.remainingOfferAmount)
                ? BigInt(latestPrivateReceiptWithRemaining.remainingOfferAmount)
                : null
            )
          : null;
      if (!isMaker) {
        if (privateFillReceiptsResult.status === 'rejected') {
          if (forceReveal) {
            throw privateFillReceiptsResult.reason instanceof Error
              ? privateFillReceiptsResult.reason
              : new Error('Private order history reveal failed. AES may need to be refreshed.');
          }
          return snapshot;
        }
        if (privateFillReceipts.length === 0) {
          if (forceReveal) {
            throw new Error('No private fill receipts were found for this wallet.');
          }
          return recoveredSnapshot;
        }
        return {
          ...recoveredSnapshot,
          privateFillReceipts
        };
      }
      if (resolvedRemainingOfferAmount === null) {
        if (remainingOfferAmountResult.status === 'rejected' && privateFillReceiptsResult.status === 'rejected') {
          if (forceReveal) {
            throw remainingOfferAmountResult.reason instanceof Error
              ? remainingOfferAmountResult.reason
              : new Error('Private order reveal failed. AES may need to be refreshed.');
          }
          return recoveredSnapshot;
        }
        if (forceReveal) {
          throw new Error('This private order could not expose maker liquidity or private fill receipts on the active contract.');
        }
        return recoveredSnapshot;
      }

      let filledOfferAmount: string | undefined;
      if (knownInitialAmount && /^\d+$/.test(knownInitialAmount)) {
        const initial = BigInt(knownInitialAmount);
        filledOfferAmount = initial >= resolvedRemainingOfferAmount ? (initial - resolvedRemainingOfferAmount).toString() : '0';
      } else {
        const filledFromReceipts = privateFillReceipts.reduce((total, receipt) => {
          const amount = receipt.offerAmount && /^\d+$/.test(receipt.offerAmount) ? BigInt(receipt.offerAmount) : 0n;
          return total + amount;
        }, 0n);
        if (filledFromReceipts > 0n) {
          filledOfferAmount = filledFromReceipts.toString();
        }
      }

      return {
        ...recoveredSnapshot,
        makerPrivateProgress: {
          initialOfferAmount: knownInitialAmount,
          remainingOfferAmount: resolvedRemainingOfferAmount.toString(),
          filledOfferAmount
        },
        privateFillReceipts
      };
    },
    [
      enrichDirectVisibleTermsForWallet,
      getTradeSigner,
      knownPrivateLiquidityByTrade,
      recoverMakerTradeAccessSecret,
      walletAddress,
      walletHasAes,
      walletKey
    ]
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
    readTradeDetail,
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
    syncSessionKey: [
      walletKey || 'no-wallet',
      chainId ?? 'no-chain',
      connectedWithBurner ? 'app' : selectedWalletId || 'browser'
    ].join(':'),
    walletAddress,
    walletKey
  });

  const openPublicTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;

  const revealMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot) => {
      const tradeKey = getSnapshotKey(snapshot);
      setTradeActionError('');
      try {
        if (!walletKey) {
          throw new Error('Connect the wallet that made or filled this private order.');
        }
        setRevealingPrivateTradeKey(tradeKey);
        const revealedSnapshot = await enrichMakerPrivateProgress(snapshot, true);
        if (getTradeTermsVisibility(snapshot) === 'direct-private-terms') {
          if (!hasHydratedDirectTradeTerms(revealedSnapshot)) {
            throw new Error('Direct amount snapshot could not be read for this wallet. Make sure this is your counter or received offer.');
          }
          mergeTradeSnapshot(revealedSnapshot);
          return;
        }
        if (revealedSnapshot.recurringOrder) {
          const recurring = revealedSnapshot.recurringOrder;
          const hasRevealedInventory =
            recurring.makerPrivateInventory?.baseInventory !== undefined ||
            recurring.makerPrivateInventory?.quoteInventory !== undefined;
          const hasRevealedExecutions = Boolean(recurring.privateExecutions?.length);
          if (!hasRevealedInventory && !hasRevealedExecutions) {
            throw new Error('No private recurring liquidity or private buy/sell receipts were found for this wallet.');
          }
          mergeTradeSnapshot(revealedSnapshot);
          setEditingRecurringOrder((current) =>
            current && getSnapshotKey(current) === tradeKey ? revealedSnapshot : current
          );
          return;
        }
        if (!revealedSnapshot.makerPrivateProgress && !revealedSnapshot.privateFillReceipts?.length) {
          throw new Error('Unable to reveal private history for this wallet. Make sure this is your trade and your wallet AES key is available.');
        }
        mergeTradeSnapshot(revealedSnapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reveal this private order.';
        setTradeActionError(message);
      } finally {
        setRevealingPrivateTradeKey('');
      }
    },
    [
      enrichMakerPrivateProgress,
      mergeTradeSnapshot,
      walletAddress,
      walletKey
    ]
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
      openTrade(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      setTradeLinkInput('');
    },
    [openTrade, showEmptyTradeRoute, tradeLinkInput]
  );

  const hashTradeAccessSecret = useCallback(async (accessSecret: string): Promise<string> => {
    const cotiEthers = await loadCotiEthersModule();
    return cotiEthers.keccak256(accessSecret);
  }, []);

  useEffect(() => {
    if (!detailTrade || routeTradeId === null) {
      return;
    }

    const detailKey = getSnapshotKey(detailTrade);
    const routeKey = buildTradeSnapshotKey(routeTradeId, routeEscrowContract);
    if (detailTrade.tradeId !== routeTradeId || detailKey !== routeKey) {
      return;
    }

    const routeSecret = normalizeAccessSecret(routeAccessSecret);
    const cachedSecret = normalizeAccessSecret(
      resolveKnownTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract)
    );
    const candidateSecret = routeSecret || cachedSecret;
    if (!candidateSecret) {
      return;
    }

    let cancelled = false;
    const validateCandidateSecret = async () => {
      let directCounterWithoutAccessHash = false;
      try {
        if (canUseWalletAuthorityForDirectAccess(detailTrade, walletKey)) {
          return;
        }
        directCounterWithoutAccessHash = Boolean(
          resolveTradeEscrowContractConfig(detailTrade.escrowContract).directVisible &&
            detailTrade.counterParentTradeId &&
            !normalizeAccessHash(detailTrade.accessHash)
        );
      } catch {
        directCounterWithoutAccessHash = false;
      }
      if (directCounterWithoutAccessHash) {
        rememberTradeAccessSecret(detailTrade.tradeId, candidateSecret, detailTrade.escrowContract);
        return;
      }

      if (!detailTrade.hasAccessHash) {
        return;
      }

      if (!normalizeAccessHash(detailTrade.accessHash)) {
        forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
        if (routeSecret) {
          setTradeActionError('This private link could not be verified. Open the full Share link from the maker and try again.');
        }
        return;
      }

      const candidateHash = await hashTradeAccessSecret(candidateSecret);
      const candidateMatches = doesAccessSecretMatchHash(
        candidateSecret,
        detailTrade.accessHash,
        () => candidateHash
      );
      if (cancelled) {
        return;
      }
      if (!candidateMatches) {
        forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
        if (routeSecret) {
          setTradeActionError(PRIVATE_LINK_SECRET_MISMATCH_MESSAGE);
        }
        return;
      }

      if (!cancelled) {
        rememberTradeAccessSecret(detailTrade.tradeId, candidateSecret, detailTrade.escrowContract);
      }
    };

    validateCandidateSecret().catch(() => {
      if (cancelled) {
        return;
      }
      forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
      if (routeSecret) {
        setTradeActionError('This private link could not be verified. Open the full Share link from the maker and try again.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    detailTrade,
    forgetTradeAccessSecret,
    hashTradeAccessSecret,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    routeAccessSecret,
    routeEscrowContract,
    routeTradeId,
    setTradeActionError,
    walletKey
  ]);

  const detailTradeResetKey = detailTrade ? getSnapshotKey(detailTrade) : '';

  useEffect(() => {
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setTerminalHistorySheetKey('');
  }, [detailTradeResetKey, route.view]);

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
        tradeHasNoExpiry,
        tradeHidePrivateLiquidity,
        hiddenLiquidityUnavailableMessage:
          counterParentTrade
            ? 'Hidden amount orders are only available for fixed-price offers.'
            : editingTrade && !editingTrade.hiddenLiquidity
              ? 'Hide amount cannot be added to a visible-order edit.'
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
      tradeHasNoExpiry,
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

  const updateTradeOfferAmountInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradeOfferAmountInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'baseAmount'));
  }, []);

  const updateTradeRequestAmountInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradeRequestAmountInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'quoteAmount'));
  }, []);

  const updateTradePriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradePriceInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'price'));
  }, []);

  const updateRecurringBuyPriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setRecurringBuyPriceInput(sanitized);
  }, []);

  const updateRecurringSellPriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setRecurringSellPriceInput(sanitized);
  }, []);

  useEffect(() => {
    const offerToken = tradeComposerModel.selectedTradeOfferToken;
    const requestToken = tradeComposerModel.selectedTradeRequestToken;
    if (!offerToken || !requestToken) return;

    const update = deriveTradePricingUpdate({
      baseAmountInput: tradeOfferAmountInput,
      quoteAmountInput: tradeRequestAmountInput,
      priceInput: tradePriceInput,
      baseDecimals: offerToken.decimals,
      quoteDecimals: requestToken.decimals,
      editedFields: tradePricingEditedFields
    });
    if (!update) return;

    if (update.field === 'baseAmount') {
      setTradeOfferAmountInput(update.value);
    } else if (update.field === 'quoteAmount') {
      setTradeRequestAmountInput(update.value);
    } else {
      setTradePriceInput(update.value);
    }
    setTradePricingEditedFields((previous) =>
      pricingFieldsEqual(previous, update.sourceFields) ? previous : update.sourceFields
    );
  }, [
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
    tradeOfferAmountInput,
    tradePriceInput,
    tradePricingEditedFields,
    tradeRequestAmountInput
  ]);

  const mergeQueuedP2PSync = useCallback((request: QueuedTradeDataRefresh) => {
    queuedTradeDataRefreshRef.current = mergeP2PSyncRequests(queuedTradeDataRefreshRef.current, request);
  }, []);

  const runP2PSyncRequest = useCallback(
    (request: QueuedTradeDataRefresh) => {
      const domains = request.domains;
      const silent = shouldUseSilentP2PSync(request.reason);
      void Promise.allSettled([
        domains.has('balances')
          ? refreshWalletBalances({ reason: request.reason === 'manual' ? 'manual' : 'trade-action', signer: request.signer, silent })
          : Promise.resolve(),
        domains.has('wallet-trades') && walletAddress
          ? refreshMyTrades({ silent })
          : Promise.resolve(),
        domains.has('public-trades')
          ? refreshPublicTrades({ silent })
          : Promise.resolve(),
        domains.has('trade-detail') && request.tradeId
          ? refreshTradeDetail(request.tradeId, request.escrowContract, { silent }).catch(() => null)
          : Promise.resolve(null)
      ]);
    },
    [refreshMyTrades, refreshPublicTrades, refreshTradeDetail, refreshWalletBalances, walletAddress]
  );

  const flushQueuedP2PSync = useCallback(() => {
    if (p2pSyncTimerRef.current !== null) {
      window.clearTimeout(p2pSyncTimerRef.current);
      p2pSyncTimerRef.current = null;
    }
    const queued = queuedTradeDataRefreshRef.current;
    if (!queued) {
      return;
    }
    if (
      queued.reason !== 'manual' &&
      (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive())
    ) {
      recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-sync-flush-held');
      return;
    }
    queuedTradeDataRefreshRef.current = null;
    runP2PSyncRequest(queued);
  }, [getTradeWalletFlowInput, runP2PSyncRequest]);

  const scheduleP2PSync = useCallback(
    (request: {
      domains: P2PSyncDomain[];
      escrowContract?: string;
      reason: P2PSyncReason;
      signer?: TradeSigner;
      tradeId?: number;
    }) => {
      mergeQueuedP2PSync({
        domains: new Set(request.domains),
        escrowContract: request.escrowContract,
        reason: request.reason,
        signer: request.signer,
        tradeId: request.tradeId
      });
      if (
        request.reason !== 'manual' &&
        (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive())
      ) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-sync-queued');
        return;
      }
      if (request.reason === 'manual' || request.reason === 'wallet-action') {
        flushQueuedP2PSync();
        return;
      }
      if (p2pSyncTimerRef.current !== null) {
        return;
      }
      p2pSyncTimerRef.current = window.setTimeout(() => {
        p2pSyncTimerRef.current = null;
        flushQueuedP2PSync();
      }, REALTIME_SYNC_DEBOUNCE_MS);
    },
    [flushQueuedP2PSync, getTradeWalletFlowInput, mergeQueuedP2PSync]
  );

  const refreshTradeDataInBackground = useCallback(
    (tradeId?: number, escrowContract?: string, signer?: TradeSigner) => {
      const targetTradeId = tradeId ?? (routeView === 'trade' ? routeTradeId ?? undefined : undefined);
      const targetEscrow = escrowContract ?? (targetTradeId ? routeEscrowContract : undefined);
      scheduleP2PSync({
        domains: ['balances', 'wallet-trades', 'public-trades', ...(targetTradeId ? (['trade-detail'] as const) : [])],
        escrowContract: targetEscrow,
        reason: 'wallet-action',
        signer,
        tradeId: targetTradeId
      });
    },
    [routeEscrowContract, routeTradeId, routeView, scheduleP2PSync]
  );

  useEffect(() => {
    flushQueuedTradeDataRefreshRef.current = flushQueuedP2PSync;
  }, [flushQueuedP2PSync]);

  const signAesForCurrentWallet = useCallback(async () => {
    const provider = effectiveBrowserProvider;
    const burnerSigner = burnerWalletRef.current;
    const activeBrowserProvider = !connectedWithBurner ? provider : null;
    const activeBurnerSigner = connectedWithBurner ? burnerSigner : null;
    if (!activeBrowserProvider && !activeBurnerSigner) {
      setWalletError('Connect a wallet first.');
      return;
    }
    if (!walletAddress) {
      setWalletError('Connect a wallet first.');
      return;
    }

    setWalletError('');
    setConnectingWalletId('aes');
    logMobileWalletDiagnostic('privacy-unlock-start', {
      source: activeBrowserProvider ? 'browser-wallet' : 'app-wallet'
    });
    try {
      if (activeBrowserProvider) {
        clearCotiAesUnlockRequest(walletAddress, activeBrowserProvider);
      }
      if (activeBurnerSigner) {
        setActiveCotiSnapAesStatus('unsupported');
      }
      const signer = await getTradeSigner(false);
      const refreshStaleSnapAes =
        cotiSnapAesStatus === 'installed-aes-stale' ||
        cotiSnapAesStatus === 'key-mismatch' ||
        cotiSnapAesStatus === 'repair-needed';
      if (refreshStaleSnapAes) {
        sharedWalletSession?.onWalletAesHealthChange?.(
          walletAddress,
          buildWalletAesHealthState({
            status: 'repairing',
            walletAddress
          })
        );
      }
      const unlockResult = await getOrRecoverAesForWalletResult({
        allowLegacyFallback: true,
        allowUnrecoverableReset: false,
        forceFreshAes: false,
        forceLegacyRefresh: false,
        forceRefresh: true,
        provider: activeBrowserProvider ?? undefined,
        signer,
        walletAddress
      });
      if (unlockResult.status !== 'ready') {
        const nextStatus: CotiSnapAesStatus =
          unlockResult.reason === 'missing-aes'
            ? 'installed-aes-missing'
            : unlockResult.reason === 'rejected'
              ? 'rejected'
              : unlockResult.reason === 'unsupported'
                ? 'unsupported'
                : unlockResult.reason === 'unsupported-mobile'
                  ? 'unsupported-mobile'
                : unlockResult.reason === 'not-installed'
                  ? 'not-installed'
                  : unlockResult.reason === 'unrecoverable'
                    ? 'key-mismatch'
                    : 'error';
        setActiveCotiSnapAesStatus(nextStatus);
        const unlockFailureMessage =
          unlockResult.reason === 'wallet-mismatch'
            ? 'MetaMask is not on the connected wallet. Switch to the active ChainWhisper wallet and try again.'
            : unlockResult.reason === 'wrong-network'
              ? 'Switch MetaMask to COTI Mainnet before unlocking privacy.'
              : unlockResult.reason === 'missing-aes'
                ? 'COTI Snap has no AES key for this active MetaMask account. If the account was not selected during Snap install, reconnect/reinstall the Snap with that account selected. Then open https://metamask.coti.io/wallet with this MetaMask account active, onboard or recover its AES key, return here, and click Unlock privacy.'
                : unlockResult.reason === 'unsupported-mobile'
                  ? 'MetaMask Mobile does not support Snaps here. Unlock privacy will use wallet AES instead.'
                : unlockResult.reason === 'not-installed'
                  ? 'Install or approve COTI Snap for MetaMask, then click Unlock privacy again.'
                  : unlockResult.reason === 'rejected'
                    ? 'The COTI Snap request was rejected. Approve the Snap prompt to unlock privacy with MetaMask.'
                    : unlockResult.reason === 'unrecoverable'
                      ? 'This wallet AES key does not decrypt existing private data, and this session has no recoverable onboarding data for it.'
                      : 'Privacy unlock was not completed.';
        setWalletError(unlockFailureMessage);
        return;
      }
      setOnboardInfoByAddress((previous) =>
        mergeOnboardInfoByAddress(previous, walletAddress.toLowerCase(), unlockResult.onboardInfo)
      );

      let finalUnlockResult = unlockResult;
      let reloadResult = await reloadPrivateBalancesWithUnlockedSigner(signer);
      let failedAllPrivateTokenDecrypts =
        reloadResult.failedTokenAddresses.length > 0 && reloadResult.readyTokenAddresses.length === 0;
      if (
        failedAllPrivateTokenDecrypts &&
        activeBrowserProvider &&
        finalUnlockResult.source === 'snap'
      ) {
        sharedWalletSession?.onWalletAesHealthChange?.(
          walletAddress,
          buildWalletAesHealthState({
            message:
              'COTI Snap returned an AES key for this MetaMask account, but it did not decrypt this wallet data.',
            status: 'key-mismatch',
            walletAddress
          })
        );
        setActiveCotiSnapAesStatus('key-mismatch', reloadResult.failedTokenAddresses);
        setWalletError(
          'COTI Snap returned an AES key, but it does not decrypt this wallet. Make sure MetaMask is switched to this exact account. If it is, open the COTI Snap wallet, re-onboard that account, then click Unlock privacy again.'
        );
        return;
      }
      if (
        failedAllPrivateTokenDecrypts &&
        activeBrowserProvider &&
        finalUnlockResult.source === 'fallback'
      ) {
        sharedWalletSession?.onWalletAesHealthChange?.(
          walletAddress,
          buildWalletAesHealthState({
            message:
              'The recovered AES key did not decrypt this wallet data. Repairing with a fresh wallet key.',
            status: 'repairing',
            walletAddress
          })
        );
        setActiveCotiSnapAesStatus('repair-needed', reloadResult.failedTokenAddresses);
        clearFallbackAesSessionOnboardInfo(walletAddress, activeBrowserProvider);
        const repairedUnlockResult = await getOrRecoverAesForWalletResult({
          allowLegacyFallback: true,
          allowUnrecoverableReset: true,
          forceFreshAes: true,
          forceLegacyRefresh: true,
          forceRefresh: true,
          provider: activeBrowserProvider ?? undefined,
          signer,
          walletAddress
        });
        if (repairedUnlockResult.status !== 'ready') {
          clearFallbackAesSessionOnboardInfo(walletAddress, activeBrowserProvider);
          resetSignerOnboardInfoForFreshAes(signer);
          setOnboardInfoByAddress((previous) => {
            const next = { ...previous };
            delete next[walletAddress.toLowerCase()];
            return next;
          });
          sharedWalletSession?.onWalletAesHealthChange?.(
            walletAddress,
            buildWalletAesHealthState({
              message: 'The app could not refresh this wallet privacy key.',
              status: 'repair-needed',
              walletAddress
            })
          );
          setActiveCotiSnapAesStatus('repair-needed', reloadResult.failedTokenAddresses);
          setWalletError(
            'Privacy unlock could not refresh this wallet AES key. Confirm MetaMask is on the same wallet and try Unlock privacy again.'
          );
          return;
        }
        finalUnlockResult = repairedUnlockResult;
        setOnboardInfoByAddress((previous) => ({
          ...previous,
          [walletAddress.toLowerCase()]: repairedUnlockResult.onboardInfo
        }));
        reloadResult = await reloadPrivateBalancesWithUnlockedSigner(signer);
        failedAllPrivateTokenDecrypts =
          reloadResult.failedTokenAddresses.length > 0 && reloadResult.readyTokenAddresses.length === 0;
      }
      if (failedAllPrivateTokenDecrypts) {
        sharedWalletSession?.onWalletAesHealthChange?.(
          walletAddress,
          buildWalletAesHealthState({
            message: 'Private token balances could not decrypt after unlocking this wallet.',
            status: 'repair-needed',
            walletAddress
          })
        );
        setActiveCotiSnapAesStatus('repair-needed', reloadResult.failedTokenAddresses);
        setWalletError(
          'Private token balances still could not decrypt after unlocking this wallet. Use Unlock privacy again to retry the wallet-specific repair.'
        );
        return;
      }
      setActiveCotiSnapAesStatus('installed-aes-ready');
      sharedWalletSession?.onWalletAesHealthChange?.(
        walletAddress,
        buildWalletAesHealthState({
          message:
            finalUnlockResult.source === 'fallback' &&
            finalUnlockResult.snapStoreStatus &&
            finalUnlockResult.snapStoreStatus !== 'ready'
              ? 'Privacy is unlocked for this session, but COTI Snap did not save the refreshed key.'
              : undefined,
          status: finalUnlockResult.source === 'snap' ? 'ready-unverified' : 'ready',
          walletAddress
        })
      );
      if (
        activeBrowserProvider &&
        finalUnlockResult.source === 'fallback' &&
        finalUnlockResult.snapStoreStatus &&
        finalUnlockResult.snapStoreStatus !== 'ready'
      ) {
        setWalletError(
          'Privacy is unlocked for this session, but COTI Snap did not save the refreshed key. If it happens again after switching wallets, unlock privacy once more.'
        );
      }
      await refreshWalletBalances({ reason: 'unlock', signer, silent: true });
    } catch (error) {
      setActiveCotiSnapAesStatus('error');
      setWalletError(getProviderErrorMessage(error, 'AES signature was not completed.'));
    } finally {
      setConnectingWalletId('');
    }
  }, [
    cotiSnapAesStatus,
    connectedWithBurner,
    effectiveBrowserProvider,
    getTradeSigner,
    refreshWalletBalances,
    reloadPrivateBalancesWithUnlockedSigner,
    setActiveCotiSnapAesStatus,
    sharedWalletSession,
    walletAddress
  ]);

  const unlockPrivacyForTradingWallet = useCallback(async () => {
    if (!sharedWalletActions?.unlockPrivacy) {
      await signAesForCurrentWallet();
      return;
    }

    const forceFreshPrivacy =
      sharedWalletAesHealth?.status === 'repair-needed' ||
      sharedWalletAesHealth?.status === 'key-mismatch' ||
      cotiSnapAesStatus === 'installed-aes-stale' ||
      cotiSnapAesStatus === 'key-mismatch' ||
      cotiSnapAesStatus === 'repair-needed';

    setWalletError('');
    setConnectingWalletId('aes');
    logMobileWalletDiagnostic('privacy-unlock-start', {
      source: 'shared-wallet-session'
    });
    try {
      await Promise.resolve(sharedWalletActions.unlockPrivacy({ forceFreshPrivacy }));
      globalThis.setTimeout(() => {
        refreshTradeDataInBackground();
      }, 0);
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'AES signature was not completed.'));
    } finally {
      setConnectingWalletId('');
    }
  }, [
    cotiSnapAesStatus,
    refreshTradeDataInBackground,
    sharedWalletActions,
    sharedWalletAesHealth?.status,
    signAesForCurrentWallet
  ]);

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
    loadWalletBalances: (signer?: TradeSigner) => {
      refreshTradeDataInBackground(undefined, undefined, signer);
      return Promise.resolve();
    },
    mergeTradeSnapshot,
    navigateToTradePath,
    openTrade,
    refreshMyTrades: () => {
      refreshTradeDataInBackground();
      return Promise.resolve();
    },
    refreshPublicTrades: () => {
      refreshTradeDataInBackground();
      return Promise.resolve();
    },
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    resolveRequiredFeeForTradeCreate,
    runTradeWalletPromptFlow,
    setCounterParentTrade,
    setCreatedTradeId,
    setCreatedTradeLink,
    setCreatingTrade,
    setDetailTrade,
    setDirectTradeRecipient,
    setEditingTrade,
    setTradeActionError,
    setTradeExpiryHoursInput,
    setTradeHasNoExpiry,
    setTradeHidePrivateLiquidity,
    setTradeOfferAmountInput,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestAmountInput,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    setTradeVisibility,
    tradeComposerModel,
    tradeHasNoExpiry,
    tradeHidePrivateLiquidity,
    tradeVisibility,
    walletAddress,
    walletKey
  });

  const startFreshOneOffTrade = useCallback(() => {
    setTradeCreateMode('one-off');
    setTradePriceInput('');
    setTradePricingEditedFields([]);
    setEditingRecurringOrder(null);
    setRecurringAddBuyBudgetInput('');
    setRecurringAddSellInventoryInput('');
    setRecurringBuyReceiveInput('');
    setRecurringSellReceiveInput('');
    setRecurringBuyReceiveEditable(false);
    setRecurringSellReceiveEditable(false);
    setRecurringRemoveBuyBudgetInput('');
    setRecurringRemoveSellInventoryInput('');
    startFreshTrade();
  }, [startFreshTrade]);

  const cancelCounterCreate = useCallback(() => {
    clearCounterTrade();
    setTradeCreateMode('one-off');
    setTradeOfferAmountInput('');
    setTradeRequestAmountInput('');
    setTradePriceInput('');
    setTradePricingEditedFields([]);
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setTradeHasNoExpiry(false);
    navigateToTradePath('/trades/open');
  }, [clearCounterTrade, navigateToTradePath]);

  const startFreshRecurringOrder = useCallback(() => {
    setTradeCreateMode('recurring');
    setEditingRecurringOrder(null);
    setRecurringBuyPriceInput('');
    setRecurringSellPriceInput('');
    setRecurringAddBuyBudgetInput('');
    setRecurringAddSellInventoryInput('');
    setRecurringBuyReceiveInput('');
    setRecurringSellReceiveInput('');
    setRecurringBuyReceiveEditable(false);
    setRecurringSellReceiveEditable(false);
    setRecurringRemoveBuyBudgetInput('');
    setRecurringRemoveSellInventoryInput('');
    setCreatedRecurringOrderId(null);
    setCreatedRecurringOrderLink('');
  }, []);

  const resolveRecurringAssetSelection = useCallback(
    (asset: TradeAssetPayload): TradeTokenPresetKey => {
      if (asset.kind === 'native') {
        return 'coti';
      }
      const tokenAddress = asset.tokenAddress?.toLowerCase() ?? '';
      if (tokenAddress === REWARD_TOKEN_ADDRESS.toLowerCase()) {
        return 'wisp';
      }
      if (tokenAddress === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
        return 'pwisp';
      }
      const hasVerifiedOption = tradeComposerModel.tradeTokenOptions.some(
        (option) => option.value.toLowerCase() === tokenAddress && !option.value.startsWith('custom')
      );
      if (hasVerifiedOption) {
        return tokenAddress;
      }
      return asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public';
    },
    [tradeComposerModel.tradeTokenOptions]
  );

  const beginEditRecurringOrder = useCallback(
    (snapshot: TradeSnapshot) => {
      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return;
      }
      const baseSelection = resolveRecurringAssetSelection(recurring.baseAsset);
      const quoteSelection = resolveRecurringAssetSelection(recurring.quoteAsset);
      clearEditTrade();
      clearCounterTrade();
      setTradeCreateMode('recurring');
      setEditingRecurringOrder(snapshot);
      setTradeOfferTokenSelection(baseSelection);
      setTradeRequestTokenSelection(quoteSelection);
      setTradeOfferCustomTokenAddress(baseSelection.startsWith('custom') ? recurring.baseAsset.tokenAddress ?? '' : '');
      setTradeRequestCustomTokenAddress(quoteSelection.startsWith('custom') ? recurring.quoteAsset.tokenAddress ?? '' : '');
      setRecurringHidePrivateAmounts(recurring.mode !== 'public');
      setRecurringBuyPriceInput(
        formatPriceInputFromTerms(
          recurring.buyTerms.baseAmount,
          recurring.buyTerms.quoteAmount,
          recurring.baseAsset.decimals,
          recurring.quoteAsset.decimals
        )
      );
      setRecurringSellPriceInput(
        formatPriceInputFromTerms(
          recurring.sellTerms.baseAmount,
          recurring.sellTerms.quoteAmount,
          recurring.baseAsset.decimals,
          recurring.quoteAsset.decimals
        )
      );
      setRecurringAddBuyBudgetInput('');
      setRecurringAddSellInventoryInput('');
      setRecurringBuyReceiveInput('');
      setRecurringSellReceiveInput('');
      setRecurringBuyReceiveEditable(false);
      setRecurringSellReceiveEditable(false);
      setRecurringRemoveBuyBudgetInput('');
      setRecurringRemoveSellInventoryInput('');
      setCreatedRecurringOrderId(null);
      setCreatedRecurringOrderLink('');
      navigateToTradePath('/trades/create');
    },
    [clearCounterTrade, clearEditTrade, navigateToTradePath, resolveRecurringAssetSelection]
  );

  const clearRecurringEdit = useCallback(() => {
    startFreshRecurringOrder();
  }, [startFreshRecurringOrder]);

  const resolveRecurringFundingBalance = useCallback(
    (token: ResolvedTradeToken): RecurringFundingBalanceResult => {
      if (token.kind === 'native') {
        return {
          balanceWei: nativeBalanceWei,
          unavailableMessage: nativeBalanceWei === null ? `Unable to read your ${TIP_NATIVE_TOKEN_SYMBOL} balance yet.` : undefined
        };
      }

      const tokenAddress = token.tokenAddress?.trim() ?? '';
      if (!isWalletAddress(tokenAddress)) {
        return {
          balanceWei: null,
          unavailableMessage: `Unable to read ${token.symbol} balance because the token address is invalid.`
        };
      }

      const tokenKey = tokenAddress.toLowerCase();
      if (token.kind === 'erc20') {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          return {
            balanceWei: rewardTokenBalanceWei,
            unavailableMessage: rewardTokenBalanceWei === null ? `Unable to read your ${token.symbol} balance yet.` : undefined
          };
        }

        const info = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('erc20', tokenAddress)];
        return {
          balanceWei: info?.balanceWei ?? null,
          unavailableMessage:
            info?.loading
              ? `Loading ${token.symbol} balance. Try again in a moment.`
              : info?.error ?? (info?.balanceWei === null || !info ? `Unable to read your ${token.symbol} balance yet.` : undefined)
        };
      }

      const privateInfo = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('private-erc20', tokenAddress)];
      const privateBalanceState: PrivateTokenBalanceState =
        tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
          ? pWispFooterBalanceState
          : privateInfo?.privateBalanceState ?? { status: 'locked' };
      if (privateBalanceState.status === 'ready') {
        return { balanceWei: privateBalanceState.balanceWei };
      }
      if (privateInfo?.loading || privateBalanceState.status === 'setup-pending') {
        return {
          balanceWei: null,
          unavailableMessage: `Loading ${token.symbol} private-token visibility. Try again in a moment.`
        };
      }
      if (privateBalanceState.status === 'setup-needed') {
        return {
          balanceWei: null,
          unavailableMessage: `Set up ${token.symbol} private-token visibility before funding this recurring order.`
        };
      }
      if (privateBalanceState.status === 'decrypt-failed' || privateBalanceState.status === 'snap-stale') {
        return {
          balanceWei: null,
          unavailableMessage: `Refresh privacy for ${token.symbol} before funding this recurring order.`
        };
      }
      if (privateBalanceState.status === 'unsupported' || privateInfo?.error) {
        return {
          balanceWei: null,
          unavailableMessage: privateInfo?.error ?? `${token.symbol} is not available as a current COTI private token.`
        };
      }
      return {
        balanceWei: null,
        unavailableMessage: `Unlock privacy to check your ${token.symbol} balance before funding this recurring order.`
      };
    },
    [
      customTradeTokenInfoByAddress,
      nativeBalanceWei,
      pWispFooterBalanceState,
      rewardTokenBalanceWei
    ]
  );

  const validateRecurringFundingBalances = useCallback(
    ({
      addBaseInventoryWei,
      addQuoteInventoryWei,
      baseToken,
      includeCreateFee,
      quoteToken
    }: {
      addBaseInventoryWei: bigint;
      addQuoteInventoryWei: bigint;
      baseToken: ResolvedTradeToken;
      includeCreateFee: boolean;
      quoteToken: ResolvedTradeToken;
    }): string => {
      if (includeCreateFee && tradeRequiredFeeWei === null) {
        return 'Loading recurring order fee. Try again in a moment.';
      }

      const checkTokenFunding = (token: ResolvedTradeToken, amountWei: bigint): string => {
        if (amountWei <= 0n || token.kind === 'native') {
          return '';
        }
        const balanceResult = resolveRecurringFundingBalance(token);
        if (balanceResult.unavailableMessage) {
          return balanceResult.unavailableMessage;
        }
        if (balanceResult.balanceWei === null) {
          return `Unable to read your ${token.symbol} balance yet.`;
        }
        if (amountWei > balanceResult.balanceWei) {
          return `Insufficient ${token.symbol} balance. Need ${formatTokenAmount(
            amountWei,
            token.decimals,
            6
          )} ${token.symbol}; available ${formatTokenAmount(balanceResult.balanceWei, token.decimals, 6)} ${token.symbol}.`;
        }
        return '';
      };

      const baseFundingError = checkTokenFunding(baseToken, addBaseInventoryWei);
      if (baseFundingError) {
        return baseFundingError;
      }
      const quoteFundingError = checkTokenFunding(quoteToken, addQuoteInventoryWei);
      if (quoteFundingError) {
        return quoteFundingError;
      }

      const nativeLiquidityWei =
        (baseToken.kind === 'native' ? addBaseInventoryWei : 0n) +
        (quoteToken.kind === 'native' ? addQuoteInventoryWei : 0n);
      const nativeRequiredWei = nativeLiquidityWei + (includeCreateFee ? tradeRequiredFeeWei ?? 0n : 0n);
      if (nativeRequiredWei <= 0n) {
        return '';
      }
      if (nativeBalanceWei === null) {
        return `Unable to read your ${TIP_NATIVE_TOKEN_SYMBOL} balance yet.`;
      }
      if (nativeRequiredWei > nativeBalanceWei) {
        return `Insufficient ${TIP_NATIVE_TOKEN_SYMBOL} balance. Need ${formatCotiAmount(
          nativeRequiredWei
        )} ${TIP_NATIVE_TOKEN_SYMBOL} to fund recurring liquidity${includeCreateFee ? ' and the fee' : ''}; available ${formatCotiAmount(
          nativeBalanceWei
        )} ${TIP_NATIVE_TOKEN_SYMBOL}.`;
      }
      return '';
    },
    [nativeBalanceWei, resolveRecurringFundingBalance, tradeRequiredFeeWei]
  );

  useEffect(() => {
    if (editingTrade || counterParentTrade) {
      setTradeCreateMode('one-off');
      setTradePriceInput('');
      setTradePricingEditedFields([]);
      setEditingRecurringOrder(null);
    }
  }, [counterParentTrade, editingTrade]);

  const createRecurringOrder = useCallback(async () => {
    const recurringOrderBeingEdited = editingRecurringOrder?.recurringOrder ?? null;
    const baseToken = tradeComposerModel.selectedTradeOfferToken;
    const quoteToken = tradeComposerModel.selectedTradeRequestToken;
    if (!walletAddress) {
      setTradeActionError('Connect a wallet first.');
      return;
    }
    if (!onCotiNetwork) {
      setTradeActionError('Switch to COTI network first.');
      return;
    }
    if (!baseToken || !quoteToken) {
      setTradeActionError('Select base and quote assets first.');
      return;
    }
    if (
      baseToken.kind === quoteToken.kind &&
      (baseToken.tokenAddress ?? '').toLowerCase() === (quoteToken.tokenAddress ?? '').toLowerCase()
    ) {
      setTradeActionError('Recurring orders need two different assets.');
      return;
    }

    const addBaseInventoryWei = parseTokenAmountInput(recurringAddSellInventoryInput, baseToken.decimals) ?? 0n;
    const addQuoteInventoryWei = parseTokenAmountInput(recurringAddBuyBudgetInput, quoteToken.decimals) ?? 0n;
    const removeBaseInventoryWei = recurringOrderBeingEdited
      ? parseTokenAmountInput(recurringRemoveSellInventoryInput, baseToken.decimals) ?? 0n
      : 0n;
    const removeQuoteInventoryWei = recurringOrderBeingEdited
      ? parseTokenAmountInput(recurringRemoveBuyBudgetInput, quoteToken.decimals) ?? 0n
      : 0n;
    const hidePrivateRecurringAmounts =
      recurringHidePrivateAmounts && (baseToken.kind === 'private-erc20' || quoteToken.kind === 'private-erc20');
    const buyTerms = resolveRecurringSideTerms({
      baseAmountWei: null,
      quoteAmountWei: null,
      priceInput: recurringBuyPriceInput,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals,
      forcePriceOnly: true
    });
    const sellTerms = resolveRecurringSideTerms({
      baseAmountWei: null,
      quoteAmountWei: null,
      priceInput: recurringSellPriceInput,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals,
      forcePriceOnly: true
    });
    if (!buyTerms || !sellTerms) {
      setTradeActionError('Enter a buy price and a sell price. Liquidity can stay empty until that side is funded.');
      return;
    }
    if (!recurringOrderBeingEdited && addBaseInventoryWei <= 0n && addQuoteInventoryWei <= 0n) {
      setTradeActionError('Add buy liquidity, sell liquidity, or both to start the order.');
      return;
    }
    const fundingValidationMessage = validateRecurringFundingBalances({
      addBaseInventoryWei,
      addQuoteInventoryWei,
      baseToken,
      includeCreateFee: !recurringOrderBeingEdited,
      quoteToken
    });
    if (fundingValidationMessage) {
      setTradeActionError(fundingValidationMessage);
      return;
    }

    setTradeActionError('');
    setCreatingRecurringOrder(true);
    try {
      await runTradeWalletPromptFlow(async () => {
      const needsAes = baseToken.kind === 'private-erc20' || quoteToken.kind === 'private-erc20';
      const signer = await getTradeSigner(needsAes);
      const nativeFeeWei = recurringOrderBeingEdited
        ? 0n
        : await resolveRequiredFeeForTradeCreate(RECURRING_OTC_CONTRACT_ADDRESS);
      const recurringAssetParams = {
        baseAsset: {
          kind: baseToken.kind,
          tokenAddress: baseToken.tokenAddress
        },
        quoteAsset: {
          kind: quoteToken.kind,
          tokenAddress: quoteToken.tokenAddress
        }
      };
      const result = recurringOrderBeingEdited
        ? await (async () => {
            await editRecurringOrderOnChain({
              signer,
              makerAddress: walletAddress,
              orderId: recurringOrderBeingEdited.orderId,
              ...recurringAssetParams,
              buyBaseAmountWei: buyTerms.baseAmountWei,
              buyQuoteAmountWei: buyTerms.quoteAmountWei,
              sellBaseAmountWei: sellTerms.baseAmountWei,
              sellQuoteAmountWei: sellTerms.quoteAmountWei,
              addBaseInventoryWei,
              addQuoteInventoryWei,
              removeBaseInventoryWei,
              removeQuoteInventoryWei,
              hidePrivateAmounts: hidePrivateRecurringAmounts
            });
            return {
              orderId: recurringOrderBeingEdited.orderId,
              escrowContract: editingRecurringOrder?.escrowContract ?? RECURRING_OTC_CONTRACT_ADDRESS
            };
          })()
        : await createRecurringOrderOnChain({
            signer,
            makerAddress: walletAddress,
            ...recurringAssetParams,
            buyBaseAmountWei: buyTerms.baseAmountWei,
            buyQuoteAmountWei: buyTerms.quoteAmountWei,
            sellBaseAmountWei: sellTerms.baseAmountWei,
            sellQuoteAmountWei: sellTerms.quoteAmountWei,
            initialBaseInventoryWei: addBaseInventoryWei,
            initialQuoteInventoryWei: addQuoteInventoryWei,
            nativeFeeWei,
            isPublic: true,
            hidePrivateAmounts: hidePrivateRecurringAmounts
          });
      setCreatedRecurringOrderId(result.orderId);
      const nextLink = buildTradeShareUrl(result.orderId, undefined, result.escrowContract);
      setCreatedRecurringOrderLink(nextLink);
      if (recurringOrderBeingEdited) {
        setEditingRecurringOrder(null);
        setRecurringAddBuyBudgetInput('');
        setRecurringAddSellInventoryInput('');
        setRecurringBuyReceiveInput('');
        setRecurringSellReceiveInput('');
        setRecurringBuyReceiveEditable(false);
        setRecurringSellReceiveEditable(false);
        setRecurringRemoveBuyBudgetInput('');
        setRecurringRemoveSellInventoryInput('');
        openTrade(result.orderId, undefined, result.escrowContract);
      }
      refreshTradeDataInBackground(result.orderId, result.escrowContract, signer);
      openTrade(result.orderId, undefined, result.escrowContract);
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : recurringOrderBeingEdited
          ? 'Failed to update recurring order.'
          : 'Failed to create recurring order.';
      setTradeActionError(getProviderErrorMessage(error, message));
    } finally {
      setCreatingRecurringOrder(false);
    }
  }, [
    getTradeSigner,
    onCotiNetwork,
    recurringBuyPriceInput,
    recurringHidePrivateAmounts,
    recurringSellPriceInput,
    buildTradeShareUrl,
    editingRecurringOrder,
    refreshTradeDataInBackground,
    runTradeWalletPromptFlow,
    openTrade,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    resolveRequiredFeeForTradeCreate,
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
    tradeRequiredFeeWei,
    validateRecurringFundingBalances,
    walletAddress
  ]);

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
    openTrade,
    rememberTradeTerminalReturn,
    refreshTradeDataInBackground,
    readTradeDetail,
    resolveKnownTradeAccessSecret,
    rememberTradeAccessSecret,
    resolvedRouteAccessSecret,
    routeEscrowContract,
    routeTradeId,
    runTradeWalletPromptFlow,
    setTradeActionError,
    walletAddress
  });

  const fillRecurringOrderSide = useCallback(
    async (snapshot: TradeSnapshot, side: 'buy' | 'sell', amountInputOverride?: string) => {
      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return;
      }
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }
      if (!onCotiNetwork) {
        setTradeActionError('Switch to COTI network first.');
        return;
      }
      const inputAsset = side === 'buy' ? recurring.baseAsset : recurring.quoteAsset;
      const inputValue = amountInputOverride ?? (side === 'buy' ? recurringBuyFillInput : recurringSellFillInput);
      const inputAmountWei = parseTokenAmountInput(inputValue, inputAsset.decimals);
      if (inputAmountWei === null || inputAmountWei <= 0n) {
        setTradeActionError(side === 'buy' ? `Enter ${inputAsset.symbol} to sell.` : `Enter ${inputAsset.symbol} budget.`);
        return;
      }

      const actionKey = `${getSnapshotKey(snapshot)}:${side}`;
      setTradeActionError('');
      setProcessingRecurringAction(actionKey);
      try {
        await runTradeWalletPromptFlow(async () => {
        rememberTradeTerminalReturn(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
        const needsAes = recurring.mode !== 'public' || inputAsset.kind === 'private-erc20';
        const signer = await getTradeSigner(needsAes);
        if (inputAsset.kind === 'private-erc20' && inputAsset.tokenAddress) {
          const privateInputBalance = await readCurrentPrivateErc20BalanceWei(
            inputAsset.tokenAddress,
            walletAddress,
            signer
          ).catch(() => null);
          if (privateInputBalance === null) {
            setTradeActionError(`Unlock privacy and refresh your ${inputAsset.symbol} balance before selling.`);
            return;
          }
          if (privateInputBalance < inputAmountWei) {
            setTradeActionError(
              `Not enough ${inputAsset.symbol}. Available: ${formatTokenAmount(privateInputBalance, inputAsset.decimals, 6)} ${inputAsset.symbol}.`
            );
            return;
          }
        }
        await fillRecurringOrderSideOnChain({
          signer,
          ownerAddress: walletAddress,
          orderId: recurring.orderId,
          side,
          inputAsset,
          inputAmountWei,
          hiddenAmounts: recurring.mode !== 'public',
          accessSecret: resolvedRouteAccessSecret || undefined
        });
        if (side === 'buy') {
          setRecurringBuyFillInput('');
        } else {
          setRecurringSellFillInput('');
        }
        openTrade(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract, signer);
        });
      } catch (error) {
        const outputAsset = side === 'buy' ? recurring.quoteAsset : recurring.baseAsset;
        const fallbackMessage =
          inputAsset.kind === 'private-erc20'
            ? `Private ${inputAsset.symbol} transfer failed. Check your balance, unlock privacy, and try again.`
            : outputAsset.kind === 'private-erc20'
              ? `Private ${outputAsset.symbol} payout failed. Unlock privacy for this wallet and try again.`
            : 'Recurring order fill failed.';
        setTradeActionError(getOnChainFailureMessage(error, fallbackMessage));
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      getTradeSigner,
      onCotiNetwork,
      openTrade,
      recurringBuyFillInput,
      recurringSellFillInput,
      rememberTradeTerminalReturn,
      refreshTradeDataInBackground,
      resolvedRouteAccessSecret,
      runTradeWalletPromptFlow,
      walletAddress
    ]
  );

  const updateRecurringOrderStatus = useCallback(
    async (snapshot: TradeSnapshot, action: 'pause' | 'resume' | 'cancel') => {
      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return;
      }
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }
      if (!onCotiNetwork) {
        setTradeActionError('Switch to COTI network first.');
        return;
      }

      const actionKey = `${getSnapshotKey(snapshot)}:${action}`;
      setTradeActionError('');
      setProcessingRecurringAction(actionKey);
      try {
        await runTradeWalletPromptFlow(async () => {
        rememberTradeTerminalReturn(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
        const signer = await getTradeSigner(false);
        await updateRecurringOrderStatusOnChain({
          signer,
          orderId: recurring.orderId,
          action
        });
        openTrade(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract, signer);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recurring order update failed.';
        setTradeActionError(getProviderErrorMessage(error, message));
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      getTradeSigner,
      onCotiNetwork,
      openTrade,
      refreshTradeDataInBackground,
      rememberTradeTerminalReturn,
      resolvedRouteAccessSecret,
      runTradeWalletPromptFlow,
      walletAddress
    ]
  );

  const formatRecurringTokenAmount = (asset: TradeAssetPayload, amount: string, hidden = false): string => {
    if (hidden) {
      return `Private ${asset.symbol}`;
    }
    try {
      return `${formatTokenAmount(BigInt(amount), asset.decimals, 6)} ${asset.symbol}`;
    } catch {
      return `0 ${asset.symbol}`;
    }
  };

  const formatRecurringLiveLiquidityAmount = (
    snapshot: TradeSnapshot | null,
    side: 'sell' | 'buy'
  ): string => {
    const recurring = snapshot?.recurringOrder;
    if (!recurring) {
      return '--';
    }
    const asset = side === 'sell' ? recurring.baseAsset : recurring.quoteAsset;
    const publicAmount = side === 'sell' ? recurring.publicBaseInventory : recurring.publicQuoteInventory;
    const revealedAmount =
      side === 'sell'
        ? recurring.makerPrivateInventory?.baseInventory
        : recurring.makerPrivateInventory?.quoteInventory;
    const hidden = recurring.mode !== 'public' && asset.kind === 'private-erc20';
    if (hidden && revealedAmount === undefined) {
      return `Private ${asset.symbol}`;
    }
    return formatRecurringTokenAmount(asset, revealedAmount ?? publicAmount, false);
  };

  const getStandardTradeOpenActionCta = (trade: TradeSnapshot): TradeOpenActionCta => {
    const offerSymbol = trade.offer.symbol.trim() || 'Offer';
    const requestSymbol = trade.request.symbol.trim() || 'Payment';
    return {
      kind: 'direction',
      fromSymbol: requestSymbol,
      toSymbol: offerSymbol,
      label: `${requestSymbol} to ${offerSymbol}`
    };
  };

  const getRecurringOrderOpenActionCta = (snapshot: TradeSnapshot, isMaker: boolean): TradeOpenActionCta => {
    if (isMaker) {
      return { kind: 'manage', label: 'Manage' };
    }

    const recurring = snapshot.recurringOrder;
    const baseSymbol = recurring?.baseAsset.symbol.trim() || 'Base';
    const quoteSymbol = recurring?.quoteAsset.symbol.trim() || 'Quote';
    const buyState = getRecurringTerminalSideState(snapshot, 'buy');
    const sellState = getRecurringTerminalSideState(snapshot, 'sell');

    if (buyState.isOpen && sellState.isOpen) {
      return {
        kind: 'cycle',
        fromSymbol: baseSymbol,
        toSymbol: quoteSymbol,
        label: `${baseSymbol} and ${quoteSymbol}`
      };
    }

    if (buyState.isOpen) {
      return {
        kind: 'direction',
        fromSymbol: quoteSymbol,
        toSymbol: baseSymbol,
        label: `${quoteSymbol} to ${baseSymbol}`
      };
    }

    if (sellState.isOpen) {
      return {
        kind: 'direction',
        fromSymbol: baseSymbol,
        toSymbol: quoteSymbol,
        label: `${baseSymbol} to ${quoteSymbol}`
      };
    }

    return { kind: 'view', label: 'View' };
  };

  const renderOpenActionCtaContent = (action: TradeOpenActionCta) => {
    if (action.kind === 'direction' || action.kind === 'cycle') {
      const FlowIcon = action.kind === 'cycle' ? ArrowLeftRight : ArrowRight;
      return (
        <span className="p2p-action-flow" aria-hidden="true">
          <span className="p2p-action-asset">{action.fromSymbol}</span>
          <span className="p2p-action-flow-icon">
            <FlowIcon size={14} strokeWidth={2.5} />
          </span>
          <span className="p2p-action-asset">{action.toSymbol}</span>
        </span>
      );
    }

    if (action.kind === 'manage') {
      return (
        <>
          <SlidersHorizontal size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>{action.label}</span>
        </>
      );
    }

    return (
      <>
        <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
        <span>{action.label}</span>
      </>
    );
  };

  const renderRecurringOrderCard = (snapshot: TradeSnapshot, detail = false, options: TradeOverviewCardOptions = {}) => {
    const recurring = snapshot.recurringOrder;
    if (!recurring) {
      return null;
    }

    const tradeKey = getSnapshotKey(snapshot);
    const canOpenTerminal = options.canOpenTerminal ?? true;
    const openCardTerminal = () => {
      if (!canOpenTerminal) {
        return;
      }
      if (options.onOpenTerminal) {
        options.onOpenTerminal(snapshot);
        return;
      }
      openTradeSnapshot(snapshot);
    };
    const isMaker = walletKey.length > 0 && snapshot.maker.toLowerCase() === walletKey;
    const statusLabel =
      recurring.recurringStatus === 'active'
        ? 'Active'
        : recurring.recurringStatus === 'paused'
          ? 'Paused'
          : recurring.recurringStatus === 'cancelled'
            ? 'Cancelled'
            : 'Unknown';
    const modeLabel =
      recurring.mode === 'fully-private'
        ? 'Private liquidity'
        : recurring.mode === 'hybrid-private'
          ? 'Hybrid liquidity'
          : 'Visible liquidity';
    const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
    const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
    const revealedBaseInventory = recurring.makerPrivateInventory?.baseInventory;
    const revealedQuoteInventory = recurring.makerPrivateInventory?.quoteInventory;
    const recurringExecutionRows = recurring.privateExecutions ?? recurring.publicExecutions ?? [];
    const hasRecurringExecutionRows = recurringExecutionRows.length > 0;
    const recurringRelationTags = [isMaker ? 'Maker' : snapshot.walletHasFill ? 'Filled' : null].filter(
      (label): label is string => Boolean(label)
    );
    const recurringModeTags = [modeLabel].filter((label): label is string => Boolean(label));
    const baseInventoryLabel =
      baseHidden && revealedBaseInventory !== undefined
        ? formatRecurringTokenAmount(recurring.baseAsset, revealedBaseInventory, false)
        :
      baseHidden && recurring.hasPrivateBaseInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.baseAsset, recurring.publicBaseInventory, false);
    const quoteInventoryLabel =
      quoteHidden && revealedQuoteInventory !== undefined
        ? formatRecurringTokenAmount(recurring.quoteAsset, revealedQuoteInventory, false)
        :
      quoteHidden && recurring.hasPrivateQuoteInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.quoteAsset, recurring.publicQuoteInventory, false);
    const hasPositiveRecurringAmount = (amount?: string): boolean => {
      if (!amount || !/^\d+$/.test(amount)) {
        return false;
      }
      try {
        return BigInt(amount) > 0n;
      } catch {
        return false;
      }
    };
    const sellLiquidityLive =
      baseHidden && revealedBaseInventory !== undefined
        ? hasPositiveRecurringAmount(revealedBaseInventory)
        : baseHidden
          ? recurring.sellSideOpen && recurring.hasPrivateBaseInventory
          : hasPositiveRecurringAmount(recurring.publicBaseInventory);
    const buyLiquidityLive =
      quoteHidden && revealedQuoteInventory !== undefined
        ? hasPositiveRecurringAmount(revealedQuoteInventory)
        : quoteHidden
          ? recurring.buySideOpen && recurring.hasPrivateQuoteInventory
          : hasPositiveRecurringAmount(recurring.publicQuoteInventory);
    const baseInventoryMuted = baseHidden && revealedBaseInventory === undefined && recurring.hasPrivateBaseInventory;
    const quoteInventoryMuted = quoteHidden && revealedQuoteInventory === undefined && recurring.hasPrivateQuoteInventory;
    const recurringExecutionLabel = recurring.executionCount > 0 ? String(recurring.executionCount) : 'None';
    const recurringExecutionMuted = recurring.executionCount === 0;
    const recurringPriceDisplay = resolveRecurringPriceDeskDisplay({
      terms: {
        baseAsset: recurring.baseAsset,
        quoteAsset: recurring.quoteAsset,
        buyTerms: recurring.buyTerms,
        sellTerms: recurring.sellTerms
      },
      toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
      subjectLabel: `Recurring order ${recurring.orderId}`
    });
    const formatRecurringExecutionAmount = (asset: TradeAssetPayload, amount?: string): string =>
      amount !== undefined ? formatRecurringTokenAmount(asset, amount, false) : `Private ${asset.symbol}`;
    const shareUrl = buildTradeShareUrl(snapshot.tradeId, undefined, snapshot.escrowContract);
    const shareKey = `recurring-order-link:${tradeKey}`;
    const buyProcessing = processingRecurringAction === `${tradeKey}:buy`;
    const sellProcessing = processingRecurringAction === `${tradeKey}:sell`;
    const sellToOrderState = getRecurringTerminalSideState(snapshot, 'sell');
    const buyFromOrderState = getRecurringTerminalSideState(snapshot, 'buy');
    const activeRecurringTerminalState = recurringTerminalSide === 'buy' ? buyFromOrderState : sellToOrderState;
    const recurringOpenActionCta = getRecurringOrderOpenActionCta(snapshot, isMaker);
    const canFillBuySide = detail && !isMaker && sellToOrderState.isOpen;
    const canFillSellSide = detail && !isMaker && buyFromOrderState.isOpen;
    const recurringTerminalInputValue = recurringTerminalSide === 'buy' ? recurringSellFillInput : recurringBuyFillInput;
    const recurringTerminalProcessing = recurringTerminalSide === 'buy' ? sellProcessing : buyProcessing;
    const recurringTerminalCanSubmit = recurringTerminalSide === 'buy' ? canFillSellSide : canFillBuySide;
    const recurringBaseExplorerUrl = buildTradeAssetExplorerUrl(recurring.baseAsset);
    const recurringQuoteExplorerUrl = buildTradeAssetExplorerUrl(recurring.quoteAsset);
    const recurringMakerExplorerUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${snapshot.maker}`;
    const recurringTokenExplorerLinks = [
      recurringBaseExplorerUrl
        ? {
            key: recurringBaseExplorerUrl,
            href: recurringBaseExplorerUrl,
            label: recurring.baseAsset.symbol,
            title: `View ${recurring.baseAsset.symbol} on token explorer`
          }
        : null,
      recurringQuoteExplorerUrl
        ? {
            key: recurringQuoteExplorerUrl,
            href: recurringQuoteExplorerUrl,
            label: recurring.quoteAsset.symbol,
            title: `View ${recurring.quoteAsset.symbol} on token explorer`
          }
        : null
    ]
      .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
      .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
    const showRecurringHistoryPanel = detail;
    const recurringHistoryPanelTitle =
      recurring.mode === 'public'
        ? 'Execution history'
        : isMaker
          ? 'Private order history'
          : 'Your private history';
    const recurringHistoryEmptyCopy =
      recurring.mode === 'public'
        ? 'No recurring executions are available for this wallet yet.'
        : isMaker
          ? 'Reveal this order to show maker-only private buy/sell receipts.'
          : 'Reveal your wallet receipts to show the private buys and sells you made.';
    return (
      <article
        key={tradeKey}
        className={[
          'p2p-order-card',
          'p2p-recurring-order-card',
          options.selected ? 'p2p-order-card-selected' : '',
          detail ? 'p2p-recurring-order-card-detail' : '',
          recurring.mode !== 'public' ? 'p2p-recurring-order-card-private' : '',
          `p2p-recurring-order-card-${recurring.recurringStatus}`
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="p2p-recurring-card-head p2p-order-card-head">
          <div className="p2p-offer-title">
            <span className="p2p-offer-kind">Recurring OTC</span>
            <div className="p2p-order-title-row">
              <h3>
                {recurring.baseAsset.symbol}/{recurring.quoteAsset.symbol}
              </h3>
            </div>
            <div className="p2p-order-tag-stack">
              <p className="p2p-order-subline p2p-order-subline-primary">
                <span className="p2p-order-id">Order #{recurring.orderId}</span>
                <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
                {recurringRelationTags.map((label) => (
                  <span
                    className={label === 'Maker' ? 'p2p-order-chip p2p-order-chip-owner' : 'p2p-order-chip'}
                    key={`${tradeKey}:relation:${label}`}
                    title={label === 'Maker' ? 'Created by you' : undefined}
                  >
                    {label}
                  </span>
                ))}
              </p>
              <p className="p2p-order-subline p2p-order-subline-secondary">
                {recurringModeTags.map((label) => (
                  <span className="p2p-order-chip" key={`${tradeKey}:tag:${label}`}>
                    {label}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="p2p-recurring-price-card p2p-order-market-panel"
          onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
          title={recurringPriceDisplay.toggleTitle}
          aria-label={recurringPriceDisplay.ariaLabel}
        >
          <div className="p2p-recurring-price-card-head">
            <span>Price ratio</span>
          </div>
          <div className="p2p-recurring-price-grid">
            <div className="p2p-recurring-price-box p2p-recurring-price-buy">
              <span>{recurringPriceDisplay.displayBuySide.label}</span>
              <strong>{recurringPriceDisplay.displayBuySide.priceLabel}</strong>
            </div>
            <div className="p2p-recurring-price-box p2p-recurring-price-sell">
              <span>{recurringPriceDisplay.displaySellSide.label}</span>
              <strong>{recurringPriceDisplay.displaySellSide.priceLabel}</strong>
            </div>
          </div>
        </button>

        <div className="p2p-recurring-inventory-strip p2p-order-detail-band" aria-label="Recurring order liquidity">
          <div>
            <div className="p2p-recurring-liquidity-head">
              <span title="Sell liquidity">Sell liq.</span>
              <i
                className={sellLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                title={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
                role="img"
                aria-label={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
              />
            </div>
            <strong className={baseInventoryMuted ? 'p2p-order-muted-slot' : undefined}>{baseInventoryLabel}</strong>
          </div>
          <div>
            <div className="p2p-recurring-liquidity-head">
              <span title="Buy liquidity">Buy liq.</span>
              <i
                className={buyLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                title={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
                role="img"
                aria-label={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
              />
            </div>
            <strong className={quoteInventoryMuted ? 'p2p-order-muted-slot' : undefined}>{quoteInventoryLabel}</strong>
          </div>
          <div>
            <span>Executions</span>
            <strong className={recurringExecutionMuted ? 'p2p-order-muted-slot' : undefined}>{recurringExecutionLabel}</strong>
          </div>
        </div>

        <div className="p2p-offer-token-actions p2p-order-token-actions" aria-label="Token explorer links">
          <span>Verify tokens</span>
          <div>
            {recurringTokenExplorerLinks.length ? (
              recurringTokenExplorerLinks.map((link) => (
                <a key={link.key} className="p2p-offer-token-link" href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                  {link.label}
                </a>
              ))
            ) : (
              <span className="p2p-token-placeholder p2p-order-muted-slot">Native only</span>
            )}
          </div>
        </div>

        {detail ? (
          <div className="trade-card-participants p2p-recurring-participants" aria-label="Recurring order participants">
            <div className="trade-card-counterparty">
              <span>Creator</span>
              <a href={recurringMakerExplorerUrl} target="_blank" rel="noreferrer" title={snapshot.maker}>
                {isMaker ? `${shortenAddress(snapshot.maker)} (you)` : shortenAddress(snapshot.maker)}
              </a>
            </div>
            <div className="trade-card-counterparty">
              <span>Access</span>
              <strong>{recurring.mode === 'public' ? 'Public desk' : 'Shared order'}</strong>
            </div>
          </div>
        ) : null}

        {showRecurringHistoryPanel ? (
          <div className="p2p-recurring-private-history" aria-live="polite">
            <div className="p2p-recurring-private-history-head">
              <span>{recurringHistoryPanelTitle}</span>
              <strong>{recurringExecutionRows.length}</strong>
            </div>
            {hasRecurringExecutionRows ? (
              recurringExecutionRows.map((execution) => (
                <div className="p2p-recurring-private-history-row" key={`${tradeKey}:private-fill:${execution.fillIndex}`}>
                  <div>
                    <span>#{execution.fillIndex}</span>
                    <strong>{execution.side === 'buy' ? 'Maker bought' : 'Maker sold'}</strong>
                    <small>{execution.filler ? `Filler ${shortenAddress(execution.filler)}` : 'Private fill'}</small>
                  </div>
                  <div>
                    <span>Base</span>
                    <strong>{formatRecurringExecutionAmount(recurring.baseAsset, execution.baseAmount)}</strong>
                    <small>
                      Remaining {formatRecurringExecutionAmount(recurring.baseAsset, execution.remainingBaseInventory)}
                    </small>
                  </div>
                  <div>
                    <span>Quote</span>
                    <strong>{formatRecurringExecutionAmount(recurring.quoteAsset, execution.quoteAmount)}</strong>
                    <small>
                      Remaining {formatRecurringExecutionAmount(recurring.quoteAsset, execution.remainingQuoteInventory)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="p2p-recurring-private-history-empty">
                <p>{recurringHistoryEmptyCopy}</p>
              </div>
            )}
          </div>
        ) : null}

        {detail && !isMaker ? (
          <div className="p2p-recurring-terminal" aria-label="Recurring order actions">
            <span className="p2p-recurring-terminal-label">Your action</span>
            <div className="p2p-recurring-terminal-tabs" role="tablist" aria-label="Choose recurring order side">
              <button
                type="button"
                className={recurringTerminalSide === 'buy' ? 'active' : undefined}
                role="tab"
                aria-selected={recurringTerminalSide === 'buy'}
                onClick={() => setRecurringTerminalSide('buy')}
              >
                Buy
              </button>
              <button
                type="button"
                className={recurringTerminalSide === 'sell' ? 'active' : undefined}
                role="tab"
                aria-selected={recurringTerminalSide === 'sell'}
                onClick={() => setRecurringTerminalSide('sell')}
              >
                Sell
              </button>
            </div>
            <div className="p2p-recurring-terminal-ticket" role="tabpanel">
              <label className="trade-compose-field">
                <span>{activeRecurringTerminalState.inputLabel}</span>
                <input
                  className="trade-compose-input"
                  type="text"
                  inputMode="decimal"
                  value={recurringTerminalInputValue}
                  onChange={(event) => {
                    const nextValue = sanitizeTokenAmountInput(event.target.value);
                    if (recurringTerminalSide === 'buy') {
                      setRecurringSellFillInput(nextValue);
                    } else {
                      setRecurringBuyFillInput(nextValue);
                    }
                  }}
                  placeholder={
                    recurringTerminalSide === 'buy'
                      ? `0 ${recurring.quoteAsset.symbol}`
                      : `0 ${recurring.baseAsset.symbol}`
                  }
                  disabled={!recurringTerminalCanSubmit || recurringTerminalProcessing}
                />
              </label>
              <button
                type="button"
                className={
                  recurringTerminalSide === 'buy'
                    ? 'trade-card-action trade-card-action-accept'
                    : 'trade-card-action trade-card-action-counter'
                }
                onClick={() => fillRecurringOrderSide(snapshot, recurringTerminalSide === 'buy' ? 'sell' : 'buy').catch(() => {})}
                disabled={!recurringTerminalCanSubmit || recurringTerminalProcessing}
              >
                {recurringTerminalProcessing
                  ? 'Processing...'
                  : recurringTerminalCanSubmit
                    ? activeRecurringTerminalState.actionLabel
                    : activeRecurringTerminalState.disabledLabel}
              </button>
            </div>
          </div>
        ) : null}

        <div className="p2p-recurring-card-footer p2p-order-card-footer">
          <div>
            {isMaker && canOpenTerminal ? (
              <button
                type="button"
                className="p2p-offer-manage-btn"
                onClick={openCardTerminal}
                title="Open recurring order terminal"
                aria-label="Open recurring order terminal"
              >
                <SlidersHorizontal size={14} strokeWidth={2.5} aria-hidden="true" />
                <span>Manage</span>
              </button>
            ) : !detail && canOpenTerminal ? (
              <button
                type="button"
                className="p2p-offer-open-btn"
                onClick={openCardTerminal}
                title={isMaker ? 'Open recurring order controls' : `Open recurring order for ${recurringOpenActionCta.label}`}
                aria-label={recurringOpenActionCta.label}
              >
                {renderOpenActionCtaContent(recurringOpenActionCta)}
              </button>
            ) : null}
            {shareUrl ? (
              <button
                type="button"
                className={lastCopiedKey === shareKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                title="Share recurring order link"
              >
                {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
              </button>
            ) : null}
          </div>
        </div>

        {detail ? (
          <div className="trade-card-meta-inline">
            <span>Created {formatMessageTimestamp(snapshot.createdAt)}</span>
            <span>Liquidity stays live until the maker edits funding or closes the order</span>
          </div>
        ) : null}
      </article>
    );
  };

  const renderTerminalHistoryContent = ({
    title,
    count,
    emptyCopy,
    children,
    revealAction,
    revealLabel,
    revealPending
  }: TerminalHistoryPanelConfig) => {
    const revealButton = revealAction ? (
      <button
        type="button"
        className="p2p-terminal-history-reveal-btn"
        onClick={revealAction}
        disabled={revealPending}
      >
        {revealPending ? 'Revealing...' : revealLabel ?? 'Reveal history'}
      </button>
    ) : null;

    return (
      <>
        <div className="p2p-terminal-history-head">
          <div>
            <span>Your history</span>
            <strong>{title}</strong>
          </div>
          {revealButton}
          <span>{count}</span>
        </div>
        {children ? (
          children
        ) : (
          <div className="p2p-terminal-history-empty">
            <p>{emptyCopy}</p>
          </div>
        )}
      </>
    );
  };

  const renderTerminalHistoryMobileControls = (config: TerminalHistoryPanelConfig) => {
    const historyBody = renderTerminalHistoryContent(config);

    const historySheet = terminalHistorySheetKey === config.tradeKey ? (
      <div className="p2p-terminal-history-sheet" role="dialog" aria-modal="true" aria-label={`${config.title} history`}>
        <div className="p2p-terminal-history-sheet-head">
          <div>
            <span>Your history</span>
            <strong>{config.title}</strong>
          </div>
          <button type="button" onClick={() => setTerminalHistorySheetKey('')}>
            Close
          </button>
        </div>
        <div className="p2p-terminal-history-sheet-body">{historyBody}</div>
      </div>
    ) : null;

    return (
      <>
        <button
          type="button"
          className="p2p-terminal-mobile-history-trigger"
          onClick={() => setTerminalHistorySheetKey(config.tradeKey)}
        >
          <span>History</span>
          <strong>{config.count}</strong>
        </button>
        {historySheet && typeof document !== 'undefined' ? createPortal(historySheet, document.body) : historySheet}
      </>
    );
  };

  const formatHistoryDate = (timestamp?: number) => {
    if (!timestamp || !Number.isFinite(timestamp)) {
      return '';
    }
    return new Date(timestamp * 1000).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderHistoryLifecycleRows = (lifecycleRows: TradeLifecycleHistoryRow[]) => {
    if (!lifecycleRows.length) {
      return null;
    }

    return lifecycleRows.map((row) => {
      const dateLabel = formatHistoryDate(row.timestamp);
      const dateTitle = row.timestamp ? formatMessageTimestamp(row.timestamp) : undefined;
      return (
        <div
          className={`p2p-terminal-history-row p2p-terminal-history-row-lifecycle p2p-terminal-history-row-${row.action}`}
          key={row.key}
        >
          <div className="p2p-terminal-history-event">
            <span>{row.label}</span>
            <strong>{row.detail}</strong>
          </div>
          <div className="p2p-terminal-history-lifecycle-meta">
            <span>{row.sourceKind === 'recurring' ? 'Order' : 'Offer'}</span>
          </div>
          <div className="p2p-terminal-history-proof p2p-terminal-history-date">
            <strong title={dateTitle}>{dateLabel || 'Visible status'}</strong>
          </div>
        </div>
      );
    });
  };

  const renderHistoryTransactionRows = (historyRows: TradeTransactionHistoryRow[]) => {
    if (!historyRows.length) {
      return null;
    }

    const formatHistoryAmount = (asset: TradeAssetPayload & { visible: boolean }) =>
      asset.visible ? formatTradeAssetDisplayText(asset) : `Private ${asset.symbol}`;
    const formatHistoryFlowAmount = (
      asset: TradeAssetPayload & { visible: boolean },
      action: TradeTransactionHistoryRow['tokenFlows'][number]['action']
    ) => {
      const amountText = formatHistoryAmount(asset);
      return asset.visible ? `${action === 'bought' ? '+' : '-'}${amountText}` : amountText;
    };

    return historyRows.map((row) => {
      const txUrl = buildTransactionExplorerUrl(row.txHash);
      const timestamp = row.timestamp ?? historyTransactionTimestamps[row.key];
      const dateLabel = formatHistoryDate(timestamp);
      const dateTitle = timestamp ? formatMessageTimestamp(timestamp) : undefined;
      const sequenceLabel = row.sequence ? `Fill #${row.sequence}` : '';
      const sourceLabel =
        row.sourceKind === 'recurring'
          ? 'Recurring fill'
          : row.sourceKind === 'private'
            ? 'Private fill'
            : row.sourceKind === 'direct'
              ? 'Direct fill'
              : 'Escrow fill';
      return (
        <div className="p2p-terminal-history-row" key={row.key}>
          <div className="p2p-terminal-history-event">
            <span>{sourceLabel}</span>
            {sequenceLabel ? <strong>{sequenceLabel}</strong> : null}
            {dateLabel ? <small title={dateTitle}>{dateLabel}</small> : null}
          </div>
          <div className="p2p-terminal-history-amounts">
            {row.tokenFlows.map((flow) => (
              <div
                className={`p2p-terminal-history-chip p2p-terminal-history-chip-${flow.action}`}
                key={`${flow.action}:${flow.asset.kind}:${flow.asset.tokenAddress}:${flow.asset.symbol}`}
              >
                <strong>{formatHistoryFlowAmount(flow.asset, flow.action)}</strong>
                <span>{flow.action === 'bought' ? 'Bought' : 'Sold'}</span>
              </div>
            ))}
          </div>
          <div className="p2p-terminal-history-proof">
            {txUrl ? (
              <a href={txUrl} target="_blank" rel="noreferrer">
                View Tx
              </a>
            ) : (
              <strong>{row.amountVisibility === 'private-hidden' ? 'Private' : 'Indexed'}</strong>
            )}
          </div>
        </div>
      );
    });
  };

  const renderHistoryRows = (
    lifecycleRows: TradeLifecycleHistoryRow[],
    transactionRows: TradeTransactionHistoryRow[]
  ): ReactNode => {
    if (!lifecycleRows.length && !transactionRows.length) {
      return null;
    }

    return (
      <>
        {renderHistoryLifecycleRows(lifecycleRows)}
        {renderHistoryTransactionRows(transactionRows)}
      </>
    );
  };

  const getStandardTerminalHistoryConfig = (snapshot: TradeSnapshot): TerminalHistoryPanelConfig => {
    const tradeKey = getSnapshotKey(snapshot);
    const displayTerms = getTradeDisplayTerms(snapshot);
    const displayTrade = {
      ...snapshot,
      offer: displayTerms.offer,
      request: displayTerms.request
    };
    const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
    const perspective = orderSummary.perspective;
    const termsVisibility = getTradeTermsVisibility(snapshot);
    const isHiddenLiquidityTerms = termsVisibility === 'hidden-liquidity';
    const hasPrivateFillReceipts = Boolean(snapshot.privateFillReceipts?.length);
    const makerPrivateProgressSummary = getMakerPrivateProgressSummary(snapshot);
    const canRevealMakerPrivateProgress = Boolean(
      isHiddenLiquidityTerms &&
      walletKey.length > 0 &&
      (perspective.isMaker
        ? !makerPrivateProgressSummary || !hasPrivateFillReceipts
        : !hasPrivateFillReceipts)
    );
    const revealProcessing = revealingPrivateTradeKey === tradeKey;
    const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
    const historyRows = buildTradeTransactionHistoryRows([snapshot], walletAddress);
    const historyChildren = renderHistoryRows(lifecycleRows, historyRows);
    const historyEmptyCopy = !walletKey
      ? 'Connect your trading wallet to show your history for this trade.'
      : canRevealMakerPrivateProgress
        ? perspective.isMaker
          ? 'Reveal maker receipts to show your private history for this trade.'
          : 'Reveal your private fill receipts for this trade.'
        : 'No wallet history for this trade yet.';

    return {
      tradeKey,
      title: `Offer #${snapshot.tradeId}`,
      count: lifecycleRows.length + historyRows.length,
      emptyCopy: historyEmptyCopy,
      children: historyChildren,
      revealAction: canRevealMakerPrivateProgress ? () => revealMakerPrivateProgress(snapshot).catch(() => {}) : undefined,
      revealLabel: perspective.isMaker ? 'Reveal maker history' : 'Reveal your history',
      revealPending: revealProcessing
    };
  };

  const getRecurringTerminalHistoryConfig = (snapshot: TradeSnapshot): TerminalHistoryPanelConfig | null => {
    const recurring = snapshot.recurringOrder;
    if (!recurring) {
      return null;
    }

    const tradeKey = getSnapshotKey(snapshot);
    const isMaker = walletKey.length > 0 && snapshot.maker.toLowerCase() === walletKey;
    const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
    const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
    const hasRevealedPrivateExecutions = Boolean(recurring.privateExecutions?.length);
    const hasPrivateInventoryToReveal =
      isMaker &&
      (
        (baseHidden && recurring.hasPrivateBaseInventory && recurring.makerPrivateInventory?.baseInventory === undefined) ||
        (quoteHidden && recurring.hasPrivateQuoteInventory && recurring.makerPrivateInventory?.quoteInventory === undefined)
      );
    const canRevealRecurringPrivate =
      walletKey.length > 0 &&
      recurring.mode !== 'public' &&
      (isMaker
        ? hasPrivateInventoryToReveal || (!hasRevealedPrivateExecutions && recurring.executionCount > 0)
        : !hasRevealedPrivateExecutions && recurring.executionCount > 0);
    const revealProcessing = revealingPrivateTradeKey === tradeKey;
    const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
    const historyRows = buildTradeTransactionHistoryRows([snapshot], walletAddress);
    const recurringHistoryRows = renderHistoryRows(lifecycleRows, historyRows);
    const recurringHistoryEmptyCopy =
      !walletKey
        ? 'Connect your trading wallet to show your history for this order.'
        : canRevealRecurringPrivate
          ? isMaker
            ? 'Reveal this order to show your private maker receipts.'
            : 'Reveal your wallet receipts to show the private buys and sells you made.'
          : 'No wallet history for this order yet.';

    return {
      tradeKey,
      title: `Order #${recurring.orderId}`,
      count: lifecycleRows.length + historyRows.length,
      emptyCopy: recurringHistoryEmptyCopy,
      children: recurringHistoryRows,
      revealAction: canRevealRecurringPrivate ? () => revealMakerPrivateProgress(snapshot).catch(() => {}) : undefined,
      revealLabel: 'Reveal history',
      revealPending: revealProcessing
    };
  };

  const getTerminalHistoryConfig = (snapshot: TradeSnapshot): TerminalHistoryPanelConfig | null =>
    snapshot.recurringOrder ? getRecurringTerminalHistoryConfig(snapshot) : getStandardTerminalHistoryConfig(snapshot);

  const renderTradeTerminalHistoryWindow = (snapshot: TradeSnapshot) => {
    const historyConfig = getTerminalHistoryConfig(snapshot);
    if (!historyConfig) {
      return null;
    }

    return (
      <section
        className="standalone-trades-section p2p-terminal-history p2p-terminal-history-desktop p2p-terminal-history-window"
        aria-live="polite"
      >
        {renderTerminalHistoryContent(historyConfig)}
      </section>
    );
  };

  const renderStandardTradeTerminal = (snapshot: TradeSnapshot) => {
    const tradeKey = getSnapshotKey(snapshot);
    const displayTerms = getTradeDisplayTerms(snapshot);
    const displayTrade = {
      ...snapshot,
      offer: displayTerms.offer,
      request: displayTerms.request
    };
    const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
    const perspective = orderSummary.perspective;
    const termsVisibility = getTradeTermsVisibility(snapshot);
    const isHiddenLiquidityTerms = termsVisibility === 'hidden-liquidity';
    const isDirectPrivateTerms = termsVisibility === 'direct-private-terms';
    const directTermsHydrated = hasHydratedDirectTradeTerms(snapshot);
    const canRevealDirectTerms = Boolean(
      isDirectPrivateTerms &&
      !directTermsHydrated &&
      walletKey &&
      [snapshot.maker.toLowerCase(), snapshot.taker.toLowerCase()].includes(walletKey)
    );
    const counterUnavailableReason = getCounterOfferUnavailableReason(snapshot, walletKey);
    const canCounter = canCreateCounterOffer(snapshot, walletKey);
    const showCounterUnavailable =
      !canCounter &&
      walletKey.length > 0 &&
      !perspective.isMaker &&
      snapshot.status === 'open' &&
      counterUnavailableReason === PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE;
    const canEdit = canEditPublicTrade(snapshot, walletKey);
    const completionSummary = getTradeCompletionSummary(snapshot);
    const makerPrivateProgressSummary = getMakerPrivateProgressSummary(snapshot);
    const visibleCompletionSummary = makerPrivateProgressSummary ?? completionSummary;
    const revealProcessing = revealingPrivateTradeKey === tradeKey;
    const makerControlsExpanded = Boolean(expandedMakerControls[buildMakerControlsKey('terminal', tradeKey)]);
    const accessSecret = resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
    const shareUrl =
      snapshot.isPublic === false &&
      snapshot.hasAccessHash &&
      !accessSecret &&
      !canUseWalletAuthorityForDirectAccess(snapshot, walletKey)
        ? ''
        : buildTradeShareUrl(snapshot.tradeId, accessSecret || undefined, snapshot.escrowContract);
    const shareKey = `terminal-trade-link:${tradeKey}:${accessSecret ? 'secret' : 'public'}`;
    const isDirectTrade = isDirectWalletTrade(snapshot);
    const visibilityLabel =
      snapshot.isPublic === false
        ? isDirectTrade
          ? 'Direct offer'
          : snapshot.hasAccessHash
            ? accessSecret
              ? 'Private link saved'
              : 'Private link'
            : 'Unlisted offer'
        : 'Public offer';
    const statusLabel =
      snapshot.status === 'open'
        ? 'Active'
        : snapshot.status === 'unknown'
          ? 'Unknown'
          : snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1);
    const expiryParts = formatTradeExpiryParts(snapshot.expiresAt);
    const expiryCountdown = snapshot.status === 'open' ? formatExpiryCountdown(snapshot.expiresAt) : null;
    const leftSide = orderSummary.primarySide;
    const rightSide = orderSummary.secondarySide;
    const priceRatioDisplay = resolveTradePriceRatioDisplay({
      baseAsset: leftSide.asset,
      quoteAsset: rightSide.asset,
      toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
      forwardFallbackLabel: isHiddenLiquidityTerms
        ? formatHiddenFixedPriceTerms(leftSide.asset, rightSide.asset)
        : formatTradeRateText(leftSide.asset, rightSide.asset),
      reverseFallbackLabel: isHiddenLiquidityTerms
        ? formatHiddenFixedPriceTerms(rightSide.asset, leftSide.asset)
        : formatTradeRateText(rightSide.asset, leftSide.asset),
      subjectLabel: `price ratio for trade ${snapshot.tradeId}`
    });
    const tradeRateText =
      isDirectPrivateTerms && !directTermsHydrated
        ? 'Private terms'
        : priceRatioDisplay?.label ?? formatTradeListTerms(displayTrade);
    const formatTerminalTerm = (asset: TradeAssetPayload): string =>
      isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated)
        ? asset.symbol
        : formatTradeAssetDisplayText(asset);
    const formatTermMeta = (asset: TradeAssetPayload, role: 'offer' | 'payment'): string => {
      if (isHiddenLiquidityTerms) {
        return asset.kind === 'private-erc20' ? 'Private amount' : 'Public asset';
      }
      if (isDirectPrivateTerms && !directTermsHydrated) {
        return 'Private terms';
      }
      if (role === 'offer') {
        return displayTerms.usingRemaining ? 'Remaining now' : snapshot.status === 'open' ? 'Available now' : statusLabel;
      }
      return isZeroTradeTakerAddress(snapshot.taker) ? 'Open offer' : shortenAddress(snapshot.taker);
    };
    const tokenExplorerLinks = [leftSide.asset, rightSide.asset]
      .map((asset) => {
        const href = buildTradeAssetExplorerUrl(asset);
        return href ? { href, label: asset.symbol, title: `View ${asset.symbol} on token explorer` } : null;
      })
      .filter((link): link is { href: string; label: string; title: string } => Boolean(link))
      .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
    const makerExplorerUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${snapshot.maker}`;
    const peerAddress =
      !isZeroTradeTakerAddress(snapshot.taker) && snapshot.taker.toLowerCase() !== snapshot.maker.toLowerCase()
        ? snapshot.taker
        : snapshot.walletHasFill && walletAddress && walletKey !== snapshot.maker.toLowerCase()
          ? walletAddress
          : '';
    const peerExplorerUrl = peerAddress ? `${COTI_NETWORK.blockExplorerUrl}/address/${peerAddress}` : '';
    const peerLabel = peerAddress ? shortenAddress(peerAddress) : isHiddenLiquidityTerms ? 'Private link' : 'Open offer';
    const remainingOfferAmount = getRemainingOfferAmount(snapshot);
    const remainingRequestAmount = getRemainingRequestAmount(snapshot);
    const fillOfferUnitAmount = isHiddenLiquidityTerms ? parseTokenAmountString(snapshot.offer.amount) : remainingOfferAmount;
    const fillRequestUnitAmount = isHiddenLiquidityTerms ? parseTokenAmountString(snapshot.request.amount) : remainingRequestAmount;
    const canActAsTaker = perspective.isTaker || perspective.isOpenTakerTrade;
    const canShowFillTicket = Boolean(
      snapshot.status === 'open' &&
      canActAsTaker &&
      !perspective.isMaker &&
      !snapshot.counterParentTradeId &&
      !canRevealDirectTerms &&
      fillOfferUnitAmount > 0n &&
      fillRequestUnitAmount > 0n
    );
    const terminalInputValue = terminalFillInputSide === 'pay' ? terminalPayInput : terminalBuyInput;
    const terminalPayAmountInput = parseTokenAmountInput(terminalPayInput, displayTrade.request.decimals);
    const terminalBuyAmountInput = parseTokenAmountInput(terminalBuyInput, displayTrade.offer.decimals);
    const terminalRequestAmount =
      canShowFillTicket && terminalFillInputSide === 'buy' && terminalBuyAmountInput !== null
        ? quoteRequestAmountForOfferAmount(terminalBuyAmountInput, fillOfferUnitAmount, fillRequestUnitAmount)
        : terminalPayAmountInput;
    const terminalReceiveAmount =
      canShowFillTicket && terminalFillInputSide === 'buy' && terminalBuyAmountInput !== null
        ? terminalBuyAmountInput
        : canShowFillTicket && terminalRequestAmount !== null && fillOfferUnitAmount > 0n && fillRequestUnitAmount > 0n
          ? (terminalRequestAmount * fillOfferUnitAmount) / fillRequestUnitAmount
          : 0n;
    const terminalSpendAmount =
      terminalFillInputSide === 'buy' && terminalRequestAmount !== null ? terminalRequestAmount : terminalPayAmountInput ?? 0n;
    const terminalSpendFieldValue =
      terminalFillInputSide === 'buy' && terminalInputValue.trim() && terminalSpendAmount > 0n
        ? formatExactTokenAmountInput(terminalSpendAmount, displayTrade.request.decimals)
        : terminalPayInput;
    const terminalReceiveFieldValue =
      terminalFillInputSide === 'pay' && terminalInputValue.trim() && terminalReceiveAmount > 0n
        ? formatExactTokenAmountInput(terminalReceiveAmount, displayTrade.offer.decimals)
        : terminalBuyInput;
    const fillTooHigh = Boolean(canShowFillTicket && terminalRequestAmount !== null && terminalRequestAmount > remainingRequestAmount);
    const fillSubmitInput =
      terminalRequestAmount !== null && terminalRequestAmount > 0n
        ? formatExactTokenAmountInput(terminalRequestAmount, displayTrade.request.decimals)
        : terminalPayInput;
    const fillCanSubmit = Boolean(
      walletKey &&
      onCotiNetwork &&
      terminalInputValue.trim() &&
      terminalRequestAmount !== null &&
      terminalRequestAmount > 0n &&
      !fillTooHigh
    );
    const maxPayInput = formatExactTokenAmountInput(remainingRequestAmount, displayTrade.request.decimals);
    const historyConfig = getStandardTerminalHistoryConfig(snapshot);
    const terminalAccessChip = isHiddenLiquidityTerms
      ? 'Private liquidity'
      : isDirectPrivateTerms
        ? 'Private terms'
        : visibilityLabel !== 'Public offer'
          ? visibilityLabel
          : '';
    const terminalExpiryChip =
      snapshot.status === 'open' && expiryCountdown ? expiryCountdown.label.replace(/^Expires /, '') : '';

    return (
      <article className="p2p-terminal-shell p2p-terminal-shell-standard" key={tradeKey}>
        <header className="p2p-terminal-head">
          <div className="p2p-terminal-title">
            <span className="p2p-terminal-eyebrow">P2P OTC Terminal</span>
            <h3>{orderSummary.directionLabel}</h3>
            <div className="p2p-terminal-tag-row" aria-label="Offer tags">
              <span className="p2p-order-id">Offer #{snapshot.tradeId}</span>
              <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
              {terminalAccessChip ? <span className="p2p-order-chip">{terminalAccessChip}</span> : null}
              {snapshot.counterParentTradeId ? <span className="p2p-order-chip">Counter #{snapshot.counterParentTradeId}</span> : null}
              {terminalExpiryChip && expiryCountdown ? (
                <span className={`p2p-expiry-chip trade-card-expiry-${expiryCountdown.urgency}`} title={expiryParts.title}>
                  {terminalExpiryChip}
                </span>
              ) : null}
            </div>
          </div>
          <div className="p2p-terminal-toolbar">
            {shareUrl ? (
              <button
                type="button"
                className={lastCopiedKey === shareKey ? 'p2p-terminal-share copied' : 'p2p-terminal-share'}
                onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
              >
                {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
              </button>
            ) : null}
          </div>
        </header>

        <div className="p2p-terminal-main">
          <section className="p2p-terminal-market" aria-label="Trade market summary">
            <button
              type="button"
              className="p2p-terminal-price-card"
              onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
              title={priceRatioDisplay?.toggleTitle ?? 'Private terms'}
              aria-label={priceRatioDisplay?.ariaLabel ?? `Private terms for trade ${snapshot.tradeId}.`}
            >
              <span>Price ratio</span>
              <strong>{tradeRateText}</strong>
              <small>{priceRatioDisplay ? `Quoted as ${priceRatioDisplay.basisLabel}` : 'Reveal terms to quote'}</small>
            </button>

            <div className="p2p-terminal-flow" aria-label={formatTradeListTerms(displayTrade)}>
              <div className={`p2p-terminal-flow-card p2p-terminal-flow-${leftSide.tone}`}>
                <span>{leftSide.label}</span>
                <strong>{formatTerminalTerm(leftSide.asset)}</strong>
                <small>{formatTermMeta(leftSide.asset, leftSide.role)}</small>
              </div>
              <div className="p2p-terminal-flow-arrow" aria-hidden="true">
                <ArrowRight size={17} strokeWidth={2.3} />
              </div>
              <div className={`p2p-terminal-flow-card p2p-terminal-flow-${rightSide.tone}`}>
                <span>{rightSide.label}</span>
                <strong>{formatTerminalTerm(rightSide.asset)}</strong>
                <small>{formatTermMeta(rightSide.asset, rightSide.role)}</small>
              </div>
            </div>

            <div className="p2p-terminal-stat-grid">
              <div>
                <span>Maker</span>
                <a href={makerExplorerUrl} target="_blank" rel="noreferrer" title={snapshot.maker}>
                  {perspective.isMaker ? `${shortenAddress(snapshot.maker)} (you)` : shortenAddress(snapshot.maker)}
                </a>
              </div>
              <div>
                <span>Peer</span>
                {peerExplorerUrl ? (
                  <a href={peerExplorerUrl} target="_blank" rel="noreferrer" title={peerAddress}>
                    {peerLabel}
                  </a>
                ) : (
                  <strong>{peerLabel}</strong>
                )}
              </div>
            </div>

            {visibleCompletionSummary ? (
              <div className="p2p-terminal-progress" aria-label={visibleCompletionSummary.percentLabel}>
                <div>
                  <span>{makerPrivateProgressSummary ? 'Your private order' : 'Fill progress'}</span>
                  <strong>{makerPrivateProgressSummary?.totalLabel ?? visibleCompletionSummary.percentLabel}</strong>
                </div>
                <div className="p2p-terminal-progress-bar">
                  <span style={{ width: `${visibleCompletionSummary.percent}%` }} />
                </div>
                <small>
                  {visibleCompletionSummary.filledLabel} · {visibleCompletionSummary.remainingLabel}
                </small>
              </div>
            ) : null}

            {canRevealDirectTerms ? (
              <div className="p2p-terminal-reveal">
                <div>
                  <span>Private terms</span>
                  <p>Reveal the exact Direct OTC terms shared with this wallet.</p>
                </div>
                <button
                  type="button"
                  onClick={() => revealMakerPrivateProgress(snapshot).catch(() => {})}
                  disabled={revealProcessing}
                >
                  {revealProcessing ? 'Revealing...' : 'Reveal terms'}
                </button>
              </div>
            ) : null}

            <div className="p2p-terminal-token-actions" aria-label="Token explorer links">
              <span>Verify tokens</span>
              <div>
                {tokenExplorerLinks.length ? (
                  tokenExplorerLinks.map((link) => (
                    <a key={link.href} href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                      {link.label}
                    </a>
                  ))
                ) : (
                  <strong>Native only</strong>
                )}
              </div>
            </div>
          </section>

          <section className="p2p-terminal-ticket" aria-label="Trade action ticket">
            <div className="p2p-terminal-ticket-head">
              <span>Action ticket</span>
              <strong>
                {perspective.isMaker
                  ? 'Maker controls'
                  : canShowFillTicket
                    ? `Buy ${displayTrade.offer.symbol}`
                    : snapshot.status === 'open'
                      ? 'Review actions'
                      : 'Closed offer'}
              </strong>
            </div>

            {canShowFillTicket ? (
              <>
                <div className="p2p-terminal-amount-grid" aria-label="Trade amount calculator">
                  <label className="p2p-terminal-input-field has-inline-action">
                    <div className="p2p-terminal-field-head">
                      <span>You sell {displayTrade.request.symbol}</span>
                      <small>{resolveTerminalAssetBalanceLabel(displayTrade.request)}</small>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={terminalSpendFieldValue}
                      onChange={(event) => {
                        setTerminalFillInputSide('pay');
                        setTerminalPayInput(sanitizeTokenAmountInput(event.target.value));
                        setTerminalBuyInput('');
                      }}
                      placeholder={`0 ${displayTrade.request.symbol}`}
                      disabled={processingTradeActionId === tradeKey}
                    />
                    {maxPayInput && !isHiddenLiquidityTerms ? (
                      <button
                        type="button"
                        className="p2p-terminal-inline-max"
                        onClick={() => {
                          setTerminalFillInputSide('pay');
                          setTerminalPayInput(maxPayInput);
                          setTerminalBuyInput('');
                        }}
                        disabled={processingTradeActionId === tradeKey}
                      >
                        Max
                      </button>
                    ) : null}
                  </label>
                  <label className="p2p-terminal-input-field">
                    <div className="p2p-terminal-field-head">
                      <span>You buy {displayTrade.offer.symbol}</span>
                      <small>{resolveTerminalAssetBalanceLabel(displayTrade.offer)}</small>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={terminalReceiveFieldValue}
                      onChange={(event) => {
                        setTerminalFillInputSide('buy');
                        setTerminalBuyInput(sanitizeTokenAmountInput(event.target.value));
                        setTerminalPayInput('');
                      }}
                      placeholder={`0 ${displayTrade.offer.symbol}`}
                      disabled={processingTradeActionId === tradeKey}
                    />
                  </label>
                </div>
                {fillTooHigh ? <p className="p2p-terminal-ticket-warning">Amount is above current visible liquidity.</p> : null}
                <button
                  type="button"
                  className="trade-card-action trade-card-action-accept p2p-terminal-primary-action"
                  onClick={() => partialFillTrade(snapshot, fillSubmitInput).catch(() => {})}
                  disabled={processingTradeActionId === tradeKey || !fillCanSubmit}
                >
                  {processingTradeActionId === tradeKey
                    ? 'Processing...'
                    : !walletKey
                      ? `Connect wallet to buy`
                      : !onCotiNetwork
                        ? 'Switch network'
                        : !terminalInputValue.trim()
                          ? 'Enter amount'
                          : fillTooHigh
                            ? 'Amount too high'
                            : isHiddenLiquidityTerms
                              ? 'Fill order'
                              : `Buy ${displayTrade.offer.symbol}`}
                </button>
                {canCounter ? (
                  <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginCounterTrade(snapshot)}>
                    Counter
                  </button>
                ) : null}
                {showCounterUnavailable ? (
                  <button type="button" className="trade-card-action trade-card-action-counter trade-card-action-disabled" disabled title={counterUnavailableReason}>
                    Counter unavailable
                  </button>
                ) : null}
                {perspective.isTaker ? (
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-refuse"
                    onClick={() => declineTrade(snapshot).catch(() => {})}
                    disabled={processingTradeActionId === tradeKey}
                  >
                    Refuse
                  </button>
                ) : null}
              </>
            ) : snapshot.status === 'open' && perspective.isMaker ? (
              <div className="p2p-terminal-action-stack p2p-terminal-maker-disclosure">
                <button
                  type="button"
                  className={makerControlsExpanded ? 'p2p-terminal-manage-toggle active' : 'p2p-terminal-manage-toggle'}
                  onClick={() => toggleMakerControls('terminal', tradeKey)}
                  aria-expanded={makerControlsExpanded}
                >
                  <SlidersHorizontal size={15} strokeWidth={2.4} aria-hidden="true" />
                  <span>Manage offer</span>
                </button>
                {makerControlsExpanded ? (
                  <div className="p2p-terminal-maker-actions">
                    {canEdit ? (
                      <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginEditTrade(snapshot)} disabled={processingTradeActionId === tradeKey}>
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-refuse"
                      onClick={() => cancelTrade(snapshot).catch(() => {})}
                      disabled={processingTradeActionId === tradeKey}
                    >
                      {processingTradeActionId === tradeKey ? 'Processing...' : 'Cancel offer'}
                    </button>
                  </div>
                ) : (
                  <p>Open maker actions to edit or cancel this live offer.</p>
                )}
              </div>
            ) : snapshot.status === 'open' && canActAsTaker ? (
              <div className="p2p-terminal-action-stack">
                {canRevealDirectTerms ? <p>Reveal the shared terms before accepting.</p> : null}
                {canRevealDirectTerms ? (
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-counter"
                    onClick={() => revealMakerPrivateProgress(snapshot).catch(() => {})}
                    disabled={revealProcessing}
                  >
                    {revealProcessing ? 'Revealing...' : 'Reveal terms'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-accept p2p-terminal-primary-action"
                    onClick={() => acceptTrade(snapshot).catch(() => {})}
                    disabled={processingTradeActionId === tradeKey || !walletKey || !onCotiNetwork}
                  >
                    {processingTradeActionId === tradeKey
                      ? 'Processing...'
                      : !walletKey
                        ? 'Connect wallet to buy'
                        : !onCotiNetwork
                          ? 'Switch network'
                          : snapshot.counterParentTradeId
                            ? 'Accept & close related'
                            : `Buy ${displayTrade.offer.symbol}`}
                  </button>
                )}
                {!isHiddenLiquidityTerms && snapshot.counterParentTradeId && perspective.isTaker && (
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-counter"
                    onClick={() => acceptTrade(snapshot, 'accept-only').catch(() => {})}
                    disabled={processingTradeActionId === tradeKey}
                    title="Accept only this counter offer and keep the parent and sibling counters open."
                  >
                    Accept only
                  </button>
                )}
                {canCounter ? (
                  <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginCounterTrade(snapshot)} disabled={processingTradeActionId === tradeKey}>
                    Counter
                  </button>
                ) : null}
                {perspective.isTaker ? (
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-refuse"
                    onClick={() => declineTrade(snapshot).catch(() => {})}
                    disabled={processingTradeActionId === tradeKey}
                  >
                    Refuse
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="p2p-terminal-action-state">
                <strong>{snapshot.status === 'open' ? 'No wallet action available' : `${statusLabel} offer`}</strong>
                <p>
                  {snapshot.status === 'open'
                    ? walletKey
                      ? 'This wallet is not assigned to act on the offer.'
                      : 'Connect the trading wallet to see available maker or taker actions.'
                    : 'This trade is no longer accepting new fills.'}
                </p>
              </div>
            )}
          </section>
        </div>

        {renderTerminalHistoryMobileControls(historyConfig)}
      </article>
    );
  };

  const renderRecurringTradeTerminal = (snapshot: TradeSnapshot) => {
    const recurring = snapshot.recurringOrder;
    if (!recurring) {
      return null;
    }

    const tradeKey = getSnapshotKey(snapshot);
    const isMaker = walletKey.length > 0 && snapshot.maker.toLowerCase() === walletKey;
    const isActive = recurring.recurringStatus === 'active';
    const isPaused = recurring.recurringStatus === 'paused';
    const statusLabel =
      recurring.recurringStatus === 'active'
        ? 'Active'
        : recurring.recurringStatus === 'paused'
          ? 'Paused'
          : recurring.recurringStatus === 'cancelled'
            ? 'Cancelled'
            : 'Unknown';
    const modeLabel =
      recurring.mode === 'fully-private'
        ? 'Private liquidity'
        : recurring.mode === 'hybrid-private'
          ? 'Hybrid liquidity'
          : 'Visible liquidity';
    const makerControlsExpanded = Boolean(expandedMakerControls[buildMakerControlsKey('terminal', tradeKey)]);
    const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
    const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
    const revealedBaseInventory = recurring.makerPrivateInventory?.baseInventory;
    const revealedQuoteInventory = recurring.makerPrivateInventory?.quoteInventory;
    const hasPositiveRecurringAmount = (amount?: string): boolean => parseTokenAmountString(amount) > 0n;
    const baseInventoryLabel =
      baseHidden && revealedBaseInventory !== undefined
        ? formatRecurringTokenAmount(recurring.baseAsset, revealedBaseInventory, false)
        : baseHidden && recurring.hasPrivateBaseInventory
          ? 'Private'
          : formatRecurringTokenAmount(recurring.baseAsset, recurring.publicBaseInventory, false);
    const quoteInventoryLabel =
      quoteHidden && revealedQuoteInventory !== undefined
        ? formatRecurringTokenAmount(recurring.quoteAsset, revealedQuoteInventory, false)
        : quoteHidden && recurring.hasPrivateQuoteInventory
          ? 'Private'
          : formatRecurringTokenAmount(recurring.quoteAsset, recurring.publicQuoteInventory, false);
    const sellLiquidityLive =
      baseHidden && revealedBaseInventory !== undefined
        ? hasPositiveRecurringAmount(revealedBaseInventory)
        : baseHidden
          ? recurring.sellSideOpen && recurring.hasPrivateBaseInventory
          : hasPositiveRecurringAmount(recurring.publicBaseInventory);
    const buyLiquidityLive =
      quoteHidden && revealedQuoteInventory !== undefined
        ? hasPositiveRecurringAmount(revealedQuoteInventory)
        : quoteHidden
          ? recurring.buySideOpen && recurring.hasPrivateQuoteInventory
          : hasPositiveRecurringAmount(recurring.publicQuoteInventory);
    const recurringPriceDisplay = resolveRecurringPriceDeskDisplay({
      terms: {
        baseAsset: recurring.baseAsset,
        quoteAsset: recurring.quoteAsset,
        buyTerms: recurring.buyTerms,
        sellTerms: recurring.sellTerms
      },
      toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
      subjectLabel: `Recurring order ${recurring.orderId}`
    });
    const shareUrl = buildTradeShareUrl(snapshot.tradeId, undefined, snapshot.escrowContract);
    const shareKey = `terminal-recurring-order-link:${tradeKey}`;
    const buyProcessing = processingRecurringAction === `${tradeKey}:buy`;
    const sellProcessing = processingRecurringAction === `${tradeKey}:sell`;
    const sellToOrderState = getRecurringTerminalSideState(snapshot, 'sell');
    const buyFromOrderState = getRecurringTerminalSideState(snapshot, 'buy');
    const activeRecurringTerminalState = recurringTerminalSide === 'buy' ? buyFromOrderState : sellToOrderState;
    const canFillBuySide = !isMaker && sellToOrderState.isOpen;
    const canFillSellSide = !isMaker && buyFromOrderState.isOpen;
    const recurringTerminalInputValue = recurringTerminalSide === 'buy' ? recurringSellFillInput : recurringBuyFillInput;
    const recurringTerminalProcessing = recurringTerminalSide === 'buy' ? sellProcessing : buyProcessing;
    const recurringTerminalCanSubmit = recurringTerminalSide === 'buy' ? canFillSellSide : canFillBuySide;
    const recurringTerminalReady = Boolean(
      walletKey &&
      onCotiNetwork &&
      recurringTerminalInputValue.trim() &&
      recurringTerminalCanSubmit &&
      !recurringTerminalProcessing
    );
    const recurringTerminalInputAsset =
      recurringTerminalSide === 'buy' ? recurring.quoteAsset : recurring.baseAsset;
    const recurringTerminalOutputAsset =
      recurringTerminalSide === 'buy' ? recurring.baseAsset : recurring.quoteAsset;
    const recurringTerminalInputAmount = parseTokenAmountInput(
      recurringTerminalInputValue,
      recurringTerminalInputAsset.decimals
    );
    const recurringTerminalOutputAmount = (() => {
      if (!recurringTerminalInputAmount || recurringTerminalInputAmount <= 0n) {
        return 0n;
      }
      const terms = recurringTerminalSide === 'buy' ? recurring.sellTerms : recurring.buyTerms;
      const baseAmount = parseTokenAmountString(terms.baseAmount);
      const quoteAmount = parseTokenAmountString(terms.quoteAmount);
      if (baseAmount <= 0n || quoteAmount <= 0n) {
        return 0n;
      }
      return recurringTerminalSide === 'buy'
        ? (recurringTerminalInputAmount * baseAmount) / quoteAmount
        : (recurringTerminalInputAmount * quoteAmount) / baseAmount;
    })();
    const recurringTerminalReceiveValue =
      recurringTerminalOutputAmount > 0n
        ? formatExactTokenAmountInput(recurringTerminalOutputAmount, recurringTerminalOutputAsset.decimals)
        : '';
    const recurringBaseExplorerUrl = buildTradeAssetExplorerUrl(recurring.baseAsset);
    const recurringQuoteExplorerUrl = buildTradeAssetExplorerUrl(recurring.quoteAsset);
    const recurringMakerExplorerUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${snapshot.maker}`;
    const recurringTokenExplorerLinks = [
      recurringBaseExplorerUrl
        ? {
            key: recurringBaseExplorerUrl,
            href: recurringBaseExplorerUrl,
            label: recurring.baseAsset.symbol,
            title: `View ${recurring.baseAsset.symbol} on token explorer`
          }
        : null,
      recurringQuoteExplorerUrl
        ? {
            key: recurringQuoteExplorerUrl,
            href: recurringQuoteExplorerUrl,
            label: recurring.quoteAsset.symbol,
            title: `View ${recurring.quoteAsset.symbol} on token explorer`
          }
        : null
    ]
      .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
      .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
    const historyConfig = getRecurringTerminalHistoryConfig(snapshot);

    return (
      <article className="p2p-terminal-shell p2p-terminal-shell-recurring" key={tradeKey}>
        <header className="p2p-terminal-head">
          <div className="p2p-terminal-title">
            <span className="p2p-terminal-eyebrow">Recurring OTC Terminal</span>
            <h3>{recurring.baseAsset.symbol}/{recurring.quoteAsset.symbol}</h3>
            <div className="p2p-terminal-tag-row" aria-label="Recurring order tags">
              <span className="p2p-order-id">Order #{recurring.orderId}</span>
              <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
              <span className="p2p-order-chip">{modeLabel}</span>
              {recurring.mode !== 'public' ? <span className="p2p-order-chip">Shared order</span> : null}
            </div>
          </div>
          <div className="p2p-terminal-toolbar">
            <button
              type="button"
              className={lastCopiedKey === shareKey ? 'p2p-terminal-share copied' : 'p2p-terminal-share'}
              onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
            >
              {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
            </button>
          </div>
        </header>

        <div className="p2p-terminal-main">
          <section className="p2p-terminal-market" aria-label="Recurring order market summary">
            <button
              type="button"
              className="p2p-terminal-price-card p2p-terminal-price-desk"
              onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
              title={recurringPriceDisplay.toggleTitle}
              aria-label={recurringPriceDisplay.ariaLabel}
            >
              <div className="p2p-recurring-price-card-head">
                <span>Price ratio</span>
              </div>
              <div className="p2p-recurring-price-grid">
                <div className="p2p-recurring-price-box p2p-recurring-price-buy">
                  <span>{recurringPriceDisplay.displayBuySide.label}</span>
                  <strong>{recurringPriceDisplay.displayBuySide.priceLabel}</strong>
                </div>
                <div className="p2p-recurring-price-box p2p-recurring-price-sell">
                  <span>{recurringPriceDisplay.displaySellSide.label}</span>
                  <strong>{recurringPriceDisplay.displaySellSide.priceLabel}</strong>
                </div>
              </div>
            </button>

            <div className="p2p-terminal-liquidity-grid" aria-label="Recurring order liquidity">
              <div>
                <div className="p2p-terminal-liquidity-head">
                  <span>Sell liquidity</span>
                  <i
                    className={sellLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                    title={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
                    role="img"
                    aria-label={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
                  />
                </div>
                <strong className={baseHidden && revealedBaseInventory === undefined && recurring.hasPrivateBaseInventory ? 'p2p-order-muted-slot' : undefined}>
                  {baseInventoryLabel}
                </strong>
              </div>
              <div>
                <div className="p2p-terminal-liquidity-head">
                  <span>Buy liquidity</span>
                  <i
                    className={buyLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
                    title={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
                    role="img"
                    aria-label={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
                  />
                </div>
                <strong className={quoteHidden && revealedQuoteInventory === undefined && recurring.hasPrivateQuoteInventory ? 'p2p-order-muted-slot' : undefined}>
                  {quoteInventoryLabel}
                </strong>
              </div>
              <div>
                <span>Executions</span>
                <strong className={recurring.executionCount === 0 ? 'p2p-order-muted-slot' : undefined}>
                  {recurring.executionCount > 0 ? recurring.executionCount : 'None'}
                </strong>
              </div>
            </div>

            <div className="p2p-terminal-stat-grid p2p-terminal-stat-grid-compact">
              <div>
                <span>Maker</span>
                <a href={recurringMakerExplorerUrl} target="_blank" rel="noreferrer" title={snapshot.maker}>
                  {isMaker ? `${shortenAddress(snapshot.maker)} (you)` : shortenAddress(snapshot.maker)}
                </a>
              </div>
            </div>

            <div className="p2p-terminal-token-actions" aria-label="Token explorer links">
              <span>Verify tokens</span>
              <div>
                {recurringTokenExplorerLinks.length ? (
                  recurringTokenExplorerLinks.map((link) => (
                    <a key={link.key} href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                      {link.label}
                    </a>
                  ))
                ) : (
                  <strong>Native only</strong>
                )}
              </div>
            </div>
          </section>

          <section className="p2p-terminal-ticket" aria-label="Recurring order action ticket">
            <div className="p2p-terminal-ticket-head">
              <span>Action ticket</span>
              <strong>{isMaker ? 'Maker controls' : activeRecurringTerminalState.actionLabel}</strong>
            </div>

            {isMaker ? (
              <div className="p2p-terminal-action-stack p2p-terminal-maker-disclosure">
                <button
                  type="button"
                  className={makerControlsExpanded ? 'p2p-terminal-manage-toggle active' : 'p2p-terminal-manage-toggle'}
                  onClick={() => toggleMakerControls('terminal', tradeKey)}
                  aria-expanded={makerControlsExpanded}
                >
                  <SlidersHorizontal size={15} strokeWidth={2.4} aria-hidden="true" />
                  <span>Manage order</span>
                </button>
                {makerControlsExpanded ? (
                  <div className="p2p-terminal-maker-actions">
                    {isActive ? (
                      <button
                        type="button"
                        className="trade-card-action trade-card-action-counter"
                        onClick={() => updateRecurringOrderStatus(snapshot, 'pause').catch(() => {})}
                        disabled={processingRecurringAction === `${tradeKey}:pause`}
                      >
                        {processingRecurringAction === `${tradeKey}:pause` ? 'Pausing...' : 'Pause'}
                      </button>
                    ) : null}
                    {isPaused ? (
                      <button
                        type="button"
                        className="trade-card-action trade-card-action-counter"
                        onClick={() => updateRecurringOrderStatus(snapshot, 'resume').catch(() => {})}
                        disabled={processingRecurringAction === `${tradeKey}:resume`}
                      >
                        {processingRecurringAction === `${tradeKey}:resume` ? 'Resuming...' : 'Resume'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-counter"
                      onClick={() => beginEditRecurringOrder(snapshot)}
                      disabled={Boolean(processingRecurringAction)}
                    >
                      Edit
                    </button>
                    {recurring.recurringStatus !== 'cancelled' ? (
                      <button
                        type="button"
                        className="trade-card-action trade-card-action-refuse"
                        onClick={() => updateRecurringOrderStatus(snapshot, 'cancel').catch(() => {})}
                        disabled={processingRecurringAction === `${tradeKey}:cancel`}
                      >
                        {processingRecurringAction === `${tradeKey}:cancel` ? 'Closing...' : 'Close order'}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p>Open maker actions to edit prices, adjust funding, pause, or close this order.</p>
                )}
              </div>
            ) : (
              <>
                <div className="p2p-terminal-tabs" role="tablist" aria-label="Choose recurring order side">
                  <button
                    type="button"
                    className={recurringTerminalSide === 'buy' ? 'active' : undefined}
                    role="tab"
                    aria-selected={recurringTerminalSide === 'buy'}
                    onClick={() => setRecurringTerminalSide('buy')}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className={recurringTerminalSide === 'sell' ? 'active' : undefined}
                    role="tab"
                    aria-selected={recurringTerminalSide === 'sell'}
                    onClick={() => setRecurringTerminalSide('sell')}
                  >
                    Sell
                  </button>
                </div>
                <div className="p2p-terminal-amount-grid" aria-label="Recurring order amount calculator">
                  <label className="p2p-terminal-input-field">
                    <div className="p2p-terminal-field-head">
                      <span>You sell {recurringTerminalInputAsset.symbol}</span>
                      <small>{resolveTerminalAssetBalanceLabel(recurringTerminalInputAsset)}</small>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={recurringTerminalInputValue}
                      onChange={(event) => {
                        const nextValue = sanitizeTokenAmountInput(event.target.value);
                        if (recurringTerminalSide === 'buy') {
                          setRecurringSellFillInput(nextValue);
                        } else {
                          setRecurringBuyFillInput(nextValue);
                        }
                      }}
                      placeholder={`0 ${recurringTerminalInputAsset.symbol}`}
                      disabled={!recurringTerminalCanSubmit || recurringTerminalProcessing}
                    />
                  </label>
                  <label className="p2p-terminal-input-field p2p-terminal-output-field">
                    <div className="p2p-terminal-field-head">
                      <span>You buy {recurringTerminalOutputAsset.symbol}</span>
                      <small>{resolveTerminalAssetBalanceLabel(recurringTerminalOutputAsset)}</small>
                    </div>
                    <input
                      type="text"
                      value={recurringTerminalReceiveValue}
                      placeholder={`0 ${recurringTerminalOutputAsset.symbol}`}
                      readOnly
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className={
                    recurringTerminalSide === 'buy'
                      ? 'trade-card-action trade-card-action-accept p2p-terminal-primary-action'
                      : 'trade-card-action trade-card-action-counter p2p-terminal-primary-action'
                  }
                  onClick={() => fillRecurringOrderSide(snapshot, recurringTerminalSide === 'buy' ? 'sell' : 'buy').catch(() => {})}
                  disabled={!recurringTerminalReady}
                >
                  {recurringTerminalProcessing
                    ? 'Processing...'
                    : !walletKey
                      ? 'Connect wallet'
                      : !onCotiNetwork
                        ? 'Switch network'
                        : !recurringTerminalInputValue.trim()
                          ? 'Enter amount'
                          : recurringTerminalCanSubmit
                            ? activeRecurringTerminalState.actionLabel
                            : activeRecurringTerminalState.disabledLabel}
                </button>
              </>
            )}
          </section>
        </div>

        {historyConfig ? renderTerminalHistoryMobileControls(historyConfig) : null}
      </article>
    );
  };

  const renderTradeTerminal = (snapshot: TradeSnapshot) =>
    snapshot.recurringOrder ? renderRecurringTradeTerminal(snapshot) : renderStandardTradeTerminal(snapshot);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let visibleSyncIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;

    const dispatchRealtimeSync = (reason: P2PSyncReason = 'interval') => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }
      if (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive()) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-realtime-dispatch-held');
        return;
      }
      lastRealtimeSyncDispatchAt = Date.now();
      scheduleP2PSync({
        domains: [
          'balances',
          'public-trades',
          ...(walletAddress ? (['wallet-trades'] as const) : []),
          ...(routeView === 'trade' && routeTradeId ? (['trade-detail'] as const) : [])
        ],
        escrowContract: routeEscrowContract,
        reason,
        tradeId: routeTradeId ?? undefined
      });
    };

    const scheduleRealtimeSync = (reason: P2PSyncReason = 'interval') => {
      if (cancelled) {
        return;
      }
      if (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive()) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-realtime-schedule-held');
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !hasActiveListRefresh() &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync(reason);
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
        dispatchRealtimeSync(reason);
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
      scheduleRealtimeSync('focus');
    };

    if (typeof window !== 'undefined') {
      visibleSyncIntervalId = window.setInterval(() => scheduleRealtimeSync('interval'), P2P_VISIBLE_SYNC_INTERVAL_MS);
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

        const eventSubscriptions: Array<{
          abi: readonly string[];
          address: string;
          events: string[];
        }> = [
          {
            abi: TRADE_ESCROW_CONTRACT_ABI,
            address: TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'TradeOpened',
              'TradeAccepted',
              'TradeCancelled',
              'TradeDeclined',
              'TradeExpired',
              'TradePartiallyFilled',
              'TradeFilled',
              'TradeReplaced',
              'CounterTradeAccepted',
              'ParentTradeClosedByDirectCounter'
            ]
          },
          {
            abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
            address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'PrivateOrderOpened',
              'PrivateOrderFilled',
              'TradeAccepted',
              'TradeCancelled',
              'TradeDeclined',
              'TradeExpired',
              'TradeFilled',
              'TradeReplaced',
              'ParentTradeClosedByDirectCounter'
            ]
          },
          {
            abi: DIRECT_TRADE_ESCROW_CONTRACT_ABI,
            address: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'DirectTradeOpened',
              'DirectTradeAccepted',
              'DirectTradeFilled',
              'DirectTradeCancelled',
              'DirectTradeDeclined',
              'DirectTradeExpired',
              'DirectTradeReplaced',
              'CounterTradeAccepted',
              'ParentTradeClosedByCounter',
              'SiblingCounterClosed'
            ]
          },
          {
            abi: RECURRING_OTC_CONTRACT_ABI,
            address: RECURRING_OTC_CONTRACT_ADDRESS,
            events: [
              'RecurringOrderOpened',
              'RecurringOrderEdited',
              'RecurringOrderExecuted',
              'RecurringOrderPaused',
              'RecurringOrderResumed',
              'RecurringOrderCancelled',
              'RecurringOrderInventorySettled',
              'PrivateRecurringFillReceipt',
              'PrivateRecurringInventorySnapshot',
              'PrivateRecurringAccountSnapshotUpdated'
            ]
          }
        ];
        const handleTradeEvent = () => {
          scheduleRealtimeSync('chain-event');
        };
        const activeSubscriptions: Array<{
          contract: { off: (filter: never, listener: () => void) => unknown };
          filter: never;
        }> = [];
        for (const subscription of eventSubscriptions) {
          const contract = new cotiEthers.Contract(subscription.address, subscription.abi, wsProvider);
          for (const eventName of subscription.events) {
            const filterFactory = (contract.filters as Record<string, (() => unknown) | undefined>)[eventName];
            if (!filterFactory) {
              continue;
            }
            const filter = filterFactory() as never;
            contract.on(filter, handleTradeEvent);
            activeSubscriptions.push({
              contract: contract as { off: (filter: never, listener: () => void) => unknown },
              filter
            });
          }
        }

        if (cancelled) {
          for (const subscription of activeSubscriptions) {
            subscription.contract.off(subscription.filter, handleTradeEvent);
          }
          return;
        }

        unsubscribe = () => {
          for (const subscription of activeSubscriptions) {
            subscription.contract.off(subscription.filter, handleTradeEvent);
          }
        };
        clearPollFallback();
      } catch {
        await resetCotiWsProvider();
        if (cancelled) {
          return;
        }

        if (pollIntervalId === null) {
          pollIntervalId = window.setInterval(() => scheduleRealtimeSync('interval'), REALTIME_SYNC_FALLBACK_INTERVAL_MS);
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
  }, [
    chainId,
    hasActiveListRefresh,
    routeEscrowContract,
    routeTradeId,
    routeView,
    scheduleP2PSync,
    getTradeWalletFlowInput,
    walletAddress
  ]);

  const tradePricePairLabel =
    tradeComposerModel.selectedTradeOfferToken && tradeComposerModel.selectedTradeRequestToken
      ? `${tradeComposerModel.selectedTradeRequestToken.symbol}/${tradeComposerModel.selectedTradeOfferToken.symbol}`
      : 'quote/base';

  const tradeComposer = (
    <TradeComposerPanel
      validationDisplayMode="after-interaction"
      title={
        editingTrade
          ? `Edit public offer #${editingTrade.tradeId}`
          : counterParentTrade
            ? `Counter offer #${counterParentTrade.tradeId}`
            : 'Create offer'
      }
      metaLabel={
        editingTrade
          ? 'Cancel and replace public offer'
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
      escrowContractAddress={tradeFeeEscrowContract}
      escrowContractLabel={tradeFeeEscrowContractLabel}
      safetyNote={
        editingTrade
          ? 'Editing creates a new public offer and cancels the original in the same transaction.'
          : counterParentTrade
          ? 'The counter offer is created as a linked private offer for the original maker.'
          : 'Escrow settlement and trade terms are stored on-chain.'
      }
      sendLabel={editingTrade ? 'Save Edit' : counterParentTrade ? 'Send Counter' : 'Create Offer'}
      sendingLabel="Creating..."
      sendTitle={
        editingTrade
          ? 'Cancel the old public offer and create the replacement.'
          : counterParentTrade
            ? 'Create a linked counter trade on chain.'
            : 'Create the escrow offer on chain.'
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
      onOfferAmountInputChange={updateTradeOfferAmountInput}
      requestAmountInput={tradeRequestAmountInput}
      onRequestAmountInputChange={updateTradeRequestAmountInput}
      offerAmountLabel={tradeComposerModel.tradeOfferAmountLabel}
      requestAmountLabel={tradeComposerModel.tradeRequestAmountLabel}
      offerAmountPlaceholder={tradeComposerModel.tradeOfferAmountPlaceholder}
      requestAmountPlaceholder={tradeComposerModel.tradeRequestAmountPlaceholder}
      offerAmountError={tradeComposerModel.tradeComposerFieldErrors.offerAmount}
      requestAmountError={tradeComposerModel.tradeComposerFieldErrors.requestAmount}
      priceInput={tradePriceInput}
      onPriceInputChange={updateTradePriceInput}
      priceLabel="Price"
      pricePlaceholder={`${tradeComposerModel.selectedTradeRequestToken?.symbol ?? 'quote'} per ${
        tradeComposerModel.selectedTradeOfferToken?.symbol ?? 'base'
      }`}
      priceSummaryLabel={tradePricePairLabel}
      priceHelpText="Any two fields set the offer; the third updates."
      pricePlacement="sell-side"
      showPriceRatioPreview
      canUseMaxOfferAmount={tradeComposerModel.canUseTradeOfferMax}
      onUseMaxOfferAmount={() => updateTradeOfferAmountInput(tradeComposerModel.tradeOfferMaxInputValue)}
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
        setTradePriceInput('');
        setTradePricingEditedFields([]);
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
      expiresNever={tradeHasNoExpiry}
      onExpiresNeverChange={setTradeHasNoExpiry}
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

  const renderCounterParentSummary = (trade: TradeSnapshot) => {
    const displayTerms = getTradeDisplayTerms(trade);
    const parentDisplayTrade = {
      ...trade,
      offer: displayTerms.offer,
      request: displayTerms.request
    };
    const parentOrderSummary = resolveTradeOrderSummary(parentDisplayTrade, walletAddress);
    const termsVisibility = getTradeTermsVisibility(trade);
    const directTermsHydrated = hasHydratedDirectTradeTerms(trade);
    const amountsHidden = termsVisibility === 'hidden-liquidity' || (termsVisibility === 'direct-private-terms' && !directTermsHydrated);
    const counterSellAsset = parentDisplayTrade.request;
    const counterReceiveAsset = parentDisplayTrade.offer;
    const formatCounterParentAmount = (asset: TradeAssetPayload): string =>
      amountsHidden ? `Amount hidden - ${asset.symbol}` : formatTradeAssetDisplayText(asset);
    const parentStatusLabel =
      trade.status === 'open'
        ? 'Active'
        : trade.status === 'unknown'
          ? 'Unknown'
          : trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
    const parentExpiryCountdown = trade.status === 'open' ? formatExpiryCountdown(trade.expiresAt) : null;
    const parentExpiryParts = formatTradeExpiryParts(trade.expiresAt);
    const parentAccessLabel =
      trade.isPublic === false
        ? isDirectWalletTrade(trade)
          ? 'Direct offer'
          : trade.hasAccessHash
            ? 'Private link'
            : 'Unlisted offer'
        : 'Public offer';
    const ratioLabel =
      amountsHidden
        ? termsVisibility === 'direct-private-terms'
          ? 'Private terms'
          : formatTradeRatioLabel(counterSellAsset, counterReceiveAsset) ??
            formatHiddenFixedPriceTerms(counterSellAsset, counterReceiveAsset)
        : formatTradeRatioLabel(counterSellAsset, counterReceiveAsset) ??
          formatTradeRateText(counterSellAsset, counterReceiveAsset);
    const parentTakerLabel = isZeroTradeTakerAddress(trade.taker) ? 'Open offer' : shortenAddress(trade.taker);
    const privacyChips = [
      termsVisibility === 'hidden-liquidity'
        ? 'Private liquidity'
        : termsVisibility === 'direct-private-terms'
          ? 'Private terms'
          : 'Public amount',
      trade.offer.kind !== 'private-erc20' || trade.request.kind !== 'private-erc20' ? 'Public settlement side' : null,
      trade.counterParentTradeId ? `Counter chain #${trade.counterParentTradeId}` : null
    ].filter((chip): chip is string => Boolean(chip));

    return (
      <section className="p2p-counter-parent-context" aria-label="Parent trade details for counter offer">
        <div className="p2p-counter-parent-head">
          <div>
            <span>Replying to offer #{trade.tradeId}</span>
            <strong>{parentOrderSummary.directionLabel}</strong>
          </div>
          <div className="p2p-counter-parent-chips" aria-label="Parent trade privacy and status">
            <span className={`p2p-offer-status p2p-offer-status-${trade.status}`}>{parentStatusLabel}</span>
            {privacyChips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        </div>

        <div className="p2p-counter-parent-terms">
          <div className="p2p-counter-parent-term p2p-counter-parent-term-sell">
            <span>You sell</span>
            <strong>{formatCounterParentAmount(counterSellAsset)}</strong>
            <small>What the parent offer asks for</small>
          </div>
          <div className="p2p-counter-parent-arrow" aria-hidden="true">
            <ArrowRight size={18} strokeWidth={2.2} />
          </div>
          <div className="p2p-counter-parent-term p2p-counter-parent-term-receive">
            <span>You receive</span>
            <strong>{formatCounterParentAmount(counterReceiveAsset)}</strong>
            <small>What the parent offer sells</small>
          </div>
        </div>

        <div className="p2p-counter-parent-facts">
          <div>
            <span>Price ratio</span>
            <strong>{ratioLabel || 'Set your counter price below'}</strong>
          </div>
          <div>
            <span>Maker</span>
            <strong>{shortenAddress(trade.maker)}</strong>
          </div>
          <div>
            <span>Recipient</span>
            <strong>{parentTakerLabel}</strong>
          </div>
          <div>
            <span>Access</span>
            <strong>{parentAccessLabel}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong
              className={parentExpiryCountdown ? `trade-card-expiry-${parentExpiryCountdown.urgency}` : undefined}
              title={parentExpiryParts.title}
            >
              {parentExpiryCountdown ? parentExpiryCountdown.label.replace(/^Expires /, '') : parentExpiryParts.date}
            </strong>
          </div>
          <div>
            <span>Counter behavior</span>
            <strong>{trade.counterParentTradeId ? 'Replaces counter chain' : 'Linked Direct offer'}</strong>
          </div>
        </div>
      </section>
    );
  };

  const renderTradeOverviewCard = (trade: TradeSnapshot, options: TradeOverviewCardOptions = {}) => {
    if (trade.recurringOrder) {
      return renderRecurringOrderCard(trade, false, options);
    }

    const tradeKey = getSnapshotKey(trade);
    const canOpenTerminal = options.canOpenTerminal ?? true;
    const openCardTerminal = () => {
      if (!canOpenTerminal) {
        return;
      }
      if (options.onOpenTerminal) {
        options.onOpenTerminal(trade);
        return;
      }
      openTradeSnapshot(trade);
    };
    const displayTerms = getTradeDisplayTerms(trade);
    const displayTrade = {
      ...trade,
      offer: displayTerms.offer,
      request: displayTerms.request
    };
    const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
    const perspective = orderSummary.perspective;
    const termsVisibility = getTradeTermsVisibility(trade);
    const isHiddenLiquidityTerms = termsVisibility === 'hidden-liquidity';
    const isDirectPrivateTerms = termsVisibility === 'direct-private-terms';
    const directTermsHydrated = hasHydratedDirectTradeTerms(trade);
    const counterUnavailableReason = getCounterOfferUnavailableReason(trade, walletKey);
    const canCounter = canCreateCounterOffer(trade, walletKey);
    const showCounterUnavailable =
      !canCounter &&
      walletKey.length > 0 &&
      !perspective.isMaker &&
      trade.status === 'open' &&
      counterUnavailableReason === PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE;
    const completionSummary = getTradeCompletionSummary(trade);
    const makerPrivateProgressSummary = route.view === 'public' ? null : getMakerPrivateProgressSummary(trade);
    const publicLiquidityProgressSummary =
      !isHiddenLiquidityTerms && !(isDirectPrivateTerms && !directTermsHydrated)
        ? getVisibleOfferLiquiditySummary(trade)
        : null;
    const privateFillReceiptRows = trade.privateFillReceipts ?? [];
    const walletFillState = trade.walletFillState;
    const hasWalletFillState = Boolean(
      walletFillState &&
      (walletFillState.offerAmountReceived !== '0' || walletFillState.requestAmountPaid !== '0')
    );
    const orderLiquiditySummary = makerPrivateProgressSummary ?? publicLiquidityProgressSummary;
    const publicLiquidityHasFills = Boolean(publicLiquidityProgressSummary?.hasFills);
    const publicLiquidityFilledVerb = perspective.isMaker ? 'sold' : 'bought';
    const publicLiquidityRemainingVerb = trade.status === 'open' ? 'available' : 'remaining';
    const publicLiquidityRemainingAmount =
      publicLiquidityProgressSummary?.remainingAmountLabel ?? publicLiquidityProgressSummary?.remainingLabel ?? '';
    const orderLiquidityLabel = makerPrivateProgressSummary
      ? `You sell ${trade.offer.symbol}`
      : perspective.isMaker
        ? `You sell ${trade.offer.symbol}`
        : `You buy ${trade.offer.symbol}`;
    const orderLiquidityHeaderValue = publicLiquidityProgressSummary
      ? publicLiquidityHasFills
        ? publicLiquidityProgressSummary.totalLabel
        : `${publicLiquidityRemainingAmount} ${publicLiquidityRemainingVerb}`
      : orderLiquiditySummary?.totalLabel ?? '';
    const orderLiquidityFilledLabel = publicLiquidityProgressSummary
      ? publicLiquidityHasFills
        ? `${publicLiquidityProgressSummary.filledAmountLabel ?? publicLiquidityProgressSummary.filledLabel} ${publicLiquidityFilledVerb}`
        : 'No fills yet'
      : orderLiquiditySummary?.filledLabel;
    const orderLiquidityRemainingLabel = publicLiquidityProgressSummary
      ? publicLiquidityHasFills
        ? `${publicLiquidityRemainingAmount} ${publicLiquidityRemainingVerb}`
        : trade.status === 'open'
          ? 'Open liquidity'
          : 'No fill recorded'
      : orderLiquiditySummary?.remainingLabel;
    const orderLiquidityPaymentLabel = publicLiquidityProgressSummary
      ? perspective.isMaker
        ? `You buy ${trade.request.symbol}`
        : `You sell ${trade.request.symbol}`
      : '';
    const orderLiquidityPaymentValue = publicLiquidityProgressSummary?.paymentTotalLabel ?? '';
    const fallbackCompletionSummary = orderLiquiditySummary ? null : completionSummary;
    const canRevealDirectTerms = Boolean(
      route.view !== 'public' &&
      isDirectPrivateTerms &&
      !directTermsHydrated &&
      perspective.isParticipant
    );
    const accessSecret = resolveKnownTradeAccessSecret(trade.tradeId, trade.escrowContract);
    const shareUrl =
      trade.isPublic === false &&
      trade.hasAccessHash &&
      !accessSecret &&
      !canUseWalletAuthorityForDirectAccess(trade, walletKey)
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
        : 'Public offer';
    const showPublicAccessCopy = visibilityLabel !== 'Public offer';
    const walletRelationTag = perspective.isMaker
      ? 'Maker'
      : perspective.isTaker
        ? 'Reserved'
        : trade.walletHasFill
          ? 'Filled'
          : null;
    const tradeRelationTags = [walletRelationTag].filter((label): label is string => Boolean(label));
    const tradeSecondaryTags = [
      isHiddenLiquidityTerms ? 'Private liquidity' : null,
      isDirectPrivateTerms ? 'Private terms' : null,
      showPublicAccessCopy && !isHiddenLiquidityTerms && !isDirectPrivateTerms ? visibilityLabel : null,
      trade.counterParentTradeId ? `Counter #${trade.counterParentTradeId}` : null,
      trade.replacesTradeId ? `Edited #${trade.replacesTradeId}` : null,
      trade.replacementTradeId ? `Replaced #${trade.replacementTradeId}` : null
    ].filter((label): label is string => Boolean(label));
    const takerLabel = isZeroTradeTakerAddress(trade.taker) ? '' : shortenAddress(trade.taker);
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
    const openTradeActionCta = getStandardTradeOpenActionCta(trade);
    const leftSide = orderSummary.primarySide;
    const rightSide = orderSummary.secondarySide;
    const getDeskSideLabel = (side: typeof leftSide): string => side.label;
    const leftSideLabel = getDeskSideLabel(leftSide);
    const rightSideLabel = getDeskSideLabel(rightSide);
    const leftExplorerUrl = buildTradeAssetExplorerUrl(leftSide.asset);
    const rightExplorerUrl = buildTradeAssetExplorerUrl(rightSide.asset);
    const tokenExplorerLinks = [
      leftExplorerUrl
        ? {
            key: leftExplorerUrl,
            href: leftExplorerUrl,
            label: leftSide.asset.symbol,
            title: `View ${leftSide.asset.symbol} on token explorer`
          }
        : null,
      rightExplorerUrl
        ? {
            key: rightExplorerUrl,
            href: rightExplorerUrl,
            label: rightSide.asset.symbol,
            title: `View ${rightSide.asset.symbol} on token explorer`
          }
        : null
    ]
      .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
      .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
    const pairLabel = orderSummary.directionLabel;
    const leftToneClass = `p2p-offer-term-${leftSide.tone}`;
    const rightToneClass = `p2p-offer-term-${rightSide.tone}`;
    const priceRatioDisplay = resolveTradePriceRatioDisplay({
      baseAsset: leftSide.asset,
      quoteAsset: rightSide.asset,
      toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
      forwardFallbackLabel: isHiddenLiquidityTerms
        ? formatHiddenFixedPriceTerms(leftSide.asset, rightSide.asset)
        : formatTradeRateText(leftSide.asset, rightSide.asset),
      reverseFallbackLabel: isHiddenLiquidityTerms
        ? formatHiddenFixedPriceTerms(rightSide.asset, leftSide.asset)
        : formatTradeRateText(rightSide.asset, leftSide.asset),
      subjectLabel: `price ratio for trade ${trade.tradeId}`
    });
    const tradeRateText = isDirectPrivateTerms && !directTermsHydrated
      ? 'Private terms'
      : isHiddenLiquidityTerms
      ? priceRatioDisplay?.label ?? ''
      : priceRatioDisplay?.label ?? '';
    const showPriceSummary = Boolean(tradeRateText);
    const formatVisibleTermText = (asset: TradeAssetPayload): string =>
      isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated)
        ? asset.symbol
        : formatTradeAssetDisplayText(asset);
    const formatHiddenTermMetaLabel = (asset: TradeAssetPayload): string =>
      asset.kind === 'private-erc20' ? 'Private amount' : 'Public asset';
    const leftMetaLabel =
      isHiddenLiquidityTerms
        ? formatHiddenTermMetaLabel(leftSide.asset)
        : isDirectPrivateTerms && !directTermsHydrated
        ? 'Private terms'
        : leftSide.role === 'offer'
        ? displayTerms.usingRemaining
          ? 'Remaining now'
          : trade.status === 'open'
            ? 'Available now'
            : statusLabel
        : takerLabel;
    const rightMetaLabel =
      isHiddenLiquidityTerms
        ? formatHiddenTermMetaLabel(rightSide.asset)
        : isDirectPrivateTerms && !directTermsHydrated
        ? 'Private terms'
        : rightSide.role === 'offer'
        ? displayTerms.usingRemaining
          ? 'Remaining now'
          : trade.status === 'open'
            ? 'Available now'
            : statusLabel
        : takerLabel;
    const expiryParts = formatTradeExpiryParts(trade.expiresAt);
    const expiryCountdown = trade.status === 'open' ? formatExpiryCountdown(trade.expiresAt) : null;
    const expiryChipLabel = expiryCountdown
      ? expiryCountdown.label.replace(/^Expires /, '').replace(/\s+/g, ' ')
      : expiryParts.time
        ? `${expiryParts.date} ${expiryParts.time}`
        : expiryParts.date;
    const expiryChipTitle = `Created: ${formatMessageTimestamp(trade.createdAt)} · ${expiryParts.title}`;
    const historyFillLabel = isHiddenLiquidityTerms
      ? makerPrivateProgressSummary?.filledLabel ?? 'Private fill'
      : completionSummary?.filledLabel ?? (trade.status === 'accepted' ? 'Filled' : 'No fill recorded');
    const historyRemainingLabel = isHiddenLiquidityTerms
      ? makerPrivateProgressSummary?.remainingLabel ?? 'Private amounts'
      : completionSummary?.remainingLabel ?? (trade.status === 'accepted' ? 'Settled' : 'No remaining fill data');
    const historyRows = buildTradeTransactionHistoryRows([trade], walletAddress);
    const primaryHistoryRow = historyRows[0] ?? null;
    const showEmbeddedHistoryDetails = options.groupId !== 'history';
    const historyCounterpartyLabel = primaryHistoryRow?.counterparty
      ? shortenAddress(primaryHistoryRow.counterparty)
      : isZeroTradeTakerAddress(trade.taker)
        ? 'Unfilled'
        : shortenAddress(trade.taker);
    const formatPrivateReceiptAmount = (asset: TradeAssetPayload, amount?: string): string => {
      if (!amount || !/^\d+$/.test(amount)) {
        return `Private ${asset.symbol}`;
      }
      return `${formatTokenAmount(BigInt(amount), asset.decimals, 6)} ${asset.symbol}`;
    };

    return (
      <article
        key={tradeKey}
        className={[
          'p2p-order-card',
          'p2p-offer-card',
          `p2p-offer-card-${trade.status}`,
          options.selected ? 'p2p-order-card-selected' : '',
          isHiddenLiquidityTerms ? 'p2p-offer-card-private-liquidity' : ''
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="p2p-offer-card-head p2p-order-card-head">
          <div className="p2p-offer-title">
            <span className="p2p-offer-kind">P2P OTC</span>
            <div className="p2p-order-title-row">
              <h3 title={formatTradeListTerms(trade)}>{pairLabel}</h3>
            </div>
            <div className="p2p-order-tag-stack">
              <p className="p2p-order-subline p2p-order-subline-primary">
                <span className="p2p-order-id">Offer #{trade.tradeId}</span>
                <strong className={`p2p-offer-status ${statusClassName}`}>{statusLabel}</strong>
                {tradeRelationTags.map((label) => (
                  <span
                    className={label === 'Maker' ? 'p2p-order-chip p2p-order-chip-owner' : 'p2p-order-chip'}
                    key={`${tradeKey}:relation:${label}`}
                    title={label === 'Maker' ? 'Created by you' : undefined}
                  >
                    {label}
                  </span>
                ))}
              </p>
              <p className="p2p-order-subline p2p-order-subline-secondary">
                {tradeSecondaryTags.map((label) => (
                  <span className="p2p-order-chip" key={`${tradeKey}:tag:${label}`}>
                    {label}
                  </span>
                ))}
                <span
                  className={`p2p-offer-expiry p2p-expiry-chip ${
                    expiryCountdown ? `trade-card-expiry-${expiryCountdown.urgency}` : ''
                  }`}
                  title={expiryChipTitle}
                >
                  {expiryChipLabel}
                </span>
              </p>
            </div>
          </div>
        </div>

        {showPriceSummary ? (
          <button
            type="button"
            className={
              isHiddenLiquidityTerms
                ? 'p2p-hidden-price-card p2p-order-market-panel'
                : 'p2p-hidden-price-card p2p-price-ratio-card p2p-order-market-panel'
            }
            onClick={() => toggleTradeRateDirection(trade.tradeId, trade.escrowContract)}
            title={priceRatioDisplay?.toggleTitle ?? 'Private terms'}
            aria-label={
              priceRatioDisplay?.ariaLabel ?? `Private terms for trade ${trade.tradeId}.`
            }
          >
            <span>Price ratio</span>
            <strong>{tradeRateText}</strong>
          </button>
        ) : null}

        {orderLiquiditySummary ? (
          <div className="p2p-offer-completion p2p-order-detail-band p2p-order-liquidity-summary" aria-label={orderLiquiditySummary.percentLabel}>
            <div className="p2p-offer-completion-head">
              <span>{orderLiquidityLabel}</span>
              <strong>{orderLiquidityHeaderValue}</strong>
            </div>
            <div className="p2p-offer-completion-bar">
              <span style={{ width: `${orderLiquiditySummary.percent}%` }} />
            </div>
            <div className="p2p-offer-completion-meta">
              <span>{orderLiquidityFilledLabel}</span>
              <span>{orderLiquidityRemainingLabel}</span>
            </div>
            {publicLiquidityProgressSummary ? (
              <div className="p2p-offer-completion-flow">
                <span>{orderLiquidityPaymentLabel}</span>
                <strong>{orderLiquidityPaymentValue}</strong>
              </div>
            ) : null}
          </div>
        ) : null}

        {!orderLiquiditySummary ? (
        <div className="p2p-offer-terms p2p-order-detail-band" aria-label={formatTradeListTerms(trade)}>
          <div className={`p2p-offer-term p2p-offer-term-offered ${leftToneClass}`}>
            <span>{leftSideLabel}</span>
            <strong>{formatVisibleTermText(leftSide.asset)}</strong>
            <small className={isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated) ? 'p2p-order-muted-slot' : undefined}>
              {leftMetaLabel}
            </small>
          </div>
          <div className="p2p-offer-term-link" aria-hidden="true">
            →
          </div>
          <div className={`p2p-offer-term p2p-offer-term-requested ${rightToneClass}`}>
            <span>{rightSideLabel}</span>
            <strong>{formatVisibleTermText(rightSide.asset)}</strong>
            <small className={isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated) ? 'p2p-order-muted-slot' : undefined}>
              {rightMetaLabel}
            </small>
          </div>
        </div>
        ) : null}

        {fallbackCompletionSummary ? (
          <div className="p2p-offer-completion" aria-label={fallbackCompletionSummary.percentLabel}>
            <div className="p2p-offer-completion-head">
              <span>Completion</span>
              <strong>{fallbackCompletionSummary.percentLabel}</strong>
            </div>
            <div className="p2p-offer-completion-bar">
              <span style={{ width: `${fallbackCompletionSummary.percent}%` }} />
            </div>
            <div className="p2p-offer-completion-meta">
              <span>{fallbackCompletionSummary.filledLabel}</span>
              <span>{fallbackCompletionSummary.remainingLabel}</span>
            </div>
          </div>
        ) : null}

        {showEmbeddedHistoryDetails && isHiddenLiquidityTerms && privateFillReceiptRows.length > 0 ? (
          <div className="p2p-recurring-private-history p2p-private-order-history" aria-live="polite">
            <div className="p2p-recurring-private-history-head">
              <span>{perspective.isMaker ? 'Private order history' : 'Your private history'}</span>
              <strong>{privateFillReceiptRows.length}</strong>
            </div>
            {privateFillReceiptRows.map((receipt) => (
              <div className="p2p-recurring-private-history-row" key={`${tradeKey}:private-order-fill:${receipt.fillIndex}`}>
                <div>
                  <span>#{receipt.fillIndex}</span>
                  <strong>{receipt.filler ? `Filler ${shortenAddress(receipt.filler)}` : 'Private fill'}</strong>
                </div>
                <div>
                  <span>Offer</span>
                  <strong>{formatPrivateReceiptAmount(trade.offer, receipt.offerAmount)}</strong>
                  <small>Remaining {formatPrivateReceiptAmount(trade.offer, receipt.remainingOfferAmount)}</small>
                </div>
                <div>
                  <span>Payment</span>
                  <strong>{formatPrivateReceiptAmount(trade.request, receipt.requestAmount)}</strong>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {showEmbeddedHistoryDetails && !isHiddenLiquidityTerms && hasWalletFillState && walletFillState ? (
          <div className="p2p-recurring-private-history p2p-private-order-history" aria-live="polite">
            <div className="p2p-recurring-private-history-head">
              <span>Your fill</span>
              <strong>1</strong>
            </div>
            <div className="p2p-recurring-private-history-row">
              <div>
                <span>Fill</span>
                <strong>{trade.status === 'open' ? 'Partial fill' : 'Settled fill'}</strong>
              </div>
              <div>
                <span>You received</span>
                <strong>{formatPrivateReceiptAmount(trade.offer, walletFillState.offerAmountReceived)}</strong>
              </div>
              <div>
                <span>You paid</span>
                <strong>{formatPrivateReceiptAmount(trade.request, walletFillState.requestAmountPaid)}</strong>
              </div>
            </div>
          </div>
        ) : null}

        <div className="p2p-offer-token-actions p2p-order-token-actions" aria-label="Token explorer links">
          <span>Verify tokens</span>
          <div>
            {tokenExplorerLinks.length ? (
              tokenExplorerLinks.map((link) => (
                <a key={link.key} className="p2p-offer-token-link" href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                  {link.label}
                </a>
              ))
            ) : (
              <span className="p2p-token-placeholder p2p-order-muted-slot">Native only</span>
            )}
          </div>
        </div>

        {isFinishedTrade && showEmbeddedHistoryDetails ? (
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
              <div>
                <span>Counterparty</span>
                <strong>{historyCounterpartyLabel}</strong>
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

        <div className="p2p-offer-footer p2p-order-card-footer">
          {isFinishedTrade ? (
            <>
              <div>
                {canOpenTerminal ? (
                  <button
                    type="button"
                    className="p2p-offer-open-btn"
                    onClick={openCardTerminal}
                    title="Open offer terminal"
                    aria-label="Open offer terminal"
                  >
                    <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
                    <span>Open terminal</span>
                  </button>
                ) : (
                  <span className="p2p-offer-final-state">
                    {statusLabel} offer #{trade.tradeId}
                    {acceptedTxExplorerUrl ? ' with on-chain settlement' : ''}
                  </span>
                )}
                {acceptedTxExplorerUrl ? (
                  <a className="p2p-offer-footer-link" href={acceptedTxExplorerUrl} target="_blank" rel="noreferrer">
                    View Tx
                  </a>
                ) : null}
                {shareUrl ? (
                  <button
                    type="button"
                    className={lastCopiedKey === shareKey ? 'p2p-offer-share-btn copied' : 'p2p-offer-share-btn'}
                    onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                    title={accessSecret ? 'Share private trade link' : 'Share trade link'}
                  >
                    {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div>
                {perspective.isMaker && canOpenTerminal ? (
                  <button
                    type="button"
                    className="p2p-offer-manage-btn"
                    onClick={openCardTerminal}
                    title="Open offer terminal"
                    aria-label="Open offer terminal"
                  >
                    <SlidersHorizontal size={14} strokeWidth={2.5} aria-hidden="true" />
                    <span>Manage</span>
                  </button>
                ) : showOpenTradeAction && canOpenTerminal ? (
                  <button
                    type="button"
                    className="p2p-offer-open-btn"
                    onClick={openCardTerminal}
                    title={`Open offer for ${openTradeActionCta.label}`}
                    aria-label={openTradeActionCta.label}
                  >
                    {renderOpenActionCtaContent(openTradeActionCta)}
                  </button>
                ) : null}
                {canRevealDirectTerms ? (
                  <button
                    type="button"
                    className="p2p-offer-counter-btn"
                    onClick={() => revealMakerPrivateProgress(trade).catch(() => {})}
                    disabled={revealingPrivateTradeKey === tradeKey}
                    title="Reveal this Direct OTC offer with your wallet AES key"
                  >
                    {revealingPrivateTradeKey === tradeKey ? 'Revealing...' : 'Reveal terms'}
                  </button>
                ) : null}
                {shareUrl ? (
                  <button
                    type="button"
                    className={lastCopiedKey === shareKey ? 'p2p-offer-share-btn copied' : 'p2p-offer-share-btn'}
                    onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                    title={accessSecret ? 'Share private trade link' : 'Share trade link'}
                  >
                    {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
                  </button>
                ) : null}
                {canCounter ? (
                  <button type="button" className="p2p-offer-counter-btn" onClick={() => beginCounterTrade(trade)}>
                    Counter
                  </button>
                ) : null}
                {showCounterUnavailable ? (
                  <button type="button" className="p2p-offer-counter-btn p2p-offer-disabled-btn" disabled title={counterUnavailableReason}>
                    Counter unavailable
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

  const renderMyTradeList = (trades: TradeSnapshot[], groupId: MyTradeGroupView, emptyLabel: string, emptyState?: ReactNode) => {
    if (!trades.length) {
      return emptyState ?? <p className="standalone-trade-state">{emptyLabel}</p>;
    }

    return (
      <div className="p2p-wallet-inline-workspace">
        <div className="p2p-offer-grid p2p-wallet-trade-grid">
          {trades.map((trade) => {
            const tradeKey = getSnapshotKey(trade);
            const canOpenTerminal = canOpenMyTradeTerminal(trade, groupId);
            return renderTradeOverviewCard(trade, {
              canOpenTerminal,
              groupId,
              onOpenTerminal: openMyTradeTerminal,
              selected: selectedMyTradeDetailKey === tradeKey
            });
          })}
        </div>
      </div>
    );
  };
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
    clearPendingTradeTerminalRoute();
    burnerPinRef.current = '';
    if (sharedWalletActions?.disconnect) {
      setWalletError('');
      setTradeActionError('');
      setWalletMenuOpen(false);
      setAppWalletMenuOpen(false);
      await Promise.resolve(sharedWalletActions.disconnect());
      return;
    }
    await disconnectP2PWallet();
  }, [disconnectP2PWallet, sharedWalletActions]);
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
    compactMobileWallet: isMobileNav,
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
    signAesForCurrentWallet: unlockPrivacyForTradingWallet,
    snapAesStatus: cotiSnapAesStatus,
    walletAddress,
    walletAesHealth: sharedWalletAesHealth,
    walletHasAes,
    walletPrivateTokenPrivacyAction,
    walletMenuOpen
  });
  const tradeWalletHeaderControlRef = useRef(tradeWalletHeaderControl);
  tradeWalletHeaderControlRef.current = tradeWalletHeaderControl;
  const tradeWalletHeaderControlKey = useMemo(
    () =>
      [
        isMobileNav ? 'mobile' : 'desktop',
        walletAddress,
        chainId ?? '',
        connectedWalletLabel,
        connectedWithBurner ? 'app' : 'browser',
        connectingWalletId,
        cotiSnapAesStatus,
        sharedWalletAesHealth?.status ?? '',
        sharedWalletAesHealth?.message ?? '',
        walletHasAes ? 'aes' : 'locked',
        `private-token-${walletPrivateTokenPrivacyAction}`,
        onCotiNetwork ? 'coti' : 'wrong-network',
        preferredWalletOption?.id ?? '',
        selectedWalletId,
        walletMenuOpen ? 'wallet-menu-open' : 'wallet-menu-closed',
        appWalletMenuOpen ? 'app-menu-open' : 'app-menu-closed',
        lastCopiedKey,
        browserWalletOptions.map((option) => option.id).join(','),
        burnerWallets.map((wallet) => `${wallet.id}:${wallet.address}`).join(',')
      ].join('|'),
    [
      appWalletMenuOpen,
      browserWalletOptions,
      burnerWallets,
      chainId,
      connectedWalletLabel,
      connectedWithBurner,
      connectingWalletId,
      cotiSnapAesStatus,
      isMobileNav,
      lastCopiedKey,
      onCotiNetwork,
      preferredWalletOption?.id,
      selectedWalletId,
      sharedWalletAesHealth?.message,
      sharedWalletAesHealth?.status,
      walletAddress,
      walletHasAes,
      walletPrivateTokenPrivacyAction,
      walletMenuOpen
    ]
  );
  useEffect(() => {
    onHeaderWalletControlChange?.(tradeWalletHeaderControlRef.current);
  }, [onHeaderWalletControlChange, tradeWalletHeaderControlKey]);
  useEffect(
    () => () => {
      onHeaderWalletControlChange?.(null);
    },
    [onHeaderWalletControlChange]
  );
  const tradeViewTabs = useMemo(
    () => (
      <nav className="p2p-trade-tabs" aria-label="P2P trade views">
        <button
          type="button"
          className={route.view === 'public' ? 'active' : undefined}
          aria-current={route.view === 'public' ? 'page' : undefined}
          onClick={() => navigateToTradePath('/trades')}
        >
          <span>Desk</span>
        </button>
        <button
          type="button"
          className={route.view === 'create' ? 'active' : undefined}
          aria-current={route.view === 'create' ? 'page' : undefined}
          onClick={startFreshOneOffTrade}
        >
          <span>Create</span>
        </button>
        <button
          type="button"
          className={route.view === 'trade' || route.view === 'counter' ? 'active' : undefined}
          aria-current={route.view === 'trade' || route.view === 'counter' ? 'page' : undefined}
          onClick={() => navigateToTradePath('/trades/open')}
        >
          <span>Terminal</span>
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
    [navigateToTradePath, route.view, startFreshOneOffTrade]
  );
  const publicOpenTrades = useMemo(
    () => publicTrades.filter((trade) => trade.status === 'open'),
    [publicTrades]
  );
  const tradeDeskFilters = useMemo(
    () => ({
      search: tradeSearchInput,
      pair: tradePairFilter,
      type: tradeTypeFilter,
      access: 'all' as const,
      sort: tradeSortMode
    }),
    [tradePairFilter, tradeSearchInput, tradeSortMode, tradeTypeFilter]
  );
  const filteredPublicTrades = useMemo(
    () => filterAndSortTradeDesk(publicOpenTrades, tradeDeskFilters),
    [publicOpenTrades, tradeDeskFilters]
  );
  const filteredMyTrades = useMemo(
    () => filterAndSortTradeDesk(myTrades, tradeDeskFilters),
    [myTrades, tradeDeskFilters]
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
  const canOpenMyTradeTerminal = useCallback((trade: TradeSnapshot, groupId: MyTradeGroupView): boolean => {
    if (!walletKey) {
      return false;
    }
    if (trade.maker.toLowerCase() === walletKey) {
      return true;
    }
    if (groupId === 'received') {
      return true;
    }
    if (groupId === 'history') {
      return trade.walletHasFill || buildTradeTransactionHistoryRows([trade], walletAddress).length > 0;
    }
    return false;
  }, [walletAddress, walletKey]);
  const selectedMyTradeDetail = useMemo(() => {
    if (!selectedMyTradeDetailKey) {
      return null;
    }
    const selectedTrade = selectedMyTradeGroup.trades.find((trade) => getSnapshotKey(trade) === selectedMyTradeDetailKey) ?? null;
    return selectedTrade && canOpenMyTradeTerminal(selectedTrade, selectedMyTradeGroup.id) ? selectedTrade : null;
  }, [canOpenMyTradeTerminal, selectedMyTradeDetailKey, selectedMyTradeGroup.id, selectedMyTradeGroup.trades]);
  useEffect(() => {
    if (!selectedMyTradeDetailKey) {
      return;
    }
    const selectedTrade = selectedMyTradeGroup.trades.find((trade) => getSnapshotKey(trade) === selectedMyTradeDetailKey);
    if (!selectedTrade || !canOpenMyTradeTerminal(selectedTrade, selectedMyTradeGroup.id)) {
      setSelectedMyTradeDetailKey('');
    }
  }, [canOpenMyTradeTerminal, selectedMyTradeDetailKey, selectedMyTradeGroup.id, selectedMyTradeGroup.trades]);
  const openMyTradeTerminal = useCallback((trade: TradeSnapshot) => {
    const groupId = selectedMyTradeGroup.id;
    if (!canOpenMyTradeTerminal(trade, groupId)) {
      return;
    }
    setTradeActionError('');
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setTerminalHistorySheetKey('');
    setSelectedMyTradeDetailKey(getSnapshotKey(trade));
  }, [canOpenMyTradeTerminal, selectedMyTradeGroup.id]);
  const tradePairFilterOptions = useMemo(
    () => getTradePairFilterOptions(route.view === 'mine' ? myTrades : publicOpenTrades),
    [myTrades, publicOpenTrades, route.view]
  );
  const hasActiveDeskFilters =
    tradeSearchInput.trim().length > 0 ||
    tradePairFilter !== 'all' ||
    tradeTypeFilter !== 'all' ||
    tradeSortMode !== 'newest';
  const clearTradeDeskFilters = () => {
    setTradeSearchInput('');
    setTradePairFilter('all');
    setTradeTypeFilter('all');
    setTradeSortMode('newest');
  };
  const showTradeSearch =
    route.view === 'public' || route.view === 'trade' || (route.view === 'mine' && Boolean(walletAddress));
  const tradeSearchPlaceholder =
    route.view === 'mine'
      ? 'Search by token, wallet, status, or id'
      : 'Search offers by pair, token, wallet, or id';
  const tradeSearchSummary =
    route.view === 'mine'
      ? `${selectedMyTradeGroup.trades.length} ${selectedMyTradeGroup.label.toLowerCase()}`
      : `${filteredPublicTrades.length} of ${openPublicTradeCount} offers`;
  const tradeDeskIdentity =
    route.view === 'mine'
      ? {
        title: 'My Desk',
        copy: 'Received, active, countered, and settled offers.'
      }
      : {
          title: 'P2P OTC Desk',
          copy: 'Peer-priced escrow offers between wallets.'
        };
  const myTradeTerminalOpen = route.view === 'mine' && Boolean(selectedMyTradeDetail);
  const terminalPanelOpen = route.view === 'trade' || myTradeTerminalOpen;
  const terminalPanelTrade = route.view === 'mine' ? selectedMyTradeDetail : detailTrade;
  useEffect(() => {
    const recurring = terminalPanelTrade?.recurringOrder;
    if (!terminalPanelTrade || !recurring || recurring.mode !== 'public' || !walletKey || recurring.executionCount <= 0) {
      return;
    }

    const hydrationKey = [
      getSnapshotKey(terminalPanelTrade),
      walletKey,
      recurring.executionCount,
      recurring.publicExecutions?.length ?? 'unread'
    ].join(':');
    if (terminalPublicRecurringHistoryHydrationRef.current[hydrationKey]) {
      return;
    }
    terminalPublicRecurringHistoryHydrationRef.current[hydrationKey] = true;

    let cancelled = false;
    enrichMakerPrivateProgress(terminalPanelTrade, false)
      .then((enrichedSnapshot) => {
        if (cancelled || !enrichedSnapshot.recurringOrder) {
          return;
        }
        const enrichedRecurring = enrichedSnapshot.recurringOrder;
        if (
          enrichedRecurring.publicExecutions !== recurring.publicExecutions ||
          Boolean(enrichedSnapshot.walletHasFill) !== Boolean(terminalPanelTrade.walletHasFill)
        ) {
          mergeTradeSnapshot(enrichedSnapshot);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    enrichMakerPrivateProgress,
    mergeTradeSnapshot,
    terminalPanelTrade,
    walletKey
  ]);
  useEffect(() => {
    const targetTrade =
      route.view === 'mine'
        ? terminalPanelTrade
        : route.view === 'trade' && !tradeAccessBlocked
          ? detailTrade
          : null;
    if (!targetTrade || !walletAddress) {
      return;
    }

    const rowsNeedingTimestamp = buildTradeTransactionHistoryRows([targetTrade], walletAddress).filter(
      (row) =>
        historyTransactionTimestamps[row.key] === undefined &&
        (typeof row.blockNumber === 'number' || Boolean(row.txHash))
    );
    if (!rowsNeedingTimestamp.length) {
      return;
    }

    let cancelled = false;
    loadCotiReadProvider(true)
      .then(async (readProvider) => {
        const blockNumberByRowKey = new Map<string, number>();

        for (const row of rowsNeedingTimestamp) {
          if (typeof row.blockNumber === 'number') {
            blockNumberByRowKey.set(row.key, row.blockNumber);
          }
        }

        await Promise.all(
          rowsNeedingTimestamp.map(async (row) => {
            if (blockNumberByRowKey.has(row.key) || !row.txHash) {
              return;
            }
            const receipt = await readProvider.getTransactionReceipt(row.txHash).catch(() => null);
            if (typeof receipt?.blockNumber === 'number') {
              blockNumberByRowKey.set(row.key, receipt.blockNumber);
            }
          })
        );

        if (blockNumberByRowKey.size === 0) {
          return new Map<string, number>();
        }

        const timestampByBlockNumber = await resolveBlockTimestampMap(readProvider, blockNumberByRowKey.values());
        return new Map(
          Array.from(blockNumberByRowKey.entries())
            .map(([rowKey, blockNumber]) => [rowKey, timestampByBlockNumber.get(blockNumber)] as const)
            .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
        );
      })
      .then((timestampByRowKey) => {
        if (cancelled || !timestampByRowKey || timestampByRowKey.size === 0) {
          return;
        }
        setHistoryTransactionTimestamps((current) => {
          let changed = false;
          const next = { ...current };
          for (const [rowKey, timestamp] of timestampByRowKey.entries()) {
            if (next[rowKey] !== timestamp) {
              next[rowKey] = timestamp;
              changed = true;
            }
          }
          return changed ? next : current;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    detailTrade,
    historyTransactionTimestamps,
    resolveBlockTimestampMap,
    route.view,
    terminalPanelTrade,
    tradeAccessBlocked,
    walletAddress
  ]);
  const closeTerminalPanel = () => {
    if (route.view === 'mine') {
      setSelectedMyTradeDetailKey('');
      return;
    }
    navigateToTradePath('/trades');
  };
  const createdTradeCopyKey = 'created-trade-link';
  const focusTradeLinkInput = () => {
    tradeLinkInputRef.current?.focus();
  };
  const recurringTokenOptions = tradeComposerModel.tradeTokenOptions.filter((option) => !option.value.startsWith('custom'));
  const recurringBaseToken = tradeComposerModel.selectedTradeOfferToken;
  const recurringQuoteToken = tradeComposerModel.selectedTradeRequestToken;
  const recurringHasPrivateToken =
    recurringBaseToken?.kind === 'private-erc20' || recurringQuoteToken?.kind === 'private-erc20';
  const recurringPrivateAmountsHidden = recurringHasPrivateToken && recurringHidePrivateAmounts;
  const recurringPrivacyLabel =
    recurringBaseToken?.kind === 'private-erc20' && recurringQuoteToken?.kind === 'private-erc20'
      ? 'Fully private order'
      : recurringBaseToken?.kind === 'private-erc20' || recurringQuoteToken?.kind === 'private-erc20'
        ? 'Hybrid private order'
        : 'Public order';
  const recurringPrivateAmountCopy =
    !recurringHasPrivateToken
      ? 'Select a private token if this order should use COTI private-token settlement.'
      : recurringPrivateAmountsHidden
        ? 'Public views show the prices, but private-token order size and fill amounts stay hidden.'
        : 'Public views can show the entered order size; private-token transfers and receipts still use COTI privacy.';
  const recurringBaseDecimals = recurringBaseToken?.decimals ?? 18;
  const recurringQuoteDecimals = recurringQuoteToken?.decimals ?? 18;
  const recurringBaseSymbol = recurringBaseToken?.symbol ?? 'base';
  const recurringQuoteSymbol = recurringQuoteToken?.symbol ?? 'quote';
  const recurringBuyReceivePreview = useMemo(
    () =>
      recurringBaseToken && recurringQuoteToken
        ? deriveRecurringReceiveAmountInput({
            side: 'buy',
            liquidityInput: recurringAddBuyBudgetInput,
            priceInput: recurringBuyPriceInput,
            baseDecimals: recurringBaseDecimals,
            quoteDecimals: recurringQuoteDecimals
          })
        : '',
    [
      recurringAddBuyBudgetInput,
      recurringBaseDecimals,
      recurringBaseToken,
      recurringBuyPriceInput,
      recurringQuoteDecimals,
      recurringQuoteToken
    ]
  );
  const recurringSellReceivePreview = useMemo(
    () =>
      recurringBaseToken && recurringQuoteToken
        ? deriveRecurringReceiveAmountInput({
            side: 'sell',
            liquidityInput: recurringAddSellInventoryInput,
            priceInput: recurringSellPriceInput,
            baseDecimals: recurringBaseDecimals,
            quoteDecimals: recurringQuoteDecimals
          })
        : '',
    [
      recurringAddSellInventoryInput,
      recurringBaseDecimals,
      recurringBaseToken,
      recurringQuoteDecimals,
      recurringQuoteToken,
      recurringSellPriceInput
    ]
  );
  const updateRecurringBuyLiquidityInput = useCallback((value: string) => {
    setRecurringBuyReceiveEditable(false);
    setRecurringBuyReceiveInput('');
    setRecurringAddBuyBudgetInput(sanitizeTokenAmountInput(value));
  }, []);
  const updateRecurringSellLiquidityInput = useCallback((value: string) => {
    setRecurringSellReceiveEditable(false);
    setRecurringSellReceiveInput('');
    setRecurringAddSellInventoryInput(sanitizeTokenAmountInput(value));
  }, []);
  const updateRecurringBuyReceiveInput = useCallback(
    (value: string) => {
      const sanitized = sanitizeTokenAmountInput(value);
      setRecurringBuyReceiveInput(sanitized);
      setRecurringAddBuyBudgetInput(
        deriveRecurringLiquidityInputFromReceive({
          side: 'buy',
          receiveInput: sanitized,
          priceInput: recurringBuyPriceInput,
          baseDecimals: recurringBaseDecimals,
          quoteDecimals: recurringQuoteDecimals
        })
      );
    },
    [recurringBaseDecimals, recurringBuyPriceInput, recurringQuoteDecimals]
  );
  const updateRecurringSellReceiveInput = useCallback(
    (value: string) => {
      const sanitized = sanitizeTokenAmountInput(value);
      setRecurringSellReceiveInput(sanitized);
      setRecurringAddSellInventoryInput(
        deriveRecurringLiquidityInputFromReceive({
          side: 'sell',
          receiveInput: sanitized,
          priceInput: recurringSellPriceInput,
          baseDecimals: recurringBaseDecimals,
          quoteDecimals: recurringQuoteDecimals
        })
      );
    },
    [recurringBaseDecimals, recurringQuoteDecimals, recurringSellPriceInput]
  );
  const toggleRecurringBuyReceiveEditable = useCallback(() => {
    if (recurringBuyReceiveEditable) {
      setRecurringBuyReceiveEditable(false);
      setRecurringBuyReceiveInput('');
      return;
    }
    setRecurringBuyReceiveInput(recurringBuyReceivePreview);
    setRecurringBuyReceiveEditable(true);
  }, [recurringBuyReceiveEditable, recurringBuyReceivePreview]);
  const toggleRecurringSellReceiveEditable = useCallback(() => {
    if (recurringSellReceiveEditable) {
      setRecurringSellReceiveEditable(false);
      setRecurringSellReceiveInput('');
      return;
    }
    setRecurringSellReceiveInput(recurringSellReceivePreview);
    setRecurringSellReceiveEditable(true);
  }, [recurringSellReceiveEditable, recurringSellReceivePreview]);
  useEffect(() => {
    if (!recurringBuyReceiveEditable || !recurringBuyReceiveInput) {
      return;
    }
    setRecurringAddBuyBudgetInput(
      deriveRecurringLiquidityInputFromReceive({
        side: 'buy',
        receiveInput: recurringBuyReceiveInput,
        priceInput: recurringBuyPriceInput,
        baseDecimals: recurringBaseDecimals,
        quoteDecimals: recurringQuoteDecimals
      })
    );
  }, [
    recurringBaseDecimals,
    recurringBuyPriceInput,
    recurringBuyReceiveEditable,
    recurringBuyReceiveInput,
    recurringQuoteDecimals
  ]);
  useEffect(() => {
    if (!recurringSellReceiveEditable || !recurringSellReceiveInput) {
      return;
    }
    setRecurringAddSellInventoryInput(
      deriveRecurringLiquidityInputFromReceive({
        side: 'sell',
        receiveInput: recurringSellReceiveInput,
        priceInput: recurringSellPriceInput,
        baseDecimals: recurringBaseDecimals,
        quoteDecimals: recurringQuoteDecimals
      })
    );
  }, [
    recurringBaseDecimals,
    recurringQuoteDecimals,
    recurringSellPriceInput,
    recurringSellReceiveEditable,
    recurringSellReceiveInput
  ]);
  const editingRecurring = editingRecurringOrder?.recurringOrder ?? null;
  const editingRecurringTradeKey = editingRecurringOrder ? getSnapshotKey(editingRecurringOrder) : '';
  const canRevealEditingRecurringLiquidity =
    Boolean(editingRecurringOrder && editingRecurring && walletKey && editingRecurringOrder.maker.toLowerCase() === walletKey) &&
    editingRecurring?.mode !== 'public' &&
    ((editingRecurring?.baseAsset.kind === 'private-erc20' && editingRecurring.hasPrivateBaseInventory) ||
      (editingRecurring?.quoteAsset.kind === 'private-erc20' && editingRecurring.hasPrivateQuoteInventory));
  const isComposerRoute = route.view === 'create' || route.view === 'counter';
  const isCounterRouteWithoutParent = route.view === 'counter' && !counterParentTrade;

  return (
    <main className={`standalone-trades-shell p2p-trading-shell${terminalPanelOpen ? ' p2p-trading-shell-drawer-open' : ''}`}>
      <div className="p2p-secondary-nav">{tradeViewTabs}</div>
      {!isComposerRoute ? (
        <section
          className={`p2p-market-overview p2p-market-overview-${route.view}${
            route.view === 'mine' && !showTradeSearch ? ' p2p-market-overview-summary-only' : ''
          }`}
        >
          <div className="p2p-market-identity">
            <strong>{tradeDeskIdentity.title}</strong>
            <span>{tradeDeskIdentity.copy}</span>
          </div>

          {route.view === 'public' || route.view === 'trade' || route.view === 'mine' ? (
            <div className="p2p-stats-strip" aria-label="P2P trading statistics">
              {route.view === 'public' || route.view === 'trade' ? (
                <div>
                  <span>Active offers</span>
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
            <div className="p2p-filter-bar" aria-label="Offer filters">
              <label className="p2p-token-search p2p-filter-search">
                <span className="p2p-token-search-head">
                  <span className="p2p-token-search-label">Find offers</span>
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
              <label className="p2p-filter-select p2p-filter-pair">
                <span>Pair</span>
                <select value={tradePairFilter} onChange={(event) => setTradePairFilter(event.target.value)}>
                  {tradePairFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="p2p-filter-select p2p-filter-type">
                <span>Type</span>
                <select
                  value={tradeTypeFilter}
                  onChange={(event) => setTradeTypeFilter(event.target.value as TradeDeskTypeFilter)}
                >
                  <option value="all">All types</option>
                  <option value="one-off">One-off</option>
                  <option value="recurring">Recurring</option>
                  <option value="private">Private</option>
                  <option value="visible">Visible</option>
                </select>
              </label>
              <label className="p2p-filter-select p2p-filter-sort">
                <span>Sort</span>
                <select value={tradeSortMode} onChange={(event) => setTradeSortMode(event.target.value as TradeDeskSortMode)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="expiring">Expiring soon</option>
                  <option value="most-active">Most active</option>
                </select>
              </label>
              <button
                type="button"
                className="p2p-filter-clear"
                onClick={clearTradeDeskFilters}
                disabled={!hasActiveDeskFilters}
              >
                Reset
              </button>
            </div>
          ) : null}

          {walletError || tradeActionError ? <p className="error p2p-market-status">{walletError || tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'public' || route.view === 'trade' ? (
        <section className="standalone-trades-section p2p-public-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">P2P OTC</p>
              <h2>Active offers</h2>
            </div>
            <div className="standalone-trades-toolbar">
              <button type="button" className="standalone-trade-secondary-btn" onClick={() => refreshPublicTrades().catch(() => {})}>
                {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {publicTradesError
            ? renderP2PEmptyState(
              'Desk refresh failed',
              publicTradesError,
              <button type="button" onClick={() => refreshPublicTrades().catch(() => {})} disabled={loadingPublicTrades}>
                {loadingPublicTrades ? 'Refreshing...' : 'Retry'}
              </button>,
              'error'
            )
            : null}
          {loadingPublicTrades && publicTrades.length === 0
            ? renderP2PEmptyState(
              'Loading offers',
              'Reading open offers from escrow events.',
              undefined,
              'loading'
            )
            : null}
          {(!publicTradesError || publicTrades.length > 0) && (!loadingPublicTrades || publicTrades.length > 0)
            ? renderTradeList(
              filteredPublicTrades,
              hasActiveDeskFilters ? 'No offers match those filters.' : 'No active offers found.',
              'p2p-public-trade-grid',
              renderP2PEmptyState(
                hasActiveDeskFilters ? 'No matching offers' : 'No active offers right now',
                hasActiveDeskFilters
                  ? 'Clear filters or try another token, wallet, status, or trade id.'
                  : 'The desk is live, but there are no public offers to review yet.',
                hasActiveDeskFilters ? (
                  <>
                    <button type="button" onClick={clearTradeDeskFilters}>
                      Clear filters
                    </button>
                    <button type="button" onClick={() => refreshPublicTrades().catch(() => {})} disabled={loadingPublicTrades}>
                      {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={startFreshOneOffTrade}>
                      Create Offer
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

      {isComposerRoute ? (
        <section className="standalone-trade-create-panel">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">OTC Desk</p>
              <h2>
                {editingTrade
                  ? `Edit public offer #${editingTrade.tradeId}`
                  : counterParentTrade
                    ? `Counter offer #${counterParentTrade.tradeId}`
                  : editingRecurringOrder?.recurringOrder
                    ? `Edit recurring order #${editingRecurringOrder.recurringOrder.orderId}`
                  : tradeCreateMode === 'recurring'
                    ? 'New recurring order'
                    : 'New offer'}
              </h2>
            </div>
            {editingTrade ? (
              <button type="button" className="standalone-trade-secondary-btn" onClick={clearEditTrade}>
                Cancel Edit
              </button>
            ) : null}
            {counterParentTrade ? (
              <div className="standalone-trade-section-actions">
                <button type="button" className="standalone-trade-secondary-btn" onClick={() => openTradeSnapshot(counterParentTrade)}>
                  Back to Parent
                </button>
                <button type="button" className="standalone-trade-secondary-btn" onClick={cancelCounterCreate}>
                  Cancel Counter
                </button>
              </div>
            ) : null}
            {editingRecurringOrder ? (
              <button type="button" className="standalone-trade-secondary-btn" onClick={clearRecurringEdit}>
                Cancel Edit
              </button>
            ) : null}
          </div>
          {isCounterRouteWithoutParent
            ? renderP2PEmptyState(
                'Choose an offer to counter',
                'Open a trade in the trading terminal or from the desk, then choose Counter to compose a direct counter-offer.',
                <>
                  <button type="button" onClick={() => navigateToTradePath('/trades/open')}>
                    Trading Terminal
                  </button>
                  <button type="button" onClick={() => navigateToTradePath('/trades')}>
                    Open Desk
                  </button>
                </>
              )
            : null}
          {!isCounterRouteWithoutParent && !editingTrade && !editingRecurringOrder && !counterParentTrade ? (
            <div className="standalone-trade-visibility p2p-create-mode-switch" role="group" aria-label="Order type">
              <button
                type="button"
                className={tradeCreateMode === 'one-off' ? 'active' : undefined}
                onClick={() => setTradeCreateMode('one-off')}
                aria-pressed={tradeCreateMode === 'one-off'}
              >
                <span>One-off</span>
                <small>Fixed escrow offer</small>
              </button>
              <button
                type="button"
                className={tradeCreateMode === 'recurring' ? 'active' : undefined}
                onClick={startFreshRecurringOrder}
                aria-pressed={tradeCreateMode === 'recurring'}
              >
                <span>Recurring</span>
                <small>Reusable desk</small>
              </button>
            </div>
          ) : null}
          {!isCounterRouteWithoutParent ? (tradeCreateMode === 'recurring' && !editingTrade && !counterParentTrade ? (
            <>
              <div className="trade-compose-panel p2p-recurring-builder" role="group" aria-label="Recurring OTC order">
                <div className="trade-compose-header p2p-recurring-header">
                  <strong>Reusable OTC order</strong>
                  <div className="trade-compose-header-meta">
                    <span>{recurringPrivacyLabel}</span>
                    <a
                      className="trade-compose-header-link"
                      href={`${COTI_NETWORK.blockExplorerUrl}/address/${tradeFeeEscrowContract}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${tradeFeeEscrowContractTitleLabel}`}
                    >
                      {tradeFeeEscrowContractLabel}
                    </a>
                  </div>
                </div>

                <div className="p2p-recurring-grid p2p-recurring-assets">
                  <label className="trade-compose-field">
                    <span>Base asset</span>
                    <TradeTokenSelect
                      options={recurringTokenOptions}
                      value={tradeOfferTokenSelection}
                      onChange={(value) => setTradeOfferTokenSelection(value as TradeTokenPresetKey)}
                      disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
                    />
                  </label>
                  <label className="trade-compose-field">
                    <span>Quote asset</span>
                    <TradeTokenSelect
                      options={recurringTokenOptions}
                      value={tradeRequestTokenSelection}
                      onChange={(value) => setTradeRequestTokenSelection(value as TradeTokenPresetKey)}
                      disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
                    />
                  </label>
                </div>

                <div className={`p2p-recurring-privacy-note${recurringHasPrivateToken ? ' is-private' : ''}`}>
                  <div>
                    <span>Order privacy</span>
                    <strong>
                      {recurringHasPrivateToken
                        ? recurringPrivateAmountsHidden
                          ? 'Private-token amounts hidden'
                          : 'Private-token amounts visible'
                        : 'Public amounts visible'}
                    </strong>
                  </div>
                  <p>{recurringPrivateAmountCopy}</p>
                  {recurringHasPrivateToken ? (
                    <div
                      className="p2p-recurring-privacy-toggle"
                      role="group"
                      aria-label="Private-token amount visibility"
                    >
                      <button
                        type="button"
                        className={recurringHidePrivateAmounts ? 'active' : undefined}
                        onClick={() => setRecurringHidePrivateAmounts(true)}
                        aria-pressed={recurringHidePrivateAmounts}
                        disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
                      >
                        Hide amount
                      </button>
                      <button
                        type="button"
                        className={!recurringHidePrivateAmounts ? 'active' : undefined}
                        onClick={() => setRecurringHidePrivateAmounts(false)}
                        aria-pressed={!recurringHidePrivateAmounts}
                        disabled={creatingRecurringOrder || Boolean(editingRecurringOrder)}
                      >
                        Show amount
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="trade-compose-grid p2p-recurring-side-grid">
                  <section className="trade-compose-section trade-compose-section-buy p2p-recurring-side-panel p2p-recurring-side-panel-buy">
                    <div className="p2p-recurring-side-head">
                      <span>Buy side</span>
                      <strong>Maker buys {recurringBaseToken?.symbol ?? 'base'}</strong>
                      <small>
                        {editingRecurringOrder
                          ? 'Edit the buy price. Liquidity is managed below.'
                          : 'Set the maker buy price. Liquidity is managed below.'}
                      </small>
                    </div>
                    <label className="trade-compose-field p2p-recurring-price-field">
                      <span>Buy price</span>
                      <input
                        className="trade-compose-input"
                        type="text"
                        inputMode="decimal"
                        value={recurringBuyPriceInput}
                        onChange={(event) => updateRecurringBuyPriceInput(event.target.value)}
                        placeholder={`${recurringQuoteToken?.symbol ?? 'quote'} per ${recurringBaseToken?.symbol ?? 'base'}`}
                        disabled={creatingRecurringOrder}
                      />
                    </label>
                    {!editingRecurringOrder ? (
                      <>
                        <label className="trade-compose-field p2p-recurring-primary-field">
                          <span>Buy liquidity</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringAddBuyBudgetInput}
                            onChange={(event) => updateRecurringBuyLiquidityInput(event.target.value)}
                            placeholder={`0 ${recurringQuoteSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label
                          className={`trade-compose-field p2p-recurring-derived-field${
                            recurringBuyReceiveEditable ? ' is-editing' : ''
                          }`}
                        >
                          <span className="trade-compose-field-head">
                            <span>You receive</span>
                            <button
                              type="button"
                              className="p2p-recurring-derived-toggle"
                              onClick={toggleRecurringBuyReceiveEditable}
                              aria-label={recurringBuyReceiveEditable ? 'Preview buy receive' : 'Edit buy receive'}
                              disabled={creatingRecurringOrder}
                            >
                              {recurringBuyReceiveEditable ? 'Preview' : 'Edit'}
                            </button>
                          </span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringBuyReceiveEditable ? recurringBuyReceiveInput : recurringBuyReceivePreview}
                            onChange={(event) => updateRecurringBuyReceiveInput(event.target.value)}
                            placeholder={`Estimated ${recurringBaseSymbol}`}
                            readOnly={!recurringBuyReceiveEditable}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                      </>
                    ) : null}
                  </section>

                  <div className="p2p-recurring-cycle-indicator" title="Inventory cycles between sides">
                    <RecurringCycleIcon />
                  </div>

                  <section className="trade-compose-section trade-compose-section-sell p2p-recurring-side-panel p2p-recurring-side-panel-sell">
                    <div className="p2p-recurring-side-head">
                      <span>Sell side</span>
                      <strong>Maker sells {recurringBaseToken?.symbol ?? 'base'}</strong>
                      <small>
                        {editingRecurringOrder
                          ? 'Edit the sell price. Liquidity is managed below.'
                          : 'Set the maker sell price. Liquidity is managed below.'}
                      </small>
                    </div>
                    <label className="trade-compose-field p2p-recurring-price-field">
                      <span>Sell price</span>
                      <input
                        className="trade-compose-input"
                        type="text"
                        inputMode="decimal"
                        value={recurringSellPriceInput}
                        onChange={(event) => updateRecurringSellPriceInput(event.target.value)}
                        placeholder={`${recurringQuoteToken?.symbol ?? 'quote'} per ${recurringBaseToken?.symbol ?? 'base'}`}
                        disabled={creatingRecurringOrder}
                      />
                    </label>
                    {!editingRecurringOrder ? (
                      <>
                        <label className="trade-compose-field p2p-recurring-primary-field">
                          <span>Sell liquidity</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringAddSellInventoryInput}
                            onChange={(event) => updateRecurringSellLiquidityInput(event.target.value)}
                            placeholder={`0 ${recurringBaseSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label
                          className={`trade-compose-field p2p-recurring-derived-field${
                            recurringSellReceiveEditable ? ' is-editing' : ''
                          }`}
                        >
                          <span className="trade-compose-field-head">
                            <span>You receive</span>
                            <button
                              type="button"
                              className="p2p-recurring-derived-toggle"
                              onClick={toggleRecurringSellReceiveEditable}
                              aria-label={recurringSellReceiveEditable ? 'Preview sell receive' : 'Edit sell receive'}
                              disabled={creatingRecurringOrder}
                            >
                              {recurringSellReceiveEditable ? 'Preview' : 'Edit'}
                            </button>
                          </span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringSellReceiveEditable ? recurringSellReceiveInput : recurringSellReceivePreview}
                            onChange={(event) => updateRecurringSellReceiveInput(event.target.value)}
                            placeholder={`Estimated ${recurringQuoteSymbol}`}
                            readOnly={!recurringSellReceiveEditable}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                      </>
                    ) : null}
                  </section>
                </div>

                {editingRecurringOrder ? (
                  <div className="p2p-recurring-edit-liquidity">
                    <div className="p2p-recurring-edit-liquidity-head">
                      <div>
                        <span>Live liquidity</span>
                        <strong>Edit funding without changing this order link.</strong>
                      </div>
                      {canRevealEditingRecurringLiquidity ? (
                        <button
                          type="button"
                          className="standalone-trade-secondary-btn"
                          onClick={() => revealMakerPrivateProgress(editingRecurringOrder).catch(() => {})}
                          disabled={revealingPrivateTradeKey === editingRecurringTradeKey}
                        >
                          {revealingPrivateTradeKey === editingRecurringTradeKey ? 'Revealing...' : 'Reveal Liquidity'}
                        </button>
                      ) : null}
                    </div>
                    <div className="p2p-recurring-grid p2p-recurring-assets p2p-recurring-add-funds">
                      <section className="p2p-recurring-liquidity-edit-card">
                        <div>
                          <span>Sell liquidity</span>
                          <strong>{formatRecurringLiveLiquidityAmount(editingRecurringOrder, 'sell')}</strong>
                        </div>
                        <label className="trade-compose-field">
                          <span>Add</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringAddSellInventoryInput}
                            onChange={(event) => updateRecurringSellLiquidityInput(event.target.value)}
                            placeholder={`0 ${recurringBaseSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label
                          className={`trade-compose-field p2p-recurring-derived-field${
                            recurringSellReceiveEditable ? ' is-editing' : ''
                          }`}
                        >
                          <span className="trade-compose-field-head">
                            <span>You receive</span>
                            <button
                              type="button"
                              className="p2p-recurring-derived-toggle"
                              onClick={toggleRecurringSellReceiveEditable}
                              aria-label={recurringSellReceiveEditable ? 'Preview sell receive' : 'Edit sell receive'}
                              disabled={creatingRecurringOrder}
                            >
                              {recurringSellReceiveEditable ? 'Preview' : 'Edit'}
                            </button>
                          </span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringSellReceiveEditable ? recurringSellReceiveInput : recurringSellReceivePreview}
                            onChange={(event) => updateRecurringSellReceiveInput(event.target.value)}
                            placeholder={`Estimated ${recurringQuoteSymbol}`}
                            readOnly={!recurringSellReceiveEditable}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label className="trade-compose-field">
                          <span>Remove</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringRemoveSellInventoryInput}
                            onChange={(event) => setRecurringRemoveSellInventoryInput(sanitizeTokenAmountInput(event.target.value))}
                            placeholder={`0 ${recurringBaseSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                      </section>
                      <section className="p2p-recurring-liquidity-edit-card">
                        <div>
                          <span>Buy liquidity</span>
                          <strong>{formatRecurringLiveLiquidityAmount(editingRecurringOrder, 'buy')}</strong>
                        </div>
                        <label className="trade-compose-field">
                          <span>Add</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringAddBuyBudgetInput}
                            onChange={(event) => updateRecurringBuyLiquidityInput(event.target.value)}
                            placeholder={`0 ${recurringQuoteSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label
                          className={`trade-compose-field p2p-recurring-derived-field${
                            recurringBuyReceiveEditable ? ' is-editing' : ''
                          }`}
                        >
                          <span className="trade-compose-field-head">
                            <span>You receive</span>
                            <button
                              type="button"
                              className="p2p-recurring-derived-toggle"
                              onClick={toggleRecurringBuyReceiveEditable}
                              aria-label={recurringBuyReceiveEditable ? 'Preview buy receive' : 'Edit buy receive'}
                              disabled={creatingRecurringOrder}
                            >
                              {recurringBuyReceiveEditable ? 'Preview' : 'Edit'}
                            </button>
                          </span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringBuyReceiveEditable ? recurringBuyReceiveInput : recurringBuyReceivePreview}
                            onChange={(event) => updateRecurringBuyReceiveInput(event.target.value)}
                            placeholder={`Estimated ${recurringBaseSymbol}`}
                            readOnly={!recurringBuyReceiveEditable}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                        <label className="trade-compose-field">
                          <span>Remove</span>
                          <input
                            className="trade-compose-input"
                            type="text"
                            inputMode="decimal"
                            value={recurringRemoveBuyBudgetInput}
                            onChange={(event) => setRecurringRemoveBuyBudgetInput(sanitizeTokenAmountInput(event.target.value))}
                            placeholder={`0 ${recurringQuoteSymbol}`}
                            disabled={creatingRecurringOrder}
                          />
                        </label>
                      </section>
                    </div>
                  </div>
                ) : null}

                <div className="p2p-recurring-fill-handling">
                  <span>Funding and fills</span>
                  <p>
                    Liquidity stays in this order and cycles between sides. Closing the order returns remaining funds to the maker.
                  </p>
                </div>

                <div className="trade-compose-bottom p2p-recurring-actions">
                  <p>
                    {editingRecurringOrder
                      ? 'Save prices and liquidity changes without changing the link.'
                      : 'Set buy and sell prices, then fund buy liquidity, sell liquidity, or both.'}
                  </p>
                  <button type="button" onClick={() => createRecurringOrder().catch(() => {})} disabled={creatingRecurringOrder}>
                    {creatingRecurringOrder
                      ? editingRecurringOrder
                        ? 'Saving...'
                        : 'Creating...'
                      : editingRecurringOrder
                        ? 'Save Recurring Order'
                        : 'Create Recurring Order'}
                  </button>
                </div>
                <div className="trade-compose-warning">
                  <p>
                    <strong>P2P OTC check:</strong> Buy and sell prices are independent. Same-price orders only happen when you enter the same price.
                  </p>
                </div>
              </div>
              {createdRecurringOrderLink ? (
                <div className="standalone-trade-created">
                  <div>
                    <span>Recurring order #{createdRecurringOrderId}</span>
                    <strong>{createdRecurringOrderLink.replace(/^https?:\/\//, '')}</strong>
                  </div>
                  <button
                    type="button"
                    className={lastCopiedKey === 'created-recurring-order-link' ? 'copied' : undefined}
                    onClick={() => copyWithFeedback(createdRecurringOrderLink, 'created-recurring-order-link').catch(() => {})}
                  >
                    {lastCopiedKey === 'created-recurring-order-link' ? 'Shared' : 'Share Link'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
          {counterParentTrade ? renderCounterParentSummary(counterParentTrade) : null}
          {!counterParentTrade ? (
          <div className="standalone-trade-options">
            {!editingTrade && !counterParentTrade ? (
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
                  ? 'Visible on the desk while open'
                  : tradeVisibility === 'direct'
                    ? directTradeRecipientIsValid
                      ? `Sent to ${shortenAddress(directTradeRecipientNormalized)}`
                      : 'Only the recipient can act'
                    : 'Shared link required to accept'}
              </strong>
              <p>
                {editingTrade
                  ? 'Cancels the old public offer and keeps the replacement linked for history.'
                  : tradeVisibility === 'direct'
                  ? 'Direct offers skip the public desk and appear under the recipient wallet received offers.'
                    : tradeVisibility === 'public'
                      ? 'Public offers appear on the desk while open. On-chain terms remain public to contract reads.'
                      : 'Private-link offers stay off the public desk. On-chain terms remain public to contract reads.'}
              </p>
            </div>
          </div>
          ) : null}
          {!editingTrade && !counterParentTrade && tradeVisibility === 'direct' ? (
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
                  ? 'Shared'
                  : tradeVisibility === 'unlisted'
                    ? 'Share Private Link'
                    : tradeVisibility === 'direct'
                      ? 'Share Trade Link'
                      : 'Share Link'}
              </button>
            </div>
          ) : null}
            </>
          )) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {terminalPanelOpen ? (
        <section className="standalone-trades-section standalone-trade-detail-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Trading Terminal</p>
              <h2>{terminalPanelTrade ? 'Review offer' : 'Open trading terminal'}</h2>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={closeTerminalPanel}>
              Close
            </button>
          </div>
          {route.view === 'trade' && !route.tradeId ? (
            <form className="p2p-link-open-form p2p-action-open-form p2p-drawer-open-form" onSubmit={openTradeFromInput}>
              <input
                ref={tradeLinkInputRef}
                type="text"
                value={tradeLinkInput}
                onChange={(event) => setTradeLinkInput(event.target.value)}
                placeholder="Paste offer link, compact code, or id"
                aria-label="Trade link, compact code, or trade id"
              />
              <button type="submit">Open Terminal</button>
            </form>
          ) : null}
          <div className="trade-compose-warning p2p-trade-window-warning" role="alert">
            <p>
              <strong>P2P OTC check:</strong> Verify maker, token contracts, amounts, and price ratio before accepting.
              Escrow enforces settlement, not counterparty reputation.
            </p>
          </div>
          {route.view === 'trade' && createdTradeLink && createdTradeId === route.tradeId ? (
            <div className="standalone-trade-created">
              <div>
                <span>Offer #{createdTradeId}</span>
                <strong>{resolvedRouteAccessSecret ? 'Private link ready' : 'Share link ready'}</strong>
              </div>
              <button
                type="button"
                className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
              >
                {lastCopiedKey === createdTradeCopyKey ? 'Shared' : resolvedRouteAccessSecret ? 'Share Private Link' : 'Share Link'}
              </button>
            </div>
          ) : null}
          {route.view === 'trade' && (route.routeError || detailTradeError)
            ? renderP2PEmptyState(
              routeIsRecurringOrder ? 'Recurring order could not load' : 'Trade could not load',
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
                  Open Desk
                </button>
              </>,
              'error'
            )
            : null}
          {route.view === 'trade' && loadingDetailTrade && !detailTrade
            ? renderP2PEmptyState(
              routeIsRecurringOrder ? 'Reading recurring order' : 'Loading trade',
              routeIsRecurringOrder ? 'Reading reusable buy/sell terms and liquidity.' : 'Reading escrow terms and access rules.',
              undefined,
              'loading'
            )
            : null}
          {route.view === 'trade' && !loadingDetailTrade && tradeAccessBlocked ? (
            renderP2PEmptyState(
              'Private link required',
              'Paste the full shared link, not only the trade id.',
              <>
                <button type="button" onClick={focusTradeLinkInput}>
                  Paste Link
                </button>
                <button type="button" onClick={() => navigateToTradePath('/trades')}>
                  Open Desk
                </button>
              </>,
              'locked'
            )
          ) : null}
          {route.view === 'mine' && terminalPanelTrade ? renderTradeTerminal(terminalPanelTrade) : null}
          {route.view === 'trade' && !tradeAccessBlocked && detailTrade ? renderTradeTerminal(detailTrade) : null}
          {route.view === 'trade' && !loadingDetailTrade && !detailTrade && !tradeAccessBlocked && !route.routeError && !detailTradeError ? (
            renderP2PEmptyState(
              'Open trading terminal',
              'Paste a shared trade link, compact code, or trade id above.',
              <>
                <button type="button" onClick={focusTradeLinkInput}>
                  Paste Link
                </button>
                <button type="button" onClick={() => navigateToTradePath('/trades')}>
                  Open Desk
                </button>
              </>
            )
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'mine' && terminalPanelTrade ? renderTradeTerminalHistoryWindow(terminalPanelTrade) : null}
      {route.view === 'trade' && !tradeAccessBlocked && detailTrade ? renderTradeTerminalHistoryWindow(detailTrade) : null}

      {route.view === 'mine' ? (
        <section className="standalone-trades-section p2p-my-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">OTC Desk</p>
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
              'Received offers, active offers, counters, and history are grouped here once your trading wallet is connected.',
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
              'Checking received offers, active offers, counters, and history.',
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
                {(() => {
                  const emptyState = renderP2PEmptyState(
                    hasActiveDeskFilters ? `No ${selectedMyTradeGroup.label.toLowerCase()} match` : selectedMyTradeGroup.emptyMessage,
                    hasActiveDeskFilters
                      ? 'Clear filters or try another token, wallet, status, or id.'
                      : selectedMyTradeGroup.id === 'received'
                        ? 'Direct and counter offers sent to this wallet will appear here for review.'
                        : selectedMyTradeGroup.id === 'active'
                          ? 'Create a public, private-link, or direct offer to start tracking it here.'
                          : 'Settled, cancelled, declined, and expired trades will collect here.',
                    hasActiveDeskFilters ? (
                      <>
                        <button type="button" onClick={clearTradeDeskFilters}>
                          Clear filters
                        </button>
                        <button type="button" onClick={() => refreshMyTrades().catch(() => {})} disabled={loadingMyTrades}>
                          {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </>
                    ) : selectedMyTradeGroup.id === 'active' ? (
                      <button type="button" onClick={startFreshOneOffTrade}>
                        Create Offer
                      </button>
                    ) : (
                      <button type="button" onClick={() => refreshMyTrades().catch(() => {})} disabled={loadingMyTrades}>
                        {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
                      </button>
                    )
                  );
                  const emptyLabel = hasActiveDeskFilters
                    ? selectedMyTradeGroup.emptySearchMessage
                    : selectedMyTradeGroup.emptyMessage;

                  return renderMyTradeList(selectedMyTradeGroup.trades, selectedMyTradeGroup.id, emptyLabel, emptyState);
                })()}
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="p2p-footer-links">
        <div className="p2p-footer-balances">
          <span>{nativeBalanceWei !== null ? `${formatCotiAmount(nativeBalanceWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : `-- ${TIP_NATIVE_TOKEN_SYMBOL}`}</span>
          <span>{rewardTokenBalanceWei !== null ? `${formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4)} ${rewardTokenSymbol}` : `-- ${rewardTokenSymbol}`}</span>
          <span>{formatPrivateFooterBalance(privateRewardTokenBalanceWei, privateRewardTokenDecimals, privateRewardTokenSymbol, pWispFooterBalanceState)}</span>
          <span>{formatPrivateFooterBalance(hotdogPrivateTokenBalanceWei, hotdogPrivateTokenDecimals, hotdogPrivateTokenSymbol, hotdogPrivateTokenBalanceState)}</span>
        </div>
        <button type="button" className="p2p-footer-contracts-btn" onClick={() => setShowTradingContractsModal(true)}>
          Contracts
        </button>
      </div>
      <TradingContractsModal isOpen={showTradingContractsModal} onClose={() => setShowTradingContractsModal(false)} />
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
