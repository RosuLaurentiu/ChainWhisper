import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  WISP_BRIDGE_PRIVATE_TOKEN_APPROVAL_GAS_LIMIT,
  WISP_BRIDGE_WRITE_GAS_LIMIT
} from '../../app/appHelpers';
import {
  ERC20_TOKEN_ABI,
  formatCotiAmount,
  formatTokenAmount,
  getProviderErrorMessage,
  isWalletAddress,
  LEGACY_SWAP_VAULT_CONTRACT_ABI,
  loadCotiEthersModule,
  mergeOnboardInfo,
  parseTokenAmountInput,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
  type SwapDirection
} from '../../lib/appShared';
import { useTokenToolsStore } from './tokenToolsStore';

type MemoSignerBundle = {
  cacheKey: string;
  signer: Wallet | JsonRpcSigner;
};

type UseTokenSwapActionsArgs = {
  activeSwapVaultContractAddress: string;
  currentSwapDirectionEnabled: boolean;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  onCotiNetwork: boolean;
  runSharedWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
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
  getMemoSigner,
  onCotiNetwork,
  runSharedWalletTransactionFlow,
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
    setSwapFeeWei,
    setSwapStatusMessage,
    setSwapTokenFeeAmount,
    setSwappingTokens
  } = useTokenToolsStore();

  const swapRewardTokens = useCallback(async () => {
    setError('');
    setSwapStatusMessage('');

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
          ? 'WISP Portal deposits are paused.'
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
      await runSharedWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        const cotiEthers = await loadCotiEthersModule();
        const swapContract = new cotiEthers.Contract(
          activeSwapVaultContractAddress,
          isLegacyUnshield ? LEGACY_SWAP_VAULT_CONTRACT_ABI : WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
          signer
        );
        const publicTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, signer);
        const [resolvedSwapFeeWei, resolvedSwapTokenFee] = (await Promise.all([
          swapFeeWei !== null
            ? Promise.resolve(swapFeeWei)
            : isLegacyUnshield
              ? swapContract.swapFeeWei()
              : swapContract.nativeCotiFee(),
          isLegacyUnshield
            ? swapTokenFeeAmount !== null
              ? Promise.resolve(swapTokenFeeAmount)
              : swapContract.getTokenFeeAmount()
            : Promise.resolve(0n)
        ])) as [bigint, bigint];
        setSwapFeeWei(resolvedSwapFeeWei);
        setSwapTokenFeeAmount(resolvedSwapTokenFee);

        if (swapDirection === 'shield') {
          const allowance = (await publicTokenContract.allowance(
            requestedWalletAddress,
            activeSwapVaultContractAddress
          )) as bigint;
          if (allowance < amount) {
            const approveTx = await publicTokenContract.approve(activeSwapVaultContractAddress, amount);
            await approveTx.wait();
          }
          const tx = await swapContract.deposit(amount, {
            value: resolvedSwapFeeWei,
            gasLimit: WISP_BRIDGE_WRITE_GAS_LIMIT
          });
          await tx.wait();
        } else if (swapDirection === 'unshield') {
          const privateTokenContract = new cotiEthers.Contract(
            PRIVATE_REWARD_TOKEN_ADDRESS,
            PRIVATE_ERC20_TOKEN_VNEXT_ABI,
            signer
          );
          const approvePrivatePlainAmount = privateTokenContract['approve(address,uint256)'] as (
            spender: string,
            amountWei: bigint,
            overrides?: { gasLimit: bigint }
          ) => Promise<{ wait: () => Promise<unknown> }>;
          const resetApprovalTx = await approvePrivatePlainAmount(activeSwapVaultContractAddress, 0n, {
            gasLimit: WISP_BRIDGE_PRIVATE_TOKEN_APPROVAL_GAS_LIMIT
          });
          await resetApprovalTx.wait();
          const approveTx = await approvePrivatePlainAmount(activeSwapVaultContractAddress, amount, {
            gasLimit: WISP_BRIDGE_PRIVATE_TOKEN_APPROVAL_GAS_LIMIT
          });
          await approveTx.wait();
          const tx = await swapContract.withdraw(amount, {
            value: resolvedSwapFeeWei,
            gasLimit: WISP_BRIDGE_WRITE_GAS_LIMIT
          });
          await tx.wait();
        } else {
          const tx = await swapContract.unshieldWithMode(amount, 1, { value: resolvedSwapFeeWei });
          await tx.wait();
        }

        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));

        setSwapAmountInput('');
        setTopUpMetricsNonce((previous) => previous + 1);
        const swapDirectionStatus = swapDirection === 'shield' ? 'Swapped to private token.' : 'Swapped to public token.';
        const feeStatus =
          resolvedSwapFeeWei > 0n ? ` Fee paid with COTI (${formatCotiAmount(resolvedSwapFeeWei)} COTI).` : '';
        const legacyStatus = isLegacyUnshield ? ' Legacy route used for old pWISP.' : '';
        setSwapStatusMessage(`${swapDirectionStatus}${feeStatus}${legacyStatus}`);
      });
    } catch (swapError) {
      const message = getProviderErrorMessage(swapError, 'Swap failed.');
      setError(message);
      setSwapStatusMessage('');
    } finally {
      setSwappingTokens(false);
    }
  }, [
    activeSwapVaultContractAddress,
    currentSwapDirectionEnabled,
    getMemoSigner,
    onCotiNetwork,
    runSharedWalletTransactionFlow,
    setError,
    setSessionOnboardInfo,
    setSwapAmountInput,
    setSwapFeeWei,
    setSwapStatusMessage,
    setSwapTokenFeeAmount,
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
