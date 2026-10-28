import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIGURED_COTI_NETWORK } from '../chainWhisperNetworks';

type NetworkOutcome =
  | { kind: 'configured' }
  | { kind: 'wrong'; chainId: bigint }
  | { kind: 'reject'; error: Error };

type ProviderRecord = {
  url: string;
  requestTimeout: number | undefined;
  networkOptions: unknown;
  networkCalls: number;
  destroyCalls: number;
  signerCalls: number;
  sendCalls: number;
  errorHandlers: Array<(error: unknown) => void>;
};

const providerState = vi.hoisted(() => ({
  expectedChainId: 0n,
  outcomes: [] as NetworkOutcome[],
  instances: [] as ProviderRecord[]
}));

vi.mock('@coti-io/coti-ethers', async () => {
  const { FetchRequest } = await vi.importActual<typeof import('@coti-io/coti-ethers')>('@coti-io/coti-ethers');

  class JsonRpcProviderMock {
    private readonly record: ProviderRecord;

    constructor(request: InstanceType<typeof FetchRequest>, networkOptions: unknown) {
      this.record = {
        url: request.url,
        requestTimeout: request.timeout,
        networkOptions,
        networkCalls: 0,
        destroyCalls: 0,
        signerCalls: 0,
        sendCalls: 0,
        errorHandlers: []
      };
      providerState.instances.push(this.record);
    }

    async getNetwork(): Promise<{ chainId: bigint }> {
      this.record.networkCalls += 1;
      const outcome = providerState.outcomes.shift() ?? { kind: 'configured' as const };
      if (outcome.kind === 'reject') throw outcome.error;
      return { chainId: outcome.kind === 'wrong' ? outcome.chainId : providerState.expectedChainId };
    }

    on(eventName: string, listener: (error: unknown) => void): void {
      if (eventName === 'error') this.record.errorHandlers.push(listener);
    }

    destroy(): void {
      this.record.destroyCalls += 1;
    }

    getSigner(): never {
      this.record.signerCalls += 1;
      throw new Error('The read-provider fixture must not create a signer.');
    }

    async sendTransaction(): Promise<never> {
      this.record.sendCalls += 1;
      throw new Error('The read-provider fixture must not send transactions.');
    }
  }

  return {
    FetchRequest,
    JsonRpcProvider: JsonRpcProviderMock,
    WebSocketProvider: class WebSocketProviderMock {},
    isError: (error: unknown, code: string) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === code
  };
});

const loadCore = async () => {
  vi.resetModules();
  const { loadCotiHttpProvider } = await import('./core');
  return loadCotiHttpProvider;
};

describe('configured COTI HTTP read-provider initialization', () => {
  beforeEach(() => {
    providerState.expectedChainId = BigInt(CONFIGURED_COTI_NETWORK.chainIdDecimal);
    providerState.outcomes.length = 0;
    providerState.instances.length = 0;
  });

  it('shares one provider after concurrent callers validate the configured chain', async () => {
    const loadCotiHttpProvider = await loadCore();
    const [first, second] = await Promise.all([
      loadCotiHttpProvider(),
      loadCotiHttpProvider()
    ]);

    expect(first).toBe(second);
    expect(providerState.instances).toHaveLength(1);
    expect(providerState.instances[0]).toMatchObject({
      url: CONFIGURED_COTI_NETWORK.rpcUrl,
      requestTimeout: 30_000,
      networkOptions: {
        name: CONFIGURED_COTI_NETWORK.chainName,
        chainId: CONFIGURED_COTI_NETWORK.chainIdDecimal
      },
      networkCalls: 1,
      destroyCalls: 0,
      signerCalls: 0,
      sendCalls: 0
    });
    expect(await loadCotiHttpProvider()).toBe(first);
    expect(providerState.instances[0]?.networkCalls).toBe(1);
  });

  it('uses a shorter timeout than the SDK default for shared HTTP reads', async () => {
    const { FetchRequest } = await vi.importActual<typeof import('@coti-io/coti-ethers')>('@coti-io/coti-ethers');
    expect(new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl).timeout).toBe(300_000);

    const loadCotiHttpProvider = await loadCore();
    await loadCotiHttpProvider();

    expect(providerState.instances[0]?.requestTimeout).toBe(30_000);
  });

  it('rejects every concurrent caller on RPC failure, destroys once, then retries explicitly', async () => {
    const outage = new Error('RPC unavailable');
    providerState.outcomes.push({ kind: 'reject', error: outage }, { kind: 'configured' });
    const loadCotiHttpProvider = await loadCore();
    const failed = await Promise.allSettled([
      loadCotiHttpProvider(),
      loadCotiHttpProvider(),
      loadCotiHttpProvider()
    ]);

    expect(failed).toHaveLength(3);
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect(providerState.instances).toHaveLength(1);
    expect(providerState.instances[0]).toMatchObject({
      networkCalls: 1,
      destroyCalls: 1,
      signerCalls: 0,
      sendCalls: 0
    });

    const recovered = await loadCotiHttpProvider();
    expect(providerState.instances).toHaveLength(2);
    expect(providerState.instances[1]).toMatchObject({
      url: CONFIGURED_COTI_NETWORK.rpcUrl,
      networkCalls: 1,
      destroyCalls: 0,
      signerCalls: 0,
      sendCalls: 0
    });
    expect(await loadCotiHttpProvider()).toBe(recovered);
    expect(providerState.instances).toHaveLength(2);
  });

  it('rejects and destroys a wrong-chain provider without promoting it to the cache', async () => {
    providerState.outcomes.push(
      { kind: 'wrong', chainId: BigInt(CONFIGURED_COTI_NETWORK.chainIdDecimal) + 1n },
      { kind: 'configured' }
    );
    const loadCotiHttpProvider = await loadCore();

    await expect(loadCotiHttpProvider()).rejects.toThrow();
    expect(providerState.instances).toHaveLength(1);
    expect(providerState.instances[0]).toMatchObject({
      networkCalls: 1,
      destroyCalls: 1,
      signerCalls: 0,
      sendCalls: 0
    });

    const configuredProvider = await loadCotiHttpProvider();
    expect(providerState.instances).toHaveLength(2);
    expect(providerState.instances[1]).toMatchObject({
      networkCalls: 1,
      destroyCalls: 0,
      signerCalls: 0,
      sendCalls: 0
    });
    expect(await loadCotiHttpProvider()).toBe(configuredProvider);
    expect(providerState.instances).toHaveLength(2);
  });

  it('clears only the matching cached provider after the SDK bootstrap network error', async () => {
    const loadCotiHttpProvider = await loadCore();
    const first = await loadCotiHttpProvider();
    const firstRecord = providerState.instances[0];
    expect(firstRecord?.errorHandlers).toHaveLength(1);

    const bootstrapError = Object.assign(new Error('Initial network discovery failed'), {
      code: 'NETWORK_ERROR',
      event: 'initial-network-discovery'
    });
    for (const handler of firstRecord!.errorHandlers) handler(bootstrapError);
    expect(firstRecord?.destroyCalls).toBe(1);

    const second = await loadCotiHttpProvider();
    expect(second).not.toBe(first);
    expect(providerState.instances).toHaveLength(2);
    expect(providerState.instances[1]).toMatchObject({
      url: CONFIGURED_COTI_NETWORK.rpcUrl,
      networkCalls: 1,
      destroyCalls: 0,
      signerCalls: 0,
      sendCalls: 0
    });

    // A late event from a retired provider must not evict or destroy the newer provider.
    for (const handler of firstRecord!.errorHandlers) handler(bootstrapError);
    expect(firstRecord?.destroyCalls).toBe(1);
    expect(await loadCotiHttpProvider()).toBe(second);
    expect(providerState.instances).toHaveLength(2);
  });
});
