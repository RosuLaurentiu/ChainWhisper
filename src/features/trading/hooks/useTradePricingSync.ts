import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { TradeComposerModel } from '../../../lib/tradeComposer';
import {
  deriveTradePricingUpdate,
  type TradePricingField
} from '../../../lib/tradePricing';
import { pricingFieldsEqual } from '../components/P2PTradingPage.helpers';

type UseTradePricingSyncArgs = {
  setTradeOfferAmountInput: Dispatch<SetStateAction<string>>;
  setTradePriceInput: Dispatch<SetStateAction<string>>;
  setTradePricingEditedFields: Dispatch<SetStateAction<TradePricingField[]>>;
  setTradeRequestAmountInput: Dispatch<SetStateAction<string>>;
  tradeComposerModel: Pick<TradeComposerModel, 'selectedTradeOfferToken' | 'selectedTradeRequestToken'>;
  tradeOfferAmountInput: string;
  tradePriceInput: string;
  tradePricingEditedFields: TradePricingField[];
  tradeRequestAmountInput: string;
};

export default function useTradePricingSync({
  setTradeOfferAmountInput,
  setTradePriceInput,
  setTradePricingEditedFields,
  setTradeRequestAmountInput,
  tradeComposerModel,
  tradeOfferAmountInput,
  tradePriceInput,
  tradePricingEditedFields,
  tradeRequestAmountInput
}: UseTradePricingSyncArgs) {
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
    setTradeOfferAmountInput,
    setTradePriceInput,
    setTradePricingEditedFields,
    setTradeRequestAmountInput,
    tradeComposerModel.selectedTradeOfferToken,
    tradeComposerModel.selectedTradeRequestToken,
    tradeOfferAmountInput,
    tradePriceInput,
    tradePricingEditedFields,
    tradeRequestAmountInput
  ]);
}
