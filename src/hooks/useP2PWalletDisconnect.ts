import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import type { Eip1193Provider } from '../lib/appShared';
import { clearFallbackAesSessionOnboardInfo } from '../lib/cotiAesUnlock';
import { clearWalletTransactionFlow } from '../lib/walletTransactionFlow';

type CachedTradeSigner = JsonRpcSigner | Wallet;

type UseP2PWalletDisconnectArgs = {
  burnerWalletRef: MutableRefObject<Wallet | null>;
  clearMyTrades: () => void;
  clearWalletBalances: () => void;
  onDisconnectWallet?: () => Promise<void> | void;
  providerRef: MutableRefObject<Eip1193Provider | null>;
  selectedSharedWalletAddress?: string;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setConnectedWalletLabel: Dispatch<SetStateAction<string>>;
  setSelectedBurnerWalletId: Dispatch<SetStateAction<string>>;
  setSelectedWalletId: Dispatch<SetStateAction<string>>;
  setSkippedSharedWalletKey: (walletKey: string) => void;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  setWalletAddress: Dispatch<SetStateAction<string>>;
  setWalletError: Dispatch<SetStateAction<string>>;
  signerCacheRef: MutableRefObject<Record<string, CachedTradeSigner>>;
  walletAddress: string;
  walletStatusStorageKey: string;
};

export default function useP2PWalletDisconnect({
  burnerWalletRef,
  clearMyTrades,
  clearWalletBalances,
  onDisconnectWallet,
  providerRef,
  selectedSharedWalletAddress,
  setChainId,
  setConnectedWalletLabel,
  setSelectedBurnerWalletId,
  setSelectedWalletId,
  setSkippedSharedWalletKey,
  setTradeActionError,
  setWalletAddress,
  setWalletError,
  signerCacheRef,
  walletAddress,
  walletStatusStorageKey
}: UseP2PWalletDisconnectArgs): () => Promise<void> {
  return useCallback(async () => {
    const currentProvider = providerRef.current;
    const skippedWalletKey =
      walletAddress.trim().toLowerCase() || selectedSharedWalletAddress?.trim().toLowerCase() || '';

    setSkippedSharedWalletKey(skippedWalletKey);
    providerRef.current = null;
    burnerWalletRef.current = null;
    signerCacheRef.current = {};
    if (walletAddress) {
      clearFallbackAesSessionOnboardInfo(walletAddress, currentProvider);
      clearWalletTransactionFlow({ provider: currentProvider, walletAddress });
    }
    setWalletAddress('');
    setChainId(null);
    setConnectedWalletLabel('Wallet');
    setSelectedWalletId('');
    setSelectedBurnerWalletId('');
    setWalletError('');
    setTradeActionError('');
    clearWalletBalances();
    clearMyTrades();

    try {
      window.localStorage.removeItem(walletStatusStorageKey);
    } catch {
    }

    if (onDisconnectWallet) {
      try {
        await onDisconnectWallet();
      } catch {
      }
      return;
    }

    try {
      await currentProvider?.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }]
      });
    } catch {
      // Some injected wallets do not support revoking permissions.
    }
  }, [
    burnerWalletRef,
    clearMyTrades,
    clearWalletBalances,
    onDisconnectWallet,
    providerRef,
    selectedSharedWalletAddress,
    setChainId,
    setConnectedWalletLabel,
    setSelectedBurnerWalletId,
    setSelectedWalletId,
    setSkippedSharedWalletKey,
    setTradeActionError,
    setWalletAddress,
    setWalletError,
    signerCacheRef,
    walletAddress,
    walletStatusStorageKey
  ]);
}
