import type { OnboardInfo } from '@coti-io/coti-ethers';
import { ArrowLeft, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import {
  COTI_NETWORK,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  buildTradeSnapshotKey,
  formatTokenAmount,
  getProviderErrorMessage,
  isWalletAddress,
  mergeOnboardInfo,
  RECURRING_OTC_CONTRACT_ADDRESS,
  shortenAddress,
  type Eip1193Provider,
  type TradeFeeModeSelection,
  type TradeSnapshot
} from '../../../lib/appShared';
import { getPreferredBrowserWalletId, saveWalletPreference } from '../../../lib/appStorage';
import { CURRENT_DEX_DISPLAY_PAIR } from '../../../lib/currentDexDisplay';
import {
  buildWalletAesHealthState,
  clearCotiAesUnlockRequest,
  clearFallbackAesSessionOnboardInfo,
  createWalletScopedSnapAesState,
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
  TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS,
  USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  invertPriceInput,
  type TradePricingField
} from '../../../lib/tradePricing';
import { resolveCanonicalTradeActionSide, resolveDisplayedTradeActionSide } from '../../../lib/tradePerspective';
import {
  fetchRecurringExecutionRowsForWallet,
  fetchTradePartialFillEventsForWallet
} from '../../../lib/appChain';
import {
  hasSessionAesKey,
  resolveTradingBrowserWalletState
} from '../../../lib/walletSession';
import useP2PTradeRoute, {
  buildPrivateLiquidityPositionPath,
  buildPrivateLiquidityWorkspacePath,
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
import useP2PTradeTokenData, {
  OTC_V2_BACKGROUND_TOKEN_INFO_LOAD_OPTIONS
} from '../hooks/useP2PTradeTokenData';
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
import useRecurringTradeV2Data from '../hooks/useRecurringTradeV2Data';
import useOneOffTradeV2Data from '../hooks/useOneOffTradeV2Data';
import useOtcTradeHistoryV2Data from '../hooks/useOtcTradeHistoryV2Data';
import useP2PSyncQueue from '../hooks/useP2PSyncQueue';
import useP2PTradeFundingPreflight from '../hooks/useP2PTradeFundingPreflight';
import useP2PPrivateTradeEnrichment from '../hooks/useP2PPrivateTradeEnrichment';
import useP2PTradeEntryNavigation from '../hooks/useP2PTradeEntryNavigation';
import useTerminalAssetBalanceLabel from '../hooks/useTerminalAssetBalanceLabel';
import usePrivateLiquidityWorkspaceData from '../hooks/usePrivateLiquidityWorkspaceData';
import usePrivateLiquidityDailyPriceData from '../hooks/usePrivateLiquidityDailyPriceData';
import usePrivateLiquiditySwapAction from '../hooks/usePrivateLiquiditySwapAction';
import usePrivateLiquidityPositionAction from '../hooks/usePrivateLiquidityPositionAction';
import usePrivateLiquidityHiddenIntentAction from '../hooks/usePrivateLiquidityHiddenIntentAction';
import usePrivateLiquidityHiddenIntentOwnerData from '../hooks/usePrivateLiquidityHiddenIntentOwnerData';
import usePrivateLiquidityOwnerData from '../hooks/usePrivateLiquidityOwnerData';
import useTradePricingSync from '../hooks/useTradePricingSync';
import useTradeTerminalLinkActions from '../hooks/useTradeTerminalLinkActions';
import LinkTradeV2Terminal from './LinkTradeV2Terminal';
import LinkTradeV2FillControls from './LinkTradeV2FillControls';
import CounterTradeV2Controls from './CounterTradeV2Controls';
import TradeBalanceDisclosureV2 from './TradeBalanceDisclosureV2';
import type { TradeBalanceDisclosureV2Runtime } from '../../../lib/tradeBalanceDisclosureV2';
import type { TradeBalanceDisclosureProtocol } from '../../../lib/currentP2PBinding';
import CounterTradeV2Activity, { useCounterTradeV2Activity } from './CounterTradeV2Activity';
import LinkTradeV2Activity, { useLinkTradeV2Activity } from './LinkTradeV2Activity';
import LinkTradeV2CreationRecoveryPanel from './LinkTradeV2CreationRecoveryPanel';
import PrivateBookV2RecoveryPanel from './PrivateBookV2RecoveryPanel';
import LinkTradeV2OwnerControls from './LinkTradeV2OwnerControls';
import useTradeDeskSelectionActions from '../hooks/useTradeDeskSelectionActions';
import useCloseTradeTerminalPanel from '../hooks/useCloseTradeTerminalPanel';
import useBlockTimestampCache from '../../../shared/hooks/useBlockTimestampCache';
import useVisualViewportKeyboardOpen from '../../../shared/hooks/useVisualViewportKeyboardOpen';
import { useStoredWalletPreference } from '../../wallet/hooks/useStoredWalletPreference';
import {
  buildWalletReadAccountsKey,
  getTradeAccountPerspectiveAddress,
  getWalletActionAccount,
  getWalletOwnerAccount,
  resolveTradeActionWalletAddress as resolveTradeActionWalletAddressForScope,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import { type OtcSwapInputMode, type OtcSwapQuoteCandidate } from '../../../lib/otcSwapQuote';
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
import { resolveTradeAgentReadiness } from '../../../lib/tradeAgentReadiness';
import { PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG } from '../../../lib/privateLiquidityV2Deployment';
import { findOtcV2Deployment, OTC_V2_DEPLOYMENT_CATALOG } from '../../../lib/otcV2DeploymentCatalog';
import { buildPrivateLiquidityPairKey } from '../../../lib/privateLiquidity';
import {
  buildPrivateLiquidityDailyPriceDemoSeries,
  derivePrivateLiquidityDailyPriceDemoSeed,
  selectPrivateLiquidityDailyPricePresentation
} from '../../../lib/privateLiquidityDailyPrice';
import { buildPrivateLiquidityPositionToken } from '../../../lib/privateLiquidityPositionFlow';
import { getAppHelpReadinessTopicId, type AppHelpReason } from '../../../lib/appHelpLaunch';
import {
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage
} from '../../../lib/walletTransactionFlow';
import OtcOffersPanel from './OtcOffersPanel';
import PrivateLiquiditySwapPanel, {
  type PrivateLiquiditySwapHistoryRowView
} from './PrivateLiquiditySwapPanel';
import PrivateLiquidityWorkspace from './PrivateLiquidityWorkspace';
import {
  canEditPublicTrade,
  filterAndSortTradeDesk,
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
import TradeAccessSettings from './TradeAccessSettings';
import TradeActionConfirmModal from './TradeActionConfirmModal';
import TradeAgentPanel from './TradeAgentPanel';
import TradeCounterParentSummary from './TradeCounterParentSummary';
import { DexViewTabs, TradeEntryModeTabs, TradeViewTabs } from './TradeDeskTabs';
import TradeMarketOverviewPanel from './TradeMarketOverviewPanel';
import TradeMyTradesSection from './TradeMyTradesSection';
import {
  type TradeOrderCardProps
} from './TradeOrderLists';
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
  TradeTerminalRouteStatus
} from './TradeTerminalDrawerPanels';
import TestnetTokenAdmissionPanel from './TestnetTokenAdmissionPanel';
import TestnetTokenFaucetPanel from './TestnetTokenFaucetPanel';
import TestnetQaChecklist from './TestnetQaChecklist';
import TradeComposerPanel from './TradeComposerPanel';
import {
  resolveTerminalHistoryMergeWalletKey,
  resolveTerminalHistoryWallet,
  type TerminalHistoryConfigParams
} from './tradeTerminalHistoryConfig';

import {
  EMPTY_STALE_TOKEN_ADDRESSES,
  OPEN_TERMINAL_LABEL,
  buildOtcV2DataScopeKey,
  buildMakerControlsKey,
  mergeOnboardInfoByAddress,
  onboardInfoEqual,
  renderP2PEmptyState,
  type MakerControlsSurface,
  type MyTradeGroupView,
  type P2PTradingPageProps,
  type TerminalFillInputSide,
  type TerminalReturnSurface,
  type TradeCreateMode,
  type TradeFilterRouteScope,
  type TradeSigner,
  type TradeVisibility
} from './P2PTradingPage.helpers';

const buildApprovedOffersQaCandidates = (): OtcSwapQuoteCandidate[] => {
  const scale = 10n ** 18n;
  const token = (symbol: 'cwTPB' | 'cwTPQ', addressSuffix: string) => ({
    kind: 'private-erc20' as const,
    tokenAddress: `0x${addressSuffix.repeat(40)}`,
    symbol,
    decimals: 18,
    key: `private-erc20:0x${addressSuffix.repeat(40)}`
  });
  const sellToken = token('cwTPQ', '1');
  const buyToken = token('cwTPB', '2');
  const candidate = (
    tradeId: number,
    rate: string,
    payment: string,
    availability: OtcSwapQuoteCandidate['availability']
  ): OtcSwapQuoteCandidate => {
    const escrowContract = availability.kind === 'terminal'
      ? PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
      : TRADE_ESCROW_CONTRACT_ADDRESS;
    const offeredAmountWei = availability.kind === 'known' ? availability.maxBuyAmountWei : 800n * scale;
    const requestedAmountWei = offeredAmountWei * BigInt(rate.replace('.', '')) / 10_000n;
    const estimatedPaymentWei = BigInt(payment.replace('.', '')) * scale / 100n;
    const trade = {
      tradeId,
      escrowContract,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x0000000000000000000000000000000000000000',
      offer: { ...buyToken, amount: offeredAmountWei.toString() },
      request: { ...sellToken, amount: requestedAmountWei.toString() },
      createdAt: 1_787_328_000,
      expiresAt: 0,
      status: 'open',
      isPublic: availability.kind === 'known',
      hasAccessHash: availability.kind === 'terminal',
      hiddenLiquidity: availability.kind === 'terminal'
    } as TradeSnapshot;
    return {
      trade,
      tradeId,
      tradeKey: getSnapshotKey(trade),
      escrowContract,
      sourceType: 'standard',
      sellToken,
      buyToken,
      requestedSellAmountWei: estimatedPaymentWei,
      requestedBuyAmountWei: 500n * scale,
      estimatedSellAmountWei: estimatedPaymentWei,
      estimatedBuyAmountWei: 500n * scale,
      complete: true,
      price: BigInt(rate.replace('.', '')) * scale / 10_000n,
      priceScale: scale,
      availability,
      terminalPrefill: { kind: 'standard', inputSide: 'buy', amountWei: 500n * scale }
    };
  };
  return [
    candidate(91, '0.2512', '125.60', {
      kind: 'known', maxBuyAmountWei: 1_250n * scale, maxSellAmountWei: 314n * scale
    }),
    candidate(92, '0.2480', '124.00', { kind: 'terminal' }),
    candidate(93, '0.2441', '122.05', {
      kind: 'known', maxBuyAmountWei: 2_400n * scale, maxSellAmountWei: 586n * scale
    })
  ];
};

const buildApprovedManagementQaTrades = (
  walletAddress: string,
  candidates: readonly OtcSwapQuoteCandidate[]
): TradeSnapshot[] => {
  const [marketOffer, privateOffer, bestOffer] = candidates;
  if (!marketOffer || !privateOffer || !bestOffer || !walletAddress) return [];
  const peerA = '0x1111111111111111111111111111111111111111';
  const peerB = '0x2222222222222222222222222222222222222222';
  const openTaker = '0x0000000000000000000000000000000000000000';
  return [
    {
      ...privateOffer.trade,
      tradeId: 201,
      maker: peerA,
      taker: walletAddress,
      createdAt: 1_787_472_000,
      status: 'open',
      isPublic: false,
      hasAccessHash: false
    },
    {
      ...bestOffer.trade,
      tradeId: 202,
      maker: walletAddress,
      taker: openTaker,
      createdAt: 1_787_468_400,
      status: 'open',
      isPublic: true
    },
    {
      ...marketOffer.trade,
      tradeId: 203,
      maker: walletAddress,
      taker: peerB,
      createdAt: 1_787_382_000,
      status: 'accepted',
      isPublic: false
    },
    {
      ...bestOffer.trade,
      tradeId: 204,
      maker: peerB,
      taker: walletAddress,
      createdAt: 1_787_295_600,
      status: 'cancelled',
      isPublic: false
    }
  ];
};

export default function P2PTradingPage({
  renderTradingHeader,
  isMobileNav = false,
  priceDisplayInverted,
  onPriceDisplayInvertedChange,
  sharedWalletSession,
  linkTradeV2ReadContext,
  appHelpLaunchContext,
  onAppHelpLaunchConsumed,
  onOpenAppHelp,
  onOpenInternalAppLink,
  onOpenTradeConversation
}: P2PTradingPageProps) {
  const designQaParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  const approvedOffersDesignQa = import.meta.env.DEV && designQaParams?.get('designQa') === 'approved-offers';
  const approvedOffersQaState = approvedOffersDesignQa
    ? designQaParams?.get('offersState') ?? 'ready'
    : 'ready';
  const approvedOffersQaActionState = approvedOffersDesignQa && [
    'wallet',
    'pending',
    'success',
    'error',
    'uncertain'
  ].includes(designQaParams?.get('actionState') ?? '')
    ? designQaParams?.get('actionState') as 'wallet' | 'pending' | 'success' | 'error' | 'uncertain'
    : null;
  const offersQaHidesCandidates = approvedOffersDesignQa && [
    'loading',
    'error',
    'empty',
    'stale'
  ].includes(approvedOffersQaState);
  const approvedOffersQaCandidates = useMemo<OtcSwapQuoteCandidate[]>(
    () => approvedOffersDesignQa ? buildApprovedOffersQaCandidates() : [],
    [approvedOffersDesignQa]
  );
  const mobileKeyboardOpen = useVisualViewportKeyboardOpen(isMobileNav);
  const {
    buildTradeShareUrl,
    navigateToTradePath,
    openTrade,
    rememberTradeTerminalReturn,
    route,
    showEmptyTradeRoute
  } = useP2PTradeRoute();
  const navigateTestnetQaJourney = useCallback((path: string) => {
    if (path.startsWith('/otc')) {
      navigateToTradePath(path);
      return;
    }
    window.history.pushState(window.history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, [navigateToTradePath]);
  const { resolveBlockTimestampMap } = useBlockTimestampCache();
  const walletPreference = useStoredWalletPreference();
  const preferredBrowserWalletId = getPreferredBrowserWalletId(walletPreference);
  const initialSharedWalletAddress = sharedWalletSession?.walletAddress.trim() ?? '';
  const initialSharedBrowserWallet =
    sharedWalletSession?.activeSignerSource === 'metamask' ? sharedWalletSession : null;
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
  const [connectingWalletId] = useState('');
  const [localConnectedWalletLabel, setConnectedWalletLabel] = useState(
    () => initialSharedBrowserWallet?.browserWalletLabel || 'Wallet'
  );
  const [onboardInfoByAddress, setOnboardInfoByAddress] = useState<Record<string, OnboardInfo>>(
    () => sharedWalletSession?.sessionOnboardInfo ?? {}
  );
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeCreateMode, setTradeCreateMode] = useState<TradeCreateMode>('one-off');
  const [tradeVisibility, setTradeVisibility] = useState<TradeVisibility>('public');
  const [directTradeRecipient, setDirectTradeRecipient] = useState('');
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>(
    USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
      ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateBase
      : PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>(
    USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
      ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateQuote
      : PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapSellTokenSelection, setSwapSellTokenSelection] = useState<TradeTokenPresetKey>(
    USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
      ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateQuote
      : PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapBuyTokenSelection, setSwapBuyTokenSelection] = useState<TradeTokenPresetKey>(
    USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
      ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateBase
      : PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase()
  );
  const [swapSellAmountInput, setSwapSellAmountInput] = useState('');
  const [swapBuyAmountInput, setSwapBuyAmountInput] = useState(() => approvedOffersDesignQa ? '500' : '');
  const [swapInputMode, setSwapInputMode] = useState<OtcSwapInputMode>('buy');
  const [swapActionMode, setSwapActionMode] = useState<OtcSwapInputMode>('buy');
  const [localSwapPriceDisplayInverted, setLocalSwapPriceDisplayInverted] = useState(false);
  const swapPriceDisplayInverted = priceDisplayInverted ?? localSwapPriceDisplayInverted;
  const setSwapPriceDisplayInverted = useCallback((update: SetStateAction<boolean>) => {
    const next = typeof update === 'function' ? update(swapPriceDisplayInverted) : update;
    if (onPriceDisplayInvertedChange) {
      onPriceDisplayInvertedChange(next);
      return;
    }
    setLocalSwapPriceDisplayInverted(next);
  }, [onPriceDisplayInvertedChange, swapPriceDisplayInverted]);
  const recurringPriceDisplayInverted = swapPriceDisplayInverted;
  const [privateLiquiditySlippageBps, setPrivateLiquiditySlippageBps] = useState(500);
  const [privateLiquidityMinimumFillBps, setPrivateLiquidityMinimumFillBps] = useState(0);
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradePriceInput, setTradePriceInput] = useState('');
  const [tradePricingEditedFields, setTradePricingEditedFields] = useState<TradePricingField[]>([]);
  const [tradeHasNoExpiry, setTradeHasNoExpiry] = useState(false);
  const [recurringBuyPriceInput, setRecurringBuyPriceInput] = useState('');
  const [recurringSellPriceInput, setRecurringSellPriceInput] = useState('');
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
  const [linkOwnerActionState, setLinkOwnerActionState] = useState<{ wallet: string; busy: boolean } | null>(null);
  const [tradeLinkInput, setTradeLinkInput] = useState('');
  const [swapOrderLinkInput, setSwapOrderLinkInput] = useState('');
  const [swapPinnedTradeKey, setSwapPinnedTradeKey] = useState('');
  const [swapOrderLinkError, setSwapOrderLinkError] = useState('');
  const [recurringTerminalSide, setRecurringTerminalSide] = useState<RecurringTerminalActionSide>('buy');
  const [terminalFillInputSide, setTerminalFillInputSide] = useState<TerminalFillInputSide>('pay');
  const [terminalPayInput, setTerminalPayInput] = useState('');
  const [terminalBuyInput, setTerminalBuyInput] = useState('');
  const [terminalHistorySheetKey, setTerminalHistorySheetKey] = useState('');
  const [terminalPanelTab, setTerminalPanelTab] = useState<'overview' | 'activity'>('overview');
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
  const appliedDesignQaActionStateRef = useRef('');
  useEffect(() => {
    if (!approvedOffersQaActionState || appliedDesignQaActionStateRef.current === approvedOffersQaActionState) {
      return;
    }
    appliedDesignQaActionStateRef.current = approvedOffersQaActionState;
    pushActionNotice({
      action: 'fill',
      status: approvedOffersQaActionState,
      surface: 'terminal',
      message: approvedOffersQaActionState === 'error'
        ? 'Wallet rejected the request. No transaction was submitted.'
        : approvedOffersQaActionState === 'uncertain'
          ? 'Transaction submitted, but COTI confirmation timed out. Check wallet activity before retrying.'
          : undefined
    });
  }, [approvedOffersQaActionState, pushActionNotice]);
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

  const providerRef = useRef<Eip1193Provider | null>(initialSharedBrowserWallet?.browserProvider ?? null);
  const signerCacheRef = useRef<Record<string, TradeSigner>>({});
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
  const privateLiquidityWalletAddress =
    sharedWalletSession?.activeSignerSource === 'metamask'
      ? sharedWalletSession.walletAddress
      : null;
  const privateLiquidityData = usePrivateLiquidityWorkspaceData({
    enabled: route.view === 'pools' || (
      route.view === 'swap' && route.swapVenue === 'private-liquidity'
    ),
    config: PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG,
    walletAddress: privateLiquidityWalletAddress,
    selectedPositionId: route.privateLiquidityPositionId
  });
  const privateLiquidityWalletReady = Boolean(
    PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG.status === 'active' &&
    privateLiquidityWalletAddress &&
    sharedWalletSession?.chainId?.toString() === PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG.manifest.chainId &&
    sharedWalletSession?.activeSignerSource === 'metamask' &&
    sharedWalletActions?.getPrivateLiquidityCapability
  );
  const privateLiquidityOwnerData = usePrivateLiquidityOwnerData({
    deployment: privateLiquidityData.deployment,
    model: privateLiquidityData.model,
    historyPages: privateLiquidityData.historyPages,
    walletAddress: privateLiquidityWalletAddress,
    walletReady: privateLiquidityWalletReady,
    walletActions: sharedWalletActions
  });
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
  const sharedWalletKey = sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '';
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
  const walletHasAes = hasSessionAesKey(walletKey, effectiveOnboardInfoByAddress) || sharedWalletHasAes;
  const walletReadAccounts = useMemo(
    () =>
      sharedWalletSession?.walletReadAccounts?.length
        ? sharedWalletSession.walletReadAccounts
        : walletKey
          ? [
              {
                address: walletKey,
                canReadPrivate: walletHasAes,
                isActionAccount: true,
                key: walletKey,
                label: 'Connected wallet',
                role: 'owner' as const
              }
            ]
          : [],
    [sharedWalletSession?.walletReadAccounts, walletHasAes, walletKey]
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
    walletKey,
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
          walletAddress: walletKey
        });
        // Fast refresh can preserve a state object created before
        // staleTokenAddresses was added. Treat that legacy shape as empty so
        // privacy status updates cannot crash an already-open OTC page.
        const currentStaleTokenAddresses = current?.staleTokenAddresses ?? EMPTY_STALE_TOKEN_ADDRESSES;
        const unchanged =
          current?.sessionKey === next.sessionKey &&
          current.walletKey === next.walletKey &&
          current.status === next.status &&
          currentStaleTokenAddresses.length === next.staleTokenAddresses.length &&
          currentStaleTokenAddresses.every((address, index) => address === next.staleTokenAddresses[index]);
        return unchanged ? current : next;
      });
    },
    [effectiveBrowserProvider, walletKey]
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
    if (route.view === 'trade' && route.tradeId === null && !route.linkV2Reference) {
      setEmptyTerminalDrawerOpen(true);
      return;
    }
    if (route.view === 'trade' || route.view === 'create' || route.view === 'counter') {
      setEmptyTerminalDrawerOpen(false);
    }
  }, [route.linkV2Reference, route.tradeId, route.view]);
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
    effectiveBrowserProvider,
    flushQueuedTradeDataRefreshRef,
    selectedWalletId,
    sharedBrowserWalletId: sharedWalletSession?.browserWalletId,
    sharedRunWalletTransactionFlow: sharedWalletActions?.runWalletTransactionFlow,
    walletAddress: walletKey
  });
  const directTradeRecipientNormalized = directTradeRecipient.trim();
  const directTradeRecipientIsValid =
    directTradeRecipientNormalized.length > 0 && isWalletAddress(directTradeRecipientNormalized);

  useEffect(() => {
    if (preferredBrowserWalletId && !walletKey && !connectingWalletId) {
      setSelectedWalletId(preferredBrowserWalletId);
    }
  }, [connectingWalletId, preferredBrowserWalletId, walletKey]);

  useEffect(() => {
    let cancelled = false;
    const provider = effectiveBrowserProvider;

    if (sharedWalletActionsAvailable) {
      const sharedStatus: CotiSnapAesStatus = sharedWalletAesHealth?.status === 'key-mismatch'
        ? 'key-mismatch'
        : sharedWalletAesHealth?.status === 'repair-needed'
          ? 'repair-needed'
          : walletHasAes
            ? 'installed-aes-ready'
            : 'unknown';
      if (cotiSnapAesStatus !== sharedStatus) {
        setActiveCotiSnapAesStatus(sharedStatus);
      }
      return () => {
        cancelled = true;
      };
    }

    if (!walletAddress) {
      if (cotiSnapAesStatus !== 'unknown') {
        setActiveCotiSnapAesStatus('unknown');
      }
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
    cotiSnapAesStatus,
    effectiveBrowserProvider,
    setActiveCotiSnapAesStatus,
    sharedWalletActionsAvailable,
    sharedWalletAesHealth?.status,
    walletAddress,
    walletHasAes
  ]);

  useEffect(() => {
    const provider = effectiveBrowserProvider;
    if (
      sharedWalletActionsAvailable ||
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
    effectiveBrowserProvider,
    setActiveCotiSnapAesStatus,
    sharedWalletActionsAvailable,
    sharedWalletSession,
    walletAddress,
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
      if (sharedWalletSession && walletAddress && !connectingWalletId) {
        if (isWalletTransactionFlowActive(getTradeWalletFlowInput())) {
          recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-shared-empty-ignored');
          return;
        }
        providerRef.current = null;
        signerCacheRef.current = {};
        setWalletAddress('');
        setChainId(null);
        setConnectedWalletLabel('Wallet');
        setSelectedWalletId('');
        setWalletError('');
      }
      return;
    }
    const sharedBrowserIsNotLocal =
      !sharedWalletActionsAvailable &&
      sharedWalletSession?.activeSignerSource === 'metamask' &&
      Boolean(sharedWalletSession.browserProvider) &&
      (
        providerRef.current !== sharedWalletSession.browserProvider ||
        walletKey !== sharedWalletKey
      );
    const shouldApplySharedWallet = !walletAddress || sharedBrowserIsNotLocal;

    if (sharedAddress && sharedWalletKey === walletKey) {
      mergeSharedOnboardInfo();
    }

    if (
      !sharedAddress ||
      !shouldApplySharedWallet ||
      connectingWalletId
    ) {
      return;
    }

    if (
      !sharedWalletActionsAvailable &&
      sharedWalletSession?.activeSignerSource === 'metamask' &&
      sharedWalletSession.browserProvider
    ) {
      providerRef.current = sharedWalletSession.browserProvider;
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
    }
  }, [
    connectingWalletId,
    getTradeWalletFlowInput,
    onboardInfoByAddress,
    sharedWalletSession?.activeSignerSource,
    sharedWalletSession?.browserProvider,
    sharedWalletSession?.browserWalletId,
    sharedWalletSession?.browserWalletLabel,
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

  const getTradeSigner = useP2PTradeSigner({
    chainId,
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
      const signer = await sharedWalletActions?.getOwnerSigner?.(requireAes);
      if (!signer || signer.address.toLowerCase() !== targetKey) {
        throw new Error('The connected owner wallet changed. Reopen this trade and try again.');
      }
      return signer;
    },
    [
      getTradeSigner,
      sharedWalletActions,
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

      const perspectiveAddress = resolveTerminalHistoryWallet(snapshot, { walletAddress: walletKey, walletReadAccounts }).walletAddress ||
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
    [actionWalletAccount, ownerWalletKey, walletKey, walletOwnerAccount, walletReadAccounts]
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
        selectedWalletId || 'browser',
        walletHasAes ? 'aes' : 'locked'
      ].join(':'),
    [chainId, selectedWalletId, walletHasAes, walletKey]
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
    loadCustomTokenInfo,
    nativeBalanceWei,
    privateRewardTokenBalanceState,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    refreshWalletBalances,
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
    tradeRequiredFeeOverrideWei: OTC_V2_DEPLOYMENT_CATALOG.status === 'active' ? 0n : undefined,
    walletAddress,
    walletHasAes,
    walletKey
  });
  const ensureRecurringV2TokenInfo = useCallback(
    // V2 list refreshes are background reconciliation. Keep the last verified
    // token metadata visible while it is revalidated so order cards do not
    // disappear and reappear on every sync cycle.
    (request: Parameters<typeof loadCustomTokenInfo>[0]) => loadCustomTokenInfo(
      request,
      OTC_V2_BACKGROUND_TOKEN_INFO_LOAD_OPTIONS
    ),
    [loadCustomTokenInfo]
  );
  const linkActivity = useLinkTradeV2Activity({ runtime: sharedWalletSession?.otcV2ActionRuntime?.link, ownerAddress: walletKey,
    enabled: route.view === 'mine' && walletHasAes, ensureTokenInfo: ensureRecurringV2TokenInfo });
  const counterActivity = useCounterTradeV2Activity({ runtime: sharedWalletSession?.otcV2ActionRuntime?.counter, ownerAddress: walletKey,
    enabled: route.view === 'mine' && walletHasAes, ensureTokenInfo: ensureRecurringV2TokenInfo });
  const otcV2DataScopeKey = buildOtcV2DataScopeKey({
    deploymentFingerprint: OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
      ? OTC_V2_DEPLOYMENT_CATALOG.fingerprint
      : OTC_V2_DEPLOYMENT_CATALOG.status,
    walletAddress,
    walletKey
  });
  const {
    activeRecurringV2Trades,
    loadingRecurringV2Trades,
    myRecurringV2Trades,
    recurringV2TradesError,
    refreshRecurringV2Trades
  } = useRecurringTradeV2Data({
    runtime: sharedWalletSession?.otcV2ActionRuntime,
    walletAddress,
    dataScopeKey: otcV2DataScopeKey,
    privateReadsEnabled: walletHasAes,
    includePublicDiscovery: route.view !== 'mine',
    tokenInfoByKey: customTradeTokenInfoByAddress,
    ensureTokenInfo: ensureRecurringV2TokenInfo
  });
  const routeOneOffReference = useMemo(() => {
    if (routeTradeId === null || !routeEscrowContract || !chainId) return undefined;
    const deployment = OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
      ? findOtcV2Deployment(OTC_V2_DEPLOYMENT_CATALOG, OTC_V2_DEPLOYMENT_CATALOG.chainId, routeEscrowContract) : undefined;
    if (!deployment || !['standard-v2', 'private-v2', 'direct-v2'].includes(deployment.protocol)) return undefined;
    return { chainId: String(chainId), contractAddress: routeEscrowContract, orderId: String(routeTradeId) };
  }, [chainId, routeEscrowContract, routeTradeId]);
  const {
    activeOneOffV2Trades,
    loadingOneOffV2Trades,
    myOneOffV2Trades,
    oneOffV2TradesError,
    refreshOneOffV2Trades,
    referencedTrade,
    referencedTradeError,
    loadingReferencedTrade,
    readReferencedTrade
  } = useOneOffTradeV2Data({
    runtime: sharedWalletSession?.otcV2ActionRuntime,
    walletAddress,
    dataScopeKey: otcV2DataScopeKey,
    privateReadsEnabled: walletHasAes,
    includePublicDiscovery: route.view !== 'mine',
    tokenInfoByKey: customTradeTokenInfoByAddress,
    ensureTokenInfo: ensureRecurringV2TokenInfo,
    reference: routeOneOffReference
  });
  const historyContractAddresses = useMemo(() => {
    const catalog = OTC_V2_DEPLOYMENT_CATALOG;
    if (catalog.status !== 'active') return undefined;
    // An explicit old order link can still load its recovery history. Normal views omit legacy scopes.
    if (routeOneOffReference) return [routeOneOffReference.contractAddress];
    if (route.view === 'trade' && routeEscrowContract) {
      const deployment = findOtcV2Deployment(catalog, catalog.chainId, routeEscrowContract);
      if (deployment?.protocol === 'recurring-v2' || deployment?.protocol === 'private-recurring-v2') {
        return [deployment.manifest.contractAddress];
      }
    }
    return (['standard-v2', 'private-v2', 'direct-v2'] as const).map(protocol =>
      catalog.deployments[protocol].manifest.contractAddress);
  }, [route.view, routeEscrowContract, routeOneOffReference]);
  const {
    loadingOtcTradeHistoryV2,
    otcTradeHistoryV2Error,
    otcTradeHistoryV2LifecycleEvents,
    otcTradeHistoryV2Rows,
    refreshOtcTradeHistoryV2
  } = useOtcTradeHistoryV2Data(sharedWalletSession?.otcV2Runtime, otcV2DataScopeKey, historyContractAddresses);
  const {
    combinedBalanceByAssetKey,
    pWispFooterBalanceState,
    resolveFundingBalanceForAsset
  } = useP2PTradingBalances({
    customTradeTokenInfoByAddress,
    isPrivateTokenSnapStale,
    nativeBalanceWei,
    privateRewardTokenBalanceState,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletKey
  });
  const refreshAllTradingBalances = useCallback(
    async (options?: Parameters<typeof refreshWalletBalances>[0]) => refreshWalletBalances(options),
    [refreshWalletBalances]
  );
  const ensureTradeFunding = useP2PTradeFundingPreflight({
    requestTradeActionConfirmation,
    resolveFundingBalanceForAsset
  });
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
    if (!sharedHasNextWalletAes) {
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

  const isOtcV2Contract = useCallback((contract?: string): boolean => Boolean(
    contract &&
    OTC_V2_DEPLOYMENT_CATALOG.status === 'active' &&
    findOtcV2Deployment(OTC_V2_DEPLOYMENT_CATALOG, OTC_V2_DEPLOYMENT_CATALOG.chainId, contract)
  ), []);
  const routeUsesOtcV2 = isOtcV2Contract(routeEscrowContract);

  const {
    detailTrade: legacyDetailTrade,
    detailTradeError: legacyDetailTradeError,
    hasActiveListRefresh,
    loadingDetailTrade: legacyLoadingDetailTrade,
    loadingMyTrades: legacyLoadingMyTrades,
    loadingPublicTrades: legacyLoadingPublicTrades,
    mergeTradeSnapshot,
    myTrades: legacyMyTrades,
    myTradesError: legacyMyTradesError,
    publicTrades: legacyPublicTrades,
    publicTradesError: legacyPublicTradesError,
    readTradeDetail: legacyReadTradeDetail,
    refreshMyTrades: legacyRefreshMyTrades,
    refreshPublicTrades: legacyRefreshPublicTrades,
    refreshTradeDetail: legacyRefreshTradeDetail,
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
    routeTradeId: routeUsesOtcV2 ? null : routeTradeId,
    routeView,
    syncSessionKey: [
      walletKey || 'no-wallet',
      walletReadAccountsKey || 'single-wallet',
      chainId ?? 'no-chain',
      selectedWalletId || 'browser'
    ].join(':'),
    walletAddress,
    walletKey,
    walletReadAccounts
  });

  const mergeExactTradeSnapshots = useCallback((...groups: readonly TradeSnapshot[][]): TradeSnapshot[] => {
    const byKey = new Map<string, TradeSnapshot>();
    for (const snapshot of groups.flat()) {
      byKey.set(buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract), snapshot);
    }
    return Array.from(byKey.values());
  }, []);
  const discoveredMyTrades = useMemo(
    () => mergeExactTradeSnapshots(legacyMyTrades, myRecurringV2Trades, myOneOffV2Trades),
    [legacyMyTrades, mergeExactTradeSnapshots, myOneOffV2Trades, myRecurringV2Trades]
  );
  const myTrades = useMemo(
    () => approvedOffersDesignQa
      ? mergeExactTradeSnapshots(
          discoveredMyTrades,
          buildApprovedManagementQaTrades(walletAddress, approvedOffersQaCandidates)
        )
      : discoveredMyTrades,
    [
      approvedOffersDesignQa,
      approvedOffersQaCandidates,
      discoveredMyTrades,
      mergeExactTradeSnapshots,
      walletAddress
    ]
  );
  const publicTrades = useMemo(
    () => mergeExactTradeSnapshots(legacyPublicTrades, activeRecurringV2Trades, activeOneOffV2Trades),
    [activeOneOffV2Trades, activeRecurringV2Trades, legacyPublicTrades, mergeExactTradeSnapshots]
  );
  const routeV2Trade = useMemo(() => {
    if (routeTradeId === null || !routeEscrowContract) return null;
    const key = buildTradeSnapshotKey(routeTradeId, routeEscrowContract);
    return [...myRecurringV2Trades, ...activeRecurringV2Trades, ...myOneOffV2Trades, ...activeOneOffV2Trades].find(
      (snapshot) => buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract) === key
    ) ?? null;
  }, [activeOneOffV2Trades, activeRecurringV2Trades, myOneOffV2Trades, myRecurringV2Trades, routeEscrowContract, routeTradeId]);
  const approvedOffersQaDetailTrade = approvedOffersDesignQa && routeTradeId !== null
    ? approvedOffersQaCandidates.find((candidate) => candidate.tradeId === routeTradeId)?.trade ?? null
    : null;
  const detailTrade = approvedOffersQaDetailTrade ?? (routeUsesOtcV2 ? (routeOneOffReference ? referencedTrade : routeV2Trade) : legacyDetailTrade);
  const otcV2SetupError = sharedWalletSession?.otcV2RuntimeError ?? '';
  const otcV2TradesError = otcV2SetupError || oneOffV2TradesError || recurringV2TradesError;
  const initializingOtcV2History = Boolean(sharedWalletSession && walletKey && onCotiNetwork &&
    OTC_V2_DEPLOYMENT_CATALOG.status === 'active' && !sharedWalletSession.otcV2Runtime && !otcV2SetupError);
  const initializingOtcV2Actions = Boolean(sharedWalletSession && walletKey && onCotiNetwork &&
    OTC_V2_DEPLOYMENT_CATALOG.status === 'active' && !sharedWalletSession.otcV2ActionRuntime && !otcV2SetupError);
  const loadingOtcV2Trades = initializingOtcV2History || initializingOtcV2Actions || loadingOneOffV2Trades || loadingRecurringV2Trades;
  const detailTradeError = approvedOffersQaDetailTrade
    ? ''
    : routeUsesOtcV2 ? (otcV2SetupError || (routeOneOffReference ? referencedTradeError : otcV2TradesError)) : legacyDetailTradeError;
  const loadingDetailTrade = approvedOffersQaDetailTrade
    ? false
    : routeUsesOtcV2 ? (!otcV2SetupError && (routeOneOffReference ? loadingReferencedTrade : loadingOtcV2Trades)) : legacyLoadingDetailTrade;
  const loadingMyTrades = legacyLoadingMyTrades || loadingOtcV2Trades;
  const loadingPublicTrades = legacyLoadingPublicTrades || loadingOtcV2Trades;
  const myTradesError = legacyMyTradesError || otcV2TradesError;
  const publicTradesError = legacyPublicTradesError || otcV2TradesError;
  const refreshMyTrades = useCallback(async (options?: Parameters<typeof legacyRefreshMyTrades>[0]) => {
    refreshOneOffV2Trades();
    refreshRecurringV2Trades();
    refreshOtcTradeHistoryV2();
    await legacyRefreshMyTrades(options);
  }, [legacyRefreshMyTrades, refreshOneOffV2Trades, refreshOtcTradeHistoryV2, refreshRecurringV2Trades]);
  const refreshPublicTrades = useCallback(async (options?: Parameters<typeof legacyRefreshPublicTrades>[0]) => {
    refreshOneOffV2Trades();
    refreshRecurringV2Trades();
    await legacyRefreshPublicTrades(options);
  }, [legacyRefreshPublicTrades, refreshOneOffV2Trades, refreshRecurringV2Trades]);
  const readTradeDetail = useCallback(async (tradeId: number, escrowContract?: string) => {
    if (isOtcV2Contract(escrowContract)) {
      const deployment = OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
        ? findOtcV2Deployment(OTC_V2_DEPLOYMENT_CATALOG, OTC_V2_DEPLOYMENT_CATALOG.chainId, escrowContract!) : undefined;
      if (deployment && ['standard-v2', 'private-v2', 'direct-v2'].includes(deployment.protocol)) {
        return readReferencedTrade({ chainId: String(chainId), contractAddress: escrowContract!, orderId: String(tradeId) });
      }
      const key = buildTradeSnapshotKey(tradeId, escrowContract);
      return [...myRecurringV2Trades, ...activeRecurringV2Trades, ...myOneOffV2Trades, ...activeOneOffV2Trades].find(
        (snapshot) => buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract) === key
      ) ?? null;
    }
    return legacyReadTradeDetail(tradeId, escrowContract);
  }, [activeOneOffV2Trades, activeRecurringV2Trades, chainId, isOtcV2Contract, legacyReadTradeDetail, myOneOffV2Trades, myRecurringV2Trades, readReferencedTrade]);
  const refreshTradeDetail = useCallback(async (
    tradeId: number,
    escrowContract?: string,
    options?: Parameters<typeof legacyRefreshTradeDetail>[2]
  ) => {
    if (isOtcV2Contract(escrowContract)) {
      const deployment = OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
        ? findOtcV2Deployment(OTC_V2_DEPLOYMENT_CATALOG, OTC_V2_DEPLOYMENT_CATALOG.chainId, escrowContract!) : undefined;
      if (deployment && ['standard-v2', 'private-v2', 'direct-v2'].includes(deployment.protocol)) return readTradeDetail(tradeId, escrowContract);
      refreshOneOffV2Trades();
      refreshRecurringV2Trades();
      return readTradeDetail(tradeId, escrowContract);
    }
    return legacyRefreshTradeDetail(tradeId, escrowContract, options);
  }, [chainId, isOtcV2Contract, legacyRefreshTradeDetail, readTradeDetail, refreshOneOffV2Trades, refreshRecurringV2Trades]);

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
    routeTradeId: routeUsesOtcV2 ? null : routeTradeId,
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
    resolveSwapTokenSelection,
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
  const privateLiquidityTokenOptions = useMemo(
    () => swapTokenOptions.filter((option) => option.kindLabel === 'Private'),
    [swapTokenOptions]
  );
  const privateLiquidityPositionTokens = useMemo(
    () => privateLiquidityTokenOptions.flatMap((option) => {
      const token = resolveSwapTokenSelection(option.value);
      if (!token) return [];
      try {
        return [buildPrivateLiquidityPositionToken({ selection: option.value, token })];
      } catch {
        return [];
      }
    }),
    [privateLiquidityTokenOptions, resolveSwapTokenSelection]
  );
  const [privateLiquidityDailyPricePairKey, setPrivateLiquidityDailyPricePairKey] = useState('');
  const privateLiquidityDailyPriceMarket = useMemo(() => {
    const markets = privateLiquidityData.model?.markets ?? [];
    return markets.find((market) => market.pairKey === privateLiquidityDailyPricePairKey) ?? markets[0];
  }, [privateLiquidityDailyPricePairKey, privateLiquidityData.model]);
  const privateLiquidityDailyPriceFallbackTokens = useMemo(
    () => [...privateLiquidityPositionTokens]
      .sort((left, right) => BigInt(left.address) < BigInt(right.address) ? -1 : 1)
      .slice(0, 2),
    [privateLiquidityPositionTokens]
  );
  const privateLiquidityDailyPriceBaseToken = privateLiquidityDailyPriceMarket
    ? privateLiquidityPositionTokens.find((token) => token.address === privateLiquidityDailyPriceMarket.baseToken)
    : privateLiquidityDailyPriceFallbackTokens[0];
  const privateLiquidityDailyPriceQuoteToken = privateLiquidityDailyPriceMarket
    ? privateLiquidityPositionTokens.find((token) => token.address === privateLiquidityDailyPriceMarket.quoteToken)
    : privateLiquidityDailyPriceFallbackTokens[1];
  const privateLiquidityDailyPriceResolvedPairKey = useMemo(() => {
    if (privateLiquidityDailyPriceMarket) return privateLiquidityDailyPriceMarket.pairKey;
    if (!privateLiquidityDailyPriceBaseToken || !privateLiquidityDailyPriceQuoteToken) return undefined;
    try {
      return buildPrivateLiquidityPairKey(
        privateLiquidityDailyPriceBaseToken.address,
        privateLiquidityDailyPriceQuoteToken.address
      );
    } catch {
      return undefined;
    }
  }, [
    privateLiquidityDailyPriceBaseToken,
    privateLiquidityDailyPriceMarket,
    privateLiquidityDailyPriceQuoteToken
  ]);
  const privateLiquidityDailyPriceData = usePrivateLiquidityDailyPriceData({
    enabled: route.view === 'pools' && (route.privateLiquidityView ?? 'discover') === 'discover',
    pairKey: privateLiquidityDailyPriceResolvedPairKey,
    baseTokenDecimals: privateLiquidityDailyPriceBaseToken?.decimals,
    quoteTokenDecimals: privateLiquidityDailyPriceQuoteToken?.decimals
  });
  const [privateLiquidityDailyPriceDemoEndingDay] = useState(
    () => BigInt(Math.floor(Date.now() / 86_400_000) - 1)
  );
  const privateLiquidityDailyPriceDemoPoints = useMemo(
    () => privateLiquidityDailyPriceResolvedPairKey
      ? buildPrivateLiquidityDailyPriceDemoSeries({
          endingDay: privateLiquidityDailyPriceDemoEndingDay,
          seed: derivePrivateLiquidityDailyPriceDemoSeed(privateLiquidityDailyPriceResolvedPairKey)
        })
      : Object.freeze([]),
    [privateLiquidityDailyPriceDemoEndingDay, privateLiquidityDailyPriceResolvedPairKey]
  );
  const privateLiquidityDailyPricePresentation = useMemo(
    () => selectPrivateLiquidityDailyPricePresentation({
      status: privateLiquidityDailyPriceData.status,
      livePoints: privateLiquidityDailyPriceData.points,
      demoPoints: privateLiquidityDailyPriceDemoPoints
    }),
    [privateLiquidityDailyPriceData.points, privateLiquidityDailyPriceData.status, privateLiquidityDailyPriceDemoPoints]
  );
  const privateLiquidityManagedInventory = useMemo(() => {
    if (privateLiquidityOwnerData.status !== 'available' || !privateLiquidityOwnerData.inventory) {
      return { state: privateLiquidityOwnerData.status === 'unavailable' ? 'unavailable' : 'locked' } as const;
    }
    const selected = privateLiquidityData.model?.selection.status === 'manageable'
      ? privateLiquidityData.model.selection.position
      : undefined;
    const baseToken = selected
      ? privateLiquidityPositionTokens.find((token) => token.address === selected.baseToken)
      : undefined;
    const quoteToken = selected
      ? privateLiquidityPositionTokens.find((token) => token.address === selected.quoteToken)
      : undefined;
    if (!baseToken || !quoteToken) return { state: 'unavailable' } as const;
    return Object.freeze({
      state: 'available' as const,
      baseAmount: formatTokenAmount(BigInt(privateLiquidityOwnerData.inventory.baseAmount), baseToken.decimals, 8),
      quoteAmount: formatTokenAmount(BigInt(privateLiquidityOwnerData.inventory.quoteAmount), quoteToken.decimals, 8)
    });
  }, [
    privateLiquidityData.model,
    privateLiquidityOwnerData.inventory,
    privateLiquidityOwnerData.status,
    privateLiquidityPositionTokens
  ]);
  const privateLiquiditySwapAction = usePrivateLiquiditySwapAction({
    active: route.view === 'swap' && route.swapVenue === 'private-liquidity',
    deployment: privateLiquidityData.deployment,
    model: privateLiquidityData.model,
    sellToken: swapSellToken,
    buyToken: swapBuyToken,
    sellAmountInput: swapSellAmountInput,
    slippageBps: privateLiquiditySlippageBps,
    minimumFillBps: privateLiquidityMinimumFillBps,
    walletReady: privateLiquidityWalletReady,
    walletActions: sharedWalletActions,
    requestConfirmation: requestTradeActionConfirmation,
    refresh: privateLiquidityData.refresh
  });
  const privateLiquiditySwapHistoryRows = useMemo(() => {
    const tokenByAddress = new Map(
      privateLiquidityPositionTokens.map((token) => [token.address.toLowerCase(), token] as const)
    );
    const pairTokens = new Map<string, Readonly<{ baseAddress: string; quoteAddress: string }>>();
    for (const position of privateLiquidityData.model?.positions ?? []) {
      if (!pairTokens.has(position.pairKey)) {
        pairTokens.set(position.pairKey, Object.freeze({
          baseAddress: position.baseToken,
          quoteAddress: position.quoteToken
        }));
      }
    }
    const finalizedRows = [...privateLiquidityOwnerData.history.traderRows]
      .reverse()
      .map((row): PrivateLiquiditySwapHistoryRowView => {
        const pair = pairTokens.get(row.pairKey);
        const baseToken = pair ? tokenByAddress.get(pair.baseAddress.toLowerCase()) : undefined;
        const quoteToken = pair ? tokenByAddress.get(pair.quoteAddress.toLowerCase()) : undefined;
        const inputToken = row.direction === 'base-to-quote' ? baseToken : quoteToken;
        const outputToken = row.direction === 'base-to-quote' ? quoteToken : baseToken;
        const displayAmount = (amount: string, token: typeof inputToken) => token
          ? `${formatTokenAmount(BigInt(amount), token.decimals, 6)} ${token.symbol}`
          : amount;
        return Object.freeze({
          key: row.key,
          swapId: row.swapId,
          pairLabel: baseToken && quoteToken
            ? `${baseToken.symbol} / ${quoteToken.symbol}`
            : `${row.pairKey.slice(0, 10)}…`,
          inputLabel: displayAmount(row.inputAmount, inputToken),
          outputLabel: displayAmount(row.outputAmount, outputToken),
          unusedInputLabel: displayAmount(row.unusedInputAmount, inputToken),
          blockNumber: row.provenance.blockNumber,
          transactionHash: row.provenance.transactionHash,
          status: 'finalized'
        });
      });
    const failedRows = privateLiquiditySwapAction.failedAttempts.map(
      (attempt): PrivateLiquiditySwapHistoryRowView => Object.freeze({
        key: attempt.key,
        pairLabel: `${attempt.inputTokenSymbol} / ${attempt.outputTokenSymbol}`,
        inputLabel: `Attempted ${formatTokenAmount(
          BigInt(attempt.maximumInput),
          attempt.inputTokenDecimals,
          6
        )} ${attempt.inputTokenSymbol}`,
        outputLabel: 'No fill',
        unusedInputLabel: 'No tokens spent',
        transactionHash: attempt.transactionHash,
        status: 'failed',
        failureMessage: attempt.message,
        attemptedAt: attempt.attemptedAt
      })
    );
    const confirmed = privateLiquiditySwapAction.confirmed;
    if (!confirmed || finalizedRows.some(
      (row) => row.transactionHash.toLowerCase() === confirmed.transactionHash.toLowerCase()
    )) {
      return Object.freeze([...failedRows, ...finalizedRows]);
    }
    const confirmedPair = pairTokens.get(confirmed.pairKey);
    const confirmedBaseToken = confirmedPair
      ? tokenByAddress.get(confirmedPair.baseAddress.toLowerCase())
      : undefined;
    const confirmedQuoteToken = confirmedPair
      ? tokenByAddress.get(confirmedPair.quoteAddress.toLowerCase())
      : undefined;
    const confirmedInputToken = confirmed.direction === 'base-to-quote'
      ? confirmedBaseToken
      : confirmedQuoteToken;
    const confirmedOutputToken = confirmed.direction === 'base-to-quote'
      ? confirmedQuoteToken
      : confirmedBaseToken;
    const inputToken = confirmedInputToken ?? swapSellToken;
    const outputToken = confirmedOutputToken ?? swapBuyToken;
    const inputLabel = inputToken
      ? `${formatTokenAmount(BigInt(confirmed.inputAmount), inputToken.decimals, 6)} ${inputToken.symbol}`
      : confirmed.inputAmount;
    const outputLabel = outputToken
      ? `${formatTokenAmount(BigInt(confirmed.outputAmount), outputToken.decimals, 6)} ${outputToken.symbol}`
      : confirmed.outputAmount;
    const unusedInputLabel = inputToken
      ? `${formatTokenAmount(BigInt(confirmed.unusedInputAmount), inputToken.decimals, 6)} ${inputToken.symbol}`
      : confirmed.unusedInputAmount;
    return Object.freeze([
      Object.freeze({
        key: `confirmed-private-liquidity-swap:${confirmed.transactionHash}`,
        swapId: confirmed.swapId,
        pairLabel: confirmedBaseToken && confirmedQuoteToken
          ? `${confirmedBaseToken.symbol} / ${confirmedQuoteToken.symbol}`
          : swapSellToken && swapBuyToken
            ? `${swapSellToken.symbol} / ${swapBuyToken.symbol}`
          : `${confirmed.pairKey.slice(0, 10)}…`,
        inputLabel,
        outputLabel,
        unusedInputLabel,
        blockNumber: confirmed.blockNumber,
        transactionHash: confirmed.transactionHash,
        status: 'confirmed' as const
      }),
      ...failedRows,
      ...finalizedRows
    ]);
  }, [
    privateLiquidityData.model,
    privateLiquidityOwnerData.history.traderRows,
    privateLiquidityPositionTokens,
    privateLiquiditySwapAction.confirmed,
    privateLiquiditySwapAction.failedAttempts,
    swapBuyToken,
    swapSellToken
  ]);
  const privateLiquidityPositionAction = usePrivateLiquidityPositionAction({
    deployment: privateLiquidityData.deployment,
    walletReady: privateLiquidityWalletReady,
    walletActions: sharedWalletActions,
    requestConfirmation: requestTradeActionConfirmation,
    refresh: privateLiquidityData.refresh,
    onCreated: (positionId) => navigateToTradePath(buildPrivateLiquidityPositionPath(positionId))
  });
  const privateLiquidityHiddenIntentAction = usePrivateLiquidityHiddenIntentAction({
    deployment: privateLiquidityData.deployment,
    completeSnapshot: privateLiquidityData.completeSnapshot,
    walletReady: privateLiquidityWalletReady,
    walletActions: sharedWalletActions,
    requestConfirmation: requestTradeActionConfirmation,
    refresh: privateLiquidityData.refresh
  });
  const privateLiquidityHiddenIntentOwnerData = usePrivateLiquidityHiddenIntentOwnerData({
    active: route.view === 'pools' && route.privateLiquidityView === 'intents',
    deployment: privateLiquidityData.deployment,
    model: privateLiquidityData.model,
    walletAddress: privateLiquidityWalletAddress,
    walletReady: privateLiquidityWalletReady,
    walletActions: sharedWalletActions,
    refreshKey: privateLiquidityHiddenIntentAction.confirmed?.transactionHash ?? ''
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
    routeTradeId: routeUsesOtcV2 ? null : routeTradeId,
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
    loadWalletBalances: () => {
      refreshTradeDataInBackground();
      return Promise.resolve();
    },
    mergeTradeSnapshot,
    navigateToTradePath,
    openTrade,
    refreshMyTrades: () => refreshMyTrades(),
    refreshPublicTrades: () => refreshPublicTrades(),
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
    onActionNotice: pushActionNotice,
    otcV2ActionRuntime: sharedWalletSession?.otcV2ActionRuntime,
    refreshOneOffV2Trades
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
    nativeBalanceWei,
    navigateToTradePath,
    onActionNotice: pushActionNotice,
    onCotiNetwork,
    openTrade,
    otcV2ActionRuntime: sharedWalletSession?.otcV2ActionRuntime,
    pWispFooterBalanceState,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBuyFillInput,
    recurringBuyPriceInput,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    recurringSellFillInput,
    recurringSellPriceInput,
    refreshRecurringV2Trades,
    rememberTradeTerminalReturn,
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
    tradeExpiryHoursInput,
    tradeHasNoExpiry,
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
        fallbackAddress: walletKey,
        readAccounts: walletReadAccounts,
        trade: snapshot
      });
    },
    [walletKey, walletReadAccounts]
  );

  const {
    acceptTrade,
    cancelTrade,
    changePrivateBookBudgetVisibility,
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
    onActionNotice: pushActionNotice,
    otcV2ActionRuntime: sharedWalletSession?.otcV2ActionRuntime,
    refreshOneOffV2Trades
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
    copyWithFeedback,
    canonicalV2Rows: otcTradeHistoryV2Rows
  };
  const terminalHistoryConfigParams: TerminalHistoryConfigParams = {
    walletAddress,
    walletReadAccounts,
    historyLifecycleTxHashes,
    historyTransactionTxHashes,
    historyTransactionTimestamps,
    swapFillNotes,
    getTransactionLinkFeedbackProps,
    canonicalV2Rows: otcTradeHistoryV2Rows,
    canonicalV2LifecycleEvents: otcTradeHistoryV2LifecycleEvents,
    canonicalV2Loading: loadingOtcTradeHistoryV2,
    canonicalV2Error: otcV2SetupError || otcTradeHistoryV2Error
  };
  const p2pReadBusyRef = useRef(false);
  p2pReadBusyRef.current = loadingPublicTrades || loadingMyTrades || loadingDetailTrade || loadingOtcTradeHistoryV2;
  const hasActiveP2PRead = useCallback(() => p2pReadBusyRef.current || hasActiveListRefresh(), [hasActiveListRefresh]);
  useP2PRealtimeSync({
    chainId,
    getTradeWalletFlowInput,
    hasActiveListRefresh: hasActiveP2PRead,
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
  const tradeEntryModeTabs = (
    <TradeEntryModeTabs
      activeTradeMode={activeTradeMode}
      onOpenTradeEntryMode={openTradeEntryMode}
    />
  );
  const activeSwapVenue = route.swapVenue ?? 'otc';
  const isDexProduct = route.tradeProduct === 'dex' || routeSurfaceView === 'pools' || activeSwapVenue === 'private-liquidity';
  const tradeViewTabs = (
    <div className="p2p-product-navigation">
      {isDexProduct ? (
        <DexViewTabs
          activeView={
            routeSurfaceView === 'agent'
              ? 'agent'
              : routeSurfaceView === 'pools'
                ? route.privateLiquidityView === 'mine'
                  ? 'positions'
                  : 'strategies'
                : 'swap'
          }
          onSelect={(view) => onOpenInternalAppLink?.(view === 'swap' ? '/dex' : `/dex/${view}`)}
        />
      ) : (
        <TradeViewTabs
          onNavigateDeskView={navigateDeskView}
          routeSurfaceView={routeSurfaceView}
          routeView={route.view}
        />
      )}
    </div>
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
    swapMarketBuyQuote,
    swapMarketSellQuote,
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
    tradeDeskIdentity,
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
    (route.view === 'trade' && !route.tradeId && !route.linkV2Reference) ||
    (emptyTerminalDrawerOpen && (route.view === 'public' || route.view === 'mine'));
  const offersTerminalOpen =
    !isMobileNav &&
    (routeSurfaceView === 'swap' || routeSurfaceView === 'public') &&
    activeSwapVenue === 'otc' &&
    route.view !== 'create' &&
    route.view !== 'counter';
  const desktopCreateOffersOpen = !isMobileNav && route.view === 'create' && activeSwapVenue === 'otc';
  const myTradeTerminalOpen = route.view === 'mine' && !emptyTerminalOpen && Boolean(selectedMyTradeDetail);
  const myTradesSelectionEmpty = !isMobileNav && route.view === 'mine' && !selectedMyTradeDetail;
  const currentTradePairLabel = `${swapBuyToken?.symbol ?? 'Base'}/${swapSellToken?.symbol ?? 'Quote'}`;
  const currentTradePairFilterKey = [swapBuyToken?.symbol, swapSellToken?.symbol]
    .filter((symbol): symbol is string => Boolean(symbol))
    .map((symbol) => symbol.trim().toUpperCase())
    .sort()
    .join('/');
  const terminalPanelOpen = route.view === 'trade' || myTradeTerminalOpen || myTradesSelectionEmpty || emptyTerminalOpen || offersTerminalOpen;
  const terminalPanelBaseTrade = emptyTerminalOpen || route.linkV2Reference ? null : route.view === 'mine' ? selectedMyTradeDetail : detailTrade;
  const terminalPanelTrade = useMemo(() => {
    if (!terminalPanelBaseTrade) {
      return null;
    }
    const walletCopy = myTrades.find((trade) => getSnapshotKey(trade) === getSnapshotKey(terminalPanelBaseTrade));
    if (!walletCopy) {
      return terminalPanelBaseTrade;
    }
    const perspectiveKey =
      resolveTerminalHistoryMergeWalletKey(walletCopy, { walletAddress: walletKey, walletReadAccounts }, walletKey) ||
      resolveTerminalHistoryMergeWalletKey(terminalPanelBaseTrade, { walletAddress: walletKey, walletReadAccounts }, walletKey);
    return mergeTradeSnapshotEnrichment(terminalPanelBaseTrade, walletCopy, perspectiveKey);
  }, [myTrades, terminalPanelBaseTrade, walletKey, walletReadAccounts]);
  const terminalPanelTradeKey = terminalPanelTrade ? getSnapshotKey(terminalPanelTrade) : '';
  const balanceReference = useMemo(() => {
    if (route.linkV2Reference) return { protocol: 'link-v2' as const, chainId: route.linkV2Reference.chainId,
      contractAddress: route.linkV2Reference.escrow, orderId: route.linkV2Reference.id };
    const identity = terminalPanelTrade?.v2;
    if (!identity || !['private-v2', 'direct-v2', 'counter-v2'].includes(identity.protocol)) return null;
    return { protocol: identity.protocol as TradeBalanceDisclosureProtocol, chainId: identity.chainId,
      contractAddress: identity.contractAddress, orderId: String(terminalPanelTrade!.tradeId) };
  }, [route.linkV2Reference, terminalPanelTrade]);
  const [terminalBalance, setTerminalBalance] = useState<{ root: NonNullable<typeof sharedWalletSession>['otcV2ActionRuntime'];
    owner: string; key: string; runtime: TradeBalanceDisclosureV2Runtime } | null>(null);
  const balanceReferenceKey = balanceReference ? `${balanceReference.protocol}:${balanceReference.chainId}:${balanceReference.contractAddress}:${balanceReference.orderId}` : '';
  const balanceRoot = sharedWalletSession?.otcV2ActionRuntime;
  useEffect(() => {
    let current = true;
    if (!walletHasAes || !balanceRoot || !balanceReference) return;
    void (async () => {
      const selected = await balanceRoot.forReference?.(balanceReference) ?? balanceRoot;
      const runtime = selected.tradeBalances[balanceReference.protocol];
      if (current && runtime && selected.isCurrent()) setTerminalBalance({ root: balanceRoot, owner: walletKey, key: balanceReferenceKey, runtime });
    })().catch(() => { if (current) setTerminalBalance(null); });
    return () => { current = false; };
  }, [balanceRoot, balanceReference, balanceReferenceKey, walletHasAes, walletKey]);
  const selectedBalanceRuntime = terminalBalance && terminalBalance.root === balanceRoot && terminalBalance.owner === walletKey && terminalBalance.key === balanceReferenceKey
    ? terminalBalance.runtime : null;
  useEffect(() => {
    setTerminalPanelTab('overview');
  }, [terminalPanelTradeKey]);
  const terminalHistoryTargetTrade =
    route.view === 'mine'
      ? terminalPanelTrade
      : route.view === 'trade' && !tradeAccessBlocked
        ? terminalPanelTrade
        : null;
  const terminalHistoryWalletAddress = terminalHistoryTargetTrade
    ? resolveTerminalHistoryWallet(terminalHistoryTargetTrade, { walletAddress: walletKey, walletReadAccounts }).walletAddress
    : walletKey;
  useTradeTerminalHistoryHydration({
    canonicalV2LifecycleEvents: otcTradeHistoryV2LifecycleEvents,
    canonicalV2Rows: otcTradeHistoryV2Rows,
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
    !route.linkV2Reference &&
    !emptyTerminalOpen &&
    !detailTrade &&
    !tradeAccessBlocked &&
    !route.routeError &&
    !detailTradeError;
  const offersTerminalEmpty = offersTerminalOpen && route.view !== 'trade' && !terminalPanelTrade;
  const terminalShowsOpenPanel = emptyTerminalOpen || offersTerminalEmpty;
  const terminalHasTradeContent = !terminalShowsOpenPanel && Boolean(terminalPanelTrade);
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

    if (needsDirectTermHydration && terminalPanelTrade.v2?.protocol === 'direct-v2') {
      // Direct V2 participant terms are hydrated centrally by
      // useOneOffTradeV2Data as soon as privacy is ready. Do not issue a
      // second terminal-scoped wallet read for the same ciphertexts.
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
          : { address: historyWallet.walletAddress, role: 'owner' as const };
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
    formatSwapAvailability,
    openSwapQuoteInTerminal,
    swapBuyVerifyUrl,
    swapCarbonReference,
    swapCarbonReferenceContext,
    swapChainWhisperMarketLabel,
    swapDisplayQuote,
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
    tradeAgentMessages,
    tradeAgentPrompt,
    tradeComposerModel,
    walletAddress
  });
  const isComposerRoute = route.view === 'create' || route.view === 'counter';
  const isCounterRouteWithoutParent = route.view === 'counter' && !counterParentTrade;
  const showSwapSurface = routeSurfaceView === 'swap' && !isComposerRoute;
  const showAgentSurface = routeSurfaceView === 'agent' && !isComposerRoute;
  const showPublicSurface = routeSurfaceView === 'public' && !isComposerRoute;
  const showOffersSurface =
    activeSwapVenue === 'otc' && (showSwapSurface || showPublicSurface || desktopCreateOffersOpen);
  const offerQuoteCandidates = useMemo(
    () => approvedOffersDesignQa
      ? offersQaHidesCandidates ? [] : approvedOffersQaCandidates
      : swapActionMode === 'buy'
        ? swapMarketBuyQuote.candidates
        : swapMarketSellQuote.candidates,
    [
      approvedOffersDesignQa,
      approvedOffersQaCandidates,
      offersQaHidesCandidates,
      swapActionMode,
      swapMarketBuyQuote.candidates,
      swapMarketSellQuote.candidates
    ]
  );
  const offerFiltersActive = tradeTypeFilter !== 'all';
  const filteredOfferQuoteCandidates = useMemo(() => {
    if (!offerFiltersActive) return offerQuoteCandidates;
    const matchingTradeKeys = new Set(
      filterAndSortTradeDesk(
        offerQuoteCandidates.map((candidate) => candidate.trade),
        {
          access: 'all',
          pair: 'all',
          search: '',
          sort: 'newest',
          type: tradeTypeFilter
        }
      ).map(getSnapshotKey)
    );
    return offerQuoteCandidates.filter(
      (candidate) => candidate.tradeKey === swapPinnedTradeKey || matchingTradeKeys.has(getSnapshotKey(candidate.trade))
    );
  }, [
    offerFiltersActive,
    offerQuoteCandidates,
    swapPinnedTradeKey,
    tradeTypeFilter
  ]);
  const filteredOfferBestQuote = filteredOfferQuoteCandidates.reduce<OtcSwapQuoteCandidate | null>(
    (best, candidate) => best === null || candidate.price < best.price ? candidate : best,
    null
  );
  const showPrivateLiquidityWorkspace = routeSurfaceView === 'pools' && !isComposerRoute;
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
    changePrivateBookBudgetVisibility,
    renderTradeBalanceDisclosure: snapshot => {
      const identity = snapshot.v2, reference = balanceReference, runtime = selectedBalanceRuntime;
      if (!walletHasAes || !runtime || !identity || !reference || identity.chainId !== reference.chainId ||
          identity.contractAddress.toLowerCase() !== reference.contractAddress.toLowerCase() || String(snapshot.tradeId) !== reference.orderId) return null;
      return <TradeBalanceDisclosureV2 key={`terminal-balance:${walletKey}:${balanceReferenceKey}`} runtime={runtime} orderId={String(snapshot.tradeId)}
          tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo} confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
          actionInProgress={creatingTrade || Boolean(processingTradeActionId) || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
          onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })} />;
    },
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
    terminalHistoryConfigParams,
    showHistoryControl: false
  };

  const tradePricePairLabel =
    tradeComposerModel.selectedTradeOfferToken && tradeComposerModel.selectedTradeRequestToken
      ? `${tradeComposerModel.selectedTradeRequestToken.symbol} per ${tradeComposerModel.selectedTradeOfferToken.symbol}`
      : 'quote per base';
  const tradeReversePricePairLabel =
    tradeComposerModel.selectedTradeOfferToken && tradeComposerModel.selectedTradeRequestToken
      ? `${tradeComposerModel.selectedTradeOfferToken.symbol} per ${tradeComposerModel.selectedTradeRequestToken.symbol}`
      : 'base per quote';
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
  const canonicalCreateBaseSelection = USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
    ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateBase
    : PRIVATE_GCOTI_TOKEN_ADDRESS.toLowerCase();
  const canonicalCreateQuoteSelection = USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS
    ? TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS.privateQuote
    : PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase();
  const createUsesSharedPair =
    (tradeOfferTokenSelection === canonicalCreateBaseSelection && tradeRequestTokenSelection === canonicalCreateQuoteSelection) ||
    (tradeOfferTokenSelection === canonicalCreateQuoteSelection && tradeRequestTokenSelection === canonicalCreateBaseSelection);
  const canonicalCreateSide = tradeOfferTokenSelection === canonicalCreateBaseSelection ? 'sell' : 'buy';
  const displayedCreateSide = resolveDisplayedTradeActionSide(canonicalCreateSide, swapPriceDisplayInverted);
  const canonicalCreateBaseSymbol = tradeComposerModel.tradeTokenOptions.find(
    (option) => option.value === canonicalCreateBaseSelection
  )?.symbol ?? tradeComposerModel.tradeTokenOptions.find((option) => option.value === canonicalCreateBaseSelection)?.label ?? 'Base';
  const canonicalCreateQuoteSymbol = tradeComposerModel.tradeTokenOptions.find(
    (option) => option.value === canonicalCreateQuoteSelection
  )?.symbol ?? tradeComposerModel.tradeTokenOptions.find((option) => option.value === canonicalCreateQuoteSelection)?.label ?? 'Quote';
  const displayedCreateBaseSymbol = swapPriceDisplayInverted ? canonicalCreateQuoteSymbol : canonicalCreateBaseSymbol;

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
            ? 'Public offer'
            : tradeVisibility === 'direct'
              ? directTradeRecipientIsValid
                ? `Direct to ${shortenAddress(directTradeRecipientNormalized)}`
                : 'Direct proposal'
              : 'Private link · contract pending'
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
      sendLabel={
        editingTrade
          ? 'Save Edit'
          : counterParentTrade
            ? 'Send Counter'
            : tradeVisibility === 'unlisted'
              ? 'Private link contract pending'
              : 'Create Offer'
      }
      sendingLabel="Creating..."
      sendTitle={
        editingTrade
          ? 'Cancel the old public offer and create the replacement.'
          : counterParentTrade
            ? 'Create a linked counter trade on chain.'
            : 'Create the escrow offer on chain.'
      }
      actionNotice={composerActionNotice}
      showHeader={Boolean(editingTrade || counterParentTrade)}
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
      priceDisplayInverted={swapPriceDisplayInverted}
      onPriceDisplayInvertedChange={(inverted) => setSwapPriceDisplayInverted(inverted)}
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
      // The shared header does not bind P2P's token state. Keep its selectors
      // available, with Buy/Sell only for the actual canonical pair.
      displayedTradeSide={createUsesSharedPair ? displayedCreateSide : undefined}
      displayedTradeBaseSymbol={displayedCreateBaseSymbol}
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
      canSend={tradeVisibility !== 'unlisted' && tradeComposerModel.canSendTradeOffer}
      submissionBlocked={tradeVisibility === 'unlisted'}
      settingsSlot={tradeAccessSettings}
      onSendTradeOffer={() => {
        createTrade().catch(() => {});
      }}
      generalError={tradeComposerModel.tradeComposerFieldErrors.general}
      validationMessage={
        tradeVisibility === 'unlisted'
          ? 'Shared trades are not enabled for this deployment.'
          : tradeComposerModel.tradeComposerValidationMessage || undefined
      }
    />
  );
  const contextualAppHelpReason = useMemo<AppHelpReason | null>(() => {
    const readinessError = [walletError, tradeActionError]
      .map((message) => message.trim())
      .find((message) => /\b(wallet|network|privacy|unlock|account|balance|fund|gas)\b/iu.test(message));
    if (!readinessError) {
      return null;
    }
    if (!walletKey || /\bconnect(?:ed)?\b.*\bwallet\b|\bwallet\b.*\bconnect/iu.test(readinessError)) {
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
  }, [tradeActionError, walletError, walletKey]);

  const tradingHeaderDisabled = creatingTrade || Boolean(processingTradeActionId) || Boolean(processingRecurringAction) ||
    Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy) || Boolean(tradeActionConfirmation) ||
    privateLiquiditySwapAction.busy || privateLiquidityPositionAction.busy || privateLiquidityHiddenIntentAction.busy ||
    isWalletTransactionFlowActive(getTradeWalletFlowInput());
  return (
    <>
      {renderTradingHeader?.({
        baseSelection: swapBuyTokenSelection,
        quoteSelection: swapSellTokenSelection,
        baseToken: swapBuyToken,
        quoteToken: swapSellToken,
        tokenOptions: swapTokenOptions,
        onTokenSelectionChange: (side, key) => {
          if (tradingHeaderDisabled || isWalletTransactionFlowActive(getTradeWalletFlowInput()) ||
              !swapTokenOptions.some(option => option.value === key)) return;
          ensureDistinctSwapTokenSelection(side, key);
        },
        disabled: tradingHeaderDisabled,
        reference: swapCarbonReference
      })}
    <main
      data-p2p-pending-reads={import.meta.env.DEV ? [
        legacyLoadingMyTrades && 'legacy',
        initializingOtcV2History && 'history-setup',
        initializingOtcV2Actions && 'actions-setup',
        loadingOneOffV2Trades && 'one-off',
        loadingRecurringV2Trades && 'recurring'
      ].filter(Boolean).join(',') : undefined}
      className={`standalone-trades-shell p2p-trading-shell${terminalPanelOpen ? ' p2p-trading-shell-drawer-open' : ''}${
        terminalShowsOpenPanel ? ' p2p-trading-shell-empty-terminal' : ''
      }${
        offersTerminalOpen ? ' p2p-trading-shell-offers-terminal' : ''
      }${
        !isComposerRoute ? ' p2p-trading-shell-has-overview' : ''
      }${isComposerRoute ? ' p2p-trading-shell-create' : ''}${
        desktopCreateOffersOpen ? ' p2p-trading-shell-create-with-offers' : ''
      }${
        routeSurfaceView === 'mine' ? ' p2p-trading-shell-mine' : ''
      }${terminalRouteReturnSurface ? ` p2p-trading-shell-terminal-source-${terminalRouteReturnSurface}` : ''}${
        mobileKeyboardOpen ? ' p2p-keyboard-open' : ''
      }`}
    >
      <TradeMarketOverviewPanel
        isComposerRoute={isComposerRoute}
        marketOverviewClassView={marketOverviewClassView}
        tradeViewTabs={tradeViewTabs}
        createDeskIdentity={createDeskIdentity}
        tradeDeskIdentity={tradeDeskIdentity}
        openPublicTradeCount={routeSurfaceView === 'public' ? offerQuoteCandidates.length : openPublicTradeCount}
        receivedOpenTradeOfferCount={receivedOpenTradeOffers.length}
        myOpenTradeCount={myOpenTrades.length}
        walletTradeHistoryCount={walletTradeHistory.length}
        walletError={showOffersSurface && !approvedOffersDesignQa && walletError === publicTradesError ? '' : walletError}
        tradeActionError={showOffersSurface && !approvedOffersDesignQa && (otcV2SetupError || tradeActionError) === publicTradesError ? '' : (otcV2SetupError || tradeActionError)}
      />
      {sharedWalletSession?.otcV2ActionRuntime?.privateBook ? <PrivateBookV2RecoveryPanel
        key={`book-recovery:${walletKey}:${chainId}`}
        runtime={sharedWalletSession.otcV2ActionRuntime} ownerAddress={walletAddress} privacyUnlocked={walletHasAes}
        actionInProgress={creatingTrade || Boolean(processingTradeActionId) || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
        tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
        confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
        onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
        onConfirmed={() => { refreshOneOffV2Trades(); }}
      /> : null}
      {walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.link ? <LinkTradeV2CreationRecoveryPanel
        key={`${walletKey}:${chainId}`}
        runtime={sharedWalletSession.otcV2ActionRuntime.link}
        ownerAddress={walletAddress}
        actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
        tokenInfoByKey={customTradeTokenInfoByAddress}
        ensureTokenInfo={ensureRecurringV2TokenInfo}
        confirmFunding={ensureTradeFunding}
        runWalletFlow={runTradeWalletPromptFlow}
        onCreated={created => {
          setCreatedTradeLink(new URL(created.sharePath, window.location.origin).href);
          navigateToTradePath(created.sharePath);
        }}
      /> : null}
      {walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.counter ? <CounterTradeV2Controls
        runtime={sharedWalletSession.otcV2ActionRuntime.counter} ownerAddress={walletAddress}
        actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
        tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
        confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
        onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
      /> : null}
      {walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.link?.balance ? <TradeBalanceDisclosureV2 key={`link-balance:${walletKey}:${chainId}`}
        runtime={sharedWalletSession.otcV2ActionRuntime.link.balance} tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
        actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)} confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
        onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })} /> : null}
      {walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.counter?.balance ? <TradeBalanceDisclosureV2 key={`counter-balance:${walletKey}:${chainId}`}
        runtime={sharedWalletSession.otcV2ActionRuntime.counter.balance} tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
        actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)} confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
        onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })} /> : null}
      {walletHasAes ? (['private-v2', 'direct-v2'] as const).map(protocol => {
        const runtime = sharedWalletSession?.otcV2ActionRuntime?.tradeBalances[protocol];
        return runtime ? <TradeBalanceDisclosureV2 key={`balance-recovery:${protocol}:${walletKey}:${chainId}`} runtime={runtime}
          tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
          actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
          confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
          onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })} /> : null;
      }) : null}
      {onOpenAppHelp && contextualAppHelpReason ? (
        <div className="p2p-contextual-help">
          <span>Need help with this readiness step?</span>
          <button type="button" onClick={() => onOpenAppHelp(contextualAppHelpReason)}>
            Get help
          </button>
        </div>
      ) : null}
      <details className="p2p-advanced-tools">
        <summary>Testnet tools</summary>
        <div className="testnet-token-tools">
          <TestnetTokenAdmissionPanel session={sharedWalletSession} />
          <TestnetTokenFaucetPanel session={sharedWalletSession} />
          <TestnetQaChecklist onNavigate={navigateTestnetQaJourney} />
        </div>
      </details>

      {showOffersSurface ? (
        <OtcOffersPanel
          actionMode={swapActionMode}
          linkedActionModes={swapLinkedActionModes}
          orderLinkInput={swapOrderLinkInput}
          orderLinkError={swapOrderLinkError}
          pinnedTradeKey={approvedOffersQaState === 'stale' ? 'qa-stale-offer' : swapPinnedTradeKey}
          pinnedTrade={approvedOffersQaState === 'stale' ? null : swapPinnedTrade}
          sellTokenSelection={swapSellTokenSelection}
          buyTokenSelection={swapBuyTokenSelection}
          tokenOptions={swapTokenOptions}
          displayQuote={offersQaHidesCandidates
            ? null
            : approvedOffersDesignQa ? approvedOffersQaCandidates[1] : swapDisplayQuote}
          bestQuote={offersQaHidesCandidates ? null : filteredOfferBestQuote}
          quoteCandidates={offersQaHidesCandidates ? [] : filteredOfferQuoteCandidates}
          carbonReference={approvedOffersQaState === 'no-market'
            ? null
            : approvedOffersDesignQa
              ? { label: '0.247 cwTPQ', title: 'Carbon market reference', basisLabel: 'cwTPQ/cwTPB' }
              : swapCarbonReference}
          priceDisplayInverted={swapPriceDisplayInverted}
          marketLabel={swapChainWhisperMarketLabel}
          filtersOpen={mobileTradeFiltersOpen}
          filtersActive={offerFiltersActive}
          filterResultSummary={offerFiltersActive
            ? `${filteredOfferQuoteCandidates.length} of ${offerQuoteCandidates.length} offers`
            : `${offerQuoteCandidates.length} offers`}
          loadingOffers={approvedOffersQaState === 'loading' || (!approvedOffersDesignQa && loadingPublicTrades)}
          offersError={approvedOffersDesignQa
            ? approvedOffersQaState === 'error'
              ? 'The market could not refresh. Your direction and filters are unchanged.'
              : ''
            : publicTradesError}
          typeFilter={tradeTypeFilter}
          typeFilterOptions={tradeTypeFilterOptions}
          onActionModeChange={changeSwapActionMode}
          onToggleFilters={() => setMobileTradeFiltersOpen((isOpen) => !isOpen)}
          onTypeFilterChange={(value) => setTradeTypeFilter(value as TradeDeskTypeFilter)}
          onClearFilters={() => {
            setTradeTypeFilter('all');
          }}
          onRetryOffers={() => {
            void refreshPublicTrades();
          }}
          onSubmitOrderLink={openSwapOrderFromInput}
          onOrderLinkInputChange={updateSwapOrderLinkInput}
          onClearPinnedOrder={clearSwapPinnedOrder}
          onCreateLimitOrder={openLimitOrderFromSwapPair}
          onOpenQuote={openSwapQuoteInTerminal}
          formatAvailability={approvedOffersDesignQa
            ? (quote) => !quote
              ? 'Unavailable'
              : quote.availability.kind === 'terminal'
              ? 'Private'
              : quote.tradeId === 91 ? '1,250 cwTPB' : '2,400 cwTPB'
            : formatSwapAvailability}
        />
      ) : null}
      {showSwapSurface && activeSwapVenue === 'private-liquidity' ? (
        <PrivateLiquiditySwapPanel
          tradeEntryModeTabs={tradeEntryModeTabs}
          venueTabs={null}
          sellAmountInput={swapSellAmountInput}
          sellBalanceLabel={swapSellBalanceLabel}
          sellBalanceTitle={swapSellBalanceTitle}
          sellTokenSelection={swapSellTokenSelection}
          sellVerifyUrl={swapSellVerifyUrl}
          buyTokenSelection={swapBuyTokenSelection}
          buyVerifyUrl={swapBuyVerifyUrl}
          tokenOptions={privateLiquidityTokenOptions}
          quote={privateLiquiditySwapAction.quote}
          inputTokenDecimals={swapSellToken?.decimals}
          inputTokenSymbol={swapSellToken?.symbol}
          outputTokenDecimals={swapBuyToken?.decimals}
          outputTokenSymbol={swapBuyToken?.symbol}
          slippageBps={privateLiquiditySlippageBps}
          minimumFillBps={privateLiquidityMinimumFillBps}
          deploymentReady={privateLiquidityData.deploymentReady}
          liquidityLoading={[
            'attesting',
            'syncing-events',
            'hydrating-positions'
          ].includes(privateLiquidityData.status)}
          deploymentError={privateLiquidityData.error}
          walletReady={privateLiquidityWalletReady}
          busy={privateLiquiditySwapAction.busy}
          quoteError={privateLiquiditySwapAction.quoteError}
          actionMessage={privateLiquiditySwapAction.message}
          actionStatus={
            privateLiquiditySwapAction.stage === 'success'
              ? 'success'
              : privateLiquiditySwapAction.stage === 'error'
                ? 'error'
                : privateLiquiditySwapAction.busy
                  ? 'pending'
                  : 'idle'
          }
          onSellAmountInputChange={updateSwapSellAmountInput}
          onTokenSelectionChange={ensureDistinctSwapTokenSelection}
          onFlipTokens={flipSwapTokens}
          onOpenPools={() => navigateToTradePath(buildPrivateLiquidityWorkspacePath())}
          onRetryDeployment={privateLiquidityData.retryDeployment}
          onSlippageBpsChange={setPrivateLiquiditySlippageBps}
          onMinimumFillBpsChange={setPrivateLiquidityMinimumFillBps}
          historyRows={privateLiquiditySwapHistoryRows}
          historyStatus={privateLiquidityData.historyLoading ? 'loading' : privateLiquidityOwnerData.status}
          historyError={privateLiquidityOwnerData.error}
          onRevealHistory={privateLiquidityOwnerData.reveal}
          onReview={privateLiquiditySwapAction.review}
        />
      ) : null}
      {showPrivateLiquidityWorkspace ? (
        <PrivateLiquidityWorkspace
          activeView={route.privateLiquidityView ?? 'discover'}
          deploymentReady={privateLiquidityData.deploymentReady}
          model={privateLiquidityData.model}
          positionTokens={privateLiquidityPositionTokens}
          selectedDailyPricePairKey={privateLiquidityDailyPriceMarket?.pairKey ?? privateLiquidityDailyPriceResolvedPairKey}
          onSelectDailyPricePair={setPrivateLiquidityDailyPricePairKey}
          dailyPriceChart={
            privateLiquidityDailyPriceResolvedPairKey &&
            privateLiquidityDailyPriceBaseToken &&
            privateLiquidityDailyPriceQuoteToken
              ? {
                  points: privateLiquidityDailyPricePresentation.points,
                  pairLabel: `${privateLiquidityDailyPriceBaseToken.symbol} / ${privateLiquidityDailyPriceQuoteToken.symbol}`,
                  quoteSymbol: privateLiquidityDailyPriceQuoteToken.symbol,
                  mode: privateLiquidityDailyPricePresentation.mode,
                  status: privateLiquidityDailyPricePresentation.status,
                  error: privateLiquidityDailyPriceData.error,
                  onRetry: privateLiquidityDailyPriceData.refresh
                }
              : undefined
          }
          managedPositionInventory={privateLiquidityManagedInventory}
          ownerPrivateHistory={privateLiquidityOwnerData.history}
          ownerPrivateDataStatus={privateLiquidityOwnerData.status}
          ownerPrivateDataLoading={privateLiquidityOwnerData.status === 'loading'}
          ownerPrivateDataError={privateLiquidityOwnerData.error}
          routeError={route.routeError || privateLiquidityData.error}
          walletReady={privateLiquidityWalletReady}
          processingPositionAction={privateLiquidityPositionAction.currentAction}
          positionActionBusy={privateLiquidityPositionAction.busy}
          positionActionMessage={privateLiquidityPositionAction.message}
          positionActionStatus={
            privateLiquidityPositionAction.stage === 'success'
              ? 'success'
              : privateLiquidityPositionAction.stage === 'error'
                ? 'error'
                : privateLiquidityPositionAction.busy
                  ? 'pending'
                  : 'idle'
          }
          hiddenIntentBusy={privateLiquidityHiddenIntentAction.busy}
          hiddenIntentMessage={privateLiquidityHiddenIntentAction.message}
          hiddenIntentStatus={
            privateLiquidityHiddenIntentAction.stage === 'success'
              ? 'success'
              : privateLiquidityHiddenIntentAction.stage === 'error'
                ? 'error'
                : privateLiquidityHiddenIntentAction.busy
                  ? 'pending'
                  : 'idle'
          }
          hiddenIntentOwnerDataStatus={privateLiquidityHiddenIntentOwnerData.status}
          hiddenIntentOwnerPage={privateLiquidityHiddenIntentOwnerData.page}
          hiddenIntentOwnerDataError={privateLiquidityHiddenIntentOwnerData.error}
          loading={[
            'attesting',
            'syncing-events',
            'hydrating-positions'
          ].includes(privateLiquidityData.status)}
          hydratedPositionCount={privateLiquidityData.hydratedPositionCount}
          totalPositionCount={privateLiquidityData.totalPositionCount}
          onBackToSwap={() => navigateToTradePath(
            buildTradeSurfacePath('swap', 'desk', 'swap', 'private-liquidity')
          )}
          onBackToPositions={() => navigateToTradePath(buildPrivateLiquidityWorkspacePath('mine'))}
          onChangeView={(view) => navigateToTradePath(buildPrivateLiquidityWorkspacePath(view))}
          onOpenPosition={(positionId) => navigateToTradePath(buildPrivateLiquidityPositionPath(positionId))}
          onPositionAction={privateLiquidityPositionAction.execute}
          onCreateHiddenIntent={privateLiquidityHiddenIntentAction.create}
          onCancelHiddenIntent={privateLiquidityHiddenIntentAction.cancel}
          onReclaimHiddenIntent={privateLiquidityHiddenIntentAction.reclaim}
          onSettleHiddenIntents={privateLiquidityHiddenIntentAction.settle}
          onRevealHiddenIntentOwnerData={privateLiquidityHiddenIntentOwnerData.reveal}
          onRevealOwnerPrivateData={privateLiquidityOwnerData.reveal}
          onRefresh={privateLiquidityData.refresh}
        />
      ) : null}
      {showAgentSurface ? (
        <TradeAgentPanel
          compactLayout={isMobileNav}
          mode={tradeAgentPanelMode}
          onModeChange={setTradeAgentPanelMode}
          venueLabel={isDexProduct ? 'DEX' : 'P2P'}
          pairLabel={isDexProduct
            ? CURRENT_DEX_DISPLAY_PAIR[swapPriceDisplayInverted ? 1 : 0] + ' / ' + CURRENT_DEX_DISPLAY_PAIR[swapPriceDisplayInverted ? 0 : 1]
            : (swapDisplayBaseToken?.symbol ?? 'Base token') + ' / ' + (swapDisplayQuoteToken?.symbol ?? 'Quote token')}
          ratioLabel={(isDexProduct
            ? CURRENT_DEX_DISPLAY_PAIR[swapPriceDisplayInverted ? 0 : 1] + ' per ' + CURRENT_DEX_DISPLAY_PAIR[swapPriceDisplayInverted ? 1 : 0]
            : (swapDisplayQuoteToken?.symbol ?? 'Quote token') + ' per ' + (swapDisplayBaseToken?.symbol ?? 'Base token')) + ' · follows shared header orientation'}
          actionsAvailable={!isDexProduct}
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
          quickActions={visibleTradeAgentQuickActions.filter((item) => item.action !== 'draft_recurring')}
          prompt={tradeAgentPrompt}
          readiness={resolveTradeAgentReadiness({
            error: tradeAgentError,
            hasAccount: Boolean(walletAddress),
            loading: tradeAgentLoading,
            prompt: tradeAgentPrompt,
            retryPaymentTxHash: tradeAgentRetryPaymentTxHash,
            status: tradeAgentStatus
          })}
          retryPaymentTxHash={tradeAgentRetryPaymentTxHash}
          canUseAction={canUseTradeAgentAction}
          getActionButtonLabel={getTradeAgentActionButtonLabel}
          getActionDescription={getTradeAgentActionDescription}
          getActionCta={getTradeAgentActionCta}
          resolveQuickActionPrompt={resolveTradeAgentQuickActionPrompt}
          onApplyAction={applyTradeAgentAction}
          onActionError={setTradeAgentError}
          onSelectQuickAction={selectTradeAgentQuickAction}
          onConnectAccount={() => {
            if (!sharedWalletActions) {
              setTradeAgentError('Open the Wallet menu to connect MetaMask or CipherTrade.');
              return;
            }
            Promise.resolve(sharedWalletActions.connectBrowserWallet(preferredBrowserWalletId || undefined, {
              preparePrivacy: true
            })).catch((connectError) => {
              setTradeAgentError(getProviderErrorMessage(
                connectError,
                'Could not connect the selected wallet.'
              ));
            });
          }}
          onPromptChange={updateTradeAgentPrompt}
          onSubmit={submitTradeAgentRequest}
        />
      ) : null}

      {isComposerRoute ? (
        <section className="standalone-trade-create-panel p2p-trade-workspace-panel">
          <div className="standalone-trades-section-head">
            <div>
              <h2>
                {editingTrade
                  ? `Edit public offer #${editingTrade.tradeId}`
                  : counterParentTrade
                    ? `Counter offer #${counterParentTrade.tradeId}`
                  : editingRecurringOrder?.recurringOrder
                    ? `Edit recurring order #${editingRecurringOrder.recurringOrder.orderId}`
                  : 'Create P2P offer'}
              </h2>
              {editingTrade || counterParentTrade || editingRecurringOrder ? <p className="p2p-create-task-description">
                {editingTrade
                  ? 'Update this public offer without changing the shared pair or price display.'
                  : counterParentTrade
                    ? 'Reply with new fixed terms for the selected participant.'
                  : editingRecurringOrder?.recurringOrder
                    ? 'Update both reusable private orders and their starting inventory.'
                    : 'Update both reusable private orders and their starting inventory.'}
              </p> : null}
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
          {!isCounterRouteWithoutParent ? (editingRecurringOrder?.recurringOrder && !editingTrade && !counterParentTrade ? (
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
              recurringHidePrivateAmounts={recurringHidePrivateAmounts}
              recurringPriceDisplayInverted={recurringPriceDisplayInverted}
              recurringQuoteToken={recurringQuoteToken}
              recurringRemoveBuyBudgetInput={recurringRemoveBuyBudgetInput}
              recurringRemoveSellInventoryInput={recurringRemoveSellInventoryInput}
              recurringSellPriceInput={recurringSellPriceInput}
              recurringSellReceiveEditable={recurringSellReceiveEditable}
              recurringSellReceiveInput={recurringSellReceiveInput}
              recurringSellReceivePreview={recurringSellReceivePreview}
              recurringBaseBalanceLabel={tradeComposerModel.tradeOfferBalanceSummaryLabel}
              recurringQuoteBalanceLabel={tradeComposerModel.tradeRequestBalanceSummaryLabel}
              recurringBaseMaxInputValue={tradeComposerModel.tradeOfferMaxInputValue}
              recurringQuoteMaxInputValue={tradeComposerModel.tradeRequestMaxInputValue}
              canUseRecurringBaseMax={tradeComposerModel.canUseTradeOfferMax}
              canUseRecurringQuoteMax={tradeComposerModel.canUseTradeRequestMax}
              setRecurringHidePrivateAmounts={setRecurringHidePrivateAmounts}
              setRecurringRemoveBuyBudgetInput={setRecurringRemoveBuyBudgetInput}
              setRecurringRemoveSellInventoryInput={setRecurringRemoveSellInventoryInput}
              tradeFeeEscrowContract={tradeFeeEscrowContract}
              tradeFeeEscrowContractLabel={tradeFeeEscrowContractLabel}
              tradeFeeEscrowContractTitleLabel={tradeFeeEscrowContractTitleLabel}
              tradeRequiredFeeWei={tradeRequiredFeeWei}
              updateRecurringBuyLiquidityInput={updateRecurringBuyLiquidityInput}
              updateRecurringBuyPriceInput={updateRecurringBuyPriceInput}
              updateRecurringBuyReceiveInput={updateRecurringBuyReceiveInput}
              updateRecurringBuyReversePriceInput={updateRecurringBuyReversePriceInput}
              updateRecurringSellLiquidityInput={updateRecurringSellLiquidityInput}
              updateRecurringSellPriceInput={updateRecurringSellPriceInput}
              updateRecurringSellReceiveInput={updateRecurringSellReceiveInput}
              updateRecurringSellReversePriceInput={updateRecurringSellReversePriceInput}
              onCotiNetwork={onCotiNetwork}
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
              <p className="landing-eyebrow">P2P</p>
              <h2>{route.linkV2Reference ? 'Shared trade' : offersTerminalEmpty
                ? 'Trade terminal'
                : myTradesSelectionEmpty
                  ? 'Trade details'
                : terminalPanelTrade || terminalRouteDetailPending
                ? route.view === 'mine' ? 'Trade terminal' : 'Trade review'
                : OPEN_TERMINAL_LABEL}</h2>
            </div>
            {!offersTerminalEmpty && !myTradesSelectionEmpty ? (
              <button type="button" className="standalone-trade-secondary-btn" onClick={closeTerminalPanel}>
                <ArrowLeft size={16} strokeWidth={2.3} aria-hidden="true" />
                <span>{route.view === 'mine' ? 'Back to my trades' : 'Back to offers'}</span>
              </button>
            ) : null}
          </div>
          {terminalShowsOpenPanel ? (
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
              persistentOffers={offersTerminalEmpty}
              tradeDirection={offersTerminalEmpty
                ? resolveDisplayedTradeActionSide(swapActionMode, swapPriceDisplayInverted)
                : undefined}
              tradeDirectionEnabled={offersTerminalEmpty ? {
                buy: swapLinkedActionModes[resolveCanonicalTradeActionSide('buy', swapPriceDisplayInverted)],
                sell: swapLinkedActionModes[resolveCanonicalTradeActionSide('sell', swapPriceDisplayInverted)]
              } : undefined}
              onTradeDirectionChange={offersTerminalEmpty
                ? (direction) => changeSwapActionMode(
                    resolveCanonicalTradeActionSide(direction, swapPriceDisplayInverted)
                  )
                : undefined}
            />
          ) : null}
          {myTradesSelectionEmpty ? (
            <div className="p2p-terminal-selection-empty">
              <WalletCards size={30} aria-hidden="true" />
              <strong>Select a trade</strong>
              <p>Choose from the list to view details.</p>
            </div>
          ) : null}
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
          {route.linkV2Reference && walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.link ? <LinkTradeV2OwnerControls
            key={`${walletKey}:${chainId}:${route.linkV2Reference.id}`}
            runtime={sharedWalletSession.otcV2ActionRuntime.link}
            reference={route.linkV2Reference}
            tokenInfoByKey={customTradeTokenInfoByAddress}
            ensureTokenInfo={ensureRecurringV2TokenInfo}
            confirmFunding={ensureTradeFunding}
            runWalletFlow={runTradeWalletPromptFlow}
            onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
          /> : null}
          {route.linkV2Reference ? <LinkTradeV2Terminal
            reference={route.linkV2Reference}
            secret={route.accessSecret}
            readContext={linkTradeV2ReadContext ?? sharedWalletSession?.otcV2ActionRuntime?.link?.readContext}
            resolveReadContext={sharedWalletSession?.otcV2ActionRuntime?.resolveLinkReadContext}
            tokenInfoByKey={customTradeTokenInfoByAddress}
            ensureTokenInfo={ensureRecurringV2TokenInfo}
            renderFill={walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.link ? review => review.reference.chainId === sharedWalletSession.otcV2ActionRuntime!.link!.readContext.deployment.chainId &&
              review.reference.escrow === sharedWalletSession.otcV2ActionRuntime!.link!.readContext.deployment.contractAddress ? <LinkTradeV2FillControls
              review={review} runtime={sharedWalletSession.otcV2ActionRuntime!.link!} ownerAddress={walletKey}
              tokenInfoByKey={customTradeTokenInfoByAddress}
              actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
              confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
              onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
            /> : null : undefined}
            renderCounter={walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.counter ? review => <CounterTradeV2Controls
              review={review} runtime={sharedWalletSession.otcV2ActionRuntime!.counter!} ownerAddress={walletKey}
              tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
              actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
              confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
              onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
            /> : undefined}
            renderBalance={walletHasAes && selectedBalanceRuntime ? review => review.maker !== walletKey &&
              review.reference.chainId === balanceReference?.chainId && review.reference.escrow === balanceReference.contractAddress && review.reference.id === balanceReference.orderId ? <TradeBalanceDisclosureV2
              key={`${walletKey}:${review.reference.id}`} runtime={selectedBalanceRuntime} orderId={review.reference.id}
              tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo} confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
              actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
              onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })} /> : null : undefined}
          /> : <TradeTerminalRouteStatus
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
          />}
          {terminalHasTradeContent && (route.view === 'mine' || !tradeAccessBlocked) ? (
            <div className="p2p-terminal-view-tabs" role="tablist" aria-label="Trade terminal view">
              <button type="button" role="tab" aria-selected={terminalPanelTab === 'overview'} className={terminalPanelTab === 'overview' ? 'active' : undefined} onClick={() => setTerminalPanelTab('overview')}>Overview</button>
              <button type="button" role="tab" aria-selected={terminalPanelTab === 'activity'} className={terminalPanelTab === 'activity' ? 'active' : undefined} onClick={() => setTerminalPanelTab('activity')}>Activity</button>
            </div>
          ) : null}
          {!terminalShowsOpenPanel && terminalPanelTrade && (route.view === 'mine' || !tradeAccessBlocked) ? (
            <div className="p2p-terminal-view-panel" role="tabpanel" aria-label={terminalPanelTab === 'overview' ? 'Trade overview' : 'Trade activity'}>
              {terminalPanelTab === 'overview' ? (
                <>
                  <TradeTerminalRenderer snapshot={terminalPanelTrade} {...tradeTerminalRendererProps} />
                  {walletHasAes && (terminalPanelTrade.v2?.protocol === 'standard-v2' || terminalPanelTrade.v2?.protocol === 'private-v2' && 'privateBook' in terminalPanelTrade) && sharedWalletSession?.otcV2ActionRuntime?.counter ? <CounterTradeV2Controls
                    bookTrade={terminalPanelTrade} runtime={sharedWalletSession.otcV2ActionRuntime.counter} ownerAddress={walletKey}
                    tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
                    actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
                    confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
                    onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
                  /> : null}
                </>
              ) : (
                <TradeTerminalHistoryRenderer
                  snapshot={terminalPanelTrade}
                  terminalHistoryConfigParams={terminalHistoryConfigParams}
                  renderActionNotice={renderP2PActionNotice}
                  embedded
                />
              )}
            </div>
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'mine' ? (
        <TradeMyTradesSection
          loadingMyTrades={loadingMyTrades}
          myTradesCount={myTrades.length}
          myTradesError={myTradesError}
          privateTradesLocked={Boolean(walletAddress && !walletHasAes)}
          myTradeGroupOptions={myTradeGroupOptions}
          selectedMyTradeGroup={selectedMyTradeGroup}
          selectedTradeKey={selectedMyTradeDetailKey}
          hasActiveDeskFilters={hasActiveDeskFilters}
          mobileTradeFiltersOpen={mobileTradeFiltersOpen}
          activeAdvancedTradeFilterCount={activeAdvancedTradeFilterCount}
          tradeSearchSummary={tradeSearchSummary}
          tradeSearchInput={tradeSearchInput}
          tradeSearchPlaceholder={tradeSearchPlaceholder}
          tradeTypeFilter={tradeTypeFilter}
          tradeTypeFilterOptions={tradeTypeFilterOptions}
          tradeSortMode={tradeSortMode}
          canOpenMyTradeTerminal={canOpenMyTradeTerminal}
          openMyTradeTerminal={openMyTradeTerminal}
          onRefreshMyTrades={() => { void refreshMyTrades().catch(() => {}); void linkActivity.refresh(); void counterActivity.refresh(); }}
          onSelectGroup={setMyTradeGroupView}
          currentPairLabel={currentTradePairLabel}
          pairScope={tradePairFilter === 'all' ? 'all' : 'current'}
          onPairScopeChange={(scope) => setTradePairFilter(scope === 'all' ? 'all' : currentTradePairFilterKey)}
          onClearFilters={clearTradeDeskFilters}
          onSearchInputChange={setTradeSearchInput}
          onClearSearch={() => setTradeSearchInput('')}
          onToggleMobileFilters={() => setMobileTradeFiltersOpen((isOpen) => !isOpen)}
          onTypeFilterChange={(value) => setTradeTypeFilter(value as TradeDeskTypeFilter)}
          onSortModeChange={(value) => setTradeSortMode(value as TradeDeskSortMode)}
          onCreateOffer={startFreshOneOffTrade}
          additionalActiveCount={(linkActivity.snapshot?.orders.filter(order => order.status === 'Open').length ?? 0) + (counterActivity.snapshot?.orders.filter(order => order.status === 1).length ?? 0)}
          additionalReceivedCount={counterActivity.snapshot?.orders.filter(order => order.status === 1 && order.taker === walletKey).length ?? 0}
          additionalHistoryCount={(linkActivity.snapshot?.history.length ?? 0) + (counterActivity.snapshot?.history.length ?? 0)}
          additionalPending={Boolean(walletHasAes && (sharedWalletSession?.otcV2ActionRuntime?.link && !linkActivity.snapshot?.complete || sharedWalletSession?.otcV2ActionRuntime?.counter && !counterActivity.snapshot?.complete))}
          renderAdditionalTrades={walletHasAes && sharedWalletSession?.otcV2ActionRuntime?.link ? (lifecycle, activeFilter) => <><LinkTradeV2Activity
            activity={linkActivity} runtime={sharedWalletSession.otcV2ActionRuntime!.link!} lifecycle={lifecycle} activeFilter={activeFilter}
            tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
            search={tradeSearchInput} pairFilter={tradePairFilter} typeFilter={tradeTypeFilter} sortMode={tradeSortMode}
            confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
            onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
          />{sharedWalletSession?.otcV2ActionRuntime?.counter ? <CounterTradeV2Activity
            activity={counterActivity} runtime={sharedWalletSession.otcV2ActionRuntime.counter} lifecycle={lifecycle} activeFilter={activeFilter}
            tokenInfoByKey={customTradeTokenInfoByAddress} ensureTokenInfo={ensureRecurringV2TokenInfo}
            search={tradeSearchInput} pairFilter={tradePairFilter} typeFilter={tradeTypeFilter} sortMode={tradeSortMode}
            actionInProgress={creatingTrade || Boolean(linkOwnerActionState?.wallet === walletKey && linkOwnerActionState.busy)}
            confirmFunding={ensureTradeFunding} runWalletFlow={runTradeWalletPromptFlow}
            onBusyChange={busy => setLinkOwnerActionState(previous => !busy && previous?.wallet !== walletKey ? previous : { wallet: walletKey, busy })}
          /> : null}</> : undefined}
          {...tradeOrderCardProps}
        />
      ) : null}

      <TradeActionConfirmModal
        confirmation={tradeActionConfirmation}
        onCancel={() => resolveTradeActionConfirmation(false)}
        onConfirm={() => resolveTradeActionConfirmation(true)}
      />
    </main>
    </>
  );
}
