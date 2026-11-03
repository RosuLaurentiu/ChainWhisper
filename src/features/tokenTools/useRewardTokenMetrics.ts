import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  readCurrentPrivateErc20BalanceWei,
} from '../../lib/appChain';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfoByAddress,
  normalizeTokenDecimals,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
  type SwapDirection
} from '../../lib/appShared';
import { useTokenToolsStore } from './tokenToolsStore';

type MemoSignerBundle = {
  cacheKey: string;
  signer: JsonRpcSigner;
};

type ContractCall = (...args: unknown[]) => Promise<unknown>;
type ContractLike = Record<string, unknown>;

async function readWispBridgeFee(contract: ContractLike, withdraw = false,
  shouldContinue = () => true): Promise<bigint | null> {
  if (!shouldContinue()) return null;
  const selector = withdraw ? 'estimateWithdrawFee(uint256)' : 'estimateDepositFee(uint256)';
  const quoteMethod = contract[selector] as ContractCall | undefined;
  const quote = quoteMethod ? await quoteMethod.call(contract, 1n).catch(() => null) : null;
  if (!shouldContinue()) return null;
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
  bridgeEnabled: boolean;
  chainId: number | null;
  currentSwapDirectionEnabled: boolean;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  hasAesReady: boolean;
  refreshNonce: number;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  swapDirection: SwapDirection;
  walletAddress: string;
};

export default function useRewardTokenMetrics({
  activeSwapVaultContractAddress,
  bridgeEnabled,
  chainId,
  currentSwapDirectionEnabled,
  getMemoSigner,
  hasAesReady,
  refreshNonce,
  setSessionOnboardInfo,
  swapDirection,
  walletAddress
}: UseRewardTokenMetricsArgs) {
  const {
    setShieldVaultTokenBalanceWei,
    setRewardTokenBalanceWei,
    setPrivateRewardTokenBalanceWei,
    setRewardTokenSymbol,
    setPrivateRewardTokenSymbol,
    setRewardTokenDecimals,
    setPrivateRewardTokenDecimals,
    setSwapFeeWei,
    setLoadingRewardBalances
  } = useTokenToolsStore();

  useEffect(() => {
    let cancelled = false;

    if (!bridgeEnabled || !currentSwapDirectionEnabled || !activeSwapVaultContractAddress) {
      setSwapFeeWei(null);
      setShieldVaultTokenBalanceWei(null);
      return () => {
        cancelled = true;
      };
    }

    setSwapFeeWei(null);
    setShieldVaultTokenBalanceWei(null);

    const loadShieldVaultReserve = async () => {
      try {
        const cotiEthers = await loadCotiEthersModule();
        if (cancelled) return;
        const readProvider = await loadCotiReadProvider(true);
        if (cancelled) return;
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const isBridgeUnshield = swapDirection === 'unshield';
        const swapVaultContract = new cotiEthers.Contract(
          activeSwapVaultContractAddress,
          WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
          readProvider
        );
        const rewardSymbolRaw = await rewardTokenContract.symbol().catch(() => null);
        if (cancelled) return;
        const rewardDecimalsRaw = await rewardTokenContract.decimals().catch(() => null);
        if (cancelled) return;
        const swapFeeRaw = await readWispBridgeFee(swapVaultContract as ContractLike, isBridgeUnshield, () => !cancelled);
        if (cancelled) return;
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
    bridgeEnabled,
    currentSwapDirectionEnabled,
    setRewardTokenDecimals,
    setRewardTokenSymbol,
    setShieldVaultTokenBalanceWei,
    setSwapFeeWei,
    swapDirection,
    refreshNonce
  ]);

  useEffect(() => {
    let cancelled = false;
    const requestedWalletAddress = walletAddress.trim();

    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
      setLoadingRewardBalances(false);
      return;
    }

    const loadRewardBalances = async () => {
      setLoadingRewardBalances(true);
      try {
        const cotiEthers = await loadCotiEthersModule();
        if (cancelled) return;
        const readProvider = await loadCotiReadProvider(true);
        if (cancelled) return;
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);
        const isBridgeUnshield = swapDirection === 'unshield';
        const swapVaultContract =
          bridgeEnabled && currentSwapDirectionEnabled && activeSwapVaultContractAddress
            ? new cotiEthers.Contract(
                activeSwapVaultContractAddress,
                WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
                readProvider
              )
            : null;

        const rewardBalanceRaw = await rewardTokenContract.balanceOf(requestedWalletAddress).catch(() => null);
        if (cancelled) return;
        const rewardSymbolRaw = await rewardTokenContract.symbol().catch(() => null);
        if (cancelled) return;
        const rewardDecimalsRaw = await rewardTokenContract.decimals().catch(() => null);
        if (cancelled) return;
        const privateSymbolRaw = await privateTokenContract.symbol().catch(() => null);
        if (cancelled) return;
        const privateDecimalsRaw = await privateTokenContract.decimals().catch(() => null);
        if (cancelled) return;
        const swapFeeRaw = swapVaultContract
          ? await readWispBridgeFee(swapVaultContract as ContractLike, isBridgeUnshield, () => !cancelled)
          : null;
        if (cancelled) return;

        let privateBalanceWei: bigint | null = null;
        if (hasAesReady) {
          try {
            const { signer, cacheKey } = await getMemoSigner();
            if (cancelled) return;
            privateBalanceWei = await readCurrentPrivateErc20BalanceWei(
              PRIVATE_REWARD_TOKEN_ADDRESS,
              requestedWalletAddress,
              signer
            ).catch(() => null);
            if (cancelled) return;
            const nextOnboardInfo = signer.getUserOnboardInfo();
            setSessionOnboardInfo((previous) => cancelled ? previous
              : mergeOnboardInfoByAddress(previous, cacheKey, nextOnboardInfo));
          } catch {
            privateBalanceWei = null;
          }
        }

        const nextRewardBalance = typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null;
        const nextSwapFee = typeof swapFeeRaw === 'bigint' ? swapFeeRaw : null;
        const resolvedRewardSymbol =
          typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim()
            ? rewardSymbolRaw.trim().slice(0, 12)
            : FALLBACK_REWARD_TOKEN_SYMBOL;
        const resolvedPrivateSymbol =
          typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
            ? privateSymbolRaw.trim().slice(0, 12)
            : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL;

        const resolvedRewardDecimals =
          typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(rewardDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedPrivateDecimals =
          typeof privateDecimalsRaw === 'number' || typeof privateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(privateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;


        if (!cancelled) {
          setRewardTokenBalanceWei(nextRewardBalance);
          setPrivateRewardTokenBalanceWei(privateBalanceWei);
          setRewardTokenSymbol(resolvedRewardSymbol);
          setPrivateRewardTokenSymbol(resolvedPrivateSymbol);
          setRewardTokenDecimals(resolvedRewardDecimals);
          setPrivateRewardTokenDecimals(resolvedPrivateDecimals);
          setSwapFeeWei(nextSwapFee);
        }
      } catch {
        if (!cancelled) {
          setRewardTokenBalanceWei(null);
          setPrivateRewardTokenBalanceWei(null);
          setSwapFeeWei(null);
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
    bridgeEnabled,
    chainId,
    currentSwapDirectionEnabled,
    getMemoSigner,
    hasAesReady,
    setLoadingRewardBalances,
    setPrivateRewardTokenBalanceWei,
    setPrivateRewardTokenDecimals,
    setPrivateRewardTokenSymbol,
    setRewardTokenBalanceWei,
    setRewardTokenDecimals,
    setRewardTokenSymbol,
    setSessionOnboardInfo,
    setSwapFeeWei,
    swapDirection,
    refreshNonce,
    walletAddress
  ]);
}
