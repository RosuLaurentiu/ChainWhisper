import { useCallback } from 'react';
import {
  TIP_NATIVE_TOKEN_SYMBOL,
  isWalletAddress,
  type TradeAssetPayload
} from '../../../lib/appShared';
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
  buildCombinedWalletAssetBalance,
  estimateWalletFundingPromptCount,
  formatWalletFundAmount,
  isNativeCotiFundAsset,
  resolveCotiFeeReserveFunding,
  resolveWalletFundingRequirement,
  transferWalletFundAsset,
  type WalletFundingRequirement
} from '../../../lib/walletFunds';
import type { TradeSigner } from '../components/P2PTradingPage.helpers';
import type { WalletBalanceRefreshOptions } from './useP2PTradeTokenData';

type FundingBalance = {
  balanceWei: bigint | null;
  privacyRequired: boolean;
};

type ResolveFundingBalanceForAsset = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>,
  role: 'chainwhisper' | 'owner'
) => FundingBalance;

type UseP2PTradeFundingPreflightArgs = {
  getTradeSignerForWallet: (targetWalletAddress: string, requireAes: boolean) => Promise<TradeSigner>;
  ownerWalletAddress: string;
  ownerWalletKey: string;
  refreshOwnerWalletBalances: (options?: WalletBalanceRefreshOptions) => Promise<void>;
  refreshWalletBalances: (options?: WalletBalanceRefreshOptions) => Promise<void>;
  requestTradeActionConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  resolveFundingBalanceForAsset: ResolveFundingBalanceForAsset;
  walletAddress: string;
  walletKey: string;
};

export default function useP2PTradeFundingPreflight({
  getTradeSignerForWallet,
  ownerWalletAddress,
  ownerWalletKey,
  refreshOwnerWalletBalances,
  refreshWalletBalances,
  requestTradeActionConfirmation,
  resolveFundingBalanceForAsset,
  walletAddress,
  walletKey
}: UseP2PTradeFundingPreflightArgs) {
  return useCallback(
    async ({
      actionLabel,
      confirmButtonLabel,
      confirmMessage,
      confirmTitle,
      confirmationPolicy = 'funding-only',
      requirements,
      tradeSummary = []
    }: TradeFundingPreflightInput): Promise<void> => {
      const consolidated = new Map<string, WalletFundingRequirement>();
      for (const requirement of requirements) {
        if (requirement.amountWei <= 0n) {
          continue;
        }
        const key = buildTradeComposerAssetBalanceKey(requirement.asset as ResolvedTradeToken);
        if (!key) {
          throw new Error(`Unable to prepare ${requirement.asset.symbol} funding.`);
        }
        const existing = consolidated.get(key);
        consolidated.set(key, {
          asset: requirement.asset,
          amountWei: (existing?.amountWei ?? 0n) + requirement.amountWei,
          reason: existing?.reason ?? requirement.reason
        });
      }

      const nativeFundingAsset = {
        kind: 'native' as const,
        symbol: TIP_NATIVE_TOKEN_SYMBOL,
        decimals: 18
      };
      const nativeFundingKey = buildTradeComposerAssetBalanceKey(nativeFundingAsset);
      const nativeRequirement = nativeFundingKey ? consolidated.get(nativeFundingKey) : undefined;
      const transfers: WalletFundingRequirement[] = [];
      for (const requirement of consolidated.values()) {
        const chainwhisper = resolveFundingBalanceForAsset(requirement.asset, 'chainwhisper');
        const owner = resolveFundingBalanceForAsset(requirement.asset, 'owner');
        const resolution = resolveWalletFundingRequirement({
          chainwhisperBalanceWei: chainwhisper.balanceWei,
          ownerBalanceWei: owner.balanceWei,
          ownerPrivacyRequired: requirement.asset.kind === 'private-erc20' && owner.privacyRequired,
          requiredAmountWei: requirement.amountWei
        });

        if (resolution.status === 'ready') {
          continue;
        }
        if (resolution.status === 'needs-owner-transfer') {
          transfers.push({
            ...requirement,
            amountWei: resolution.shortfallWei
          });
          continue;
        }

        if (resolution.status === 'owner-privacy-required') {
          throw new Error(`Unlock owner privacy to include owner ${requirement.asset.symbol} balance.`);
        }
        if (resolution.status === 'unknown') {
          throw new Error(`Unable to read ${requirement.asset.symbol} balance yet.`);
        }

        const combined = buildCombinedWalletAssetBalance({
          asset: requirement.asset,
          chainwhisperBalanceWei: chainwhisper.balanceWei,
          ownerBalanceWei: owner.balanceWei,
          ownerPrivacyRequired: owner.privacyRequired,
          requiredAmountWei: requirement.amountWei
        });
        throw new Error(
          `Insufficient ${requirement.asset.symbol}. ${combined.splitLabel}. Need ${formatWalletFundAmount(
            requirement.amountWei,
            requirement.asset
          )}.`
        );
      }

      const nativeChainwhisperBalance = resolveFundingBalanceForAsset(nativeFundingAsset, 'chainwhisper');
      const nativeOwnerBalance = resolveFundingBalanceForAsset(nativeFundingAsset, 'owner');
      const reserveResolution = resolveCotiFeeReserveFunding({
        chainwhisperBalanceWei: nativeChainwhisperBalance.balanceWei,
        nativeRequiredAmountWei: nativeRequirement?.amountWei ?? 0n,
        ownerBalanceWei: nativeOwnerBalance.balanceWei
      });
      if (reserveResolution.status === 'top-up') {
        const nativeTransferIndex = transfers.findIndex((transfer) => isNativeCotiFundAsset(transfer.asset));
        const nativeReason = nativeRequirement?.reason
          ? `${nativeRequirement.reason} + fee reserve`
          : 'fee reserve';
        if (nativeTransferIndex >= 0) {
          const existingTransfer = transfers[nativeTransferIndex];
          if (reserveResolution.topUpAmountWei > existingTransfer.amountWei) {
            transfers[nativeTransferIndex] = {
              ...existingTransfer,
              amountWei: reserveResolution.topUpAmountWei,
              reason: nativeReason
            };
          }
        } else {
          transfers.push({
            asset: nativeFundingAsset,
            amountWei: reserveResolution.topUpAmountWei,
            reason: nativeReason
          });
        }
      }

      if (transfers.length > 0) {
        if (!ownerWalletAddress || !ownerWalletKey || ownerWalletKey === walletKey) {
          throw new Error('Connect the owner wallet to move funds into ChainWhisper before trading.');
        }
        if (!walletAddress || !isWalletAddress(walletAddress)) {
          throw new Error('Set up a ChainWhisper account before trading.');
        }
      }

      if (
        shouldRequestTradeActionConfirmation({
          confirmationPolicy,
          fundingMoveCount: transfers.length
        })
      ) {
        const estimatedFundingPrompts = estimateWalletFundingPromptCount(transfers);
        const confirmation = buildTradeActionConfirmModel({
          actionLabel,
          confirmationPolicy,
          confirmButtonLabel,
          confirmMessage,
          confirmTitle,
          estimatedFundingPrompts,
          fundingMoves: transfers.map((transfer) => ({
            amountLabel: formatWalletFundAmount(transfer.amountWei, transfer.asset),
            assetSymbol: transfer.asset.symbol,
            fromLabel: 'Owner wallet',
            reason: transfer.reason,
            toLabel: 'ChainWhisper'
          })),
          tradeSummary,
          transferTransactionCount: transfers.length
        });
        const confirmed = await requestTradeActionConfirmation(confirmation);
        if (!confirmed) {
          throw new TradeActionConfirmationCancelledError(
            transfers.length > 0 ? 'Funding was cancelled.' : 'Trade action was cancelled.'
          );
        }
      }

      if (transfers.length === 0) {
        return;
      }

      const needsOwnerPrivacy = transfers.some((transfer) => transfer.asset.kind === 'private-erc20');
      const ownerSigner = await getTradeSignerForWallet(ownerWalletAddress, needsOwnerPrivacy);
      for (const transfer of transfers) {
        await transferWalletFundAsset({
          amountWei: transfer.amountWei,
          asset: transfer.asset,
          signer: ownerSigner,
          toAddress: walletAddress
        });
      }

      await Promise.all([
        refreshWalletBalances({ reason: 'trade-action' }),
        refreshOwnerWalletBalances({ reason: 'trade-action', signer: ownerSigner }).catch(() => {})
      ]);
    },
    [
      getTradeSignerForWallet,
      ownerWalletAddress,
      ownerWalletKey,
      refreshOwnerWalletBalances,
      refreshWalletBalances,
      requestTradeActionConfirmation,
      resolveFundingBalanceForAsset,
      walletAddress,
      walletKey
    ]
  );
}
