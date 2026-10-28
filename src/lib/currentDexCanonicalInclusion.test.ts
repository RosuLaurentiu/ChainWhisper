import { describe, expect, it, vi } from 'vitest';
import type { CurrentTransport } from './currentDexSubmission';
import { verifyCurrentDexCanonicalInclusion } from './currentDexCanonicalInclusion';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';

const wiring = vi.hoisted(() => ({ issue: vi.fn(), transport: null as CurrentTransport | null }));
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: wiring.issue }));
vi.mock('./currentDexPoolSubmission', () => ({ createCurrentPoolSubmissionAdapter: (args: { transport: CurrentTransport }) => { wiring.transport = args.transport; return {}; } }));
type Inputs = Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>;
const h = (n: string) => `0x${n.repeat(64)}`, a = (n: string) => `0x${n.repeat(40)}`;
const log = { address: a('3'), topics: [h('4')], data: '0x1234' };
const origin = { index: 0, transactionHash: h('1'), blockNumber: 9, blockHash: h('5'), removed: false };
const transaction: Inputs[0] = { hash: h('1'), chainId: 7082400n, from: a('2'), to: a('3'), value: 0n, data: '0x1234',
  nonce: 7, gasLimit: 100000n, blockNumber: 9, blockHash: h('5') };
const receipt: Inputs[1] = { hash: h('1'), status: 1, from: a('2'), to: a('3'), blockNumber: 9, blockHash: h('5'), logs: [log] };
const setup = (status = 1, expectedOrigin: Record<string, unknown> | null = null) => {
  const tx: Record<string, unknown> = { hash: h('1'), chainId: '0x6c11a0', from: a('2'), to: a('3'), value: '0x0', input: '0x1234',
    nonce: '0x7', gas: '0x186a0', blockNumber: '0x9', blockHash: h('5'), transactionIndex: '0x1' };
  const rec: Record<string, unknown> = { transactionHash: h('1'), status: `0x${status}`, from: a('2'), to: a('3'), blockNumber: '0x9', blockHash: h('5'), transactionIndex: '0x1', logs: [structuredClone({ ...log, logIndex: '0x0', transactionHash: h('1'), blockNumber: '0x9', blockHash: h('5'), removed: false })] };
  const block = { number: '0x9', hash: h('5'), transactions: [h('6'), h('1')] };
  let blockReads = 0, active = true;
  const guard = vi.fn(async () => { if (!active) throw new Error('Session revoked'); });
  const rpc = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'eth_getTransactionByHash') return tx;
    if (method === 'eth_getTransactionReceipt') return rec;
    if (method === 'eth_getBlockByNumber') { blockReads++; return structuredClone(block); }
    throw new Error('Unexpected RPC');
  });
  const verify = () => verifyCurrentDexCanonicalInclusion({ rpc, assertCurrent: guard }, transaction, {
    ...receipt, status, logs: status ? [{ ...log, ...(expectedOrigin ?? {}) }] : []
  });
  if (!status) rec.logs = [];
  return { tx, rec, block, guard, rpc, verify, revoke: () => { active = false; }, blockReads: () => blockReads };
};
describe('current DEX canonical inclusion transport', () => {
  it.each([0, 1])('checks exact raw transaction/receipt and ordered inclusion for status %i without signing authority', async status => {
    const f = setup(status); await f.verify(); expect(f.blockReads()).toBe(2); expect(f.guard).toHaveBeenCalledTimes(9);
    expect(f.rpc.mock.calls.map(([method]) => method)).toEqual(['eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber']);
  });
  it.each(['hash', 'chainId', 'from', 'to', 'value', 'input', 'nonce', 'gas', 'blockNumber', 'blockHash'] as const)('rejects changed raw transaction %s', async field => {
    const f = setup(); f.tx[field] = ['hash', 'blockHash'].includes(field) ? h('8') : ['from', 'to'].includes(field) ? a('8') : field === 'input' ? '0x5678' : '0x8';
    await expect(f.verify()).rejects.toThrow('inclusion changed');
  });
  it.each(['transactionHash', 'status', 'from', 'to', 'blockNumber', 'blockHash', 'logs'] as const)('rejects changed raw receipt %s', async field => {
    const f = setup(); f.rec[field] = ['transactionHash', 'blockHash'].includes(field) ? h('8') : ['from', 'to'].includes(field) ? a('8') : field === 'logs' ? [] : '0x0';
    await expect(f.verify()).rejects.toThrow('inclusion changed');
  });
  it.each(['tx-missing', 'receipt-missing', 'unequal', 'unsafe', 'out-of-range', 'wrong-member', 'missing-members'] as const)('rejects %s index membership without fallback', async fault => {
    const f = setup();
    if (fault === 'tx-missing') delete f.tx.transactionIndex;
    if (fault === 'receipt-missing') delete f.rec.transactionIndex;
    if (fault === 'unequal') f.rec.transactionIndex = '0x0';
    if (fault === 'unsafe') f.tx.transactionIndex = f.rec.transactionIndex = '0x20000000000000';
    if (fault === 'out-of-range') f.tx.transactionIndex = f.rec.transactionIndex = '0x2';
    if (fault === 'wrong-member') f.block.transactions[1] = h('8');
    if (fault === 'missing-members') f.block.transactions = [];
    await expect(f.verify()).rejects.toThrow('inclusion changed');
  });
  it.each(['hash', 'number', 'transactions'] as const)('rejects canonical block %s drift on final read', async field => {
    const f = setup(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async method => { const value = await original(method); if (method === 'eth_getBlockByNumber' && f.blockReads() === 2) {
      return { ...f.block, [field]: field === 'transactions' ? [h('8'), h('1')] : field === 'hash' ? h('8') : '0xa' }; } return value; });
    await expect(f.verify()).rejects.toThrow('inclusion changed');
  });
  it.each([1, 2, 3, 4])('stops on revoked session after RPC %i', async call => {
    const f = setup(), original = f.rpc.getMockImplementation()!; let calls = 0;
    f.rpc.mockImplementation(async method => { const value = await original(method); if (++calls === call) f.revoke(); return value; });
    await expect(f.verify()).rejects.toThrow('Session revoked'); expect(f.rpc).toHaveBeenCalledTimes(call);
  });
  it('rejects absent raw receipt and malformed log bytes', async () => {
    const f = setup(); f.rec.logs = [{ ...log, data: '0x1' }]; await expect(f.verify()).rejects.toThrow();
    const absent = setup(); absent.rpc.mockImplementation(async method => method === 'eth_getTransactionReceipt' ? null : method === 'eth_getTransactionByHash' ? absent.tx : absent.block);
    await expect(absent.verify()).rejects.toThrow();
  });
  it('accepts exact per-log canonical origin metadata', async () => {
    const f = setup(1, origin);
    await f.verify();
    expect(f.blockReads()).toBe(2);
  });
  it.each(['absent', 'undefined'])('accepts SDK logs with %s removed only after independent raw confirmation', async omission => {
    const expected: Record<string, unknown> = { ...origin };
    if (omission === 'absent') delete expected.removed;
    else expected.removed = undefined;
    const f = setup(1, expected);
    await f.verify();
    expect(f.blockReads()).toBe(2);
    const rawLog = (f.rec.logs as Record<string, unknown>[])[0];
    for (const removed of [true, undefined, null]) {
      rawLog.removed = removed;
      await expect(f.verify()).rejects.toThrow('inclusion changed');
    }
    delete rawLog.removed;
    await expect(f.verify()).rejects.toThrow('inclusion changed');
  });
  it.each(['index', 'transactionHash', 'blockNumber', 'blockHash'] as const)(
    'rejects a missing expected log origin field: %s', async field => {
      const expected = { ...origin };
      delete expected[field];
      await expect(setup(1, expected).verify()).rejects.toThrow('inclusion changed');
    }
  );
  it.each(['index', 'transactionHash', 'blockNumber', 'blockHash', 'removed'] as const)(
    'rejects a wrong expected log origin field: %s', async field => {
      const expected = { ...origin, [field]: field === 'transactionHash' || field === 'blockHash' ? h('8') :
        field === 'removed' ? true : field === 'index' ? 1 : 10 };
      await expect(setup(1, expected).verify()).rejects.toThrow('inclusion changed');
    }
  );
  it.each(['logIndex', 'transactionHash', 'blockNumber', 'blockHash', 'removed'] as const)(
    'rejects a wrong raw RPC log origin field: %s', async field => {
      const f = setup(1, origin), rawLog = (f.rec.logs as Record<string, unknown>[])[0];
      rawLog[field] = field === 'transactionHash' || field === 'blockHash' ? h('8') :
        field === 'removed' ? true : field === 'logIndex' ? '0x1' : '0xa';
      await expect(f.verify()).rejects.toThrow('inclusion changed');
    }
  );
  it.each(['logIndex', 'transactionHash', 'blockNumber', 'blockHash', 'removed'] as const)(
    'rejects a missing raw RPC log origin field: %s', async field => {
      const f = setup(1, origin), rawLog = (f.rec.logs as Record<string, unknown>[])[0];
      delete rawLog[field];
      await expect(f.verify()).rejects.toThrow('inclusion changed');
    }
  );
  it('rejects duplicate expected canonical log indexes', async () => {
    const f = setup(1, origin), duplicateExpected = { ...log, ...origin };
    const rawLogs = f.rec.logs as Record<string, unknown>[];
    rawLogs.push({ ...rawLogs[0], logIndex: '0x0' });
    const duplicateReceipt = { ...receipt, logs: [duplicateExpected, duplicateExpected] };
    await expect(verifyCurrentDexCanonicalInclusion({ rpc: f.rpc, assertCurrent: f.guard }, transaction, duplicateReceipt))
      .rejects.toThrow('inclusion changed');
  });
  it('rejects malformed expected log origin values', async () => {
    const cases = [
      { ...origin, index: -1 }, { ...origin, index: Number.MAX_SAFE_INTEGER + 1 },
      { ...origin, transactionHash: `0x${'0'.repeat(64)}` }, { ...origin, blockHash: `0x${'0'.repeat(64)}` },
      { ...origin, blockNumber: -1 }, { ...origin, removed: null }
    ];
    for (const expected of cases) await expect(setup(1, expected).verify()).rejects.toThrow('inclusion changed');
  });
  it('wires the actual owner issuer to readProvider.send and both lease guards', async () => {
    const f = setup(), snapshot = vi.fn(), sendTransaction = vi.fn();
    wiring.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: f.guard, assertSnapshotCurrent: snapshot,
      chainId: 7082400n, ownerAddress: a('2'), readProvider: { send: f.rpc }, signer: { sendTransaction } }));
    await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    expect(wiring.transport?.verifyCanonicalInclusion).toBeTypeOf('function');
    await wiring.transport!.verifyCanonicalInclusion!(transaction, receipt);
    expect(snapshot).toHaveBeenCalledTimes(9); expect(sendTransaction).not.toHaveBeenCalled();
    snapshot.mockImplementationOnce(() => { throw new Error('Snapshot revoked'); });
    await expect(wiring.transport!.verifyCanonicalInclusion!(transaction, receipt)).rejects.toThrow('Snapshot revoked');
  });
  it('maps mined SDK logs without removed and still checks raw removal metadata', async () => {
    const f = setup(1, origin), sdkLog = { ...log, ...origin };
    delete (sdkLog as Partial<typeof sdkLog>).removed;
    wiring.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: f.guard, assertSnapshotCurrent: vi.fn(),
      chainId: 7082400n, ownerAddress: a('2'), readProvider: { send: f.rpc,
        getTransactionReceipt: async () => ({ ...receipt, logs: [sdkLog] }) }, signer: { sendTransaction: vi.fn() } }));
    await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    const mapped = await wiring.transport!.waitForReceipt(transaction.hash);
    await wiring.transport!.verifyCanonicalInclusion!(transaction, mapped!);
    (f.rec.logs as Record<string, unknown>[])[0].removed = true;
    await expect(wiring.transport!.verifyCanonicalInclusion!(transaction, mapped!)).rejects.toThrow('inclusion changed');
  });
});
