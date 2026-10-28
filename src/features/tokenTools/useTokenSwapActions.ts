import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  formatCotiAmount,
  formatTokenAmount,
  EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ADDRESS,
  EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI,
  EARLIER_LEGACY_SWAP_VAULT_RUNTIME_HASH,
  getProviderErrorMessage,
  isWalletAddress,
  LEGACY_SWAP_VAULT_CONTRACT_ABI,
  LEGACY_SWAP_VAULT_CONTRACT_ADDRESS,
  LEGACY_SWAP_VAULT_RUNTIME_HASH,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfoByAddress,
  parseTokenAmountInput,
  type SwapDirection
} from '../../lib/appShared';
import { executeChainWhisperWispBridgeConversion } from '../../lib/appChain';
import { normalizePrivacyPortalError } from '../../lib/privacyPortal';
import { waitForPublicTransactionReceipt } from '../../lib/publicTransactionReceipt';
import { useTokenToolsStore } from './tokenToolsStore';
import { isLegacyUnshieldDirection, resolveLegacyRecoverySpendableAmount } from './tokenSwapView';

type MemoSignerBundle = {
  cacheKey: string;
  signer: JsonRpcSigner;
};

type LegacyWispRecoveryContract = {
  unshield?: (amount: bigint, overrides: { value: bigint }) => Promise<unknown>;
  unshieldWithMode?: (
    amount: bigint,
    paymentMode: number,
    overrides: { value: bigint }
  ) => Promise<unknown>;
};

export const submitLegacyWispRecoveryTransaction = async ({
  amountWei,
  contract,
  direction,
  nativeFeeWei
}: {
  amountWei: bigint;
  contract: LegacyWispRecoveryContract;
  direction: SwapDirection;
  nativeFeeWei: bigint;
}): Promise<unknown> => {
  if (direction === 'legacy-unshield-earlier') {
    if (typeof contract.unshield !== 'function') {
      throw new Error('Earlier legacy vault unshield method is unavailable.');
    }
    return contract.unshield(amountWei, { value: nativeFeeWei });
  }
  if (direction !== 'legacy-unshield' || typeof contract.unshieldWithMode !== 'function') {
    throw new Error('Legacy vault recovery method is unavailable.');
  }
  return contract.unshieldWithMode(amountWei, 1, { value: nativeFeeWei });
};

export const assertLegacyWispRecoveryDeployment = ({
  contractAddress,
  direction,
  runtimeHash
}: {
  contractAddress: string;
  direction: SwapDirection;
  runtimeHash: string;
}): void => {
  const earlier = direction === 'legacy-unshield-earlier';
  const expectedAddress = earlier
    ? EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ADDRESS
    : LEGACY_SWAP_VAULT_CONTRACT_ADDRESS;
  const expectedRuntimeHash = earlier
    ? EARLIER_LEGACY_SWAP_VAULT_RUNTIME_HASH
    : LEGACY_SWAP_VAULT_RUNTIME_HASH;
  if (
    !isLegacyUnshieldDirection(direction) ||
    contractAddress.toLowerCase() !== expectedAddress.toLowerCase() ||
    runtimeHash.toLowerCase() !== expectedRuntimeHash.toLowerCase()
  ) {
    throw new Error('Legacy pWISP recovery contract verification failed. No transaction was submitted.');
  }
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
  setWalletBalanceRefreshNonce,
  shieldVaultTokenBalanceWei,
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
    const isLegacyUnshield = isLegacyUnshieldDirection(swapDirection);
    const isEarlierLegacyUnshield = swapDirection === 'legacy-unshield-earlier';
    const isBridgeUnshield = swapDirection === 'unshield';
    if (isLegacyUnshield && (swapFeeWei === null || swapTokenFeeAmount === null)) {
      setError('Wait for the selected legacy vault fee and liquidity to load, then try again.');
      return;
    }
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
      const spendableBalanceWei = resolveLegacyRecoverySpendableAmount({
        balanceWei: swapPrivateRewardTokenBalanceWei,
        direction: swapDirection,
        tokenFeeWei: swapTokenFeeAmount
      });
      if (isEarlierLegacyUnshield && amount > spendableBalanceWei) {
        setError(
          `The earlier vault takes its ${formatTokenAmount(
            swapTokenFeeAmount ?? 0n,
            swapPrivateRewardTokenDecimals,
            6
          )} ${swapPrivateRewardTokenSymbol} fee before the recovery amount. Reduce the amount or use the newer legacy vault.`
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
          )} ${swapInputSymbol} of WISP liquidity. Reduce the amount or select the other legacy vault.`
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
          const readProvider = await loadCotiReadProvider(true);
          const runtimeCode = await readProvider.getCode(activeSwapVaultContractAddress);
          assertLegacyWispRecoveryDeployment({
            contractAddress: activeSwapVaultContractAddress,
            direction: swapDirection,
            runtimeHash: cotiEthers.keccak256(runtimeCode)
          });
          const swapContract = new cotiEthers.Contract(
            activeSwapVaultContractAddress,
            isEarlierLegacyUnshield
              ? EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI
              : LEGACY_SWAP_VAULT_CONTRACT_ABI,
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
          const transaction = await submitLegacyWispRecoveryTransaction({
            amountWei: amount,
            contract: swapContract as unknown as LegacyWispRecoveryContract,
            direction: swapDirection,
            nativeFeeWei: legacyFeeWei
          }) as { hash?: unknown };
          const transactionHash = String(transaction.hash ?? '').toLowerCase();
          if (!/^0x[0-9a-f]{64}$/u.test(transactionHash)) {
            throw new Error('Legacy pWISP recovery returned an invalid transaction hash.');
          }
          setSwapTransactionHash(transactionHash);
          setSwapActionStage('confirming');
          const receipt = await waitForPublicTransactionReceipt({
            transactionHash,
            label: 'Legacy pWISP recovery',
            timeoutMs: 180_000
          });
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
        setWalletBalanceRefreshNonce((previous) => previous + 1);
        const swapDirectionStatus = swapDirection === 'shield' ? 'Moved WISP to pWISP.' : 'Moved pWISP to WISP.';
        const feeStatus = resolvedSwapFeeWei > 0n
          ? isEarlierLegacyUnshield
            ? ' The earlier vault selected its configured pWISP, WISP, or COTI fee path on-chain.'
            : ` Fee paid with COTI (${formatCotiAmount(resolvedSwapFeeWei)} COTI).`
          : '';
        const legacyStatus = isLegacyUnshield
          ? isEarlierLegacyUnshield
            ? ' Earlier legacy vault used.'
            : ' Legacy recovery route used.'
          : '';
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
    setWalletBalanceRefreshNonce,
    shieldVaultTokenBalanceWei,
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
