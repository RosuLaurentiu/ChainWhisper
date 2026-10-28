import { useMemo } from 'react';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import { COTI_NETWORK } from '../../../lib/appShared';
import type { WalletAesHealthState } from '../../../lib/cotiAesUnlock';
import {
  hasSessionAesKey,
  resolveBrowserWalletPrivacyState
} from '../../../lib/walletSession';
import {
  buildWalletAccountScope,
  buildWalletReadAccountsKey
} from '../../../lib/walletAccountScope';

type UseWalletReadinessArgs = {
  activeGroupId: number | null;
  browserWalletAddress?: string;
  chainId: number | null;
  isActiveGroupAdmin: boolean;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAesHealthByAddress: Record<string, WalletAesHealthState>;
};

export default function useWalletReadiness({
  activeGroupId,
  browserWalletAddress,
  chainId,
  isActiveGroupAdmin,
  sessionOnboardInfo,
  walletAesHealthByAddress
}: UseWalletReadinessArgs) {
  const hasAesReady = useMemo(
    () => {
      const connectedWalletAddress = browserWalletAddress?.trim() ?? '';
      const walletKey = connectedWalletAddress.toLowerCase();
      return (
        hasSessionAesKey(connectedWalletAddress, sessionOnboardInfo) &&
        walletAesHealthByAddress[walletKey]?.status !== 'key-mismatch'
      );
    },
    [browserWalletAddress, sessionOnboardInfo, walletAesHealthByAddress]
  );
  const { ownerAesKey, ownerAesReady, ownerWalletAddress } = useMemo(
    () =>
      resolveBrowserWalletPrivacyState({
        browserWalletAddress,
        sessionOnboardInfo,
        walletAesHealthByAddress
      }),
    [browserWalletAddress, sessionOnboardInfo, walletAesHealthByAddress]
  );
  const walletAccountScope = useMemo(
    () =>
      buildWalletAccountScope({
        ownerAddress: ownerWalletAddress,
        ownerAesReady
      }),
    [ownerAesReady, ownerWalletAddress]
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
