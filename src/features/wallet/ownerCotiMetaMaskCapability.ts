import { JsonRpcSigner, getAddress, type BrowserProvider, type OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  loadCotiReadProvider,
  mergeOnboardInfo,
  type CotiReadProvider,
  type InjectedEthereumProvider
} from '../../lib/appShared';
import {
  getCotiSnapOwnerAesKeyResult,
  getCotiSnapOwnerAesStatusMessage,
  type CotiSnapOwnerAesResult
} from '../../lib/cotiSnap';
import { getOrRecoverAesForWalletResult } from '../../lib/cotiAesUnlock';
import { isAllowedBrowserWalletOption, isCypherTradeWalletOption } from '../../lib/walletOptions';
import { createLeaseGuardedEip1193Provider } from './hooks/useSharedWalletSigner';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

type PooledOwnerSigner = {
  browserProvider: BrowserProvider;
  guardedProvider: BrowserWalletSignerLease['sessionProvider'];
  privacyUnlock: Promise<void> | null;
  signer: JsonRpcSigner;
};

const DEX_BROWSER_SIGNERS = new WeakMap<object, Readonly<{ owner: string; chainId: bigint; assertCurrent: () => void }>>();
// This read-only boundary cannot promote an address or a caller-created signer.
export const hasCurrentDexBrowserSigner = (signer: object | undefined, owner: string, chainId: bigint) => {
  const context = signer && DEX_BROWSER_SIGNERS.get(signer);
  if (!context || context.owner !== owner.toLowerCase() || context.chainId !== chainId) return false;
  context.assertCurrent();
  return true;
};

const OWNER_SIGNER_POOLS = new WeakMap<object, Map<string, Promise<PooledOwnerSigner>>>();
const DESTROYED_OWNER_SIGNER_PROVIDERS = new WeakSet<object>();

const destroyOwnerSignerProviderOnce = (browserProvider: BrowserProvider): void => {
  const providerKey = browserProvider as object;
  if (DESTROYED_OWNER_SIGNER_PROVIDERS.has(providerKey)) return;
  DESTROYED_OWNER_SIGNER_PROVIDERS.add(providerKey);
  browserProvider.destroy();
};

const destroyPooledSigner = (pending: Promise<PooledOwnerSigner>): void => {
  void pending.then(({ browserProvider }) => destroyOwnerSignerProviderOnce(browserProvider)).catch(() => {});
};

export const releaseOwnerCotiMetaMaskProviderPool = (
  provider: BrowserWalletSignerLease['sessionProvider']
): void => {
  const pool = OWNER_SIGNER_POOLS.get(provider as object);
  if (!pool) return;
  OWNER_SIGNER_POOLS.delete(provider as object);
  for (const pending of pool.values()) destroyPooledSigner(pending);
  pool.clear();
};

export type OwnerCotiMetaMaskOnboardInfoCommitter = (input: Readonly<{
  assertCurrent: () => void;
  onboardInfo: OnboardInfo;
  walletAddress: string;
}>) => void;

export type IssueOwnerCotiMetaMaskCapabilityArgs<TCapability> = Readonly<{
  assertCapabilityCurrent?: () => void;
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  bindCapability: (input: Readonly<{
    assertCurrent: () => Promise<void>;
    assertSnapshotCurrent: () => void;
    browserProvider: BrowserProvider;
    readProvider: CotiReadProvider;
    chainId: bigint;
    ownerAddress: string;
    signer: JsonRpcSigner;
  }>) => Promise<TCapability>;
  capabilityLabel: string;
  commitOnboardInfo?: OwnerCotiMetaMaskOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  refreshPrivacy?: boolean;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

const ownerAddress = (value: string, label: string): string => {
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error(`${label} is not a valid wallet address.`);
  }
};

const assertExactLease = <TCapability>({
  capabilityLabel,
  expectedChainId,
  expectedOwnerAddress,
  lease
}: Pick<
  IssueOwnerCotiMetaMaskCapabilityArgs<TCapability>,
  'capabilityLabel' | 'expectedChainId' | 'expectedOwnerAddress' | 'lease'
>): Readonly<{ chainId: bigint; ownerAddress: string; walletRequiresSnap: boolean }> => {
  const productionChainId = BigInt(COTI_NETWORK.chainIdDecimal);
  if (expectedChainId !== productionChainId) {
    throw new Error(`The app ${capabilityLabel} capability issuer requires the configured COTI network.`);
  }
  const expectedOwner = ownerAddress(expectedOwnerAddress, `Expected ${capabilityLabel} owner`);
  const leasedOwner = ownerAddress(lease.address, `Leased ${capabilityLabel} owner`);
  const sessionOwner = ownerAddress(lease.session.address, 'Selected browser-wallet session owner');
  const injectedProvider = lease.sessionProvider as InjectedEthereumProvider;
  const supportedSource =
    lease.source === 'injected' ||
    lease.source === 'metamask-connect-mobile' ||
    lease.source === 'walletconnect';
  const selectedBrowserWallet = isAllowedBrowserWalletOption({
    id: lease.session.walletId,
    label: lease.session.walletLabel,
    provider: injectedProvider
  });
  const walletRequiresSnap = !isCypherTradeWalletOption({
    id: lease.session.walletId,
    label: lease.session.walletLabel,
    provider: injectedProvider
  });
  if (
    lease.activeSignerSource !== 'metamask' ||
    !supportedSource ||
    lease.session.source !== lease.source ||
    !selectedBrowserWallet ||
    lease.activeProvider !== lease.sessionProvider ||
    lease.signingProvider !== lease.sessionProvider ||
    lease.session.provider !== lease.sessionProvider ||
    expectedOwner.toLowerCase() !== leasedOwner.toLowerCase() ||
    leasedOwner.toLowerCase() !== sessionOwner.toLowerCase() ||
    lease.activeAddress !== leasedOwner.toLowerCase() ||
    lease.chainId !== COTI_NETWORK.chainIdDecimal ||
    lease.activeChainId !== COTI_NETWORK.chainIdDecimal ||
    lease.session.chainId !== COTI_NETWORK.chainIdDecimal
  ) {
    throw new Error(`${capabilityLabel} requires the active MetaMask or CipherTrade owner session.`);
  }
  return Object.freeze({ chainId: productionChainId, ownerAddress: expectedOwner, walletRequiresSnap });
};

/** Composes one opaque owner capability from the exact selected MetaMask or CipherTrade lease. */
export const issueOwnerCotiMetaMaskCapability = async <TCapability>({
  assertCapabilityCurrent,
  assertLeaseCurrent,
  assertLeaseSnapshotCurrent,
  bindCapability,
  capabilityLabel,
  commitOnboardInfo,
  expectedChainId,
  expectedOwnerAddress,
  lease,
  refreshPrivacy = false,
  requirePrivacy,
  sessionOnboardInfo
}: IssueOwnerCotiMetaMaskCapabilityArgs<TCapability>): Promise<TCapability> => {
  if (!capabilityLabel.trim() || typeof bindCapability !== 'function') {
    throw new Error('Owner browser-wallet capability issuer configuration is invalid.');
  }
  const capturedLease = Object.freeze({ ...lease }) as BrowserWalletSignerLease;
  const expected = assertExactLease({
    capabilityLabel,
    expectedChainId,
    expectedOwnerAddress,
    lease: capturedLease
  });
  const assertPooledLeaseCurrent = (): Promise<void> => assertLeaseCurrent(capturedLease);
  const assertPooledLeaseSnapshotCurrent = (): void => assertLeaseSnapshotCurrent(capturedLease);
  const assertCurrent = async (): Promise<void> => {
    assertCapabilityCurrent?.();
    await assertPooledLeaseCurrent();
    assertCapabilityCurrent?.();
  };
  const assertSnapshotCurrent = (): void => {
    assertCapabilityCurrent?.();
    assertPooledLeaseSnapshotCurrent();
    assertCapabilityCurrent?.();
  };

  await assertCurrent();
  assertSnapshotCurrent();
  const providerKey = capturedLease.sessionProvider as object;
  const scopeKey = `${capturedLease.epoch}:${expected.chainId}:${expected.ownerAddress.toLowerCase()}`;
  let pool = OWNER_SIGNER_POOLS.get(providerKey);
  if (!pool) {
    pool = new Map();
    OWNER_SIGNER_POOLS.set(providerKey, pool);
  }
  for (const [key, pending] of pool) {
    if (key === scopeKey) continue;
    pool.delete(key);
    destroyPooledSigner(pending);
  }
  let pooledPromise = pool.get(scopeKey);
  if (!pooledPromise) {
    pooledPromise = (async (): Promise<PooledOwnerSigner> => {
      const guardedProvider = createLeaseGuardedEip1193Provider(
        capturedLease.sessionProvider,
        assertPooledLeaseCurrent,
        assertPooledLeaseSnapshotCurrent
      );
      const browserProvider = await createCotiBrowserProvider(guardedProvider);
      try {
        // The captured lease already owns the exact account. Constructing the
        // COTI signer directly avoids an extra eth_accounts request to the
        // extension whenever a capability is issued.
        const signer = new JsonRpcSigner(browserProvider, expected.ownerAddress);
        signer.disableAutoOnboard();
        if (expected.chainId === 7082400n) DEX_BROWSER_SIGNERS.set(signer, Object.freeze({
          owner: expected.ownerAddress.toLowerCase(), chainId: expected.chainId, assertCurrent: () => {
            if (DESTROYED_OWNER_SIGNER_PROVIDERS.has(browserProvider)) throw new Error('Browser wallet signer lease ended.');
            assertPooledLeaseSnapshotCurrent();
          }
        }));
        return { browserProvider, guardedProvider, privacyUnlock: null, signer };
      } catch (error) {
        destroyOwnerSignerProviderOnce(browserProvider);
        throw error;
      }
    })();
    pool.set(scopeKey, pooledPromise);
    void pooledPromise.catch(() => {
      if (pool?.get(scopeKey) === pooledPromise) pool.delete(scopeKey);
    });
  }
  const pooled = await pooledPromise;
  assertSnapshotCurrent();
  const { browserProvider, guardedProvider, signer } = pooled;
  const readProvider = await loadCotiReadProvider(true);
  assertSnapshotCurrent();
  // The shared signer/provider belongs to the wallet lease. Only this issuance's
  // privacy helper requests carry its additional capability-generation guard.
  const privacyProvider = assertCapabilityCurrent
    ? createLeaseGuardedEip1193Provider(guardedProvider, assertCurrent, assertSnapshotCurrent)
    : guardedProvider;

  const snapAesResult = { current: null as CotiSnapOwnerAesResult | null };
  let privacyUnlocked = false;
  try {
    if (refreshPrivacy) signer.clearUserOnboardInfo();
    const cachedOnboardInfo = refreshPrivacy
      ? undefined
      : sessionOnboardInfo?.[expected.ownerAddress.toLowerCase()];
    // Reuse an owner-unlocked session even when this capability must not prompt for privacy.
    if (cachedOnboardInfo?.aesKey?.trim() && !signer.getUserOnboardInfo()?.aesKey?.trim()) {
      signer.setUserOnboardInfo(mergeOnboardInfo(signer.getUserOnboardInfo(), cachedOnboardInfo));
    }
    if (requirePrivacy && !signer.getUserOnboardInfo()?.aesKey?.trim()) {
      if (!pooled.privacyUnlock) {
        pooled.privacyUnlock = (async () => {
          assertSnapshotCurrent();
          if (expected.walletRequiresSnap) {
            snapAesResult.current = await getCotiSnapOwnerAesKeyResult(
              privacyProvider,
              expected.ownerAddress,
              { expectedChainId: COTI_NETWORK.chainIdDecimal }
            );
            assertSnapshotCurrent();
            if (snapAesResult.current.status !== 'ready') {
              throw new Error(getCotiSnapOwnerAesStatusMessage(snapAesResult.current.status));
            }
            signer.setUserOnboardInfo(mergeOnboardInfo(signer.getUserOnboardInfo(), {
              aesKey: snapAesResult.current.aesKey
            } as OnboardInfo));
          } else {
            const unlock = await getOrRecoverAesForWalletResult({
              allowLegacyFallback: true,
              assertCurrent,
              probeSnapAes: false,
              provider: privacyProvider,
              signer,
              walletAddress: expected.ownerAddress
            });
            assertSnapshotCurrent();
            if (unlock.status !== 'ready') {
              throw new Error(`CipherTrade did not return the owner privacy key for ${capabilityLabel}.`);
            }
            signer.setUserOnboardInfo(mergeOnboardInfo(signer.getUserOnboardInfo(), unlock.onboardInfo));
          }
          privacyUnlocked = true;
        })().finally(() => { pooled.privacyUnlock = null; });
      }
      await pooled.privacyUnlock;
      assertSnapshotCurrent();
    }

    const onboardInfo = signer.getUserOnboardInfo();
    if (requirePrivacy && !onboardInfo?.aesKey?.trim()) {
      throw new Error(`COTI Snap did not return the owner privacy key for ${capabilityLabel}.`);
    }
    assertSnapshotCurrent();
    if (privacyUnlocked && onboardInfo?.aesKey) {
      commitOnboardInfo?.({
        assertCurrent: assertSnapshotCurrent,
        onboardInfo,
        walletAddress: expected.ownerAddress.toLowerCase()
      });
      assertSnapshotCurrent();
    }

    const capability = await bindCapability({
      assertCurrent,
      assertSnapshotCurrent,
      browserProvider,
      readProvider,
      chainId: expected.chainId,
      ownerAddress: expected.ownerAddress,
      signer
    });
    assertSnapshotCurrent();
    return capability;
  } finally {
    if (snapAesResult.current?.status === 'ready') snapAesResult.current.aesKey = '';
  }
};
