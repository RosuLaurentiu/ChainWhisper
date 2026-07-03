import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { sanitizeTokenAmountInput } from '../../../lib/appShared';
import {
  deriveRecurringLiquidityInputFromReceive,
  deriveRecurringReceiveAmountInput
} from '../../../lib/tradePricing';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type UseP2PRecurringReceiveInputsArgs = {
  hasRecurringPair: boolean;
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBaseDecimals: number;
  recurringBuyPriceInput: string;
  recurringBuyReceiveEditable: boolean;
  recurringBuyReceiveInput: string;
  recurringQuoteDecimals: number;
  recurringSellPriceInput: string;
  recurringSellReceiveEditable: boolean;
  recurringSellReceiveInput: string;
  setRecurringAddBuyBudgetInput: StateSetter<string>;
  setRecurringAddSellInventoryInput: StateSetter<string>;
  setRecurringBuyReceiveEditable: StateSetter<boolean>;
  setRecurringBuyReceiveInput: StateSetter<string>;
  setRecurringSellReceiveEditable: StateSetter<boolean>;
  setRecurringSellReceiveInput: StateSetter<string>;
};

export default function useP2PRecurringReceiveInputs({
  hasRecurringPair,
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
}: UseP2PRecurringReceiveInputsArgs) {
  const recurringBuyReceivePreview = useMemo(
    () =>
      hasRecurringPair
        ? deriveRecurringReceiveAmountInput({
            side: 'buy',
            liquidityInput: recurringAddBuyBudgetInput,
            priceInput: recurringBuyPriceInput,
            baseDecimals: recurringBaseDecimals,
            quoteDecimals: recurringQuoteDecimals
          })
        : '',
    [
      hasRecurringPair,
      recurringAddBuyBudgetInput,
      recurringBaseDecimals,
      recurringBuyPriceInput,
      recurringQuoteDecimals
    ]
  );
  const recurringSellReceivePreview = useMemo(
    () =>
      hasRecurringPair
        ? deriveRecurringReceiveAmountInput({
            side: 'sell',
            liquidityInput: recurringAddSellInventoryInput,
            priceInput: recurringSellPriceInput,
            baseDecimals: recurringBaseDecimals,
            quoteDecimals: recurringQuoteDecimals
          })
        : '',
    [
      hasRecurringPair,
      recurringAddSellInventoryInput,
      recurringBaseDecimals,
      recurringQuoteDecimals,
      recurringSellPriceInput
    ]
  );
  const updateRecurringBuyLiquidityInput = useCallback((value: string) => {
    setRecurringBuyReceiveEditable(false);
    setRecurringBuyReceiveInput('');
    setRecurringAddBuyBudgetInput(sanitizeTokenAmountInput(value));
  }, [setRecurringAddBuyBudgetInput, setRecurringBuyReceiveEditable, setRecurringBuyReceiveInput]);
  const updateRecurringSellLiquidityInput = useCallback((value: string) => {
    setRecurringSellReceiveEditable(false);
    setRecurringSellReceiveInput('');
    setRecurringAddSellInventoryInput(sanitizeTokenAmountInput(value));
  }, [setRecurringAddSellInventoryInput, setRecurringSellReceiveEditable, setRecurringSellReceiveInput]);
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
    [
      recurringBaseDecimals,
      recurringBuyPriceInput,
      recurringQuoteDecimals,
      setRecurringAddBuyBudgetInput,
      setRecurringBuyReceiveInput
    ]
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
    [
      recurringBaseDecimals,
      recurringQuoteDecimals,
      recurringSellPriceInput,
      setRecurringAddSellInventoryInput,
      setRecurringSellReceiveInput
    ]
  );
  const toggleRecurringBuyReceiveEditable = useCallback(() => {
    if (recurringBuyReceiveEditable) {
      setRecurringBuyReceiveEditable(false);
      setRecurringBuyReceiveInput('');
      return;
    }
    setRecurringBuyReceiveInput(recurringBuyReceivePreview);
    setRecurringBuyReceiveEditable(true);
  }, [
    recurringBuyReceiveEditable,
    recurringBuyReceivePreview,
    setRecurringBuyReceiveEditable,
    setRecurringBuyReceiveInput
  ]);
  const toggleRecurringSellReceiveEditable = useCallback(() => {
    if (recurringSellReceiveEditable) {
      setRecurringSellReceiveEditable(false);
      setRecurringSellReceiveInput('');
      return;
    }
    setRecurringSellReceiveInput(recurringSellReceivePreview);
    setRecurringSellReceiveEditable(true);
  }, [
    recurringSellReceiveEditable,
    recurringSellReceivePreview,
    setRecurringSellReceiveEditable,
    setRecurringSellReceiveInput
  ]);

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
    recurringQuoteDecimals,
    setRecurringAddBuyBudgetInput
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
    recurringSellReceiveInput,
    setRecurringAddSellInventoryInput
  ]);

  return {
    recurringBuyReceivePreview,
    recurringSellReceivePreview,
    toggleRecurringBuyReceiveEditable,
    toggleRecurringSellReceiveEditable,
    updateRecurringBuyLiquidityInput,
    updateRecurringBuyReceiveInput,
    updateRecurringSellLiquidityInput,
    updateRecurringSellReceiveInput
  };
}
