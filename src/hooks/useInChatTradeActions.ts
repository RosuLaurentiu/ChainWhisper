import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  type ResolvedTradeToken,
  type PendingTradeCounterContext,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import {
  acceptCounterTradeAndCloseParentOnChain,
  acceptTradeOnChain,
  cancelTradeOnChain,
  counterTradeAndCloseCounteredTradeOnChain,
  createTradeOnChain,
  declineTradeOnChain
} from '../lib/tradeActions';
import {
  buildTradeOfferMessagePayload,
  buildTradeResponseMessagePayload,
  buildTradeSnapshotKey,
  formatTokenAmount,
  hasInsufficientFundsError,
  isWalletAddress,
  mergeOnboardInfo,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type ChatMessage,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseInChatTradeActionsArgs = {
  activeContact: string | null;
  activeSignerSource: string;
  creatingTrade: boolean;
  currentWalletKeyRef: MutableRefObject<string>;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  parsedTradeExpiryHours: number;
  parsedTradeOfferAmountWei: bigint | null;
  parsedTradeRequestAmountWei: bigint | null;
  processingTradeActionId: string;
  replyingToMessage: ChatMessage | null;
  resolveRequiredFeeForTradeCreate: () => Promise<bigint>;
  resolveTradeSnapshotForOffer: (offerMessage: TradeOfferMessagePayload) => Promise<TradeSnapshot>;
  selectedTradeOfferToken: ResolvedTradeToken | null;
  selectedTradeRequestToken: ResolvedTradeToken | null;
  sendMessage: (overrideMessageText?: string, overrideReplyTarget?: ChatMessage | null) => Promise<void>;
  sendingRef: MutableRefObject<boolean>;
  setCreatingTrade: (next: boolean) => void;
  setError: (next: string) => void;
  setProcessingTradeActionId: (next: string) => void;
  setReplyingToMessage: (next: ChatMessage | null) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTipComposerOpen: (next: boolean) => void;
  setTopUpMetricsNonce: (next: (previous: number) => number) => void;
  setTradeComposerOpen: (next: boolean) => void;
  setTradeCounterContext: (next: PendingTradeCounterContext | null) => void;
  setTradeCounterParentId: (next: number | null) => void;
  setTradeExpiryHoursInput: (next: string) => void;
  setTradeHidePrivateLiquidity: (next: boolean) => void;
  setTradeOfferAmountInput: (next: string) => void;
  setTradeOfferCustomTokenAddress: (next: string) => void;
  setTradeOfferTokenSelection: (next: TradeTokenPresetKey) => void;
  setTradeRequestAmountInput: (next: string) => void;
  setTradeRequestCustomTokenAddress: (next: string) => void;
  setTradeRequestTokenSelection: (next: TradeTokenPresetKey) => void;
  setTradeSnapshotsById: Dispatch<SetStateAction<Record<string, TradeSnapshot>>>;
  tipping: boolean;
  topUpBurnerWithWallet: () => Promise<void>;
  tradeComposerValidationMessage: string;
  tradeCounterContext: PendingTradeCounterContext | null;
  tradeCounterParentId: number | null;
  walletAddress: string;
};

export default function useInChatTradeActions({
  activeContact,
  activeSignerSource,
  creatingTrade,
  currentWalletKeyRef,
  getMemoSigner,
  parsedTradeExpiryHours,
  parsedTradeOfferAmountWei,
  parsedTradeRequestAmountWei,
  processingTradeActionId,
  replyingToMessage,
  resolveRequiredFeeForTradeCreate,
  resolveTradeSnapshotForOffer,
  selectedTradeOfferToken,
  selectedTradeRequestToken,
  sendMessage,
  sendingRef,
  setCreatingTrade,
  setError,
  setProcessingTradeActionId,
  setReplyingToMessage,
  setSessionOnboardInfo,
  setTipComposerOpen,
  setTopUpMetricsNonce,
  setTradeComposerOpen,
  setTradeCounterContext,
  setTradeCounterParentId,
  setTradeExpiryHoursInput,
  setTradeHidePrivateLiquidity,
  setTradeOfferAmountInput,
  setTradeOfferCustomTokenAddress,
  setTradeOfferTokenSelection,
  setTradeRequestAmountInput,
  setTradeRequestCustomTokenAddress,
  setTradeRequestTokenSelection,
  setTradeSnapshotsById,
  tipping,
  topUpBurnerWithWallet,
  tradeComposerValidationMessage,
  tradeCounterContext,
  tradeCounterParentId,
  walletAddress
}: UseInChatTradeActionsArgs) {
  const createTradeOffer = async (overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingRef.current || tipping || creatingTrade) {
      return;
    }

    if (tradeComposerValidationMessage) {
      setError(tradeComposerValidationMessage);
      return;
    }

    if (!activeContact || !selectedTradeOfferToken || !selectedTradeRequestToken) {
      setError('Select a contact and valid trade tokens first.');
      return;
    }

    if (parsedTradeOfferAmountWei === null || parsedTradeOfferAmountWei <= 0n) {
      setError(`Enter a valid ${selectedTradeOfferToken.symbol} amount to send.`);
      return;
    }

    if (parsedTradeRequestAmountWei === null || parsedTradeRequestAmountWei <= 0n) {
      setError(`Enter a valid ${selectedTradeRequestToken.symbol} amount to receive.`);
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const pendingCounterContext = tradeCounterContext;
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    try {
      setCreatingTrade(true);
      if (pendingCounterContext) {
        setProcessingTradeActionId(
          buildTradeSnapshotKey(pendingCounterContext.offer.tradeId, pendingCounterContext.offer.escrowContract)
        );
      }
      const { signer, cacheKey } = await getMemoSigner();
      const nativeFeeWei = await resolveRequiredFeeForTradeCreate();
      let counteredSnapshot: TradeSnapshot | null = null;

      if (pendingCounterContext) {
        const parentSnapshot = await resolveTradeSnapshotForOffer(pendingCounterContext.offer);
        counteredSnapshot = parentSnapshot;
        const isParentMaker = pendingCounterContext.offer.maker.toLowerCase() === requestedWalletKey;
        const isParentTaker = pendingCounterContext.offer.taker.toLowerCase() === requestedWalletKey;

        if (!isParentMaker && !isParentTaker) {
          throw new Error('You are no longer a participant in the original trade.');
        }

        const counterOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], counterOnboardInfo)
        }));
      }

      const expiresAt = Math.floor(Date.now() / 1000) + parsedTradeExpiryHours * 3600;
      const isCounterReplacement = Boolean(counteredSnapshot?.counterParentTradeId);
      const publicOfferAmount = parsedTradeOfferAmountWei;
      const createResult =
        isCounterReplacement && counteredSnapshot
          ? await counterTradeAndCloseCounteredTradeOnChain({
              signer,
              makerAddress: requestedWalletAddress,
              counteredTradeId: counteredSnapshot.tradeId,
              offerAsset: selectedTradeOfferToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: selectedTradeRequestToken,
              requestAmountWei: parsedTradeRequestAmountWei,
              expiresAt,
              nativeFeeWei
            })
          : await createTradeOnChain({
              signer,
              makerAddress: requestedWalletAddress,
              takerAddress: activeContact,
              offerAsset: selectedTradeOfferToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: selectedTradeRequestToken,
              requestAmountWei: parsedTradeRequestAmountWei,
              expiresAt,
              nativeFeeWei,
              parentTradeId: tradeCounterParentId ?? undefined
            });
      const tradeId = createResult.tradeId;
      const tradeKey = buildTradeSnapshotKey(tradeId, createResult.escrowContract);

      const createdAt = Math.floor(Date.now() / 1000);
      const tradeMessagePayload: TradeOfferMessagePayload = {
        version: 2,
        tradeId,
        escrowContract: createResult.escrowContract,
        maker: requestedWalletAddress,
        taker: activeContact,
        createdAt,
        expiresAt,
        parentTradeId: tradeCounterParentId ?? undefined
      };

      setTradeSnapshotsById((previous) => ({
        ...previous,
        ...(isCounterReplacement && counteredSnapshot
          ? {
              [buildTradeSnapshotKey(counteredSnapshot.tradeId, counteredSnapshot.escrowContract)]: {
                ...(previous[buildTradeSnapshotKey(counteredSnapshot.tradeId, counteredSnapshot.escrowContract)] ??
                  counteredSnapshot),
                status: 'declined' as const
              }
            }
          : {}),
        [tradeKey]: {
          tradeId,
          escrowContract: createResult.escrowContract,
          maker: requestedWalletAddress,
          taker: activeContact,
          offer: {
            ...selectedTradeOfferToken,
            amount: publicOfferAmount.toString()
          },
          request: {
            ...selectedTradeRequestToken,
            amount: parsedTradeRequestAmountWei.toString()
          },
          createdAt,
          expiresAt,
          status: 'open',
          parentTradeId: tradeCounterParentId ?? undefined,
          counterParentTradeId: tradeCounterParentId ?? undefined,
          fillState: {
            remainingOfferAmount: parsedTradeOfferAmountWei.toString(),
            remainingRequestAmount: parsedTradeRequestAmountWei.toString(),
            filledOfferAmount: '0',
            filledRequestAmount: '0'
          }
        }
      }));

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setTopUpMetricsNonce((previous) => previous + 1);
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHidePrivateLiquidity(false);
      setTradeCounterParentId(null);
      setTradeCounterContext(null);
      setTradeComposerOpen(false);
      await sendMessage(buildTradeOfferMessagePayload(tradeMessagePayload), overrideReplyTarget ?? replyingToMessage);
    } catch (tradeError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to create trade offer.');
      setError(message);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    } finally {
      setCreatingTrade(false);
      if (pendingCounterContext) {
        setProcessingTradeActionId('');
      }
    }
  };

  const acceptTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId || !walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    try {
      const tradeKey = buildTradeSnapshotKey(offer.tradeId, offer.escrowContract);
      setProcessingTradeActionId(tradeKey);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      if (snapshot.hiddenLiquidity) {
        throw new Error('Open the shared P2P trade link to fill private orders.');
      }
      const remainingRequestAmount = (() => {
        try {
          return BigInt(snapshot.fillState?.remainingRequestAmount ?? snapshot.request.amount);
        } catch {
          return BigInt(snapshot.request.amount);
        }
      })();
      const requestAsset = {
        ...snapshot.request,
        amount: remainingRequestAmount.toString()
      };
      const { signer, cacheKey } = await getMemoSigner();
      const { acceptedTxHash } =
        snapshot.counterParentTradeId
            ? await acceptCounterTradeAndCloseParentOnChain({
                signer,
                ownerAddress: walletAddress,
                tradeId: offer.tradeId,
                requestAsset,
                requestAmountWei: remainingRequestAmount
              })
            : await acceptTradeOnChain({
                signer,
                ownerAddress: walletAddress,
                tradeId: offer.tradeId,
                requestAsset,
                requestAmountWei: remainingRequestAmount
              });

      setTradeSnapshotsById((previous) => {
        const next = {
          ...previous,
          [tradeKey]: {
            ...(previous[tradeKey] ?? snapshot),
            status: 'accepted' as const,
            acceptedTxHash
          }
        };
        const parentSnapshot = snapshot.counterParentTradeId
          ? previous[buildTradeSnapshotKey(snapshot.counterParentTradeId, snapshot.escrowContract)]
          : undefined;
        if (snapshot.counterParentTradeId && parentSnapshot) {
          next[buildTradeSnapshotKey(snapshot.counterParentTradeId, parentSnapshot.escrowContract ?? snapshot.escrowContract)] = {
            ...parentSnapshot,
            status: 'cancelled'
          };
        }
        return next;
      });
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          escrowContract: offer.escrowContract,
          action: 'accepted',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to accept trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const declineTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId) {
      return;
    }

    try {
      const tradeKey = buildTradeSnapshotKey(offer.tradeId, offer.escrowContract);
      setProcessingTradeActionId(tradeKey);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      const { signer, cacheKey } = await getMemoSigner();
      await declineTradeOnChain({
        signer,
        tradeId: offer.tradeId,
        escrowContract: snapshot.escrowContract
      });

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: {
          ...(previous[tradeKey] ?? snapshot),
          status: 'declined'
        }
      }));
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          escrowContract: offer.escrowContract,
          action: 'declined',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to refuse trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const cancelTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId) {
      return;
    }

    try {
      const tradeKey = buildTradeSnapshotKey(offer.tradeId, offer.escrowContract);
      setProcessingTradeActionId(tradeKey);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      const { signer, cacheKey } = await getMemoSigner();
      await cancelTradeOnChain({
        signer,
        tradeId: offer.tradeId,
        escrowContract: snapshot.escrowContract
      });

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: {
          ...(previous[tradeKey] ?? snapshot),
          status: 'cancelled'
        }
      }));
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          escrowContract: offer.escrowContract,
          action: 'cancelled',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to cancel trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const prepareCounterTrade = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    const applyAssetSelection = (
      asset: TradeAssetPayload,
      onSelectionChange: (value: TradeTokenPresetKey) => void,
      onCustomAddressChange: (value: string) => void,
      onAmountInputChange: (value: string) => void
    ) => {
      if (asset.kind === 'native') {
        onSelectionChange('coti');
        onCustomAddressChange('');
      } else if (asset.kind === 'private-erc20' && asset.tokenAddress?.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
        onSelectionChange('pwisp');
        onCustomAddressChange('');
      } else if (asset.tokenAddress?.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()) {
        onSelectionChange('wisp');
        onCustomAddressChange('');
      } else {
        onSelectionChange(asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public');
        onCustomAddressChange(asset.tokenAddress ?? '');
      }

      try {
        onAmountInputChange(formatTokenAmount(BigInt(asset.amount), asset.decimals, 6));
      } catch {
        onAmountInputChange('');
      }
    };

    const snapshot = await resolveTradeSnapshotForOffer(offer);
    const counterParentId = snapshot.counterParentTradeId ?? offer.parentTradeId ?? offer.tradeId;

    applyAssetSelection(
      snapshot.request,
      setTradeOfferTokenSelection,
      setTradeOfferCustomTokenAddress,
      setTradeOfferAmountInput
    );
    applyAssetSelection(
      snapshot.offer,
      setTradeRequestTokenSelection,
      setTradeRequestCustomTokenAddress,
      setTradeRequestAmountInput
    );
    setTradeCounterParentId(counterParentId);
    setTradeCounterContext({ offer, sourceMessage });
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setTradeHidePrivateLiquidity(false);
    setReplyingToMessage(sourceMessage);
    setTipComposerOpen(false);
    setTradeComposerOpen(true);
  };

  return {
    acceptTradeOffer,
    cancelTradeOffer,
    createTradeOffer,
    declineTradeOffer,
    prepareCounterTrade
  };
}
