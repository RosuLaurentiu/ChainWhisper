import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { WalletCards } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  BURNER_PIN_MIN_LENGTH,
  buildTradeSnapshotKey,
  getProviderErrorMessage,
  isWalletAddress,
  mergeOnboardInfo,
  normalizeChainId,
  RECURRING_OTC_CONTRACT_ADDRESS,
  shortenAddress,
  type BurnerPinMode,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type TradeFeeModeSelection,
  type TradeSnapshot
} from '../../../lib/appShared';
import { getPreferredBrowserWalletId, saveWalletPreference } from '../../../lib/appStorage';
import {
  buildWalletAesHealthState,
  clearCotiAesUnlockRequest,
  clearFallbackAesSessionOnboardInfo,
  createWalletScopedSnapAesState,
  getOrRecoverAesForWallet,
  readFallbackAesSessionOnboardInfo,
  resetOnboardInfoForFreshAes,
  resetSignerOnboardInfoForFreshAes,
  resolveWalletScopedSnapAesState,
  type WalletScopedSnapAesState
} from '../../../lib/cotiAesUnlock';
import { getCotiSnapAesStatus, type CotiSnapAesStatus } from '../../../lib/cotiSnap';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  PRIVATE_COTI_TOKEN_ADDRESS,
  PRIVATE_GCOTI_TOKEN_ADDRESS,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import { buildTradeComposerAssetBalanceKey } from '../../../lib/tradeComposer';
import {
  invertPriceInput,
  type TradePricingField
} from '../../../lib/tradePricing';
import { ensureProviderOnCotiNetwork } from '../../../lib/walletNetwork';
import {
  fetchRecurringExecutionRowsForWallet,
  fetchTradePartialFillEventsForWallet
} from '../../../lib/appChain';
import {
  hasSessionAesKey,
  resolveTradingBrowserWalletState
} from '../../../lib/walletSession';
import useP2PTradeRoute, {
  buildTradeSurfacePath,
  buildTradeTerminalPath,
  type TradeEntryMode
} from '../hooks/useP2PTradeRoute';
import useCarbonPairReferences from '../hooks/useCarbonPairReferences';
import useP2PTradeData, { mergeTradeSnapshotEnrichment } from '../hooks/useP2PTradeData';
import useP2PTradeActions from '../hooks/useP2PTradeActions';
import useP2PTradeComposerActions from '../hooks/useP2PTradeComposerActions';
import useP2PRealtimeSync from '../hooks/useP2PRealtimeSync';
import useP2PTradeSigner from '../hooks/useP2PTradeSigner';
import useP2PTradeTokenData from '../hooks/useP2PTradeTokenData';
import useTradeTerminalHistoryHydration from '../hooks/useTradeTerminalHistoryHydration';
import useTradeDeskLists from '../hooks/useTradeDeskLists';
import useP2PTradeAgentSession from '../hooks/useP2PTradeAgentSession';
import useP2PTradeAgentActions from '../hooks/useP2PTradeAgentActions';
import useP2PAppHelp from '../hooks/useP2PAppHelp';
import useP2PActionFeedback from '../hooks/useP2PActionFeedback';
import useP2PTradeAccessMemory from '../hooks/useP2PTradeAccessMemory';
import useP2PTradeDeskNavigation from '../hooks/useP2PTradeDeskNavigation';
import useP2PTradeWalletPromptFlow from '../hooks/useP2PTradeWalletPromptFlow';
import useP2PRecurringOrderActions from '../hooks/useP2PRecurringOrderActions';
import useTradeDeskViewModel from '../hooks/useTradeDeskViewModel';
import useOtcSwapQuoteState from '../hooks/useOtcSwapQuoteState';
import useOtcSwapPairSelections from '../hooks/useOtcSwapPairSelections';
import useOtcSwapReviewState from '../hooks/useOtcSwapReviewState';
import useOtcSwapRouteActions from '../hooks/useOtcSwapRouteActions';
import useP2PTradeTerminalRouteEffects from '../hooks/useP2PTradeTerminalRouteEffects';
import useP2PTradingBalances from '../hooks/useP2PTradingBalances';
import useP2PTradeComposerModel from '../hooks/useP2PTradeComposerModel';
import useP2PRecurringReceiveInputs from '../hooks/useP2PRecurringReceiveInputs';
import useP2PSyncQueue from '../hooks/useP2PSyncQueue';
import useP2PBurnerWalletConnection from '../hooks/useP2PBurnerWalletConnection';
import useP2PTradeFundingPreflight from '../hooks/useP2PTradeFundingPreflight';
import useP2PPrivateTradeEnrichment from '../hooks/useP2PPrivateTradeEnrichment';
import useP2PTradeEntryNavigation from '../hooks/useP2PTradeEntryNavigation';
import useTerminalAssetBalanceLabel from '../hooks/useTerminalAssetBalanceLabel';
import useTradePricingSync from '../hooks/useTradePricingSync';
import useRecurringOrderSideSwap from '../hooks/useRecurringOrderSideSwap';
import useTradeTerminalLinkActions from '../hooks/useTradeTerminalLinkActions';
import useTradeDeskSelectionActions from '../hooks/useTradeDeskSelectionActions';
import useCloseTradeTerminalPanel from '../hooks/useCloseTradeTerminalPanel';
import useBlockTimestampCache from '../../../shared/hooks/useBlockTimestampCache';
import { useStoredWalletPreference } from '../../wallet/hooks/useStoredWalletPreference';
import {
  buildWalletReadAccountsKey,
  getTradeAccountPerspectiveAddress,
  getWalletActionAccount,
  getWalletOwnerAccount,
  resolveTradeActionWalletAddress as resolveTradeActionWalletAddressForScope,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import { type OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import {
  loadOtcSwapFillNotes,
  type OtcSwapFillNote,
  type OtcSwapIntent
} from '../../../lib/otcSwapIntent';
import {
  canUseTradeAgentAction,
  getTradeAgentActionButtonLabel,
  getTradeAgentActionCta,
  getTradeAgentActionDescription
} from '../../../lib/tradeAgent';
import { getAppHelpReadinessTopicId, type AppHelpReason } from '../../../lib/appHelpLaunch';
import {
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage
} from '../../../lib/walletTransactionFlow';
import OtcSwapPanel from './OtcSwapPanel';
import {
  canEditPublicTrade,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms,
  getSnapshotKey,
  readInitialTradeBrowserWalletId,
  type RecurringTerminalActionSide,
  type TradeDeskSortMode,
  type TradeDeskTypeFilter
} from '../../../lib/p2pTradeView';
import {
  buildLinkedTradeContext,
  resolveTradeChatTarget
} from '../../../lib/linkedTradeContext';
import BurnerImportModal from '../../wallet/components/BurnerImportModal';
import BurnerPinModal from '../../wallet/components/BurnerPinModal';
import TradeAccessSettings from './TradeAccessSettings';
import TradeActionConfirmModal from './TradeActionConfirmModal';
import TradeAgentPanel from './TradeAgentPanel';
import TradeCounterParentSummary from './TradeCounterParentSummary';
import { TradeEntryModeTabs, TradeViewTabs } from './TradeDeskTabs';
import TradeMarketOverviewPanel from './TradeMarketOverviewPanel';
import TradeMyTradesSection from './TradeMyTradesSection';
import {
  type TradeOrderCardProps
} from './TradeOrderLists';
import TradePublicOffersSection from './TradePublicOffersSection';
import TradeRecurringComposerPanel from './TradeRecurringComposerPanel';
import {
  TradeTerminalHistoryRenderer,
  TradeTerminalRenderer,
  type TradeTerminalRendererProps
} from './TradeTerminalRenderer';
import {
  TradeCreatedLinkPanel,
  TradeTerminalCreatedNotice,
  TradeTerminalOpenPanel,
  TradeTerminalRouteStatus,
  TradeTerminalSafetyWarning
} from './TradeTerminalDrawerPanels';
import TradingBalancesSheet, { TradingBalanceDock } from './TradingBalancesSheet';
import TradingContractsModal from './TradingContractsModal';
import TradeComposerPanel from './TradeComposerPanel';
import {
  resolveTerminalHistoryMergeWalletKey,
  resolveTerminalHistoryWallet,
  type TerminalHistoryConfigParams
} from './tradeTerminalHistoryConfig';

import {
  EMPTY_STALE_TOKEN_ADDRESSES,
  OPEN_TERMINAL_LABEL,
  buildMakerControlsKey,
  mergeOnboardInfoByAddress,
  onboardInfoEqual,
  renderP2PEmptyState,
  type MakerControlsSurface,
  type MyTradeGroupView,
  type P2PTradingPageProps,
  type PendingBurnerWalletAction,
  type TerminalFillInputSide,
  type TerminalReturnSurface,
  type TradeCreateMode,
  type TradeFilterRouteScope,
  type TradeSigner,
  type TradeVisibility
} from './P2PTradingPage.helpers';
export default function P2PTradingPage({
  isMobileNav = false,
  sharedWalletSession,
  appHelpLaunchContext,
  onAppHelpLaunchConsumed,
  onOpenAppHelp,
  onOpenTradeConversation
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
    () => initialSharedBrowserWallet?.browserWalletLabel || (initialSharedAppWallet ? 'ChainWhisper account' : 'Wallet')
  );
  const [, setBurnerWallets] = useState<BurnerWalletRecord[]>(
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
  const [onboardInfoByAddress, setOnboardInfoByAddress] = useState<Record<string, OnboardInfo>>(
    () => sharedWalletSession?.sessionOnboardInfo ?? {}
  );
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeCreateMode, setTradeCreateMode] = useState<TradeCreateMode>('one-off');
  const [tradeVisibility, setTradeVisibility] = useState<TradeVisibility>('public');
  const [directTradeRecipient, setDirectTradeRecipient] = useState('');
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>(
    PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>(
    PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapSellTokenSelection, setSwapSellTokenSelection] = useState<TradeTokenPresetKey>(
    PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapBuyTokenSelection, setSwapBuyTokenSelection] = useState<TradeTokenPresetKey>(
    PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapSellAmountInput, setSwapSellAmountInput] = useState('');
  const [swapBuyAmountInput, setSwapBuyAmountInput] = useState('');
  const [swapInputMode, setSwapInputMode] = useState<OtcSwapInputMode>('buy');
  const [swapActionMode, setSwapActionMode] = useState<OtcSwapInputMode>('buy');
  const [swapPriceDisplayInverted, setSwapPriceDisplayInverted] = useState(false);
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradePriceInput, setTradePriceInput] = useState('');
  const [tradePricingEditedFields, setTradePricingEditedFields] = useState<TradePricingField[]>([]);
  const [tradeHasNoExpiry, setTradeHasNoExpiry] = useState(false);
  const [recurringBuyPriceInput, setRecurringBuyPriceInput] = useState('');
  const [recurringSellPriceInput, setRecurringSellPriceInput] = useState('');
  const [recurringPriceDisplayInverted, setRecurringPriceDisplayInverted] = useState(false);
  const [recurringHidePrivateAmounts, setRecurringHidePrivateAmounts] = useState(true);
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
  const [tradeHidePrivateLiquidity, setTradeHidePrivateLiquidity] = useState(true);
  const [tradeActionError, setTradeActionError] = useState('');
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [creatingRecurringOrder, setCreatingRecurringOrder] = useState(false);
  const [createdRecurringOrderId, setCreatedRecurringOrderId] = useState<number | null>(null);
  const [createdRecurringOrderLink, setCreatedRecurringOrderLink] = useState('');
  const [recurringBuyFillInput, setRecurringBuyFillInput] = useState('');
  const [recurringSellFillInput, setRecurringSellFillInput] = useState('');
  const [createdTradeId, setCreatedTradeId] = useState<number | null>(null);
  const [createdTradeLink, setCreatedTradeLink] = useState('');
  const [tradeLinkInput, setTradeLinkInput] = useState('');
  const [swapOrderLinkInput, setSwapOrderLinkInput] = useState('');
  const [swapPinnedTradeKey, setSwapPinnedTradeKey] = useState('');
  const [swapOrderLinkError, setSwapOrderLinkError] = useState('');
  const [recurringTerminalSide, setRecurringTerminalSide] = useState<RecurringTerminalActionSide>('buy');
  const [terminalFillInputSide, setTerminalFillInputSide] = useState<TerminalFillInputSide>('pay');
  const [terminalPayInput, setTerminalPayInput] = useState('');
  const [terminalBuyInput, setTerminalBuyInput] = useState('');
  const [terminalHistorySheetKey, setTerminalHistorySheetKey] = useState('');
  const [emptyTerminalDrawerOpen, setEmptyTerminalDrawerOpen] = useState(
    () => route.view === 'trade' && route.tradeId === null
  );
  const [expandedMakerControls, setExpandedMakerControls] = useState<Record<string, boolean>>({});
  const [myTradeGroupView, setMyTradeGroupView] = useState<MyTradeGroupView>('received');
  const [selectedMyTradeDetailKey, setSelectedMyTradeDetailKey] = useState('');
  const [historyTransactionTimestamps, setHistoryTransactionTimestamps] = useState<Record<string, number>>({});
  const [historyLifecycleTxHashes, setHistoryLifecycleTxHashes] = useState<Record<string, string>>({});
  const [historyTransactionTxHashes, setHistoryTransactionTxHashes] = useState<Record<string, string>>({});
  const [swapFillNotes, setSwapFillNotes] = useState<OtcSwapFillNote[]>(() => loadOtcSwapFillNotes());
  const activeTerminalSwapIntentRef = useRef<OtcSwapIntent | null>(null);
  const {
    clearActionNotice,
    copyWithFeedback,
    getTransactionLinkFeedbackProps,
    lastCopiedKey,
    pushActionNotice,
    renderP2PActionNotice,
    requestTradeActionConfirmation,
    resolveTradeActionConfirmation,
    tradeActionConfirmation
  } = useP2PActionFeedback({
    activeTerminalSwapIntentRef,
    setSwapFillNotes
  });
  const lastAppliedSwapPinnedTradeKeyRef = useRef('');
  const lastSyncedRouteSwapTradeKeyRef = useRef('');
  const [reversedRateTradeIds, setReversedRateTradeIds] = useState<Record<string, boolean>>({});
  const initialTerminalReturnSurface: TerminalReturnSurface = route.routeFamily === 'trades' ? 'public' : 'swap';
  const terminalReturnSurfaceRef = useRef<TerminalReturnSurface>(initialTerminalReturnSurface);
  const mobileDeskScrollRef = useRef<Record<TerminalReturnSurface, number>>({ swap: 0, agent: 0, public: 0, mine: 0 });
  const mobileTerminalReturnSurfaceRef = useRef<TerminalReturnSurface>(initialTerminalReturnSurface);
  const [walletScopedSnapAesState, setWalletScopedSnapAesState] = useState<WalletScopedSnapAesState | null>(null);
  const [counterParentTrade, setCounterParentTrade] = useState<TradeSnapshot | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeSnapshot | null>(null);
  const [showTradingContractsModal, setShowTradingContractsModal] = useState(false);
  const [showMobileBalancesSheet, setShowMobileBalancesSheet] = useState(false);
  const [tradingBalancesHidden, setTradingBalancesHidden] = useState(false);

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
  const terminalPrivateHistoryHydrationRef = useRef<Record<string, boolean>>({});
  const terminalPublicStandardHistoryHydrationRef = useRef<Record<string, boolean>>({});
  const terminalPublicRecurringHistoryHydrationRef = useRef<Record<string, boolean>>({});

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
  const effectiveBrowserProvider = tradingBrowserWalletState.browserProvider;
  useEffect(() => {
    if (!tradingBrowserWalletState.usesSharedBrowserWallet) {
      return;
    }
    providerRef.current = effectiveBrowserProvider;
  }, [effectiveBrowserProvider, tradingBrowserWalletState.usesSharedBrowserWallet]);
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const walletKey = walletAddress.trim().toLowerCase();
  const previousWalletKeyRef = useRef(walletKey);
  const activeWalletKeyRef = useRef(walletKey);
  activeWalletKeyRef.current = walletKey;
  const {
    forgetTradeAccessSecret,
    knownPrivateLiquidityByTrade,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret
  } = useP2PTradeAccessMemory({ walletKey });
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
  const walletReadAccounts = useMemo(
    () =>
      sharedWalletSession?.walletReadAccounts?.length
        ? sharedWalletSession.walletReadAccounts
        : walletAddress
          ? [
              {
                address: walletAddress,
                canReadPrivate: walletHasAes,
                isActionAccount: true,
                key: walletKey,
                label: 'ChainWhisper account',
                role: 'chainwhisper' as const
              }
            ]
          : [],
    [sharedWalletSession?.walletReadAccounts, walletAddress, walletHasAes, walletKey]
  );
  const walletReadAccountsKey = useMemo(
    () => buildWalletReadAccountsKey(walletReadAccounts),
    [walletReadAccounts]
  );
  const walletOwnerAccount = useMemo(() => getWalletOwnerAccount(walletReadAccounts), [walletReadAccounts]);
  const ownerWalletAddress = walletOwnerAccount?.address ?? '';
  const ownerWalletKey = walletOwnerAccount?.key ?? '';
  const ownerWalletCanReadPrivate = Boolean(
    walletOwnerAccount?.canReadPrivate && ownerWalletKey && ownerWalletKey !== walletKey
  );
  const {
    knownPrivateLiquidityByTrade: knownOwnerPrivateLiquidityByTrade,
    rememberPrivateTradeLiquidity: rememberOwnerPrivateTradeLiquidity
  } = useP2PTradeAccessMemory({ walletKey: ownerWalletCanReadPrivate ? ownerWalletKey : '' });
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
      setWalletScopedSnapAesState((current) => {
        const next = createWalletScopedSnapAesState({
          provider: effectiveBrowserProvider,
          staleTokenAddresses,
          status,
          walletAddress
        });
        const unchanged =
          current?.sessionKey === next.sessionKey &&
          current.walletKey === next.walletKey &&
          current.status === next.status &&
          current.staleTokenAddresses.length === next.staleTokenAddresses.length &&
          current.staleTokenAddresses.every((address, index) => address === next.staleTokenAddresses[index]);
        return unchanged ? current : next;
      });
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
  const terminalRouteReturnSurface = route.view === 'trade' ? terminalReturnSurfaceRef.current : null;
  const routeSurfaceView = route.view === 'trade' ? terminalRouteReturnSurface : route.view;
  const routeView = route.view;
  const buildCurrentTradeSurfacePath = useCallback(
    (view: Parameters<typeof buildTradeSurfacePath>[0], tradeMode?: TradeEntryMode) =>
      buildTradeSurfacePath(view, route.routeFamily, tradeMode),
    [route.routeFamily]
  );
  const tradeFilterRouteScope: TradeFilterRouteScope =
    routeSurfaceView === 'mine' ? 'mine' : routeSurfaceView === 'public' ? 'desk' : null;
  const previousTradeFilterRouteScopeRef = useRef<TradeFilterRouteScope>(tradeFilterRouteScope);
  useEffect(() => {
    if (route.view === 'trade' && route.tradeId === null) {
      setEmptyTerminalDrawerOpen(true);
      return;
    }
    if (route.view === 'trade' || route.view === 'create' || route.view === 'counter') {
      setEmptyTerminalDrawerOpen(false);
    }
  }, [route.tradeId, route.view]);
  const routeTradeId = route.tradeId;
  const routeEscrowContract = route.escrowContract;
  const routeIsRecurringOrder = routeEscrowContract?.toLowerCase() === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase();
  const routeAccessSecret = route.accessSecret;
  const flushQueuedTradeDataRefreshRef = useRef<() => void>(() => {});
  const storedRouteAccessSecret =
    routeTradeId !== null
      ? resolveKnownTradeAccessSecret(routeTradeId, routeEscrowContract)
      : '';
  const resolvedRouteAccessSecret = routeAccessSecret || storedRouteAccessSecret;
  const routeError = route.routeError;
  const { getTradeWalletFlowInput, runTradeWalletPromptFlow } = useP2PTradeWalletPromptFlow({
    chainId,
    connectedWithBurner,
    effectiveBrowserProvider,
    flushQueuedTradeDataRefreshRef,
    route,
    selectedWalletId,
    sharedBrowserWalletId: sharedWalletSession?.browserWalletId,
    sharedRunWalletTransactionFlow: sharedWalletActions?.runWalletTransactionFlow,
    walletAddress
  });
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
              setWalletError('ChainWhisper account selected. Fund it with COTI to unlock privacy and pay gas.');
            }
            return;
          }

          onboardInfo = await getOrRecoverAesForWallet({
            signer,
            walletAddress: signer.address
          });
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
    const sharedOnboardInfo = sharedWalletSession?.sessionOnboardInfo[sharedWalletKey];
    const mergeSharedOnboardInfo = () => {
      if (!sharedOnboardInfo) {
        return;
      }
      const mergedOnboardInfo = mergeOnboardInfo(onboardInfoByAddress[sharedWalletKey], sharedOnboardInfo);
      if (!onboardInfoEqual(onboardInfoByAddress[sharedWalletKey], mergedOnboardInfo)) {
        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, sharedWalletKey, sharedOnboardInfo)
        );
      }
      signerCacheRef.current[sharedWalletKey]?.setUserOnboardInfo(sharedOnboardInfo);
    };

    if (sharedWalletActionsAvailable && sharedWalletSession?.activeSignerSource === 'metamask') {
      if (sharedAddress) {
        mergeSharedOnboardInfo();
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
      setConnectedWalletLabel('ChainWhisper account');
      setSelectedWalletId('');
      mergeSharedOnboardInfo();
      saveWalletPreference({ kind: 'app' });
      setWalletError('');
    }
  }, [
    connectingWalletId,
    connectedWithBurner,
    getTradeWalletFlowInput,
    onboardInfoByAddress,
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

  const renderTradeConversationButton = useCallback(
    (snapshot: TradeSnapshot, shareUrl?: string, accessSecret?: string): ReactNode => {
      if (!onOpenTradeConversation) {
        return null;
      }

      const target = resolveTradeChatTarget(snapshot, walletKey);
      const isMaker = Boolean(walletKey && snapshot.maker.toLowerCase() === walletKey);
      const label = target
        ? target.role === 'maker'
          ? 'Message maker'
          : 'Message taker'
        : !walletKey
          ? 'Connect wallet'
          : isMaker
            ? 'No peer yet'
            : 'Message unavailable';
      const title = target
        ? `Open chat with ${target.role}`
        : !walletKey
          ? 'Connect a wallet before opening a trade chat.'
          : isMaker
            ? 'This trade has no fixed peer yet. Share the trade link instead.'
            : 'This trade participant is unavailable.';

      return (
        <button
          type="button"
          className="p2p-terminal-share p2p-terminal-message"
          onClick={() => {
            if (!target) {
              return;
            }
            const terminalPath = buildTradeTerminalPath(snapshot.tradeId, accessSecret || undefined, snapshot.escrowContract);
            onOpenTradeConversation(
              target.address,
              buildLinkedTradeContext({
                counterpartyAddress: target.address,
                shareUrl,
                snapshot,
                source: 'terminal',
                terminalPath
              })
            );
          }}
          disabled={!target}
          title={title}
        >
          {label}
        </button>
      );
    },
    [onOpenTradeConversation, walletKey]
  );

  const ensureCotiNetwork = useCallback(async (provider: Eip1193Provider) => {
    await ensureProviderOnCotiNetwork(provider);
  }, []);

  const {
    closeBurnerPinModal,
    submitBurnerImport,
    submitBurnerPin
  } = useP2PBurnerWalletConnection({
    burnerImportInput,
    burnerPinInput,
    burnerPinRef,
    burnerWalletRef,
    effectiveOnboardInfoByAddress,
    markSharedWalletSkippedAfterLocalAppSwitch,
    pendingBurnerAction,
    pendingBurnerWalletId,
    setBurnerPinInput,
    setBurnerPinMode,
    setBurnerWallets,
    setChainId,
    setConnectedWalletLabel,
    setConnectingWalletId,
    setOnboardInfoByAddress,
    setPendingBurnerAction,
    setPendingBurnerWalletId,
    setSelectedBurnerWalletId,
    setSelectedWalletId,
    setShowBurnerImportModal,
    setShowBurnerPinModal,
    setTradeActionError,
    setUnlockingBurner,
    setWalletAddress,
    setWalletError,
    signerCacheRef,
    unlockingBurner
  });

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

  const getTradeSignerForWallet = useCallback(
    async (targetWalletAddress: string, requireAes: boolean): Promise<TradeSigner> => {
      const targetKey = targetWalletAddress.trim().toLowerCase();
      if (!targetKey || targetKey === walletKey) {
        return getTradeSigner(requireAes);
      }

      const ownerAccount = walletReadAccounts.find(
        (account) => account.role === 'owner' && account.key === targetKey
      );
      if (!ownerAccount) {
        throw new Error('This trade action requires a wallet that is not connected.');
      }

      const provider = sharedWalletSession?.browserProvider ?? null;
      if (!provider) {
        throw new Error('Owner wallet is not connected.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        await ensureCotiNetwork(provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const cachedOnboardInfo =
        sharedWalletSession?.sessionOnboardInfo?.[targetKey] ?? onboardInfoByAddress[targetKey];
      let signer = signerCacheRef.current[targetKey] as JsonRpcSigner | undefined;
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(ownerAccount.address, cachedOnboardInfo);
        signer.disableAutoOnboard();
        signerCacheRef.current[targetKey] = signer;
      } else if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }

      signer.disableAutoOnboard();
      if (requireAes && !signer.getUserOnboardInfo()?.aesKey) {
        throw new Error('Owner privacy is locked. Unlock owner privacy before using this owner-targeted trade.');
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, targetKey, onboardInfo)
        );
      }

      return signer;
    },
    [
      chainId,
      ensureCotiNetwork,
      getTradeSigner,
      onboardInfoByAddress,
      sharedWalletSession?.browserProvider,
      sharedWalletSession?.sessionOnboardInfo,
      walletKey,
      walletReadAccounts
    ]
  );

  const getOwnerTradeSigner = useCallback(
    (requireAes: boolean) => getTradeSignerForWallet(ownerWalletAddress, requireAes),
    [getTradeSignerForWallet, ownerWalletAddress]
  );

  const { enrichMakerPrivateProgress: enrichActiveMakerPrivateProgress } = useP2PPrivateTradeEnrichment({
    getTradeSigner,
    knownPrivateLiquidityByTrade,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    walletAddress,
    walletHasAes,
    walletKey
  });

  const { enrichMakerPrivateProgress: enrichOwnerMakerPrivateProgress } = useP2PPrivateTradeEnrichment({
    getTradeSigner: getOwnerTradeSigner,
    knownPrivateLiquidityByTrade: knownOwnerPrivateLiquidityByTrade,
    rememberPrivateTradeLiquidity: rememberOwnerPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    walletAddress: ownerWalletAddress,
    walletHasAes: ownerWalletCanReadPrivate,
    walletKey: ownerWalletKey
  });

  const actionWalletAccount = useMemo(() => getWalletActionAccount(walletReadAccounts), [walletReadAccounts]);
  const resolvePrivateReadAccount = useCallback(
    (snapshot: TradeSnapshot, account?: WalletReadAccount): WalletReadAccount | null => {
      if (account) {
        return account;
      }

      const perspectiveAddress = resolveTerminalHistoryWallet(snapshot, { walletAddress, walletReadAccounts }).walletAddress ||
        getTradeAccountPerspectiveAddress(snapshot, {
          actionAccount: actionWalletAccount,
          ownerAccount: walletOwnerAccount
        });
      const perspectiveKey = perspectiveAddress.trim().toLowerCase();
      if (ownerWalletKey && perspectiveKey === ownerWalletKey) {
        return walletOwnerAccount ?? null;
      }
      if (walletKey && perspectiveKey === walletKey) {
        return actionWalletAccount;
      }
      return actionWalletAccount ?? walletOwnerAccount ?? null;
    },
    [actionWalletAccount, ownerWalletKey, walletAddress, walletKey, walletOwnerAccount, walletReadAccounts]
  );
  const enrichMakerPrivateProgress = useCallback(
    (snapshot: TradeSnapshot, forceReveal = false, account?: WalletReadAccount): Promise<TradeSnapshot> => {
      const privateReadAccount = resolvePrivateReadAccount(snapshot, account);
      const attachReadAccount = (enrichedSnapshot: TradeSnapshot): TradeSnapshot => {
        if (!privateReadAccount) {
          return enrichedSnapshot;
        }
        const accountMatch = {
          address: privateReadAccount.address,
          role: privateReadAccount.role
        };
        return {
          ...enrichedSnapshot,
          accountAddress: privateReadAccount.address,
          accountRole: privateReadAccount.role,
          accountMatches: [
            ...(enrichedSnapshot.accountMatches ?? []).filter(
              (match) => match.address.toLowerCase() !== privateReadAccount.key
            ),
            accountMatch
          ]
        };
      };
      if (
        privateReadAccount?.key === ownerWalletKey &&
        ownerWalletKey !== walletKey
      ) {
        return enrichOwnerMakerPrivateProgress(snapshot, forceReveal).then(attachReadAccount);
      }
      return enrichActiveMakerPrivateProgress(snapshot, forceReveal).then(attachReadAccount);
    },
    [
      enrichActiveMakerPrivateProgress,
      enrichOwnerMakerPrivateProgress,
      ownerWalletKey,
      resolvePrivateReadAccount,
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
  const ownerBalanceRefreshSessionKey = useMemo(
    () =>
      [
        ownerWalletKey && ownerWalletKey !== walletKey ? ownerWalletKey : 'no-owner',
        chainId ?? 'no-chain',
        ownerWalletCanReadPrivate ? 'aes' : 'locked'
      ].join(':'),
    [chainId, ownerWalletCanReadPrivate, ownerWalletKey, walletKey]
  );
  const {
    clearWalletBalances: clearOwnerWalletBalances,
    customTradeTokenInfoByAddress: ownerCustomTradeTokenInfoByAddress,
    nativeBalanceWei: ownerNativeBalanceWei,
    privateRewardTokenBalanceState: ownerPrivateRewardTokenBalanceState,
    refreshWalletBalances: refreshOwnerWalletBalances,
    rewardTokenBalanceWei: ownerRewardTokenBalanceWei
  } = useP2PTradeTokenData({
    balanceRefreshSessionKey: ownerBalanceRefreshSessionKey,
    getTradeSigner: getOwnerTradeSigner,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    tradeFeeEscrowContract,
    walletAddress: ownerWalletKey && ownerWalletKey !== walletKey ? ownerWalletAddress : '',
    walletHasAes: ownerWalletCanReadPrivate,
    walletKey: ownerWalletKey && ownerWalletKey !== walletKey ? ownerWalletKey : ''
  });
  const {
    combinedBalanceByAssetKey,
    pWispFooterBalanceState,
    resolveFundingBalanceForAsset,
    visibleTradingBalances
  } = useP2PTradingBalances({
    customTradeTokenInfoByAddress,
    isPrivateTokenSnapStale,
    nativeBalanceWei,
    ownerCustomTradeTokenInfoByAddress,
    ownerNativeBalanceWei,
    ownerPrivateRewardTokenBalanceState,
    ownerRewardTokenBalanceWei,
    ownerWalletCanReadPrivate,
    ownerWalletKey,
    privateRewardTokenBalanceState,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletKey
  });
  useEffect(() => {
    if (!ownerWalletKey || ownerWalletKey === walletKey) {
      clearOwnerWalletBalances();
    }
  }, [clearOwnerWalletBalances, ownerWalletKey, walletKey]);
  const refreshAllTradingBalances = useCallback(
    async (options?: Parameters<typeof refreshWalletBalances>[0]) => {
      await Promise.all([
        refreshWalletBalances(options),
        ownerWalletKey && ownerWalletKey !== walletKey
          ? refreshOwnerWalletBalances(options).catch(() => {})
          : Promise.resolve()
      ]);
    },
    [ownerWalletKey, refreshOwnerWalletBalances, refreshWalletBalances, walletKey]
  );
  const ensureTradeFunding = useP2PTradeFundingPreflight({
    getTradeSignerForWallet,
    ownerWalletAddress,
    ownerWalletKey,
    refreshOwnerWalletBalances,
    refreshWalletBalances,
    requestTradeActionConfirmation,
    resolveFundingBalanceForAsset,
    walletAddress,
    walletKey
  });
  const openTradingContractsModal = useCallback(() => {
    setShowMobileBalancesSheet(false);
    setShowTradingContractsModal(true);
  }, []);

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
      clearFallbackAesSessionOnboardInfo(previousWalletKey);
    }
    if (walletKey) {
      clearCotiAesUnlockRequest(walletKey, provider);
      if (previousWalletKey) {
        clearFallbackAesSessionOnboardInfo(walletKey);
      }
    }
    appWalletAesOnboardingKeyRef.current = '';
    signerCacheRef.current = {};
    setWalletScopedSnapAesState(null);
    clearWalletBalances();
    setCounterParentTrade(null);
    setEditingTrade(null);
    setEditingRecurringOrder(null);
    setSelectedMyTradeDetailKey('');
    setTerminalHistorySheetKey('');
    setExpandedMakerControls({});
    clearActionNotice();
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setHistoryLifecycleTxHashes({});
    setHistoryTransactionTxHashes({});
    setHistoryTransactionTimestamps({});
    terminalPrivateHistoryHydrationRef.current = {};
    terminalPublicStandardHistoryHydrationRef.current = {};
    terminalPublicRecurringHistoryHydrationRef.current = {};
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

  const resolveTerminalAssetBalanceLabel = useTerminalAssetBalanceLabel({
    customTradeTokenInfoByAddress,
    nativeBalanceWei,
    pWispFooterBalanceState,
    rewardTokenBalanceWei,
    walletAddress
  });

  const {
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
      walletReadAccountsKey || 'single-wallet',
      chainId ?? 'no-chain',
      connectedWithBurner ? 'app' : selectedWalletId || 'browser'
    ].join(':'),
    walletAddress,
    walletKey,
    walletReadAccounts
  });

  const openPublicTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;

  const {
    hashTradeAccessSecret,
    openTradeFromInput,
    resetSwapLinkedOrder
  } = useTradeTerminalLinkActions({
    lastAppliedSwapPinnedTradeKeyRef,
    openTrade,
    setDetailTradeError,
    setEmptyTerminalDrawerOpen,
    setSwapOrderLinkError,
    setSwapOrderLinkInput,
    setSwapPinnedTradeKey,
    setTradeLinkInput,
    showEmptyTradeRoute,
    tradeLinkInput
  });

  const {
    navigateDeskView,
    openEmptyTerminalPanel,
    openTradeSnapshot,
    restoreMobileDeskScroll,
    saveMobileDeskScroll
  } = useP2PTradeDeskNavigation({
    buildCurrentTradeSurfacePath,
    emptyTerminalDrawerOpen,
    isMobileNav,
    lastAppliedSwapPinnedTradeKeyRef,
    mobileDeskScrollRef,
    mobileTerminalReturnSurfaceRef,
    navigateToTradePath,
    openTrade,
    rememberTradeTerminalReturn,
    resolvedRouteAccessSecret,
    resetSwapLinkedOrder,
    resolveKnownTradeAccessSecret,
    route,
    routeSurfaceView,
    selectedMyTradeDetailKey,
    setDetailTrade,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setSwapPinnedTradeKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    terminalReturnSurfaceRef
  });

  const {
    clearSwapPinnedOrder,
    flipSwapTokens,
    openSwapOrderFromInput,
    updateSwapOrderLinkInput
  } = useOtcSwapRouteActions({
    lastAppliedSwapPinnedTradeKeyRef,
    navigateToTradePath,
    openTrade,
    resetSwapLinkedOrder,
    routeView: route.view,
    setDetailTradeError,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setSwapActionMode,
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapOrderLinkError,
    setSwapOrderLinkInput,
    setSwapPinnedTradeKey,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    setTradeActionError,
    swapActionMode,
    swapBuyAmountInput,
    swapBuyTokenSelection,
    swapOrderLinkError,
    swapOrderLinkInput,
    swapSellAmountInput,
    swapSellTokenSelection,
    terminalReturnSurfaceRef
  });

  useP2PTradeTerminalRouteEffects({
    activeTerminalSwapIntentRef,
    detailTrade,
    forgetTradeAccessSecret,
    hashTradeAccessSecret,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    routeAccessSecret,
    routeEscrowContract,
    routeTradeId,
    routeView: route.view,
    setRecurringBuyFillInput,
    setRecurringSellFillInput,
    setRecurringTerminalSide,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    setTradeActionError,
    walletKey
  });

  const {
    ensureDistinctSwapTokenSelection,
    swapBuyToken,
    swapBuyTokenKey,
    swapSellToken,
    swapSellTokenKey,
    swapTokenOptions,
    tradeComposerModel,
    updateRecurringBuyPriceInput,
    updateRecurringBuyReversePriceInput,
    updateRecurringSellPriceInput,
    updateRecurringSellReversePriceInput,
    updateSwapBuyAmountInput,
    updateSwapSellAmountInput,
    updateTradeOfferAmountInput,
    updateTradePriceInput,
    updateTradeRequestAmountInput,
    updateTradeReversePriceInput
  } = useP2PTradeComposerModel({
    combinedBalanceByAssetKey,
    creatingTrade,
    customTradeTokenInfoByAddress,
    editingVisibleTrade: Boolean(editingTrade && !editingTrade.hiddenLiquidity),
    hasCounterParentTrade: Boolean(counterParentTrade),
    nativeBalanceWei,
    onCotiNetwork,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    setRecurringBuyPriceInput,
    setRecurringSellPriceInput,
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    setTradeOfferAmountInput,
    setTradePriceInput,
    setTradePricingEditedFields,
    setTradeRequestAmountInput,
    swapBuyTokenSelection,
    swapSellTokenSelection,
    tradeExpiryHoursInput,
    tradeFeeModeSelection,
    tradeHasNoExpiry,
    tradeHidePrivateLiquidity,
    tradeOfferAmountInput,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestAmountInput,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    tradeRequiredFeeWei,
    walletAddress
  });

  const swapRecurringOrderSides = useRecurringOrderSideSwap({
    creatingRecurringOrder,
    editingRecurringOrder,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBuyPriceInput,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    recurringSellPriceInput,
    setRecurringAddBuyBudgetInput,
    setRecurringAddSellInventoryInput,
    setRecurringBuyPriceInput,
    setRecurringBuyReceiveEditable,
    setRecurringBuyReceiveInput,
    setRecurringRemoveBuyBudgetInput,
    setRecurringRemoveSellInventoryInput,
    setRecurringSellPriceInput,
    setRecurringSellReceiveEditable,
    setRecurringSellReceiveInput,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection
  });

  useTradePricingSync({
    setTradeOfferAmountInput,
    setTradePriceInput,
    setTradePricingEditedFields,
    setTradeRequestAmountInput,
    tradeComposerModel,
    tradeOfferAmountInput,
    tradePriceInput,
    tradePricingEditedFields,
    tradeRequestAmountInput
  });

  const { refreshTradeDataInBackground, scheduleP2PSync } = useP2PSyncQueue({
    flushQueuedTradeDataRefreshRef,
    getTradeWalletFlowInput,
    refreshAllTradingBalances,
    refreshMyTrades,
    refreshPublicTrades,
    refreshTradeDetail,
    routeEscrowContract,
    routeTradeId,
    routeView,
    walletAddress
  });

  const {
    beginCounterTrade,
    beginEditTrade,
    clearCounterTrade,
    clearEditTrade,
    createTrade,
    startFreshTrade
  } = useP2PTradeComposerActions({
    buildCurrentTradeSurfacePath,
    buildTradeShareUrl,
    canEditPublicTrade,
    counterParentTrade,
    directTradeRecipientIsValid,
    directTradeRecipientNormalized,
    editingTrade,
    ensureTradeFunding,
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
    walletKey,
    onActionNotice: pushActionNotice
  });

  const {
    beginEditRecurringOrder,
    cancelCounterCreate,
    clearRecurringEdit,
    createRecurringOrder,
    fillRecurringOrderSide,
    processingRecurringAction,
    startFreshOneOffTrade,
    startFreshRecurringOrder,
    updateRecurringOrderStatus
  } = useP2PRecurringOrderActions({
    buildCurrentTradeSurfacePath,
    buildTradeShareUrl,
    clearCounterTrade,
    clearEditTrade,
    combinedBalanceByAssetKey,
    counterParentTrade,
    customTradeTokenInfoByAddress,
    editingRecurringOrder,
    editingTrade,
    ensureTradeFunding,
    getTradeSigner,
    nativeBalanceWei,
    navigateToTradePath,
    onActionNotice: pushActionNotice,
    onCotiNetwork,
    openTrade,
    pWispFooterBalanceState,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBuyFillInput,
    recurringBuyPriceInput,
    recurringHidePrivateAmounts,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    recurringSellFillInput,
    recurringSellPriceInput,
    refreshTradeDataInBackground,
    rememberTradeTerminalReturn,
    resolvedRouteAccessSecret,
    resolveRequiredFeeForTradeCreate,
    rewardTokenBalanceWei,
    runTradeWalletPromptFlow,
    setCreatedRecurringOrderId,
    setCreatedRecurringOrderLink,
    setCreatingRecurringOrder,
    setEditingRecurringOrder,
    setRecurringAddBuyBudgetInput,
    setRecurringAddSellInventoryInput,
    setRecurringBuyFillInput,
    setRecurringBuyPriceInput,
    setRecurringBuyReceiveEditable,
    setRecurringBuyReceiveInput,
    setRecurringHidePrivateAmounts,
    setRecurringRemoveBuyBudgetInput,
    setRecurringRemoveSellInventoryInput,
    setRecurringSellFillInput,
    setRecurringSellPriceInput,
    setRecurringSellReceiveEditable,
    setRecurringSellReceiveInput,
    setTradeActionError,
    setTradeCreateMode,
    setTradeExpiryHoursInput,
    setTradeHasNoExpiry,
    setTradeOfferAmountInput,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradePriceInput,
    setTradePricingEditedFields,
    setTradeRequestAmountInput,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    startFreshTrade,
    tradeComposerModel,
    tradeRequiredFeeWei,
    walletAddress
  });

  const resolveSwapPairSelectionsForTrade = useOtcSwapPairSelections({
    swapActionMode,
    tradeTokenOptions: tradeComposerModel.tradeTokenOptions
  });

  const resolveTradeActionWalletAddress = useCallback(
    (snapshot: TradeSnapshot, action: 'accept' | 'cancel' | 'decline' | 'fill'): string => {
      return resolveTradeActionWalletAddressForScope({
        action,
        fallbackAddress: walletAddress,
        readAccounts: walletReadAccounts,
        trade: snapshot
      });
    },
    [walletAddress, walletReadAccounts]
  );

  const {
    acceptTrade,
    cancelTrade,
    declineTrade,
    partialFillTrade,
    processingTradeActionId
  } = useP2PTradeActions({
    ensureTradeFunding,
    getTradeSigner,
    getTradeSignerForWallet,
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
    walletAddress,
    resolveActionWalletAddress: resolveTradeActionWalletAddress,
    onActionNotice: pushActionNotice
  });

  const tradeOrderCardProps: TradeOrderCardProps = {
    routeView: route.view,
    walletAddress,
    walletKey,
    walletReadAccounts,
    reversedRateTradeIds,
    lastCopiedKey,
    openTradeSnapshot,
    toggleTradeRateDirection,
    resolveKnownTradeAccessSecret,
    buildTradeShareUrl,
    copyWithFeedback
  };
  const terminalHistoryConfigParams: TerminalHistoryConfigParams = {
    walletAddress,
    walletReadAccounts,
    historyLifecycleTxHashes,
    historyTransactionTxHashes,
    historyTransactionTimestamps,
    swapFillNotes,
    getTransactionLinkFeedbackProps
  };
  useP2PRealtimeSync({
    chainId,
    getTradeWalletFlowInput,
    hasActiveListRefresh,
    routeEscrowContract,
    routeTradeId,
    routeView,
    scheduleP2PSync,
    walletAddress
  });

  const {
    activeTradeMode,
    openLimitOrderFromSwapPair,
    openTradeEntryMode
  } = useP2PTradeEntryNavigation({
    buildCurrentTradeSurfacePath,
    navigateDeskView,
    navigateToTradePath,
    routeTradeMode: route.tradeMode,
    routeView: route.view,
    setTradeActionError,
    setTradeCreateMode,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    startFreshOneOffTrade,
    startFreshRecurringOrder,
    swapActionMode,
    swapBuyTokenSelection,
    swapSellTokenSelection
  });
  const tradeViewTabs = (
    <TradeViewTabs
      onNavigateDeskView={navigateDeskView}
      routeSurfaceView={routeSurfaceView}
      routeView={route.view}
    />
  );
  const tradeEntryModeTabs = (
    <TradeEntryModeTabs
      activeTradeMode={activeTradeMode}
      onOpenTradeEntryMode={openTradeEntryMode}
    />
  );
  const publicOpenTrades = useMemo(
    () => publicTrades.filter((trade) => trade.status === 'open'),
    [publicTrades]
  );
  const {
    changeSwapActionMode,
    swapBestQuote,
    swapDisplayBaseToken,
    swapDisplayQuoteToken,
    swapInputAmountWei,
    swapLinkedActionModes,
    swapPinnedTrade
  } = useOtcSwapQuoteState({
    detailTrade,
    lastAppliedSwapPinnedTradeKeyRef,
    lastSyncedRouteSwapTradeKeyRef,
    myTrades,
    publicOpenTrades,
    resolveSwapPairSelectionsForTrade,
    routeView: route.view,
    setSwapActionMode,
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapPinnedTradeKey,
    setSwapPriceDisplayInverted,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    swapActionMode,
    swapBuyAmountInput,
    swapBuyToken,
    swapBuyTokenSelection,
    swapInputMode,
    swapPinnedTradeKey,
    swapSellAmountInput,
    swapSellToken,
    swapSellTokenSelection,
    terminalReturnSurfaceRef
  });
  const {
    canOpenMyTradeTerminal,
    filteredPublicTrades,
    mobileTradeFiltersOpen,
    myOpenTrades,
    myTradeGroupOptions,
    receivedOpenTradeOffers,
    resetTradeDeskFilters,
    selectedMyTradeDetail,
    selectedMyTradeGroup,
    setMobileTradeFiltersOpen,
    setTradePairFilter,
    setTradeSearchInput,
    setTradeSortMode,
    setTradeTypeFilter,
    tradePairFilter,
    tradeSearchInput,
    tradeSortMode,
    tradeTypeFilter,
    walletTradeHistory
  } = useTradeDeskLists({
    myTradeGroupView,
    myTrades,
    publicOpenTrades,
    selectedMyTradeDetailKey,
    walletAddress,
    walletReadAccounts
  });
  const openMyTradeTerminal = useTradeDeskSelectionActions({
    canOpenMyTradeTerminal,
    previousTradeFilterRouteScopeRef,
    resetTradeDeskFilters,
    saveMobileDeskScroll,
    selectedMyTradeDetail,
    selectedMyTradeDetailKey,
    selectedMyTradeGroupId: selectedMyTradeGroup.id,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    setTradeActionError,
    tradeFilterRouteScope
  });
  const {
    activeAdvancedTradeFilterCount,
    clearTradeDeskFilters,
    createDeskIdentity,
    hasActiveDeskFilters,
    showTradeSearch,
    tradeDeskIdentity,
    tradePairFilterOptions,
    tradeSearchPlaceholder,
    tradeSearchSummary,
    tradeTypeFilterOptions
  } = useTradeDeskViewModel({
    counterParentTrade,
    editingRecurringOrder,
    editingTrade,
    filteredPublicTradeCount: filteredPublicTrades.length,
    myTrades,
    openPublicTradeCount,
    publicOpenTrades,
    resetTradeDeskFilters,
    routeSurfaceView,
    selectedMyTradeGroupLabel: selectedMyTradeGroup.label,
    selectedMyTradeGroupTradeCount: selectedMyTradeGroup.trades.length,
    tradeCreateMode,
    tradePairFilter,
    tradeSearchInput,
    tradeSortMode,
    tradeTypeFilter,
    walletAddress
  });
  const emptyTerminalOpen =
    (route.view === 'trade' && !route.tradeId) ||
    (emptyTerminalDrawerOpen && (route.view === 'public' || route.view === 'mine'));
  const myTradeTerminalOpen = route.view === 'mine' && !emptyTerminalOpen && Boolean(selectedMyTradeDetail);
  const terminalPanelOpen = route.view === 'trade' || myTradeTerminalOpen || emptyTerminalOpen;
  const terminalPanelBaseTrade = emptyTerminalOpen ? null : route.view === 'mine' ? selectedMyTradeDetail : detailTrade;
  const terminalPanelTrade = useMemo(() => {
    if (!terminalPanelBaseTrade) {
      return null;
    }
    const walletCopy = myTrades.find((trade) => getSnapshotKey(trade) === getSnapshotKey(terminalPanelBaseTrade));
    if (!walletCopy) {
      return terminalPanelBaseTrade;
    }
    const perspectiveKey =
      resolveTerminalHistoryMergeWalletKey(walletCopy, { walletAddress, walletReadAccounts }, walletKey) ||
      resolveTerminalHistoryMergeWalletKey(terminalPanelBaseTrade, { walletAddress, walletReadAccounts }, walletKey);
    return mergeTradeSnapshotEnrichment(terminalPanelBaseTrade, walletCopy, perspectiveKey);
  }, [myTrades, terminalPanelBaseTrade, walletAddress, walletKey, walletReadAccounts]);
  const terminalHistoryTargetTrade =
    route.view === 'mine'
      ? terminalPanelTrade
      : route.view === 'trade' && !tradeAccessBlocked
        ? terminalPanelTrade
        : null;
  const terminalHistoryWalletAddress = terminalHistoryTargetTrade
    ? resolveTerminalHistoryWallet(terminalHistoryTargetTrade, { walletAddress, walletReadAccounts }).walletAddress
    : walletAddress;
  useTradeTerminalHistoryHydration({
    historyLifecycleTxHashes,
    historyTransactionTimestamps,
    historyTransactionTxHashes,
    resolveBlockTimestampMap,
    setHistoryLifecycleTxHashes,
    setHistoryTransactionTimestamps,
    setHistoryTransactionTxHashes,
    targetTrade: terminalHistoryTargetTrade,
    walletAddress: terminalHistoryWalletAddress
  });
  const terminalRouteDetailPending =
    route.view === 'trade' &&
    !emptyTerminalOpen &&
    !detailTrade &&
    !tradeAccessBlocked &&
    !route.routeError &&
    !detailTradeError;
  const terminalHasTradeContent = !emptyTerminalOpen && Boolean(terminalPanelTrade);
  const {
    getCarbonReferenceContext,
    getCarbonReferenceDisplay
  } = useCarbonPairReferences({
    routeSurfaceView,
    routeView: route.view,
    swapBuyToken,
    swapSellToken,
    terminalPanelTrade,
    tradeComposerOfferToken: tradeComposerModel.selectedTradeOfferToken,
    tradeComposerRequestToken: tradeComposerModel.selectedTradeRequestToken,
    walletAddress
  });
  useEffect(() => {
    if (!terminalPanelTrade) {
      return;
    }

    const privateReadAccount = resolvePrivateReadAccount(terminalPanelTrade);
    const privateReadKey = privateReadAccount?.key ?? '';
    if (!privateReadKey) {
      return;
    }

    const isMaker = terminalPanelTrade.maker.toLowerCase() === privateReadKey;
    const recurring = terminalPanelTrade.recurringOrder;
    const termsVisibility = getTradeTermsVisibility(terminalPanelTrade);
    const isPrivateStandardTrade = !recurring && termsVisibility === 'hidden-liquidity';
    const isDirectPrivateTermsTrade = !recurring && termsVisibility === 'direct-private-terms';
    const isPublicStandardTrade =
      !recurring &&
      termsVisibility === 'public' &&
      !terminalPanelTrade.directTermsMetadata;
    const isPrivateRecurringTrade = Boolean(recurring && recurring.mode !== 'public');
    if (!isPrivateStandardTrade && !isPrivateRecurringTrade && !isPublicStandardTrade && !isDirectPrivateTermsTrade) {
      return;
    }

    const walletFillEventsStateKey = (snapshot: TradeSnapshot) =>
      (snapshot.walletFillEvents ?? [])
        .filter((event) => isMaker || event.filler?.toLowerCase() === privateReadKey)
        .map((event) =>
          [
            event.fillIndex,
            event.filler?.toLowerCase() ?? '',
            event.offerAmount ?? '',
            event.requestAmount ?? '',
            event.txHash ?? '',
            event.blockNumber ?? '',
            event.logIndex ?? ''
          ].join('/')
        )
        .join('|');
    const receiptStateKey = (snapshot: TradeSnapshot) =>
      (snapshot.privateFillReceipts ?? [])
        .filter((receipt) => isMaker || receipt.filler?.toLowerCase() === privateReadKey)
        .map((receipt) =>
          [
            receipt.fillIndex,
            receipt.filler?.toLowerCase() ?? '',
            receipt.offerAmount ?? '',
            receipt.requestAmount ?? '',
            receipt.remainingOfferAmount ?? '',
            receipt.txHash ?? ''
          ].join('/')
        )
        .join('|');
    const recurringExecutionStateEntries = (snapshot: TradeSnapshot) => [
      ...(snapshot.recurringOrder?.privateExecutions ?? []).map((execution) => ({
        execution,
        source: 'private'
      })),
      ...(snapshot.recurringOrder?.publicExecutions ?? []).map((execution) => ({
        execution,
        source: 'public'
      }))
    ].filter(({ execution }) => isMaker || execution.filler?.toLowerCase() === privateReadKey);
    const recurringExecutionStateKey = (snapshot: TradeSnapshot) =>
      recurringExecutionStateEntries(snapshot)
        .map(({ execution, source }) =>
          [
            source,
            execution.fillIndex,
            execution.side,
            execution.filler?.toLowerCase() ?? '',
            execution.baseAmount ?? '',
            execution.quoteAmount ?? '',
            execution.remainingBaseInventory ?? '',
            execution.remainingQuoteInventory ?? '',
            execution.txHash ?? ''
          ].join('/')
        )
        .join('|');
    const recurringExecutionCount = (snapshot: TradeSnapshot) =>
      new Set(
        recurringExecutionStateEntries(snapshot).map(({ execution }) =>
          `${execution.fillIndex}:${execution.filler?.toLowerCase() ?? ''}`
        )
      ).size;
    const privateStateKey = (snapshot: TradeSnapshot) =>
      [
        walletFillEventsStateKey(snapshot),
        receiptStateKey(snapshot),
        recurringExecutionStateKey(snapshot),
        hasHydratedDirectTradeTerms(snapshot) ? 'direct-ready' : 'direct-pending',
        snapshot.offer.amount,
        snapshot.request.amount,
        snapshot.fillState?.filledOfferAmount ?? '',
        snapshot.fillState?.filledRequestAmount ?? '',
        snapshot.walletFillState?.offerAmountReceived ?? '',
        snapshot.walletFillState?.requestAmountPaid ?? '',
        snapshot.walletHasFill ? 'wallet-fill' : '',
        snapshot.makerPrivateProgress?.initialOfferAmount ?? '',
        snapshot.makerPrivateProgress?.remainingOfferAmount ?? '',
        snapshot.makerPrivateProgress?.filledOfferAmount ?? '',
        snapshot.recurringOrder?.makerPrivateInventory?.baseInventory ?? '',
        snapshot.recurringOrder?.makerPrivateInventory?.quoteInventory ?? ''
      ].join('::');

    const currentPrivateStateKey = privateStateKey(terminalPanelTrade);
    const privateReceiptCount = (terminalPanelTrade.privateFillReceipts ?? []).filter(
      (receipt) => isMaker || receipt.filler?.toLowerCase() === privateReadKey
    ).length;
    const needsStandardHydration =
      isPrivateStandardTrade &&
      (isMaker ? !terminalPanelTrade.makerPrivateProgress || privateReceiptCount === 0 : privateReceiptCount === 0);
    const hydratedPublicFillEventCount = (terminalPanelTrade.walletFillEvents ?? []).filter(
      (event) => isMaker || event.filler?.toLowerCase() === privateReadKey
    ).length;
    const needsPublicStandardHydration =
      isPublicStandardTrade &&
      hydratedPublicFillEventCount === 0;
    const needsDirectTermHydration =
      isDirectPrivateTermsTrade &&
      !hasHydratedDirectTradeTerms(terminalPanelTrade);

    const hydratedRecurringExecutionCount = recurringExecutionCount(terminalPanelTrade);
    const missingPrivateInventory =
      Boolean(
        isMaker &&
          recurring &&
          (
            (recurring.hasPrivateBaseInventory && recurring.makerPrivateInventory?.baseInventory === undefined) ||
            (recurring.hasPrivateQuoteInventory && recurring.makerPrivateInventory?.quoteInventory === undefined)
          )
      );
    const needsRecurringHydration =
      Boolean(
        recurring &&
          recurring.mode !== 'public' &&
          (isMaker
            ? missingPrivateInventory || hydratedRecurringExecutionCount === 0 || recurring.executionCount > hydratedRecurringExecutionCount
            : hydratedRecurringExecutionCount === 0 || recurring.executionCount > hydratedRecurringExecutionCount)
      );

    if (!needsStandardHydration && !needsRecurringHydration && !needsPublicStandardHydration && !needsDirectTermHydration) {
      return;
    }

    const forceReveal =
      needsStandardHydration ||
      needsRecurringHydration ||
      needsPublicStandardHydration ||
      (needsDirectTermHydration && Boolean(privateReadAccount?.canReadPrivate));
    const hydrationKey = [
      getSnapshotKey(terminalPanelTrade),
      privateReadKey,
      privateReadAccount?.role ?? 'wallet',
      forceReveal ? 'force' : 'read',
      recurring?.executionCount ?? 'standard',
      currentPrivateStateKey
    ].join(':');
    if (terminalPrivateHistoryHydrationRef.current[hydrationKey]) {
      return;
    }
    terminalPrivateHistoryHydrationRef.current[hydrationKey] = true;

    let cancelled = false;
    enrichMakerPrivateProgress(terminalPanelTrade, forceReveal, privateReadAccount ?? undefined)
      .then((enrichedSnapshot) => {
        if (cancelled || privateStateKey(enrichedSnapshot) === currentPrivateStateKey) {
          return;
        }
        mergeTradeSnapshot(enrichedSnapshot);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    enrichMakerPrivateProgress,
    mergeTradeSnapshot,
    resolvePrivateReadAccount,
    terminalPanelTrade
  ]);
  useEffect(() => {
    if (!terminalPanelTrade || terminalPanelTrade.recurringOrder) {
      return;
    }
    if (getTradeTermsVisibility(terminalPanelTrade) !== 'public' || terminalPanelTrade.directTermsMetadata) {
      return;
    }

    const historyWallet = resolveTerminalHistoryWallet(terminalPanelTrade, { walletAddress, walletReadAccounts });
    const historyWalletKey = historyWallet.walletKey;
    if (!historyWalletKey) {
      return;
    }

    const isMaker = terminalPanelTrade.maker.toLowerCase() === historyWalletKey;
    const relevantFillEvents = (terminalPanelTrade.walletFillEvents ?? []).filter(
      (event) => isMaker || event.filler?.toLowerCase() === historyWalletKey
    );
    const fillEventStateKey = relevantFillEvents
      .map((event) =>
        [
          event.fillIndex,
          event.filler?.toLowerCase() ?? '',
          event.offerAmount,
          event.requestAmount,
          event.txHash ?? '',
          event.blockNumber ?? '',
          event.logIndex ?? ''
        ].join('/')
      )
      .join('|');
    const hydrationKey = [
      getSnapshotKey(terminalPanelTrade),
      historyWalletKey,
      isMaker ? 'maker' : 'filler',
      terminalPanelTrade.fillState?.filledOfferAmount ?? '',
      terminalPanelTrade.fillState?.filledRequestAmount ?? '',
      fillEventStateKey
    ].join(':');
    if (terminalPublicStandardHistoryHydrationRef.current[hydrationKey]) {
      return;
    }
    terminalPublicStandardHistoryHydrationRef.current[hydrationKey] = true;

    let cancelled = false;
    fetchTradePartialFillEventsForWallet({
      tradeId: terminalPanelTrade.tradeId,
      escrowContract: terminalPanelTrade.escrowContract,
      walletAddress: historyWallet.walletAddress,
      role: isMaker ? 'maker' : 'filler'
    })
      .then((walletFillEvents) => {
        if (cancelled || walletFillEvents.length === 0) {
          return;
        }
        const historyAccount = walletReadAccounts.find((account) => account.key === historyWalletKey);
        const accountMatch = historyAccount
          ? { address: historyAccount.address, role: historyAccount.role }
          : { address: historyWallet.walletAddress, role: terminalPanelTrade.accountRole ?? 'chainwhisper' as const };
        mergeTradeSnapshot({
          ...terminalPanelTrade,
          accountAddress: accountMatch.address,
          accountRole: accountMatch.role,
          accountMatches: [
            ...(terminalPanelTrade.accountMatches ?? []).filter(
              (match) => match.address.toLowerCase() !== accountMatch.address.toLowerCase()
            ),
            accountMatch
          ],
          walletHasFill: Boolean(terminalPanelTrade.walletHasFill || walletFillEvents.length > 0),
          walletFillEvents
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    mergeTradeSnapshot,
    terminalPanelTrade,
    walletAddress,
    walletReadAccounts
  ]);
  useEffect(() => {
    const recurring = terminalPanelTrade?.recurringOrder;
    if (!terminalPanelTrade || !recurring) {
      return;
    }

    const publicReadAccount = resolvePrivateReadAccount(terminalPanelTrade);
    const publicReadKey = publicReadAccount?.key ?? '';
    if (!publicReadKey) {
      return;
    }

    const isMaker = terminalPanelTrade.maker.toLowerCase() === publicReadKey;
    const relevantPublicExecutions = (recurring.publicExecutions ?? []).filter(
      (execution) => isMaker || execution.filler?.toLowerCase() === publicReadKey
    );
    const relevantExecutionCount = new Set(
      [
        ...(recurring.privateExecutions ?? []),
        ...(recurring.publicExecutions ?? [])
      ]
        .filter((execution) => isMaker || execution.filler?.toLowerCase() === publicReadKey)
        .map((execution) => `${execution.fillIndex}:${execution.filler?.toLowerCase() ?? ''}`)
    ).size;
    if (
      recurring.executionCount <= 0 ||
      (relevantPublicExecutions.length > 0 && relevantExecutionCount >= recurring.executionCount)
    ) {
      return;
    }

    const hydrationKey = [
      getSnapshotKey(terminalPanelTrade),
      publicReadKey,
      publicReadAccount?.role ?? 'wallet',
      recurring.executionCount,
      relevantPublicExecutions.length
    ].join(':');
    if (terminalPublicRecurringHistoryHydrationRef.current[hydrationKey]) {
      return;
    }
    terminalPublicRecurringHistoryHydrationRef.current[hydrationKey] = true;

    let cancelled = false;
    fetchRecurringExecutionRowsForWallet({
      contractAddress: terminalPanelTrade.escrowContract,
      orderId: recurring.orderId,
      walletAddress: isMaker ? undefined : publicReadAccount?.address
    })
      .then(async (publicExecutions) => {
        let resolvedExecutions = publicExecutions;
        let resolvedAccount = publicReadAccount;
        const ownerFallbackAccount = getWalletOwnerAccount(walletReadAccounts);
        if (
          !isMaker &&
          resolvedExecutions.length === 0 &&
          ownerFallbackAccount &&
          ownerFallbackAccount.key !== publicReadKey &&
          ownerFallbackAccount.key !== terminalPanelTrade.maker.toLowerCase()
        ) {
          const ownerExecutions = await fetchRecurringExecutionRowsForWallet({
            contractAddress: terminalPanelTrade.escrowContract,
            orderId: recurring.orderId,
            walletAddress: ownerFallbackAccount.address
          }).catch(() => []);
          if (ownerExecutions.length > 0) {
            resolvedExecutions = ownerExecutions;
            resolvedAccount = ownerFallbackAccount;
          }
        }
        if (cancelled || resolvedExecutions.length === 0) {
          return;
        }
        mergeTradeSnapshot({
          ...terminalPanelTrade,
          accountAddress: resolvedAccount?.address ?? terminalPanelTrade.accountAddress,
          accountRole: resolvedAccount?.role ?? terminalPanelTrade.accountRole,
          accountMatches: resolvedAccount
            ? [
                ...(terminalPanelTrade.accountMatches ?? []).filter(
                  (match) => match.address.toLowerCase() !== resolvedAccount.address.toLowerCase()
                ),
                { address: resolvedAccount.address, role: resolvedAccount.role }
              ]
            : terminalPanelTrade.accountMatches,
          walletHasFill: Boolean(terminalPanelTrade.walletHasFill || (!isMaker && resolvedExecutions.length > 0)),
          recurringOrder: {
            ...recurring,
            publicExecutions: resolvedExecutions
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    mergeTradeSnapshot,
    resolvePrivateReadAccount,
    terminalPanelTrade,
    walletReadAccounts
  ]);
  const closeTerminalPanel = useCloseTradeTerminalPanel({
    buildCurrentTradeSurfacePath,
    isMobileNav,
    mobileTerminalReturnSurfaceRef,
    navigateToTradePath,
    resetSwapLinkedOrder,
    restoreMobileDeskScroll,
    routeView: route.view,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    terminalReturnSurfaceRef
  });
  const createdTradeCopyKey = 'created-trade-link';
  const focusTradeLinkInput = () => {
    tradeLinkInputRef.current?.focus();
  };
  const recurringBaseToken = tradeComposerModel.selectedTradeOfferToken;
  const recurringQuoteToken = tradeComposerModel.selectedTradeRequestToken;
  const recurringBaseKey = recurringBaseToken ? buildTradeComposerAssetBalanceKey(recurringBaseToken) : '';
  const recurringQuoteKey = recurringQuoteToken ? buildTradeComposerAssetBalanceKey(recurringQuoteToken) : '';
  useEffect(() => {
    setRecurringPriceDisplayInverted(false);
  }, [recurringBaseKey, recurringQuoteKey]);
  const recurringComposerCarbonPriceReference = getCarbonReferenceDisplay(
    recurringBaseToken,
    recurringQuoteToken,
    recurringPriceDisplayInverted
  );
  const recurringBaseDecimals = recurringBaseToken?.decimals ?? 18;
  const recurringQuoteDecimals = recurringQuoteToken?.decimals ?? 18;
  const {
    recurringBuyReceivePreview,
    recurringSellReceivePreview,
    toggleRecurringBuyReceiveEditable,
    toggleRecurringSellReceiveEditable,
    updateRecurringBuyLiquidityInput,
    updateRecurringBuyReceiveInput,
    updateRecurringSellLiquidityInput,
    updateRecurringSellReceiveInput
  } = useP2PRecurringReceiveInputs({
    hasRecurringPair: Boolean(recurringBaseToken && recurringQuoteToken),
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBaseDecimals,
    recurringBuyPriceInput,
    recurringBuyReceiveEditable,
    recurringBuyReceiveInput,
    recurringQuoteDecimals,
    recurringSellPriceInput,
    recurringSellReceiveEditable,
    recurringSellReceiveInput,
    setRecurringAddBuyBudgetInput,
    setRecurringAddSellInventoryInput,
    setRecurringBuyReceiveEditable,
    setRecurringBuyReceiveInput,
    setRecurringSellReceiveEditable,
    setRecurringSellReceiveInput
  });

  const {
    executeSwapQuote,
    formatSwapAvailability,
    openSwapCurrentOrderInTerminal,
    swapBuyVerifyUrl,
    swapCarbonReference,
    swapCarbonReferenceContext,
    swapChainWhisperMarketLabel,
    swapDisplayQuote,
    swapReviewDisabled,
    swapReviewLabel,
    swapSellBalanceLabel,
    swapSellBalanceTitle,
    swapSellVerifyUrl
  } = useOtcSwapReviewState({
    activeTerminalSwapIntentRef,
    combinedBalanceByAssetKey,
    fillRecurringOrderSide,
    getCarbonReferenceContext,
    getCarbonReferenceDisplay,
    lastAppliedSwapPinnedTradeKeyRef,
    openTradeSnapshot,
    partialFillTrade,
    processingRecurringAction,
    processingTradeActionId,
    setSwapPinnedTradeKey,
    swapActionMode,
    swapBestQuote,
    swapBuyToken,
    swapBuyTokenKey,
    swapBuyTokenSelection,
    swapDisplayBaseToken,
    swapDisplayQuoteToken,
    swapInputAmountWei,
    swapInputMode,
    swapPinnedTrade,
    swapPriceDisplayInverted,
    swapSellToken,
    swapSellTokenKey,
    swapSellTokenSelection
  });
  const {
    appendTradeAgentMessage,
    appendTradeAgentStatusMessage,
    resolveTradeAgentQuickActionPrompt,
    selectTradeAgentQuickAction,
    setTradeAgentAction,
    setTradeAgentError,
    setTradeAgentExplicitContext,
    setTradeAgentFeeQuote,
    setTradeAgentLoading,
    setTradeAgentPanelMode,
    setTradeAgentPrompt,
    setTradeAgentRetryPaymentRequestId,
    setTradeAgentRetryPaymentTxHash,
    setTradeAgentStatus,
    tradeAgentAction,
    tradeAgentError,
    tradeAgentExplicitContext,
    tradeAgentFeeLabel,
    tradeAgentLoading,
    tradeAgentMessages,
    tradeAgentMessagesEndRef,
    tradeAgentPanelMode,
    tradeAgentPrompt,
    tradeAgentRetryPaymentTxHash,
    tradeAgentStatus,
    updateTradeAgentPrompt,
    visibleTradeAgentQuickActions
  } = useP2PTradeAgentSession({
    hasDetailTrade: Boolean(detailTrade),
    hasReviewOrders: myTrades.length > 0,
    routeSurfaceView,
    swapActionMode,
    swapBuyTokenSymbol: swapBuyToken?.symbol,
    swapSellTokenSymbol: swapSellToken?.symbol
  });
  const currentAppHelpPath = typeof window === 'undefined' ? '/otc/agent' : window.location.pathname;
  const {
    appHelpCanRetry,
    appHelpError,
    appHelpLoading,
    appHelpMessages,
    appHelpMessagesEndRef,
    appHelpPrompt,
    appHelpQuickQuestions,
    askAppHelpQuestion,
    retryAppHelpQuestion,
    showAppHelpTopic,
    submitAppHelp,
    updateAppHelpPrompt
  } = useP2PAppHelp({
    active: routeSurfaceView === 'agent' && tradeAgentPanelMode === 'help',
    currentPath: currentAppHelpPath
  });
  useEffect(() => {
    if (!appHelpLaunchContext || routeSurfaceView !== 'agent') {
      return;
    }
    setTradeAgentPanelMode('help');
    const launchTopicId =
      appHelpLaunchContext.topicId ??
      (appHelpLaunchContext.reason ? getAppHelpReadinessTopicId(appHelpLaunchContext.reason) : '');
    if (launchTopicId) {
      showAppHelpTopic(launchTopicId);
    }
    onAppHelpLaunchConsumed?.();
  }, [
    appHelpLaunchContext,
    onAppHelpLaunchConsumed,
    routeSurfaceView,
    setTradeAgentPanelMode,
    showAppHelpTopic
  ]);
  const {
    applyTradeAgentAction,
    askAgentAboutOrder,
    submitTradeAgentRequest
  } = useP2PTradeAgentActions({
    appendTradeAgentMessage,
    appendTradeAgentStatusMessage,
    beginCounterTrade,
    buildCurrentTradeSurfacePath,
    detailTrade,
    formatSwapAvailability,
    getCarbonReferenceContext,
    getTradeSigner,
    myTrades,
    navigateDeskView,
    navigateToTradePath,
    openTradeSnapshot,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    publicOpenTrades,
    refreshAllTradingBalances,
    rewardTokenDecimals,
    rewardTokenSymbol,
    routeSurfaceView,
    routeView: route.view,
    saveMobileDeskScroll,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setSwapActionMode,
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    setTradeAgentAction,
    setTradeAgentError,
    setTradeAgentExplicitContext,
    setTradeAgentFeeQuote,
    setTradeAgentLoading,
    setTradeAgentPanelMode,
    setTradeAgentPrompt,
    setTradeAgentRetryPaymentRequestId,
    setTradeAgentRetryPaymentTxHash,
    setTradeAgentStatus,
    setTradeOfferAmountInput,
    setTradeOfferTokenSelection,
    setTradeHidePrivateLiquidity,
    setTradePriceInput,
    setTradeRequestAmountInput,
    setTradeRequestTokenSelection,
    setTradeVisibility,
    setDirectTradeRecipient,
    setRecurringAddBuyBudgetInput,
    setRecurringAddSellInventoryInput,
    setRecurringBuyPriceInput,
    setRecurringHidePrivateAmounts,
    setRecurringSellPriceInput,
    startFreshOneOffTrade,
    startFreshRecurringOrder,
    swapActionMode,
    swapBuyToken,
    swapCarbonReferenceContext,
    swapChainWhisperMarketLabel,
    swapDisplayQuote,
    swapSellToken,
    terminalReturnSurfaceRef,
    tradeAgentAction,
    tradeAgentExplicitContext,
    tradeAgentPrompt,
    tradeComposerModel,
    walletAddress
  });
  const isComposerRoute = route.view === 'create' || route.view === 'counter';
  const isCounterRouteWithoutParent = route.view === 'counter' && !counterParentTrade;
  const showSwapSurface = routeSurfaceView === 'swap' && !isComposerRoute;
  const showAgentSurface = routeSurfaceView === 'agent' && !isComposerRoute;
  const showPublicSurface = routeSurfaceView === 'public' && !isComposerRoute;
  const marketOverviewClassView = routeSurfaceView ?? route.view;
  const tradeTerminalRendererProps: Omit<TradeTerminalRendererProps, 'snapshot'> = {
    routeView: route.view,
    walletAddress,
    walletKey,
    onCotiNetwork,
    lastCopiedKey,
    reversedRateTradeIds,
    expandedMakerControls,
    terminalFillInputSide,
    terminalPayInput,
    terminalBuyInput,
    processingTradeActionId,
    terminalHistorySheetKey,
    setTerminalFillInputSide,
    setTerminalPayInput,
    setTerminalBuyInput,
    setTerminalHistorySheetKey,
    acceptTrade,
    askAgentAboutOrder,
    beginCounterTrade,
    beginEditTrade,
    buildTradeShareUrl,
    cancelTrade,
    copyWithFeedback,
    declineTrade,
    fillRecurringOrderSide,
    getCarbonReferenceDisplay,
    partialFillTrade,
    renderActionNotice: renderP2PActionNotice,
    renderTradeConversationButton,
    resolveKnownTradeAccessSecret,
    resolveTerminalAssetBalanceLabel,
    toggleMakerControls,
    toggleTradeRateDirection,
    recurringTerminalSide,
    recurringBuyFillInput,
    recurringSellFillInput,
    processingRecurringAction,
    setRecurringTerminalSide,
    setRecurringBuyFillInput,
    setRecurringSellFillInput,
    beginEditRecurringOrder,
    updateRecurringOrderStatus,
    terminalHistoryConfigParams
  };

  const tradePricePairLabel =
    tradeComposerModel.selectedTradeOfferToken && tradeComposerModel.selectedTradeRequestToken
      ? `${tradeComposerModel.selectedTradeRequestToken.symbol}/${tradeComposerModel.selectedTradeOfferToken.symbol}`
      : 'quote/base';
  const tradeReversePricePairLabel =
    tradeComposerModel.selectedTradeOfferToken && tradeComposerModel.selectedTradeRequestToken
      ? `${tradeComposerModel.selectedTradeOfferToken.symbol}/${tradeComposerModel.selectedTradeRequestToken.symbol}`
      : 'base/quote';
  const tradeReversePriceInput = invertPriceInput(tradePriceInput);
  const tradeComposerCarbonPriceReference = getCarbonReferenceDisplay(
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken
  );
  const tradeComposerReverseCarbonPriceReference = getCarbonReferenceDisplay(
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
    true
  );

  const composerActionNotice = renderP2PActionNotice('composer');

  const tradeAccessSettings = (
    <TradeAccessSettings
      disabled={Boolean(editingTrade || counterParentTrade)}
      directTradeRecipient={directTradeRecipient}
      directTradeRecipientIsValid={directTradeRecipientIsValid}
      directTradeRecipientNormalized={directTradeRecipientNormalized}
      onDirectTradeRecipientChange={setDirectTradeRecipient}
      onTradeVisibilityChange={setTradeVisibility}
      tradeVisibility={tradeVisibility}
    />
  );

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
      actionNotice={composerActionNotice}
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
      offerAmountPlaceholder="0"
      requestAmountPlaceholder="0"
      offerAmountError={tradeComposerModel.tradeComposerFieldErrors.offerAmount}
      requestAmountError={tradeComposerModel.tradeComposerFieldErrors.requestAmount}
      priceInput={tradePriceInput}
      onPriceInputChange={updateTradePriceInput}
      onPriceReverseInputChange={updateTradeReversePriceInput}
      priceLabel="Price"
      pricePlaceholder="0"
      priceReference={tradeComposerCarbonPriceReference}
      priceReverseInput={tradeReversePriceInput}
      priceReverseReference={tradeComposerReverseCarbonPriceReference}
      priceReverseSummaryLabel={tradeReversePricePairLabel}
      priceSummaryLabel={tradePricePairLabel}
      priceHelpText=""
      pricePlacement="top"
      showPriceRatioPreview
      canUseMaxOfferAmount={tradeComposerModel.canUseTradeOfferMax}
      onUseMaxOfferAmount={() => updateTradeOfferAmountInput(tradeComposerModel.tradeOfferMaxInputValue)}
      offerAmountSummaryLabel={tradeComposerModel.tradeOfferAmountSummaryLabel}
      requestAmountSummaryLabel={tradeComposerModel.tradeRequestAmountSummaryLabel}
      offerBalanceSummaryLabel={tradeComposerModel.tradeOfferBalanceSummaryLabel}
      requestBalanceSummaryLabel={tradeComposerModel.tradeRequestBalanceSummaryLabel}
      offerBalanceBreakdownLabel={tradeComposerModel.tradeOfferBalanceBreakdownLabel}
      requestBalanceBreakdownLabel={tradeComposerModel.tradeRequestBalanceBreakdownLabel}
      pricingSourceFields={tradePricingEditedFields}
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
      settingsSlot={tradeAccessSettings}
      onSendTradeOffer={() => {
        createTrade().catch(() => {});
      }}
      generalError={tradeComposerModel.tradeComposerFieldErrors.general}
      validationMessage={tradeComposerModel.tradeComposerValidationMessage || undefined}
    />
  );
  const contextualAppHelpReason = useMemo<AppHelpReason | null>(() => {
    const readinessError = [walletError, tradeActionError]
      .map((message) => message.trim())
      .find((message) => /\b(wallet|network|privacy|unlock|account|balance|fund|gas)\b/iu.test(message));
    if (!readinessError) {
      return null;
    }
    if (!walletAddress || /\bconnect(?:ed)?\b.*\bwallet\b|\bwallet\b.*\bconnect/iu.test(readinessError)) {
      return 'wallet-needed';
    }
    if (/\bnetwork\b|\bcoti mainnet\b/iu.test(readinessError)) {
      return 'wrong-network';
    }
    if (/\bprivacy\b|\bunlock\b|\baes\b|\bsnap\b/iu.test(readinessError)) {
      return 'privacy-locked';
    }
    if (/\baccount\b/iu.test(readinessError)) {
      return 'account-needed';
    }
    if (/\bbalance\b|\bfund\b|\bgas\b/iu.test(readinessError)) {
      return 'funds-needed';
    }
    return 'generic-error';
  }, [tradeActionError, walletAddress, walletError]);

  return (
    <main
      className={`standalone-trades-shell p2p-trading-shell${terminalPanelOpen ? ' p2p-trading-shell-drawer-open' : ''}${
        emptyTerminalOpen ? ' p2p-trading-shell-empty-terminal' : ''
      }${
        !isComposerRoute ? ' p2p-trading-shell-has-overview' : ''
      }${isComposerRoute ? ' p2p-trading-shell-create' : ''}${
        routeSurfaceView === 'mine' ? ' p2p-trading-shell-mine' : ''
      }${terminalRouteReturnSurface ? ` p2p-trading-shell-terminal-source-${terminalRouteReturnSurface}` : ''}`}
    >
      <TradeMarketOverviewPanel
        isComposerRoute={isComposerRoute}
        routeSurfaceView={routeSurfaceView}
        marketOverviewClassView={marketOverviewClassView}
        tradeViewTabs={tradeViewTabs}
        createDeskIdentity={createDeskIdentity}
        tradeDeskIdentity={tradeDeskIdentity}
        showTradeSearch={showTradeSearch}
        openPublicTradeCount={openPublicTradeCount}
        receivedOpenTradeOfferCount={receivedOpenTradeOffers.length}
        myOpenTradeCount={myOpenTrades.length}
        walletTradeHistoryCount={walletTradeHistory.length}
        mobileTradeFiltersOpen={mobileTradeFiltersOpen}
        activeAdvancedTradeFilterCount={activeAdvancedTradeFilterCount}
        hasActiveDeskFilters={hasActiveDeskFilters}
        tradeSearchSummary={tradeSearchSummary}
        tradeSearchInput={tradeSearchInput}
        tradeSearchPlaceholder={tradeSearchPlaceholder}
        tradePairFilter={tradePairFilter}
        tradePairFilterOptions={tradePairFilterOptions}
        tradeTypeFilter={tradeTypeFilter}
        tradeTypeFilterOptions={tradeTypeFilterOptions}
        tradeSortMode={tradeSortMode}
        walletError={walletError}
        tradeActionError={tradeActionError}
        onSearchInputChange={setTradeSearchInput}
        onClearSearch={() => setTradeSearchInput('')}
        onToggleMobileFilters={() => setMobileTradeFiltersOpen((isOpen) => !isOpen)}
        onPairFilterChange={setTradePairFilter}
        onTypeFilterChange={(value) => setTradeTypeFilter(value as TradeDeskTypeFilter)}
        onSortModeChange={(value) => setTradeSortMode(value as TradeDeskSortMode)}
        onClearFilters={clearTradeDeskFilters}
      />
      {onOpenAppHelp && contextualAppHelpReason ? (
        <div className="p2p-contextual-help">
          <span>Need help with this readiness step?</span>
          <button type="button" onClick={() => onOpenAppHelp(contextualAppHelpReason)}>
            Get help
          </button>
        </div>
      ) : null}

      {showSwapSurface ? (
        <OtcSwapPanel
          tradeEntryModeTabs={tradeEntryModeTabs}
          actionMode={swapActionMode}
          linkedActionModes={swapLinkedActionModes}
          orderLinkInput={swapOrderLinkInput}
          orderLinkError={swapOrderLinkError}
          pinnedTradeKey={swapPinnedTradeKey}
          pinnedTrade={swapPinnedTrade}
          sellBalanceLabel={swapSellBalanceLabel}
          sellBalanceTitle={swapSellBalanceTitle}
          sellAmountInput={swapSellAmountInput}
          sellTokenSelection={swapSellTokenSelection}
          sellVerifyUrl={swapSellVerifyUrl}
          buyAmountInput={swapBuyAmountInput}
          buyTokenSelection={swapBuyTokenSelection}
          buyVerifyUrl={swapBuyVerifyUrl}
          tokenOptions={swapTokenOptions}
          displayQuote={swapDisplayQuote}
          bestQuote={swapBestQuote}
          carbonReference={swapCarbonReference}
          priceDisplayInverted={swapPriceDisplayInverted}
          marketLabel={swapChainWhisperMarketLabel}
          reviewDisabled={swapReviewDisabled}
          reviewLabel={swapReviewLabel}
          onActionModeChange={changeSwapActionMode}
          onSubmitOrderLink={openSwapOrderFromInput}
          onOrderLinkInputChange={updateSwapOrderLinkInput}
          onClearPinnedOrder={clearSwapPinnedOrder}
          onSellAmountInputChange={updateSwapSellAmountInput}
          onBuyAmountInputChange={updateSwapBuyAmountInput}
          onTokenSelectionChange={ensureDistinctSwapTokenSelection}
          onFlipTokens={flipSwapTokens}
          onTogglePriceInverted={() => setSwapPriceDisplayInverted((value) => !value)}
          onCreateLimitOrder={openLimitOrderFromSwapPair}
          onBrowseDesk={() => navigateToTradePath('/otc/desk')}
          onExecuteQuote={executeSwapQuote}
          onOpenCurrentOrder={openSwapCurrentOrderInTerminal}
          formatAvailability={formatSwapAvailability}
        />
      ) : null}
      {showAgentSurface ? (
        <TradeAgentPanel
          mode={tradeAgentPanelMode}
          onModeChange={setTradeAgentPanelMode}
          helpMessages={appHelpMessages}
          helpLoading={appHelpLoading}
          helpMessagesEndRef={appHelpMessagesEndRef}
          helpError={appHelpError}
          helpQuickQuestions={appHelpQuickQuestions}
          helpPrompt={appHelpPrompt}
          helpCanSubmit={Boolean(!appHelpLoading && appHelpPrompt.trim())}
          helpCanRetry={appHelpCanRetry}
          onAskHelpQuestion={askAppHelpQuestion}
          onRetryHelpQuestion={retryAppHelpQuestion}
          onHelpPromptChange={updateAppHelpPrompt}
          onHelpSubmit={submitAppHelp}
          feeLabel={tradeAgentFeeLabel}
          messages={tradeAgentMessages}
          loading={tradeAgentLoading}
          status={tradeAgentStatus}
          messagesEndRef={tradeAgentMessagesEndRef}
          error={tradeAgentError}
          quickActions={visibleTradeAgentQuickActions}
          prompt={tradeAgentPrompt}
          canSubmitRequest={Boolean(
            !tradeAgentLoading && tradeAgentPrompt.trim()
          )}
          retryPaymentTxHash={tradeAgentRetryPaymentTxHash}
          canUseAction={canUseTradeAgentAction}
          getActionButtonLabel={getTradeAgentActionButtonLabel}
          getActionDescription={getTradeAgentActionDescription}
          getActionCta={getTradeAgentActionCta}
          resolveQuickActionPrompt={resolveTradeAgentQuickActionPrompt}
          onApplyAction={applyTradeAgentAction}
          onActionError={setTradeAgentError}
          onSelectQuickAction={selectTradeAgentQuickAction}
          onPromptChange={updateTradeAgentPrompt}
          onSubmit={submitTradeAgentRequest}
        />
      ) : null}

      {showPublicSurface ? (
        <TradePublicOffersSection
          filteredPublicTrades={filteredPublicTrades}
          hasActiveDeskFilters={hasActiveDeskFilters}
          loadingPublicTrades={loadingPublicTrades}
          publicTradesCount={publicTrades.length}
          publicTradesError={publicTradesError}
          selectedTradeKey={detailTrade ? getSnapshotKey(detailTrade) : ''}
          onClearFilters={clearTradeDeskFilters}
          onCreateOffer={startFreshOneOffTrade}
          onRefreshPublicTrades={() => refreshPublicTrades().catch(() => {})}
          {...tradeOrderCardProps}
        />
      ) : null}

      {isComposerRoute ? (
        <section className="standalone-trade-create-panel p2p-trade-workspace-panel">
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
                    : 'New limit order'}
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
                  <button type="button" onClick={openEmptyTerminalPanel}>
                    Order
                  </button>
                  <button type="button" onClick={() => navigateToTradePath('/otc/desk')}>
                    Open Desk
                  </button>
                </>
              )
            : null}
          {!isCounterRouteWithoutParent && !editingTrade && !editingRecurringOrder && !counterParentTrade ? (
            <div className="p2p-trade-entry-mode-slot">{tradeEntryModeTabs}</div>
          ) : null}
          {!isCounterRouteWithoutParent ? (tradeCreateMode === 'recurring' && !editingTrade && !counterParentTrade ? (
            <TradeRecurringComposerPanel
              actionNotice={composerActionNotice}
              copyWithFeedback={copyWithFeedback}
              createRecurringOrder={createRecurringOrder}
              createdRecurringOrderId={createdRecurringOrderId}
              createdRecurringOrderLink={createdRecurringOrderLink}
              creatingRecurringOrder={creatingRecurringOrder}
              editingRecurringOrder={editingRecurringOrder}
              lastCopiedKey={lastCopiedKey}
              recurringAddBuyBudgetInput={recurringAddBuyBudgetInput}
              recurringAddSellInventoryInput={recurringAddSellInventoryInput}
              recurringBaseToken={recurringBaseToken}
              recurringBuyPriceInput={recurringBuyPriceInput}
              recurringBuyReceiveEditable={recurringBuyReceiveEditable}
              recurringBuyReceiveInput={recurringBuyReceiveInput}
              recurringBuyReceivePreview={recurringBuyReceivePreview}
              recurringComposerCarbonPriceReference={recurringComposerCarbonPriceReference}
              recurringHidePrivateAmounts={recurringHidePrivateAmounts}
              recurringPriceDisplayInverted={recurringPriceDisplayInverted}
              recurringQuoteToken={recurringQuoteToken}
              recurringRemoveBuyBudgetInput={recurringRemoveBuyBudgetInput}
              recurringRemoveSellInventoryInput={recurringRemoveSellInventoryInput}
              recurringSellPriceInput={recurringSellPriceInput}
              recurringSellReceiveEditable={recurringSellReceiveEditable}
              recurringSellReceiveInput={recurringSellReceiveInput}
              recurringSellReceivePreview={recurringSellReceivePreview}
              setRecurringHidePrivateAmounts={setRecurringHidePrivateAmounts}
              setRecurringPriceDisplayInverted={setRecurringPriceDisplayInverted}
              setRecurringRemoveBuyBudgetInput={setRecurringRemoveBuyBudgetInput}
              setRecurringRemoveSellInventoryInput={setRecurringRemoveSellInventoryInput}
              swapRecurringOrderSides={swapRecurringOrderSides}
              tradeFeeEscrowContract={tradeFeeEscrowContract}
              tradeFeeEscrowContractLabel={tradeFeeEscrowContractLabel}
              tradeFeeEscrowContractTitleLabel={tradeFeeEscrowContractTitleLabel}
              tradeOfferBalanceSummaryLabel={tradeComposerModel.tradeOfferBalanceSummaryLabel}
              tradeOfferTokenSelection={tradeOfferTokenSelection}
              tradeOfferVerifyUrl={tradeComposerModel.tradeOfferVerifyUrl}
              tradeRequiredFeeWei={tradeRequiredFeeWei}
              tradeRequestBalanceSummaryLabel={tradeComposerModel.tradeRequestBalanceSummaryLabel}
              tradeRequestTokenSelection={tradeRequestTokenSelection}
              tradeRequestVerifyUrl={tradeComposerModel.tradeRequestVerifyUrl}
              tradeTokenOptions={tradeComposerModel.tradeTokenOptions}
              updateRecurringBuyLiquidityInput={updateRecurringBuyLiquidityInput}
              updateRecurringBuyPriceInput={updateRecurringBuyPriceInput}
              updateRecurringBuyReceiveInput={updateRecurringBuyReceiveInput}
              updateRecurringBuyReversePriceInput={updateRecurringBuyReversePriceInput}
              updateRecurringSellLiquidityInput={updateRecurringSellLiquidityInput}
              updateRecurringSellPriceInput={updateRecurringSellPriceInput}
              updateRecurringSellReceiveInput={updateRecurringSellReceiveInput}
              updateRecurringSellReversePriceInput={updateRecurringSellReversePriceInput}
              onOfferTokenSelectionChange={setTradeOfferTokenSelection}
              onCotiNetwork={onCotiNetwork}
              onRequestTokenSelectionChange={setTradeRequestTokenSelection}
              toggleRecurringBuyReceiveEditable={toggleRecurringBuyReceiveEditable}
              toggleRecurringSellReceiveEditable={toggleRecurringSellReceiveEditable}
              walletAddress={walletAddress}
            />
          ) : (
            <>
          {counterParentTrade ? (
            <TradeCounterParentSummary trade={counterParentTrade} walletAddress={walletAddress} />
          ) : null}
          {tradeComposer}
          <TradeCreatedLinkPanel
            createdTradeId={createdTradeId}
            createdTradeLink={createdTradeLink}
            lastCopiedKey={lastCopiedKey}
            createdTradeCopyKey={createdTradeCopyKey}
            onCopyCreatedTradeLink={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
          />
            </>
          )) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {terminalPanelOpen ? (
        <section className="standalone-trades-section standalone-trade-detail-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Order</p>
              <h2>{terminalPanelTrade || terminalRouteDetailPending ? 'Review order' : OPEN_TERMINAL_LABEL}</h2>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={closeTerminalPanel}>
              Close
            </button>
          </div>
          {emptyTerminalOpen ? (
            <TradeTerminalOpenPanel
              inputRef={tradeLinkInputRef}
              tradeLinkInput={tradeLinkInput}
              onTradeLinkInputChange={setTradeLinkInput}
              onSubmit={openTradeFromInput}
              onOpenDesk={() => navigateToTradePath(buildCurrentTradeSurfacePath('public'))}
              onCreateOffer={() => {
                setEmptyTerminalDrawerOpen(false);
                navigateToTradePath(buildCurrentTradeSurfacePath('create', 'limit'));
              }}
            />
          ) : null}
          {terminalHasTradeContent ? <TradeTerminalSafetyWarning /> : null}
          {createdTradeId !== null && route.view === 'trade' && createdTradeLink && createdTradeId === route.tradeId ? (
            <TradeTerminalCreatedNotice
              createdTradeId={createdTradeId}
              escrowContract={routeEscrowContract ?? tradeFeeEscrowContract}
              resolvedRouteAccessSecret={resolvedRouteAccessSecret}
              lastCopiedKey={lastCopiedKey}
              createdTradeCopyKey={createdTradeCopyKey}
              onCopyCreatedTradeLink={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
            />
          ) : null}
          <TradeTerminalRouteStatus
            routeView={route.view}
            routeError={route.routeError}
            detailTradeError={detailTradeError}
            routeIsRecurringOrder={routeIsRecurringOrder}
            canRetryRouteTrade={routeTradeId !== null}
            loadingDetailTrade={loadingDetailTrade}
            terminalRouteDetailPending={terminalRouteDetailPending}
            tradeAccessBlocked={tradeAccessBlocked}
            onRefreshTradeDetail={() => {
              if (routeTradeId !== null) {
                refreshTradeDetail(routeTradeId, routeEscrowContract).catch(() => {});
              }
            }}
            onFocusTradeLinkInput={focusTradeLinkInput}
            onOpenDesk={() => navigateToTradePath(buildCurrentTradeSurfacePath('public'))}
          />
          {!emptyTerminalOpen && route.view === 'mine' && terminalPanelTrade ? (
            <TradeTerminalRenderer snapshot={terminalPanelTrade} {...tradeTerminalRendererProps} />
          ) : null}
          {!emptyTerminalOpen && route.view === 'trade' && !tradeAccessBlocked && terminalPanelTrade ? (
            <TradeTerminalRenderer snapshot={terminalPanelTrade} {...tradeTerminalRendererProps} />
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {!emptyTerminalOpen && route.view === 'mine' && terminalPanelTrade ? (
        <TradeTerminalHistoryRenderer
          snapshot={terminalPanelTrade}
          terminalHistoryConfigParams={terminalHistoryConfigParams}
          renderActionNotice={renderP2PActionNotice}
        />
      ) : null}
      {!emptyTerminalOpen && route.view === 'trade' && !tradeAccessBlocked && terminalPanelTrade ? (
        <TradeTerminalHistoryRenderer
          snapshot={terminalPanelTrade}
          terminalHistoryConfigParams={terminalHistoryConfigParams}
          renderActionNotice={renderP2PActionNotice}
        />
      ) : null}

      {route.view === 'mine' ? (
        <TradeMyTradesSection
          loadingMyTrades={loadingMyTrades}
          myTradesCount={myTrades.length}
          myTradesError={myTradesError}
          myTradeGroupOptions={myTradeGroupOptions}
          selectedMyTradeGroup={selectedMyTradeGroup}
          selectedTradeKey={selectedMyTradeDetailKey}
          hasActiveDeskFilters={hasActiveDeskFilters}
          canOpenMyTradeTerminal={canOpenMyTradeTerminal}
          openMyTradeTerminal={openMyTradeTerminal}
          onRefreshMyTrades={() => refreshMyTrades().catch(() => {})}
          onSelectGroup={setMyTradeGroupView}
          onClearFilters={clearTradeDeskFilters}
          onCreateOffer={startFreshOneOffTrade}
          {...tradeOrderCardProps}
        />
      ) : null}

      <div className="p2p-footer-links">
        <TradingBalanceDock
          balances={visibleTradingBalances}
          balancesHidden={tradingBalancesHidden}
          walletConnected={Boolean(walletAddress)}
          onOpenContracts={openTradingContractsModal}
          onToggleBalancesHidden={() => setTradingBalancesHidden((hidden) => !hidden)}
        />
      </div>
      <button
        type="button"
        className="p2p-mobile-balance-fab"
        aria-label="Balances"
        aria-haspopup="dialog"
        aria-expanded={showMobileBalancesSheet}
        onClick={() => setShowMobileBalancesSheet(true)}
      >
        <span className="p2p-mobile-balance-fab-icon" aria-hidden="true">
          <WalletCards size={18} strokeWidth={2.1} />
        </span>
      </button>
      <TradingBalancesSheet
        balances={visibleTradingBalances}
        isOpen={showMobileBalancesSheet}
        onClose={() => setShowMobileBalancesSheet(false)}
        walletConnected={Boolean(walletAddress)}
      />
      <TradeActionConfirmModal
        confirmation={tradeActionConfirmation}
        onCancel={() => resolveTradeActionConfirmation(false)}
        onConfirm={() => resolveTradeActionConfirmation(true)}
      />
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
