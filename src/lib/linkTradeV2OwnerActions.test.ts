import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import artifact from '../../tests/fixtures/full-candidate-ChainWhisperLinkOTCEscrowV2.json';
import { readLinkTradeV2OwnerOrder, executeLinkTradeV2OwnerOrderAction, reconcileLinkTradeV2OwnerAction, cleanupLinkTradeV2Creation, retryLinkTradeV2OwnerAction } from './linkTradeV2OwnerActions';
import { createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';
import type { LinkTradeV2CreationStore, LinkTradeV2CreationStoredRow } from './linkTradeV2CreationStore';
const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), wait: vi.fn(), read: vi.fn(), balance: vi.fn(), allowance: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn() }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding,
  assertOwnerTradeV2CapabilityCurrent: m.current, assertOwnerTradeV2CapabilitySnapshotCurrent: m.current, waitForOwnerTradeV2Receipt: m.wait }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: vi.fn(), readAttestedTradeHistoryV2View: m.read }));
vi.mock('./appChain', () => ({ readPrivateTokenBalanceWei: m.balance, readPrivateTokenAllowanceWei: m.allowance, resolvePrivateTokenAllowanceWritePlan: vi.fn() }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.encrypt, decryptPrivateUint256Output: m.decrypt }));
const address = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const owner = address('11'), escrow = address('22'), token = address('33'), requestToken = address('44'), orderId = '9007199254740993';
const code = '0x6000', codeHash = keccak256(code), full = new Interface(artifact.abi);
const publicToken = new Interface(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const privateTransfer = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const fixture = (privatePair = false, refund = 100n) => {
  let status = 1, revision = 5n, balance = 1000n, allowance = 100n, nonce = 0;
  const rows = new Map<string, LinkTradeV2CreationStoredRow>(), transactions = new Map(), receipts = new Map();
  const store: LinkTradeV2CreationStore = {
    claim: async row => { if ([...rows.values()].some(v => v.activeOwner === row.activeOwner)) throw new Error('Pending Link action.'); rows.set(row.id, structuredClone(row)); },
    read: async key => structuredClone(rows.get(key) ?? null), active: async key => structuredClone([...rows.values()].find(r => r.activeOwner === key) ?? null),
    latest: async key => structuredClone([...rows.values()].filter(r => r.ownerKey === key).slice(-1)[0] ?? null),
    replace: async (row, rev) => { if (rows.get(row.id)?.revision !== rev) throw new Error('Stale journal write.'); rows.set(row.id, structuredClone(row)); }
  };
  m.balance.mockImplementation(async () => balance); m.allowance.mockImplementation(async () => allowance);
  m.decrypt.mockImplementation((_signer, value) => BigInt(value.ciphertextLow));
  m.encrypt.mockImplementation(async () => ({ ciphertext: { ciphertextHigh: 0n, ciphertextLow: 0n }, signature: '0x1234' }));
  m.read.mockImplementation(async () => full.encodeFunctionResult('getOrderView', [[
    [owner, token, requestToken, codeHash, codeHash, hash(8), 1n, revision, 1n, status, privatePair, false], status === 1 ? 3 : status,
    privatePair ? [0n, 0n] : [1n, 2n], privatePair ? 0n : refund, privatePair || status !== 1 ? 0n : refund, '0x01', hash(9) ]]));
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })), getCode: vi.fn(async () => code),
    getFeeData: vi.fn(async () => ({ gasPrice: 2n })), getBalance: vi.fn(async () => 1000000n),
    estimateGas: vi.fn(async () => 100n), getTransactionCount: vi.fn(async () => nonce),
    getTransaction: vi.fn(async (h: string) => transactions.get(h)), getTransactionReceipt: vi.fn(async (h: string) => receipts.get(h) ?? null),
    getBlock: vi.fn(async (n: string | number) => ({ number: n === 'latest' ? 100 : n, hash: hash(999), timestamp: 100, gasLimit: 10000n, transactions: [...transactions.keys()] })),
    call: vi.fn(async ({ data }: { data: string }) => { const call = publicToken.parseTransaction({ data })!;
      return publicToken.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? balance : allowance]); })
  };
  const signer = { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }), sendTransaction: vi.fn(async (call: Record<string, unknown>) => {
    const h = hash(++nonce), blockNumber = nonce + 10;
    const tx = { ...call, hash: h, from: owner, chainId: 7082400n }; transactions.set(h, tx);
    const logs: unknown[] = [];
    if (call.to === escrow) {
      expect(full.parseTransaction({ data: call.data as string })!.args[0].toString()).toBe(orderId);
      status = 2; revision++; balance += refund;
      logs.push({ address: escrow, ...full.encodeEventLog(full.getEvent('LinkClosed')!, [orderId, 2, revision]) });
      const abi = privatePair ? privateTransfer : publicToken;
      logs.push({ address: token, ...abi.encodeEventLog(abi.getEvent('Transfer')!, privatePair ? [escrow, owner, [0n, 0n], [0n, refund]] : [escrow, owner, refund]) });
    } else allowance = 0n;
    receipts.set(h, { status: 1, hash: h, from: owner, to: call.to, blockHash: hash(999), blockNumber, gasUsed: 80n, gasPrice: 2n,
      logs: logs.map((log, index) => ({ ...log as object, index, removed: false, transactionHash: h, blockHash: hash(999), blockNumber })) });
    return tx;
  }) };
  m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer, readProvider: provider });
  m.wait.mockImplementation(async (_binding, h) => receipts.get(h));
  const deployment = { protocol: 'link-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: codeHash } as never, capability = {} as never;
  const journal = createLinkTradeV2CreationJournal({ capability, deployment, store });
  const input = { capability, deployment, readCapability: {} as never, journal, orderId, kind: 'cancel' as const };
  return { input, journal, rows, provider, signer, receipts, transactions, setBalance: (v: bigint) => { balance = v; }, setAllowance: (v: bigint) => { allowance = v; }, setNonce: (v: number) => { nonce = v; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Link owner exit; real ABI/journal/sender, mocked wallet/RPC/private token state', () => {
  it.each([[false, 100n], [true, 100n], [false, 0n], [true, 0n]] as const)('cancels a revoked/expired Link and accounts the exact refund, private=%s amount=%s', async (privatePair, refund) => {
    const f = fixture(privatePair, refund), before = await readLinkTradeV2OwnerOrder(f.input);
    expect(before).toMatchObject({ id: orderId, status: 1, effectiveStatus: 3 });
    const result = await executeLinkTradeV2OwnerOrderAction(f.input);
    expect(result).toMatchObject({ action: 'cancel', orderId, offerToken: token, refund: refund.toString() });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(m.encrypt).not.toHaveBeenCalled();
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '160', records: [{ step: 'cancel', state: 'confirmed' }] });
    expect(JSON.stringify([...f.rows.values()])).not.toContain('beforeBalance');
  });
  it.each([false, true])('clears an exact unused allowance and skips an already-zero allowance, private=%s', async privatePair => {
    const f = fixture(privatePair);
    await executeLinkTradeV2OwnerOrderAction({ ...f.input, kind: 'cleanup' });
    expect(await f.journal.read()).toMatchObject({ active: false, records: [{ step: 'cleanup', state: 'confirmed' }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    await executeLinkTradeV2OwnerOrderAction({ ...f.input, kind: 'cleanup' });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    expect(await f.journal.read()).toMatchObject({ active: false, abandoned: true, records: [] });
    if (privatePair) expect(m.encrypt.mock.calls[0][1]).toBe(0n);
  });
  it('stops a foreign maker, changed token code and a failed fit before sending', async () => {
    for (const failure of ['owner', 'code', 'fit']) {
      const f = fixture();
      if (failure === 'owner') m.binding.mockReturnValue({ ...m.binding.mock.results[0].value, ownerAddress: requestToken });
      if (failure === 'code') f.provider.getCode.mockResolvedValue('0x6001');
      if (failure === 'fit') f.provider.estimateGas.mockResolvedValue(10000n);
      await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow();
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('keeps an uncertain send on hold without a second transaction', async () => {
    const f = fixture(); f.signer.sendTransaction.mockRejectedValue(new Error('Unknown send.'));
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/uncertain/);
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/Pending/);
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(await f.journal.read()).toMatchObject({ active: true, records: [{ state: 'sending' }] });
  });
  it('recovers a mined cancel after the wallet response was lost, without repeating it', async () => {
    const f = fixture(true), send = f.signer.sendTransaction.getMockImplementation()!;
    f.signer.sendTransaction.mockImplementation(async call => { await send(call); throw new Error('Wallet response lost.'); });
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/uncertain/);
    expect(await f.journal.read()).toMatchObject({ active: true, records: [{ state: 'sending' }] });
    const result = await reconcileLinkTradeV2OwnerAction({ ...f.input, transactionHash: hash(1) });
    expect(result).toMatchObject({ refund: '100', transactionHash: hash(1) });
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '160', records: [{ state: 'confirmed' }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(m.wait).not.toHaveBeenCalled();
  });
  it('accounts a same-call speedup from its actual receipt, while retaining the original hash and gas price', async () => {
    const f = fixture(true); m.wait.mockRejectedValue(new Error('Receipt response lost.'));
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/response lost/);
    const tx = { ...f.transactions.get(hash(1)), hash: hash(99), gasPrice: 4n };
    const old = f.receipts.get(hash(1));
    f.transactions.delete(hash(1)); f.receipts.delete(hash(1)); f.transactions.set(tx.hash, tx);
    f.receipts.set(tx.hash, { ...old, hash: tx.hash, gasPrice: 4n,
      logs: old.logs.map((log: object) => ({ ...log, transactionHash: tx.hash })) });
    expect(await reconcileLinkTradeV2OwnerAction({ ...f.input, transactionHash: tx.hash })).toMatchObject({ refund: '100', transactionHash: tx.hash });
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '320', records: [{ state: 'confirmed',
      transactionHash: hash(1), gasPrice: '2', mined: { transactionHash: tx.hash, gasPrice: '4' } }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('retains the actual wallet cancellation fee, then permits a separately reviewed owner retry', async () => {
    const f = fixture(), send = f.signer.sendTransaction.getMockImplementation()!;
    f.signer.sendTransaction.mockRejectedValue(new Error('Wallet response lost.'));
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/uncertain/);
    const tx = { from: owner, to: owner, hash: hash(98), data: '0x', value: 0n, nonce: 0, gasLimit: 125n, gasPrice: 3n, chainId: 7082400n };
    f.transactions.set(tx.hash, tx); f.receipts.set(tx.hash, { hash: tx.hash, from: owner, to: owner, status: 1,
      blockNumber: 101, blockHash: hash(999), gasUsed: 80n, gasPrice: 3n, logs: [] }); f.setNonce(1);
    expect(await reconcileLinkTradeV2OwnerAction({ ...f.input, transactionHash: tx.hash })).toBeUndefined();
    const saved = (await f.journal.read())!;
    expect(saved).toMatchObject({ active: false, feeWei: '240', records: [{ state: 'failed', mined: { outcome: 'cancelled' } }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    f.signer.sendTransaction.mockImplementation(send);
    expect(await retryLinkTradeV2OwnerAction({ ...f.input, actionId: saved.id })).toMatchObject({ refund: '100' });
    expect(f.rows.size).toBe(2); expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it('keeps a different-call replacement on hold if the owner balance changed', async () => {
    const f = fixture(); f.signer.sendTransaction.mockRejectedValue(new Error('Wallet response lost.'));
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/uncertain/);
    const tx = { from: owner, to: requestToken, hash: hash(98), data: '0x1234', value: 0n, nonce: 0, gasLimit: 125n, gasPrice: 3n, chainId: 7082400n };
    f.transactions.set(tx.hash, tx); f.receipts.set(tx.hash, { hash: tx.hash, from: owner, to: requestToken, status: 1,
      blockNumber: 101, blockHash: hash(999), gasUsed: 80n, gasPrice: 3n, logs: [] }); f.setNonce(1); f.setBalance(999n);
    await expect(reconcileLinkTradeV2OwnerAction({ ...f.input, transactionHash: tx.hash })).rejects.toThrow(/balance changed/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '240', records: [{ state: 'submitted', mined: { outcome: 'replaced' } }] });
    const saved = (await f.journal.read())!;
    await expect(retryLinkTradeV2OwnerAction({ ...f.input, actionId: saved.id })).rejects.toThrow();
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('retains an unproved refund and exact fee, then reconciles the same hash without sending', async () => {
    const f = fixture(true); m.balance.mockResolvedValue(1000n);
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/exactly accounted/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '160', records: [{ state: 'submitted' }] });
    m.balance.mockResolvedValue(1100n); f.signer.sendTransaction.mockClear();
    expect(await reconcileLinkTradeV2OwnerAction(f.input)).toMatchObject({ refund: '100' });
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect((await f.journal.read())?.active).toBe(false);
  });
  it.each([0n, 100n])('stops an unfunded creation without a new maker nonce or deposit, allowance=%s', async currentAllowance => {
    const f = fixture(true);
    f.setAllowance(currentAllowance);
    await f.journal.assertNoPending(); await f.journal.onRecovery({ context: { chainId: '7082400', escrow, maker: owner, makerNonce: hash(8), credentialEpoch: '1' },
      secret: hash(9), terms: { offerToken: token, requestToken, privatePair: true, priceOffer: '1', priceRequest: '2', expiresAt: '0' },
      offerBudget: '100', beforeBalance: '1000', offerCodeHash: codeHash });
    const approval = { step: 'approval' as const, state: 'sending' as const, chainId: '7082400', owner, to: token, nonce: 0, dataHash: hash(18), gasLimit: '125', gasPrice: '2' };
    await f.journal.onPending(approval); await f.journal.onPending({ ...approval, state: 'submitted', transactionHash: hash(19) });
    await f.journal.onPending({ ...approval, state: 'confirmed', transactionHash: hash(19), gasUsed: '80', feeWei: '160', blockNumber: '10', blockHash: hash(999) });
    f.setNonce(1); const saved = await f.journal.read();
    if (currentAllowance > 0n) {
      f.provider.estimateGas.mockRejectedValueOnce(new Error('No estimate.'));
      await expect(cleanupLinkTradeV2Creation({ ...f.input, creationId: saved!.id })).rejects.toThrow(/estimation failed/);
      expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '160' });
      expect(await f.journal.read()).not.toHaveProperty('ownerAction');
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
    await cleanupLinkTradeV2Creation({ ...f.input, creationId: saved!.id });
    expect((await f.journal.read())?.abandoned).toBe(true);
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(currentAllowance === 0n ? 0 : 1);
    if (currentAllowance > 0n) expect(f.signer.sendTransaction.mock.calls[0][0].to).toBe(token);
    expect((await f.journal.read())?.recovery?.context.makerNonce).toBe(hash(8));
    expect((await f.journal.read())?.feeWei).toBe(currentAllowance === 0n ? '160' : '320');
    expect((await f.journal.read())?.records.map(r => r.step)).toEqual(currentAllowance === 0n ? ['approval'] : ['approval', 'cleanup']);
  });
  it('allows an explicit new attempt only after a definite wallet rejection', async () => {
    const f = fixture(true); f.signer.sendTransaction.mockRejectedValueOnce(Object.assign(new Error('Rejected'), { code: 'ACTION_REJECTED' }));
    await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/Rejected/);
    const saved = await f.journal.read();
    expect(saved).toMatchObject({ active: false, feeWei: '0', records: [{ state: 'rejected' }] });
    expect(await retryLinkTradeV2OwnerAction({ ...f.input, actionId: saved!.id })).toMatchObject({ action: 'cancel', refund: '100' });
    expect(f.rows.size).toBe(2); expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
    await expect(retryLinkTradeV2OwnerAction({ ...f.input, actionId: saved!.id })).rejects.toThrow();
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it('rejects foreign and duplicate refund logs without closing the pending record', async () => {
    for (const fault of ['origin', 'duplicate']) {
      const f = fixture(true);
      m.wait.mockImplementation(async (_binding, h) => {
        const receipt = f.receipts.get(h);
        if (fault === 'origin') receipt.logs[1].transactionHash = hash(777);
        else receipt.logs.push({ ...receipt.logs[1], index: 2 });
        return receipt;
      });
      await expect(executeLinkTradeV2OwnerOrderAction(f.input)).rejects.toThrow(/origin|transfer/);
      expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '160', records: [{ state: 'submitted' }] });
      expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    }
  });
});
