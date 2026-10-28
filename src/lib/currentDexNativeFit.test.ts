import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentAttemptBoundary, currentCheapDexGasCaps, CURRENT_CHEAP_DEX_GAS_CAPS, type CurrentTransport } from './currentDexSubmission';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';

afterEach(() => vi.restoreAllMocks());
function fixture(native = true, inclusion = true) {
  const c = native ? STAGED_NATIVE_DEX_CANDIDATE : ARCHIVED_CHEAP_DEX_CANDIDATE;
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
  const transport = { assertCurrent: vi.fn(), readHead: vi.fn(async () => ({ number: 10n, hash, timestamp: 100n, gasLimit: 120_000_000n })),
    readNonce: vi.fn(async () => 4),
    readNativeResources: vi.fn(async (head: {number: bigint; hash: string; timestamp: bigint; gasLimit: bigint}) => ({ owner, chainId: 7082400n, head, latestNonce: 4, pendingNonce: 4, gasPrice: 50_000_000n, baseFeePerGas: 1n, balance: 10n**18n, code: '0x' })), readBlockHash: vi.fn(async () => hash),
    readTransaction: vi.fn(async (): Promise<Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>[0] | null> => null),
    estimateGas: vi.fn(async () => 37_000_000n),
    waitForReceipt: vi.fn(async (): Promise<Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>[1] | null> => null),
    verifyCanonicalInclusion: inclusion ? vi.fn(async () => {}) : undefined,
    send: vi.fn(async (request: { chainId: bigint; from: string; to: string; value: 0n; data: string; nonce?: number; gasLimit: bigint }) => ({ ...request, hash })) };
  const boundary = createCurrentAttemptBoundary({ storage, c, core: c.core, owner, chainId: 7082400n, transport,
    attest: vi.fn(async () => {}), now: () => 100n, historical: false });
  const call = { chainId: 7082400n, from: owner, to: c.core, value: 0n as const, data: '0x1234' };
  const validate = vi.fn(), signing = vi.fn();
  return { c, owner, hash, values, transport, boundary, validate, signing, call,
    send: (cap = 70_000_000n) => boundary.sendCurrent('quote', call, 200n, validate, signing, undefined, cap) };
}
describe('current native caps and strict fit', () => {
  it('uses the fixed signing fee when the RPC recommendation is higher and the canonical base fee fits', async () => {
    const f = fixture(), read = f.transport.readNativeResources.getMockImplementation()!;
    f.transport.readNativeResources.mockImplementation(async head => ({ ...await read(head), gasPrice: 1_000_000_000n, baseFeePerGas: 50_000_000n }));
    await f.send();
    expect(f.transport.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ gasPrice: 50_000_000n }));
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ gasPrice: 50_000_000n }), expect.any(Function));
  });
  it.each(['over-cap', 'missing', 'negative', 'final-change'] as const)('rejects %s canonical base fee before signing or reservation', async fault => {
    const f = fixture(), read = f.transport.readNativeResources.getMockImplementation()!;
    let checks = 0;
    f.transport.readNativeResources.mockImplementation(async head => ({ ...await read(head),
      baseFeePerGas: fault === 'missing' ? undefined as unknown as bigint : fault === 'negative' ? -1n :
        fault === 'final-change' && ++checks === 1 ? 1n : 50_000_001n }));
    await expect(f.send()).rejects.toThrow('resources');
    expect(f.signing).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.each(['quote', 'accept', 'cancel', 'recover', 'token-approve', 'pool-fund'] as const)('blocks d06 %s at the shared boundary before reads, estimation or reservation', async phase => {
    const f = fixture(), c = STAGED_D06_DEX_CANDIDATE;
    const storage = { getItem: (key: string) => f.values.get(key) ?? null,
      setItem: (key: string, value: string) => { f.values.set(key, value); }, removeItem: (key: string) => { f.values.delete(key); } };
    const boundary = createCurrentAttemptBoundary({ storage, c, core: c.core, owner: f.owner, chainId: 7082400n,
      transport: f.transport, attest: vi.fn(), now: () => 100n, historical: false });
    await expect(boundary.sendCurrent(phase, { ...f.call, to: c.core }, 200n, f.validate, f.signing)).rejects.toThrow('admission is absent');
    expect(f.transport.readHead).not.toHaveBeenCalled();
    expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.signing).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.each(['block', 'status', 'logs', 'topics', 'transaction', 'missing'])('keeps native canonical proof locked after %s changes', async fault => {
    const f = fixture(), sent = await f.send();
    const receipt = { hash: f.hash, status: 1, from: f.owner, to: f.c.core, blockNumber: 10, blockHash: f.hash,
      logs: [{ address: f.c.core, topics: [f.hash], data: '0x12' }] };
    f.transport.readTransaction.mockResolvedValue({ ...sent.request, hash: f.hash, blockNumber: 10, blockHash: f.hash });
    f.transport.waitForReceipt.mockResolvedValue(receipt);
    const canonical = await f.boundary.verifyMinedCall(sent.request, f.hash);
    const baseline = Object.freeze({ ...canonical, logs: canonical.logs!.map(log => Object.freeze({ ...log, topics: [...log.topics] })) });
    if (fault === 'block') receipt.blockHash = `0x${'99'.repeat(32)}`;
    if (fault === 'status') receipt.status = 0;
    if (fault === 'logs') receipt.logs.push({ address: f.c.core, topics: [], data: '0x' });
    if (fault === 'topics') receipt.logs[0].topics.push(`0x${'99'.repeat(32)}`);
    if (fault === 'transaction') f.transport.readTransaction.mockResolvedValue({ ...sent.request, nonce: 99, hash: f.hash, blockNumber: 10, blockHash: f.hash });
    if (fault === 'missing') f.transport.verifyCanonicalInclusion!.mockRejectedValue(new Error('Canonical inclusion unavailable'));
    await expect(f.boundary.recheckMinedCall(sent.request, f.hash, baseline)).rejects.toThrow();
    expect(f.values.size).toBe(1); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['nonce','lease','resources'] as const)('rechecks %s after asynchronous final phase admission',async fault=>{
    const f=fixture(),authorize=vi.fn(async()=>{
      await Promise.resolve();
      if(fault==='nonce')f.transport.readNonce.mockResolvedValue(5);
      if(fault==='lease')f.transport.assertCurrent.mockImplementation(()=>{throw Error('Lease revoked');});
      if(fault==='resources')f.transport.readNativeResources.mockImplementation(async()=>{throw Error('Resources changed');});
    });
    await expect(f.boundary.sendCurrent('quote',f.call,200n,f.validate,f.signing,undefined,70_000_000n,undefined,authorize)).rejects.toThrow();
    expect(authorize).toHaveBeenCalledTimes(1);expect(f.signing).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();expect(f.values.size).toBe(0);
  });
  it('preserves archived caps and selects exact accepted native phase caps without activation', () => {
    expect(currentCheapDexGasCaps(ARCHIVED_CHEAP_DEX_CANDIDATE)).toBe(CURRENT_CHEAP_DEX_GAS_CAPS);
    const caps = currentCheapDexGasCaps(STAGED_NATIVE_DEX_CANDIDATE);
    expect(caps['fast-pool']).toEqual({ quote: 70_000_000n, accept: 85_000_000n });
    expect(caps['cheap-async']).toEqual({ quote: 65_000_000n, accept: 35_000_000n, cancel: 20_000_000n, recover: 50_000_000n });
    expect(assertCurrentCheapDexNativeAdmission.bind(null, STAGED_NATIVE_DEX_CANDIDATE)).toThrow(/admission is absent/);
  });
  it('estimates the actual nonce-bound native call and repeats validation before send', async () => {
    const f = fixture(); await f.send();
    expect(f.transport.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ nonce: 4, to: f.c.core, data: '0x1234' }));
    expect(f.validate).toHaveBeenCalledTimes(2); expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ gasLimit: 70_000_000n }), expect.any(Function));
  });
  it.each([0n, 50_000_001n, 49_000_000n])('rejects invalid estimate or insufficient margin before reserving/signing (%s)', async estimate => {
    const f = fixture(); f.transport.estimateGas.mockResolvedValue(estimate);
    await expect(f.send(60_000_000n)).rejects.toThrow(/estimate/);
    expect(f.signing).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it('does not fall back when native estimation fails', async () => {
    const f = fixture(); f.transport.estimateGas.mockRejectedValue(new Error('estimate unavailable'));
    await expect(f.send()).rejects.toThrow('estimate unavailable'); expect(f.values.size).toBe(0); expect(f.signing).not.toHaveBeenCalled();
  });
  it.each([9n, 10n])('rejects stale native head including the exact 90-second boundary (%s)', async timestamp => {
    const f = fixture(); f.transport.readHead.mockResolvedValue({ number: 10n, hash: `0x${'33'.repeat(32)}`, timestamp, gasLimit: 120_000_000n });
    await expect(f.send()).rejects.toThrow(/block/); expect(f.transport.estimateGas).not.toHaveBeenCalled();
    const old = fixture(false); await old.send(60_000_000n); expect(old.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('rejects revoked validation after estimation before reserving/signing', async () => {
    const f = fixture(); f.validate.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('phase revoked'); });
    await expect(f.send()).rejects.toThrow('phase revoked'); expect(f.values.size).toBe(0); expect(f.signing).not.toHaveBeenCalled();
  });
  it('requires canonical index proof and keeps pending evidence if it is unavailable', async () => {
    const f = fixture(true, false), sent = await f.send();
    f.transport.readTransaction.mockResolvedValue({ ...sent.request, hash: f.hash, blockNumber: 10, blockHash: f.hash });
    f.transport.waitForReceipt.mockResolvedValue({ hash: f.hash, status: 1, from: f.owner, to: f.c.core, blockNumber: 10, blockHash: f.hash, logs: [] });
    await expect(f.boundary.verifyMinedCall(sent.request, f.hash)).rejects.toThrow(/index verification is unavailable/);
    expect(f.values.size).toBe(1);
  });
  it('rechecks canonical inclusion and rejects receipt log changes after private verification', async () => {
    const f = fixture(), sent = await f.send(), receipt = { hash: f.hash, status: 1, from: f.owner, to: f.c.core, blockNumber: 10, blockHash: f.hash, logs: [] };
    f.transport.readTransaction.mockResolvedValue({ ...sent.request, hash: f.hash, blockNumber: 10, blockHash: f.hash });
    f.transport.waitForReceipt.mockResolvedValue(receipt);
    await f.boundary.verifyMinedCall(sent.request, f.hash);
    await f.boundary.recheckMinedCall(sent.request, f.hash, receipt);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2);
    f.transport.waitForReceipt.mockResolvedValue({ ...receipt, logs: [{ address: f.c.core, topics: [f.hash], data: '0x12' }] });
    await expect(f.boundary.recheckMinedCall(sent.request, f.hash, receipt)).rejects.toThrow(/changed after private verification/);
    expect(f.values.size).toBe(1);
  });
});
