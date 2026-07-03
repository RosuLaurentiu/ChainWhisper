import { useMemo } from 'react';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  type SignerSource
} from '../../../lib/appShared';
import type { WalletAesHealthState } from '../../../lib/cotiAesUnlock';
import {
  hasSessionAesKey,
  resolveOwnerRecoveryWalletState
} from '../../../lib/walletSession';
import {
  buildWalletAccountScope,
  buildWalletReadAccountsKey
} from '../../../lib/walletAccountScope';

type UseWalletReadinessArgs = {
  activeGroupId: number | null;
  activeSignerSource: SignerSource;
  browserWalletAddress?: string;
  chainId: number | null;
  isActiveGroupAdmin: boolean;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAddress: string;
  walletAesHealthByAddress: Record<string, WalletAesHealthState>;
};

export default function useWalletReadiness({
  activeGroupId,
  activeSignerSource,
  browserWalletAddress,
  chainId,
  isActiveGroupAdmin,
  sessionOnboardInfo,
  walletAddress,
  walletAesHealthByAddress
}: UseWalletReadinessArgs) {
  const hasAesReady = useMemo(
    () => {
      const walletKey = walletAddress.trim().toLowerCase();
      return (
        hasSessionAesKey(walletAddress, sessionOnboardInfo) &&
        walletAesHealthByAddress[walletKey]?.status !== 'key-mismatch'
      );
    },
    [walletAddress, sessionOnboardInfo, walletAesHealthByAddress]
  );
  const { ownerAesKey, ownerAesReady, ownerWalletAddress } = useMemo(
    () =>
      resolveOwnerRecoveryWalletState({
        activeSignerSource,
        browserWalletAddress,
        sessionOnboardInfo,
        walletAddress,
        walletAesHealthByAddress
      }),
    [activeSignerSource, browserWalletAddress, sessionOnboardInfo, walletAddress, walletAesHealthByAddress]
  );
  const walletAccountScope = useMemo(
    () =>
      buildWalletAccountScope({
        actionAddress: walletAddress,
        actionAesReady: hasAesReady,
        ownerAddress: ownerWalletAddress,
        ownerAesReady
      }),
    [hasAesReady, ownerAesReady, ownerWalletAddress, walletAddress]
  );
  const readableWalletAccounts = walletAccountScope.readAccounts;
  const readableWalletAccountKeys = useMemo(
    () => buildWalletReadAccountsKey(readableWalletAccounts, { includePrivateReadState: true }),
    [readableWalletAccounts]
  );
  const canManageActiveGroupJoinCodes = useMemo(() => {
    if (activeGroupId === null) {
      return false;
    }
    if (!isActiveGroupAdmin || !hasAesReady) {
      return false;
    }
    return chainId === COTI_NETWORK.chainIdDecimal;
  }, [activeGroupId, isActiveGroupAdmin, hasAesReady, chainId]);

  return {
    canManageActiveGroupJoinCodes,
    hasAesReady,
    ownerAesKey,
    ownerAesReady,
    ownerWalletAddress,
    readableWalletAccountKeys,
    readableWalletAccounts,
    walletAccountScope
  };
}
