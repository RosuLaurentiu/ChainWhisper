import type { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COTI_NETWORK,
  type CotiReadProvider,
  type InjectedEthereumProvider
} from '../../lib/appShared';
import {
  issueOwnerCotiMetaMaskCapability,
  releaseOwnerCotiMetaMaskProviderPool
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSession, BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

const privacyMocks = vi.hoisted(() => ({
  recover: vi.fn(async ({ signer }: {
    signer: { setUserOnboardInfo: (value: { aesKey: string }) => void };
  }) => {
    const onboardInfo = { aesKey: 'ciphertrade-session-aes' };
    signer.setUserOnboardInfo(onboardInfo);
    return { status: 'ready' as const, onboardInfo, source: 'fallback' as const };
  }),
  snap: vi.fn(async () => ({ status: 'unsupported' as const }))
}));

vi.mock('../../lib/cotiAesUnlock', () => ({
  getOrRecoverAesForWalletResult: privacyMocks.recover
}));

vi.mock('../../lib/cotiSnap', () => ({
  getCotiSnapOwnerAesKeyResult: privacyMocks.snap,
  getCotiSnapOwnerAesStatusMessage: (status: string) => status
}));

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = COTI_NETWORK.chainIdDecimal;

type CapturedBinding = Readonly<{
  browserProvider: BrowserProvider;
  readProvider: CotiReadProvider;
  signer: JsonRpcSigner;
}>;

const createLease = (epoch = 1): BrowserWalletSignerLease => {
  const provider: InjectedEthereumProvider = {
    isMetaMask: true,
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_accounts') return [OWNER];
      if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
      return null;
    })
  };
  const session: BrowserWalletSession = {
    address: OWNER,
    chainId: CHAIN_ID,
    provider,
    source: 'injected',
    walletId: 'metamask',
    walletLabel: 'MetaMask'
  };
  return {
    activeAddress: OWNER.toLowerCase(),
    activeChainId: CHAIN_ID,
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: OWNER.toLowerCase(),
    chainId: CHAIN_ID,
    epoch,
    session,
    sessionProvider: provider,
    signingProvider: provider,
    source: 'injected'
  };
};

const createCipherTradeLease = (): BrowserWalletSignerLease => {
  const provider: InjectedEthereumProvider = {
    isCipherTrade: true,
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_accounts') return [OWNER];
      if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
      return null;
    })
  };
  const session: BrowserWalletSession = {
    address: OWNER,
    chainId: CHAIN_ID,
    provider,
    source: 'walletconnect',
    walletId: 'ciphertrade-walletconnect',
    walletLabel: 'CipherTrade Mobile'
  };
  return {
    activeAddress: OWNER.toLowerCase(),
    activeChainId: CHAIN_ID,
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: OWNER.toLowerCase(),
    chainId: CHAIN_ID,
    epoch: 1,
    session,
    sessionProvider: provider,
    signingProvider: provider,
    source: 'walletconnect'
  };
};

const issue = (
  lease: BrowserWalletSignerLease,
  capabilityLabel: string
): Promise<CapturedBinding> => issueOwnerCotiMetaMaskCapability({
  assertLeaseCurrent: async (candidate) => {
    expect(candidate).toMatchObject({
      address: lease.address,
      chainId: lease.chainId,
      epoch: lease.epoch,
      sessionProvider: lease.sessionProvider
    });
  },
  assertLeaseSnapshotCurrent: (candidate) => {
    expect(candidate.epoch).toBe(lease.epoch);
    expect(candidate.sessionProvider).toBe(lease.sessionProvider);
  },
  bindCapability: async ({ browserProvider, readProvider, signer }) =>
    Object.freeze({ browserProvider, readProvider, signer }),
  capabilityLabel,
  expectedChainId: BigInt(CHAIN_ID),
  expectedOwnerAddress: OWNER,
  lease,
  requirePrivacy: false
});

describe('owner COTI browser-wallet provider pool', () => {
  it('uses event-backed guards for all current DEX factories instead of repeated extension probes', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    for (const name of ['Quote', 'PoolFunding', 'PoolPosition', 'Limit', 'Receipt', 'Submission']) {
      const start = app.indexOf(`const getCurrentDex${name}Capability = useCallback(`);
      expect(start).toBeGreaterThan(0);
      const factory = app.slice(start, app.indexOf('\n  const ', start + 1));
      expect(factory).toContain('assertLeaseCurrent: async (currentLease) =>');
      expect(factory).toContain('assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease)');
      expect(factory).not.toContain('assertLeaseCurrent: assertBrowserWalletSignerLeaseCurrent');
      expect(factory).toContain('assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent');
      expect(factory).toContain('captureBrowserWalletSignerLease()');
    }
  });
  it('rejects a different network before wallet or privacy access', async () => {
    const lease = createLease();
    const bindCapability = vi.fn();
    const assertLeaseCurrent = vi.fn();
    await expect(issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent,
      assertLeaseSnapshotCurrent: () => undefined,
      bindCapability,
      capabilityLabel: 'DEX',
      expectedChainId: CHAIN_ID === 7082400 ? 2632500n : 7082400n,
      expectedOwnerAddress: OWNER,
      lease,
      requirePrivacy: true
    })).rejects.toThrow('requires the configured COTI network');
    expect(assertLeaseCurrent).not.toHaveBeenCalled();
    expect(bindCapability).not.toHaveBeenCalled();
    expect(lease.sessionProvider.request).not.toHaveBeenCalled();
  });

  it('rejects a lease revoked while privacy unlock is pending without committing or binding', async () => {
    const lease = createCipherTradeLease();
    let current = true;
    const assertCurrent = () => { if (!current) throw new Error('lease revoked'); };
    let resume!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    privacyMocks.recover.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { status: 'ready', onboardInfo: { aesKey: 'test-session-only' }, source: 'fallback' };
    });
    const commitOnboardInfo = vi.fn();
    const bindCapability = vi.fn(async () => ({ ready: true }));
    const pending = issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent: async () => assertCurrent(),
      assertLeaseSnapshotCurrent: assertCurrent,
      bindCapability,
      capabilityLabel: 'DEX test',
      commitOnboardInfo,
      expectedChainId: BigInt(CHAIN_ID),
      expectedOwnerAddress: OWNER,
      lease,
      requirePrivacy: true
    });
    const rejected = expect(pending).rejects.toThrow('lease revoked');
    try {
      await started;
      current = false;
      resume();
      await rejected;
      expect(commitOnboardInfo).not.toHaveBeenCalled();
      expect(bindCapability).not.toHaveBeenCalled();
      expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally {
      resume();
      releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider);
    }
  });

  it('does not return a capability if its lease is revoked during binding', async () => {
    const lease = createLease();
    let current = true;
    const assertCurrent = () => { if (!current) throw new Error('lease revoked'); };
    const bindCapability = vi.fn(async () => {
      await Promise.resolve();
      current = false;
      return { ready: true };
    });
    try {
      await expect(issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => assertCurrent(),
        assertLeaseSnapshotCurrent: assertCurrent,
        bindCapability,
        capabilityLabel: 'DEX test',
        expectedChainId: BigInt(CHAIN_ID),
        expectedOwnerAddress: OWNER,
        lease,
        requirePrivacy: false
      })).rejects.toThrow('lease revoked');
      expect(bindCapability).toHaveBeenCalledOnce();
      expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally {
      releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider);
    }
  });

  it('reuses one COTI BrowserProvider and signer across feature capabilities', async () => {
    const lease = createLease();
    const [chat, trade, reactions, funds] = await Promise.all([
      issue(lease, 'ChainWhisper Chat V2'),
      issue(lease, 'ChainWhisper OTC V2'),
      issue(lease, 'ChainWhisper reactions'),
      issue(lease, 'owner funds')
    ]);

    expect(trade.browserProvider).toBe(chat.browserProvider);
    expect(reactions.browserProvider).toBe(chat.browserProvider);
    expect(funds.browserProvider).toBe(chat.browserProvider);
    expect(trade.signer).toBe(chat.signer);
    expect(reactions.signer).toBe(chat.signer);
    expect(funds.signer).toBe(chat.signer);
    expect(chat.readProvider).not.toBe(chat.browserProvider);
    expect(trade.readProvider).toBe(chat.readProvider);
    expect(reactions.readProvider).toBe(chat.readProvider);
    expect(funds.readProvider).toBe(chat.readProvider);
    expect(lease.sessionProvider.request).not.toHaveBeenCalled();

    const destroy = vi.spyOn(chat.browserProvider, 'destroy');
    releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider);
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('retires the previous provider once when the same wallet advances to a new lease epoch', async () => {
    const firstLease = createLease(1);
    const first = await issue(firstLease, 'ChainWhisper Chat V2');
    const destroyFirst = vi.spyOn(first.browserProvider, 'destroy');
    const secondLease: BrowserWalletSignerLease = {
      ...firstLease,
      epoch: 2
    };
    const second = await issue(secondLease, 'ChainWhisper OTC V2');
    await Promise.resolve();

    expect(second.browserProvider).not.toBe(first.browserProvider);
    expect(destroyFirst).toHaveBeenCalledOnce();

    const destroySecond = vi.spyOn(second.browserProvider, 'destroy');
    releaseOwnerCotiMetaMaskProviderPool(secondLease.sessionProvider);
    await Promise.resolve();
    expect(destroyFirst).toHaveBeenCalledOnce();
    expect(destroySecond).toHaveBeenCalledOnce();
  });

  it('uses CipherTrade signer onboarding without ever invoking MetaMask Snap', async () => {
    privacyMocks.recover.mockClear();
    privacyMocks.snap.mockClear();
    const lease = createCipherTradeLease();
    const commitOnboardInfo = vi.fn();

    const capability = await issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent: async () => undefined,
      assertLeaseSnapshotCurrent: () => undefined,
      bindCapability: async ({ browserProvider, signer }) => Object.freeze({ browserProvider, signer }),
      capabilityLabel: 'ChainWhisper Chat V2',
      commitOnboardInfo,
      expectedChainId: BigInt(CHAIN_ID),
      expectedOwnerAddress: OWNER,
      lease,
      requirePrivacy: true
    });

    expect(capability.signer.getUserOnboardInfo()).toMatchObject({
      aesKey: 'ciphertrade-session-aes'
    });
    expect(privacyMocks.recover).toHaveBeenCalledWith(expect.objectContaining({
      allowLegacyFallback: true,
      probeSnapAes: false,
      walletAddress: OWNER
    }));
    expect(privacyMocks.snap).not.toHaveBeenCalled();
    expect(commitOnboardInfo).toHaveBeenCalledOnce();

    releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider);
  });
});
