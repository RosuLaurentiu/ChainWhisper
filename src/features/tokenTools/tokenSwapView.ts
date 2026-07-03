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
