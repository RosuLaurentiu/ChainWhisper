import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  isWalletAddress,
  sanitizeTokenAmountInput,
  type TradeFeeModeSelection
} from '../../../lib/appShared';
import {
  buildTradeCustomTokenInfoKey,
  getVerifiedEcosystemToken,
  resolveTradePresetKind,
  type ResolvedTradeToken,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  deriveTradeComposerModel,
  resolveSelectedTradeToken
} from '../../../lib/tradeComposer';
import {
  invertPriceInput,
  nextTradePricingEditedFields,
  type TradePricingField
} from '../../../lib/tradePricing';
import { getOtcSwapAssetKey, type OtcSwapInputMode } from '../../../lib/otcSwapQuote';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type CombinedBalanceByAssetKey = Record<
  string,
  {
    combinedBalanceWei: bigint | null;
    ownerPrivacyRequired?: boolean;
    availableLabel?: string;
    breakdownLabel?: string;
    splitLabel?: string;
  }
>;

type UseP2PTradeComposerModelArgs = {
  combinedBalanceByAssetKey: CombinedBalanceByAssetKey;
  creatingTrade: boolean;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  editingVisibleTrade: boolean;
  hasCounterParentTrade: boolean;
  nativeBalanceWei: bigint | null;
  onCotiNetwork: boolean;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  setRecurringBuyPriceInput: StateSetter<string>;
  setRecurringSellPriceInput: StateSetter<string>;
  setSwapBuyAmountInput: StateSetter<string>;
  setSwapBuyTokenSelection: StateSetter<TradeTokenPresetKey>;
  setSwapInputMode: StateSetter<OtcSwapInputMode>;
  setSwapSellAmountInput: StateSetter<string>;
  setSwapSellTokenSelection: StateSetter<TradeTokenPresetKey>;
  setTradeOfferAmountInput: StateSetter<string>;
  setTradePriceInput: StateSetter<string>;
  setTradePricingEditedFields: StateSetter<TradePricingField[]>;
  setTradeRequestAmountInput: StateSetter<string>;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapSellTokenSelection: TradeTokenPresetKey;
  tradeExpiryHoursInput: string;
  tradeFeeModeSelection: TradeFeeModeSelection;
  tradeHasNoExpiry: boolean;
  tradeHidePrivateLiquidity: boolean;
  tradeOfferAmountInput: string;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestAmountInput: string;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  tradeRequiredFeeWei: bigint | null;
  walletAddress: string;
};

export default function useP2PTradeComposerModel({
  combinedBalanceByAssetKey,
  creatingTrade,
  customTradeTokenInfoByAddress,
  editingVisibleTrade,
  hasCounterParentTrade,
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
}: UseP2PTradeComposerModelArgs) {
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
          hasCounterParentTrade
            ? 'Hidden amount orders are only available for fixed-price offers.'
            : editingVisibleTrade
              ? 'Private liquidity cannot be added to a visible-order edit.'
              : '',
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        tipNativeBalanceWei: nativeBalanceWei,
        rewardTokenBalanceWei,
        privateRewardTokenBalanceWei,
        combinedBalanceByAssetKey,
        tradeRequiredFeeWei,
        counterpartyRequired: false
      }),
    [
      combinedBalanceByAssetKey,
      creatingTrade,
      customTradeTokenInfoByAddress,
      editingVisibleTrade,
      hasCounterParentTrade,
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
    ]
  );

  const updateTradeOfferAmountInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradeOfferAmountInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'baseAmount'));
  }, [setTradeOfferAmountInput, setTradePricingEditedFields]);

  const resolveSwapTokenSelection = useCallback(
    (selection: TradeTokenPresetKey): ResolvedTradeToken | null => {
      const tokenAddress = isWalletAddress(selection) ? selection : '';
      const verifiedTokenKind = tokenAddress ? getVerifiedEcosystemToken(tokenAddress)?.kind ?? 'erc20' : 'erc20';
      const tokenInfo = tokenAddress
        ? customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey(verifiedTokenKind, tokenAddress)]
        : undefined;
      return resolveSelectedTradeToken({
        selection,
        customTokenInfo: tokenInfo,
        customAddress: tokenAddress,
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals
      });
    },
    [
      customTradeTokenInfoByAddress,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol
    ]
  );

  const swapSellToken = useMemo(
    () => resolveSwapTokenSelection(swapSellTokenSelection),
    [resolveSwapTokenSelection, swapSellTokenSelection]
  );
  const swapBuyToken = useMemo(
    () => resolveSwapTokenSelection(swapBuyTokenSelection),
    [resolveSwapTokenSelection, swapBuyTokenSelection]
  );
  const swapSellTokenKey = swapSellToken ? getOtcSwapAssetKey(swapSellToken) : '';
  const swapBuyTokenKey = swapBuyToken ? getOtcSwapAssetKey(swapBuyToken) : '';
  const swapTokenOptions = useMemo(
    () => tradeComposerModel.tradeTokenOptions.filter((option) => !option.value.startsWith('custom')),
    [tradeComposerModel.tradeTokenOptions]
  );

  const ensureDistinctSwapTokenSelection = useCallback(
    (changedSide: 'sell' | 'buy', nextValue: TradeTokenPresetKey) => {
      const otherValue = changedSide === 'sell' ? swapBuyTokenSelection : swapSellTokenSelection;
      const nextOtherValue =
        otherValue === nextValue
          ? (swapTokenOptions.find((option) => option.value !== nextValue)?.value as TradeTokenPresetKey | undefined)
          : otherValue;
      if (changedSide === 'sell') {
        setSwapSellTokenSelection(nextValue);
        if (nextOtherValue && nextOtherValue !== swapBuyTokenSelection) {
          setSwapBuyTokenSelection(nextOtherValue);
        }
      } else {
        setSwapBuyTokenSelection(nextValue);
        if (nextOtherValue && nextOtherValue !== swapSellTokenSelection) {
          setSwapSellTokenSelection(nextOtherValue);
        }
      }
    },
    [
      setSwapBuyTokenSelection,
      setSwapSellTokenSelection,
      swapBuyTokenSelection,
      swapSellTokenSelection,
      swapTokenOptions
    ]
  );

  const updateSwapSellAmountInput = useCallback((value: string) => {
    setSwapInputMode('sell');
    setSwapSellAmountInput(sanitizeTokenAmountInput(value));
  }, [setSwapInputMode, setSwapSellAmountInput]);
  const updateSwapBuyAmountInput = useCallback((value: string) => {
    setSwapInputMode('buy');
    setSwapBuyAmountInput(sanitizeTokenAmountInput(value));
  }, [setSwapBuyAmountInput, setSwapInputMode]);
  const updateTradeRequestAmountInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradeRequestAmountInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'quoteAmount'));
  }, [setTradePricingEditedFields, setTradeRequestAmountInput]);

  const updateTradePriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    setTradePriceInput(sanitized);
    setTradePricingEditedFields((previous) => nextTradePricingEditedFields(previous, 'price'));
  }, [setTradePriceInput, setTradePricingEditedFields]);

  const updateTradeReversePriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    if (!sanitized.trim()) {
      updateTradePriceInput('');
      return;
    }
    updateTradePriceInput(invertPriceInput(sanitized) || '');
  }, [updateTradePriceInput]);

  const updateRecurringBuyPriceInput = useCallback((value: string) => {
    setRecurringBuyPriceInput(sanitizeTokenAmountInput(value));
  }, [setRecurringBuyPriceInput]);

  const updateRecurringSellPriceInput = useCallback((value: string) => {
    setRecurringSellPriceInput(sanitizeTokenAmountInput(value));
  }, [setRecurringSellPriceInput]);

  const updateRecurringBuyReversePriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    if (!sanitized.trim()) {
      updateRecurringBuyPriceInput('');
      return;
    }
    updateRecurringBuyPriceInput(invertPriceInput(sanitized) || '');
  }, [updateRecurringBuyPriceInput]);

  const updateRecurringSellReversePriceInput = useCallback((value: string) => {
    const sanitized = sanitizeTokenAmountInput(value);
    if (!sanitized.trim()) {
      updateRecurringSellPriceInput('');
      return;
    }
    updateRecurringSellPriceInput(invertPriceInput(sanitized) || '');
  }, [updateRecurringSellPriceInput]);

  return {
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
  };
}
