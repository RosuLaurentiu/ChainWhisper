import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  formatCotiAmount,
  formatTokenAmount,
  isWalletAddress,
  mergeOnboardInfoByAddress,
  parseTokenAmountInput,
  type SwapDirection
} from '../../lib/appShared';
import { executeChainWhisperWispBridgeConversion } from '../../lib/appChain';
import { normalizePrivacyPortalError } from '../../lib/privacyPortal';
import { useTokenToolsStore } from './tokenToolsStore';

type MemoSignerBundle = {
  cacheKey: string;
  signer: JsonRpcSigner;
};

type UseTokenSwapActionsArgs = {
  activeSwapVaultContractAddress: string;
  currentSwapDirectionEnabled: boolean;
  getSwapSigner: () => Promise<MemoSignerBundle>;
  onCotiNetwork: boolean;
  runSwapTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setError: Dispatch<SetStateAction<string>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setWalletBalanceRefreshNonce: Dispatch<SetStateAction<number>>;
  shieldVaultTokenBalanceWei: bigint | null;
  swapAmountInput: string;
  swapDirection: SwapDirection;
  swapInputDecimals: number;
  swapInputSymbol: string;
  swapPrivateRewardTokenBalanceWei: bigint | null;
  swapPrivateRewardTokenDecimals: number;
  swapPrivateRewardTokenSymbol: string;
  walletAddress: string;
};

export default function useTokenSwapActions({
  activeSwapVaultContractAddress,
  currentSwapDirectionEnabled,
  getSwapSigner,
  onCotiNetwork,
  runSwapTransactionFlow,
  setError,
  setSessionOnboardInfo,
  setWalletBalanceRefreshNonce,
  shieldVaultTokenBalanceWei,
  swapAmountInput,
  swapDirection,
  swapInputDecimals,
  swapInputSymbol,
  swapPrivateRewardTokenBalanceWei,
  swapPrivateRewardTokenDecimals,
  swapPrivateRewardTokenSymbol,
  walletAddress
}: UseTokenSwapActionsArgs) {
  const {
    setSwapAmountInput,
    setSwapActionStage,
    setSwapFeeWei,
    setSwapStatusMessage,
    setSwapTransactionHash,
    setSwappingTokens
  } = useTokenToolsStore();

  const swapRewardTokens = useCallback(async () => {
    setError('');
    setSwapStatusMessage('');
    setSwapActionStage(null);
    setSwapTransactionHash('');

    const requestedWalletAddress = walletAddress.trim();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }
    if (!onCotiNetwork) {
      setError('Switch to the COTI network first.');
      return;
    }
    if (!currentSwapDirectionEnabled || !activeSwapVaultContractAddress) {
      setError(
        swapDirection === 'shield'
          ? 'New WISP shielding is unavailable.'
          : 'Current pWISP unshield is paused.'
      );
      return;
    }

    const amount = parseTokenAmountInput(swapAmountInput, swapInputDecimals);
    if (amount === null || amount <= 0n) {
      setError(`Enter a valid ${swapInputSymbol} amount.`);
      return;
    }
    if (swapDirection !== 'shield' && swapDirection !== 'unshield') {
      setError('The selected WISP conversion direction is unavailable.');
      return;
    }
    const isBridgeUnshield = swapDirection === 'unshield';
    if (swapDirection !== 'shield') {
      if (swapPrivateRewardTokenBalanceWei === null) {
        setError(`Unable to read ${swapPrivateRewardTokenSymbol} balance. Wait for balances to load and try again.`);
        return;
      }
      if (swapPrivateRewardTokenBalanceWei < amount) {
        setError(
          `Insufficient ${swapPrivateRewardTokenSymbol} balance. Available ${formatTokenAmount(
            swapPrivateRewardTokenBalanceWei,
            swapPrivateRewardTokenDecimals,
            6
          )}, requested ${formatTokenAmount(amount, swapPrivateRewardTokenDecimals, 6)}.`
        );
        return;
      }
      if (shieldVaultTokenBalanceWei === null) {
        setError('Unable to verify the selected vault liquidity. Refresh and try again.');
        return;
      }
      if (amount > shieldVaultTokenBalanceWei) {
        setError(
          `The selected vault has ${formatTokenAmount(
            shieldVaultTokenBalanceWei,
            swapPrivateRewardTokenDecimals,
            6
          )} ${swapInputSymbol} of WISP liquidity. Reduce the amount.`
        );
        return;
      }
    }

    try {
      setSwappingTokens(true);
      await runSwapTransactionFlow(async () => {
        const { signer, cacheKey } = await getSwapSigner();
        const result = await executeChainWhisperWispBridgeConversion({
          signer,
          ownerAddress: requestedWalletAddress,
          direction: isBridgeUnshield ? 'unshield' : 'shield',
          amountWei: amount,
          onProgress: setSwapActionStage
        });
        const resolvedSwapFeeWei = result.quote.feeWei;
        setSwapFeeWei(resolvedSwapFeeWei);
        setSwapTransactionHash(result.transactionHash);

        try {
          const nextOnboardInfo = signer.getUserOnboardInfo();
          setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, nextOnboardInfo));
        } catch {
          // The confirmed receipt remains authoritative if the selected account changes afterward.
        }

        setSwapAmountInput('');
        setWalletBalanceRefreshNonce((previous) => previous + 1);
        const swapDirectionStatus = swapDirection === 'shield' ? 'Moved WISP to pWISP.' : 'Moved pWISP to WISP.';
        const feeStatus = resolvedSwapFeeWei > 0n
          ? ` Fee paid with COTI (${formatCotiAmount(resolvedSwapFeeWei)} COTI).`
          : '';
        setSwapStatusMessage(`${swapDirectionStatus}${feeStatus}`);
      });
    } catch (swapError) {
      setError(normalizePrivacyPortalError(swapError).message);
      setSwapStatusMessage('');
      setSwapActionStage(null);
    } finally {
      setSwappingTokens(false);
    }
  }, [
    activeSwapVaultContractAddress,
    currentSwapDirectionEnabled,
    getSwapSigner,
    onCotiNetwork,
    runSwapTransactionFlow,
    setError,
    setSessionOnboardInfo,
    setSwapAmountInput,
    setSwapActionStage,
    setSwapFeeWei,
    setSwapStatusMessage,
    setSwapTransactionHash,
    setSwappingTokens,
    setWalletBalanceRefreshNonce,
    shieldVaultTokenBalanceWei,
    swapAmountInput,
    swapDirection,
    swapInputDecimals,
    swapInputSymbol,
    swapPrivateRewardTokenBalanceWei,
    swapPrivateRewardTokenDecimals,
    swapPrivateRewardTokenSymbol,
    walletAddress
  ]);

  return { swapRewardTokens };
}
