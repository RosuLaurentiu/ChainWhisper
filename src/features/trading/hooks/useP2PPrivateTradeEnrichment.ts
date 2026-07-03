import { useCallback } from 'react';
import {
  loadCotiEthersModule,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  fetchPrivateOrderFillReceiptsForWallet,
  fetchRecurringExecutionRowsForWallet,
  fetchRecurringPrivateFillReceiptsForWallet,
  fetchRecurringPrivateInventorySnapshotsForWallet,
  readPrivateTradeRemainingOfferWei,
  recoverTradeAccessPayloadForMaker,
  revealDirectTradeTermsForWallet,
  resolveTradeEscrowContractConfig
} from '../../../lib/appChain';
import {
  getSnapshotKey,
  hasHydratedDirectTradeTerms,
  isHiddenLiquidityTrade,
  shouldRecoverMakerTradePayload
} from '../../../lib/p2pTradeView';
import { doesAccessSecretMatchHash } from '../../../lib/tradeLinks';
import { applyTradeRecoveryPayloadToSnapshot } from '../../../lib/tradeRecoveryPayload';
import { normalizeAccessSecret } from './useP2PTradeRoute';
import type { TradeSigner } from '../components/P2PTradingPage.helpers';

type UseP2PPrivateTradeEnrichmentArgs = {
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  knownPrivateLiquidityByTrade: Record<string, string>;
  rememberPrivateTradeLiquidity: (tradeId: number, escrowContract: string | undefined, amountWei: bigint) => void;
  rememberTradeAccessSecret: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  walletAddress: string;
  walletHasAes: boolean;
  walletKey: string;
};

export default function useP2PPrivateTradeEnrichment({
  getTradeSigner,
  knownPrivateLiquidityByTrade,
  rememberPrivateTradeLiquidity,
  rememberTradeAccessSecret,
  resolveKnownTradeAccessSecret,
  walletAddress,
  walletHasAes,
  walletKey
}: UseP2PPrivateTradeEnrichmentArgs) {
  const recoverMakerTradeAccessSecret = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      const knownAccessSecret = Boolean(resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract));
      if (!shouldRecoverMakerTradePayload(snapshot, walletKey, knownAccessSecret)) {
        return snapshot;
      }
      if (!forceReveal && !walletHasAes) {
        return snapshot;
      }

      const signer = await getTradeSigner(forceReveal);
      const recoveryPayload = await recoverTradeAccessPayloadForMaker({
        tradeId: snapshot.tradeId,
        escrowContract: snapshot.escrowContract,
        signer,
        callerAddress: walletAddress
      });
      const recoveredSecret = normalizeAccessSecret(recoveryPayload.accessSecret);
      if (recoveredSecret) {
        const cotiEthers = await loadCotiEthersModule();
        if (
          !snapshot.accessHash ||
          doesAccessSecretMatchHash(recoveredSecret, snapshot.accessHash, () => cotiEthers.keccak256(recoveredSecret))
        ) {
          rememberTradeAccessSecret(snapshot.tradeId, recoveredSecret, snapshot.escrowContract);
        }
      }
      if (recoveryPayload.kind === 'private-order' && recoveryPayload.offer?.amount) {
        try {
          rememberPrivateTradeLiquidity(snapshot.tradeId, snapshot.escrowContract, BigInt(recoveryPayload.offer.amount));
        } catch {
        }
      }
      return applyTradeRecoveryPayloadToSnapshot(snapshot, recoveryPayload);
    },
    [
      getTradeSigner,
      rememberPrivateTradeLiquidity,
      rememberTradeAccessSecret,
      resolveKnownTradeAccessSecret,
      walletAddress,
      walletHasAes,
      walletKey
    ]
  );

  const enrichDirectVisibleTermsForWallet = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      if (!walletKey) {
        return snapshot;
      }
      const escrowConfig = resolveTradeEscrowContractConfig(snapshot.escrowContract);
      if (!escrowConfig.directVisible) {
        return snapshot;
      }
      if (hasHydratedDirectTradeTerms(snapshot)) {
        return snapshot;
      }

      const knownAccessSecret = resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
      const isParticipant =
        snapshot.maker.toLowerCase() === walletKey || snapshot.taker.toLowerCase() === walletKey;
      const signer = await getTradeSigner(forceReveal);
      const result = await revealDirectTradeTermsForWallet({
        snapshot,
        walletAddress,
        signer,
        accessSecret: knownAccessSecret
      });
      if (result.ok) {
        if (result.recoveredAccessSecret) {
          rememberTradeAccessSecret(snapshot.tradeId, result.recoveredAccessSecret, snapshot.escrowContract);
        }
        return result.snapshot;
      }
      if (forceReveal) {
        throw new Error(result.message);
      }
      if (!isParticipant && !knownAccessSecret) {
        return snapshot;
      }
      return snapshot;
    },
    [
      getTradeSigner,
      rememberTradeAccessSecret,
      resolveKnownTradeAccessSecret,
      walletAddress,
      walletKey
    ]
  );

  const enrichMakerPrivateProgress = useCallback(
    async (snapshot: TradeSnapshot, forceReveal = false): Promise<TradeSnapshot> => {
      if (snapshot.recurringOrder) {
        if (!walletKey) {
          return snapshot;
        }

        const recurring = snapshot.recurringOrder;
        const isMaker = snapshot.maker.toLowerCase() === walletKey;
        if (recurring.mode === 'public') {
          if (recurring.executionCount === 0) {
            return snapshot;
          }
          const existingPublicExecutions = (recurring.publicExecutions ?? []).filter(
            (execution) => isMaker || execution.filler?.toLowerCase() === walletKey
          );
          const publicExecutions = await fetchRecurringExecutionRowsForWallet({
            orderId: recurring.orderId,
            walletAddress: isMaker ? undefined : walletAddress
          }).catch(() => existingPublicExecutions);
          const resolvedPublicExecutions =
            publicExecutions.length > 0 || existingPublicExecutions.length === 0
              ? publicExecutions
              : existingPublicExecutions;
          return {
            ...snapshot,
            walletHasFill: Boolean(snapshot.walletHasFill || (!isMaker && resolvedPublicExecutions.length > 0)),
            recurringOrder: {
              ...recurring,
              publicExecutions: resolvedPublicExecutions
            }
          };
        }
        if (!forceReveal) {
          return snapshot;
        }

        const revealBaseInventory =
          recurring.baseAsset.kind === 'private-erc20' && recurring.hasPrivateBaseInventory;
        const revealQuoteInventory =
          recurring.quoteAsset.kind === 'private-erc20' && recurring.hasPrivateQuoteInventory;

        const signer = await getTradeSigner(forceReveal);
        const [privateInventorySnapshotsResult, privateExecutionsResult] = await Promise.allSettled([
          isMaker
            ? fetchRecurringPrivateInventorySnapshotsForWallet({
                orderId: recurring.orderId,
                walletAddress,
                signer
              })
            : Promise.resolve([]),
          fetchRecurringPrivateFillReceiptsForWallet({
            orderId: recurring.orderId,
            walletAddress,
            signer
          })
        ]);
        const fetchedPrivateExecutions =
          privateExecutionsResult.status === 'fulfilled'
            ? privateExecutionsResult.value
            : [];
        const existingPrivateExecutions = (recurring.privateExecutions ?? []).filter(
          (execution) => isMaker || execution.filler?.toLowerCase() === walletKey
        );
        const privateExecutions =
          fetchedPrivateExecutions.length > 0 || existingPrivateExecutions.length === 0
            ? fetchedPrivateExecutions
            : existingPrivateExecutions;
        const privateInventorySnapshots =
          privateInventorySnapshotsResult.status === 'fulfilled'
            ? privateInventorySnapshotsResult.value
            : [];
        const latestInventorySnapshot = privateInventorySnapshots[privateInventorySnapshots.length - 1];
        const latestExecutionWithRemaining = [...privateExecutions]
          .reverse()
          .find((execution) => execution.remainingBaseInventory !== undefined || execution.remainingQuoteInventory !== undefined);
        const fallbackBaseInventory =
          latestInventorySnapshot?.baseInventory ??
          latestExecutionWithRemaining?.remainingBaseInventory;
        const fallbackQuoteInventory =
          latestInventorySnapshot?.quoteInventory ??
          latestExecutionWithRemaining?.remainingQuoteInventory;
        const baseInventoryForMaker =
          recurring.baseAsset.kind === 'private-erc20'
            ? fallbackBaseInventory
            : recurring.publicBaseInventory;
        const quoteInventoryForMaker =
          recurring.quoteAsset.kind === 'private-erc20'
            ? fallbackQuoteInventory
            : recurring.publicQuoteInventory;

        if (
          privateInventorySnapshotsResult.status === 'rejected' &&
          privateExecutionsResult.status === 'rejected'
        ) {
          throw privateInventorySnapshotsResult.reason instanceof Error
            ? privateInventorySnapshotsResult.reason
            : new Error('Private recurring reveal failed. Privacy may need to be refreshed.');
        }
        const hasRevealedPrivateData =
          (isMaker && (fallbackBaseInventory !== undefined || fallbackQuoteInventory !== undefined)) ||
          privateExecutions.length > 0;
        if (!hasRevealedPrivateData) {
          const revealError =
            privateInventorySnapshotsResult.status === 'rejected'
              ? privateInventorySnapshotsResult.reason
              : privateExecutionsResult.status === 'rejected'
                ? privateExecutionsResult.reason
                : null;
          if (revealError instanceof Error) {
            throw revealError;
          }
          if (revealBaseInventory || revealQuoteInventory) {
            throw new Error(
              isMaker
                ? 'No maker reveal snapshot or private fill history was found for this recurring order. Create or edit the order on the latest recurring contract so it can publish maker-readable private liquidity snapshots.'
                : 'No private buy/sell receipts were found for this wallet on the active recurring contract.'
            );
          }
        }

        return {
          ...snapshot,
          recurringOrder: {
            ...recurring,
            ...(isMaker
              ? {
                  makerPrivateInventory: {
                    ...(baseInventoryForMaker !== undefined
                      ? { baseInventory: baseInventoryForMaker }
                      : {}),
                    ...(quoteInventoryForMaker !== undefined
                      ? { quoteInventory: quoteInventoryForMaker }
                      : {})
                  }
                }
              : {}),
            privateExecutions
          }
        };
      }
      let recoveredSnapshot = snapshot;
      const initialEscrowConfig = resolveTradeEscrowContractConfig(recoveredSnapshot.escrowContract);
      if (initialEscrowConfig.directVisible) {
        return enrichDirectVisibleTermsForWallet(recoveredSnapshot, forceReveal);
      }
      if (walletKey && snapshot.maker.toLowerCase() === walletKey && snapshot.hasAccessHash) {
        try {
          recoveredSnapshot = await recoverMakerTradeAccessSecret(snapshot, forceReveal);
        } catch {
          recoveredSnapshot = snapshot;
        }
      }
      const escrowConfig = resolveTradeEscrowContractConfig(recoveredSnapshot.escrowContract);
      if (escrowConfig.directVisible) {
        return enrichDirectVisibleTermsForWallet(recoveredSnapshot, forceReveal);
      }
      if (!isHiddenLiquidityTrade(recoveredSnapshot) || !walletKey) {
        return walletKey
          ? recoveredSnapshot
          : {
              ...recoveredSnapshot,
              makerPrivateProgress: undefined,
              privateFillReceipts: undefined,
              walletFillState: undefined,
              walletHasFill: undefined
            };
      }
      if (!forceReveal && !walletHasAes) {
        return {
          ...recoveredSnapshot,
          makerPrivateProgress: undefined,
          privateFillReceipts: undefined
        };
      }

      const isMaker = recoveredSnapshot.maker.toLowerCase() === walletKey;
      const stripOtherWalletPrivateReveal = (trade: TradeSnapshot): TradeSnapshot => ({
        ...trade,
        makerPrivateProgress: isMaker ? trade.makerPrivateProgress : undefined,
        privateFillReceipts: isMaker
          ? trade.privateFillReceipts
          : (trade.privateFillReceipts ?? []).filter((receipt) => receipt.filler?.toLowerCase() === walletKey)
      });
      if (!forceReveal && !isMaker && !recoveredSnapshot.walletHasFill) {
        return stripOtherWalletPrivateReveal(recoveredSnapshot);
      }
      const tradeKey = getSnapshotKey(recoveredSnapshot);
      const knownInitialAmount = knownPrivateLiquidityByTrade[tradeKey];
      const signer = await getTradeSigner(forceReveal);
      const [remainingOfferAmountResult, privateFillReceiptsResult] = await Promise.allSettled([
        isMaker
          ? readPrivateTradeRemainingOfferWei({
              tradeId: recoveredSnapshot.tradeId,
              escrowContract: recoveredSnapshot.escrowContract,
              makerAddress: recoveredSnapshot.maker,
              signer
            })
          : Promise.resolve(null),
        fetchPrivateOrderFillReceiptsForWallet({
          tradeId: recoveredSnapshot.tradeId,
          escrowContract: recoveredSnapshot.escrowContract,
          walletAddress,
          signer
        })
      ]);
      const fetchedPrivateFillReceipts =
        privateFillReceiptsResult.status === 'fulfilled'
          ? privateFillReceiptsResult.value
          : [];
      const existingPrivateFillReceipts = (recoveredSnapshot.privateFillReceipts ?? []).filter(
        (receipt) => isMaker || receipt.filler?.toLowerCase() === walletKey
      );
      const privateFillReceipts =
        fetchedPrivateFillReceipts.length > 0 || existingPrivateFillReceipts.length === 0
          ? fetchedPrivateFillReceipts
          : existingPrivateFillReceipts;
      const latestPrivateReceiptWithRemaining = [...privateFillReceipts]
        .reverse()
        .find((receipt) => receipt.remainingOfferAmount !== undefined);
      const remainingOfferAmount =
        remainingOfferAmountResult.status === 'fulfilled'
          ? remainingOfferAmountResult.value
          : null;
      const resolvedRemainingOfferAmount =
        isMaker
          ? remainingOfferAmount ?? (
              latestPrivateReceiptWithRemaining?.remainingOfferAmount &&
              /^\d+$/.test(latestPrivateReceiptWithRemaining.remainingOfferAmount)
                ? BigInt(latestPrivateReceiptWithRemaining.remainingOfferAmount)
                : null
            )
          : null;
      if (!isMaker) {
        if (privateFillReceiptsResult.status === 'rejected') {
          if (forceReveal) {
            throw privateFillReceiptsResult.reason instanceof Error
              ? privateFillReceiptsResult.reason
              : new Error('Private liquidity history reveal failed. Privacy may need to be refreshed.');
          }
          return stripOtherWalletPrivateReveal(snapshot);
        }
        if (privateFillReceipts.length === 0) {
          if (forceReveal) {
            throw new Error('No private fill receipts were found for this wallet.');
          }
          return stripOtherWalletPrivateReveal(recoveredSnapshot);
        }
        return {
          ...recoveredSnapshot,
          makerPrivateProgress: undefined,
          privateFillReceipts
        };
      }
      if (resolvedRemainingOfferAmount === null) {
        if (remainingOfferAmountResult.status === 'rejected' && privateFillReceiptsResult.status === 'rejected') {
          if (forceReveal) {
            throw remainingOfferAmountResult.reason instanceof Error
              ? remainingOfferAmountResult.reason
              : new Error('Private liquidity reveal failed. Privacy may need to be refreshed.');
          }
          return stripOtherWalletPrivateReveal(recoveredSnapshot);
        }
        if (forceReveal) {
          throw new Error('This private liquidity order could not expose maker liquidity or private fill receipts on the active contract.');
        }
        return stripOtherWalletPrivateReveal(recoveredSnapshot);
      }

      let filledOfferAmount: string | undefined;
      if (knownInitialAmount && /^\d+$/.test(knownInitialAmount)) {
        const initial = BigInt(knownInitialAmount);
        filledOfferAmount = initial >= resolvedRemainingOfferAmount ? (initial - resolvedRemainingOfferAmount).toString() : '0';
      } else {
        const filledFromReceipts = privateFillReceipts.reduce((total, receipt) => {
          const amount = receipt.offerAmount && /^\d+$/.test(receipt.offerAmount) ? BigInt(receipt.offerAmount) : 0n;
          return total + amount;
        }, 0n);
        if (filledFromReceipts > 0n) {
          filledOfferAmount = filledFromReceipts.toString();
        }
      }

      return {
        ...recoveredSnapshot,
        makerPrivateProgress: {
          initialOfferAmount: knownInitialAmount,
          remainingOfferAmount: resolvedRemainingOfferAmount.toString(),
          filledOfferAmount
        },
        privateFillReceipts
      };
    },
    [
      enrichDirectVisibleTermsForWallet,
      getTradeSigner,
      knownPrivateLiquidityByTrade,
      recoverMakerTradeAccessSecret,
      walletAddress,
      walletHasAes,
      walletKey
    ]
  );

  return {
    enrichDirectVisibleTermsForWallet,
    enrichMakerPrivateProgress,
    recoverMakerTradeAccessSecret
  };
}
