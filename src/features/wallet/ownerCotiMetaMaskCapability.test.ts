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
  hasCurrentDexBrowserSigner,
  releaseOwnerCotiMetaMaskProviderPool,
  type IssueOwnerCotiMetaMaskCapabilityArgs
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSession, BrowserWalletSignerLease } from './hooks/useWalletOnboarding';
import type { CotiSnapOwnerAesResult } from '../../lib/cotiSnap';

const privacyMocks = vi.hoisted(() => ({
  recover: vi.fn(async ({ signer }: {
    signer: { setUserOnboardInfo: (value: { aesKey: string }) => void };
  }) => {
    const onboardInfo = { aesKey: 'ciphertrade-session-aes' };
    signer.setUserOnboardInfo(onboardInfo);
    return { status: 'ready' as const, onboardInfo, source: 'fallback' as const };
  }),
  snap: vi.fn(async (_provider: InjectedEthereumProvider): Promise<CotiSnapOwnerAesResult> => ({ status: 'unsupported' }))
}));

vi.mock('../../lib/cotiAesUnlock', () => ({
  getOrRecoverAesForWalletResult: privacyMocks.recover
}));

vi.mock('../../lib/appShared', async original => {
  const actual = await original<typeof import('../../lib/appShared')>();
  const readProvider = Object.freeze({ request: vi.fn(async () => { throw new Error('Unexpected independent RPC in issuer fixture'); }) });
  return { ...actual, loadCotiReadProvider: vi.fn(async () => readProvider) };
});

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
type IssuedBinding = Parameters<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>['bindCapability']>[0];

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
  it('binds normal DEX context only to the exact live Testnet signer and preserves other-network issuance',async()=>{
    if(import.meta.env.MODE==='coti-testnet-candidate')expect(CHAIN_ID).toBe(7082400);
    const lease=createLease(),capability=await issue(lease,'browser DEX context');
    expect(hasCurrentDexBrowserSigner({},OWNER,7082400n)).toBe(false);
    expect(hasCurrentDexBrowserSigner(capability.signer,`0x${'22'.repeat(20)}`,7082400n)).toBe(false);
    expect(hasCurrentDexBrowserSigner(capability.signer,OWNER,7082400n)).toBe(CHAIN_ID===7082400);
    releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider);
    await Promise.resolve();
    if(CHAIN_ID===7082400)expect(()=>hasCurrentDexBrowserSigner(capability.signer,OWNER,7082400n)).toThrow('lease ended');
    else expect(hasCurrentDexBrowserSigner(capability.signer,OWNER,7082400n)).toBe(false);
  });
  it.each(['cold', 'pooled'] as const)('imports an unlocked owner session into a %s signer without prompting for privacy', async state => {
    const lease = createLease();
    const snapCalls = privacyMocks.snap.mock.calls.length, recoverCalls = privacyMocks.recover.mock.calls.length;
    const commitOnboardInfo = vi.fn();
    try {
      const prior = state === 'pooled' ? await issue(lease, 'public DEX setup') : undefined;
      const capability = await issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => {}, assertLeaseSnapshotCurrent: () => {},
        bindCapability: async input => input, capabilityLabel: 'current DEX submission',
        expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: false,
        sessionOnboardInfo: { [OWNER.toLowerCase()]: { aesKey: 'local-owner-session-key' } }, commitOnboardInfo
      });
      if (prior) expect(capability.signer).toBe(prior.signer);
      expect(capability.signer.getUserOnboardInfo()?.aesKey).toBe('local-owner-session-key');
      expect(privacyMocks.snap).toHaveBeenCalledTimes(snapCalls);
      expect(privacyMocks.recover).toHaveBeenCalledTimes(recoverCalls);
      expect(commitOnboardInfo).not.toHaveBeenCalled();
      expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally { releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('does not import another owner key or replace a nonempty signer key during public capability setup', async () => {
    const lease = createLease();
    const issueWithCache = (sessionOnboardInfo: IssueOwnerCotiMetaMaskCapabilityArgs<unknown>['sessionOnboardInfo']) =>
      issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => {}, assertLeaseSnapshotCurrent: () => {},
        bindCapability: async input => input, capabilityLabel: 'current DEX submission',
        expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: false, sessionOnboardInfo
      });
    try {
      const first = await issueWithCache({ ['0x' + '22'.repeat(20)]: { aesKey: 'other-owner-key' } });
      expect(first.signer.getUserOnboardInfo()?.aesKey).toBeFalsy();
      first.signer.setUserOnboardInfo({ aesKey: 'retained-owner-key' });
      const second = await issueWithCache({ [OWNER.toLowerCase()]: { aesKey: 'replacement-key' } });
      expect(second.signer).toBe(first.signer);
      expect(second.signer.getUserOnboardInfo()?.aesKey).toBe('retained-owner-key');
      expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally { releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('keeps retired capability guards separate from the reused lease-only provider and signer', async () => {
    const lease = createLease(), assertLeaseCurrent = vi.fn(async () => {}), assertLeaseSnapshotCurrent = vi.fn();
    let firstCurrent = true;
    const issueGeneration = (assertCapabilityCurrent: () => void) => issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent, assertLeaseSnapshotCurrent, assertCapabilityCurrent,
      bindCapability: async input => input, capabilityLabel: 'OTC V2 scoped test',
      expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: false
    });
    try {
      const first = await issueGeneration(() => { if (!firstCurrent) throw new Error('private generation retired'); });
      firstCurrent = false;
      await expect(first.assertCurrent()).rejects.toThrow('private generation retired');
      expect(() => first.assertSnapshotCurrent()).toThrow('private generation retired');
      const second = await issueGeneration(() => {});
      expect(second.browserProvider).toBe(first.browserProvider); expect(second.signer).toBe(first.signer);
      await second.assertCurrent(); second.assertSnapshotCurrent();
      await second.browserProvider.send('wallet_getSnaps', []);
      expect(lease.sessionProvider.request).toHaveBeenCalledWith({ method: 'wallet_getSnaps', params: [] });
      await expect(first.assertCurrent()).rejects.toThrow('private generation retired');
      expect(assertLeaseCurrent).toHaveBeenCalledWith(expect.objectContaining({ epoch: lease.epoch }));
      expect(assertLeaseSnapshotCurrent).toHaveBeenCalledWith(expect.objectContaining({ epoch: lease.epoch }));
    } finally { releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('rejects an invalid capability generation before lease access, privacy onboarding or binding', async () => {
    const lease = createLease(), assertLeaseCurrent = vi.fn(), assertLeaseSnapshotCurrent = vi.fn(), bindCapability = vi.fn();
    const commitOnboardInfo = vi.fn(), snapCalls = privacyMocks.snap.mock.calls.length;
    try {
      await expect(issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent, assertLeaseSnapshotCurrent, bindCapability, commitOnboardInfo,
        assertCapabilityCurrent: () => { throw new Error('private generation retired'); },
        capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: true
      })).rejects.toThrow('private generation retired');
      expect(assertLeaseCurrent).not.toHaveBeenCalled(); expect(assertLeaseSnapshotCurrent).not.toHaveBeenCalled();
      expect(bindCapability).not.toHaveBeenCalled(); expect(commitOnboardInfo).not.toHaveBeenCalled();
      expect(privacyMocks.snap).toHaveBeenCalledTimes(snapCalls); expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally { releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('rechecks the capability generation after a pending lease assertion before it acquires a pooled signer', async () => {
    const lease = createLease(), bindCapability = vi.fn();
    let current = true, enter!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { resume = resolve; });
    const pending = issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent: async () => { enter(); await held; }, assertLeaseSnapshotCurrent: () => {},
      assertCapabilityCurrent: () => { if (!current) throw new Error('private generation retired'); }, bindCapability,
      capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: false
    });
    const settled = Promise.allSettled([pending]);
    try {
      await started; current = false; resume();
      const [result] = await settled;
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.message).toContain('private generation retired');
      expect(bindCapability).not.toHaveBeenCalled(); expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally { resume(); await settled; releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('blocks the next Snap wallet request after its issuance retires and leaves the pooled provider usable', async () => {
    const lease = createLease(), bindCapability = vi.fn(), commitOnboardInfo = vi.fn();
    let current = true, enter!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { resume = resolve; });
    let privacyProvider: InjectedEthereumProvider | undefined;
    privacyMocks.snap.mockImplementationOnce(async provider => {
      privacyProvider = provider;
      await provider.request({ method: 'wallet_getSnaps', params: [] });
      enter(); await held;
      await provider.request({ method: 'wallet_invokeSnap', params: [] });
      return { status: 'ready', aesKey: 'synthetic-test-key' };
    });
    const pending = issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent: async () => {}, assertLeaseSnapshotCurrent: () => {},
      assertCapabilityCurrent: () => { if (!current) throw new Error('private generation retired'); },
      bindCapability, commitOnboardInfo, capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID),
      expectedOwnerAddress: OWNER, lease, requirePrivacy: true
    });
    const settled = Promise.allSettled([pending]);
    try {
      await started; current = false; resume();
      const [result] = await settled;
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.message).toContain('private generation retired');
      expect(bindCapability).not.toHaveBeenCalled(); expect(commitOnboardInfo).not.toHaveBeenCalled();
      expect(lease.sessionProvider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_invokeSnap' }));
      const fresh = await issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => {}, assertLeaseSnapshotCurrent: () => {}, assertCapabilityCurrent: () => {},
        bindCapability: async input => input, capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID),
        expectedOwnerAddress: OWNER, lease, requirePrivacy: false
      });
      expect(fresh.signer.getUserOnboardInfo()?.aesKey).toBeFalsy();
      await fresh.browserProvider.send('wallet_getSnaps', []);
      await expect(privacyProvider!.request({ method: 'wallet_getSnaps' })).rejects.toThrow('private generation retired');
    } finally { resume(); await settled; releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it.each(['snap', 'ciphertrade'])('rejects a retired %s unlock result before committing onboard info or binding', async wallet => {
    const lease = wallet === 'snap' ? createLease() : createCipherTradeLease(), bindCapability = vi.fn(), commitOnboardInfo = vi.fn();
    let current = true, enter!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { resume = resolve; });
    if (wallet === 'snap') privacyMocks.snap.mockImplementationOnce(async () => {
      enter(); await held; return { status: 'ready', aesKey: 'synthetic-test-key' };
    });
    else privacyMocks.recover.mockImplementationOnce(async () => {
      enter(); await held; return { status: 'ready', onboardInfo: { aesKey: 'synthetic-test-key' }, source: 'fallback' };
    });
    const pending = issueOwnerCotiMetaMaskCapability({
      assertLeaseCurrent: async () => {}, assertLeaseSnapshotCurrent: () => {},
      assertCapabilityCurrent: () => { if (!current) throw new Error('private generation retired'); }, bindCapability, commitOnboardInfo,
      capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: true
    });
    const settled = Promise.allSettled([pending]);
    try {
      await started; current = false; resume();
      const [result] = await settled;
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.message).toContain('private generation retired');
      expect(bindCapability).not.toHaveBeenCalled(); expect(commitOnboardInfo).not.toHaveBeenCalled();
      expect(lease.sessionProvider.request).not.toHaveBeenCalled();
    } finally { resume(); await settled; releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

  it('does not return a capability retired during binding or change the lease guard used by the pool', async () => {
    const lease = createLease();
    let current = true, leaseCurrent = true;
    const assertLease = () => { if (!leaseCurrent) throw new Error('lease revoked'); };
    const bindCapability = vi.fn(async (input: IssuedBinding) => { await Promise.resolve(); current = false; return input; });
    try {
      await expect(issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => assertLease(), assertLeaseSnapshotCurrent: assertLease,
        assertCapabilityCurrent: () => { if (!current) throw new Error('private generation retired'); }, bindCapability,
        capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID), expectedOwnerAddress: OWNER, lease, requirePrivacy: false
      })).rejects.toThrow('private generation retired');
      const fresh = await issueOwnerCotiMetaMaskCapability({
        assertLeaseCurrent: async () => assertLease(), assertLeaseSnapshotCurrent: assertLease, assertCapabilityCurrent: () => {},
        bindCapability: async input => input, capabilityLabel: 'OTC V2 scoped test', expectedChainId: BigInt(CHAIN_ID),
        expectedOwnerAddress: OWNER, lease, requirePrivacy: false
      });
      leaseCurrent = false;
      await expect(fresh.browserProvider.send('wallet_getSnaps', [])).rejects.toThrow(/lease revoked/);
      expect(lease.sessionProvider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_getSnaps' }));
    } finally { releaseOwnerCotiMetaMaskProviderPool(lease.sessionProvider); }
  });

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
