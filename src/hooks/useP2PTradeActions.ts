import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  buildTradeSnapshotKey,
  formatTokenAmount,
  loadCotiEthersModule,
  parseTokenAmountInput,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../lib/appShared';
import { getOnChainFailureMessage } from '../lib/appHelpers';
import {
  acceptCounterTradeAndCloseParentOnChain,
  acceptTradeOnChain,
  cancelTradeOnChain,
  declineTradeOnChain,
  fillPrivateFixedPriceTradeOnChain,
  fillTradeOnChain
} from '../lib/tradeActions';
import { ZERO_TRADE_TAKER_ADDRESS } from '../lib/tradePerspective';

type TradeSigner = JsonRpcSigner | Wallet;

const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const isPrivateTradeAsset = (asset?: Pick<TradeAssetPayload, 'kind'> | null): boolean => asset?.kind === 'private-erc20';
const isAccessHash = (value?: string): value is string => /^0x[a-fA-F0-9]{64}$/.test(value ?? '');

const assertAccessSecretMatchesSnapshot = async (snapshot: TradeSnapshot, accessSecret: string): Promise<void> => {
  if (!snapshot.hasAccessHash) {
    return;
  }
  if (!accessSecret) {
    throw new Error('This trade needs its full private link before it can be filled.');
  }
  if (!isAccessHash(snapshot.accessHash)) {
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  if (cotiEthers.keccak256(accessSecret).toLowerCase() !== snapshot.accessHash.toLowerCase()) {
    throw new Error('This private link does not match this offer. Open the full Share link from the maker and try again.');
  }
};

const getRemainingRequestAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (trade.hiddenLiquidity) {
      return BigInt(trade.request.amount);
    }
    return BigInt(trade.fillState?.remainingRequestAmount ?? trade.request.amount);
  } catch {
    return 0n;
  }
};

const getRemainingOfferAmount = (trade: TradeSnapshot): bigint => {
  try {
    if (trade.hiddenLiquidity) {
      return BigInt(trade.offer.amount);
    }
    return BigInt(trade.fillState?.remainingOfferAmount ?? trade.offer.amount);
  } catch {
    return 0n;
  }
};

const withTradeAssetAmount = (asset: TradeAssetPayload, amount: bigint): TradeAssetPayload => ({
  ...asset,
  amount: amount.toString()
});

type UseP2PTradeActionsArgs = {
  connectedWithBurner: boolean;
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  refreshTradeDataInBackground: (tradeId?: number, escrowContract?: string) => void;
  refreshTradeDetail: (tradeId: number, escrowContract?: string) => Promise<TradeSnapshot | null>;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  resolvedRouteAccessSecret: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  walletAddress: string;
};

type UseP2PTradeActionsResult = {
  acceptTrade: (snapshot: TradeSnapshot) => Promise<void>;
  cancelTrade: (snapshot: TradeSnapshot) => Promise<void>;
  declineTrade: (snapshot: TradeSnapshot) => Promise<void>;
  partialFillTrade: (snapshot: TradeSnapshot, amountInput: string) => Promise<void>;
  processingTradeActionId: string;
};

export default function useP2PTradeActions({
  connectedWithBurner,
  getTradeSigner,
  mergeTradeSnapshot,
  refreshTradeDataInBackground,
  refreshTradeDetail,
  resolveKnownTradeAccessSecret,
  resolvedRouteAccessSecret,
  routeEscrowContract,
  routeTradeId,
  setTradeActionError,
  walletAddress
}: UseP2PTradeActionsArgs): UseP2PTradeActionsResult {
  const [processingTradeActionId, setProcessingTradeActionId] = useState('');

  const resolveAccessSecretForSnapshot = useCallback(
    (snapshot: TradeSnapshot): string =>
      routeTradeId === snapshot.tradeId &&
      buildTradeSnapshotKey(routeTradeId, routeEscrowContract) === getSnapshotKey(snapshot) &&
      resolvedRouteAccessSecret
        ? resolvedRouteAccessSecret
        : resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract),
    [resolveKnownTradeAccessSecret, resolvedRouteAccessSecret, routeEscrowContract, routeTradeId]
  );

  const acceptTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }

      if (connectedWithBurner) {
        const confirmed = window.confirm('Accept this trade using your app wallet? This will submit an on-chain transaction.');
        if (!confirmed) {
          return;
        }
      }

      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const latestSnapshot = (await refreshTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        const signer = await getTradeSigner(isPrivateTradeAsset(latestSnapshot.request));
        const accessSecret = resolveAccessSecretForSnapshot(snapshot);
        await assertAccessSecretMatchesSnapshot(latestSnapshot, accessSecret);
        const remainingRequestAmount = getRemainingRequestAmount(latestSnapshot);
        if (remainingRequestAmount <= 0n) {
          throw new Error('This trade has no remaining amount to accept.');
        }
        const acceptRequestAsset = withTradeAssetAmount(latestSnapshot.request, remainingRequestAmount);
        const hiddenFillResult = latestSnapshot.hiddenLiquidity
          ? await fillPrivateFixedPriceTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: acceptRequestAsset,
              requestAmountWei: remainingRequestAmount,
              escrowContract: latestSnapshot.escrowContract,
              accessSecret: accessSecret || undefined
            })
          : null;
        const { acceptedTxHash } =
          hiddenFillResult !== null
            ? { acceptedTxHash: hiddenFillResult.filledTxHash }
            : latestSnapshot.counterParentTradeId
              ? await acceptCounterTradeAndCloseParentOnChain({
                  signer,
                  ownerAddress: walletAddress,
                  tradeId: snapshot.tradeId,
                  requestAsset: acceptRequestAsset,
                  requestAmountWei: remainingRequestAmount,
                  accessSecret: accessSecret || undefined
                })
              : await acceptTradeOnChain({
                  signer,
                  ownerAddress: walletAddress,
                  tradeId: snapshot.tradeId,
                  requestAsset: acceptRequestAsset,
                  requestAmountWei: remainingRequestAmount,
                  accessSecret: accessSecret || undefined
                });
        const nextSnapshot: TradeSnapshot = {
          ...latestSnapshot,
          taker:
            (!latestSnapshot.hiddenLiquidity || hiddenFillResult?.fullyFilled) &&
            latestSnapshot.taker.toLowerCase() === ZERO_TRADE_TAKER_ADDRESS.toLowerCase()
              ? walletAddress
              : latestSnapshot.taker,
          status: latestSnapshot.hiddenLiquidity
            ? hiddenFillResult?.fullyFilled
              ? 'accepted'
              : 'open'
            : 'accepted',
          fillState: latestSnapshot.hiddenLiquidity
            ? latestSnapshot.fillState
            : {
                remainingOfferAmount: '0',
                remainingRequestAmount: '0',
                filledOfferAmount: latestSnapshot.offer.amount,
                filledRequestAmount: latestSnapshot.request.amount
              },
          acceptedTxHash
        };
        mergeTradeSnapshot(nextSnapshot);
        if (latestSnapshot.counterParentTradeId) {
          refreshTradeDataInBackground(latestSnapshot.counterParentTradeId);
        }
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to accept trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [
      connectedWithBurner,
      getTradeSigner,
      mergeTradeSnapshot,
      refreshTradeDataInBackground,
      refreshTradeDetail,
      resolveAccessSecretForSnapshot,
      setTradeActionError,
      walletAddress
    ]
  );

  const partialFillTrade = useCallback(
    async (snapshot: TradeSnapshot, amountInput: string) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }
      if (snapshot.counterParentTradeId) {
        setTradeActionError('Counter offers must be accepted in full so the original trade can close atomically.');
        return;
      }

      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const latestSnapshot = (await refreshTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        if (latestSnapshot.counterParentTradeId) {
          throw new Error('Counter offers must be accepted in full so the original trade can close atomically.');
        }

        let requestedAmount: bigint;
        let remainingRequestAmount = 0n;
        if (latestSnapshot.hiddenLiquidity) {
          const parsedRequestAmount = parseTokenAmountInput(amountInput, latestSnapshot.request.decimals);
          if (parsedRequestAmount === null || parsedRequestAmount <= 0n) {
            throw new Error(`Enter a valid ${latestSnapshot.request.symbol} amount to pay.`);
          }
          requestedAmount = parsedRequestAmount;
          if (requestedAmount <= 0n) {
            throw new Error('This trade price cannot be filled.');
          }
        } else {
          const parsedRequestAmount = parseTokenAmountInput(amountInput, latestSnapshot.request.decimals);
          if (parsedRequestAmount === null || parsedRequestAmount <= 0n) {
            throw new Error(`Enter a valid ${latestSnapshot.request.symbol} amount to fill.`);
          }
          requestedAmount = parsedRequestAmount;
          remainingRequestAmount = getRemainingRequestAmount(latestSnapshot);
          if (requestedAmount > remainingRequestAmount) {
            throw new Error(
              `Only ${formatTokenAmount(remainingRequestAmount, latestSnapshot.request.decimals, 6)} ${latestSnapshot.request.symbol} remains.`
            );
          }
        }

        const accessSecret = resolveAccessSecretForSnapshot(snapshot);
        await assertAccessSecretMatchesSnapshot(latestSnapshot, accessSecret);

        const signer = await getTradeSigner(isPrivateTradeAsset(latestSnapshot.request));
        const fillResult = latestSnapshot.hiddenLiquidity
          ? await fillPrivateFixedPriceTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: withTradeAssetAmount(latestSnapshot.request, requestedAmount),
              requestAmountWei: requestedAmount,
              escrowContract: latestSnapshot.escrowContract,
              accessSecret: accessSecret || undefined
            })
          : await fillTradeOnChain({
              signer,
              ownerAddress: walletAddress,
              tradeId: snapshot.tradeId,
              requestAsset: withTradeAssetAmount(latestSnapshot.request, requestedAmount),
              requestAmountWei: requestedAmount,
              accessSecret: accessSecret || undefined
            });
        if (latestSnapshot.hiddenLiquidity) {
          mergeTradeSnapshot({
            ...latestSnapshot,
            taker:
              'fullyFilled' in fillResult &&
              fillResult.fullyFilled &&
              latestSnapshot.taker.toLowerCase() === ZERO_TRADE_TAKER_ADDRESS.toLowerCase()
                ? walletAddress
                : latestSnapshot.taker,
            status: 'fullyFilled' in fillResult && fillResult.fullyFilled ? 'accepted' : latestSnapshot.status,
            acceptedTxHash: fillResult.filledTxHash
          });
        } else {
          const remainingAfterFill =
            requestedAmount >= remainingRequestAmount ? 0n : remainingRequestAmount - requestedAmount;
          const remainingOfferBeforeFill = getRemainingOfferAmount(latestSnapshot);
          const offerAmountOut =
            remainingAfterFill === 0n
              ? remainingOfferBeforeFill
              : (requestedAmount * remainingOfferBeforeFill) / remainingRequestAmount;
          const remainingOfferAfterFill =
            offerAmountOut >= remainingOfferBeforeFill ? 0n : remainingOfferBeforeFill - offerAmountOut;
          mergeTradeSnapshot({
            ...latestSnapshot,
            status: remainingAfterFill === 0n ? 'accepted' : latestSnapshot.status,
            fillState: {
              remainingOfferAmount: remainingOfferAfterFill.toString(),
              remainingRequestAmount: remainingAfterFill.toString(),
              filledOfferAmount: (BigInt(latestSnapshot.fillState?.filledOfferAmount ?? '0') + offerAmountOut).toString(),
              filledRequestAmount: (BigInt(latestSnapshot.fillState?.filledRequestAmount ?? '0') + requestedAmount).toString()
            }
          });
        }
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fill trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [
      getTradeSigner,
      mergeTradeSnapshot,
      refreshTradeDataInBackground,
      refreshTradeDetail,
      resolveAccessSecretForSnapshot,
      setTradeActionError,
      walletAddress
    ]
  );

  const cancelTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const signer = await getTradeSigner(false);
        await cancelTradeOnChain({ signer, tradeId: snapshot.tradeId, escrowContract: snapshot.escrowContract });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'cancelled' };
        mergeTradeSnapshot(nextSnapshot);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, mergeTradeSnapshot, refreshTradeDataInBackground, setTradeActionError]
  );

  const declineTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(getSnapshotKey(snapshot));
        const signer = await getTradeSigner(false);
        await declineTradeOnChain({ signer, tradeId: snapshot.tradeId, escrowContract: snapshot.escrowContract });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'declined' };
        mergeTradeSnapshot(nextSnapshot);
        refreshTradeDataInBackground(snapshot.tradeId, snapshot.escrowContract);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refuse trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, mergeTradeSnapshot, refreshTradeDataInBackground, setTradeActionError]
  );

  return {
    acceptTrade,
    cancelTrade,
    declineTrade,
    partialFillTrade,
    processingTradeActionId
  };
}
