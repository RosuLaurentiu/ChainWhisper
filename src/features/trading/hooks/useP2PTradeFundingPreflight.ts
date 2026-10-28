import { useCallback } from 'react';
import { type TradeAssetPayload } from '../../../lib/appShared';
import { type ResolvedTradeToken } from '../../../lib/appHelpers';
import { buildTradeComposerAssetBalanceKey } from '../../../lib/tradeComposer';
import {
  buildTradeActionConfirmModel,
  shouldRequestTradeActionConfirmation,
  TradeActionConfirmationCancelledError,
  type TradeActionConfirmModel,
  type TradeFundingPreflightInput
} from '../../../lib/tradeActionConfirm';
import {
  formatWalletFundAmount,
  type WalletFundingRequirement
} from '../../../lib/walletFunds';

type FundingBalance = {
  balanceWei: bigint | null;
  privacyRequired: boolean;
};

type ResolveFundingBalanceForAsset = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>
) => FundingBalance;

type UseP2PTradeFundingPreflightArgs = {
  requestTradeActionConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  resolveFundingBalanceForAsset: ResolveFundingBalanceForAsset;
};

export default function useP2PTradeFundingPreflight({
  requestTradeActionConfirmation,
  resolveFundingBalanceForAsset
}: UseP2PTradeFundingPreflightArgs) {
  return useCallback(
    async ({
      actionLabel,
      confirmButtonLabel,
      confirmMessage,
      confirmationStats,
      confirmTitle,
      confirmationPolicy = 'funding-only',
      requirements,
      tradeSummary = []
    }: TradeFundingPreflightInput): Promise<void> => {
      const consolidated = new Map<string, WalletFundingRequirement>();
      for (const requirement of requirements) {
        if (requirement.amountWei <= 0n) continue;
        const key = buildTradeComposerAssetBalanceKey(requirement.asset as ResolvedTradeToken);
        if (!key) throw new Error(`Unable to prepare ${requirement.asset.symbol} funding.`);
        const existing = consolidated.get(key);
        consolidated.set(key, {
          asset: requirement.asset,
          amountWei: (existing?.amountWei ?? 0n) + requirement.amountWei,
          reason: existing?.reason ?? requirement.reason
        });
      }

      for (const requirement of consolidated.values()) {
        const wallet = resolveFundingBalanceForAsset(requirement.asset);
        if (wallet.privacyRequired) {
          throw new Error(`Unlock wallet privacy to read the ${requirement.asset.symbol} balance.`);
        }
        if (wallet.balanceWei === null) {
          throw new Error(`Unable to read ${requirement.asset.symbol} balance yet.`);
        }
        if (wallet.balanceWei < requirement.amountWei) {
          throw new Error(
            `Insufficient ${requirement.asset.symbol} in the connected wallet. Available ${formatWalletFundAmount(
              wallet.balanceWei,
              requirement.asset
            )}; need ${formatWalletFundAmount(requirement.amountWei, requirement.asset)}.`
          );
        }
      }

      if (!shouldRequestTradeActionConfirmation({ confirmationPolicy, fundingMoveCount: 0 })) return;
      const confirmed = await requestTradeActionConfirmation(
        buildTradeActionConfirmModel({
          actionLabel,
          confirmationPolicy,
          confirmButtonLabel,
          confirmMessage,
          confirmationStats,
          confirmTitle,
          estimatedFundingPrompts: 0,
          fundingMoves: [],
          tradeSummary,
          transferTransactionCount: 0
        })
      );
      if (!confirmed) throw new TradeActionConfirmationCancelledError('Trade action was cancelled.');
    },
    [requestTradeActionConfirmation, resolveFundingBalanceForAsset]
  );
}
