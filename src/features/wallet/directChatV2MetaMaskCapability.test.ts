import { type OnboardInfo } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapMocks = vi.hoisted(() => ({
  getCotiSnapOwnerAesKeyResult: vi.fn()
}));

vi.mock('../../lib/cotiSnap', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/cotiSnap')>(),
  getCotiSnapOwnerAesKeyResult: snapMocks.getCotiSnapOwnerAesKeyResult
}));

import { COTI_NETWORK, type InjectedEthereumProvider } from '../../lib/appShared';
import { assertDirectChatV2MetaMaskCapabilityCurrent } from '../../lib/directChatV2Chain';
import {
  issueDirectChatV2MetaMaskCapability,
  type DirectChatV2MetaMaskCapabilityOnboardInfoCommitter
} from './directChatV2MetaMaskCapability';
import {
  assertBrowserWalletSignerLeaseState,
  assertLiveBrowserWalletSignerLease,
  type BrowserWalletSession,
  type BrowserWalletSignerLease,
  type BrowserWalletSignerLeaseState
} from './hooks/useWalletOnboarding';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAIN_ID = COTI_NETWORK.chainIdDecimal;
const CHAIN_ID_BIGINT = BigInt(CHAIN_ID);

type ProviderFixture = {
  account: string;
  chainId: number;
  methods: string[];
  provider: InjectedEthereumProvider;
};

const createProviderFixture = ({
  account = ALICE,
  chainId = CHAIN_ID,
  isBraveWallet = false,
  isMetaMask = true
}: {
  account?: string;
  chainId?: number;
  isBraveWallet?: boolean;
  isMetaMask?: boolean;
} = {}): ProviderFixture => {
  const fixture = {
    account,
    chainId,
    methods: [] as string[],
    provider: null as unknown as InjectedEthereumProvider
  };
  fixture.provider = {
    isBraveWallet,
    isMetaMask,
    request: vi.fn(async ({ method }) => {
      fixture.methods.push(method);
      if (method === 'eth_accounts') return [fixture.account];
      if (method === 'eth_chainId') return `0x${fixture.chainId.toString(16)}`;
      return null;
    })
  };
  return fixture;
};

type LeaseFixture = {
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  lease: BrowserWalletSignerLease;
  providerFixture: ProviderFixture;
  state: BrowserWalletSignerLeaseState;
};

const createLeaseFixture = ({
  providerFixture = createProviderFixture(),
  source = 'injected',
  walletId = 'metamask'
}: {
  providerFixture?: ProviderFixture;
  source?: BrowserWalletSession['source'];
  walletId?: string;
} = {}): LeaseFixture => {
  const session: BrowserWalletSession = {
    address: ALICE,
    chainId: CHAIN_ID,
    provider: providerFixture.provider,
    source,
    walletId,
    walletLabel: 'MetaMask'
  };
  const lease: BrowserWalletSignerLease = {
    activeAddress: ALICE.toLowerCase(),
    activeChainId: CHAIN_ID,
    activeProvider: providerFixture.provider,
    activeSignerSource: 'metamask',
    address: ALICE.toLowerCase(),
    chainId: CHAIN_ID,
    epoch: 7,
    session,
    sessionProvider: providerFixture.provider,
    signingProvider: providerFixture.provider,
    source
  };
  const state: BrowserWalletSignerLeaseState = {
    activeProvider: providerFixture.provider,
    activeSignerSource: 'metamask',
    address: ALICE,
    chainId: CHAIN_ID,
    epoch: 7,
    session
  };
  const assertLeaseSnapshotCurrent = (candidate: BrowserWalletSignerLease): void => {
    assertBrowserWalletSignerLeaseState(candidate, state);
  };
  const assertLeaseCurrent = (candidate: BrowserWalletSignerLease): Promise<void> =>
    assertLiveBrowserWalletSignerLease(
      candidate,
      () => assertLeaseSnapshotCurrent(candidate)
    );
  return {
    assertLeaseCurrent,
    assertLeaseSnapshotCurrent,
    lease,
    providerFixture,
    state
  };
};

const issueFromFixture = (
  fixture: LeaseFixture,
  options: {
    commitOnboardInfo?: DirectChatV2MetaMaskCapabilityOnboardInfoCommitter;
    expectedChainId?: bigint;
    expectedOwnerAddress?: string;
    lease?: BrowserWalletSignerLease;
    requirePrivacy?: boolean;
    sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
  } = {}
) => issueDirectChatV2MetaMaskCapability({
  assertLeaseCurrent: fixture.assertLeaseCurrent,
  assertLeaseSnapshotCurrent: fixture.assertLeaseSnapshotCurrent,
  commitOnboardInfo: options.commitOnboardInfo,
  expectedChainId: options.expectedChainId ?? CHAIN_ID_BIGINT,
  expectedOwnerAddress: options.expectedOwnerAddress ?? ALICE,
  lease: options.lease ?? fixture.lease,
  requirePrivacy: options.requirePrivacy ?? true,
  sessionOnboardInfo: options.sessionOnboardInfo
});

describe('Direct Chat V2 MetaMask capability issuer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapMocks.getCotiSnapOwnerAesKeyResult.mockResolvedValue({
      status: 'ready',
      aesKey: 'snap-aes-key'
    });
  });

  it('issues a live opaque capability from the exact active MetaMask lease and cached AES', async () => {
    const fixture = createLeaseFixture();
    const capability = await issueFromFixture(fixture, {
      sessionOnboardInfo: {
        [ALICE.toLowerCase()]: { aesKey: 'cached-aes-key' }
      }
    });
    const issuanceReads = fixture.providerFixture.methods.filter((method) =>
      method === 'eth_accounts' || method === 'eth_chainId'
    );
    expect(issuanceReads.filter((method) => method === 'eth_accounts')).toHaveLength(1);
    expect(issuanceReads.filter((method) => method === 'eth_chainId')).toHaveLength(1);

    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).resolves.toBeUndefined();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).not.toHaveBeenCalled();
    expect(fixture.providerFixture.methods).not.toContain('wallet_switchEthereumChain');
  });

  it('allows public inspection without loading cached AES or invoking COTI Snap', async () => {
    const fixture = createLeaseFixture();
    const capability = await issueFromFixture(fixture, {
      requirePrivacy: false,
      sessionOnboardInfo: {
        [ALICE.toLowerCase()]: { aesKey: 'cached-aes-key-that-public-access-does-not-need' }
      }
    });

    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).resolves.toBeUndefined();
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).not.toHaveBeenCalled();
  });

  it('does not accept another wallet address\'s cached privacy material', async () => {
    const fixture = createLeaseFixture();
    await issueFromFixture(fixture, {
      sessionOnboardInfo: {
        [BOB.toLowerCase()]: { aesKey: 'bob-aes-key' }
      }
    });

    expect(snapMocks.getCotiSnapOwnerAesKeyResult).toHaveBeenCalledOnce();
  });

  it('unlocks missing privacy through COTI Snap, commits it with a lease guard, and clears the transient result', async () => {
    const fixture = createLeaseFixture();
    const snapResult = { status: 'ready' as const, aesKey: 'transient-snap-aes' };
    const commitOnboardInfo = vi.fn<DirectChatV2MetaMaskCapabilityOnboardInfoCommitter>();
    snapMocks.getCotiSnapOwnerAesKeyResult.mockResolvedValue(snapResult);

    const capability = await issueFromFixture(fixture, { commitOnboardInfo });

    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).resolves.toBeUndefined();
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).toHaveBeenCalledWith(
      expect.anything(),
      ALICE,
      { expectedChainId: CHAIN_ID }
    );
    expect(commitOnboardInfo).toHaveBeenCalledOnce();
    expect(commitOnboardInfo.mock.calls[0]?.[0]).toMatchObject({
      onboardInfo: { aesKey: 'transient-snap-aes' },
      walletAddress: ALICE.toLowerCase()
    });
    expect(() => commitOnboardInfo.mock.calls[0]?.[0].assertCurrent()).not.toThrow();
    expect(snapResult.aesKey).toBe('');
  });

  it('issues capabilities for injected CipherTrade, WalletConnect CipherTrade, and mobile MetaMask sessions', async () => {
    const cypher = createLeaseFixture({
      providerFixture: createProviderFixture({ isMetaMask: false }),
      walletId: 'ciphertrade'
    });
    const walletConnect = createLeaseFixture({
      providerFixture: createProviderFixture({ isMetaMask: false }),
      source: 'walletconnect',
      walletId: 'ciphertrade-walletconnect'
    });
    const mobile = createLeaseFixture({ source: 'metamask-connect-mobile' });

    await expect(issueFromFixture(cypher, { requirePrivacy: false })).resolves.toBeDefined();
    await expect(issueFromFixture(walletConnect, { requirePrivacy: false })).resolves.toBeDefined();
    await expect(issueFromFixture(mobile, { requirePrivacy: false })).resolves.toBeDefined();
  });

  it('rejects inactive, unsupported, and provider-mismatched leases before wallet RPC', async () => {
    const cases: Array<{ fixture: LeaseFixture; lease: BrowserWalletSignerLease; label: string }> = [];

    const inactive = createLeaseFixture();
    cases.push({
      fixture: inactive,
      lease: { ...inactive.lease, activeProvider: null },
      label: 'inactive browser lease'
    });

    const brave = createLeaseFixture({
      providerFixture: createProviderFixture({ isBraveWallet: true })
    });
    cases.push({ fixture: brave, lease: brave.lease, label: 'Brave wallet' });

    const providerMismatch = createLeaseFixture();
    cases.push({
      fixture: providerMismatch,
      lease: {
        ...providerMismatch.lease,
        signingProvider: createProviderFixture().provider
      },
      label: 'alternate signing provider'
    });

    for (const testCase of cases) {
      await expect(issueFromFixture(testCase.fixture, {
        lease: testCase.lease
      }), testCase.label).rejects.toThrow('active MetaMask or CipherTrade owner session');
      expect(testCase.fixture.providerFixture.methods, testCase.label).toEqual([]);
    }
  });

  it('rejects a wrong owner or non-production chain before wallet RPC', async () => {
    const wrongOwner = createLeaseFixture();
    await expect(issueFromFixture(wrongOwner, {
      expectedOwnerAddress: BOB
    })).rejects.toThrow('active MetaMask or CipherTrade owner session');
    expect(wrongOwner.providerFixture.methods).toEqual([]);

    const wrongChain = createLeaseFixture();
    await expect(issueFromFixture(wrongChain, {
      expectedChainId: CHAIN_ID_BIGINT + 1n
    })).rejects.toThrow('requires the configured COTI network');
    expect(wrongChain.providerFixture.methods).toEqual([]);
  });

  it('aborts without committing when the wallet session changes during Snap unlock and clears the returned AES', async () => {
    const fixture = createLeaseFixture();
    const snapResult = { status: 'ready' as const, aesKey: 'stale-snap-aes' };
    const commitOnboardInfo = vi.fn<DirectChatV2MetaMaskCapabilityOnboardInfoCommitter>();
    snapMocks.getCotiSnapOwnerAesKeyResult.mockImplementation(async () => {
      fixture.state.epoch += 1;
      return snapResult;
    });

    await expect(issueFromFixture(fixture, { commitOnboardInfo })).rejects.toThrow(
      'Owner wallet session changed'
    );
    expect(commitOnboardInfo).not.toHaveBeenCalled();
    expect(snapResult.aesKey).toBe('');
  });

  it('revokes an issued capability and its delayed cache guard after an account/session epoch change', async () => {
    const fixture = createLeaseFixture();
    const commitOnboardInfo = vi.fn<DirectChatV2MetaMaskCapabilityOnboardInfoCommitter>();
    const capability = await issueFromFixture(fixture, { commitOnboardInfo });
    const cacheCommit = commitOnboardInfo.mock.calls[0]?.[0];
    expect(cacheCommit).toBeDefined();

    fixture.state.epoch += 1;

    expect(() => cacheCommit?.assertCurrent()).toThrow('Owner wallet session changed');
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).rejects.toThrow('Owner wallet session changed');
  });

  it('keeps checking the live MetaMask account and chain after issuance', async () => {
    const fixture = createLeaseFixture();
    const capability = await issueFromFixture(fixture, {
      sessionOnboardInfo: {
        [ALICE.toLowerCase()]: { aesKey: 'cached-aes-key' }
      }
    });

    fixture.providerFixture.account = BOB;
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).rejects.toThrow('Owner wallet session changed');

    fixture.providerFixture.account = ALICE;
    fixture.providerFixture.chainId = CHAIN_ID + 1;
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID_BIGINT
    })).rejects.toThrow('Owner wallet session changed');
  });
});
