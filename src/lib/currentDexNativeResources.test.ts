import { describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider } from '@coti-io/coti-ethers';
import { createCurrentAttemptBoundary, CURRENT_NATIVE_FIXED_GAS_PRICE as fee, CURRENT_NATIVE_RECOVERY_RESERVE as reserve } from './currentDexSubmission';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE } from './dexV2Deployment';
import { STAGED_D06_DEX_CANDIDATE } from './currentDexC1Candidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';

function fixture(native = true, now = () => 100n) {
  const c = native ? STAGED_NATIVE_DEX_CANDIDATE : ARCHIVED_CHEAP_DEX_CANDIDATE;
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
  it('captures a fresh signing head after slow owner validation', async () => {
    let clock = 100n;
    const f = fixture(true, () => clock);
    f.transport.readHead.mockImplementation(async () => ({ ...f.resources.head, timestamp: clock }));
    f.transport.readNativeResources.mockImplementation(async head => ({ ...f.resources, head }));
    let validations = 0;
    const validate = vi.fn(async () => { if (++validations === 2) clock += 91n; });
    await f.send(validate);
    expect(f.transport.readNativeResources.mock.calls[1][0].timestamp).toBe(191n);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([STAGED_D06_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE])('enforces the real $graph App hold before precheck or signing', async c => {
    const f = fixture(), storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const boundary = createCurrentAttemptBoundary({ c, core: c.core, owner: f.owner, chainId: 7082400n,
      transport: f.transport, storage, historical: false, now: () => 100n, attest: vi.fn() });
    await expect(boundary.sendCurrent('quote', { chainId: 7082400n, from: f.owner, to: c.core, value: 0n,
      data: '0x1234' }, 200n, vi.fn(), f.signing, undefined, 70_000_000n)).rejects.toThrow('connected App-wallet hold');
    expect(f.transport.readHead).not.toHaveBeenCalled(); expect(f.transport.readNativeResources).not.toHaveBeenCalled();
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.signing).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each([STAGED_D06_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE])('rechecks the real $graph hold after asynchronous signing admission', async held => {
    const f = fixture(), c: { graph: string } = { graph: f.c.graph }, storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const boundary = createCurrentAttemptBoundary({ c, core: f.c.core, owner: f.owner, chainId: 7082400n,
      transport: f.transport, storage, historical: false, now: () => 100n, attest: vi.fn() });
    const authorize = vi.fn(async () => { await Promise.resolve(); c.graph = held.graph; });
    await expect(boundary.sendCurrent('quote', { chainId: 7082400n, from: f.owner, to: f.c.core, value: 0n,
      data: '0x1234' }, 200n, vi.fn(), f.signing, undefined, 70_000_000n, undefined, authorize))
      .rejects.toThrow('connected App-wallet hold');
    expect(authorize).toHaveBeenCalledOnce(); expect(f.transport.estimateGas).toHaveBeenCalledOnce();
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
  it('checks resources before estimate and again before pending, using the explicit fixed fee', async () => {
    const f = fixture(); await f.send();
    expect(f.transport.readNativeResources).toHaveBeenCalledTimes(2);
    expect(f.transport.readNativeResources.mock.invocationCallOrder[0]).toBeLessThan(f.transport.estimateGas.mock.invocationCallOrder[0]);
    expect(f.transport.readNativeResources.mock.invocationCallOrder[1]).toBeLessThan(f.signing.mock.invocationCallOrder[0]);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ gasPrice: fee, gasLimit: 70_000_000n, nonce: 4 }), expect.any(Function));
  });
  it.each(['missing', 'balance', 'pending', 'latest', 'code', 'fee-zero', 'fee-high', 'owner', 'chain', 'head', 'lease'])('rejects %s before estimate or pending', async fault => {
    const f = fixture();
    if (fault === 'missing') Object.assign(f.transport, { readNativeResources: undefined });
    if (fault === 'balance') f.resources.balance--;
    if (fault === 'pending') f.resources.pendingNonce++;
    if (fault === 'latest') f.resources.latestNonce++;
    if (fault === 'code') f.resources.code = '0x00';
    if (fault === 'fee-zero') f.resources.gasPrice = 0n;
    if (fault === 'fee-high') f.resources.baseFeePerGas = fee + 1n;
    if (fault === 'owner') f.resources.owner = f.c.core;
    if (fault === 'chain') f.resources.chainId++;
    if (fault === 'head') f.resources.head = { ...f.resources.head, hash: `0x${'44'.repeat(32)}` };
    if (fault === 'lease') f.transport.readNativeResources.mockRejectedValue(new Error('Lease revoked'));
    await expect(f.send()).rejects.toThrow(); expect(f.values.size).toBe(0);
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.signing).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['balance', 'nonce', 'fee', 'head', 'lease'])('stops final %s drift before durable pending', async fault => {
    const f = fixture(); f.transport.readNativeResources.mockImplementationOnce(async () => f.resources).mockImplementationOnce(async () => {
      if (fault === 'balance') f.resources.balance--;
      if (fault === 'nonce') f.resources.pendingNonce++;
      if (fault === 'fee') f.resources.baseFeePerGas = fee + 1n;
      if (fault === 'head') f.resources.head = { ...f.resources.head, number: 11n };
      if (fault === 'lease') throw new Error('Lease revoked');
      return f.resources;
    });
    await expect(f.send()).rejects.toThrow(); expect(f.transport.estimateGas).toHaveBeenCalledOnce();
    expect(f.values.size).toBe(0); expect(f.signing).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects a wallet fee override and retains permanent uncertain metadata', async () => {
    const f = fixture(); f.transport.send.mockImplementationOnce(async request => ({ ...request, gasPrice: fee + 1n, hash: f.hash }));
    await expect(f.send()).rejects.toThrow('gasPrice'); expect(f.values.size).toBe(1);
    expect([...f.values.values()][0]).toContain('"txHash":null'); await expect(f.send()).rejects.toThrow('pending');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('preserves archived sends without resource reads or explicit fee', async () => {
    const f = fixture(false); Object.assign(f.transport, { readNativeResources: undefined }); const sent = await f.send();
    expect(sent.request).not.toHaveProperty('gasPrice'); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('reconciles a known native hash without resources or fresh fee/admission', async () => {
    const f = fixture(); Object.assign(f.transport, { readNativeResources: undefined });
    await expect(f.boundary.verifyMinedCall({ chainId: 7082400n, from: f.owner, to: f.c.core, value: 0n, data: '0x1234', nonce: 4, gasLimit: 70_000_000n }, f.hash)).resolves.toMatchObject({ status: 1 });
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
});
