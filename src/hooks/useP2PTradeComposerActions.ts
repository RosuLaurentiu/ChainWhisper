import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  formatTokenAmount,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../lib/appShared';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  isVerifiedEcosystemToken,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import type { TradeComposerModel } from '../lib/tradeComposer';
import {
  counterTradeAndCloseCounteredTradeOnChain,
  createTradeOnChain,
  editTradeOnChain,
  replacePrivateFixedPriceTradeOnChain
} from '../lib/tradeActions';
import { ZERO_TRADE_TAKER_ADDRESS } from '../lib/tradePerspective';

type TradeSigner = JsonRpcSigner | Wallet;
type TradeVisibility = 'public' | 'unlisted' | 'direct';

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

const isPrivateTradeAsset = (asset?: Pick<TradeAssetPayload, 'kind'> | null): boolean => asset?.kind === 'private-erc20';

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

const createTradeAccessSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const formatTradeAmountInput = (asset: TradeAssetPayload): string => {
  try {
    return formatTokenAmount(BigInt(asset.amount), asset.decimals, 18);
  } catch {
    return '';
  }
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
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  canEditPublicTrade: (trade: TradeSnapshot, walletKey: string) => boolean;
  counterParentTrade: TradeSnapshot | null;
  directTradeRecipientIsValid: boolean;
  directTradeRecipientNormalized: string;
  editingTrade: TradeSnapshot | null;
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  hashTradeAccessSecret: (accessSecret: string) => Promise<string>;
  loadWalletBalances: () => Promise<void>;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  navigateToTradePath: (path: string) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  openTradeSnapshot: (snapshot: TradeSnapshot, accessSecret?: string) => void;
  refreshMyTrades: () => Promise<void>;
  refreshPublicTrades: () => Promise<void>;
  rememberPrivateTradeLiquidity: (tradeId: number, escrowContract: string | undefined, offerAmountWei: bigint) => void;
  rememberTradeAccessSecret: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resolveRequiredFeeForTradeCreate: () => Promise<bigint>;
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
  buildTradeShareUrl,
  canEditPublicTrade,
  counterParentTrade,
  directTradeRecipientIsValid,
  directTradeRecipientNormalized,
  editingTrade,
  getTradeSigner,
  hashTradeAccessSecret,
  loadWalletBalances,
  mergeTradeSnapshot,
  navigateToTradePath,
  openTrade,
  openTradeSnapshot,
  refreshMyTrades,
  refreshPublicTrades,
  rememberPrivateTradeLiquidity,
  rememberTradeAccessSecret,
  resolveRequiredFeeForTradeCreate,
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
  walletKey
}: UseP2PTradeComposerActionsArgs): UseP2PTradeComposerActionsResult {
  const beginCounterTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet before countering.');
        return;
      }
      if (snapshot.maker.toLowerCase() === walletKey) {
        setTradeActionError('This is your offer. Cancel it and create a new one to change the terms.');
        return;
      }
      if (snapshot.status !== 'open') {
        setTradeActionError('Only open trades can receive counter offers.');
        return;
      }
      if (snapshot.counterParentTradeId && snapshot.taker.toLowerCase() !== walletKey) {
        setTradeActionError('Only the recipient of a counter offer can replace it with a new counter.');
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
      setTradeOfferAmountInput(formatTradeAmountInput(snapshot.request));
      setTradeRequestAmountInput(formatTradeAmountInput(snapshot.offer));
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeHasNoExpiry(false);
      setTradeHidePrivateLiquidity(false);
      setTradeActionError('');
      openTradeSnapshot(snapshot);
    },
    [
      openTradeSnapshot,
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

  const clearCounterTrade = useCallback(() => {
    setCounterParentTrade(null);
    setTradeHidePrivateLiquidity(false);
    setTradeActionError('');
  }, [setCounterParentTrade, setTradeActionError, setTradeHidePrivateLiquidity]);

  const beginEditTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect the maker wallet before editing.');
        return;
      }
      if (!canEditPublicTrade(snapshot, walletKey)) {
        setTradeActionError('Only your open, unfilled public trades can be edited.');
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
          snapshot.makerPrivateProgress?.remainingOfferAmount ?? snapshot.makerPrivateProgress?.initialOfferAmount;
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
      navigateToTradePath('/trades/create');
    },
    [
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
    setTradeHidePrivateLiquidity(false);
    setTradeHasNoExpiry(false);
    navigateToTradePath('/trades/create');
  }, [clearCounterTrade, clearEditTrade, navigateToTradePath, setTradeHasNoExpiry, setTradeHidePrivateLiquidity]);

  const createTrade = useCallback(async () => {
    setTradeActionError('');
    setCreatedTradeId(null);
    setCreatedTradeLink('');

    if (tradeComposerModel.tradeComposerValidationMessage) {
      setTradeActionError(tradeComposerModel.tradeComposerValidationMessage);
      return;
    }

    const offerToken = tradeComposerModel.selectedTradeOfferToken;
    const requestToken = tradeComposerModel.selectedTradeRequestToken;
    const offerAmount = tradeComposerModel.parsedTradeOfferAmountWei;
    const requestAmount = tradeComposerModel.parsedTradeRequestAmountWei;
    if (!offerToken || !requestToken || !offerAmount || !requestAmount) {
      setTradeActionError('Complete the trade terms first.');
      return;
    }
    if (editingTrade && !canEditPublicTrade(editingTrade, walletKey)) {
      setTradeActionError('Only your open, unfilled public trades can be edited.');
      return;
    }
    if (!editingTrade && tradeVisibility === 'direct') {
      if (!directTradeRecipientIsValid) {
        setTradeActionError('Enter a valid wallet address for the direct trade.');
        return;
      }
      if (directTradeRecipientNormalized.toLowerCase() === walletAddress.toLowerCase()) {
        setTradeActionError('Choose a different wallet for the direct trade.');
        return;
      }
    }

    try {
      setCreatingTrade(true);
      const isCounterTrade = counterParentTrade !== null;
      const isCounterReplacement = Boolean(counterParentTrade?.counterParentTradeId);
      const editSourceTrade = editingTrade;
      const isEditTrade = editSourceTrade !== null;
      const hiddenLiquidity = Boolean(
        tradeHidePrivateLiquidity &&
          tradeComposerModel.hiddenLiquidityActive &&
          tradeComposerModel.hiddenPriceOfferAmountWei !== null &&
          tradeComposerModel.hiddenPriceRequestAmountWei !== null &&
          !isCounterTrade &&
          (!isEditTrade || editSourceTrade?.hiddenLiquidity)
      );
      if (isEditTrade && editSourceTrade.hiddenLiquidity && !hiddenLiquidity) {
        setTradeActionError('Hidden amount orders must stay hidden when edited. Cancel the edit to create a visible order.');
        return;
      }
      const accessSecret = tradeVisibility === 'unlisted' && !isCounterTrade && !isEditTrade ? createTradeAccessSecret() : '';
      const accessHash = accessSecret ? await hashTradeAccessSecret(accessSecret) : ZERO_BYTES32;
      const signer = await getTradeSigner(isPrivateTradeAsset(offerToken));
      const nativeFeeWei = await resolveRequiredFeeForTradeCreate();
      const expiresAt = tradeHasNoExpiry
        ? 0
        : Math.floor(Date.now() / 1000) + tradeComposerModel.parsedTradeExpiryHours * 3600;
      const publicOfferAmount = hiddenLiquidity ? tradeComposerModel.hiddenPriceOfferAmountWei! : offerAmount;
      const publicRequestAmount = hiddenLiquidity ? tradeComposerModel.hiddenPriceRequestAmountWei! : requestAmount;
      const takerAddress =
        counterParentTrade?.maker ??
        (isEditTrade
          ? ZERO_TRADE_TAKER_ADDRESS
          : tradeVisibility === 'direct'
            ? directTradeRecipientNormalized
            : ZERO_TRADE_TAKER_ADDRESS);
      const createResult = isEditTrade
        ? hiddenLiquidity
          ? await replacePrivateFixedPriceTradeOnChain({
              signer,
              makerAddress: walletAddress,
              originalTradeId: editSourceTrade.tradeId,
              takerAddress: ZERO_TRADE_TAKER_ADDRESS,
              offerAsset: offerToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: requestToken,
              requestAmountWei: publicRequestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: true,
              hiddenOfferAmountWei: offerAmount,
              publicOfferAmountWei: publicOfferAmount
            })
          : await editTradeOnChain({
              signer,
              makerAddress: walletAddress,
              originalTradeId: editSourceTrade.tradeId,
              takerAddress: ZERO_TRADE_TAKER_ADDRESS,
              offerAsset: offerToken,
              offerAmountWei: offerAmount,
              requestAsset: requestToken,
              requestAmountWei: requestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: true
            })
        : isCounterReplacement && counterParentTrade
          ? await counterTradeAndCloseCounteredTradeOnChain({
              signer,
              makerAddress: walletAddress,
              counteredTradeId: counterParentTrade.tradeId,
              offerAsset: offerToken,
              offerAmountWei: offerAmount,
              requestAsset: requestToken,
              requestAmountWei: requestAmount,
              expiresAt,
              nativeFeeWei
            })
          : await createTradeOnChain({
              signer,
              makerAddress: walletAddress,
              takerAddress,
              offerAsset: offerToken,
              offerAmountWei: publicOfferAmount,
              requestAsset: requestToken,
              requestAmountWei: publicRequestAmount,
              expiresAt,
              nativeFeeWei,
              isPublic: !isCounterTrade && tradeVisibility === 'public',
              accessHash: accessHash !== ZERO_BYTES32 ? accessHash : undefined,
              parentTradeId: counterParentTrade?.tradeId,
              hidePrivateLiquidity: hiddenLiquidity,
              hiddenOfferAmountWei: hiddenLiquidity ? offerAmount : undefined,
              publicOfferAmountWei: hiddenLiquidity ? publicOfferAmount : undefined
            });
      const tradeId = createResult.tradeId;
      if (hiddenLiquidity) {
        rememberPrivateTradeLiquidity(tradeId, createResult.escrowContract, offerAmount);
      }
      const createdAt = Math.floor(Date.now() / 1000);
      const counterParentTradeId = isCounterReplacement
        ? counterParentTrade?.counterParentTradeId
        : counterParentTrade?.tradeId;
      const snapshot: TradeSnapshot = {
        tradeId,
        escrowContract: createResult.escrowContract,
        maker: walletAddress,
        taker: takerAddress,
        offer: { ...offerToken, amount: publicOfferAmount.toString() },
        request: { ...requestToken, amount: publicRequestAmount.toString() },
        createdAt,
        expiresAt,
        status: 'open',
        isPublic: isEditTrade || (!isCounterTrade && tradeVisibility === 'public'),
        hasAccessHash: Boolean(accessSecret),
        parentTradeId: isEditTrade ? editSourceTrade.tradeId : counterParentTradeId,
        counterParentTradeId: isCounterTrade ? counterParentTradeId : undefined,
        replacesTradeId: isEditTrade ? editSourceTrade.tradeId : undefined,
        fillState: {
          remainingOfferAmount: hiddenLiquidity ? '0' : offerAmount.toString(),
          remainingRequestAmount: hiddenLiquidity ? '0' : requestAmount.toString(),
          filledOfferAmount: '0',
          filledRequestAmount: '0'
        },
        hiddenLiquidity,
        makerPrivateProgress: hiddenLiquidity
          ? {
              initialOfferAmount: offerAmount.toString(),
              remainingOfferAmount: offerAmount.toString(),
              filledOfferAmount: '0'
            }
          : undefined
      };
      const shareUrl = buildTradeShareUrl(tradeId, accessSecret || undefined, createResult.escrowContract);
      rememberTradeAccessSecret(tradeId, accessSecret || undefined, createResult.escrowContract);
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
      setTradeHidePrivateLiquidity(false);
      openTrade(tradeId, accessSecret || undefined, createResult.escrowContract);
      await Promise.all([
        loadWalletBalances(),
        refreshMyTrades(),
        snapshot.isPublic ? refreshPublicTrades() : Promise.resolve()
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create trade.';
      setTradeActionError(getOnChainFailureMessage(error, message));
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
    getTradeSigner,
    hashTradeAccessSecret,
    loadWalletBalances,
    mergeTradeSnapshot,
    openTrade,
    refreshMyTrades,
    refreshPublicTrades,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveRequiredFeeForTradeCreate,
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
