import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  isWalletAddress,
  mergeOnboardInfo,
  normalizeChainId,
  type Eip1193Provider,
  type InjectedWalletOption
} from '../../../lib/appShared';
import { buildWalletAesHealthState, type WalletAesHealthState } from '../../../lib/cotiAesUnlock';
import { runWalletTransactionFlow } from '../../../lib/walletTransactionFlow';
import { issueOwnerCotiMetaMaskCapability } from '../ownerCotiMetaMaskCapability';
import {
  createGuardedSignerLease,
  mergeLeaseScopedOnboardInfo
} from './useSharedWalletSigner';
import type { BrowserWalletSession, BrowserWalletSignerLease } from './useWalletOnboarding';

type UseAccountFundsSignersArgs = {
  assertBrowserWalletSignerLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertBrowserWalletSignerLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  browserWalletSession: BrowserWalletSession | null;
  captureBrowserWalletSignerLease: () => BrowserWalletSignerLease;
  chainId: number | null;
  currentInjectedWalletOption: Pick<InjectedWalletOption, 'id'> | null;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getConnectedProvider: () => Eip1193Provider | null;
  ownerAesKey: string;
  ownerWalletAddress: string;
  preferredBrowserWalletId: string;
  resolveWalletPromptProvider: (
    providerOverride?: Eip1193Provider | null,
    expectedAddress?: string | null
  ) => Promise<Eip1193Provider | null>;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setWalletAesHealth: (
    address: string,
    health: WalletAesHealthState,
    shouldCommit?: () => boolean
  ) => void;
};

export type OwnerFundsSignerLeaseOptions = {
  assertBeforeIrreversibleRpc?: () => void | Promise<void>;
  assertIrreversibleRpcSnapshotCurrent?: () => void;
  refreshPrivacy?: boolean;
};

export const resolveOwnerFundsOnboardInfo = ({
  cached,
  ownerAesKey,
  refreshPrivacy
}: Readonly<{
  cached?: OnboardInfo;
  ownerAesKey: string;
  refreshPrivacy: boolean;
}>): OnboardInfo | undefined => {
  if (refreshPrivacy) return undefined;
  const aesKey = ownerAesKey.trim();
  return aesKey ? mergeOnboardInfo(cached, { aesKey } as OnboardInfo) : cached;
};

export default function useAccountFundsSigners({
  assertBrowserWalletSignerLeaseCurrent,
  assertBrowserWalletSignerLeaseSnapshotCurrent,
  browserWalletSession,
  captureBrowserWalletSignerLease,
  chainId,
  currentInjectedWalletOption,
  ensureCotiNetwork,
  getConnectedProvider,
  ownerAesKey,
  ownerWalletAddress,
  preferredBrowserWalletId,
  resolveWalletPromptProvider,
  sessionOnboardInfo,
  setChainId,
  setSessionOnboardInfo,
  setWalletAesHealth
}: UseAccountFundsSignersArgs) {
  const ownerAesKeyRef = useRef(ownerAesKey);
  ownerAesKeyRef.current = ownerAesKey;
  const sessionOnboardInfoRef = useRef(sessionOnboardInfo);
  sessionOnboardInfoRef.current = sessionOnboardInfo;
  const getOwnerFundsSigner = useCallback(
    async (
      requirePrivacy: boolean,
      options: OwnerFundsSignerLeaseOptions = {}
    ): Promise<JsonRpcSigner> => {
      let capturedLease = captureBrowserWalletSignerLease();
      const normalizedOwnerAddress = ownerWalletAddress.trim();
      if (
        !normalizedOwnerAddress ||
        !isWalletAddress(normalizedOwnerAddress) ||
        normalizedOwnerAddress.toLowerCase() !== capturedLease.address
      ) {
        throw new Error('Connect the owner wallet first.');
      }

      const connectedProvider = capturedLease.sessionProvider;
      const provider = await resolveWalletPromptProvider(connectedProvider, normalizedOwnerAddress);
      assertBrowserWalletSignerLeaseSnapshotCurrent(capturedLease);
      if (!provider) {
        throw new Error('Owner wallet provider not detected. Connect the owner wallet first.');
      }

      const lease: BrowserWalletSignerLease = {
        ...capturedLease,
        signingProvider: provider
      };
      assertBrowserWalletSignerLeaseSnapshotCurrent(lease);

      if (lease.chainId !== COTI_NETWORK.chainIdDecimal || provider !== connectedProvider) {
        await ensureCotiNetwork(provider);
        capturedLease = captureBrowserWalletSignerLease();
        if (
          capturedLease.sessionProvider !== connectedProvider ||
          capturedLease.address !== normalizedOwnerAddress.toLowerCase()
        ) {
          throw new Error('Owner wallet session changed while selecting the COTI network.');
        }
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const currentLease: BrowserWalletSignerLease = {
        ...capturedLease,
        signingProvider: provider
      };
      await assertBrowserWalletSignerLeaseCurrent(currentLease);
      assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease);
      const cacheKey = normalizedOwnerAddress.toLowerCase();
      const cachedOnboardInfo = resolveOwnerFundsOnboardInfo({
        cached: sessionOnboardInfoRef.current[cacheKey],
        ownerAesKey: ownerAesKeyRef.current,
        refreshPrivacy: Boolean(options.refreshPrivacy)
      });
      const sessionInfo = cachedOnboardInfo ? { [cacheKey]: cachedOnboardInfo } : undefined;
      return issueOwnerCotiMetaMaskCapability<JsonRpcSigner>({
        assertLeaseCurrent: assertBrowserWalletSignerLeaseCurrent,
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        bindCapability: async ({ signer }) => createGuardedSignerLease(
          signer,
          async () => {
            assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease);
            await options.assertBeforeIrreversibleRpc?.();
            assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease);
          },
          () => {
            assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease);
            options.assertIrreversibleRpcSnapshotCurrent?.();
            assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease);
          }
        ),
        capabilityLabel: 'owner funds',
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress }) => {
          setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
            previous,
            walletAddress,
            onboardInfo,
            assertCurrent
          ));
          setWalletAesHealth(normalizedOwnerAddress, buildWalletAesHealthState({
            status: 'ready-unverified',
            walletAddress: normalizedOwnerAddress
          }), () => {
            try {
              assertCurrent();
              return true;
            } catch {
              return false;
            }
          });
        },
        expectedChainId: BigInt(COTI_NETWORK.chainIdDecimal),
        expectedOwnerAddress: normalizedOwnerAddress,
        lease: currentLease,
        refreshPrivacy: Boolean(options.refreshPrivacy),
        requirePrivacy,
        sessionOnboardInfo: sessionInfo
      });
    },
    [
      assertBrowserWalletSignerLeaseCurrent,
      assertBrowserWalletSignerLeaseSnapshotCurrent,
      captureBrowserWalletSignerLease,
      ensureCotiNetwork,
      ownerWalletAddress,
      resolveWalletPromptProvider,
      setChainId,
      setSessionOnboardInfo,
      setWalletAesHealth
    ]
  );

  const runOwnerFundsTransactionFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> =>
      runWalletTransactionFlow(
        {
          chainId,
          provider: browserWalletSession?.provider ?? getConnectedProvider(),
          providerKey: browserWalletSession?.walletId ?? currentInjectedWalletOption?.id ?? preferredBrowserWalletId,
          walletAddress: ownerWalletAddress
        },
        operation
      ),
    [
      browserWalletSession?.provider,
      browserWalletSession?.walletId,
      chainId,
      currentInjectedWalletOption?.id,
      getConnectedProvider,
      ownerWalletAddress,
      preferredBrowserWalletId
    ]
  );

  return {
    getOwnerFundsSigner,
    runOwnerFundsTransactionFlow
  };
}
