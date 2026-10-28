import { describe, expect, it, vi } from 'vitest';
import type { DirectChatV2MetaMaskCapability } from './directChatV2Chain';
import type { DirectChatV2DeploymentConfig } from './directChatV2Deployment';
import { createDirectChatV2Runtime } from './directChatV2Runtime';
import { createCachedDirectChatV2OwnerCapabilityGetter } from './directChatV2Runtime';

const OWNER = '0x1111111111111111111111111111111111111111';

const activeConfig: DirectChatV2DeploymentConfig = Object.freeze({
  status: 'active',
  manifest: Object.freeze({
    chainId: 7_082_400n,
    contractAddress: '0x2222222222222222222222222222222222222222',
    deploymentBlock: 123n,
    runtimeBytecodeHash: `0x${'33'.repeat(32)}`
  }),
  finalityLagBlocks: 5n,
  rpcUrl: 'https://testnet.coti.io/rpc',
  fingerprint: 'test-direct-chat-v2'
});

const lifecycle = Object.freeze({
  onOptimistic: vi.fn(),
  onReceipt: vi.fn(),
  onFailure: vi.fn()
});

const common = () => ({
  getOwnerCapability: vi.fn(async () => ({}) as DirectChatV2MetaMaskCapability),
  lifecycle,
  ownerAddress: OWNER,
  runOwnerTransactionFlow: async <T>(operation: () => Promise<T>) => operation()
});

describe('directChatV2Runtime', () => {
  it('reuses at most one public and one private wallet provider and releases both', async () => {
    const publicCapability = Object.freeze({ public: true }) as unknown as DirectChatV2MetaMaskCapability;
    const privateCapability = Object.freeze({ private: true }) as unknown as DirectChatV2MetaMaskCapability;
    const getOwnerCapability = vi.fn(async (requirePrivacy: boolean) =>
      requirePrivacy ? privateCapability : publicCapability
    );
    const releaseCapability = vi.fn();
    const cache = createCachedDirectChatV2OwnerCapabilityGetter({
      getOwnerCapability,
      releaseCapability
    });

    await expect(cache.get(false)).resolves.toBe(publicCapability);
    await expect(cache.get(false)).resolves.toBe(publicCapability);
    await expect(cache.get(true)).resolves.toBe(privateCapability);
    await expect(cache.get(false)).resolves.toBe(privateCapability);
    expect(getOwnerCapability.mock.calls.map(([privacy]) => privacy)).toEqual([false, true]);

    cache.close();
    await Promise.resolve();
    expect(releaseCapability).toHaveBeenCalledTimes(2);
    expect(releaseCapability).toHaveBeenCalledWith(publicCapability);
    expect(releaseCapability).toHaveBeenCalledWith(privateCapability);
  });

  it('replaces a cached capability only after explicit invalidation', async () => {
    const staleCapability = Object.freeze({ stale: true }) as unknown as DirectChatV2MetaMaskCapability;
    const freshCapability = Object.freeze({ fresh: true }) as unknown as DirectChatV2MetaMaskCapability;
    const getOwnerCapability = vi.fn()
      .mockResolvedValueOnce(staleCapability)
      .mockResolvedValueOnce(freshCapability);
    const releaseCapability = vi.fn();
    const cache = createCachedDirectChatV2OwnerCapabilityGetter({
      getOwnerCapability,
      releaseCapability
    });

    await expect(cache.get(false)).resolves.toBe(staleCapability);
    await expect(cache.get(false)).resolves.toBe(staleCapability);
    cache.invalidate();
    await expect(cache.get(false)).resolves.toBe(freshCapability);

    expect(getOwnerCapability).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(releaseCapability).toHaveBeenCalledWith(staleCapability));
    cache.close();
  });

  it('does not initialize security storage for inactive or invalid deployments', () => {
    const factory = vi.fn(() => ({ retire: vi.fn(), close: vi.fn() }));
    const inactive = createDirectChatV2Runtime({
      ...common(),
      deploymentConfig: { status: 'inactive' },
      nonceRetirementFactory: factory
    });
    const invalid = createDirectChatV2Runtime({
      ...common(),
      deploymentConfig: { status: 'invalid', error: 'invalid manifest' },
      nonceRetirementFactory: factory
    });

    expect(inactive).toMatchObject({ enabled: false, status: 'inactive' });
    expect(invalid).toMatchObject({ enabled: false, status: 'invalid', error: 'invalid manifest' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('constructs one branded session/coordinator and closes its sensitive state once', () => {
    const close = vi.fn();
    const retire = vi.fn(async () => {});
    const runtime = createDirectChatV2Runtime({
      ...common(),
      deploymentConfig: activeConfig,
      nonceRetirementFactory: () => ({ close, retire })
    });

    expect(runtime.enabled).toBe(true);
    expect(runtime.coordinator.enabled).toBe(true);
    expect(runtime.history).not.toBeNull();
    expect(runtime.isCurrent()).toBe(true);
    expect(runtime.session?.ownerAddress).toBe(OWNER);

    runtime.close();
    runtime.close();
    expect(runtime.isCurrent()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the durable nonce store or owner scope is unavailable', () => {
    const missingStore = createDirectChatV2Runtime({
      ...common(),
      deploymentConfig: activeConfig,
      nonceRetirementFactory: () => {
        throw new Error('IndexedDB unavailable');
      }
    });
    const missingOwner = createDirectChatV2Runtime({
      ...common(),
      deploymentConfig: activeConfig,
      ownerAddress: '',
      nonceRetirementFactory: vi.fn(() => ({ retire: vi.fn(), close: vi.fn() }))
    });

    expect(missingStore).toMatchObject({ enabled: false, status: 'unavailable' });
    expect(missingOwner).toMatchObject({ enabled: false, status: 'unavailable' });
    expect(missingStore.coordinator.enabled).toBe(false);
    expect(missingOwner.coordinator.enabled).toBe(false);
  });
});
