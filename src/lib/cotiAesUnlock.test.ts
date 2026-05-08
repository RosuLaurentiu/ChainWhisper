import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import type { Eip1193Provider } from './appShared';
import {
  clearCotiAesUnlockRequest,
  createWalletScopedSnapAesState,
  getOrRecoverValidatedAesForWallet,
  getCotiAesWalletSessionKey,
  getOrRecoverAesForWallet,
  getOrRecoverAesForWalletResult,
  isWalletScopedPrivateTokenSnapStale,
  repairCotiAesForWallet,
  resetSignerOnboardInfoForFreshAes,
  resolveWalletScopedSnapAesState
} from './cotiAesUnlock';
import { deleteCotiSnapAesKeyResult, getCotiSnapAesKeyResult, storeCotiSnapAesKey } from './cotiSnap';

vi.mock('./cotiSnap', () => ({
  deleteCotiSnapAesKeyResult: vi.fn(),
  getCotiSnapAesKeyResult: vi.fn(),
  storeCotiSnapAesKey: vi.fn()
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
});

describe('getOrRecoverAesForWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCotiAesUnlockRequest(walletAddress);
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

  it('falls back to signer recovery only when Snap has no AES', async () => {
    const activeProvider = provider();
    const activeSigner = signer();
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'missing-aes' });
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

    await expect(
      getOrRecoverAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        walletAddress
      })
    ).resolves.toMatchObject({ aesKey: 'fallback-aes' });

    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKey).toHaveBeenCalledWith(activeProvider, 'fallback-aes', snapContext);
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
    expect(storeCotiSnapAesKey).not.toHaveBeenCalled();
  });

  it('runs signer recovery only for an explicit stale-key refresh', async () => {
    const activeProvider = provider();
    const activeSigner = signer('stale-snap-aes', true);
    vi.mocked(getCotiSnapAesKeyResult).mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

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
    expect(storeCotiSnapAesKey).toHaveBeenCalledWith(activeProvider, 'fallback-aes', snapContext);
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

  it('can explicitly reset an unrecoverable bad Snap AES and store the refreshed key', async () => {
    const activeProvider = provider();
    const activeSigner = signer('stale-snap-aes');
    vi.mocked(deleteCotiSnapAesKeyResult).mockResolvedValue('ready');
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

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

    expect(deleteCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(activeSigner.generateOrRecoverAes).toHaveBeenCalledTimes(1);
    expect(storeCotiSnapAesKey).toHaveBeenCalledWith(activeProvider, 'fallback-aes', snapContext);
  });

  it('clears recoverable onboarding metadata before making a fresh AES key', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes', true);
    vi.mocked(deleteCotiSnapAesKeyResult).mockResolvedValue('ready');
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

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
    expect(storeCotiSnapAesKey).toHaveBeenCalledWith(activeProvider, 'fallback-aes', snapContext);
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
    expect(storeCotiSnapAesKey).not.toHaveBeenCalled();
  });

  it('repairs a mismatched wallet through the explicit repair helper', async () => {
    const activeProvider = provider();
    const activeSigner = signer('wrong-aes');
    vi.mocked(deleteCotiSnapAesKeyResult).mockResolvedValue('ready');
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

    await expect(
      repairCotiAesForWallet({
        provider: activeProvider,
        signer: activeSigner as never,
        validationProbes: [{ name: 'private-token-balance', validate: () => true }],
        walletAddress
      })
    ).resolves.toMatchObject({
      status: 'ready',
      validation: { passedProbes: ['private-token-balance'] }
    });

    expect(deleteCotiSnapAesKeyResult).toHaveBeenCalledWith(activeProvider, snapContext);
    expect(storeCotiSnapAesKey).toHaveBeenCalledWith(activeProvider, 'fallback-aes', snapContext);
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
    vi.mocked(deleteCotiSnapAesKeyResult).mockResolvedValue('ready');
    vi.mocked(storeCotiSnapAesKey).mockResolvedValue(undefined);

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
