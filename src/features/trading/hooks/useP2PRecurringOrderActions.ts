import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
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
import { readCurrentPrivateErc20BalanceWei } from '../../../lib/appChain';
import type { P2PActionNoticeAction, P2PActionNoticeInput } from '../../../lib/p2pActionNotice';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import {
  isTradeActionConfirmationCancelledError,
  type TradeFundingPreflightInput
} from '../../../lib/tradeActionConfirm';
import type { TradeComposerModel } from '../../../lib/tradeComposer';
import {
  createRecurringOrderOnChain,
  editRecurringOrderOnChain,
  fillRecurringOrderSideOnChain,
  updateRecurringOrderStatusOnChain
} from '../../../lib/tradeActions';
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
  type TradeCreateMode,
  type TradeSigner
} from '../components/P2PTradingPage.helpers';

type RecurringStatusAction = 'pause' | 'resume' | 'cancel';
type RecurringCombinedBalance = {
  combinedBalanceWei: bigint | null;
  ownerPrivacyRequired?: boolean;
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
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  nativeBalanceWei: bigint | null;
  navigateToTradePath: (path: string) => void;
  onActionNotice: (notice: P2PActionNoticeInput) => void;
  onCotiNetwork: boolean;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  pWispFooterBalanceState: PrivateTokenBalanceState;
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBuyFillInput: string;
  recurringBuyPriceInput: string;
  recurringHidePrivateAmounts: boolean;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringSellFillInput: string;
  recurringSellPriceInput: string;
  refreshTradeDataInBackground: (tradeId?: number, escrowContract?: string, signer?: TradeSigner) => void;
  rememberTradeTerminalReturn: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resolvedRouteAccessSecret: string;
  resolveRequiredFeeForTradeCreate: (escrowContract?: string | null) => Promise<bigint>;
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
  getTradeSigner,
  nativeBalanceWei,
  navigateToTradePath,
  onActionNotice,
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
    setTradeCreateMode('recurring');
    setEditingRecurringOrder(null);
    setRecurringBuyPriceInput('');
    setRecurringSellPriceInput('');
    clearRecurringInputs();
    setCreatedRecurringOrderId(null);
    setCreatedRecurringOrderLink('');
  }, [
    clearRecurringInputs,
    setCreatedRecurringOrderId,
    setCreatedRecurringOrderLink,
    setEditingRecurringOrder,
    setRecurringBuyPriceInput,
    setRecurringSellPriceInput,
    setTradeCreateMode
  ]);

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
    startFreshRecurringOrder();
  }, [startFreshRecurringOrder]);

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
      if (combinedBalance?.ownerPrivacyRequired) {
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
      setComposerNoticeError(
        'Enter a buy price and a sell price. Liquidity can stay empty until that side is funded.',
        recurringNoticeAction
      );
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
      includeCreateFee: !recurringOrderBeingEdited,
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
        const needsAes = baseToken.kind === 'private-erc20' || quoteToken.kind === 'private-erc20';
        const nativeFeeWei = recurringOrderBeingEdited
          ? 0n
          : await resolveRequiredFeeForTradeCreate(RECURRING_OTC_CONTRACT_ADDRESS);
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
        await ensureTradeFunding({
          actionLabel: recurringOrderBeingEdited ? 'update recurring order' : 'create recurring order',
          confirmButtonLabel: recurringOrderBeingEdited ? 'Update order' : 'Create order',
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
          tradeSummary: recurringSummary
        });
        onActionNotice({ action: recurringNoticeAction, status: 'pending', surface: 'composer' });
        const signer = await getTradeSigner(needsAes);
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
              const editResult = await editRecurringOrderOnChain({
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
                escrowContract: editingRecurringOrder?.escrowContract ?? RECURRING_OTC_CONTRACT_ADDRESS,
                txHash: editResult.txHash
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
          clearRecurringInputs();
          openTrade(result.orderId, undefined, result.escrowContract);
        }
        refreshTradeDataInBackground(result.orderId, result.escrowContract, signer);
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
      const message = error instanceof Error
        ? error.message
        : recurringOrderBeingEdited
          ? 'Failed to update recurring order.'
          : 'Failed to create recurring order.';
      const actionError = getProviderErrorMessage(error, message);
      setTradeActionError(actionError);
      onActionNotice({ action: recurringNoticeAction, message: actionError, status: 'error', surface: 'composer' });
    } finally {
      setCreatingRecurringOrder(false);
    }
  }, [
    buildTradeShareUrl,
    clearRecurringInputs,
    editingRecurringOrder,
    ensureTradeFunding,
    getTradeSigner,
    onActionNotice,
    onCotiNetwork,
    openTrade,
    recurringAddBuyBudgetInput,
    recurringAddSellInventoryInput,
    recurringBuyPriceInput,
    recurringHidePrivateAmounts,
    recurringRemoveBuyBudgetInput,
    recurringRemoveSellInventoryInput,
    recurringSellPriceInput,
    refreshTradeDataInBackground,
    resolveRequiredFeeForTradeCreate,
    runTradeWalletPromptFlow,
    setCreatedRecurringOrderId,
    setCreatedRecurringOrderLink,
    setCreatingRecurringOrder,
    setEditingRecurringOrder,
    setTradeActionError,
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
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
            rememberTradeTerminalReturn(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
          }
          const needsAes = recurring.mode !== 'public' || inputAsset.kind === 'private-erc20';
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
                outputAmountWei > 0n
                  ? formatWalletFundAmount(outputAmountWei, outputAsset)
                  : `Estimated ${outputAsset.symbol}`
            },
            {
              label: 'Side',
              value: side === 'buy' ? 'Sell side' : 'Buy side'
            }
          ];
          await ensureTradeFunding({
            actionLabel: options?.actionLabel ?? 'fill recurring order',
            confirmButtonLabel: options?.confirmButtonLabel,
            confirmMessage: options?.confirmMessage,
            confirmTitle: options?.confirmTitle,
            confirmationPolicy: options?.confirmationPolicy,
            tradeSummary: options?.tradeSummary ?? defaultTradeSummary,
            requirements: [
              {
                asset: inputAsset,
                amountWei: inputAmountWei,
                reason: 'recurring fill'
              }
            ]
          });
          const signer = await getTradeSigner(needsAes);
          if (inputAsset.kind === 'private-erc20' && inputAsset.tokenAddress) {
            const privateInputBalance = await readCurrentPrivateErc20BalanceWei(
              inputAsset.tokenAddress,
              walletAddress,
              signer
            ).catch(() => null);
            if (privateInputBalance === null) {
              throw new Error(`Unlock privacy and refresh your ${inputAsset.symbol} balance before selling.`);
            }
            if (privateInputBalance < inputAmountWei) {
              throw new Error(
                `Not enough ${inputAsset.symbol}. Available: ${formatTokenAmount(privateInputBalance, inputAsset.decimals, 6)} ${inputAsset.symbol}.`
              );
            }
          }
          const fillResult = await fillRecurringOrderSideOnChain({
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
          if (options?.openAfterAction !== false) {
            openTrade(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
          }
          refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract, signer);
          return fillResult;
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
        onActionNotice({ action: 'fill', message: actionError, status: 'error', surface: 'terminal', tradeKey });
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      ensureTradeFunding,
      getTradeSigner,
      onActionNotice,
      onCotiNetwork,
      openTrade,
      recurringBuyFillInput,
      recurringSellFillInput,
      refreshTradeDataInBackground,
      rememberTradeTerminalReturn,
      resolvedRouteAccessSecret,
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
          rememberTradeTerminalReturn(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
          const signer = await getTradeSigner(false);
          const statusResult = await updateRecurringOrderStatusOnChain({
            signer,
            orderId: recurring.orderId,
            action
          });
          openTrade(snapshot.tradeId, resolvedRouteAccessSecret || undefined, snapshot.escrowContract);
          refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract, signer);
          return statusResult;
        });
        onActionNotice({
          action: noticeAction,
          status: 'success',
          surface: 'terminal',
          tradeKey,
          txHash: actionResult.txHash
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recurring order update failed.';
        const actionError = getProviderErrorMessage(error, message);
        setTradeActionError(actionError);
        onActionNotice({ action: noticeAction, message: actionError, status: 'error', surface: 'terminal', tradeKey });
      } finally {
        setProcessingRecurringAction('');
      }
    },
    [
      getTradeSigner,
      onActionNotice,
      onCotiNetwork,
      openTrade,
      refreshTradeDataInBackground,
      rememberTradeTerminalReturn,
      resolvedRouteAccessSecret,
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
