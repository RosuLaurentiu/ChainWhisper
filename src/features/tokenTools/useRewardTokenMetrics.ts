import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  readCurrentPrivateErc20BalanceWei,
  readLegacyPrivateRewardBalanceWei
} from '../../lib/appChain';
import {
  LEGACY_GROUP_CHAT_CONTRACT_ABI,
  LEGACY_GROUP_CHAT_CONTRACT_ADDRESS
} from '../../lib/legacyChatContracts';
import {
  COTI_NETWORK,
  EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI,
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  isWalletAddress,
  LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
  LEGACY_SWAP_VAULT_CONTRACT_ABI,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfoByAddress,
  normalizeTokenDecimals,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  REWARD_TOKEN_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
  WHISPER_REWARDS_ABI,
  type SwapDirection
} from '../../lib/appShared';
import { useTokenToolsStore } from './tokenToolsStore';
import { isLegacyUnshieldDirection } from './tokenSwapView';

type MemoSignerBundle = {
  cacheKey: string;
  signer: JsonRpcSigner;
};

type ContractCall = (...args: unknown[]) => Promise<unknown>;
type ContractLike = Record<string, unknown>;

async function readWispBridgeFee(contract: ContractLike, withdraw = false): Promise<bigint | null> {
  const selector = withdraw ? 'estimateWithdrawFee(uint256)' : 'estimateDepositFee(uint256)';
  const quoteMethod = contract[selector] as ContractCall | undefined;
  const quote = quoteMethod ? await quoteMethod.call(contract, 1n).catch(() => null) : null;
  const quotedFee = Array.isArray(quote)
    ? quote[0]
    : quote && typeof quote === 'object' && 0 in quote
      ? (quote as { 0?: unknown })[0]
      : null;
  if (typeof quotedFee === 'bigint') {
    return quotedFee;
  }

  const nativeFeeMethod = contract.nativeCotiFee as ContractCall | undefined;
  const fallback = nativeFeeMethod ? await nativeFeeMethod.call(contract).catch(() => null) : null;
  return typeof fallback === 'bigint' ? fallback : null;
}

type UseRewardTokenMetricsArgs = {
  activeSwapVaultContractAddress: string;
  chainId: number | null;
  currentSwapDirectionEnabled: boolean;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  groupRequiredFeeCacheRef: MutableRefObject<bigint | null>;
  groupTokenFeeCacheRef: MutableRefObject<bigint | null>;
  hasAesReady: boolean;
  refreshNonce: number;
  setLegacyPrivateRewardTokenBalanceWei: Dispatch<SetStateAction<bigint | null>>;
  setLegacyPrivateRewardTokenDecimals: Dispatch<SetStateAction<number>>;
  setLegacyPrivateRewardTokenSymbol: Dispatch<SetStateAction<string>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  swapDirection: SwapDirection;
  walletAddress: string;
};

export default function useRewardTokenMetrics({
  activeSwapVaultContractAddress,
  chainId,
  currentSwapDirectionEnabled,
  getMemoSigner,
  groupRequiredFeeCacheRef,
  groupTokenFeeCacheRef,
  hasAesReady,
  refreshNonce,
  setLegacyPrivateRewardTokenBalanceWei,
  setLegacyPrivateRewardTokenDecimals,
  setLegacyPrivateRewardTokenSymbol,
  setSessionOnboardInfo,
  swapDirection,
  walletAddress
}: UseRewardTokenMetricsArgs) {
  const {
    setGroupRewardsContractAddress,
    setGroupRewardsPaused,
    setRewardsCallerAllowed,
    setRewardsContractPaused,
    setRewardsPublicPerInteractionWei,
    setRewardsPublicReserveWei,
    setShieldVaultTokenBalanceWei,
    setRewardTokenBalanceWei,
    setPrivateRewardTokenBalanceWei,
    setRewardTokenSymbol,
    setPrivateRewardTokenSymbol,
    setRewardTokenDecimals,
    setPrivateRewardTokenDecimals,
    setSwapFeeWei,
    setSwapTokenFeeAmount,
    setLoadingRewardBalances
  } = useTokenToolsStore();

  useEffect(() => {
    let cancelled = false;

    if (!currentSwapDirectionEnabled || !activeSwapVaultContractAddress) {
      setSwapFeeWei(null);
      setSwapTokenFeeAmount(null);
      setShieldVaultTokenBalanceWei(null);
      return () => {
        cancelled = true;
      };
    }

    setSwapFeeWei(null);
    setSwapTokenFeeAmount(null);
    setShieldVaultTokenBalanceWei(null);

    const loadShieldVaultReserve = async () => {
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const isLegacyUnshield = isLegacyUnshieldDirection(swapDirection);
        const legacyVaultAbi = swapDirection === 'legacy-unshield-earlier'
          ? EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI
          : LEGACY_SWAP_VAULT_CONTRACT_ABI;
        const isBridgeUnshield = swapDirection === 'unshield';
        const swapVaultContract = new cotiEthers.Contract(
          activeSwapVaultContractAddress,
          isLegacyUnshield ? legacyVaultAbi : WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
          readProvider
        );
        const rewardSymbolRaw = await rewardTokenContract.symbol().catch(() => null);
        const rewardDecimalsRaw = await rewardTokenContract.decimals().catch(() => null);
        const swapFeeRaw = isLegacyUnshield
          ? await swapVaultContract.swapFeeWei().catch(() => null)
          : await readWispBridgeFee(swapVaultContract as ContractLike, isBridgeUnshield);
        const swapTokenFeeRaw = isLegacyUnshield
          ? await swapVaultContract.getTokenFeeAmount().catch(() => null)
          : 0n;
        const shieldVaultTokenBalanceRaw = await rewardTokenContract
          .balanceOf(activeSwapVaultContractAddress)
          .catch(() => null);

        if (cancelled) {
          return;
        }

        if (typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim()) {
          setRewardTokenSymbol(rewardSymbolRaw.trim().slice(0, 12));
        }
        if (typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint') {
          setRewardTokenDecimals(normalizeTokenDecimals(Number(rewardDecimalsRaw)));
        }
        setSwapFeeWei(typeof swapFeeRaw === 'bigint' ? swapFeeRaw : null);
        setSwapTokenFeeAmount(typeof swapTokenFeeRaw === 'bigint' ? swapTokenFeeRaw : null);
        setShieldVaultTokenBalanceWei(
          typeof shieldVaultTokenBalanceRaw === 'bigint' ? shieldVaultTokenBalanceRaw : null
        );
      } catch {
        if (!cancelled) {
          setShieldVaultTokenBalanceWei(null);
        }
      }
    };

    loadShieldVaultReserve().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activeSwapVaultContractAddress,
    currentSwapDirectionEnabled,
    setRewardTokenDecimals,
    setRewardTokenSymbol,
    setShieldVaultTokenBalanceWei,
    setSwapFeeWei,
    setSwapTokenFeeAmount,
    swapDirection,
    refreshNonce
  ]);

  useEffect(() => {
    let cancelled = false;
    const requestedWalletAddress = walletAddress.trim();

    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
      setLegacyPrivateRewardTokenBalanceWei(null);
      setGroupRewardsContractAddress('');
      setGroupRewardsPaused(null);
      setRewardsContractPaused(null);
      setRewardsCallerAllowed(null);
      setRewardsPublicPerInteractionWei(null);
      setRewardsPublicReserveWei(null);
      setLoadingRewardBalances(false);
      return;
    }

    const loadRewardBalances = async () => {
      setLoadingRewardBalances(true);
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);
        const legacyPrivateTokenContract = new cotiEthers.Contract(
          LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
          PRIVATE_TOKEN_BALANCE_ABI,
          readProvider
        );
        const groupContract = new cotiEthers.Contract(
          LEGACY_GROUP_CHAT_CONTRACT_ADDRESS,
          LEGACY_GROUP_CHAT_CONTRACT_ABI,
          readProvider
        );
        const isLegacyUnshield = isLegacyUnshieldDirection(swapDirection);
        const legacyVaultAbi = swapDirection === 'legacy-unshield-earlier'
          ? EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI
          : LEGACY_SWAP_VAULT_CONTRACT_ABI;
        const isBridgeUnshield = swapDirection === 'unshield';
        const swapVaultContract =
          currentSwapDirectionEnabled && activeSwapVaultContractAddress
            ? new cotiEthers.Contract(
                activeSwapVaultContractAddress,
                isLegacyUnshield ? legacyVaultAbi : WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
                readProvider
              )
            : null;

        const rewardBalanceRaw = await rewardTokenContract.balanceOf(requestedWalletAddress).catch(() => null);
        const rewardSymbolRaw = await rewardTokenContract.symbol().catch(() => null);
        const rewardDecimalsRaw = await rewardTokenContract.decimals().catch(() => null);
        const privateSymbolRaw = await privateTokenContract.symbol().catch(() => null);
        const privateDecimalsRaw = await privateTokenContract.decimals().catch(() => null);
        const legacyPrivateSymbolRaw = await legacyPrivateTokenContract.symbol().catch(() => null);
        const legacyPrivateDecimalsRaw = await legacyPrivateTokenContract.decimals().catch(() => null);
        const groupNativeFeeRaw = await groupContract.feeAmount().catch(() => null);
        const groupTokenFeeRaw = await groupContract.tokenFeeAmount().catch(() => null);
        const rewardsContractRaw = await groupContract.rewardsContract().catch(() => null);
        const rewardsPausedRaw = await groupContract.rewardsPaused().catch(() => null);
        const swapFeeRaw = swapVaultContract
          ? isLegacyUnshield
            ? await swapVaultContract.swapFeeWei().catch(() => null)
            : await readWispBridgeFee(swapVaultContract as ContractLike, isBridgeUnshield)
          : null;
        const swapTokenFeeRaw = swapVaultContract
          ? isLegacyUnshield
            ? await swapVaultContract.getTokenFeeAmount().catch(() => null)
            : 0n
          : null;

        let privateBalanceWei: bigint | null = null;
        let legacyPrivateBalanceWei: bigint | null = null;
        if (hasAesReady) {
          try {
            const { signer, cacheKey } = await getMemoSigner();
            privateBalanceWei = await readCurrentPrivateErc20BalanceWei(
              PRIVATE_REWARD_TOKEN_ADDRESS,
              requestedWalletAddress,
              signer
            ).catch(() => null);
            legacyPrivateBalanceWei = await readLegacyPrivateRewardBalanceWei(
              requestedWalletAddress,
              signer
            ).catch(() => null);

            const nextOnboardInfo = signer.getUserOnboardInfo();
            setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, nextOnboardInfo));
          } catch {
            privateBalanceWei = null;
            legacyPrivateBalanceWei = null;
          }
        }

        const nextRewardBalance = typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null;
        const nextGroupNativeFee = typeof groupNativeFeeRaw === 'bigint' ? groupNativeFeeRaw : null;
        const nextGroupTokenFee = typeof groupTokenFeeRaw === 'bigint' ? groupTokenFeeRaw : null;
        const nextRewardsContractAddress =
          typeof rewardsContractRaw === 'string' && isWalletAddress(rewardsContractRaw)
            ? rewardsContractRaw
            : '';
        const nextRewardsPaused = typeof rewardsPausedRaw === 'boolean' ? rewardsPausedRaw : null;
        let nextRewardsContractPaused: boolean | null = null;
        let nextRewardsCallerAllowed: boolean | null = null;
        let nextRewardsPublicPerInteractionWei: bigint | null = null;
        let nextRewardsPublicReserveWei: bigint | null = null;
        if (nextRewardsContractAddress) {
          const rewardsContract = new cotiEthers.Contract(nextRewardsContractAddress, WHISPER_REWARDS_ABI, readProvider);
          const rewardsContractPausedRaw = await rewardsContract.paused().catch(() => null);
          const rewardsCallerAllowedRaw = await rewardsContract
            .allowedInteractionContracts(LEGACY_GROUP_CHAT_CONTRACT_ADDRESS)
            .catch(() => null);
          const rewardsPublicPerInteractionRaw = await rewardsContract.publicRewardAmount().catch(() => null);
          const rewardsPublicReserveRaw = await rewardTokenContract.balanceOf(nextRewardsContractAddress).catch(() => null);
          nextRewardsContractPaused =
            typeof rewardsContractPausedRaw === 'boolean' ? rewardsContractPausedRaw : null;
          nextRewardsCallerAllowed =
            typeof rewardsCallerAllowedRaw === 'boolean' ? rewardsCallerAllowedRaw : null;
          nextRewardsPublicPerInteractionWei =
            typeof rewardsPublicPerInteractionRaw === 'bigint' ? rewardsPublicPerInteractionRaw : null;
          nextRewardsPublicReserveWei = typeof rewardsPublicReserveRaw === 'bigint' ? rewardsPublicReserveRaw : null;
        }
        const nextSwapFee = typeof swapFeeRaw === 'bigint' ? swapFeeRaw : null;
        const nextSwapTokenFee = typeof swapTokenFeeRaw === 'bigint' ? swapTokenFeeRaw : null;
        const resolvedRewardSymbol =
          typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim()
            ? rewardSymbolRaw.trim().slice(0, 12)
            : FALLBACK_REWARD_TOKEN_SYMBOL;
        const resolvedPrivateSymbol =
          typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
            ? privateSymbolRaw.trim().slice(0, 12)
            : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL;
        const resolvedLegacyPrivateSymbol =
          typeof legacyPrivateSymbolRaw === 'string' && legacyPrivateSymbolRaw.trim()
            ? legacyPrivateSymbolRaw.trim().slice(0, 12)
            : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL;
        const resolvedRewardDecimals =
          typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(rewardDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedPrivateDecimals =
          typeof privateDecimalsRaw === 'number' || typeof privateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(privateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedLegacyPrivateDecimals =
          typeof legacyPrivateDecimalsRaw === 'number' || typeof legacyPrivateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(legacyPrivateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;

        if (!cancelled) {
          setRewardTokenBalanceWei(nextRewardBalance);
          setPrivateRewardTokenBalanceWei(privateBalanceWei);
          setLegacyPrivateRewardTokenBalanceWei(legacyPrivateBalanceWei);
          setRewardTokenSymbol(resolvedRewardSymbol);
          setPrivateRewardTokenSymbol(resolvedPrivateSymbol);
          setLegacyPrivateRewardTokenSymbol(resolvedLegacyPrivateSymbol);
          setRewardTokenDecimals(resolvedRewardDecimals);
          setPrivateRewardTokenDecimals(resolvedPrivateDecimals);
          setLegacyPrivateRewardTokenDecimals(resolvedLegacyPrivateDecimals);
          setGroupRewardsContractAddress(nextRewardsContractAddress);
          setGroupRewardsPaused(nextRewardsPaused);
          setRewardsContractPaused(nextRewardsContractPaused);
          setRewardsCallerAllowed(nextRewardsCallerAllowed);
          setRewardsPublicPerInteractionWei(nextRewardsPublicPerInteractionWei);
          setRewardsPublicReserveWei(nextRewardsPublicReserveWei);
          setSwapFeeWei(nextSwapFee);
          setSwapTokenFeeAmount(nextSwapTokenFee);
          if (nextGroupNativeFee !== null) {
            groupRequiredFeeCacheRef.current = nextGroupNativeFee;
          }
          if (nextGroupTokenFee !== null) {
            groupTokenFeeCacheRef.current = nextGroupTokenFee;
          }
        }
      } catch {
        if (!cancelled) {
          setRewardTokenBalanceWei(null);
          setPrivateRewardTokenBalanceWei(null);
          setLegacyPrivateRewardTokenBalanceWei(null);
          setGroupRewardsContractAddress('');
          setGroupRewardsPaused(null);
          setRewardsContractPaused(null);
          setRewardsCallerAllowed(null);
          setRewardsPublicPerInteractionWei(null);
          setRewardsPublicReserveWei(null);
          setSwapFeeWei(null);
          setSwapTokenFeeAmount(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingRewardBalances(false);
        }
      }
    };

    loadRewardBalances().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activeSwapVaultContractAddress,
    chainId,
    currentSwapDirectionEnabled,
    getMemoSigner,
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    hasAesReady,
    setGroupRewardsContractAddress,
    setGroupRewardsPaused,
    setLegacyPrivateRewardTokenBalanceWei,
    setLegacyPrivateRewardTokenDecimals,
    setLegacyPrivateRewardTokenSymbol,
    setLoadingRewardBalances,
    setPrivateRewardTokenBalanceWei,
    setPrivateRewardTokenDecimals,
    setPrivateRewardTokenSymbol,
    setRewardTokenBalanceWei,
    setRewardTokenDecimals,
    setRewardTokenSymbol,
    setRewardsCallerAllowed,
    setRewardsContractPaused,
    setRewardsPublicPerInteractionWei,
    setRewardsPublicReserveWei,
    setSessionOnboardInfo,
    setSwapFeeWei,
    setSwapTokenFeeAmount,
    swapDirection,
    refreshNonce,
    walletAddress
  ]);
}
