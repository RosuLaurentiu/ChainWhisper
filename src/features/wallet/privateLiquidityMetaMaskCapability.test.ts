import type { OnboardInfo } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapMocks = vi.hoisted(() => ({ getCotiSnapOwnerAesKeyResult: vi.fn() }));

vi.mock('../../lib/cotiSnap', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/cotiSnap')>(),
  getCotiSnapOwnerAesKeyResult: snapMocks.getCotiSnapOwnerAesKeyResult
}));

import { COTI_NETWORK, type InjectedEthereumProvider } from '../../lib/appShared';
import { assertPrivateLiquidityMetaMaskCapabilityCurrent } from '../../lib/privateLiquidityActions';
import {
  issuePrivateLiquidityMetaMaskCapability,
  type PrivateLiquidityMetaMaskCapabilityOnboardInfoCommitter
} from './privateLiquidityMetaMaskCapability';
import {
  assertBrowserWalletSignerLeaseState,
  assertLiveBrowserWalletSignerLease,
  type BrowserWalletSession,
  type BrowserWalletSignerLease,
  type BrowserWalletSignerLeaseState
} from './hooks/useWalletOnboarding';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const CHAIN_ID = COTI_NETWORK.chainIdDecimal;

const fixture = () => {
  const live = { account: OWNER, chainId: CHAIN_ID, methods: [] as string[] };
  const provider: InjectedEthereumProvider = {
    isMetaMask: true,
    request: vi.fn(async ({ method }) => {
      live.methods.push(method);
      if (method === 'eth_accounts') return [live.account];
      if (method === 'eth_chainId') return `0x${live.chainId.toString(16)}`;
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
  const lease: BrowserWalletSignerLease = {
    activeAddress: OWNER.toLowerCase(),
    activeChainId: CHAIN_ID,
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: OWNER.toLowerCase(),
    chainId: CHAIN_ID,
    epoch: 3,
    session,
    sessionProvider: provider,
    signingProvider: provider,
    source: 'injected'
  };
  const state: BrowserWalletSignerLeaseState = {
    activeProvider: provider,
    activeSignerSource: 'metamask',
    address: OWNER,
    chainId: CHAIN_ID,
    epoch: 3,
    session
  };
  const assertLeaseSnapshotCurrent = (candidate: BrowserWalletSignerLease): void =>
    assertBrowserWalletSignerLeaseState(candidate, state);
  const assertLeaseCurrent = (candidate: BrowserWalletSignerLease): Promise<void> =>
    assertLiveBrowserWalletSignerLease(candidate, () => assertLeaseSnapshotCurrent(candidate));
  return { live, lease, state, assertLeaseCurrent, assertLeaseSnapshotCurrent };
};

const issue = (
  value: ReturnType<typeof fixture>,
  options: Readonly<{
    commitOnboardInfo?: PrivateLiquidityMetaMaskCapabilityOnboardInfoCommitter;
    expectedChainId?: bigint;
    lease?: BrowserWalletSignerLease;
    refreshPrivacy?: boolean;
    requirePrivacy?: boolean;
    sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
  }> = {}
) => issuePrivateLiquidityMetaMaskCapability({
  assertLeaseCurrent: value.assertLeaseCurrent,
  assertLeaseSnapshotCurrent: value.assertLeaseSnapshotCurrent,
  commitOnboardInfo: options.commitOnboardInfo,
  expectedChainId: options.expectedChainId ?? BigInt(CHAIN_ID),
  expectedOwnerAddress: OWNER,
  lease: options.lease ?? value.lease,
  refreshPrivacy: options.refreshPrivacy,
  requirePrivacy: options.requirePrivacy ?? true,
  sessionOnboardInfo: options.sessionOnboardInfo
});

describe('Private Liquidity V1 MetaMask capability issuer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapMocks.getCotiSnapOwnerAesKeyResult.mockResolvedValue({ status: 'ready', aesKey: 'snap-aes' });
  });

  it('issues only the exact current owner capability and uses address-scoped cached privacy', async () => {
    const context = fixture();
    const capability = await issue(context, {
      sessionOnboardInfo: { [OWNER.toLowerCase()]: { aesKey: 'cached-aes' } }
    });
    await expect(assertPrivateLiquidityMetaMaskCapabilityCurrent({
      capability,
      ownerAddress: OWNER,
      chainId: BigInt(CHAIN_ID)
    })).resolves.toBeUndefined();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).not.toHaveBeenCalled();
    expect(context.live.methods).not.toContain('wallet_switchEthereumChain');
  });

  it('does not unlock privacy for public-only position lifecycle actions', async () => {
    const context = fixture();
    const capability = await issue(context, { requirePrivacy: false });
    await expect(assertPrivateLiquidityMetaMaskCapabilityCurrent({
      capability,
      ownerAddress: OWNER,
      chainId: BigInt(CHAIN_ID)
    })).resolves.toBeUndefined();
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).not.toHaveBeenCalled();
  });

  it('unlocks missing privacy through Snap, guards the cache commit, and clears the transient key', async () => {
    const context = fixture();
    const snapResult = { status: 'ready' as const, aesKey: 'transient-aes' };
    const commit = vi.fn<PrivateLiquidityMetaMaskCapabilityOnboardInfoCommitter>();
    snapMocks.getCotiSnapOwnerAesKeyResult.mockResolvedValue(snapResult);
    await issue(context, { commitOnboardInfo: commit });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      onboardInfo: { aesKey: 'transient-aes' },
      walletAddress: OWNER.toLowerCase()
    });
    expect(() => commit.mock.calls[0]?.[0].assertCurrent()).not.toThrow();
    expect(snapResult.aesKey).toBe('');
  });

  it('ignores stale cached privacy when an explicit receipt refresh is required', async () => {
    const context = fixture();
    await issue(context, {
      refreshPrivacy: true,
      sessionOnboardInfo: { [OWNER.toLowerCase()]: { aesKey: 'stale-cached-aes' } }
    });
    expect(snapMocks.getCotiSnapOwnerAesKeyResult).toHaveBeenCalledOnce();
  });

  it('rejects non-owner authority before use and revokes the capability after a live account change', async () => {
    const inactive = fixture();
    await expect(issue(inactive, {
      lease: { ...inactive.lease, activeProvider: null }
    })).rejects.toThrow(/active MetaMask or CipherTrade owner session/);
    expect(inactive.live.methods).toEqual([]);

    const wrongChain = fixture();
    await expect(issue(wrongChain, { expectedChainId: BigInt(CHAIN_ID) + 1n }))
      .rejects.toThrow(/requires the configured COTI network/);
    expect(wrongChain.live.methods).toEqual([]);

    const context = fixture();
    const capability = await issue(context, {
      sessionOnboardInfo: { [OWNER.toLowerCase()]: { aesKey: 'cached-aes' } }
    });
    context.live.account = OTHER;
    await expect(assertPrivateLiquidityMetaMaskCapabilityCurrent({
      capability,
      ownerAddress: OWNER,
      chainId: BigInt(CHAIN_ID)
    })).rejects.toThrow(/Owner wallet session changed/);
  });
});
