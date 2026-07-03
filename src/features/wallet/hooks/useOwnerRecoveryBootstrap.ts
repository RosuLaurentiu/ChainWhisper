import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  CW_PROFILE_REGISTRY_CONTRACT_ADDRESS,
  parseBurnerWalletStorageState,
  type BurnerInitMode
} from '../../../lib/appShared';
import {
  resolveOwnerLocalAccountAutoConnectAttemptKey,
  resolveOwnerRecoveryAutoConnectAttemptKey
} from '../../../lib/walletSession';

type UseOwnerRecoveryBootstrapArgs = {
  allowStartupWalletRestore: boolean;
  beginBurnerPinFlow: (mode: BurnerInitMode) => Promise<unknown>;
  bootstrapOwnerLinkedAccount: (args: { ownerAddress: string; ownerAesKey: string }) => Promise<unknown>;
  burnerWalletRef: MutableRefObject<Wallet | null>;
  chainId: number | null;
  connectingMethod: 'metamask' | null;
  initializingBurner: boolean;
  ownerAesKey: string;
  ownerAesReady: boolean;
  ownerWalletAddress: string;
  recoveringAppWallet: boolean;
  showBurnerImportModal: boolean;
  showBurnerPinModal: boolean;
};

export default function useOwnerRecoveryBootstrap({
  allowStartupWalletRestore,
  beginBurnerPinFlow,
  bootstrapOwnerLinkedAccount,
  burnerWalletRef,
  chainId,
  connectingMethod,
  initializingBurner,
  ownerAesKey,
  ownerAesReady,
  ownerWalletAddress,
  recoveringAppWallet,
  showBurnerImportModal,
  showBurnerPinModal
}: UseOwnerRecoveryBootstrapArgs) {
  const ownerLocalAccountAutoConnectAttemptRef = useRef('');
  const ownerRecoveryAutoConnectAttemptRef = useRef('');
  const [ownerRecoveryAttemptNonce, setOwnerRecoveryAttemptNonce] = useState(0);

  const resetOwnerRecoveryAttempt = useCallback(() => {
    ownerLocalAccountAutoConnectAttemptRef.current = '';
    ownerRecoveryAutoConnectAttemptRef.current = '';
    setOwnerRecoveryAttemptNonce((previous) => previous + 1);
  }, []);

  const bootstrapOwnerRecoveryOnce = useCallback(
    async (ownerAddress: string, aesKey: string) => {
      const ownerKey = ownerAddress.trim().toLowerCase();
      const normalizedAesKey = aesKey.trim();
      if (!ownerKey || !normalizedAesKey || burnerWalletRef.current) {
        return;
      }

      const bootstrapAttemptKey = resolveOwnerRecoveryAutoConnectAttemptKey({
        attemptNonce: ownerRecoveryAttemptNonce,
        chainId,
        hasAesReady: Boolean(normalizedAesKey),
        initializing: false,
        ownerAddress,
        ownerAesKey: normalizedAesKey,
        recoveryConfigured: Boolean(CW_PROFILE_REGISTRY_CONTRACT_ADDRESS),
        registryAddress: CW_PROFILE_REGISTRY_CONTRACT_ADDRESS
      });
      if (!bootstrapAttemptKey || ownerRecoveryAutoConnectAttemptRef.current === bootstrapAttemptKey) {
        return;
      }

      ownerRecoveryAutoConnectAttemptRef.current = bootstrapAttemptKey;
      await bootstrapOwnerLinkedAccount({
        ownerAddress,
        ownerAesKey: normalizedAesKey
      });
    },
    [bootstrapOwnerLinkedAccount, burnerWalletRef, chainId, ownerRecoveryAttemptNonce]
  );

  useEffect(() => {
    if (
      !allowStartupWalletRestore ||
      chainId !== COTI_NETWORK.chainIdDecimal ||
      !ownerWalletAddress ||
      connectingMethod !== null ||
      initializingBurner ||
      recoveringAppWallet ||
      showBurnerPinModal ||
      showBurnerImportModal ||
      burnerWalletRef.current
    ) {
      return;
    }

    const storageState = parseBurnerWalletStorageState();
    const localAccountAttemptKey = resolveOwnerLocalAccountAutoConnectAttemptKey({
      attemptNonce: ownerRecoveryAttemptNonce,
      chainId,
      initializing: initializingBurner,
      ownerAddress: ownerWalletAddress,
      ownerAesKey,
      storageState
    });

    if (ownerAesReady && ownerAesKey.trim()) {
      if (localAccountAttemptKey) {
        if (ownerLocalAccountAutoConnectAttemptRef.current !== localAccountAttemptKey) {
          ownerLocalAccountAutoConnectAttemptRef.current = localAccountAttemptKey;
          beginBurnerPinFlow('stored').catch(() => {
            ownerLocalAccountAutoConnectAttemptRef.current = '';
          });
        }
        return;
      }
      bootstrapOwnerRecoveryOnce(ownerWalletAddress, ownerAesKey).catch(() => {});
    }
  }, [
    allowStartupWalletRestore,
    beginBurnerPinFlow,
    bootstrapOwnerRecoveryOnce,
    burnerWalletRef,
    chainId,
    connectingMethod,
    initializingBurner,
    ownerAesKey,
    ownerAesReady,
    ownerRecoveryAttemptNonce,
    ownerWalletAddress,
    recoveringAppWallet,
    showBurnerImportModal,
    showBurnerPinModal
  ]);

  return {
    bootstrapOwnerRecoveryOnce,
    resetOwnerRecoveryAttempt
  };
}
