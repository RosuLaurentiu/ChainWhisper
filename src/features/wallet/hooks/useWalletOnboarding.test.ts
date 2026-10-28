import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import type { Eip1193Provider, InjectedWalletOption } from '../../../lib/appShared';
import { COTI_NETWORK } from '../../../lib/appShared';
import {
  readFallbackAesSessionOnboardInfo,
  storeFallbackAesSessionOnboardInfo
} from '../../../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesKeyResult } from '../../../lib/cotiSnap';
import { resetMetaMaskConnectMobileForTests } from '../../../lib/metamaskConnectMobile';
import {
  BROWSER_WALLET_SIGNER_LEASE_EXPIRED,
  assertBrowserWalletSignerLeaseState,
  assertLiveBrowserWalletSignerLease,
  buildOwnerPrivacyUnlockOptions,
  createBrowserWalletStateReconciler,
  createBrowserWalletRpcRecoveryScheduler,
  destroyCachedCotiSignerProviders,
  disconnectBrowserWalletSession,
  preserveEquivalentBrowserWalletSession,
  readPassiveBrowserWalletRestore,
  resolveCachedBrowserWalletReadSigner,
  resolveOwnerPrivacyOnboardingErrorMessage,
  shouldPreserveBrowserWalletSessionOnProviderDisconnect,
  shouldRetryEmptyBrowserWalletAccountsBeforeDisconnect,
  subscribeBrowserWalletProviderEvents,
  type BrowserWalletSession,
  type BrowserWalletSignerLease,
  type BrowserWalletSignerLeaseState
} from './useWalletOnboarding';
import {
  createGuardedSignerLease,
  createLeaseGuardedEip1193Provider,
  mergeLeaseScopedOnboardInfo
} from './useSharedWalletSigner';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const mocks = vi.hoisted(() => ({
  createEVMClient: vi.fn(),
  clientGetAccount: vi.fn(),
  clientGetChainId: vi.fn(),
  clientGetProvider: vi.fn(),
  providerOn: vi.fn(),
  providerRequest: vi.fn()
}));

vi.mock('@metamask/connect-evm', () => ({
  createEVMClient: mocks.createEVMClient
}));

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const createWalletOption = (accounts: string[] = [], chainId = COTI_NETWORK.chainIdHex) => {
  const methods: string[] = [];
  const provider = {
    isMetaMask: true,
    request: vi.fn(async ({ method }: { method: string }) => {
      methods.push(method);
      if (method === 'eth_accounts') {
        return accounts;
      }
      if (method === 'eth_chainId') {
        return chainId;
      }
      throw new Error(`Unexpected wallet prompt method: ${method}`);
    })
  };
  const option: InjectedWalletOption = {
    id: 'metamask',
    label: 'MetaMask',
    provider
  };
  return { methods, option, provider };
};

describe('resolveCachedBrowserWalletReadSigner', () => {
  it('reuses the privacy-unlocked signer without querying the wallet provider', () => {
    const request = vi.fn();
    const signer = {
      address: '0x1111111111111111111111111111111111111111',
      getUserOnboardInfo: () => ({ aesKey: '11'.repeat(16) })
    } as unknown as JsonRpcSigner;
    const assertSnapshotCurrent = vi.fn();

    expect(resolveCachedBrowserWalletReadSigner({
      assertSnapshotCurrent,
      cachedProvider: { request } as unknown as Eip1193Provider,
      expectedAddress: signer.address,
      requirePrivacy: true,
      signer
    })).toBe(signer);
    expect(assertSnapshotCurrent).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed when the cached signer is missing privacy material', () => {
    const signer = {
      address: '0x1111111111111111111111111111111111111111',
      getUserOnboardInfo: () => undefined
    } as unknown as JsonRpcSigner;

    expect(() => resolveCachedBrowserWalletReadSigner({
      assertSnapshotCurrent: () => {},
      cachedProvider: { request: vi.fn() } as unknown as Eip1193Provider,
      expectedAddress: signer.address,
      requirePrivacy: true,
      signer
    })).toThrow('Unlock privacy');
  });
});

describe('readPassiveBrowserWalletRestore', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    resetMetaMaskConnectMobileForTests();
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Desktop'
    });
    vi.stubGlobal('window', {
      clearTimeout,
      localStorage: createMemoryStorage(),
      location: {
        origin: 'https://chainwhisper.example',
        hash: '',
        pathname: '/trades',
        search: ''
      },
      setTimeout,
      sessionStorage: storage
    });
    mocks.createEVMClient.mockReset();
    mocks.clientGetAccount.mockReset();
    mocks.clientGetChainId.mockReset();
    mocks.clientGetProvider.mockReset();
    mocks.providerOn.mockReset();
    mocks.providerRequest.mockReset();
  });

  afterEach(() => {
    resetMetaMaskConnectMobileForTests();
    vi.unstubAllGlobals();
  });

  it('restores an authorized browser wallet from eth_accounts without prompting', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const { methods, option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toMatchObject({
      address: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    });
    expect(methods).toEqual(['eth_accounts', 'eth_chainId']);
  });

  it('leaves an unauthorized browser wallet disconnected without prompting', async () => {
    const { methods, option } = createWalletOption([]);

    await expect(readPassiveBrowserWalletRestore(option)).resolves.toBeNull();

    expect(methods).toEqual(['eth_accounts']);
  });

  it('does not rehydrate fallback AES during passive owner restore', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000002';
    const { option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore?.onboardInfo).toBeNull();
  });

  it('prefers injected MetaMask for mobile bootstrap restore when it is already authorized', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000003';
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    });
    window.location.pathname = '/wallet-connect';
    const { methods, option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toMatchObject({
      address: walletAddress,
      source: 'injected',
      walletId: 'metamask'
    });
    expect(mocks.createEVMClient).not.toHaveBeenCalled();
    expect(methods).toEqual(['eth_accounts', 'eth_chainId']);
  });

  it('does not fall back to Connect EVM when injected MetaMask exists but is not authorized', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    });
    window.location.pathname = '/wallet-connect';
    const { methods, option } = createWalletOption([]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toBeNull();
    expect(mocks.createEVMClient).not.toHaveBeenCalled();
    expect(methods).toEqual(['eth_accounts']);
  });
});

describe('transient injected-provider disconnect handling', () => {
  it('coalesces a transient RPC recovery retry and cancels it exactly once', () => {
    const callbacks = new Map<number, () => void>();
    let nextTimerId = 1;
    const clearTimer = vi.fn((timerId: number) => callbacks.delete(timerId));
    const retry = vi.fn();
    const setTimer = vi.fn((callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(800);
      const timerId = nextTimerId++;
      callbacks.set(timerId, callback);
      return timerId;
    });
    const scheduler = createBrowserWalletRpcRecoveryScheduler({
      clearTimer,
      delayMs: 800,
      retry,
      setTimer
    });

    scheduler.schedule();
    scheduler.schedule();
    expect(setTimer).toHaveBeenCalledOnce();

    const firstCallback = callbacks.get(1);
    callbacks.delete(1);
    firstCallback?.();
    expect(retry).toHaveBeenCalledOnce();

    scheduler.schedule();
    expect(setTimer).toHaveBeenCalledTimes(2);
    scheduler.cancel();
    scheduler.cancel();
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledWith(2);
    expect(callbacks).toEqual(new Map());
  });

  it('owns one exact lifecycle-listener set and removes it only once', () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const current = listeners.get(event) ?? new Set();
        current.add(listener);
        listeners.set(event, current);
      }),
      removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(listener);
      })
    };
    const handlers = {
      accountsChanged: vi.fn(),
      chainChanged: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };

    const unsubscribe = subscribeBrowserWalletProviderEvents(provider, handlers);
    expect(provider.on.mock.calls.map(([event]) => event)).toEqual([
      'accountsChanged', 'chainChanged', 'connect', 'disconnect'
    ]);
    for (const event of Object.keys(handlers)) expect(listeners.get(event)?.size).toBe(1);

    unsubscribe();
    unsubscribe();
    expect(provider.removeListener).toHaveBeenCalledTimes(4);
    for (const event of Object.keys(handlers)) expect(listeners.get(event)?.size).toBe(0);
  });

  it('serializes provider event bursts and performs one latest-state follow-up', async () => {
    const first = deferred();
    const second = deferred();
    const refresh = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const reconcile = createBrowserWalletStateReconciler(refresh);

    const initial = reconcile();
    const accountsChanged = reconcile();
    const chainChanged = reconcile();
    const connected = reconcile();

    expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve();
    await first.promise;
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    second.resolve();

    await expect(Promise.all([initial, accountsChanged, chainChanged, connected])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('retries once when a newer provider event arrives during a failed refresh', async () => {
    const first = deferred();
    const refresh = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined);
    const reconcile = createBrowserWalletStateReconciler(refresh);

    const initial = reconcile();
    const latest = reconcile();
    first.reject(new Error('temporary MetaMask RPC failure'));

    await expect(Promise.all([initial, latest])).resolves.toEqual([undefined, undefined]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps a guarded send valid across an equivalent background session refresh', async () => {
    const request = vi.fn(async () => 'submitted');
    const provider = { request } as unknown as Eip1193Provider;
    const address = '0x0000000000000000000000000000000000000004';
    const session: BrowserWalletSession = {
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };
    const refreshed = preserveEquivalentBrowserWalletSession(session, { ...session });
    const lease: BrowserWalletSignerLease = {
      activeAddress: address,
      activeChainId: COTI_NETWORK.chainIdDecimal,
      activeProvider: provider,
      activeSignerSource: 'metamask',
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      epoch: 7,
      session,
      sessionProvider: provider,
      signingProvider: provider,
      source: 'injected'
    };

    const state: BrowserWalletSignerLeaseState = {
      activeProvider: provider,
      activeSignerSource: 'metamask',
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      epoch: 7,
      session: refreshed
    };
    const assertCurrent = () => assertBrowserWalletSignerLeaseState(lease, state);
    const guardedProvider = createLeaseGuardedEip1193Provider(
      provider,
      assertCurrent,
      assertCurrent
    );

    expect(refreshed).toBe(session);
    await expect(guardedProvider.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }]
    })).resolves.toBe('submitted');
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not revoke an unchanged wallet authority when provider discovery metadata changes', async () => {
    const request = vi.fn(async () => 'submitted');
    const provider = { request } as unknown as Eip1193Provider;
    const address = '0x0000000000000000000000000000000000000004';
    const session: BrowserWalletSession = {
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };
    const rediscoveredSession = {
      ...session,
      walletId: 'metamask-2',
      walletLabel: 'MetaMask (rediscovered)'
    };
    const rediscovered = preserveEquivalentBrowserWalletSession(session, rediscoveredSession);
    const lease: BrowserWalletSignerLease = {
      activeAddress: address,
      activeChainId: COTI_NETWORK.chainIdDecimal,
      activeProvider: provider,
      activeSignerSource: 'metamask',
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      epoch: 7,
      session,
      sessionProvider: provider,
      signingProvider: provider,
      source: 'injected'
    };
    const state: BrowserWalletSignerLeaseState = {
      activeProvider: provider,
      activeSignerSource: 'metamask',
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      epoch: 7,
      session: rediscoveredSession
    };
    const assertCurrent = () => assertBrowserWalletSignerLeaseState(lease, state);
    const guardedProvider = createLeaseGuardedEip1193Provider(
      provider,
      assertCurrent,
      assertCurrent
    );

    expect(rediscovered).toBe(session);
    await expect(guardedProvider.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }]
    })).resolves.toBe('submitted');
    expect(request).toHaveBeenCalledOnce();
  });

  it('replaces the authority session when provider, owner, chain, or transport changes', () => {
    const provider = { request: vi.fn() } as unknown as Eip1193Provider;
    const otherProvider = { request: vi.fn() } as unknown as Eip1193Provider;
    const session: BrowserWalletSession = {
      address: '0x0000000000000000000000000000000000000004',
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };
    const changed = [
      { ...session, provider: otherProvider },
      { ...session, address: '0x0000000000000000000000000000000000000005' },
      { ...session, chainId: 1 },
      { ...session, source: 'walletconnect' as const }
    ];

    for (const next of changed) {
      expect(preserveEquivalentBrowserWalletSession(session, next)).toBe(next);
    }
  });

  it('preserves the selected MetaMask session during an RPC transport outage', () => {
    const provider = { request: vi.fn() } as unknown as Eip1193Provider;
    const address = '0x0000000000000000000000000000000000000004';
    const session: BrowserWalletSession = {
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };

    expect(shouldPreserveBrowserWalletSessionOnProviderDisconnect({
      activeSignerSource: 'metamask',
      provider,
      session,
      walletAddress: address
    })).toBe(true);
  });

  it('does not preserve a stale, different, or non-owner wallet session', () => {
    const provider = { request: vi.fn() } as unknown as Eip1193Provider;
    const otherProvider = { request: vi.fn() } as unknown as Eip1193Provider;
    const address = '0x0000000000000000000000000000000000000004';
    const session: BrowserWalletSession = {
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };

    expect(shouldPreserveBrowserWalletSessionOnProviderDisconnect({
      activeSignerSource: 'metamask', provider: otherProvider, session, walletAddress: address
    })).toBe(false);
    expect(shouldPreserveBrowserWalletSessionOnProviderDisconnect({
      activeSignerSource: 'metamask', provider, session, walletAddress: ''
    })).toBe(false);
  });

  it('treats one empty account event from the selected provider as transient until rechecked', () => {
    const provider = { request: vi.fn() } as unknown as Eip1193Provider;
    const address = '0x0000000000000000000000000000000000000004';
    const session: BrowserWalletSession = {
      address,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'injected',
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    };
    const input = {
      activeSignerSource: 'metamask' as const,
      provider,
      session,
      walletAddress: address
    };

    expect(shouldRetryEmptyBrowserWalletAccountsBeforeDisconnect({ ...input, accounts: [] })).toBe(true);
    expect(shouldRetryEmptyBrowserWalletAccountsBeforeDisconnect({ ...input, accounts: [address] })).toBe(false);
  });
});

describe('explicit browser wallet disconnect privacy cleanup', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sessionStorage: createMemoryStorage()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the connected fallback AES available until a supported explicit disconnect', async () => {
    const departingOwner = '0x0000000000000000000000000000000000000004';
    const retainedOwner = '0x0000000000000000000000000000000000000005';
    const provider = {
      request: vi.fn(async () => null)
    } as unknown as Eip1193Provider;

    expect(
      storeFallbackAesSessionOnboardInfo(
        departingOwner,
        provider,
        { aesKey: 'departing-owner-aes' } as OnboardInfo
      )
    ).toBe(true);
    expect(
      storeFallbackAesSessionOnboardInfo(
        retainedOwner,
        provider,
        { aesKey: 'retained-owner-aes' } as OnboardInfo
      )
    ).toBe(true);
    expect(readFallbackAesSessionOnboardInfo(departingOwner, provider)).toMatchObject({
      aesKey: 'departing-owner-aes'
    });

    await disconnectBrowserWalletSession({
      connectionMethod: 'metamask',
      provider,
      walletAddress: departingOwner
    });

    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }]
    });
    expect(readFallbackAesSessionOnboardInfo(departingOwner, provider)).toBeNull();
    expect(readFallbackAesSessionOnboardInfo(retainedOwner, provider)).toMatchObject({
      aesKey: 'retained-owner-aes'
    });
  });

  it('clears every departing-owner provider scope when permission revocation is unsupported', async () => {
    const departingOwner = '0x0000000000000000000000000000000000000006';
    const retainedOwner = '0x0000000000000000000000000000000000000007';
    const rejectingProvider = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('Unsupported method'), { code: -32601 });
      })
    } as unknown as Eip1193Provider;
    const alternateProvider = {
      request: vi.fn(async () => null)
    } as unknown as Eip1193Provider;

    storeFallbackAesSessionOnboardInfo(
      departingOwner,
      rejectingProvider,
      { aesKey: 'departing-provider-one-aes' } as OnboardInfo
    );
    storeFallbackAesSessionOnboardInfo(
      departingOwner,
      alternateProvider,
      { aesKey: 'departing-provider-two-aes' } as OnboardInfo
    );
    storeFallbackAesSessionOnboardInfo(
      retainedOwner,
      rejectingProvider,
      { aesKey: 'retained-owner-aes' } as OnboardInfo
    );

    await expect(
      disconnectBrowserWalletSession({
        connectionMethod: 'metamask',
        provider: rejectingProvider,
        walletAddress: departingOwner
      })
    ).resolves.toBeUndefined();

    expect(rejectingProvider.request).toHaveBeenCalledWith({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }]
    });
    expect(readFallbackAesSessionOnboardInfo(departingOwner, rejectingProvider)).toBeNull();
    expect(readFallbackAesSessionOnboardInfo(departingOwner, alternateProvider)).toBeNull();
    expect(readFallbackAesSessionOnboardInfo(retainedOwner, rejectingProvider)).toMatchObject({
      aesKey: 'retained-owner-aes'
    });
  });

  it('clears the departing session before a slow revoke without deleting a newer reconnect', async () => {
    const owner = '0x0000000000000000000000000000000000000008';
    let finishRevoke!: () => void;
    const provider = {
      request: vi.fn(
        () => new Promise<void>((resolve) => {
          finishRevoke = resolve;
        })
      )
    } as unknown as Eip1193Provider;

    storeFallbackAesSessionOnboardInfo(
      owner,
      provider,
      { aesKey: 'departing-owner-aes' } as OnboardInfo
    );

    const disconnecting = disconnectBrowserWalletSession({
      connectionMethod: 'metamask',
      provider,
      walletAddress: owner
    });

    expect(readFallbackAesSessionOnboardInfo(owner, provider)).toBeNull();
    storeFallbackAesSessionOnboardInfo(
      owner,
      provider,
      { aesKey: 'reconnected-owner-aes' } as OnboardInfo
    );

    finishRevoke();
    await disconnecting;

    expect(readFallbackAesSessionOnboardInfo(owner, provider)).toMatchObject({
      aesKey: 'reconnected-owner-aes'
    });
  });
});

describe('owner privacy onboarding errors', () => {
  it('turns the opaque zero-balance onboarding failure into a funding action', () => {
    expect(
      resolveOwnerPrivacyOnboardingErrorMessage('unable to onboard user.', 0n)
    ).toBe(
      'Add a small amount of COTI to this owner wallet for privacy onboarding gas, then tap Unlock privacy.'
    );
  });

  it('keeps a funded onboarding failure actionable without exposing the SDK error', () => {
    expect(
      resolveOwnerPrivacyOnboardingErrorMessage('unable to onboard user.', 1n)
    ).toBe(
      'Privacy onboarding could not be completed. Approve both wallet prompts and make sure this owner wallet has enough COTI for gas.'
    );
  });

  it('preserves unrelated wallet errors', () => {
    expect(
      resolveOwnerPrivacyOnboardingErrorMessage('The wallet request was rejected.', 0n)
    ).toBe('The wallet request was rejected.');
  });
});

describe('owner privacy unlock policy', () => {
  it('requires the wallet-controlled Snap key and never auto-submits legacy onboarding', () => {
    expect(buildOwnerPrivacyUnlockOptions(false)).toEqual({
      allowLegacyFallback: false,
      allowUnrecoverableReset: false,
      forceFreshAes: false,
      forceLegacyRefresh: false,
      forceRefresh: false,
      preferSnapAes: true,
      probeSnapAes: true,
      requireSnapAes: true
    });
  });

  it('uses session-only COTI onboarding for CipherTrade providers that cannot expose MetaMask Snap', () => {
    expect(buildOwnerPrivacyUnlockOptions(false, false)).toEqual({
      allowLegacyFallback: true,
      allowUnrecoverableReset: false,
      forceFreshAes: false,
      forceLegacyRefresh: false,
      forceRefresh: false,
      preferSnapAes: false,
      probeSnapAes: false,
      requireSnapAes: false
    });
  });

  it('destroys every unique cached COTI provider exactly once', () => {
    const destroy = vi.fn();
    const sharedProvider = { destroy };
    const signer = { provider: sharedProvider } as unknown as JsonRpcSigner;

    destroyCachedCotiSignerProviders({ first: signer, second: signer });
    destroyCachedCotiSignerProviders({ laterCleanup: signer });

    expect(destroy).toHaveBeenCalledOnce();
  });
});

const createBrowserSignerLeaseFixture = ({
  account = '0x0000000000000000000000000000000000000011',
  chainId = COTI_NETWORK.chainIdDecimal,
  request
}: {
  account?: string;
  chainId?: number;
  request?: Eip1193Provider['request'];
} = {}) => {
  const provider = {
    request: request ?? vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') {
        return [account];
      }
      if (method === 'eth_chainId') {
        return COTI_NETWORK.chainIdHex;
      }
      throw new Error(`Unexpected method: ${method}`);
    })
  } as Eip1193Provider;
  const session: BrowserWalletSession = {
    address: account,
    chainId,
    provider,
    source: 'injected',
    walletId: 'metamask',
    walletLabel: 'MetaMask'
  };
  const lease: BrowserWalletSignerLease = {
    activeAddress: account.toLowerCase(),
    activeChainId: chainId,
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: account.toLowerCase(),
    chainId,
    epoch: 7,
    session,
    sessionProvider: provider,
    signingProvider: provider,
    source: session.source
  };
  const state: BrowserWalletSignerLeaseState = {
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: account,
    chainId,
    epoch: lease.epoch,
    session
  };
  return { account, lease, provider, state };
};

describe('revocable shared signer leases', () => {
  it('avoids repeated extension probes with snapshot guards and still refuses a revoked lease', async () => {
    const { lease, provider, state } = createBrowserSignerLeaseFixture();
    for (let i = 0; i < 20; i++) await assertLiveBrowserWalletSignerLease(lease, () => assertBrowserWalletSignerLeaseState(lease, state));
    expect(provider.request).toHaveBeenCalledTimes(40);
    vi.mocked(provider.request).mockClear();
    for (let i = 0; i < 20; i++) assertBrowserWalletSignerLeaseState(lease, state);
    expect(provider.request).not.toHaveBeenCalled();
    const guarded = createLeaseGuardedEip1193Provider(provider, async () => {
      assertBrowserWalletSignerLeaseState(lease, { ...state, epoch: state.epoch + 1 });
    }, () => undefined);
    await expect(guarded.request({ method: 'eth_sendTransaction', params: [] })).rejects.toThrow('lifecycle-epoch');
    expect(provider.request).not.toHaveBeenCalled();
  });
  it('rejects owner signer acquisition when the session changes during a provider await', async () => {
    let resolveAccounts!: (accounts: string[]) => void;
    const accountsResult = new Promise<string[]>((resolve) => {
      resolveAccounts = resolve;
    });
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') {
        return accountsResult;
      }
      if (method === 'eth_chainId') {
        return COTI_NETWORK.chainIdHex;
      }
      throw new Error(`Unexpected method: ${method}`);
    }) as Eip1193Provider['request'];
    const { account, lease, state } = createBrowserSignerLeaseFixture({ request });
    const currentState = { ...state };
    const checking = assertLiveBrowserWalletSignerLease(
      lease,
      () => assertBrowserWalletSignerLeaseState(lease, currentState)
    );

    currentState.epoch += 1;
    resolveAccounts([account]);

    await expect(checking).rejects.toThrow(
      `${BROWSER_WALLET_SIGNER_LEASE_EXPIRED} [lifecycle-epoch]`
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a live owner provider whose selected account no longer matches the lease', async () => {
    const { lease, state } = createBrowserSignerLeaseFixture({
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') {
          return ['0x0000000000000000000000000000000000000012'];
        }
        return COTI_NETWORK.chainIdHex;
      }) as Eip1193Provider['request']
    });

    await expect(
      assertLiveBrowserWalletSignerLease(
        lease,
        () => assertBrowserWalletSignerLeaseState(lease, state)
      )
    ).rejects.toThrow(`${BROWSER_WALLET_SIGNER_LEASE_EXPIRED} [live-account]`);
  });

  it('rejects a live owner provider whose chain no longer matches the lease', async () => {
    const { account, lease, state } = createBrowserSignerLeaseFixture({
      request: vi.fn(async ({ method }: { method: string }) =>
        method === 'eth_accounts' ? [account] : '0x1'
      ) as Eip1193Provider['request']
    });

    await expect(
      assertLiveBrowserWalletSignerLease(
        lease,
        () => assertBrowserWalletSignerLeaseState(lease, state)
      )
    ).rejects.toThrow(`${BROWSER_WALLET_SIGNER_LEASE_EXPIRED} [live-chain]`);
  });

  it('accepts an equivalent React session wrapper without weakening authority checks', () => {
    const { lease, state } = createBrowserSignerLeaseFixture();

    expect(() => assertBrowserWalletSignerLeaseState(lease, {
      ...state,
      session: state.session ? { ...state.session } : null
    })).not.toThrow();

    expect(() => assertBrowserWalletSignerLeaseState(lease, {
      ...state,
      session: state.session
        ? { ...state.session, provider: { request: vi.fn() } as unknown as Eip1193Provider }
        : null
    })).toThrow(`${BROWSER_WALLET_SIGNER_LEASE_EXPIRED} [session-provider]`);
  });

  it('denies cached signing methods after lease revocation without calling the raw signer', async () => {
    const decryptValue = vi.fn(async () => 1n);
    const encryptValue = vi.fn(async () => ({ ciphertext: 1n, signature: '0x01' }));
    const generateOrRecoverAes = vi.fn(async () => undefined);
    const sendUncheckedTransaction = vi.fn(async () => 'broadcast');
    const sendTransaction = vi.fn(async () => 'sent');
    const signMessage = vi.fn(async () => 'signed');
    let onboardInfo: OnboardInfo | undefined = { aesKey: 'owner-aes' } as OnboardInfo;
    const signerAddress = '0x0000000000000000000000000000000000000031';
    const rawSigner = {
      address: signerAddress,
      decryptValue,
      encryptValue,
      generateOrRecoverAes,
      getUserOnboardInfo: () => onboardInfo,
      getAddress: () => signerAddress,
      sendUncheckedTransaction,
      sendTransaction,
      setUserOnboardInfo: (next: OnboardInfo) => {
        onboardInfo = next;
      },
      signMessage
    } as unknown as JsonRpcSigner;
    let current = true;
    const assertCurrent = () => {
      if (!current) {
        throw new Error('lease revoked');
      }
    };
    const guardedSigner = createGuardedSignerLease(rawSigner, assertCurrent, assertCurrent);

    await expect(guardedSigner.signMessage('allowed')).resolves.toBe('signed');
    expect(await guardedSigner.getAddress()).toBe(signerAddress);
    expect(guardedSigner.getUserOnboardInfo()).toMatchObject({ aesKey: 'owner-aes' });
    expect(guardedSigner).toBeInstanceOf(Object);
    current = false;

    await expect(guardedSigner.sendUncheckedTransaction({ to: signerAddress })).rejects.toThrow('lease revoked');
    await expect(guardedSigner.sendTransaction({ to: signerAddress })).rejects.toThrow('lease revoked');
    await expect(guardedSigner.signMessage('denied')).rejects.toThrow('lease revoked');
    for (const method of ['decryptValue', 'encryptValue', 'generateOrRecoverAes'] as const) {
      const guardedMethod = Reflect.get(guardedSigner, method) as () => Promise<unknown>;
      await expect(guardedMethod()).rejects.toThrow('lease revoked');
    }
    expect(() => guardedSigner.getUserOnboardInfo()).toThrow('lease revoked');
    expect(() => guardedSigner.setUserOnboardInfo({ aesKey: 'stale-aes' })).toThrow('lease revoked');
    expect(onboardInfo).toMatchObject({ aesKey: 'owner-aes' });
    expect(sendUncheckedTransaction).not.toHaveBeenCalled();
    expect(decryptValue).not.toHaveBeenCalled();
    expect(encryptValue).not.toHaveBeenCalled();
    expect(generateOrRecoverAes).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it('denies reconnecting a leased browser signer to a new provider', () => {
    const rawSigner = {
      connect: vi.fn(),
      sendUncheckedTransaction: vi.fn()
    } as unknown as JsonRpcSigner;
    const guardedSigner = createGuardedSignerLease(rawSigner, () => {}, () => {});

    expect(() => guardedSigner.connect({} as never)).toThrow(
      'cannot be reconnected to another provider'
    );
    expect(rawSigner.connect).not.toHaveBeenCalled();
  });

  it('rejects a private-key signer before creating a wallet lease', () => {
    const localSigner = {
      privateKey: `0x${'11'.repeat(32)}`,
      sendUncheckedTransaction: vi.fn()
    } as unknown as JsonRpcSigner;

    expect(() => createGuardedSignerLease(localSigner, () => {}, () => {})).toThrow(
      'only accepts a selected browser-wallet signer'
    );
  });

  it('rechecks a browser lease after a deferred decryption before returning plaintext', async () => {
    let releaseDecrypt!: (value: bigint) => void;
    const decryptGate = new Promise<bigint>((resolve) => {
      releaseDecrypt = resolve;
    });
    const decryptValue = vi.fn(() => decryptGate);
    const rawSigner = {
      decryptValue,
      sendUncheckedTransaction: vi.fn()
    } as unknown as JsonRpcSigner;
    let current = true;
    const assertCurrent = () => {
      if (!current) {
        throw new Error('browser lease revoked');
      }
    };
    const guardedSigner = createGuardedSignerLease(rawSigner, assertCurrent, assertCurrent);
    const decrypting = guardedSigner.decryptValue(1n as never);

    await vi.waitFor(() => expect(decryptValue).toHaveBeenCalledTimes(1));
    current = false;
    releaseDecrypt(42n);

    await expect(decrypting).rejects.toThrow('browser lease revoked');
  });

  it('rechecks the synchronous lease snapshot immediately before a queued EIP request', async () => {
    const rawRequest = vi.fn(async () => '0xtransaction');
    let current = true;
    let revocationQueued = false;
    const assertSnapshotCurrent = () => {
      if (!current) {
        throw new Error('browser lease revoked');
      }
    };
    const assertLiveCurrent = () => {
      assertSnapshotCurrent();
      if (!revocationQueued) {
        revocationQueued = true;
        queueMicrotask(() => {
          current = false;
        });
      }
    };
    const provider = createLeaseGuardedEip1193Provider(
      { request: rawRequest } as Eip1193Provider,
      assertLiveCurrent,
      assertSnapshotCurrent
    );

    await expect(provider.request({ method: 'eth_sendTransaction', params: [] })).rejects.toThrow(
      'browser lease revoked'
    );
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('does not export the Snap AES key after the owner lease is revoked during the final key check', async () => {
    const ownerAddress = '0x1111111111111111111111111111111111111111';
    const snapId = 'npm:@coti-io/coti-snap';
    let releaseHasAesKey!: (value: boolean) => void;
    const hasAesKeyGate = new Promise<boolean>((resolve) => {
      releaseHasAesKey = resolve;
    });
    const invokedSnapMethods: string[] = [];
    const rawRequest = vi.fn(async ({ method, params }: {
      method: string;
      params?: { request?: { method?: string } };
    }) => {
      if (method === 'eth_accounts') {
        return [ownerAddress];
      }
      if (method === 'eth_chainId') {
        return COTI_NETWORK.chainIdHex;
      }
      if (method === 'wallet_getSnaps') {
        return { [snapId]: {} };
      }
      if (method === 'wallet_requestSnaps') {
        return { [snapId]: {} };
      }
      if (method === 'wallet_invokeSnap') {
        const snapMethod = params?.request?.method ?? '';
        invokedSnapMethods.push(snapMethod);
        if (snapMethod === 'has-aes-key') {
          return hasAesKeyGate;
        }
        if (snapMethod === 'get-aes-key') {
          return 'must-not-be-exported';
        }
        return true;
      }
      return null;
    });
    const rawProvider = {
      isMetaMask: true,
      request: rawRequest
    } as unknown as Eip1193Provider;
    let current = true;
    const assertSnapshotCurrent = () => {
      if (!current) {
        throw new Error('owner lease revoked');
      }
    };
    const guardedProvider = createLeaseGuardedEip1193Provider(
      rawProvider,
      assertSnapshotCurrent,
      assertSnapshotCurrent
    );
    const loading = getCotiSnapOwnerAesKeyResult(guardedProvider, ownerAddress);
    await vi.waitFor(() => expect(invokedSnapMethods).toContain('has-aes-key'));

    current = false;
    releaseHasAesKey(true);

    await expect(loading).resolves.toMatchObject({ status: 'error' });
    expect(invokedSnapMethods).not.toContain('get-aes-key');
    expect(rawRequest.mock.calls.some(([request]) =>
      request.method === 'wallet_invokeSnap' &&
      (request.params as { request?: { method?: string } } | undefined)?.request?.method === 'get-aes-key'
    )).toBe(false);
  });

  it('does not let a queued stale lease repopulate cleared onboarding state', () => {
    const previous = {};

    expect(
      mergeLeaseScopedOnboardInfo(
        previous,
        '0x0000000000000000000000000000000000000051',
        { aesKey: 'stale-aes' } as OnboardInfo,
        () => {
          throw new Error('lease revoked');
        }
      )
    ).toBe(previous);
  });

  it('preserves onboarding-state identity when a signer reports the same privacy material', () => {
    const cacheKey = '0x0000000000000000000000000000000000000051';
    const previous = {
      [cacheKey]: { aesKey: 'stable-aes', txHash: '0x1234' } as OnboardInfo
    };

    expect(
      mergeLeaseScopedOnboardInfo(
        previous,
        cacheKey,
        { aesKey: 'stable-aes', txHash: '0x1234' } as OnboardInfo,
        () => undefined
      )
    ).toBe(previous);
  });
});
