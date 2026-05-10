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

  it('checks Snap before the fallback AES signature when fallback is needed', async () => {
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
      provider: activeProvider,
      signer: activeSigner as never,
      walletAddress
    });

    expect(calls).toEqual(['snap', 'fallback']);
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
