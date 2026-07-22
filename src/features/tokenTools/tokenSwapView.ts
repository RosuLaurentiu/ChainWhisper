import {
  COTI_NETWORK,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  formatTokenAmount,
  LEGACY_SWAP_VAULT_CONTRACT_ADDRESS,
  parseTokenAmountInput,
  WHISPER_SHIELD_ENABLED,
  WHISPER_SHIELD_LEGACY_UNSHIELD_ENABLED,
  WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS,
  type SwapDirection
} from '../../lib/appShared';
import { resolveWalletBlockedActionLabel } from '../../lib/walletSession';
import {
  buildPrivacyPortalQuoteKey,
  parsePrivacyAmountInput,
  validatePrivacyPortalAmount,
  type PrivacyDirection,
  type PrivacyPortalConversionStage,
  type PrivacyPortalPairMetrics,
  type PrivacyPortalQuote,
  type PrivacyTokenPair
} from '../../lib/privacyPortal';

type DeriveTokenSwapViewInput = {
  hasAesReady: boolean;
  legacyPrivateRewardTokenBalanceWei: bigint | null;
  legacyPrivateRewardTokenDecimals: number;
  legacyPrivateRewardTokenSymbol: string;
  loadingRewardBalances: boolean;
  onCotiNetwork: boolean;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  swapAmountInput: string;
  swapDirection: SwapDirection;
  swappingTokens: boolean;
  walletAddress: string;
};

type ResolveTokenSwapDirectionFallbackInput = {
  canLegacyUnshieldTokens: boolean;
  canShieldTokens: boolean;
  canUnshieldTokens: boolean;
  currentSwapDirectionEnabled: boolean;
  swapDirection: SwapDirection;
};

export const resolveTokenSwapDirectionFallback = ({
  canLegacyUnshieldTokens,
  canShieldTokens,
  canUnshieldTokens,
  currentSwapDirectionEnabled,
  swapDirection
}: ResolveTokenSwapDirectionFallbackInput): SwapDirection => {
  if (currentSwapDirectionEnabled) {
    return swapDirection;
  }
  if (swapDirection === 'shield') {
    return canUnshieldTokens ? 'unshield' : canLegacyUnshieldTokens ? 'legacy-unshield' : 'unshield';
  }
  if (swapDirection === 'unshield' && canLegacyUnshieldTokens) {
    return 'legacy-unshield';
  }
  return canUnshieldTokens ? 'unshield' : canShieldTokens ? 'shield' : swapDirection;
};

export const deriveTokenSwapView = ({
  hasAesReady,
  legacyPrivateRewardTokenBalanceWei,
  legacyPrivateRewardTokenDecimals,
  legacyPrivateRewardTokenSymbol,
  loadingRewardBalances,
  onCotiNetwork,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  swapAmountInput,
  swapDirection,
  swappingTokens,
  walletAddress
}: DeriveTokenSwapViewInput) => {
  const canShieldTokens = WHISPER_SHIELD_ENABLED && Boolean(WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS);
  const canUnshieldTokens = WHISPER_SHIELD_ENABLED && Boolean(WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS);
  const canLegacyUnshieldTokens =
    WHISPER_SHIELD_LEGACY_UNSHIELD_ENABLED && Boolean(LEGACY_SWAP_VAULT_CONTRACT_ADDRESS);
  const currentSwapDirectionEnabled =
    swapDirection === 'shield'
      ? canShieldTokens
      : swapDirection === 'unshield'
        ? canUnshieldTokens
        : canLegacyUnshieldTokens;
  const activeSwapVaultContractAddress =
    swapDirection === 'legacy-unshield'
      ? LEGACY_SWAP_VAULT_CONTRACT_ADDRESS
      : WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS;
  const activeSwapVaultContractUrl = activeSwapVaultContractAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/address/${activeSwapVaultContractAddress}#code`
    : '';
  const wispBridgeContractUrl = WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS
    ? `${COTI_NETWORK.blockExplorerUrl}/address/${WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS}#code`
    : '';
  const legacySwapVaultContractUrl = LEGACY_SWAP_VAULT_CONTRACT_ADDRESS
    ? `${COTI_NETWORK.blockExplorerUrl}/address/${LEGACY_SWAP_VAULT_CONTRACT_ADDRESS}#code`
    : '';
  const swapPrivateRewardTokenBalanceWei =
    swapDirection === 'legacy-unshield' ? legacyPrivateRewardTokenBalanceWei : privateRewardTokenBalanceWei;
  const swapPrivateRewardTokenSymbol =
    swapDirection === 'legacy-unshield'
      ? `${legacyPrivateRewardTokenSymbol || FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL} (old)`
      : privateRewardTokenSymbol;
  const swapPrivateRewardTokenDecimals =
    swapDirection === 'legacy-unshield' ? legacyPrivateRewardTokenDecimals : privateRewardTokenDecimals;
  const swapInputDecimals = swapDirection === 'shield' ? rewardTokenDecimals : swapPrivateRewardTokenDecimals;
  const publicBalance =
    rewardTokenBalanceWei !== null ? formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4) : '--';
  const privateBalance =
    swapPrivateRewardTokenBalanceWei !== null
      ? formatTokenAmount(swapPrivateRewardTokenBalanceWei, swapPrivateRewardTokenDecimals, 4)
      : hasAesReady
        ? '--'
        : 'locked';
  const tokenToolsSummary = loadingRewardBalances
    ? 'Loading balances...'
    : `${rewardTokenSymbol} ${publicBalance} | ${swapPrivateRewardTokenSymbol} ${privateBalance}`;
  const parsedSwapAmount = parseTokenAmountInput(swapAmountInput, swapInputDecimals);
  const swapInputSymbol = swapDirection === 'shield' ? rewardTokenSymbol : swapPrivateRewardTokenSymbol;
  const canSwapRewardTokens =
    currentSwapDirectionEnabled &&
    !swappingTokens &&
    !!walletAddress &&
    onCotiNetwork &&
    hasAesReady &&
    parsedSwapAmount !== null &&
    parsedSwapAmount > 0n;
  const swapBlockedActionLabel = resolveWalletBlockedActionLabel({
    hasAesReady,
    onCotiNetwork,
    walletAddress
  });
  const swapButtonLabel = swappingTokens
    ? 'Swapping...'
    : !currentSwapDirectionEnabled
      ? swapDirection === 'shield'
        ? 'Portal paused'
        : swapDirection === 'unshield'
          ? 'Unshield paused'
          : 'Legacy unshield unavailable'
      : swapBlockedActionLabel
        ? swapBlockedActionLabel
        : parsedSwapAmount === null || parsedSwapAmount <= 0n
          ? `Enter ${swapInputSymbol} amount`
          : swapDirection === 'shield'
            ? `Move to ${swapPrivateRewardTokenSymbol}`
            : `Move to ${rewardTokenSymbol}`;

  return {
    activeSwapVaultContractAddress,
    activeSwapVaultContractUrl,
    wispBridgeContractUrl,
    legacySwapVaultContractUrl,
    canLegacyUnshieldTokens,
    canShieldTokens,
    canSwapRewardTokens,
    canUnshieldTokens,
    currentSwapDirectionEnabled,
    parsedSwapAmount,
    swapButtonLabel,
    swapInputDecimals,
    swapInputSymbol,
    swapPrivateRewardTokenBalanceWei,
    swapPrivateRewardTokenDecimals,
    swapPrivateRewardTokenSymbol,
    tokenToolsSummary
  };
};

export type DerivePrivacyPortalViewInput = {
  actionStage: PrivacyPortalConversionStage | null;
  amountInput: string;
  direction: PrivacyDirection;
  hasAesReady: boolean;
  loading: boolean;
  metrics: PrivacyPortalPairMetrics | null;
  onCotiNetwork: boolean;
  pair: PrivacyTokenPair;
  quote: PrivacyPortalQuote | null;
  walletAddress: string;
};

export const derivePrivacyPortalView = ({
  actionStage,
  amountInput,
  direction,
  hasAesReady,
  loading,
  metrics,
  onCotiNetwork,
  pair,
  quote,
  walletAddress
}: DerivePrivacyPortalViewInput) => {
  const normalizedAccount = walletAddress.trim().toLowerCase();
  const activeMetrics =
    metrics &&
    metrics.pairId === pair.id &&
    (metrics.account?.toLowerCase() ?? '') === normalizedAccount
      ? metrics
      : null;
  const amountWei = parsePrivacyAmountInput(amountInput, pair.publicToken.decimals);
  const expectedQuoteKey =
    amountWei !== null
      ? buildPrivacyPortalQuoteKey({
          chainId: pair.chainId,
          account: normalizedAccount,
          pairId: pair.id,
          direction,
          amountWei
        })
      : '';
  const hasExactQuote = Boolean(quote && expectedQuoteKey && quote.quoteKey === expectedQuoteKey);
  const activeQuote = hasExactQuote ? quote : null;
  const inputBalanceWei =
    direction === 'public-to-private' ? activeMetrics?.publicBalanceWei : activeMetrics?.privateBalanceWei;
  const minAmountWei = activeQuote?.minAmountWei ?? (
    direction === 'public-to-private' ? activeMetrics?.limits.minDepositWei : activeMetrics?.limits.minWithdrawWei
  );
  const maxAmountWei = activeQuote?.maxAmountWei ?? (
    direction === 'public-to-private' ? activeMetrics?.limits.maxDepositWei : activeMetrics?.limits.maxWithdrawWei
  );
  const amountIssues =
    amountWei !== null && minAmountWei !== undefined && maxAmountWei !== undefined
      ? validatePrivacyPortalAmount({
          amountWei,
          minAmountWei,
          maxAmountWei,
          balanceWei: inputBalanceWei,
          bridgeLiquidityWei: activeQuote?.bridgeLiquidityWei ?? activeMetrics?.bridgeLiquidityWei,
          direction,
          feeWei: activeQuote?.feeWei,
          nativeCotiBalanceWei: activeMetrics?.nativeCotiBalanceWei,
          bridgeKind: pair.bridgeKind
        })
      : [];
  const bridgeReady =
    Boolean(activeMetrics) &&
    activeMetrics?.verification.status === 'ready' &&
    !activeMetrics.paused &&
    !activeMetrics.blacklisted &&
    (direction === 'public-to-private' || activeMetrics.privatePublicAmountsEnabled !== false) &&
    (direction === 'private-to-public' || activeMetrics.depositEnabled) &&
    (!activeQuote || (
      !activeQuote.paused &&
      !activeQuote.blacklisted &&
      (direction === 'private-to-public' || activeQuote.depositEnabled)
    ));
  const actionBusy = Boolean(actionStage && actionStage !== 'complete');
  const canConvert =
    !actionBusy &&
    Boolean(walletAddress) &&
    onCotiNetwork &&
    hasAesReady &&
    bridgeReady &&
    amountWei !== null &&
    amountWei > 0n &&
    amountIssues.length === 0 &&
    hasExactQuote;
  const inputSymbol = direction === 'public-to-private' ? pair.publicToken.symbol : pair.privateToken.symbol;
  const outputSymbol = direction === 'public-to-private' ? pair.privateToken.symbol : pair.publicToken.symbol;
  const blockedActionLabel = resolveWalletBlockedActionLabel({ hasAesReady, onCotiNetwork, walletAddress });
  const buttonLabel = actionBusy
    ? actionStage === 'confirming'
      ? 'Confirming conversion...'
      : 'Conversion in progress...'
    : blockedActionLabel
      ? blockedActionLabel
      : loading && !activeMetrics
        ? 'Loading bridge...'
        : activeMetrics?.verification.status === 'mismatch'
          ? 'Contract verification failed'
          : activeMetrics?.verification.status === 'unavailable'
            ? 'Bridge unavailable'
            : activeMetrics?.paused || activeQuote?.paused ||
              (direction === 'public-to-private' && (
                activeMetrics && !activeMetrics.depositEnabled || activeQuote && !activeQuote.depositEnabled
              ))
              ? 'Bridge paused'
              : activeMetrics?.blacklisted || activeQuote?.blacklisted
                ? 'Account restricted'
                : direction === 'private-to-public' && activeMetrics?.privatePublicAmountsEnabled === false
                  ? 'Private bridge transfers unavailable'
                : amountWei === null || amountWei <= 0n
                  ? `Enter ${inputSymbol} amount`
                  : amountIssues.includes('below-minimum')
                    ? 'Amount below bridge minimum'
                    : amountIssues.includes('above-maximum')
                      ? 'Amount above bridge maximum'
                      : amountIssues.includes('insufficient-balance')
                        ? `Insufficient ${inputSymbol} balance`
                        : amountIssues.includes('insufficient-bridge-liquidity')
                          ? 'Insufficient bridge liquidity'
                          : amountIssues.includes('insufficient-native-fee-balance')
                            ? 'Insufficient COTI for portal fee'
                            : amountIssues.includes('fee-exceeds-amount')
                              ? 'Portal fee exceeds amount'
                              : !hasExactQuote
                                ? 'Refreshing quote...'
                                : `Convert to ${outputSymbol}`;

  return {
    amountIssues,
    amountWei,
    buttonLabel,
    canConvert,
    expectedQuoteKey,
    hasExactQuote,
    inputBalanceWei: inputBalanceWei ?? null,
    inputSymbol,
    outputSymbol
  };
};
