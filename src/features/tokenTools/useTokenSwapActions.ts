import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  formatCotiAmount,
  formatTokenAmount,
  getProviderErrorMessage,
  isWalletAddress,
  LEGACY_SWAP_VAULT_CONTRACT_ABI,
  loadCotiEthersModule,
  mergeOnboardInfoByAddress,
  parseTokenAmountInput,
  type SwapDirection
} from '../../lib/appShared';
import { executeChainWhisperWispBridgeConversion } from '../../lib/appChain';
import { normalizePrivacyPortalError } from '../../lib/privacyPortal';
import { useTokenToolsStore } from './tokenToolsStore';

type MemoSignerBundle = {
  cacheKey: string;
  signer: Wallet | JsonRpcSigner;
};

type UseTokenSwapActionsArgs = {
  activeSwapVaultContractAddress: string;
  currentSwapDirectionEnabled: boolean;
  getSwapSigner: () => Promise<MemoSignerBundle>;
  onCotiNetwork: boolean;
  runSwapTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setError: Dispatch<SetStateAction<string>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTopUpMetricsNonce: Dispatch<SetStateAction<number>>;
  swapAmountInput: string;
  swapDirection: SwapDirection;
  swapFeeWei: bigint | null;
  swapInputDecimals: number;
  swapInputSymbol: string;
  swapPrivateRewardTokenBalanceWei: bigint | null;
  swapPrivateRewardTokenDecimals: number;
  swapPrivateRewardTokenSymbol: string;
  swapTokenFeeAmount: bigint | null;
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
  setTopUpMetricsNonce,
  swapAmountInput,
  swapDirection,
  swapFeeWei,
  swapInputDecimals,
  swapInputSymbol,
  swapPrivateRewardTokenBalanceWei,
  swapPrivateRewardTokenDecimals,
  swapPrivateRewardTokenSymbol,
  swapTokenFeeAmount,
  walletAddress
}: UseTokenSwapActionsArgs) {
  const {
    setSwapAmountInput,
    setSwapActionStage,
    setSwapFeeWei,
    setSwapStatusMessage,
    setSwapTokenFeeAmount,
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
          : swapDirection === 'unshield'
            ? 'Current pWISP unshield is paused.'
            : 'Legacy unshield is unavailable.'
      );
      return;
    }

    const amount = parseTokenAmountInput(swapAmountInput, swapInputDecimals);
    if (amount === null || amount <= 0n) {
      setError(`Enter a valid ${swapInputSymbol} amount.`);
      return;
    }
    const isLegacyUnshield = swapDirection === 'legacy-unshield';
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
    }

    try {
      setSwappingTokens(true);
      await runSwapTransactionFlow(async () => {
        const { signer, cacheKey } = await getSwapSigner();
        let resolvedSwapFeeWei = 0n;

        if (!isLegacyUnshield) {
          const result = await executeChainWhisperWispBridgeConversion({
            signer,
            ownerAddress: requestedWalletAddress,
            direction: isBridgeUnshield ? 'unshield' : 'shield',
            amountWei: amount,
            onProgress: setSwapActionStage
          });
          resolvedSwapFeeWei = result.quote.feeWei;
          setSwapFeeWei(resolvedSwapFeeWei);
          setSwapTokenFeeAmount(0n);
          setSwapTransactionHash(result.transactionHash);
        } else {
          setSwapActionStage('validating');
          const cotiEthers = await loadCotiEthersModule();
          const swapContract = new cotiEthers.Contract(
            activeSwapVaultContractAddress,
            LEGACY_SWAP_VAULT_CONTRACT_ABI,
            signer
          );
          setSwapActionStage('refreshing-quote');
          const [legacyFeeWei, legacyTokenFee] = (await Promise.all([
            swapFeeWei !== null ? Promise.resolve(swapFeeWei) : swapContract.swapFeeWei(),
            swapTokenFeeAmount !== null
              ? Promise.resolve(swapTokenFeeAmount)
              : swapContract.getTokenFeeAmount()
          ])) as [bigint, bigint];
          resolvedSwapFeeWei = legacyFeeWei;
          setSwapFeeWei(legacyFeeWei);
          setSwapTokenFeeAmount(legacyTokenFee);
          setSwapActionStage('awaiting-conversion');
          const transaction = await swapContract.unshieldWithMode(amount, 1, { value: legacyFeeWei });
          setSwapTransactionHash(String(transaction.hash ?? ''));
          setSwapActionStage('confirming');
          const receipt = await transaction.wait();
          if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
            throw new Error('Legacy pWISP recovery failed on-chain.');
          }
          setSwapActionStage('complete');
        }

        try {
          const nextOnboardInfo = signer.getUserOnboardInfo();
          setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, nextOnboardInfo));
        } catch {
          // The confirmed receipt remains authoritative if the selected account changes afterward.
        }

        setSwapAmountInput('');
        setTopUpMetricsNonce((previous) => previous + 1);
        const swapDirectionStatus = swapDirection === 'shield' ? 'Moved WISP to pWISP.' : 'Moved pWISP to WISP.';
        const feeStatus =
          resolvedSwapFeeWei > 0n ? ` Fee paid with COTI (${formatCotiAmount(resolvedSwapFeeWei)} COTI).` : '';
        const legacyStatus = isLegacyUnshield ? ' Legacy recovery route used.' : '';
        setSwapStatusMessage(`${swapDirectionStatus}${feeStatus}${legacyStatus}`);
      });
    } catch (swapError) {
      const message = isLegacyUnshield
        ? getProviderErrorMessage(swapError, 'Legacy pWISP recovery failed.')
        : normalizePrivacyPortalError(swapError).message;
      setError(message);
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
    setSwapTokenFeeAmount,
    setSwapTransactionHash,
    setSwappingTokens,
    setTopUpMetricsNonce,
    swapAmountInput,
    swapDirection,
    swapFeeWei,
    swapInputDecimals,
    swapInputSymbol,
    swapPrivateRewardTokenBalanceWei,
    swapPrivateRewardTokenDecimals,
    swapPrivateRewardTokenSymbol,
    swapTokenFeeAmount,
    walletAddress
  ]);

  return { swapRewardTokens };
}
