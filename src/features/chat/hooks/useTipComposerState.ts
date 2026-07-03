import { useMemo } from 'react';
import {
  formatTokenAmount,
  parseTokenAmountInput,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  type TipTokenSelection
} from '../../../lib/appShared';

type UseTipComposerStateArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  hasSelectedGroupTipRecipient: boolean;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  sending: boolean;
  sendingGroupMessage: boolean;
  tipAmountInput: string;
  tipNativeBalanceWei: bigint | null;
  tipping: boolean;
  tipTokenSelection: TipTokenSelection;
  isSelfChat: boolean;
};

export default function useTipComposerState({
  activeContact,
  activeGroupId,
  hasSelectedGroupTipRecipient,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  sending,
  sendingGroupMessage,
  tipAmountInput,
  tipNativeBalanceWei,
  tipping,
  tipTokenSelection,
  isSelfChat
}: UseTipComposerStateArgs) {
  const activeTipTokenSymbol =
    tipTokenSelection === 'coti'
      ? TIP_NATIVE_TOKEN_SYMBOL
      : tipTokenSelection === 'wisp'
        ? rewardTokenSymbol
        : privateRewardTokenSymbol;
  const activeTipTokenDecimals =
    tipTokenSelection === 'coti'
      ? TIP_NATIVE_TOKEN_DECIMALS
      : tipTokenSelection === 'wisp'
        ? rewardTokenDecimals
        : privateRewardTokenDecimals;
  const activeTipTokenBalanceWei =
    tipTokenSelection === 'coti'
      ? tipNativeBalanceWei
      : tipTokenSelection === 'wisp'
        ? rewardTokenBalanceWei
        : privateRewardTokenBalanceWei;
  const parsedTipAmountWei = useMemo(
    () => parseTokenAmountInput(tipAmountInput, activeTipTokenDecimals),
    [activeTipTokenDecimals, tipAmountInput]
  );
  const tipAmountWeiFromInput = parsedTipAmountWei !== null && parsedTipAmountWei > 0n ? parsedTipAmountWei : 0n;
  const tipAmountExceedsBalance =
    activeTipTokenBalanceWei !== null &&
    tipAmountWeiFromInput > 0n &&
    tipAmountWeiFromInput > activeTipTokenBalanceWei;
  const tipAmountSummaryLabel =
    tipAmountWeiFromInput > 0n
      ? `${formatTokenAmount(tipAmountWeiFromInput, activeTipTokenDecimals, 6)} ${activeTipTokenSymbol}`
      : `0 ${activeTipTokenSymbol}`;
  const tipBalanceSummaryLabel =
    activeTipTokenBalanceWei !== null
      ? `${formatTokenAmount(activeTipTokenBalanceWei, activeTipTokenDecimals, 6)} ${activeTipTokenSymbol}`
      : '--';
  const canSendTipFromComposer =
    !tipping &&
    !sending &&
    !!activeContact &&
    !isSelfChat &&
    tipAmountWeiFromInput > 0n &&
    activeTipTokenBalanceWei !== null &&
    !tipAmountExceedsBalance;
  const canSendGroupTipFromComposer =
    !tipping &&
    !sendingGroupMessage &&
    !!activeGroupId &&
    hasSelectedGroupTipRecipient &&
    tipAmountWeiFromInput > 0n &&
    activeTipTokenBalanceWei !== null &&
    !tipAmountExceedsBalance;

  return {
    activeTipTokenSymbol,
    canSendGroupTipFromComposer,
    canSendTipFromComposer,
    tipAmountExceedsBalance,
    tipAmountSummaryLabel,
    tipAmountWeiFromInput,
    tipBalanceSummaryLabel
  };
}
