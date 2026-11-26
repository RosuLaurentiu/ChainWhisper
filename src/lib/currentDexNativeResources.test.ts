import { describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider } from '@coti-io/coti-ethers';
import { createCurrentAttemptBoundary, CURRENT_NATIVE_FIXED_GAS_PRICE as fee, CURRENT_NATIVE_RECOVERY_RESERVE as reserve } from './currentDexSubmission';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './dexV2Deployment';

function fixture(now = () => 100n) {
  const c = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
  const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`, values = new Map<string, string>();
  const head = { number: 10n, hash, timestamp: 100n, gasLimit: 120_000_000n };
  const resources = { owner, chainId: 7082400n, head, latestNonce: 4, pendingNonce: 4, baseFeePerGas: 1n, gasPrice: fee,
    balance: reserve + 70_000_000n * fee, code: '0x' };
  const transport = { assertCurrent: vi.fn(async () => {}), readHead: vi.fn(async () => head), readNonce: vi.fn(async () => 4),
    readNativeResources: vi.fn(async (_head: typeof head) => resources), estimateGas: vi.fn(async () => 37_000_000n),
    send: vi.fn(async (request: { chainId: bigint; from: string; to: string; value: 0n; data: string; gasLimit: bigint; nonce?: number; gasPrice?: bigint }) => ({ ...request, hash })),
    waitForReceipt: vi.fn(async () => ({ hash, status: 1, from: owner, to: c.core, blockNumber: 10, blockHash: hash, logs: [] })),
    readTransaction: vi.fn(async () => ({ chainId: 7082400n, from: owner, to: c.core, value: 0n, data: '0x1234', nonce: 4,
      gasLimit: 70_000_000n, hash, blockNumber: 10, blockHash: hash })), readBlockHash: vi.fn(async () => hash), verifyCanonicalInclusion: vi.fn(async () => {}) };
  const signing = vi.fn(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const boundary = createCurrentAttemptBoundary({ c, core: c.core, owner, chainId: 7082400n, transport, storage,
    historical: false, now, attest: vi.fn(async () => {}) });
  return { resources, transport, values, signing, boundary, c, owner, hash,
    send: (validate = vi.fn()) => boundary.sendCurrent('quote', { chainId: 7082400n, from: owner, to: c.core, value: 0n, data: '0x1234' }, 200n, validate, signing, undefined, 70_000_000n) };
}

describe('native send resources', () => {
  it('enforces the current App hold before precheck or signing', async () => {
    const f = fixture(), c = f.c, storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const boundary = createCurrentAttemptBoundary({ c, core: c.core, owner: f.owner, chainId: 7082400n,
      transport: f.transport, storage, historical: false, now: () => 100n, attest: vi.fn() });
    await expect(boundary.sendCurrent('quote', { chainId: 7082400n, from: f.owner, to: c.core, value: 0n,
      data: '0x1234' }, 200n, vi.fn(), f.signing, undefined, 70_000_000n)).rejects.toThrow('signing hold');
    expect(f.transport.readHead).not.toHaveBeenCalled(); expect(f.transport.readNativeResources).not.toHaveBeenCalled();
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.signing).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('rechecks the current hold after asynchronous signing admission', async () => {
    const f = fixture(), c: { graph: string } = { graph: '00'.repeat(32) }, storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const boundary = createCurrentAttemptBoundary({ c, core: f.c.core, owner: f.owner, chainId: 7082400n,
      transport: f.transport, storage, historical: false, now: () => 100n, attest: vi.fn() });
    const authorize = vi.fn(async () => { await Promise.resolve(); c.graph = f.c.graph; });
    await expect(boundary.sendCurrent('quote', { chainId: 7082400n, from: f.owner, to: f.c.core, value: 0n,
      data: '0x1234' }, 200n, vi.fn(), f.signing, undefined, 70_000_000n, undefined, authorize))
      .rejects.toThrow('signing hold');
    expect(authorize).toHaveBeenCalledOnce();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.signing).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('encodes the explicit fixed fee with the installed wallet RPC serializer', () => {
    // The installed serializer is pure. No provider or network connection is created.
    const request = JsonRpcProvider.prototype.getRpcTransaction.call({} as JsonRpcProvider,
      { gasPrice: fee, gasLimit: 70_000_000n, nonce: 4 });
    expect(request).toEqual({ gasPrice: '0x2faf080', gas: '0x42c1d80', nonce: '0x4' });
    expect(request).not.toHaveProperty('maxFeePerGas');
  });
  it('reconciles a known native hash without resources or fresh fee/admission', async () => {
    const f = fixture(); Object.assign(f.transport, { readNativeResources: undefined });
    await expect(f.boundary.verifyMinedCall({ chainId: 7082400n, from: f.owner, to: f.c.core, value: 0n, data: '0x1234', nonce: 4, gasLimit: 70_000_000n }, f.hash)).resolves.toMatchObject({ status: 1 });
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
});
