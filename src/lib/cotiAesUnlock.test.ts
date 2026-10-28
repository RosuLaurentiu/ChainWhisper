import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import type { Eip1193Provider } from './appShared';
import {
  clearFallbackAesSessionOnboardInfo,
  clearCotiAesUnlockRequest,
  clearSignerAesKey,
  createWalletScopedSnapAesState,
  getOrRecoverValidatedAesForWallet,
  getCotiAesWalletSessionKey,
  getOrRecoverAesForWallet,
  getOrRecoverAesForWalletResult,
  readFallbackAesSessionOnboardInfo,
  isWalletScopedPrivateTokenSnapStale,
  repairCotiAesForWallet,
  resetSignerOnboardInfoForFreshAes,
  resolveWalletScopedSnapAesState,
  storeFallbackAesSessionOnboardInfo
} from './cotiAesUnlock';
import { deleteCotiSnapAesKeyResult, getCotiSnapAesKeyResult, storeCotiSnapAesKeyResult } from './cotiSnap';

vi.mock('./cotiSnap', () => ({
  deleteCotiSnapAesKeyResult: vi.fn(),
  getCotiSnapAesKeyResult: vi.fn(),
  storeCotiSnapAesKeyResult: vi.fn()
}));

const walletAddress = '0x1111111111111111111111111111111111111111';
const snapContext = {
  expectedChainId: 2632500,
  walletAddress
};

const provider = (): Eip1193Provider =>
  ({
    request: vi.fn()
  }) as unknown as Eip1193Provider;

const metaMaskProvider = (): Eip1193Provider =>
  ({
    isMetaMask: true,
    request: vi.fn()
  }) as unknown as Eip1193Provider;

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    })
  };
};

const rsaKey = {
  privateKey: new Uint8Array([1, 2, 3]),
  publicKey: new Uint8Array([4, 5, 6])
};

const signer = (initialAesKey?: string, recoverable = false, supportsClear = false) => {
  let onboardInfo: OnboardInfo | undefined = initialAesKey
    ? { aesKey: initialAesKey, ...(recoverable ? { rsaKey, txHash: '0xabc' } : {}) }
    : recoverable
      ? { rsaKey, txHash: '0xabc' }
      : undefined;
  const mockSigner = {
    getUserOnboardInfo: vi.fn(() => onboardInfo),
    setUserOnboardInfo: vi.fn((nextInfo) => {
      onboardInfo = {
        ...(onboardInfo ?? {}),
        ...nextInfo
      };
    }),
    generateOrRecoverAes: vi.fn(async () => {
      if (onboardInfo?.aesKey) {
        return;
      }
      onboardInfo = { ...(onboardInfo ?? {}), aesKey: 'fallback-aes' };
    })
  };
  return supportsClear
    ? {
        ...mockSigner,
        clearUserOnboardInfo: vi.fn(() => {
          onboardInfo = undefined;
        })
      }
    : mockSigner;
};

describe('wallet-scoped Snap AES state', () => {
  it('keys Snap AES state by wallet and provider', () => {
    const firstProvider = provider();
    const secondProvider = provider();
    expect(getCotiAesWalletSessionKey(' 0xABC ', firstProvider)).toBe(
      getCotiAesWalletSessionKey('0xabc', firstProvider)
    );
    expect(getCotiAesWalletSessionKey(walletAddress, firstProvider)).not.toBe(
      getCotiAesWalletSessionKey(walletAddress, secondProvider)
    );
  });

  it('does not leak stale-token state across wallets', () => {
    const activeProvider = provider();
    const staleState = createWalletScopedSnapAesState({
      provider: activeProvider,
      staleTokenAddresses: ['0x2222222222222222222222222222222222222222'],
      status: 'installed-aes-stale',
      walletAddress
    });

    expect(resolveWalletScopedSnapAesState(staleState, walletAddress, activeProvider)).toBe(staleState);
    expect(
      isWalletScopedPrivateTokenSnapStale(
        staleState,
        walletAddress,
        '0x2222222222222222222222222222222222222222',
        activeProvider
      )
    ).toBe(true);
    expect(
      isWalletScopedPrivateTokenSnapStale(
        staleState,
        '0x3333333333333333333333333333333333333333',
        '0x2222222222222222222222222222222222222222',
        activeProvider
      )
    ).toBe(false);
    expect(
      isWalletScopedPrivateTokenSnapStale(
        staleState,
        walletAddress,
        '0x4444444444444444444444444444444444444444',
        activeProvider
      )
    ).toBe(false);
  });

  it('normalizes an in-memory state preserved from before stale-token tracking', () => {
    const activeProvider = provider();
    const current = createWalletScopedSnapAesState({
      provider: activeProvider,
      status: 'installed-aes-ready',
      walletAddress
    });
    const legacyState = {
      sessionKey: current.sessionKey,
      status: current.status,
      walletKey: current.walletKey
    } as never;

    expect(resolveWalletScopedSnapAesState(legacyState, walletAddress, activeProvider)).toMatchObject({
      staleTokenAddresses: []
    });
  });
});

describe('getOrRecoverAesForWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCotiAesUnlockRequest(walletAddress);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: createMemoryStorage()
      }
    });
  });

  it('reuses one in-flight Snap AES request per wallet and provider', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ready', aesKey: 'snap-aes' }), 1))
    );

    const [first, second] = await Promise.all([
      getOrRecoverAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      }),
      getOrRecoverAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ]);

    expect(first).toMatchObject({ aesKey: 'snap-aes' });
    expect(second).toMatchObject({ aesKey: 'snap-aes' });
    expect(getCotiSnapAesKeyResult).toHaveBeenCalledTimes(1);
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('reuses one in-flight fallback AES request for provider-less privacy signers', async () => {
    const firstSigner = signer();
    const secondSigner = signer();

    const [first, second] = await Promise.all([
      getOrRecoverAesForWallet({
        signer: firstSigner as never,
        walletAddress
      }),
      getOrRecoverAesForWallet({
        signer: secondSigner as never,
        walletAddress
      })
    ]);

    expect(first).toMatchObject({ aesKey: 'fallback-aes' });
    expect(second).toMatchObject({ aesKey: 'fallback-aes' });
    expect(getCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(firstSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(secondSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(secondSigner.setUserOnboardInfo).toHaveBeenCalledWith({ aesKey: 'fallback-aes' });
  });

  it.each([
    { clearMode: 'wallet-wide clear', passProvider: false },
    { clearMode: 'provider-bound disconnect clear', passProvider: true }
  ])('invalidates every provider fallback request after $clearMode', async ({ passProvider }) => {
    const firstProvider = metaMaskProvider();
    const secondProvider = provider();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    const createDeferredSigner = (aesKey: string) => {
      let onboardInfo: OnboardInfo | undefined;
      let releaseRecovery = () => {};
      const recoveryGate = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });
      return {
        releaseRecovery,
        signer: {
          generateOrRecoverAes: vi.fn(async () => {
            await recoveryGate;
            onboardInfo = { ...(onboardInfo ?? {}), aesKey } as OnboardInfo;
          }),
          getUserOnboardInfo: vi.fn(() => onboardInfo),
          setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
            onboardInfo = { ...(onboardInfo ?? {}), ...nextInfo } as OnboardInfo;
          })
        }
      };
    };

    const firstDeferred = createDeferredSigner('late-first-provider-aes');
    const secondDeferred = createDeferredSigner('late-second-provider-aes');
    const firstUnlock = getOrRecoverAesForWallet({
      provider: firstProvider,
      signer: firstDeferred.signer as never,
      walletAddress
    });
    const secondUnlock = getOrRecoverAesForWallet({
      provider: secondProvider,
      signer: secondDeferred.signer as never,
      walletAddress
    });
    const firstRejection = expect(firstUnlock).rejects.toThrow('wallet session changed');
    const secondRejection = expect(secondUnlock).rejects.toThrow('wallet session changed');

    await vi.waitFor(() => {
      expect(firstDeferred.signer.generateOrRecoverAes).toHaveBeenCalledTimes(1);
      expect(secondDeferred.signer.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    });

    clearCotiAesUnlockRequest(walletAddress, passProvider ? firstProvider : undefined);

    const freshSigner = signer();
    await expect(
      getOrRecoverAesForWallet({
        provider: firstProvider,
        signer: freshSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    firstDeferred.releaseRecovery();
    secondDeferred.releaseRecovery();
    await Promise.all([firstRejection, secondRejection]);

    expect(readFallbackAesSessionOnboardInfo(walletAddress, firstProvider)).toMatchObject({
      aesKey: 'fallback-aes'
    });
    expect(readFallbackAesSessionOnboardInfo(walletAddress, secondProvider)).toBeNull();
  });

  it('clears late signer onboarding state when fallback recovery settles after disconnect', async () => {
    const activeProvider = metaMaskProvider();
    let onboardInfo: OnboardInfo | undefined;
    let releaseRecovery = () => {};
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const activeSigner = {
      generateOrRecoverAes: vi.fn(async () => {
        await recoveryGate;
        onboardInfo = {
          aesKey: 'late-disconnected-aes',
          rsaKey,
          txHash: '0xlate'
        } as OnboardInfo;
      }),
      getUserOnboardInfo: vi.fn(() => onboardInfo),
      setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
        onboardInfo = { ...(onboardInfo ?? {}), ...nextInfo } as OnboardInfo;
      })
    };
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    const unlockOutcome = getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => {
      expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    });

    clearCotiAesUnlockRequest(walletAddress, activeProvider);
    releaseRecovery();

    const outcome = await unlockOutcome;
    expect('error' in outcome ? outcome.error : null).toBeInstanceOf(Error);
    expect('error' in outcome ? String(outcome.error) : '').toContain('wallet session changed');
    expect(activeSigner.getUserOnboardInfo()).toEqual({
      aesKey: null,
      rsaKey: null,
      txHash: null
    });
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
  });

  it('checks the caller lifecycle immediately before fallback recovery after an earlier await', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    let lifecycleCurrent = true;
    let releaseSnap = (result: { status: 'missing-aes' }) => {
      void result;
    };
    const snapGate = new Promise<{ status: 'missing-aes' }>((resolve) => {
      releaseSnap = resolve;
    });
    vi.mocked(getCotiSnapAesKeyResult).mockReturnValue(snapGate);

    const unlock = getOrRecoverAesForWallet({
      assertCurrent: () => {
        if (!lifecycleCurrent) {
          throw new Error('wallet lifecycle expired');
        }
      },
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    });
    await vi.waitFor(() => {
      expect(getCotiSnapAesKeyResult).toHaveBeenCalledTimes(1);
    });

    lifecycleCurrent = false;
    releaseSnap({ status: 'missing-aes' });

    await expect(unlock).rejects.toThrow('wallet lifecycle expired');
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
  });

  it('salvages full onboarding metadata without returning or persisting fallback AES when recovery finishes stale', async () => {
    const activeProvider = metaMaskProvider();
    let lifecycleCurrent = true;
    let onboardInfo: OnboardInfo | undefined;
    let releaseRecovery = () => {};
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const activeSigner = {
      generateOrRecoverAes: vi.fn(async () => {
        await recoveryGate;
        onboardInfo = {
          aesKey: 'late-lifecycle-aes',
          rsaKey,
          txHash: '0xlifecycle'
        } as OnboardInfo;
      }),
      getUserOnboardInfo: vi.fn(() => onboardInfo),
      setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
        onboardInfo = { ...(onboardInfo ?? {}), ...nextInfo } as OnboardInfo;
      })
    };
    const onInvalidatedOnboardInfo = vi.fn();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    const unlock = getOrRecoverAesForWallet({
      assertCurrent: () => {
        if (!lifecycleCurrent) {
          throw new Error('wallet lifecycle expired');
        }
      },
      onInvalidatedOnboardInfo,
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    });
    await vi.waitFor(() => {
      expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    });

    lifecycleCurrent = false;
    releaseRecovery();

    await expect(unlock).rejects.toThrow('wallet lifecycle expired');
    expect(onInvalidatedOnboardInfo).toHaveBeenCalledTimes(1);
    expect(onInvalidatedOnboardInfo).toHaveBeenCalledWith({
      onboardInfo: {
        aesKey: 'late-lifecycle-aes',
        rsaKey,
        txHash: '0xlifecycle'
      },
      walletAddress
    });
    const salvagedOnboardInfo = onInvalidatedOnboardInfo.mock.calls[0]?.[0]?.onboardInfo as
      | OnboardInfo
      | undefined;
    expect(salvagedOnboardInfo?.rsaKey?.privateKey).not.toBe(rsaKey.privateKey);
    expect(salvagedOnboardInfo?.rsaKey?.publicKey).not.toBe(rsaKey.publicKey);
    expect(activeSigner.getUserOnboardInfo()).toEqual({
      aesKey: null,
      rsaKey: null,
      txHash: null
    });
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
  });

  it('keeps the signer recovery copy and original stale error when invalidated onboarding salvage fails', async () => {
    const activeProvider = metaMaskProvider();
    let lifecycleCurrent = true;
    let onboardInfo: OnboardInfo | undefined;
    let releaseRecovery = () => {};
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const activeSigner = {
      generateOrRecoverAes: vi.fn(async () => {
        await recoveryGate;
        onboardInfo = {
          aesKey: 'retained-recovery-aes',
          rsaKey,
          txHash: '0xretained'
        } as OnboardInfo;
      }),
      getUserOnboardInfo: vi.fn(() => onboardInfo),
      setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
        onboardInfo = { ...(onboardInfo ?? {}), ...nextInfo } as OnboardInfo;
      })
    };
    const onInvalidatedOnboardInfo = vi.fn(() => {
      throw new Error('address-bound salvage failed');
    });
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    const unlockOutcome = getOrRecoverAesForWallet({
      assertCurrent: () => {
        if (!lifecycleCurrent) {
          throw new Error('wallet lifecycle expired');
        }
      },
      onInvalidatedOnboardInfo,
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => {
      expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    });

    lifecycleCurrent = false;
    releaseRecovery();

    const outcome = await unlockOutcome;
    expect('value' in outcome).toBe(false);
    expect('error' in outcome ? String(outcome.error) : '').toContain('wallet lifecycle expired');
    expect('error' in outcome ? String(outcome.error) : '').not.toContain('address-bound salvage failed');
    expect(onInvalidatedOnboardInfo).toHaveBeenCalledTimes(1);
    expect(activeSigner.getUserOnboardInfo()).toMatchObject({
      aesKey: 'retained-recovery-aes',
      rsaKey,
      txHash: '0xretained'
    });
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
  });

  it('serializes a replacement fallback unlock on the same signer after disconnect', async () => {
    const activeProvider = metaMaskProvider();
    let onboardInfo: OnboardInfo | undefined;
    let releaseOldRecovery = () => {};
    let releaseNewRecovery = () => {};
    const oldRecoveryGate = new Promise<void>((resolve) => {
      releaseOldRecovery = resolve;
    });
    const newRecoveryGate = new Promise<void>((resolve) => {
      releaseNewRecovery = resolve;
    });
    let recoveryCall = 0;
    const activeSigner = {
      generateOrRecoverAes: vi.fn(async () => {
        const call = recoveryCall;
        recoveryCall += 1;
        if (call === 0) {
          await oldRecoveryGate;
          onboardInfo = {
            aesKey: 'old-aes',
            rsaKey,
            txHash: '0xold'
          } as OnboardInfo;
          return;
        }
        await newRecoveryGate;
        onboardInfo = {
          aesKey: 'new-aes',
          rsaKey,
          txHash: '0xnew'
        } as OnboardInfo;
      }),
      getUserOnboardInfo: vi.fn(() => onboardInfo),
      setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
        onboardInfo = { ...(onboardInfo ?? {}), ...nextInfo } as OnboardInfo;
      })
    };
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    const oldOutcome = getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => {
      expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    });

    clearCotiAesUnlockRequest(walletAddress, activeProvider);
    const newOutcome = getOrRecoverAesForWallet({
      forceRefresh: true,
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    const recoveryCallsBeforeOldSettled = activeSigner.generateOrRecoverAes.mock.calls.length;
    releaseNewRecovery();
    await Promise.resolve();
    releaseOldRecovery();

    const [oldResult, newResult] = await Promise.all([oldOutcome, newOutcome]);
    expect(recoveryCallsBeforeOldSettled).toBe(1);
    expect('error' in oldResult ? String(oldResult.error) : '').toContain('wallet session changed');
    expect('value' in newResult ? newResult.value : null).toMatchObject({
      aesKey: 'new-aes',
      rsaKey,
      txHash: '0xnew'
    });
    expect(activeSigner.getUserOnboardInfo()).toMatchObject({
      aesKey: 'new-aes',
      rsaKey,
      txHash: '0xnew'
    });
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toMatchObject({
      aesKey: 'new-aes'
    });
  });

  it('rechecks the wallet epoch before an in-flight waiter applies AES to its signer', async () => {
    const activeProvider = provider();
    let releaseSnap = (result: { status: 'ready'; aesKey: string }) => {
      void result;
    };
    const snapGate = new Promise<{ status: 'ready'; aesKey: string }>((resolve) => {
      releaseSnap = resolve;
    });
    const primarySigner = signer();
    const waitingSigner = signer();
    primarySigner.setUserOnboardInfo.mockImplementation((nextInfo: OnboardInfo) => {
      queueMicrotask(() => clearCotiAesUnlockRequest(walletAddress, activeProvider));
      return nextInfo;
    });
    vi.mocked(getCotiSnapAesKeyResult).mockReturnValue(snapGate);

    const primaryOutcome = getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: primarySigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => {
      expect(getCotiSnapAesKeyResult).toHaveBeenCalledTimes(1);
    });
    const waiterOutcome = getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: waitingSigner as never,
      walletAddress
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => {
      expect(waitingSigner.getUserOnboardInfo).toHaveBeenCalled();
    });

    releaseSnap({ status: 'ready', aesKey: 'stale-snap-aes' });

    const [primaryResult, waiterResult] = await Promise.all([primaryOutcome, waiterOutcome]);
    expect('error' in primaryResult ? String(primaryResult.error) : '').toContain('wallet session changed');
    expect('error' in waiterResult ? String(waiterResult.error) : '').toContain('wallet session changed');
    expect(waitingSigner.setUserOnboardInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({ aesKey: 'stale-snap-aes' })
    );
  });

  it('rechecks each caller lifecycle before an in-flight waiter applies AES to its signer', async () => {
    const activeProvider = provider();
    let waiterCurrent = true;
    let releaseSnap = (result: { status: 'ready'; aesKey: string }) => {
      void result;
    };
    const snapGate = new Promise<{ status: 'ready'; aesKey: string }>((resolve) => {
      releaseSnap = resolve;
    });
    const primarySigner = signer();
    const waitingSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockReturnValue(snapGate);

    const primaryOutcome = getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: primarySigner as never,
      walletAddress
    });
    await vi.waitFor(() => {
      expect(getCotiSnapAesKeyResult).toHaveBeenCalledTimes(1);
    });
    const waiterOutcome = getOrRecoverAesForWallet({
      assertCurrent: () => {
        if (!waiterCurrent) {
          throw new Error('waiter lifecycle expired');
        }
      },
      provider: activeProvider,
      signer: waitingSigner as never,
      walletAddress
    });

    waiterCurrent = false;
    releaseSnap({ status: 'ready', aesKey: 'shared-snap-aes' });

    await expect(primaryOutcome).resolves.toMatchObject({ aesKey: 'shared-snap-aes' });
    await expect(waiterOutcome).rejects.toThrow('waiter lifecycle expired');
    expect(waitingSigner.setUserOnboardInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({ aesKey: 'shared-snap-aes' })
    );
  });

  it('stops after Snap returns AES and does not ask for the legacy wallet signature', async () => {
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });

    await expect(
      getOrRecoverAesForWallet({
        provider: provider(),
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'snap-aes' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(activeSigner.setUserOnboardInfo).toHaveBeenCalledWith({ aesKey: 'snap-aes' });
  });

  it('can force a fresh Snap AES read even when a stale key is cached', async () => {
    const activeProvider = provider();
    const activeSigner = signer('stale-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'fresh-snap-aes' });

    await expect(
      getOrRecoverAesForWallet({
        forceRefresh: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fresh-snap-aes' });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(activeSigner.setUserOnboardInfo).toHaveBeenCalledWith({ aesKey: 'fresh-snap-aes' });
  });

  it('keeps the cached AES key when no explicit refresh is requested', async () => {
    const activeSigner = signer('cached-aes');

    await expect(
      getOrRecoverAesForWallet({
        provider: provider(),
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'cached-aes' });

    expect(getCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('checks Snap before a cached fallback AES key when Snap is preferred', async () => {
    const activeProvider = provider();
    const activeSigner = signer('cached-fallback-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });

    await expect(
      getOrRecoverAesForWalletResult({
        preferSnapAes: true,
        provider: activeProvider,
        requireSnapAes: true,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'snap-aes' },
      source: 'snap'
    });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('reuses the cached fallback only after preferred Snap is unsupported', async () => {
    const activeProvider = provider();
    const activeSigner = signer('cached-fallback-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported' });

    await expect(
      getOrRecoverAesForWalletResult({
        preferSnapAes: true,
        provider: activeProvider,
        requireSnapAes: true,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'cached-fallback-aes' },
      source: 'cache'
    });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('checks preferred Snap before a stored fallback session AES key', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    storeFallbackAesSessionOnboardInfo(
      walletAddress,
      activeProvider,
      { aesKey: 'stored-fallback-aes' } as OnboardInfo
    );
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({
      status: 'ready',
      aesKey: 'snap-aes'
    });

    await expect(
      getOrRecoverAesForWalletResult({
        preferSnapAes: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'snap-aes' },
      source: 'snap'
    });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('falls back to signer recovery only when Snap has no AES', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'missing-aes' });

    await expect(
      getOrRecoverAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('never sends a MetaMask Snap RPC to a known non-MetaMask wallet', async () => {
    const cipherTradeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockRejectedValue(
      new Error('CipherTrade must never receive wallet_invokeSnap')
    );

    await expect(
      getOrRecoverAesForWalletResult({
        allowLegacyFallback: true,
        probeSnapAes: false,
        provider: cipherTradeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });

    expect(getCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledOnce();
  });

  it('keeps fallback AES in memory only and binds it to the exact provider instance', async () => {
    const firstProvider = metaMaskProvider();
    const firstSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    await expect(
      getOrRecoverAesForWallet({
        provider: firstProvider,
        signer: firstSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    expect(readFallbackAesSessionOnboardInfo(walletAddress, firstProvider)).toMatchObject({
      aesKey: 'fallback-aes'
    });
    expect(window.sessionStorage.length).toBe(0);

    vi.mocked(getCotiSnapAesKeyResult).mockClear();
    const secondSigner = signer();
    await expect(
      getOrRecoverAesForWallet({
        provider: firstProvider,
        signer: secondSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    expect(getCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(secondSigner.generateOrRecoverAes).not.toHaveBeenCalled();

    const replacementProvider = metaMaskProvider();
    const replacementSigner = signer();
    await expect(
      getOrRecoverAesForWallet({
        provider: replacementProvider,
        signer: replacementSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(replacementProvider, snapContext);
    expect(replacementSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('purges legacy plaintext fallback AES from session storage without rehydrating it', () => {
    const activeProvider = metaMaskProvider();
    const legacyStorageKey = `chainwhisper:fallback-aes:v1:${getCotiAesWalletSessionKey(
      walletAddress,
      activeProvider
    )}`;
    window.sessionStorage.setItem(legacyStorageKey, JSON.stringify({
      aesKey: 'legacy-plaintext-aes',
      chainId: 2632500,
      providerId: 'metamask',
      walletKey: walletAddress.toLowerCase()
    }));

    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
    expect(window.sessionStorage.getItem(legacyStorageKey)).toBeNull();
  });

  it('clears wallet-scoped fallback AES from the in-memory session cache', async () => {
    const activeProvider = metaMaskProvider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });
    await getOrRecoverAesForWallet({
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    });

    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toMatchObject({
      aesKey: 'fallback-aes'
    });
    clearFallbackAesSessionOnboardInfo(walletAddress, activeProvider);
    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
  });

  it('clears every fallback AES provider session for one wallet when no provider is supplied', () => {
    const activeProvider = metaMaskProvider();
    const otherProvider = provider();
    const otherWallet = '0x2222222222222222222222222222222222222222';

    storeFallbackAesSessionOnboardInfo(walletAddress, activeProvider, { aesKey: 'wallet-aes-one' } as OnboardInfo);
    storeFallbackAesSessionOnboardInfo(walletAddress, otherProvider, { aesKey: 'wallet-aes-two' } as OnboardInfo);
    storeFallbackAesSessionOnboardInfo(otherWallet, activeProvider, { aesKey: 'other-wallet-aes' } as OnboardInfo);

    clearFallbackAesSessionOnboardInfo(walletAddress);

    expect(readFallbackAesSessionOnboardInfo(walletAddress, activeProvider)).toBeNull();
    expect(readFallbackAesSessionOnboardInfo(walletAddress, otherProvider)).toBeNull();
    expect(readFallbackAesSessionOnboardInfo(otherWallet, activeProvider)).toMatchObject({
      aesKey: 'other-wallet-aes'
    });
  });

  it('does not fall back to legacy AES when a MetaMask Snap AES key is required but missing', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'missing-aes' });

    await expect(
      getOrRecoverAesForWalletResult({
        provider: activeProvider,
        requireSnapAes: true,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ status: 'fallback-unavailable', reason: 'missing-aes' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('allows mobile Snap-unsupported wallets to use fallback AES even when Snap is preferred', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'unsupported-mobile' });

    await expect(
      getOrRecoverAesForWalletResult({
        provider: activeProvider,
        requireSnapAes: true,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });

    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('checks preferred Snap before the fallback AES signature when Snap has no AES', async () => {
    const calls: string[] = [];
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockImplementation(async () => {
      calls.push('snap');
      return { status: 'missing-aes' };
    });
    activeSigner.generateOrRecoverAes.mockImplementation(async () => {
      calls.push('fallback');
      activeSigner.setUserOnboardInfo({ aesKey: 'fallback-aes' } as OnboardInfo);
    });

    await getOrRecoverAesForWalletResult({
      preferSnapAes: true,
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    });

    expect(calls).toEqual(['snap', 'fallback']);
  });

  it('stops without opening the fallback signer flow when the Snap request is rejected', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'rejected' });

    await expect(
      getOrRecoverAesForWalletResult({
        preferSnapAes: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'fallback-unavailable',
      reason: 'rejected'
    });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('suppresses the duplicate COTI onboard console line while keeping the thrown error', async () => {
    const activeSigner = signer();
    activeSigner.generateOrRecoverAes.mockImplementation(async () => {
      console.error('unable to onboard user.');
      throw new Error('unable to onboard user.');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        getOrRecoverAesForWallet({
          signer: activeSigner as never,
          walletAddress
        })
      ).rejects.toThrow('unable to onboard user.');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('can report Snap failure without running the legacy fallback', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'rejected' });

    await expect(
      getOrRecoverAesForWalletResult({
        allowLegacyFallback: false,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ status: 'fallback-unavailable', reason: 'rejected' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('runs signer recovery for the explicit legacy repair phase', async () => {
    const activeProvider = provider();
    const activeSigner = signer('stale-snap-aes', true);
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });

    await expect(
      getOrRecoverAesForWalletResult({
        forceLegacyRefresh: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });

    expect(getCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('does not silently generate a new AES during stale-key refresh without recoverable info', async () => {
    const activeSigner = signer('stale-snap-aes');

    await expect(
      getOrRecoverAesForWalletResult({
        forceLegacyRefresh: true,
        provider: provider(),
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ status: 'fallback-unavailable', reason: 'unrecoverable' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('can explicitly recover an unrecoverable bad Snap AES into app session without editing Snap storage', async () => {
    const activeProvider = provider();
    const activeSigner = signer('stale-snap-aes');

    await expect(
      getOrRecoverAesForWalletResult({
        allowUnrecoverableReset: true,
        forceLegacyRefresh: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });

    expect(deleteCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('keeps recovered AES ready in app session without persisting it to Snap', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'missing-aes' });

    await expect(
      getOrRecoverAesForWalletResult({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('clears recoverable onboarding metadata before making a fresh AES key', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes', true);

    await expect(
      getOrRecoverAesForWalletResult({
        allowUnrecoverableReset: true,
        forceFreshAes: true,
        forceLegacyRefresh: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes', rsaKey: null, txHash: null },
      source: 'fallback'
    });

    expect(activeSigner.setUserOnboardInfo).toHaveBeenCalledWith({
      aesKey: null,
      rsaKey: null,
      txHash: null
    });
    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(deleteCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('does not fall back to legacy recovery when Snap is connected to a different wallet', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'wallet-mismatch' });

    await expect(
      getOrRecoverAesForWalletResult({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ status: 'fallback-unavailable', reason: 'wallet-mismatch' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('repairs a mismatched wallet through the explicit repair helper', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'wrong-snap-aes' });

    await expect(
      repairCotiAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        validationProbes: [
          {
            name: 'private-token-balance',
            validate: (_signer, onboardInfo) => onboardInfo.aesKey === 'fallback-aes'
          }
        ],
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      validation: { passedProbes: ['private-token-balance'] }
    });

    expect(getCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(deleteCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('preserves recoverable onboarding metadata when clearing only a bad AES key', () => {
    let onboardInfo = { aesKey: 'wrong-aes', rsaKey, txHash: '0xabc' } as OnboardInfo;
    const replacingSigner = {
      generateOrRecoverAes: vi.fn(),
      getUserOnboardInfo: vi.fn(() => onboardInfo),
      setUserOnboardInfo: vi.fn((nextInfo: OnboardInfo) => {
        onboardInfo = nextInfo;
      })
    };

    clearSignerAesKey(replacingSigner as never);

    expect(replacingSigner.setUserOnboardInfo).toHaveBeenCalledWith({
      aesKey: null,
      rsaKey,
      txHash: '0xabc'
    });
    expect(onboardInfo).toMatchObject({
      aesKey: null,
      rsaKey,
      txHash: '0xabc'
    });
  });

  it('can repair recovery AES without allowing a fresh unrecoverable AES reset', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes', true);
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'wrong-snap-aes' });

    await expect(
      repairCotiAesForWallet({
        allowUnrecoverableReset: false,
        provider: activeProvider,
        signer: activeSigner as never,
        validationProbes: [
          {
            name: 'privacy-key-recovery',
            validate: (_signer, onboardInfo) => onboardInfo.aesKey === 'fallback-aes'
          }
        ],
        walletAddress
      })
    ).resolves.toMatchObject({
      source: 'fallback',
      status: 'ready',
      validation: { passedProbes: ['privacy-key-recovery'] }
    });

    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(activeSigner.getUserOnboardInfo()).toMatchObject({
      aesKey: 'fallback-aes',
      rsaKey,
      txHash: '0xabc'
    });
  });

  it('does not create a fresh AES during recovery repair when metadata is unrecoverable', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'wrong-snap-aes' });

    await expect(
      repairCotiAesForWallet({
        allowUnrecoverableReset: false,
        provider: activeProvider,
        signer: activeSigner as never,
        validationProbes: [
          {
            name: 'privacy-key-recovery',
            validate: (_signer, onboardInfo) => onboardInfo.aesKey === 'fallback-aes'
          }
        ],
        walletAddress
      })
    ).resolves.toMatchObject({ status: 'fallback-unavailable', reason: 'unrecoverable' });

    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('stops repair after a fresh Snap AES validates', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes');
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'fresh-snap-aes' });

    await expect(
      repairCotiAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        validationProbes: [
          {
            name: 'private-token-balance',
            validate: (_signer, onboardInfo) => onboardInfo.aesKey === 'fresh-snap-aes'
          }
        ],
        walletAddress
      })
    ).resolves.toMatchObject({
      source: 'snap',
      status: 'ready',
      validation: { passedProbes: ['private-token-balance'] }
    });

    expect(deleteCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(activeSigner.generateOrRecoverAes).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('resetSignerOnboardInfoForFreshAes removes AES and recoverable metadata', () => {
    const activeSigner = signer('wrong-aes', true);

    resetSignerOnboardInfoForFreshAes(activeSigner as never);

    expect(activeSigner.getUserOnboardInfo()).toMatchObject({
      aesKey: null,
      rsaKey: null,
      txHash: null
    });
  });

  it('uses clearUserOnboardInfo when the COTI signer exposes a hard reset API', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes', true, true);

    await expect(
      getOrRecoverAesForWalletResult({
        allowUnrecoverableReset: true,
        forceFreshAes: true,
        forceLegacyRefresh: true,
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      onboardInfo: { aesKey: 'fallback-aes' },
      source: 'fallback'
    });

    expect('clearUserOnboardInfo' in activeSigner ? activeSigner.clearUserOnboardInfo : null).toHaveBeenCalledTimes(1);
    expect(activeSigner.setUserOnboardInfo).not.toHaveBeenCalledWith({
      aesKey: null,
      rsaKey: null,
      txHash: null
    });
    expect(activeSigner.getUserOnboardInfo()).toMatchObject({
      aesKey: 'fallback-aes'
    });
    expect(activeSigner.getUserOnboardInfo()).not.toHaveProperty('rsaKey');
    expect(activeSigner.getUserOnboardInfo()).not.toHaveProperty('txHash');
    expect(deleteCotiSnapAesKeyResult).not.toHaveBeenCalled();
    expect(storeCotiSnapAesKeyResult).not.toHaveBeenCalled();
  });

  it('marks Snap AES as mismatched when validation probes fail and clears the signer AES', async () => {
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'wrong-aes' });

    await expect(
      getOrRecoverValidatedAesForWallet({
        provider: provider(),
        signer: activeSigner as never,
        validationProbes: [{ name: 'chat', validate: () => false }],
        walletAddress
      })
    ).resolves.toMatchObject({
      source: 'snap',
      status: 'key-mismatch',
      validation: { failedProbes: ['chat'] }
    });

    expect(activeSigner.getUserOnboardInfo()).toMatchObject({ aesKey: null });
  });

  it('reports ready-unverified when no validation probe exists yet', async () => {
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });

    await expect(
      getOrRecoverValidatedAesForWallet({
        provider: provider(),
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({
      source: 'snap',
      status: 'ready-unverified',
      validation: { status: 'ready-unverified' }
    });
  });
});
