import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import { invertPriceInput } from '../../../lib/tradePricing';

type UseRecurringOrderSideSwapArgs = {
  creatingRecurringOrder: boolean;
  editingRecurringOrder: unknown;
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBuyPriceInput: string;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringSellPriceInput: string;
  setRecurringAddBuyBudgetInput: Dispatch<SetStateAction<string>>;
  setRecurringAddSellInventoryInput: Dispatch<SetStateAction<string>>;
  setRecurringBuyPriceInput: Dispatch<SetStateAction<string>>;
  setRecurringBuyReceiveEditable: Dispatch<SetStateAction<boolean>>;
  setRecurringBuyReceiveInput: Dispatch<SetStateAction<string>>;
  setRecurringRemoveBuyBudgetInput: Dispatch<SetStateAction<string>>;
  setRecurringRemoveSellInventoryInput: Dispatch<SetStateAction<string>>;
  setRecurringSellPriceInput: Dispatch<SetStateAction<string>>;
  setRecurringSellReceiveEditable: Dispatch<SetStateAction<boolean>>;
  setRecurringSellReceiveInput: Dispatch<SetStateAction<string>>;
  setTradeOfferCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeOfferTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeRequestCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeRequestTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: TradeTokenPresetKey;
};

export default function useRecurringOrderSideSwap({
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
}: UseRecurringOrderSideSwapArgs) {
  return useCallback(() => {
    if (creatingRecurringOrder || editingRecurringOrder) {
      return;
    }

    const nextOfferToken = tradeRequestTokenSelection;
    const nextRequestToken = tradeOfferTokenSelection;
    const nextOfferCustomAddress = tradeRequestCustomTokenAddress;
    const nextRequestCustomAddress = tradeOfferCustomTokenAddress;
    const nextBuyPrice = invertPriceInput(recurringSellPriceInput);
    const nextSellPrice = invertPriceInput(recurringBuyPriceInput);
    const nextBuyBudget = recurringAddSellInventoryInput;
    const nextSellInventory = recurringAddBuyBudgetInput;
    const nextRemoveBuyBudget = recurringRemoveSellInventoryInput;
    const nextRemoveSellInventory = recurringRemoveBuyBudgetInput;

    setTradeOfferTokenSelection(nextOfferToken);
    setTradeRequestTokenSelection(nextRequestToken);
    setTradeOfferCustomTokenAddress(nextOfferCustomAddress);
    setTradeRequestCustomTokenAddress(nextRequestCustomAddress);
    setRecurringBuyPriceInput(nextBuyPrice);
    setRecurringSellPriceInput(nextSellPrice);
    setRecurringAddBuyBudgetInput(nextBuyBudget);
    setRecurringAddSellInventoryInput(nextSellInventory);
    setRecurringRemoveBuyBudgetInput(nextRemoveBuyBudget);
    setRecurringRemoveSellInventoryInput(nextRemoveSellInventory);
    setRecurringBuyReceiveInput('');
    setRecurringSellReceiveInput('');
    setRecurringBuyReceiveEditable(false);
    setRecurringSellReceiveEditable(false);
  }, [
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
  ]);
}
