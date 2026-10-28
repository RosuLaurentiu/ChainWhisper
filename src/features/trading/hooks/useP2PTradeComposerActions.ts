import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  formatTokenAmount,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  isVerifiedEcosystemToken,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  isTradeActionConfirmationCancelledError,
  type TradeActionConfirmSummaryRow,
  type TradeFundingPreflightInput
} from '../../../lib/tradeActionConfirm';
import type { TradeComposerModel } from '../../../lib/tradeComposer';
import { getCounterOfferUnavailableReason } from '../../../lib/tradeCounterSupport';
import type { TradeVisibility } from '../../../lib/tradeCreationAccess';
import { ZERO_TRADE_TAKER_ADDRESS } from '../../../lib/tradePerspective';
import {
  getP2PActionFailureStatus,
  type P2PActionNoticeAction,
  type P2PActionNoticeInput
} from '../../../lib/p2pActionNotice';
import type { TradeEntryMode, TradeSurfaceView } from './useP2PTradeRoute';
import { formatWalletFundAmount } from '../../../lib/walletFunds';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { isPrivateBookV2RuntimeHash } from '../../../lib/privateBookV2Actions';
import { getPrivateBookV2OwnerBudget, getPrivateBookV2Projection } from '../../../lib/privateBookV2Consumer';
import { buildPrivateBookV2ComposerAction, executePrivateBookV2Composer } from '../../../lib/privateBookV2Composer';
import { normalizePrivateBookV2Price } from '../../../lib/privateBookV2Terms';
import { captureWalletActionIntent, readWalletActionIntent } from '../../../lib/walletActionIntent';
import {
  buildOtcV2ConditionalApproval,
  buildOtcV2ConfirmationDetails
} from '../../../lib/otcV2Confirmation';

const quotePrivateRequestAmountForOffer = (
  offerAmountOut: bigint,
  offerUnitAmount: bigint,
  requestUnitAmount: bigint
): bigint => {
  if (offerAmountOut <= 0n || offerUnitAmount <= 0n || requestUnitAmount <= 0n) {
    return 0n;
  }

  return (offerAmountOut * requestUnitAmount + offerUnitAmount - 1n) / offerUnitAmount;
};

const formatTradeAmountInput = (asset: TradeAssetPayload): string => {
  try {
    return formatTokenAmount(BigInt(asset.amount), asset.decimals, 18);
  } catch {
    return '';
  }
};

const hasVisibleTradeAmount = (asset: TradeAssetPayload): boolean => {
  try {
    return BigInt(asset.amount) > 0n;
  } catch {
    return false;
  }
};

const buildAmountLabel = (
  amountWei: bigint,
  asset: Pick<TradeAssetPayload, 'decimals' | 'kind' | 'symbol' | 'tokenAddress'>
): string =>
  formatWalletFundAmount(amountWei, asset, 6);

const getVisibilitySummaryLabel = ({
  hiddenLiquidity,
  isCounterTrade,
  isEditTrade,
  tradeVisibility
}: {
  hiddenLiquidity: boolean;
  isCounterTrade: boolean;
  isEditTrade: boolean;
  tradeVisibility: TradeVisibility;
}): string => {
  if (hiddenLiquidity) {
    return 'Hidden liquidity';
  }
  if (isCounterTrade) {
    return 'Counter offer';
  }
  if (isEditTrade) {
    return 'Updated offer';
  }
  if (tradeVisibility === 'direct') {
    return 'Direct offer';
  }
  if (tradeVisibility === 'unlisted') {
    return 'Unlisted offer';
  }
  return 'Public offer';
};

const resolveTradeAssetSelection = (
  asset: TradeAssetPayload
): { selection: TradeTokenPresetKey; customAddress: string } => {
  if (asset.kind === 'native') {
    return { selection: 'coti', customAddress: '' };
  }

  const tokenAddress = asset.tokenAddress?.trim() ?? '';
  if (tokenAddress.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'wisp', customAddress: '' };
  }
  if (tokenAddress.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'pwisp', customAddress: '' };
  }

  if (isVerifiedEcosystemToken(tokenAddress)) {
    return { selection: tokenAddress.toLowerCase(), customAddress: '' };
  }

  return {
    selection: asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public',
    customAddress: tokenAddress
  };
};

type UseP2PTradeComposerActionsArgs = {
  buildCurrentTradeSurfacePath: (view: TradeSurfaceView, tradeMode?: TradeEntryMode) => string;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  canEditPublicTrade: (trade: TradeSnapshot, walletKey: string) => boolean;
  counterParentTrade: TradeSnapshot | null;
  directTradeRecipientIsValid: boolean;
  directTradeRecipientNormalized: string;
  editingTrade: TradeSnapshot | null;
  ensureTradeFunding?: (input: TradeFundingPreflightInput) => Promise<void>;
  loadWalletBalances: () => Promise<void>;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  navigateToTradePath: (path: string) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  refreshMyTrades: () => Promise<void>;
  refreshPublicTrades: () => Promise<void>;
  runTradeWalletPromptFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setCounterParentTrade: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setCreatedTradeId: Dispatch<SetStateAction<number | null>>;
  setCreatedTradeLink: Dispatch<SetStateAction<string>>;
  setCreatingTrade: Dispatch<SetStateAction<boolean>>;
  setDetailTrade: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setDirectTradeRecipient: Dispatch<SetStateAction<string>>;
  setEditingTrade: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  setTradeExpiryHoursInput: Dispatch<SetStateAction<string>>;
  setTradeHasNoExpiry: Dispatch<SetStateAction<boolean>>;
  setTradeHidePrivateLiquidity: Dispatch<SetStateAction<boolean>>;
  setTradeOfferAmountInput: Dispatch<SetStateAction<string>>;
  setTradeOfferCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeOfferTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeRequestAmountInput: Dispatch<SetStateAction<string>>;
  setTradeRequestCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeRequestTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeVisibility: Dispatch<SetStateAction<TradeVisibility>>;
  tradeComposerModel: TradeComposerModel;
  tradeHasNoExpiry: boolean;
  tradeHidePrivateLiquidity: boolean;
  tradeVisibility: TradeVisibility;
  walletAddress: string;
  walletKey: string;
  onActionNotice?: (notice: P2PActionNoticeInput) => void;
  otcV2ActionRuntime?: OtcV2ActionRuntime | null;
  refreshOneOffV2Trades?: () => void;
};

type UseP2PTradeComposerActionsResult = {
  beginCounterTrade: (snapshot: TradeSnapshot) => void;
  beginEditTrade: (snapshot: TradeSnapshot) => void;
  clearCounterTrade: () => void;
  clearEditTrade: () => void;
  createTrade: () => Promise<void>;
  startFreshTrade: () => void;
};

export default function useP2PTradeComposerActions({
  buildCurrentTradeSurfacePath,
  buildTradeShareUrl,
  canEditPublicTrade,
  counterParentTrade,
  directTradeRecipientIsValid,
  directTradeRecipientNormalized,
  editingTrade,
  ensureTradeFunding,
  loadWalletBalances,
  mergeTradeSnapshot,
  navigateToTradePath,
  openTrade,
  refreshMyTrades,
  refreshPublicTrades,
  runTradeWalletPromptFlow,
  setCounterParentTrade,
  setCreatedTradeId,
  setCreatedTradeLink,
  setCreatingTrade,
  setDetailTrade,
  setDirectTradeRecipient,
  setEditingTrade,
  setTradeActionError,
  setTradeExpiryHoursInput,
  setTradeHasNoExpiry,
  setTradeHidePrivateLiquidity,
  setTradeOfferAmountInput,
  setTradeOfferCustomTokenAddress,
  setTradeOfferTokenSelection,
  setTradeRequestAmountInput,
  setTradeRequestCustomTokenAddress,
  setTradeRequestTokenSelection,
  setTradeVisibility,
  tradeComposerModel,
  tradeHasNoExpiry,
  tradeHidePrivateLiquidity,
  tradeVisibility,
  walletAddress,
  walletKey,
  onActionNotice,
  otcV2ActionRuntime,
  refreshOneOffV2Trades
}: UseP2PTradeComposerActionsArgs): UseP2PTradeComposerActionsResult {
  const notifyComposerAction = useCallback(
    (input: Omit<P2PActionNoticeInput, 'surface'>) => {
      onActionNotice?.({ ...input, surface: 'composer' });
    },
    [onActionNotice]
  );

  const beginCounterTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!snapshot.v2) {
        setTradeActionError('Legacy OTC orders are read-only and cannot receive new counter offers.');
        return;
      }
      const counterUnavailableReason = getCounterOfferUnavailableReason(snapshot, walletAddress ? walletKey : '');
      if (counterUnavailableReason) {
        setTradeActionError(counterUnavailableReason);
        return;
      }

      const nextOfferSelection = resolveTradeAssetSelection(snapshot.request);
      const nextRequestSelection = resolveTradeAssetSelection(snapshot.offer);
      setCounterParentTrade(snapshot);
      setEditingTrade(null);
      setTradeVisibility('unlisted');
      setTradeOfferTokenSelection(nextOfferSelection.selection);
      setTradeRequestTokenSelection(nextRequestSelection.selection);
      setTradeOfferCustomTokenAddress(nextOfferSelection.customAddress);
      setTradeRequestCustomTokenAddress(nextRequestSelection.customAddress);
      const canPrefillAmounts =
        !snapshot.hiddenLiquidity &&
        hasVisibleTradeAmount(snapshot.request) &&
        hasVisibleTradeAmount(snapshot.offer);
      setTradeOfferAmountInput(canPrefillAmounts ? formatTradeAmountInput(snapshot.request) : '');
      setTradeRequestAmountInput(canPrefillAmounts ? formatTradeAmountInput(snapshot.offer) : '');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHasNoExpiry(false);
      setTradeHidePrivateLiquidity(false);
      setTradeActionError('');
      setCreatedTradeId(null);
      setCreatedTradeLink('');
      setDetailTrade(null);
      navigateToTradePath(buildCurrentTradeSurfacePath('counter'));
    },
    [
      buildCurrentTradeSurfacePath,
      navigateToTradePath,
      setCounterParentTrade,
      setCreatedTradeId,
      setCreatedTradeLink,
      setDetailTrade,
      setEditingTrade,
      setTradeActionError,
      setTradeExpiryHoursInput,
      setTradeHasNoExpiry,
      setTradeHidePrivateLiquidity,
      setTradeOfferAmountInput,
      setTradeOfferCustomTokenAddress,
      setTradeOfferTokenSelection,
      setTradeRequestAmountInput,
      setTradeRequestCustomTokenAddress,
      setTradeRequestTokenSelection,
      setTradeVisibility,
      walletAddress,
      walletKey
    ]
  );

  const clearCounterTrade = useCallback(() => {
    setCounterParentTrade(null);
    setTradeHidePrivateLiquidity(false);
    setTradeActionError('');
  }, [setCounterParentTrade, setTradeActionError, setTradeHidePrivateLiquidity]);

  const beginEditTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!snapshot.v2) {
        setTradeActionError('Legacy OTC orders are read-only and cannot be edited.');
        return;
      }
      if (!walletAddress) {
        setTradeActionError('Connect the maker wallet before editing.');
        return;
      }
      if (!canEditPublicTrade(snapshot, walletKey)) {
        setTradeActionError('Only your open, unfilled trades can be edited.');
        return;
      }

      const currentBook = getPrivateBookV2Projection(snapshot);
      const ownerBudget = currentBook ? getPrivateBookV2OwnerBudget(snapshot, walletAddress) : undefined;
      if (currentBook && !ownerBudget) {
        setTradeActionError('Unlock and refresh your private escrow budget before editing.');
        return;
      }

      const nextOfferSelection = resolveTradeAssetSelection(snapshot.offer);
      const nextRequestSelection = resolveTradeAssetSelection(snapshot.request);
      setEditingTrade(snapshot);
      setCounterParentTrade(null);
      setTradeVisibility('public');
      setTradeOfferTokenSelection(nextOfferSelection.selection);
      setTradeRequestTokenSelection(nextRequestSelection.selection);
      setTradeOfferCustomTokenAddress(nextOfferSelection.customAddress);
      setTradeRequestCustomTokenAddress(nextRequestSelection.customAddress);
      if (snapshot.hiddenLiquidity) {
        const hiddenOfferAmountRaw =
          ownerBudget?.remainingOfferAmount ?? snapshot.makerPrivateProgress?.remainingOfferAmount ?? snapshot.makerPrivateProgress?.initialOfferAmount;
        const hiddenOfferAmount =
          hiddenOfferAmountRaw && /^\d+$/.test(hiddenOfferAmountRaw) ? BigInt(hiddenOfferAmountRaw) : null;
        const hiddenRequestAmount =
          hiddenOfferAmount !== null
            ? quotePrivateRequestAmountForOffer(
                hiddenOfferAmount,
                BigInt(snapshot.offer.amount),
                BigInt(snapshot.request.amount)
              )
            : null;
        setTradeOfferAmountInput(
          hiddenOfferAmount !== null ? formatTokenAmount(hiddenOfferAmount, snapshot.offer.decimals, 18) : ''
        );
        setTradeRequestAmountInput(
          hiddenRequestAmount !== null ? formatTokenAmount(hiddenRequestAmount, snapshot.request.decimals, 18) : ''
        );
      } else {
        setTradeOfferAmountInput(formatTradeAmountInput(snapshot.offer));
        setTradeRequestAmountInput(formatTradeAmountInput(snapshot.request));
      }
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHasNoExpiry(snapshot.expiresAt <= 0);
      setTradeHidePrivateLiquidity(Boolean(snapshot.hiddenLiquidity));
      setTradeActionError('');
      navigateToTradePath(buildCurrentTradeSurfacePath('create', 'limit'));
    },
    [
      buildCurrentTradeSurfacePath,
      canEditPublicTrade,
      navigateToTradePath,
      setCounterParentTrade,
      setEditingTrade,
      setTradeActionError,
      setTradeExpiryHoursInput,
      setTradeHasNoExpiry,
      setTradeHidePrivateLiquidity,
      setTradeOfferAmountInput,
      setTradeOfferCustomTokenAddress,
      setTradeOfferTokenSelection,
      setTradeRequestAmountInput,
      setTradeRequestCustomTokenAddress,
      setTradeRequestTokenSelection,
      setTradeVisibility,
      walletAddress,
      walletKey
    ]
  );

  const clearEditTrade = useCallback(() => {
    setEditingTrade(null);
    setTradeHasNoExpiry(false);
    setTradeHidePrivateLiquidity(false);
    setTradeActionError('');
  }, [setEditingTrade, setTradeActionError, setTradeHasNoExpiry, setTradeHidePrivateLiquidity]);

  const startFreshTrade = useCallback(() => {
    clearCounterTrade();
    clearEditTrade();
    setTradeHidePrivateLiquidity(true);
    setTradeHasNoExpiry(false);
    navigateToTradePath(buildCurrentTradeSurfacePath('create', 'limit'));
  }, [
    buildCurrentTradeSurfacePath,
    clearCounterTrade,
    clearEditTrade,
    navigateToTradePath,
    setTradeHasNoExpiry,
    setTradeHidePrivateLiquidity
  ]);

  const createTrade = useCallback(async () => {
    const composerAction: P2PActionNoticeAction = counterParentTrade ? 'counter' : 'create-offer';
    const setComposerActionError = (message: string) => {
      setTradeActionError(message);
      notifyComposerAction({ action: composerAction, message, status: 'error' });
    };

    setTradeActionError('');
    setCreatedTradeId(null);
    setCreatedTradeLink('');

    if (tradeComposerModel.tradeComposerValidationMessage) {
      setComposerActionError(tradeComposerModel.tradeComposerValidationMessage);
      return;
    }

    const offerToken = tradeComposerModel.selectedTradeOfferToken ? { ...tradeComposerModel.selectedTradeOfferToken } : null;
    const requestToken = tradeComposerModel.selectedTradeRequestToken ? { ...tradeComposerModel.selectedTradeRequestToken } : null;
    const offerAmount = tradeComposerModel.parsedTradeOfferAmountWei;
    const requestAmount = tradeComposerModel.parsedTradeRequestAmountWei;
    if (!offerToken || !requestToken || !offerAmount || !requestAmount) {
      setComposerActionError('Complete the trade terms first.');
      return;
    }
    const capturedExpiresAt = tradeHasNoExpiry ? 0 : Math.floor(Date.now() / 1000) + tradeComposerModel.parsedTradeExpiryHours * 3600;
    if (editingTrade && !canEditPublicTrade(editingTrade, walletKey)) {
      setComposerActionError('Only your open, unfilled trades can be edited.');
      return;
    }
    if (!editingTrade && tradeVisibility === 'direct') {
      if (!directTradeRecipientIsValid) {
        setComposerActionError('Enter a valid wallet address for the direct trade.');
        return;
      }
      if (directTradeRecipientNormalized.toLowerCase() === walletAddress.toLowerCase()) {
        setComposerActionError('Choose a different wallet for the direct trade.');
        return;
      }
    }

    try {
      setCreatingTrade(true);
      // Keep the reviewed parent identity stable across wallet confirmation.
      const counterParentSnapshot = counterParentTrade ? { ...counterParentTrade,
        v2: counterParentTrade.v2 ? { ...counterParentTrade.v2 } : undefined } : null;
      const createdResult = await runTradeWalletPromptFlow(async () => {
      const counterParentTrade = counterParentSnapshot;
      const isCounterTrade = counterParentTrade !== null;
      const isCounterReplacement = Boolean(counterParentTrade?.counterParentTradeId);
      const editSourceTrade = editingTrade;
      const isEditTrade = editSourceTrade !== null;
      if (!isCounterTrade && !isEditTrade && tradeVisibility === 'unlisted') {
        const link = otcV2ActionRuntime?.link;
        if (!otcV2ActionRuntime?.isCurrent() || !link || link.ownerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          throw new Error('Shared-link creation is unavailable in the current wallet session.');
        }
        if (offerToken.kind === 'native' || requestToken.kind === 'native' || offerToken.kind !== requestToken.kind ||
            !offerToken.tokenAddress || !requestToken.tokenAddress) {
          throw new Error('Shared links require two public tokens or two private tokens.');
        }
        if (offerToken.kind === 'private-erc20' && !tradeHidePrivateLiquidity) throw new Error('Public private-token budget disclosure is not enabled for shared links.');
        if (!ensureTradeFunding) throw new Error('Trade confirmation is unavailable.');
        const price = normalizePrivateBookV2Price({ offerAmount, requestAmount });
        const intent = captureWalletActionIntent({ offerBudget: offerAmount.toString(), terms: {
          offerToken: offerToken.tokenAddress.toLowerCase(), requestToken: requestToken.tokenAddress.toLowerCase(),
          privatePair: offerToken.kind === 'private-erc20', priceOffer: price.offerAmount.toString(),
          priceRequest: price.requestAmount.toString(), expiresAt: capturedExpiresAt.toString() } });
        const details = buildOtcV2ConfirmationDetails({ cotiPrivateInputCount: intent.action.terms.privatePair ? 4 : 1,
          approvals: [{ kind: offerToken.kind, symbol: offerToken.symbol }], summaryRows: [
            { label: 'Access', value: 'Shared link' },
            { label: 'Offer budget', value: `${formatUnits(offerAmount, offerToken.decimals)} ${offerToken.symbol}` },
            { label: 'Price', value: `${formatUnits(price.offerAmount, offerToken.decimals)} ${offerToken.symbol} for ${formatUnits(price.requestAmount, requestToken.decimals)} ${requestToken.symbol}` },
            { label: 'Privacy', value: intent.action.terms.privatePair ? 'Price and budget encrypted on-chain; link holders can read the price' : 'Public token terms and amounts' },
            { label: 'Fills', value: 'Partial fills at this price; each payment rounds up' }
          ] });
        await ensureTradeFunding({ actionLabel: 'create shared trade', confirmButtonLabel: 'Create trade',
          confirmTitle: 'Confirm shared trade', confirmMessage: details.confirmMessage, confirmationPolicy: 'always',
          confirmationStats: details.confirmationStats, tradeSummary: details.tradeSummary,
          requirements: [{ asset: offerToken, amountWei: offerAmount, reason: 'trade offer' }] });
        if (!otcV2ActionRuntime.isCurrent() || otcV2ActionRuntime.link !== link) throw new Error('Shared-link wallet session changed during review.');
        notifyComposerAction({ action: composerAction, status: 'pending' });
        const created = await link.create(readWalletActionIntent(intent));
        const shareUrl = typeof window === 'undefined' ? created.sharePath : new URL(created.sharePath, window.location.origin).href;
        setCreatedTradeLink(shareUrl);
        setTradeOfferAmountInput(''); setTradeRequestAmountInput('');
        setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS); setTradeHasNoExpiry(false); setTradeHidePrivateLiquidity(true);
        try { navigateToTradePath(created.sharePath); await loadWalletBalances(); }
        catch { setTradeActionError('Trade created. Its display is pending a refresh. Keep the Share link; do not create it again.'); }
        return { txHash: created.transactionHash };
      }
      if (counterParentTrade) {
        const counterUnavailableReason = getCounterOfferUnavailableReason(counterParentTrade, walletKey);
        if (counterUnavailableReason) {
          setComposerActionError(counterUnavailableReason);
          return null;
        }
      }
      const hiddenLiquidity = Boolean(
        tradeHidePrivateLiquidity &&
          tradeComposerModel.hiddenLiquidityActive &&
          tradeComposerModel.hiddenPriceOfferAmountWei !== null &&
          tradeComposerModel.hiddenPriceRequestAmountWei !== null &&
          !isCounterTrade &&
          (!isEditTrade || editSourceTrade?.hiddenLiquidity)
      );
      const v2Protocol = editSourceTrade?.v2?.protocol ?? (
        counterParentTrade?.v2?.protocol === 'direct-v2'
          ? 'direct-v2'
          : !isEditTrade && !isCounterTrade && tradeVisibility === 'direct'
            ? 'direct-v2'
            : !isEditTrade && !isCounterTrade && tradeVisibility === 'public'
              ? offerToken.kind === 'private-erc20' || requestToken.kind === 'private-erc20'
                ? 'private-v2'
                : 'standard-v2'
              : null
      );
      if (!v2Protocol) {
        throw new Error('This order type has no frozen OTC V2 implementation. Use Public, Direct, or Private OTC V2.');
      }
      if (!otcV2ActionRuntime?.isCurrent()) {
        throw new Error('The verified OTC V2 suite is unavailable in the current wallet session.');
      }
      if (counterParentTrade && counterParentTrade.v2?.protocol !== 'direct-v2') {
        throw new Error('Only Direct OTC V2 offers support counter offers.');
      }
      const v2Deployment = otcV2ActionRuntime.deployments[v2Protocol];
      if (counterParentTrade && (
        counterParentTrade.v2?.chainId !== v2Deployment.chainId ||
        counterParentTrade.v2?.contractAddress.toLowerCase() !== v2Deployment.contractAddress.toLowerCase() ||
        counterParentTrade.escrowContract?.toLowerCase() !== v2Deployment.contractAddress.toLowerCase()
      )) {
        throw new Error('This counter offer does not match the verified Direct OTC V2 deployment.');
      }
      if (v2Protocol === 'private-v2' && isPrivateBookV2RuntimeHash(otcV2ActionRuntime.deployments['private-v2'].runtimeBytecodeHash)) {
        if (isCounterTrade || tradeVisibility !== 'public') throw new Error('This private book candidate supports public-book creation only.');
        if (!ensureTradeFunding) throw new Error('Trade confirmation is unavailable.');
        const action = buildPrivateBookV2ComposerAction({ offerToken, requestToken, offerBudget: offerAmount,
          requestAtBudget: requestAmount, expiresAt: capturedExpiresAt, editingTrade: editSourceTrade,
          disclosePrivateBudget: !tradeHidePrivateLiquidity });
        const result = await executePrivateBookV2Composer({ runtime: otcV2ActionRuntime, action, offerToken, requestToken,
          walletAddress, editingTrade: editSourceTrade, confirm: async details => {
            await ensureTradeFunding({ actionLabel: isEditTrade ? 'update trade' : 'create trade',
              confirmButtonLabel: isEditTrade ? 'Update trade' : 'Create trade', confirmMessage: details.confirmMessage,
              confirmationStats: details.confirmationStats, confirmTitle: isEditTrade ? 'Confirm trade update' : 'Confirm new trade',
              confirmationPolicy: 'always', requirements: [{ asset: offerToken, amountWei: offerAmount, reason: 'trade offer' }],
              tradeSummary: details.tradeSummary });
            notifyComposerAction({ action: composerAction, status: 'pending' });
            return true;
          } });
        if (!result) return null;
        setCreatedTradeId(result.tradeId);
        setCreatedTradeLink(buildTradeShareUrl(result.tradeId, undefined, result.escrowContract));
        setCounterParentTrade(null);
        setEditingTrade(null);
        setTradeOfferAmountInput('');
        setTradeRequestAmountInput('');
        setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
        setTradeHasNoExpiry(false);
        setTradeHidePrivateLiquidity(true);
        if (result.snapshot) {
          mergeTradeSnapshot(result.snapshot);
          setDetailTrade(result.snapshot);
        }
        // The send is confirmed. A display/list refresh failure cannot turn it into a failed creation.
        let refreshError = result.refreshError;
        try {
          openTrade(result.tradeId, undefined, result.escrowContract);
          refreshOneOffV2Trades?.();
          await Promise.all([loadWalletBalances(), refreshMyTrades(), refreshPublicTrades()]);
        } catch {
          refreshError = 'Trade confirmed. Its display is pending a refresh. Keep the order ID; do not create it again.';
        }
        if (refreshError) setTradeActionError(refreshError);
        return result;
      }
      if (editSourceTrade && getPrivateBookV2Projection(editSourceTrade)) throw new Error('This edit requires the promoted private book runtime.');
      if (isEditTrade && editSourceTrade.hiddenLiquidity && !hiddenLiquidity) {
        setComposerActionError('Hidden amount orders must stay hidden when edited. Cancel the edit to create a visible order.');
        return null;
      }
      const actionLabel = isEditTrade ? 'update trade' : isCounterTrade ? 'create counter offer' : 'create trade';
      const actionTitle = isEditTrade
        ? 'Confirm trade update'
        : isCounterTrade
          ? 'Confirm counter offer'
          : 'Confirm new trade';
      const actionPrimaryLabel = isEditTrade ? 'Update trade' : isCounterTrade ? 'Create counter' : 'Create trade';
      const tradeSummary: TradeActionConfirmSummaryRow[] = [
        {
          label: 'You sell',
          value: buildAmountLabel(offerAmount, offerToken)
        },
        {
          label: 'You buy',
          value: buildAmountLabel(requestAmount, requestToken)
        },
        {
          label: 'Type',
          value: getVisibilitySummaryLabel({
            hiddenLiquidity,
            isCounterTrade,
            isEditTrade,
            tradeVisibility
          })
        }
      ];
      if (isCounterTrade && counterParentTrade) {
        tradeSummary.push({
          label: 'Reply to',
          value: `Offer #${counterParentTrade.tradeId}`
        });
      }
      if (tradeVisibility === 'direct' && !isCounterTrade) {
        tradeSummary.push({
          label: 'Recipient',
          value: directTradeRecipientNormalized
        });
      }
      const v2Approval = buildOtcV2ConditionalApproval({
        amountWei: offerAmount,
        kind: offerToken.kind === 'native' ? 'none' : offerToken.kind,
        symbol: offerToken.symbol
      });
      const v2Confirmation = buildOtcV2ConfirmationDetails({
        approvals: v2Approval ? [v2Approval] : [],
        cotiPrivateInputCount:
          v2Protocol === 'private-v2'
            ? 1
            : v2Protocol === 'direct-v2' &&
                offerToken.kind === 'private-erc20' &&
                requestToken.kind === 'private-erc20'
              ? 2
              : 0,
        summaryRows: tradeSummary
      });
      await ensureTradeFunding?.({
        actionLabel,
        confirmButtonLabel: actionPrimaryLabel,
        confirmMessage: v2Confirmation.confirmMessage,
        confirmationStats: v2Confirmation.confirmationStats,
        confirmTitle: actionTitle,
        confirmationPolicy: 'always',
        requirements: [
          {
            asset: offerToken,
            amountWei: offerAmount,
            reason: 'trade offer'
          }
        ],
        tradeSummary: v2Confirmation.tradeSummary
      });
      notifyComposerAction({ action: composerAction, status: 'pending' });
      const expiresAt = tradeHasNoExpiry
        ? 0
        : Math.floor(Date.now() / 1000) + tradeComposerModel.parsedTradeExpiryHours * 3600;
      const takerAddress =
        counterParentTrade?.maker ??
        (isEditTrade
          ? v2Protocol === 'direct-v2'
            ? editSourceTrade?.taker ?? ZERO_TRADE_TAKER_ADDRESS
            : ZERO_TRADE_TAKER_ADDRESS
          : tradeVisibility === 'direct'
            ? directTradeRecipientNormalized
            : ZERO_TRADE_TAKER_ADDRESS);
      if (editSourceTrade?.v2 && (
        editSourceTrade.v2.chainId !== v2Deployment.chainId ||
        editSourceTrade.v2.contractAddress.toLowerCase() !== v2Deployment.contractAddress.toLowerCase() ||
        editSourceTrade.escrowContract?.toLowerCase() !== v2Deployment.contractAddress.toLowerCase()
      )) {
        throw new Error('This edit does not match the verified OTC V2 deployment.');
      }
      const createResult = await (async () => {
            const publicAsset = (value: Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>) => value.kind === 'native'
              ? { assetType: 'native' as const }
              : { assetType: 'erc20' as const, token: value.tokenAddress };
            let confirmed: { tradeId?: string; orderId?: string; transactionHash: string };
            if (v2Protocol === 'standard-v2') {
              if (offerToken.kind === 'private-erc20' || requestToken.kind === 'private-erc20') {
                throw new Error('Standard OTC V2 supports public assets only.');
              }
              confirmed = await otcV2ActionRuntime.standard(isEditTrade
                ? {
                    kind: 'replace', originalTradeId: editSourceTrade.tradeId,
                    offerAsset: { ...publicAsset(offerToken), amount: offerAmount },
                    requestAsset: { ...publicAsset(requestToken), amount: requestAmount },
                    fillPolicy: { partialFillsAllowed: true, minPartialFillBps: 0n, minRequestAmount: 0n, maxRequestAmountPerWallet: 0n, oneFillPerWallet: false },
                    expiresAt
                  }
                : {
                    kind: 'create',
                    offerAsset: { ...publicAsset(offerToken), amount: offerAmount },
                    requestAsset: { ...publicAsset(requestToken), amount: requestAmount },
                    fillPolicy: { partialFillsAllowed: true, minPartialFillBps: 0n, minRequestAmount: 0n, maxRequestAmountPerWallet: 0n, oneFillPerWallet: false },
                    expiresAt
                  });
            } else if (v2Protocol === 'private-v2') {
              if (offerToken.kind !== 'private-erc20' && requestToken.kind !== 'private-erc20') {
                throw new Error('Private OTC V2 requires at least one private token.');
              }
              const privateAsset = (value: Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>, amount: bigint) => ({
                assetType: value.kind,
                ...(value.kind === 'native' ? {} : { token: value.tokenAddress }),
                amount
              });
              confirmed = await otcV2ActionRuntime.privateTrade(isEditTrade
                ? {
                    kind: 'replace', originalOrderId: editSourceTrade.tradeId,
                    offerAsset: privateAsset(offerToken, offerAmount),
                    requestAsset: privateAsset(requestToken, requestAmount),
                    fillPolicy: { partialFillsAllowed: true, minPartialFillBps: 0n, maxFills: 64n },
                    expiresAt
                  }
                : {
                    kind: 'create',
                    offerAsset: privateAsset(offerToken, offerAmount),
                    requestAsset: privateAsset(requestToken, requestAmount),
                    fillPolicy: { partialFillsAllowed: true, minPartialFillBps: 0n, maxFills: 64n },
                    expiresAt
                  });
            } else {
              const privateDirect = offerToken.kind === 'private-erc20' || requestToken.kind === 'private-erc20';
              if (privateDirect && (offerToken.kind !== 'private-erc20' || requestToken.kind !== 'private-erc20')) {
                throw new Error('Direct OTC V2 supports either two public assets or two private tokens, not a mixed pair.');
              }
              if (isCounterTrade && counterParentTrade?.v2?.contractAddress.toLowerCase() !== v2Deployment.contractAddress.toLowerCase()) {
                throw new Error('A Direct OTC V2 counter must use the same verified contract as its parent.');
              }
              if (privateDirect) {
                const privateTerms = {
                  offerToken: offerToken.tokenAddress!,
                  requestToken: requestToken.tokenAddress!,
                  offerAmount,
                  requestAmount,
                  expiresAt
                };
                confirmed = isEditTrade
                  ? await otcV2ActionRuntime.direct({
                      kind: 'replace-private',
                      originalTradeId: editSourceTrade.tradeId,
                      ...privateTerms
                    })
                  : isCounterTrade
                    ? await otcV2ActionRuntime.direct({
                        kind: 'counter-private',
                        parentTradeId: counterParentTrade!.tradeId,
                        ...privateTerms
                      })
                    : await otcV2ActionRuntime.direct({
                        kind: 'create-private',
                        taker: takerAddress,
                        ...privateTerms
                      });
              } else {
                const publicTerms = {
                  offerAsset: publicAsset(offerToken),
                  requestAsset: publicAsset(requestToken),
                  offerAmount,
                  requestAmount,
                  expiresAt
                };
                confirmed = isEditTrade
                  ? await otcV2ActionRuntime.direct({
                      kind: 'replace-public',
                      originalTradeId: editSourceTrade.tradeId,
                      ...publicTerms
                    })
                  : isCounterTrade
                    ? await otcV2ActionRuntime.direct({
                        kind: 'counter-public',
                        parentTradeId: counterParentTrade!.tradeId,
                        ...publicTerms
                      })
                    : await otcV2ActionRuntime.direct({
                        kind: 'create-public',
                        taker: takerAddress,
                        ...publicTerms
                      });
              }
            }
            const id = Number(confirmed.tradeId ?? confirmed.orderId ?? '');
            if (!Number.isSafeInteger(id) || id <= 0) throw new Error('The confirmed OTC V2 order ID is invalid.');
            return { tradeId: id, escrowContract: v2Deployment.contractAddress, txHash: confirmed.transactionHash };
          })();
      const tradeId = createResult.tradeId;
      const createdAt = Math.floor(Date.now() / 1000);
      const counterParentTradeId = isCounterReplacement
        ? counterParentTrade?.counterParentTradeId
        : counterParentTrade?.tradeId;
      const createdOnDirectEscrow = v2Protocol === 'direct-v2';
      const privateMode = offerToken.kind === 'private-erc20' && requestToken.kind === 'private-erc20'
        ? 'fully-private' as const
        : offerToken.kind === 'private-erc20'
          ? 'private-offer-public-request' as const
          : requestToken.kind === 'private-erc20'
            ? 'public-offer-private-request' as const
            : undefined;
      const snapshot: TradeSnapshot = {
        tradeId,
        escrowContract: createResult.escrowContract,
        maker: walletAddress,
        taker: takerAddress,
        offer: { ...offerToken, amount: offerAmount.toString() },
        request: { ...requestToken, amount: requestAmount.toString() },
        createdAt,
        expiresAt,
        status: 'open',
        isPublic: createdOnDirectEscrow ? false : isEditTrade || (!isCounterTrade && tradeVisibility === 'public'),
        parentTradeId: isEditTrade ? editSourceTrade.tradeId : counterParentTradeId,
        counterParentEscrow: isCounterTrade ? counterParentTrade?.escrowContract : undefined,
        counterParentTradeId: isCounterTrade ? counterParentTradeId : undefined,
        replacesTradeId: isEditTrade ? editSourceTrade.tradeId : undefined,
        fillState: {
          remainingOfferAmount: offerAmount.toString(),
          remainingRequestAmount: requestAmount.toString(),
          filledOfferAmount: '0',
          filledRequestAmount: '0'
        },
        hiddenLiquidity: v2Protocol === 'private-v2' || (v2Protocol === 'direct-v2' && Boolean(privateMode)),
        makerPrivateProgress: v2Protocol === 'private-v2' || (v2Protocol === 'direct-v2' && Boolean(privateMode))
          ? {
              initialOfferAmount: offerAmount.toString(),
              remainingOfferAmount: offerAmount.toString(),
              filledOfferAmount: '0'
            }
          : undefined,
        v2: {
          protocol: v2Protocol,
          chainId: v2Deployment.chainId,
          contractAddress: v2Deployment.contractAddress,
          ...(v2Protocol === 'standard-v2' || v2Protocol === 'private-v2' ? { revision: '1' } : {}),
          ...(v2Protocol === 'direct-v2' ? { amountMode: privateMode ? 'private' as const : 'public' as const } : {}),
          ...(privateMode ? { privateMode } : {})
        }
      };
      const shareUrl = buildTradeShareUrl(tradeId, undefined, createResult.escrowContract);
      if (isEditTrade) {
        mergeTradeSnapshot({
          ...editSourceTrade,
          status: 'cancelled',
          replacementTradeId: tradeId
        });
      }
      if (isCounterReplacement && counterParentTrade) {
        mergeTradeSnapshot({
          ...counterParentTrade,
          status: 'declined'
        });
      }
      mergeTradeSnapshot(snapshot);
      setDetailTrade(snapshot);
      setCreatedTradeId(tradeId);
      setCreatedTradeLink(shareUrl);
      setCounterParentTrade(null);
      setEditingTrade(null);
      if (tradeVisibility === 'direct') {
        setDirectTradeRecipient('');
      }
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHasNoExpiry(false);
      setTradeHidePrivateLiquidity(true);
      openTrade(tradeId, undefined, createResult.escrowContract);
      refreshOneOffV2Trades?.();
      await Promise.all([
        loadWalletBalances(),
        refreshMyTrades(),
        snapshot.isPublic ? refreshPublicTrades() : Promise.resolve()
      ]);
      openTrade(tradeId, undefined, createResult.escrowContract);
      return createResult;
      });
      if (!createdResult) {
        return;
      }
      notifyComposerAction({ action: composerAction, status: 'success', txHash: createdResult.txHash });
    } catch (error) {
      if (isTradeActionConfirmationCancelledError(error)) {
        return;
      }
      const actionError = getOnChainFailureMessage(error, 'Failed to create trade.');
      setTradeActionError(actionError);
      notifyComposerAction({
        action: composerAction,
        message: actionError,
        status: getP2PActionFailureStatus(actionError)
      });
    } finally {
      setCreatingTrade(false);
    }
  }, [
    buildTradeShareUrl,
    canEditPublicTrade,
    counterParentTrade,
    directTradeRecipientIsValid,
    directTradeRecipientNormalized,
    editingTrade,
    ensureTradeFunding,
    loadWalletBalances,
    mergeTradeSnapshot,
    navigateToTradePath,
    openTrade,
    notifyComposerAction,
    otcV2ActionRuntime,
    refreshMyTrades,
    refreshPublicTrades,
    refreshOneOffV2Trades,
    runTradeWalletPromptFlow,
    setCounterParentTrade,
    setCreatedTradeId,
    setCreatedTradeLink,
    setCreatingTrade,
    setDetailTrade,
    setDirectTradeRecipient,
    setEditingTrade,
    setTradeActionError,
    setTradeExpiryHoursInput,
    setTradeHasNoExpiry,
    setTradeHidePrivateLiquidity,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput,
    tradeComposerModel,
    tradeHasNoExpiry,
    tradeHidePrivateLiquidity,
    tradeVisibility,
    walletAddress,
    walletKey
  ]);

  return {
    beginCounterTrade,
    beginEditTrade,
    clearCounterTrade,
    clearEditTrade,
    createTrade,
    startFreshTrade
  };
}
