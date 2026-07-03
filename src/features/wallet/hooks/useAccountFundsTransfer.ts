import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { useCallback, useState } from 'react';
import {
  getProviderErrorMessage,
  isWalletAddress
} from '../../../lib/appShared';
import { transferWalletFundAsset } from '../../../lib/walletFunds';
import type {
  AccountFundsDirection,
  AccountFundsSubmitRequest
} from '../components/AccountFundsModal';

type UseAccountFundsTransferArgs = {
  burnerAddress: string;
  getChainWhisperFundsSigner: (requirePrivacy: boolean) => Promise<Wallet>;
  getOwnerFundsSigner: (requirePrivacy: boolean) => Promise<JsonRpcSigner>;
  onRefreshBalances: () => void;
  ownerWalletAddress: string;
  runOwnerFundsTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  runSharedWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
};

export default function useAccountFundsTransfer({
  burnerAddress,
  getChainWhisperFundsSigner,
  getOwnerFundsSigner,
  onRefreshBalances,
  ownerWalletAddress,
  runOwnerFundsTransactionFlow,
  runSharedWalletTransactionFlow,
  setError,
  setStatus
}: UseAccountFundsTransferArgs) {
  const [accountFundsDirection, setAccountFundsDirection] = useState<AccountFundsDirection | null>(null);
  const [accountFundsProcessing, setAccountFundsProcessing] = useState(false);

  const openAccountFundsModal = useCallback((direction: AccountFundsDirection) => {
    setAccountFundsDirection(direction);
  }, []);

  const requestChainWhisperFundingAfterError = useCallback(
    (message: string) => {
      setError(`${message} Move funds from the owner wallet to ChainWhisper, then try again.`);
      openAccountFundsModal('move');
    },
    [openAccountFundsModal, setError]
  );

  const closeAccountFundsModal = useCallback(() => {
    if (!accountFundsProcessing) {
      setAccountFundsDirection(null);
    }
  }, [accountFundsProcessing]);

  const clearAccountFundsModal = useCallback(() => {
    setAccountFundsDirection(null);
  }, []);

  const submitAccountFundsTransfer = useCallback(
    async ({ amountWei, asset, direction }: AccountFundsSubmitRequest) => {
      setAccountFundsProcessing(true);
      try {
        const toAddress = direction === 'move' ? burnerAddress : ownerWalletAddress;
        if (!toAddress || !isWalletAddress(toAddress)) {
          throw new Error(direction === 'move' ? 'Set up the ChainWhisper account first.' : 'Connect the owner wallet first.');
        }

        const transfer = async () => {
          const signer =
            direction === 'move'
              ? await getOwnerFundsSigner(asset.kind === 'private-erc20')
              : await getChainWhisperFundsSigner(asset.kind === 'private-erc20');
          await transferWalletFundAsset({
            amountWei,
            asset,
            signer,
            toAddress
          });
        };

        setStatus(direction === 'move' ? 'Moving funds...' : 'Withdrawing funds...');
        if (direction === 'move') {
          await runOwnerFundsTransactionFlow(transfer);
          setStatus('Funds moved to ChainWhisper.');
        } else {
          await runSharedWalletTransactionFlow(transfer);
          setStatus('Funds withdrawn to owner wallet.');
        }
        onRefreshBalances();
        setAccountFundsDirection(null);
      } catch (fundsError) {
        const fallbackMessage = direction === 'move' ? 'Move funds failed.' : 'Withdrawal failed.';
        setError(getProviderErrorMessage(fundsError, fallbackMessage));
        throw fundsError;
      } finally {
        setAccountFundsProcessing(false);
      }
    },
    [
      burnerAddress,
      getChainWhisperFundsSigner,
      getOwnerFundsSigner,
      onRefreshBalances,
      ownerWalletAddress,
      runOwnerFundsTransactionFlow,
      runSharedWalletTransactionFlow,
      setError,
      setStatus
    ]
  );

  return {
    accountFundsDirection,
    accountFundsProcessing,
    clearAccountFundsModal,
    closeAccountFundsModal,
    openAccountFundsModal,
    requestChainWhisperFundingAfterError,
    submitAccountFundsTransfer
  };
}
