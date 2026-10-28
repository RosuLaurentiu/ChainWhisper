import { describe, expect, it, vi } from 'vitest';
import {
  createCachedGroupChatV2OwnerCapabilityGetter,
  createGroupChatV2Runtime
} from './groupChatV2Runtime';
import type { GroupChatV2MetaMaskCapability } from './groupChatV2Chain';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONFIG = {
  status: 'active' as const,
  manifest: {
    chainId: 7_082_400n,
    contractAddress: '0x2222222222222222222222222222222222222222',
    deploymentBlock: 101n,
    runtimeBytecodeHash: `0x${'33'.repeat(32)}`
  },
  finalityLagBlocks: 12n,
  rpcUrl: 'https://example.test/',
  fingerprint: 'group-test'
};
const flow = async <T>(operation: () => Promise<T>): Promise<T> => operation();

describe('groupChatV2Runtime', () => {
  it('reuses owner capabilities and releases each provider exactly once', async () => {
    const publicCapability = Object.freeze({}) as GroupChatV2MetaMaskCapability;
    const privateCapability = Object.freeze({}) as GroupChatV2MetaMaskCapability;
    const getOwnerCapability = vi.fn(async (requirePrivacy: boolean) =>
      requirePrivacy ? privateCapability : publicCapability);
    const releaseCapability = vi.fn();
    const cache = createCachedGroupChatV2OwnerCapabilityGetter({
      getOwnerCapability,
      releaseCapability
    });

    await expect(cache.get(false)).resolves.toBe(publicCapability);
    await expect(cache.get(false)).resolves.toBe(publicCapability);
    await expect(cache.get(true)).resolves.toBe(privateCapability);
    await expect(cache.get(false)).resolves.toBe(privateCapability);
    expect(getOwnerCapability).toHaveBeenCalledTimes(2);

    cache.close();
    cache.close();
    await Promise.resolve();
    expect(releaseCapability).toHaveBeenCalledTimes(2);
    expect(releaseCapability).toHaveBeenCalledWith(publicCapability);
    expect(releaseCapability).toHaveBeenCalledWith(privateCapability);
  });

  it('reuses a cached capability without polling MetaMask during background reads', async () => {
    const capability = Object.freeze({}) as GroupChatV2MetaMaskCapability;
    const getOwnerCapability = vi.fn().mockResolvedValue(capability);
    const releaseCapability = vi.fn();
    const cache = createCachedGroupChatV2OwnerCapabilityGetter({
      getOwnerCapability,
      releaseCapability
    });

    await expect(cache.get(false)).resolves.toBe(capability);
    await expect(cache.get(false)).resolves.toBe(capability);
    expect(getOwnerCapability).toHaveBeenCalledTimes(1);
    cache.close();
    await Promise.resolve();
    expect(releaseCapability).toHaveBeenCalledWith(capability);
  });

  it('evicts a stale group capability when the mutation session invalidates it', async () => {
    const staleCapability = Object.freeze({ stale: true }) as unknown as GroupChatV2MetaMaskCapability;
    const freshCapability = Object.freeze({ fresh: true }) as unknown as GroupChatV2MetaMaskCapability;
    const getOwnerCapability = vi.fn()
      .mockResolvedValueOnce(staleCapability)
      .mockResolvedValueOnce(freshCapability);
    const releaseCapability = vi.fn();
    const cache = createCachedGroupChatV2OwnerCapabilityGetter({
      getOwnerCapability,
      releaseCapability
    });

    await expect(cache.get(false)).resolves.toBe(staleCapability);
    cache.invalidate();
    await expect(cache.get(false)).resolves.toBe(freshCapability);

    expect(getOwnerCapability).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(releaseCapability).toHaveBeenCalledWith(staleCapability));
    cache.close();
  });

  it('stays inert for disabled or invalid deployment configuration', () => {
    const common = {
      getOwnerCapability: vi.fn(),
      ownerAddress: OWNER,
      runOwnerTransactionFlow: flow
    };
    expect(createGroupChatV2Runtime({ ...common, deploymentConfig: { status: 'inactive' } }))
      .toMatchObject({ enabled: false, status: 'inactive', session: null });
    expect(createGroupChatV2Runtime({
      ...common,
      deploymentConfig: { status: 'invalid', error: 'bad manifest' }
    })).toMatchObject({ enabled: false, status: 'invalid', error: 'bad manifest' });
  });

  it('owns one session nonce store and destroys both on close', () => {
    const close = vi.fn();
    const runtime = createGroupChatV2Runtime({
      deploymentConfig: CONFIG,
      getOwnerCapability: vi.fn(async () => Object.freeze({}) as GroupChatV2MetaMaskCapability),
      nonceRetirementFactory: () => ({ retire: vi.fn(async () => undefined), close }),
      ownerAddress: OWNER,
      runOwnerTransactionFlow: flow
    });
    expect(runtime).toMatchObject({ enabled: true, status: 'active' });
    expect(runtime.isCurrent()).toBe(true);
    runtime.close();
    runtime.close();
    expect(runtime.isCurrent()).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when the secure nonce store cannot initialize', () => {
    const runtime = createGroupChatV2Runtime({
      deploymentConfig: CONFIG,
      getOwnerCapability: vi.fn(),
      nonceRetirementFactory: () => { throw new Error('no IndexedDB'); },
      ownerAddress: OWNER,
      runOwnerTransactionFlow: flow
    });
    expect(runtime).toMatchObject({ enabled: false, status: 'unavailable', session: null });
  });
});
