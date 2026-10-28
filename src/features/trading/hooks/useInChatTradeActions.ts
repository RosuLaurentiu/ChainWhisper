import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  type ResolvedTradeToken,
  type PendingTradeCounterContext,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import { getCounterOfferUnavailableReason } from '../../../lib/tradeCounterSupport';
import type { DirectTradeV2Action, DirectTradeV2PublicAsset } from '../../../lib/directTradeV2Actions';
import { resolveDirectTradeV2RuntimeReference, type DirectTradeV2Runtime } from '../../../lib/directTradeV2Runtime';
import {
  buildDirectTradeV2ActionConfirmation,
  type DirectTradeV2ApprovalKind,
  type DirectTradeV2ConfirmationAction
} from '../../../lib/directTradeV2Confirmation';
import type { TradeActionConfirmModel, TradeActionConfirmSummaryRow } from '../../../lib/tradeActionConfirm';
import {
  buildTradeSnapshotKey,
  formatTokenAmount,
  isWalletAddress,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type ChatMessage,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../../lib/appShared';

type UseInChatTradeActionsArgs = {
  activeContact: string | null;
  creatingTrade: boolean;
  currentWalletKeyRef: MutableRefObject<string>;
  directTradeV2Runtime: DirectTradeV2Runtime | null;
  parsedTradeExpiryHours: number;
  parsedTradeOfferAmountWei: bigint | null;
  parsedTradeRequestAmountWei: bigint | null;
  processingTradeActionId: string;
  requestTradeActionConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  resolveTradeSnapshotForOffer: (offerMessage: TradeOfferMessagePayload) => Promise<TradeSnapshot>;
  selectedTradeOfferToken: ResolvedTradeToken | null;
  selectedTradeRequestToken: ResolvedTradeToken | null;
  sendingRef: MutableRefObject<boolean>;
  setCreatingTrade: (next: boolean) => void;
  setError: (next: string) => void;
  setProcessingTradeActionId: (next: string) => void;
  setReplyingToMessage: (next: ChatMessage | null) => void;
  setTipComposerOpen: (next: boolean) => void;
  setWalletBalanceRefreshNonce: (next: (previous: number) => number) => void;
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
  tradeComposerValidationMessage: string;
  tradeCounterContext: PendingTradeCounterContext | null;
  tradeCounterParentId: number | null;
  walletAddress: string;
};

const toDirectTradeV2PublicAsset = (
  asset: ResolvedTradeToken | TradeAssetPayload
): DirectTradeV2PublicAsset => {
  if (asset.kind === 'native') return Object.freeze({ assetType: 'native' as const });
  if (asset.kind === 'erc20' && asset.tokenAddress) {
    return Object.freeze({ assetType: 'erc20' as const, token: asset.tokenAddress });
  }
  throw new Error('Direct Trade V2 public orders support native COTI and public ERC-20 tokens only.');
};

const isDirectTradeV2PrivatePair = (
  offer: ResolvedTradeToken | TradeAssetPayload,
  request: ResolvedTradeToken | TradeAssetPayload
): boolean => offer.kind === 'private-erc20' && request.kind === 'private-erc20';

const assertDirectTradeV2Pair = (
  offer: ResolvedTradeToken | TradeAssetPayload,
  request: ResolvedTradeToken | TradeAssetPayload
): void => {
  const bothPrivate = isDirectTradeV2PrivatePair(offer, request);
  const bothPublic = offer.kind !== 'private-erc20' && request.kind !== 'private-erc20';
  if (!bothPrivate && !bothPublic) {
    throw new Error('Direct Trade V2 does not mix public and private tokens in one direct order.');
  }
};

const directTradeApprovalKind = (
  asset: ResolvedTradeToken | TradeAssetPayload
): DirectTradeV2ApprovalKind => asset.kind === 'native' ? 'none' : asset.kind;

const formatDirectTradeConfirmAmount = (
  amount: bigint,
  asset: ResolvedTradeToken | TradeAssetPayload
): string => {
  const decimals = Math.max(0, Math.min(30, Math.floor(asset.decimals)));
  if (decimals === 0) return `${amount.toString()} ${asset.symbol}`;
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${fraction ? `${whole.toString()}.${fraction}` : whole.toString()} ${asset.symbol}`;
};

const requestDirectTradeV2Confirmation = ({
  action,
  approvalAsset,
  privateTerms,
  requestConfirmation,
  summaryRows
}: {
  action: DirectTradeV2ConfirmationAction;
  approvalAsset?: ResolvedTradeToken | TradeAssetPayload;
  privateTerms: boolean;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  summaryRows: TradeActionConfirmSummaryRow[];
}): Promise<boolean> => requestConfirmation(buildDirectTradeV2ActionConfirmation({
  action,
  approvalKind: approvalAsset ? directTradeApprovalKind(approvalAsset) : 'none',
  approvalSymbol: approvalAsset?.symbol,
  privateTerms,
  summaryRows
}));

export default function useInChatTradeActions({
  activeContact,
  creatingTrade,
  currentWalletKeyRef,
  directTradeV2Runtime,
  parsedTradeExpiryHours,
  parsedTradeOfferAmountWei,
  parsedTradeRequestAmountWei,
  processingTradeActionId,
  requestTradeActionConfirmation,
  resolveTradeSnapshotForOffer,
  selectedTradeOfferToken,
  selectedTradeRequestToken,
  sendingRef,
  setCreatingTrade,
  setError,
  setProcessingTradeActionId,
  setReplyingToMessage,
  setTipComposerOpen,
  setWalletBalanceRefreshNonce,
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
  tradeComposerValidationMessage,
  tradeCounterContext,
  tradeCounterParentId,
  walletAddress
}: UseInChatTradeActionsArgs) {
  const runtimeForOffer = async (offer: TradeOfferMessagePayload, message: ChatMessage) => {
    const identity = message.directTradeV2;
    if (!identity) throw new Error('Legacy direct offers are read-only. Create a new Direct V2 offer instead.');
    if (identity.contractAddress.toLowerCase() !== offer.escrowContract.toLowerCase() || identity.tradeId !== String(offer.tradeId)) {
      throw new Error('Direct V2 card reference does not match this offer.');
    }
    return resolveDirectTradeV2RuntimeReference(directTradeV2Runtime, {
      chainId: identity.chainId, contractAddress: identity.contractAddress, orderId: identity.tradeId
    });
  };

  const createTradeOffer = async (_overrideReplyTarget?: ChatMessage | null) => {
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

    let directV2 = directTradeV2Runtime?.isCurrent() ? directTradeV2Runtime : null;
    if (!directV2) {
      setError('Direct Trade V2 is unavailable. No legacy trade or chat transaction was sent.');
      return;
    }
    try {
      setCreatingTrade(true);
      let counteredSnapshot: TradeSnapshot | null = null;
      if (pendingCounterContext) {
        directV2 = await runtimeForOffer(pendingCounterContext.offer, pendingCounterContext.sourceMessage);
        setProcessingTradeActionId(
          buildTradeSnapshotKey(pendingCounterContext.offer.tradeId, pendingCounterContext.offer.escrowContract)
        );
        counteredSnapshot = await resolveTradeSnapshotForOffer(pendingCounterContext.offer);
        const counterUnavailableReason = getCounterOfferUnavailableReason(counteredSnapshot, requestedWalletKey);
        if (counterUnavailableReason) throw new Error(counterUnavailableReason);
      }

      assertDirectTradeV2Pair(selectedTradeOfferToken, selectedTradeRequestToken);
      const expiresAt = Math.floor(Date.now() / 1000) + parsedTradeExpiryHours * 3600;
      const isPrivate = isDirectTradeV2PrivatePair(selectedTradeOfferToken, selectedTradeRequestToken);
      const isReplacement = Boolean(counteredSnapshot?.counterParentTradeId);
      let action: DirectTradeV2Action;
      if (isPrivate) {
        if (!selectedTradeOfferToken.tokenAddress || !selectedTradeRequestToken.tokenAddress) {
          throw new Error('Direct private token addresses are unavailable.');
        }
        const privateTerms = {
          offerToken: selectedTradeOfferToken.tokenAddress,
          requestToken: selectedTradeRequestToken.tokenAddress,
          offerAmount: parsedTradeOfferAmountWei,
          requestAmount: parsedTradeRequestAmountWei,
          expiresAt
        } as const;
        action = isReplacement && counteredSnapshot
          ? { kind: 'replace-private', originalTradeId: counteredSnapshot.tradeId, ...privateTerms }
          : tradeCounterParentId
            ? { kind: 'counter-private', parentTradeId: tradeCounterParentId, ...privateTerms }
            : { kind: 'create-private', taker: activeContact, ...privateTerms };
      } else {
        const publicTerms = {
          offerAsset: toDirectTradeV2PublicAsset(selectedTradeOfferToken),
          requestAsset: toDirectTradeV2PublicAsset(selectedTradeRequestToken),
          offerAmount: parsedTradeOfferAmountWei,
          requestAmount: parsedTradeRequestAmountWei,
          expiresAt
        } as const;
        action = isReplacement && counteredSnapshot
          ? { kind: 'replace-public', originalTradeId: counteredSnapshot.tradeId, ...publicTerms }
          : tradeCounterParentId
            ? { kind: 'counter-public', parentTradeId: tradeCounterParentId, ...publicTerms }
            : { kind: 'create-public', taker: activeContact, ...publicTerms };
      }

      const confirmationAction: DirectTradeV2ConfirmationAction = action.kind.startsWith('replace')
        ? 'replace'
        : action.kind.startsWith('counter')
          ? 'counter'
          : 'create';
      const confirmed = await requestDirectTradeV2Confirmation({
        action: confirmationAction,
        approvalAsset: selectedTradeOfferToken,
        privateTerms: isPrivate,
        requestConfirmation: requestTradeActionConfirmation,
        summaryRows: [
          {
            label: 'You sell',
            value: formatDirectTradeConfirmAmount(parsedTradeOfferAmountWei, selectedTradeOfferToken)
          },
          {
            label: 'You buy',
            value: formatDirectTradeConfirmAmount(parsedTradeRequestAmountWei, selectedTradeRequestToken)
          },
          { label: 'Recipient', value: activeContact }
        ]
      });
      if (!confirmed) return;

      const result = await directV2.execute(action);
      if (!directV2.isCurrent() || currentWalletKeyRef.current !== requestedWalletKey || !result.tradeId) return;
      const tradeId = Number(BigInt(result.tradeId));
      if (!Number.isSafeInteger(tradeId) || tradeId <= 0) {
        throw new Error('Direct Trade V2 returned an unsupported trade ID.');
      }
      const tradeKey = buildTradeSnapshotKey(tradeId, directV2.contractAddress);
      const escrowContract = directV2.contractAddress;
      const createdAt = Math.floor(Date.now() / 1000);
      setTradeSnapshotsById((previous) => ({
        ...previous,
        ...(counteredSnapshot ? {
          [buildTradeSnapshotKey(counteredSnapshot.tradeId, counteredSnapshot.escrowContract)]: {
            ...(previous[buildTradeSnapshotKey(counteredSnapshot.tradeId, counteredSnapshot.escrowContract)] ?? counteredSnapshot),
            status: isReplacement ? 'replaced' as const : 'superseded' as const,
            ...(isReplacement ? { replacementTradeId: tradeId } : {})
          }
        } : {}),
        [tradeKey]: {
          tradeId,
          escrowContract,
          maker: requestedWalletAddress,
          taker: activeContact,
          offer: { ...selectedTradeOfferToken, amount: parsedTradeOfferAmountWei.toString() },
          request: { ...selectedTradeRequestToken, amount: parsedTradeRequestAmountWei.toString() },
          createdAt,
          expiresAt,
          status: 'open',
          parentTradeId: tradeCounterParentId ?? undefined,
          counterParentEscrow: tradeCounterParentId ? escrowContract : undefined,
          counterParentTradeId: tradeCounterParentId ?? undefined,
          replacesTradeId: isReplacement ? counteredSnapshot?.tradeId : undefined,
          hiddenLiquidity: isPrivate,
          fillState: {
            remainingOfferAmount: parsedTradeOfferAmountWei.toString(),
            remainingRequestAmount: parsedTradeRequestAmountWei.toString(),
            filledOfferAmount: '0',
            filledRequestAmount: '0'
          }
        }
      }));
      setWalletBalanceRefreshNonce((previous) => previous + 1);
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHidePrivateLiquidity(false);
      setTradeCounterParentId(null);
      setTradeCounterContext(null);
      setTradeComposerOpen(false);
      setReplyingToMessage(null);
      return;
    } catch (tradeError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) return;
      setError(getOnChainFailureMessage(tradeError, 'Failed to create the Direct V2 trade offer.'));
      return;
    } finally {
      setCreatingTrade(false);
      if (pendingCounterContext) setProcessingTradeActionId('');
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
      const directV2 = await runtimeForOffer(offer, sourceMessage);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
        assertDirectTradeV2Pair(snapshot.offer, snapshot.request);
        const remainingOfferAmount = BigInt(
          snapshot.fillState?.remainingOfferAmount ?? snapshot.offer.amount
        );
        const remainingRequestAmount = BigInt(
          snapshot.fillState?.remainingRequestAmount ?? snapshot.request.amount
        );
        const action: DirectTradeV2Action = isDirectTradeV2PrivatePair(snapshot.offer, snapshot.request)
          ? {
              kind: 'accept-private',
              tradeId: offer.tradeId,
              expectedRequestAmount: remainingRequestAmount,
              requestToken: snapshot.request.tokenAddress ?? ''
            }
          : {
              kind: 'accept-public',
              tradeId: offer.tradeId,
              expectedOfferAmount: remainingOfferAmount,
              expectedRequestAmount: remainingRequestAmount,
              requestAsset: toDirectTradeV2PublicAsset(snapshot.request)
            };
        const privateTerms = isDirectTradeV2PrivatePair(snapshot.offer, snapshot.request);
        const confirmed = await requestDirectTradeV2Confirmation({
          action: 'accept',
          approvalAsset: snapshot.request,
          privateTerms,
          requestConfirmation: requestTradeActionConfirmation,
          summaryRows: [
            { label: 'Offer', value: `#${offer.tradeId}` },
            {
              label: 'You pay',
              value: formatDirectTradeConfirmAmount(remainingRequestAmount, snapshot.request)
            },
            {
              label: 'You receive',
              value: formatDirectTradeConfirmAmount(remainingOfferAmount, snapshot.offer)
            }
          ]
        });
        if (!confirmed) return;
      const result = await directV2.execute(action);
      if (!directV2.isCurrent()) return;
      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: {
          ...(previous[tradeKey] ?? snapshot),
          status: 'accepted',
          acceptedTxHash: result.transactionHash
        }
      }));
      setWalletBalanceRefreshNonce((previous) => previous + 1);
    } catch (tradeError) {
      const message = getOnChainFailureMessage(tradeError, 'Failed to accept trade.');
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
      const directV2 = await runtimeForOffer(offer, sourceMessage);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
        const confirmed = await requestDirectTradeV2Confirmation({
          action: 'decline',
          privateTerms: isDirectTradeV2PrivatePair(snapshot.offer, snapshot.request),
          requestConfirmation: requestTradeActionConfirmation,
          summaryRows: [{ label: 'Offer', value: `#${offer.tradeId}` }]
        });
        if (!confirmed) return;
      await directV2.execute({ kind: 'decline', tradeId: offer.tradeId });
      if (!directV2.isCurrent()) return;
      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: { ...(previous[tradeKey] ?? snapshot), status: 'declined' }
      }));
      setWalletBalanceRefreshNonce((previous) => previous + 1);
    } catch (tradeError) {
      const message = getOnChainFailureMessage(tradeError, 'Failed to refuse trade.');
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
      const directV2 = await runtimeForOffer(offer, sourceMessage);
      const snapshot = await resolveTradeSnapshotForOffer(offer);
        const confirmed = await requestDirectTradeV2Confirmation({
          action: 'cancel',
          privateTerms: isDirectTradeV2PrivatePair(snapshot.offer, snapshot.request),
          requestConfirmation: requestTradeActionConfirmation,
          summaryRows: [{ label: 'Offer', value: `#${offer.tradeId}` }]
        });
        if (!confirmed) return;
      await directV2.execute({ kind: 'cancel', tradeId: offer.tradeId });
      if (!directV2.isCurrent()) return;
      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: { ...(previous[tradeKey] ?? snapshot), status: 'cancelled' }
      }));
      setWalletBalanceRefreshNonce((previous) => previous + 1);
    } catch (tradeError) {
      const message = getOnChainFailureMessage(tradeError, 'Failed to cancel trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const prepareCounterTrade = async (
    offer: TradeOfferMessagePayload,
    sourceMessage: ChatMessage,
    isTargetCurrent: () => boolean = () => true
  ): Promise<void> => {
    try {
      await runtimeForOffer(offer, sourceMessage);
    } catch (error) {
      setError(getOnChainFailureMessage(error, 'Direct V2 offer is unavailable.'));
      return;
    }

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
    if (!isTargetCurrent()) {
      return;
    }
    const counterUnavailableReason = getCounterOfferUnavailableReason(
      snapshot,
      currentWalletKeyRef.current.toLowerCase()
    );
    if (counterUnavailableReason) {
      setError(counterUnavailableReason);
      return;
    }
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
