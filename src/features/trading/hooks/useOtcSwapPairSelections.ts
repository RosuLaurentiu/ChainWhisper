import { useCallback } from 'react';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import type { TradeComposerModel } from '../../../lib/tradeComposer';

type UseOtcSwapPairSelectionsArgs = {
  swapActionMode: OtcSwapInputMode;
  tradeTokenOptions: TradeComposerModel['tradeTokenOptions'];
};

export default function useOtcSwapPairSelections({
  swapActionMode,
  tradeTokenOptions
}: UseOtcSwapPairSelectionsArgs) {
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
      const hasVerifiedOption = tradeTokenOptions.some(
        (option) => option.value.toLowerCase() === tokenAddress && !option.value.startsWith('custom')
      );
      if (hasVerifiedOption) {
        return tokenAddress;
      }
      return asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public';
    },
    [tradeTokenOptions]
  );

  const resolveSwapTradeAssetSelection = useCallback(
    (asset: TradeAssetPayload): TradeTokenPresetKey | null => {
      const selection = resolveRecurringAssetSelection(asset);
      return selection.startsWith('custom') ? null : selection;
    },
    [resolveRecurringAssetSelection]
  );

  return useCallback(
    (
      snapshot: TradeSnapshot,
      mode: OtcSwapInputMode = swapActionMode
    ): { sellSelection: TradeTokenPresetKey; buySelection: TradeTokenPresetKey } | null => {
      const buildPair = (sellAsset: TradeAssetPayload, buyAsset: TradeAssetPayload) => {
        const sellSelection = resolveSwapTradeAssetSelection(sellAsset);
        const buySelection = resolveSwapTradeAssetSelection(buyAsset);
        if (!sellSelection || !buySelection || sellSelection === buySelection) {
          return null;
        }
        return { sellSelection, buySelection };
      };

      const recurring = snapshot.recurringOrder;
      if (!recurring) {
        return buildPair(snapshot.request, snapshot.offer);
      }

      const buyModePair = recurring.sellSideOpen
        ? buildPair(recurring.quoteAsset, recurring.baseAsset)
        : recurring.buySideOpen
          ? buildPair(recurring.baseAsset, recurring.quoteAsset)
          : null;
      const sellModePair = recurring.buySideOpen
        ? buildPair(recurring.baseAsset, recurring.quoteAsset)
        : recurring.sellSideOpen
          ? buildPair(recurring.quoteAsset, recurring.baseAsset)
          : null;
      return mode === 'buy' ? buyModePair : sellModePair;
    },
    [resolveSwapTradeAssetSelection, swapActionMode]
  );
}
