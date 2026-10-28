import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  formatCotiAmount,
  formatTokenAmount,
  getProviderErrorMessage,
  isWalletAddress,
  parseTokenAmountInput,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  buildTradeCustomTokenInfoKey,
  getOnChainFailureMessage,
  type PrivateTokenBalanceState,
  type ResolvedTradeToken,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  getP2PActionFailureStatus,
  type P2PActionNoticeAction,
  type P2PActionNoticeInput
} from '../../../lib/p2pActionNotice';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import {
  isTradeActionConfirmationCancelledError,
  type TradeFundingPreflightInput
} from '../../../lib/tradeActionConfirm';
import type { TradeComposerModel } from '../../../lib/tradeComposer';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import {
  buildOtcV2ConditionalApproval,
  buildOtcV2ConfirmationDetails,
  resolveRecurringOtcV2ConfirmationCosts
} from '../../../lib/otcV2Confirmation';
import {
  formatWalletFundAmount
} from '../../../lib/walletFunds';
import {
  buildTradeComposerAssetBalanceKey
} from '../../../lib/tradeComposer';
import type { TradePricingField } from '../../../lib/tradePricing';
import type { TradeFillActionOptions } from './useP2PTradeActions';
import {
  buildTradeSurfacePath,
  type TradeEntryMode
} from './useP2PTradeRoute';
import {
  formatPriceInputFromTerms,
  parseTokenAmountString,
  resolveRecurringSideTerms,
  type RecurringFundingBalanceResult,
  type TradeCreateMode
} from '../components/P2PTradingPage.helpers';

type RecurringStatusAction = 'pause' | 'resume' | 'cancel';
type RecurringCombinedBalance = {
  combinedBalanceWei: bigint | null;
  privacyRequired?: boolean;
};

type UseP2PRecurringOrderActionsArgs = {
  buildCurrentTradeSurfacePath: (view: Parameters<typeof buildTradeSurfacePath>[0], tradeMode?: TradeEntryMode) => string;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  clearCounterTrade: () => void;
  clearEditTrade: () => void;
  combinedBalanceByAssetKey: Record<string, RecurringCombinedBalance>;
  counterParentTrade: TradeSnapshot | null;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  editingRecurringOrder: TradeSnapshot | null;
  editingTrade: TradeSnapshot | null;
  ensureTradeFunding: (input: TradeFundingPreflightInput) => Promise<void>;
  nativeBalanceWei: bigint | null;
  navigateToTradePath: (path: string) => void;
  onActionNotice: (notice: P2PActionNoticeInput) => void;
  onCotiNetwork: boolean;
  otcV2ActionRuntime?: OtcV2ActionRuntime | null;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  pWispFooterBalanceState: PrivateTokenBalanceState;
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBuyFillInput: string;
  recurringBuyPriceInput: string;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringSellFillInput: string;
  recurringSellPriceInput: string;
  refreshRecurringV2Trades: () => void;
  rememberTradeTerminalReturn: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  rewardTokenBalanceWei: bigint | null;
  runTradeWalletPromptFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setCreatedRecurringOrderId: Dispatch<SetStateAction<number | null>>;
  setCreatedRecurringOrderLink: Dispatch<SetStateAction<string>>;
  setCreatingRecurringOrder: Dispatch<SetStateAction<boolean>>;
  setEditingRecurringOrder: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setRecurringAddBuyBudgetInput: Dispatch<SetStateAction<string>>;
  setRecurringAddSellInventoryInput: Dispatch<SetStateAction<string>>;
  setRecurringBuyFillInput: Dispatch<SetStateAction<string>>;
  setRecurringBuyPriceInput: Dispatch<SetStateAction<string>>;
  setRecurringBuyReceiveEditable: Dispatch<SetStateAction<boolean>>;
  setRecurringBuyReceiveInput: Dispatch<SetStateAction<string>>;
  setRecurringHidePrivateAmounts: Dispatch<SetStateAction<boolean>>;
  setRecurringRemoveBuyBudgetInput: Dispatch<SetStateAction<string>>;
  setRecurringRemoveSellInventoryInput: Dispatch<SetStateAction<string>>;
  setRecurringSellFillInput: Dispatch<SetStateAction<string>>;
  setRecurringSellPriceInput: Dispatch<SetStateAction<string>>;
  setRecurringSellReceiveEditable: Dispatch<SetStateAction<boolean>>;
  setRecurringSellReceiveInput: Dispatch<SetStateAction<string>>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  setTradeCreateMode: Dispatch<SetStateAction<TradeCreateMode>>;
  setTradeExpiryHoursInput: Dispatch<SetStateAction<string>>;
  setTradeHasNoExpiry: Dispatch<SetStateAction<boolean>>;
  setTradeOfferAmountInput: Dispatch<SetStateAction<string>>;
  setTradeOfferCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeOfferTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradePriceInput: Dispatch<SetStateAction<string>>;
  setTradePricingEditedFields: Dispatch<SetStateAction<TradePricingField[]>>;
  setTradeRequestAmountInput: Dispatch<SetStateAction<string>>;
  setTradeRequestCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeRequestTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  startFreshTrade: () => void;
  tradeComposerModel: TradeComposerModel;
  tradeExpiryHoursInput: string;
  tradeHasNoExpiry: boolean;
  tradeRequiredFeeWei: bigint | null;
  walletAddress: string;
};

export default function useP2PRecurringOrderActions({
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
  onActionNotice,
  onCotiNetwork,
  otcV2ActionRuntime,
  openTrade,
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
}: UseP2PRecurringOrderActionsArgs) {
  const [processingRecurringAction, setProcessingRecurringAction] = useState('');

  const clearRecurringInputs = useCallback(() => {
    setRecurringAddBuyBudgetInput('');
    setRecurringAddSellInventoryInput('');
    setRecurringBuyReceiveInput('');
    setRecurringSellReceiveInput('');
    setRecurringBuyReceiveEditable(false);
    setRecurringSellReceiveEditable(false);
    setRecurringRemoveBuyBudgetInput('');
    setRecurringRemoveSellInventoryInput('');
  }, [
    setRecurringAddBuyBudgetInput,
    setRecurringAddSellInventoryInput,
    setRecurringBuyReceiveEditable,
    setRecurringBuyReceiveInput,
    setRecurringRemoveBuyBudgetInput,
    setRecurringRemoveSellInventoryInput,
    setRecurringSellReceiveEditable,
    setRecurringSellReceiveInput
  ]);

  const startFreshOneOffTrade = useCallback(() => {
    setTradeCreateMode('one-off');
    setTradePriceInput('');
    setTradePricingEditedFields([]);
    setEditingRecurringOrder(null);
    clearRecurringInputs();
    startFreshTrade();
  }, [
    clearRecurringInputs,
    setEditingRecurringOrder,
    setTradeCreateMode,
    setTradePriceInput,
    setTradePricingEditedFields,
    startFreshTrade
  ]);

  const startFreshRecurringOrder = useCallback(() => {
    startFreshOneOffTrade();
    setTradeActionError('New recurring orders are no longer available. Create a one-off trade instead.');
  }, [setTradeActionError, startFreshOneOffTrade]);

  const cancelCounterCreate = useCallback(() => {
    clearCounterTrade();
    setTradeCreateMode('one-off');
    setTradeOfferAmountInput('');
    setTradeRequestAmountInput('');
    setTradePriceInput('');
    setTradePricingEditedFields([]);
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setTradeHasNoExpiry(false);
    navigateToTradePath(buildCurrentTradeSurfacePath('trade'));
  }, [
    buildCurrentTradeSurfacePath,
    clearCounterTrade,
    navigateToTradePath,
    setTradeCreateMode,
    setTradeExpiryHoursInput,
    setTradeHasNoExpiry,
    setTradeOfferAmountInput,
    setTradePriceInput,
    setTradePricingEditedFields,
    setTradeRequestAmountInput
  ]);

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
      clearRecurringInputs();
      setCreatedRecurringOrderId(null);
      setCreatedRecurringOrderLink('');
      navigateToTradePath(buildCurrentTradeSurfacePath('recurring'));
    },
    [
      buildCurrentTradeSurfacePath,
      clearCounterTrade,
      clearEditTrade,
      clearRecurringInputs,
      navigateToTradePath,
      resolveRecurringAssetSelection,
      setCreatedRecurringOrderId,
      setCreatedRecurringOrderLink,
      setEditingRecurringOrder,
      setRecurringBuyPriceInput,
      setRecurringHidePrivateAmounts,
      setRecurringSellPriceInput,
      setTradeCreateMode,
      setTradeOfferCustomTokenAddress,
      setTradeOfferTokenSelection,
      setTradeRequestCustomTokenAddress,
      setTradeRequestTokenSelection
    ]
  );

  const clearRecurringEdit = useCallback(() => {
    startFreshOneOffTrade();
  }, [startFreshOneOffTrade]);

  useEffect(() => {
    if (editingTrade || counterParentTrade) {
      setTradeCreateMode('one-off');
      setTradePriceInput('');
      setTradePricingEditedFields([]);
      setEditingRecurringOrder(null);
    }
  }, [
    counterParentTrade,
    editingTrade,
    setEditingRecurringOrder,
    setTradeCreateMode,
    setTradePriceInput,
    setTradePricingEditedFields
  ]);

  const resolveRecurringFundingBalance = useCallback(
    (token: ResolvedTradeToken): RecurringFundingBalanceResult => {
      const combinedBalance = combinedBalanceByAssetKey[buildTradeComposerAssetBalanceKey(token)];
      if (token.kind === 'native') {
        return {
          balanceWei: combinedBalance?.combinedBalanceWei ?? nativeBalanceWei,
          unavailableMessage:
            (combinedBalance?.combinedBalanceWei ?? nativeBalanceWei) === null
              ? `Unable to read your ${TIP_NATIVE_TOKEN_SYMBOL} balance yet.`
              : undefined
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
            balanceWei: combinedBalance?.combinedBalanceWei ?? rewardTokenBalanceWei,
            unavailableMessage:
              (combinedBalance?.combinedBalanceWei ?? rewardTokenBalanceWei) === null
                ? `Unable to read your ${token.symbol} balance yet.`
                : undefined
          };
        }

        const info = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('erc20', tokenAddress)];
        return {
          balanceWei: combinedBalance?.combinedBalanceWei ?? info?.balanceWei ?? null,
          unavailableMessage:
            info?.loading
              ? `Loading ${token.symbol} balance. Try again in a moment.`
              : info?.error ?? ((combinedBalance?.combinedBalanceWei ?? info?.balanceWei) === null || !info ? `Unable to read your ${token.symbol} balance yet.` : undefined)
        };
      }

      if (combinedBalance?.combinedBalanceWei !== null && combinedBalance?.combinedBalanceWei !== undefined) {
        return { balanceWei: combinedBalance.combinedBalanceWei };
      }
      if (combinedBalance?.privacyRequired) {
        return {
          balanceWei: null,
          unavailableMessage: `Unlock owner privacy to include owner ${token.symbol} balance.`
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
      combinedBalanceByAssetKey,
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
      const combinedNativeBalanceWei = combinedBalanceByAssetKey['native:coti']?.combinedBalanceWei ?? nativeBalanceWei;
      if (combinedNativeBalanceWei === null) {
        return `Unable to read your ${TIP_NATIVE_TOKEN_SYMBOL} balance yet.`;
      }
      if (nativeRequiredWei > combinedNativeBalanceWei) {
        return `Insufficient ${TIP_NATIVE_TOKEN_SYMBOL} balance. Need ${formatCotiAmount(
          nativeRequiredWei
        )} ${TIP_NATIVE_TOKEN_SYMBOL} to fund recurring liquidity${includeCreateFee ? ' and the fee' : ''}; available ${formatCotiAmount(
          combinedNativeBalanceWei
        )} ${TIP_NATIVE_TOKEN_SYMBOL}.`;
      }
      return '';
    },
    [combinedBalanceByAssetKey, nativeBalanceWei, resolveRecurringFundingBalance, tradeRequiredFeeWei]
  );

  const createRecurringOrder = useCallback(async () => {
    const recurringOrderBeingEdited = editingRecurringOrder?.recurringOrder ?? null;
    const baseRecurringNoticeAction: P2PActionNoticeAction = recurringOrderBeingEdited
      ? 'recurring-update'
      : 'create-recurring-order';
    const setComposerNoticeError = (message: string, action: P2PActionNoticeAction = baseRecurringNoticeAction) => {
      setTradeActionError(message);
      onActionNotice({ action, message, status: 'error', surface: 'composer' });
    };
    // Existing order management must remain available for funded recovery.
    if (!recurringOrderBeingEdited) {
      setComposerNoticeError('New recurring orders are no longer available. Create a one-off trade instead.');
      return;
    }
    const baseToken = tradeComposerModel.selectedTradeOfferToken;
    const quoteToken = tradeComposerModel.selectedTradeRequestToken;
    if (!walletAddress) {
      setComposerNoticeError('Connect a wallet first.');
      return;
    }
    if (!onCotiNetwork) {
      setComposerNoticeError('Switch to COTI network first.');
      return;
    }
    if (!baseToken || !quoteToken) {
      setComposerNoticeError('Select base and quote assets first.');
      return;
    }
    if (
      baseToken.kind === quoteToken.kind &&
      (baseToken.tokenAddress ?? '').toLowerCase() === (quoteToken.tokenAddress ?? '').toLowerCase()
    ) {
      setComposerNoticeError('Recurring orders need two different assets.');
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
    const liquidityChanged =
      addBaseInventoryWei > 0n ||
      addQuoteInventoryWei > 0n ||
      removeBaseInventoryWei > 0n ||
      removeQuoteInventoryWei > 0n;
    const recurringNoticeAction: P2PActionNoticeAction = recurringOrderBeingEdited
      ? liquidityChanged
        ? 'recurring-liquidity'
        : 'recurring-update'
      : 'create-recurring-order';
    const baseIsPrivate = baseToken.kind === 'private-erc20';
    const quoteIsPrivate = quoteToken.kind === 'private-erc20';
    if (!otcV2ActionRuntime?.isCurrent()) {
      setComposerNoticeError('The verified OTC V2 suite is unavailable in the current wallet session.', recurringNoticeAction);
      return;
    }
    if (recurringOrderBeingEdited && !recurringOrderBeingEdited.v2) {
      setComposerNoticeError('Legacy recurring orders are read-only. Create a recurring OTC V2 order.', recurringNoticeAction);
      return;
    }
    if (baseIsPrivate !== quoteIsPrivate) {
      setComposerNoticeError(
        'OTC V2 recurring orders require either two public assets or two private tokens. Mixed public/private pairs are not supported.',
        recurringNoticeAction
      );
      return;
    }
    const v2Protocol = recurringOrderBeingEdited?.v2?.protocol ?? (baseIsPrivate ? 'private-recurring-v2' : 'recurring-v2');
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
      setComposerNoticeError(
        'Enter a buy price and a sell price. Liquidity can stay empty until that side is funded.',
        recurringNoticeAction
      );
      return;
    }
    const privateRecurringPricesChanged = Boolean(
      recurringOrderBeingEdited &&
      v2Protocol === 'private-recurring-v2' &&
      (
        recurringOrderBeingEdited.buyTerms.baseAmount !== buyTerms.baseAmountWei.toString() ||
        recurringOrderBeingEdited.buyTerms.quoteAmount !== buyTerms.quoteAmountWei.toString() ||
        recurringOrderBeingEdited.sellTerms.baseAmount !== sellTerms.baseAmountWei.toString() ||
        recurringOrderBeingEdited.sellTerms.quoteAmount !== sellTerms.quoteAmountWei.toString()
      )
    );
    if (
      recurringOrderBeingEdited &&
      v2Protocol === 'private-recurring-v2' &&
      !privateRecurringPricesChanged &&
      !liquidityChanged
    ) {
      setComposerNoticeError('Change a price or liquidity amount before updating this private recurring order.');
      return;
    }
    if (!recurringOrderBeingEdited && addBaseInventoryWei <= 0n && addQuoteInventoryWei <= 0n) {
      setComposerNoticeError('Add buy liquidity, sell liquidity, or both to start the order.', recurringNoticeAction);
      return;
    }
    const fundingValidationMessage = validateRecurringFundingBalances({
      addBaseInventoryWei,
      addQuoteInventoryWei,
      baseToken,
      includeCreateFee: false,
      quoteToken
    });
    if (fundingValidationMessage) {
      setComposerNoticeError(fundingValidationMessage, recurringNoticeAction);
      return;
    }

    setTradeActionError('');
    setCreatingRecurringOrder(true);
    try {
      const actionResult = await runTradeWalletPromptFlow(async () => {
        const nativeFeeWei = 0n;
        const recurringSummary = [
          {
            label: 'Pair',
            value: `${baseToken.symbol}/${quoteToken.symbol}`
          },
          {
            label: 'Buy price',
            value: `${recurringBuyPriceInput} ${quoteToken.symbol}/${baseToken.symbol}`
          },
          {
            label: 'Sell price',
            value: `${recurringSellPriceInput} ${quoteToken.symbol}/${baseToken.symbol}`
          }
        ];
        if (addBaseInventoryWei > 0n) {
          recurringSummary.push({
            label: 'Sell liquidity',
            value: formatWalletFundAmount(addBaseInventoryWei, baseToken)
          });
        }
        if (addQuoteInventoryWei > 0n) {
          recurringSummary.push({
            label: 'Buy liquidity',
            value: formatWalletFundAmount(addQuoteInventoryWei, quoteToken)
          });
        }
        if (nativeFeeWei > 0n) {
          recurringSummary.push({
            label: 'Fee',
            value: formatWalletFundAmount(
              nativeFeeWei,
              {
                kind: 'native',
                symbol: TIP_NATIVE_TOKEN_SYMBOL,
                decimals: 18
              },
              6
            )
          });
        }
        const v2Approvals = [
              buildOtcV2ConditionalApproval({
                amountWei: addBaseInventoryWei,
                kind: baseToken.kind === 'native' ? 'none' : baseToken.kind,
                symbol: baseToken.symbol
              }),
              buildOtcV2ConditionalApproval({
                amountWei: addQuoteInventoryWei,
                kind: quoteToken.kind === 'native' ? 'none' : quoteToken.kind,
                symbol: quoteToken.symbol
              })
            ].filter((approval): approval is NonNullable<typeof approval> => approval !== null);
        const v2Costs = resolveRecurringOtcV2ConfirmationCosts({
              creating: !recurringOrderBeingEdited,
              liquidityChanged,
              pricesChanged: privateRecurringPricesChanged,
              protocol: v2Protocol
            });
        const v2Confirmation = buildOtcV2ConfirmationDetails({
              actionTransactionCount: v2Costs.actionTransactionCount,
              approvals: v2Approvals,
              cotiPrivateInputCount: v2Costs.cotiPrivateInputCount,
              summaryRows: recurringSummary
            });
        await ensureTradeFunding({
          actionLabel: recurringOrderBeingEdited ? 'update recurring order' : 'create recurring order',
          confirmButtonLabel: recurringOrderBeingEdited ? 'Update order' : 'Create order',
           confirmMessage: v2Confirmation.confirmMessage,
           confirmationStats: v2Confirmation.confirmationStats,
          confirmTitle: recurringOrderBeingEdited ? 'Confirm recurring update' : 'Confirm recurring order',
          confirmationPolicy: 'always',
          requirements: [
            {
              asset: baseToken,
              amountWei: addBaseInventoryWei,
              reason: 'sell liquidity'
            },
            {
              asset: quoteToken,
              amountWei: addQuoteInventoryWei,
              reason: 'buy liquidity'
            },
            {
              asset: {
                kind: 'native',
                symbol: TIP_NATIVE_TOKEN_SYMBOL,
                decimals: 18
              },
              amountWei: nativeFeeWei,
              reason: 'trade fee'
            }
          ],
          tradeSummary: v2Confirmation.tradeSummary
        });
        onActionNotice({ action: recurringNoticeAction, status: 'pending', surface: 'composer' });
        let result: { orderId: number; escrowContract: string; txHash?: string };
        {
          const deployment = otcV2ActionRuntime.deployments[v2Protocol];
          const editingIdentity = recurringOrderBeingEdited?.v2;
          if (editingIdentity && (
            editingIdentity.protocol !== v2Protocol ||
            editingIdentity.chainId !== deployment.chainId ||
            editingIdentity.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() ||
            editingRecurringOrder?.escrowContract?.toLowerCase() !== deployment.contractAddress.toLowerCase()
          )) {
            throw new Error('This recurring order does not match the verified OTC V2 deployment.');
          }
          const parsedExpiryHours = Number(tradeExpiryHoursInput);
          if (!tradeHasNoExpiry && (
            !Number.isFinite(parsedExpiryHours) || parsedExpiryHours <= 0 || parsedExpiryHours > 365 * 24
          )) {
            throw new Error('Recurring order expiry must be between 1 hour and 365 days.');
          }
          const expiresAt = recurringOrderBeingEdited
            ? editingRecurringOrder?.expiresAt ?? 0
            : tradeHasNoExpiry
              ? 0
              : Math.floor(Date.now() / 1000) + Math.floor(parsedExpiryHours * 3600);
          let confirmed: { orderId?: string; transactionHash: string };
          if (v2Protocol === 'recurring-v2') {
            const publicAsset = (token: typeof baseToken) => ({
              assetType: token.kind === 'native' ? 'native' as const : 'erc20' as const,
              ...(token.kind === 'native' ? {} : { token: token.tokenAddress })
            });
            confirmed = await otcV2ActionRuntime.recurring(recurringOrderBeingEdited
              ? {
                  kind: 'edit',
                  orderId: recurringOrderBeingEdited.orderId,
                  expectedRevision: editingIdentity!.revision,
                  buyTerms: { baseAmount: buyTerms.baseAmountWei, quoteAmount: buyTerms.quoteAmountWei },
                  sellTerms: { baseAmount: sellTerms.baseAmountWei, quoteAmount: sellTerms.quoteAmountWei },
                  baseAdded: addBaseInventoryWei,
                  quoteAdded: addQuoteInventoryWei,
                  baseRemoved: removeBaseInventoryWei,
                  quoteRemoved: removeQuoteInventoryWei,
                  expiresAt
                }
              : {
                  kind: 'create',
                  baseAsset: publicAsset(baseToken),
                  quoteAsset: publicAsset(quoteToken),
                  buyTerms: { baseAmount: buyTerms.baseAmountWei, quoteAmount: buyTerms.quoteAmountWei },
                  sellTerms: { baseAmount: sellTerms.baseAmountWei, quoteAmount: sellTerms.quoteAmountWei },
                  initialBaseInventory: addBaseInventoryWei,
                  initialQuoteInventory: addQuoteInventoryWei,
                  expiresAt
                });
          } else {
            if (!baseToken.tokenAddress || !quoteToken.tokenAddress) {
              throw new Error('Private recurring V2 requires two private token addresses.');
            }
            if (addBaseInventoryWei > 0n && removeBaseInventoryWei > 0n) {
              throw new Error('Add or remove base liquidity in one update, not both.');
            }
            if (addQuoteInventoryWei > 0n && removeQuoteInventoryWei > 0n) {
              throw new Error('Add or remove quote liquidity in one update, not both.');
            }
            if (!recurringOrderBeingEdited) {
              confirmed = await otcV2ActionRuntime.privateRecurring({
                kind: 'create',
                baseToken: baseToken.tokenAddress,
                quoteToken: quoteToken.tokenAddress,
                buyTerms: { baseAmount: buyTerms.baseAmountWei, quoteAmount: buyTerms.quoteAmountWei },
                sellTerms: { baseAmount: sellTerms.baseAmountWei, quoteAmount: sellTerms.quoteAmountWei },
                baseInventory: addBaseInventoryWei,
                quoteInventory: addQuoteInventoryWei,
                expiresAt
              });
            } else {
              const revision = BigInt(editingIdentity!.revision);
              let last: { orderId?: string; transactionHash: string } | undefined;
              if (privateRecurringPricesChanged) {
                last = await otcV2ActionRuntime.privateRecurring({
                  kind: 'edit-prices',
                  orderId: recurringOrderBeingEdited.orderId,
                  expectedRevision: revision,
                  buyTerms: { baseAmount: buyTerms.baseAmountWei, quoteAmount: buyTerms.quoteAmountWei },
                  sellTerms: { baseAmount: sellTerms.baseAmountWei, quoteAmount: sellTerms.quoteAmountWei },
                  expiresAt
                });
              }
              if (liquidityChanged) {
                last = await otcV2ActionRuntime.privateRecurring({
                  kind: 'adjust-liquidity',
                  orderId: recurringOrderBeingEdited.orderId,
                  expectedRevision: revision + (privateRecurringPricesChanged ? 1n : 0n),
                  base: {
                    direction: removeBaseInventoryWei > 0n ? 'remove' : 'add',
                    amount: removeBaseInventoryWei > 0n ? removeBaseInventoryWei : addBaseInventoryWei
                  },
                  quote: {
                    direction: removeQuoteInventoryWei > 0n ? 'remove' : 'add',
                    amount: removeQuoteInventoryWei > 0n ? removeQuoteInventoryWei : addQuoteInventoryWei
                  }
                });
              }
              if (!last) throw new Error('No private recurring V2 changes were selected.');
              confirmed = last;
            }
          }
          const confirmedOrderId = confirmed.orderId ?? String(recurringOrderBeingEdited?.orderId ?? '');
          const numericOrderId = Number(confirmedOrderId);
          if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
            throw new Error('The confirmed recurring V2 order ID is invalid.');
          }
          result = {
            orderId: numericOrderId,
            escrowContract: deployment.contractAddress,
            txHash: confirmed.transactionHash
          };
        }
        setCreatedRecurringOrderId(result.orderId);
        const nextLink = buildTradeShareUrl(result.orderId, undefined, result.escrowContract);
        setCreatedRecurringOrderLink(nextLink);
        if (recurringOrderBeingEdited) {
          setEditingRecurringOrder(null);
          clearRecurringInputs();
          openTrade(result.orderId, undefined, result.escrowContract);
        }
        refreshRecurringV2Trades();
        openTrade(result.orderId, undefined, result.escrowContract);
        return result;
      });
      onActionNotice({
        action: recurringNoticeAction,
        status: 'success',
        surface: 'composer',
        txHash: actionResult.txHash
      });
    } catch (error) {
      if (isTradeActionConfirmationCancelledError(error)) {
        return;
      }
      const actionError = getProviderErrorMessage(
        error,
        recurringOrderBeingEdited
          ? 'Failed to update recurring order.'
          : 'Failed to create recurring order.'
      );
      setTradeActionError(actionError);
      onActionNotice({
        action: recurringNoticeAction,
        message: actionError,
        status: getP2PActionFailureStatus(actionError),
        surface: 'composer'
      });
    } finally {
      setCreatingRecurringOrder(false);
    }
  }, [
    buildTradeShareUrl,
    clearRecurringInputs,
    editingRecurringOrder,
    ensureTradeFunding,
    onActionNotice,
    onCotiNetwork,
    openTrade,
    otcV2ActionRuntime,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBuyPriceInput,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    recurringSellPriceInput,
    refreshRecurringV2Trades,
    runTradeWalletPromptFlow,
    setCreatedRecurringOrderId,
    setCreatedRecurringOrderLink,
    setCreatingRecurringOrder,
    setEditingRecurringOrder,
    setTradeActionError,
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
    tradeExpiryHoursInput,
    tradeHasNoExpiry,
    validateRecurringFundingBalances,
    walletAddress
  ]);

  const fillRecurringOrderSide = useCallback(
    async (
      snapshot: TradeSnapshot,
      side: 'buy' | 'sell',
      amountInputOverride?: string,
      options?: TradeFillActionOptions
    ) => {
      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return;
      }
      const v2Identity = recurring.v2;
      if (!v2Identity) {
        const message = 'Legacy recurring orders are read-only. Create or use a recurring OTC V2 order.';
        setTradeActionError(message);
        onActionNotice({ action: 'fill', message, status: 'error', surface: 'terminal', tradeKey: getSnapshotKey(snapshot) });
        return;
      }
      const tradeKey = getSnapshotKey(snapshot);
      if (!walletAddress) {
        const message = 'Connect a wallet first.';
        setTradeActionError(message);
        onActionNotice({ action: 'fill', message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }
      if (!onCotiNetwork) {
        const message = 'Switch to COTI network first.';
        setTradeActionError(message);
        onActionNotice({ action: 'fill', message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }
      const inputAsset = side === 'buy' ? recurring.baseAsset : recurring.quoteAsset;
      const outputAsset = side === 'buy' ? recurring.quoteAsset : recurring.baseAsset;
      const inputValue = amountInputOverride ?? (side === 'buy' ? recurringBuyFillInput : recurringSellFillInput);
      const inputAmountWei = parseTokenAmountInput(inputValue, inputAsset.decimals);
      if (inputAmountWei === null || inputAmountWei <= 0n) {
        const message = `Enter ${inputAsset.symbol} to sell.`;
        setTradeActionError(message);
        onActionNotice({ action: 'fill', message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }
      const terms = side === 'buy' ? recurring.buyTerms : recurring.sellTerms;
      const termBaseAmount = parseTokenAmountString(terms.baseAmount);
      const termQuoteAmount = parseTokenAmountString(terms.quoteAmount);
      const outputAmountWei =
        termBaseAmount > 0n && termQuoteAmount > 0n
          ? side === 'buy'
            ? (inputAmountWei * termQuoteAmount) / termBaseAmount
            : (inputAmountWei * termBaseAmount) / termQuoteAmount
          : 0n;

      const actionKey = `${tradeKey}:${side}`;
      setTradeActionError('');
      setProcessingRecurringAction(actionKey);
      try {
        onActionNotice({ action: 'fill', status: 'pending', surface: 'terminal', tradeKey });
        const actionResult = await runTradeWalletPromptFlow(async () => {
          if (options?.rememberTerminalReturn !== false) {
            rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
          }
          let canonicalV2OutputAmount: bigint | null = null;
          if (!otcV2ActionRuntime || !otcV2ActionRuntime.isCurrent()) {
            throw new Error('This OTC V2 order is unavailable in the current wallet session.');
          }
          const deployment = otcV2ActionRuntime.deployments[v2Identity.protocol];
          if (
            deployment.chainId !== v2Identity.chainId ||
            deployment.contractAddress.toLowerCase() !== v2Identity.contractAddress.toLowerCase() ||
            snapshot.escrowContract?.toLowerCase() !== v2Identity.contractAddress.toLowerCase()
          ) {
            throw new Error('This recurring order does not match the verified OTC V2 deployment.');
          }
          if (v2Identity.protocol === 'recurring-v2') {
            const quote = await otcV2ActionRuntime.quoteRecurring(
              recurring.orderId,
              side,
              inputAmountWei
            );
            if (quote.revision !== v2Identity.revision) {
              throw new Error('This recurring quote is stale. Refresh the order and review it again.');
            }
            canonicalV2OutputAmount = BigInt(quote.outputAmount);
          }
          const defaultTradeSummary = [
            {
              label: 'Order',
              value: `#${recurring.orderId}`
            },
            {
              label: 'You sell',
              value: formatWalletFundAmount(inputAmountWei, inputAsset)
            },
            {
              label: 'You buy',
              value:
                (canonicalV2OutputAmount ?? outputAmountWei) > 0n
                  ? `${v2Identity?.protocol === 'private-recurring-v2' ? 'Up to ' : ''}${formatWalletFundAmount(
                      canonicalV2OutputAmount ?? outputAmountWei,
                      outputAsset
                    )}`
                  : `Estimated ${outputAsset.symbol}`
            },
            {
              label: 'Side',
              value: side === 'buy' ? 'Sell side' : 'Buy side'
            }
          ];
          const v2Approval = buildOtcV2ConditionalApproval({
                amountWei: inputAmountWei,
                kind: inputAsset.kind === 'native' ? 'none' : inputAsset.kind,
                symbol: inputAsset.symbol
              });
          const v2Confirmation = buildOtcV2ConfirmationDetails({
                approvals: v2Approval ? [v2Approval] : [],
                cotiPrivateInputCount: v2Identity.protocol === 'private-recurring-v2' ? 1 : 0,
                summaryRows: options?.tradeSummary ?? defaultTradeSummary
              });
          await ensureTradeFunding({
            actionLabel: options?.actionLabel ?? 'fill recurring order',
            confirmButtonLabel: options?.confirmButtonLabel,
            confirmMessage: options?.confirmMessage ?? v2Confirmation.confirmMessage,
            confirmationStats: v2Confirmation.confirmationStats ?? options?.confirmationStats,
            confirmTitle: options?.confirmTitle,
            confirmationPolicy: 'always',
            tradeSummary: v2Confirmation.tradeSummary ?? options?.tradeSummary ?? defaultTradeSummary,
            requirements: [
              {
                asset: inputAsset,
                amountWei: inputAmountWei,
                reason: 'recurring fill'
              }
            ]
          });
          const confirmed = v2Identity.protocol === 'recurring-v2'
              ? await otcV2ActionRuntime!.recurring({
                  kind: 'execute',
                  orderId: recurring.orderId,
                  side,
                  expectedRevision: v2Identity.revision,
                  maxInputAmount: inputAmountWei,
                  minOutputAmount: canonicalV2OutputAmount ?? 1n
                })
              : await otcV2ActionRuntime!.privateRecurring({
                  kind: 'execute',
                  orderId: recurring.orderId,
                  side,
                  expectedRevision: v2Identity.revision,
                  maxInputAmount: inputAmountWei,
                  minOutputAmount: 1n
                });
          if (side === 'buy') setRecurringBuyFillInput('');
          else setRecurringSellFillInput('');
          if (options?.openAfterAction !== false) {
            openTrade(snapshot.tradeId, undefined, snapshot.escrowContract);
          }
          refreshRecurringV2Trades();
          return { filledTxHash: confirmed.transactionHash };
        });
        onActionNotice({
          action: 'fill',
          status: 'success',
          surface: 'terminal',
          tradeKey,
          txHash: actionResult.filledTxHash,
          requestedFill:
            recurring.mode !== 'public'
              ? {
                  amountWei: inputAmountWei.toString(),
                  asset: inputAsset,
                  role: 'sold',
                  privateLiquidity: true
                }
              : undefined
        });
      } catch (error) {
        if (isTradeActionConfirmationCancelledError(error)) {
          onActionNotice({ action: 'fill', message: 'Action cancelled', status: 'info', surface: 'terminal', tradeKey });
          return;
        }
        const fallbackMessage =
          inputAsset.kind === 'private-erc20'
            ? `Private ${inputAsset.symbol} transfer failed. Check your balance, unlock privacy, and try again.`
            : outputAsset.kind === 'private-erc20'
              ? `Private ${outputAsset.symbol} payout failed. Unlock privacy for this wallet and try again.`
              : 'Recurring order fill failed.';
        const actionError = getOnChainFailureMessage(error, fallbackMessage);
        setTradeActionError(actionError);
        onActionNotice({
          action: 'fill',
          message: actionError,
          status: getP2PActionFailureStatus(actionError),
          surface: 'terminal',
          tradeKey
        });
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      ensureTradeFunding,
      onActionNotice,
      onCotiNetwork,
      openTrade,
      otcV2ActionRuntime,
      recurringBuyFillInput,
      recurringSellFillInput,
      refreshRecurringV2Trades,
      rememberTradeTerminalReturn,
      runTradeWalletPromptFlow,
      setRecurringBuyFillInput,
      setRecurringSellFillInput,
      setTradeActionError,
      walletAddress
    ]
  );

  const updateRecurringOrderStatus = useCallback(
    async (snapshot: TradeSnapshot, action: RecurringStatusAction) => {
      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return;
      }
      const tradeKey = getSnapshotKey(snapshot);
      const noticeAction: P2PActionNoticeAction = action === 'cancel' ? 'recurring-close' : 'recurring-update';
      if (!recurring.v2) {
        const message = 'Legacy recurring orders are read-only. Create or use a recurring OTC V2 order.';
        setTradeActionError(message);
        onActionNotice({ action: noticeAction, message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }
      const v2Identity = recurring.v2;
      if (!walletAddress) {
        const message = 'Connect a wallet first.';
        setTradeActionError(message);
        onActionNotice({ action: noticeAction, message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }
      if (!onCotiNetwork) {
        const message = 'Switch to COTI network first.';
        setTradeActionError(message);
        onActionNotice({ action: noticeAction, message, status: 'error', surface: 'terminal', tradeKey });
        return;
      }

      const actionKey = `${tradeKey}:${action}`;
      setTradeActionError('');
      setProcessingRecurringAction(actionKey);
      try {
        onActionNotice({ action: noticeAction, status: 'pending', surface: 'terminal', tradeKey });
        const actionResult = await runTradeWalletPromptFlow(async () => {
          rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
          if (!otcV2ActionRuntime || !otcV2ActionRuntime.isCurrent()) {
            throw new Error('This OTC V2 order is unavailable in the current wallet session.');
          }
          const deployment = otcV2ActionRuntime.deployments[v2Identity.protocol];
          if (
            deployment.chainId !== v2Identity.chainId ||
            deployment.contractAddress.toLowerCase() !== v2Identity.contractAddress.toLowerCase() ||
            snapshot.escrowContract?.toLowerCase() !== v2Identity.contractAddress.toLowerCase()
          ) {
            throw new Error('This recurring order does not match the verified OTC V2 deployment.');
          }
          const actionCopy = action === 'cancel'
              ? { label: 'close recurring order', primary: 'Close order', title: 'Confirm close order' }
              : action === 'pause'
                ? { label: 'pause recurring order', primary: 'Pause order', title: 'Confirm pause' }
                : { label: 'resume recurring order', primary: 'Resume order', title: 'Confirm resume' };
          const confirmation = buildOtcV2ConfirmationDetails({
              cotiPrivateInputCount: 0,
              summaryRows: [{ label: 'Order', value: `#${recurring.orderId}` }]
            });
          await ensureTradeFunding({
              actionLabel: actionCopy.label,
              confirmButtonLabel: actionCopy.primary,
              confirmMessage: confirmation.confirmMessage,
              confirmationPolicy: 'always',
              confirmationStats: confirmation.confirmationStats,
              confirmTitle: actionCopy.title,
              requirements: [],
              tradeSummary: confirmation.tradeSummary
            });
          const confirmed = v2Identity.protocol === 'recurring-v2'
              ? await otcV2ActionRuntime.recurring({
                  kind: action,
                  orderId: recurring.orderId,
                  expectedRevision: v2Identity.revision
                })
              : await otcV2ActionRuntime.privateRecurring({
                  kind: action,
                  orderId: recurring.orderId,
                  expectedRevision: v2Identity.revision
                });
          openTrade(snapshot.tradeId, undefined, snapshot.escrowContract);
          refreshRecurringV2Trades();
          return { txHash: confirmed.transactionHash };
        });
        onActionNotice({
          action: noticeAction,
          status: 'success',
          surface: 'terminal',
          tradeKey,
          txHash: actionResult.txHash
        });
      } catch (error) {
        if (isTradeActionConfirmationCancelledError(error)) {
          onActionNotice({
            action: noticeAction,
            message: 'Action cancelled',
            status: 'info',
            surface: 'terminal',
            tradeKey
          });
          return;
        }
        const actionError = getProviderErrorMessage(error, 'Recurring order update failed.');
        setTradeActionError(actionError);
        onActionNotice({
          action: noticeAction,
          message: actionError,
          status: getP2PActionFailureStatus(actionError),
          surface: 'terminal',
          tradeKey
        });
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      ensureTradeFunding,
      onActionNotice,
      onCotiNetwork,
      openTrade,
      otcV2ActionRuntime,
      refreshRecurringV2Trades,
      rememberTradeTerminalReturn,
      runTradeWalletPromptFlow,
      setTradeActionError,
      walletAddress
    ]
  );

  return {
    beginEditRecurringOrder,
    cancelCounterCreate,
    clearRecurringEdit,
    createRecurringOrder,
    fillRecurringOrderSide,
    processingRecurringAction,
    startFreshOneOffTrade,
    startFreshRecurringOrder,
    updateRecurringOrderStatus
  };
}
