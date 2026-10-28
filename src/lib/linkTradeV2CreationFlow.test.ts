import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeLinkTradeV2Creation, reconcileLinkTradeV2Creation, continueLinkTradeV2Creation, sendLinkTradeV2Transaction, ensureLinkTradeV2Allowance, type LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import { buildLinkTradeV2Path } from './linkTradeV2Links';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), wait: vi.fn(), prepare: vi.fn(),
  prepareRecovery: vi.fn(), recheck: vi.fn(), parse: vi.fn(), review: vi.fn(), privateBalance: vi.fn(), privateAllowance: vi.fn(), encrypt: vi.fn(), read: vi.fn() }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding,
  assertOwnerTradeV2CapabilityCurrent: m.current, assertOwnerTradeV2CapabilitySnapshotCurrent: m.current,
  waitForOwnerTradeV2Receipt: m.wait }));
vi.mock('./linkTradeV2', () => ({ prepareLinkTradeV2Create: m.prepare, prepareLinkTradeV2CreateRecovery: m.prepareRecovery, recheckLinkTradeV2Create: m.recheck,
  parseLinkTradeV2CreationReceipt: m.parse, bindLinkTradeV2CreationReceipt: m.parse, readLinkTradeV2Review: m.review }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: vi.fn(), readAttestedTradeHistoryV2View: m.read }));
vi.mock('./appChain', async () => ({ resolvePrivateTokenAllowanceWritePlan:
  (await vi.importActual<typeof import('./appChain')>('./appChain')).resolvePrivateTokenAllowanceWritePlan,
  readPrivateTokenBalanceWei: m.privateBalance, readPrivateTokenAllowanceWei: m.privateAllowance }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.encrypt }));
const address = (v: string) => `0x${v.repeat(20)}`, hash = (v: number) => `0x${v.toString(16).padStart(64, '0')}`;
const owner = address('11'), escrow = address('22'), offerToken = address('33'), requestToken = address('44');
const token = new Interface(['function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)']);
const privateToken = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const fixture = (privatePair = false, initialAllowance = 0n) => {
  let allowance = initialAllowance, balance = 1000n, nonce = 0;
  const records: LinkTradeV2CreationRecord[] = [], order: string[] = [], transactions = new Map(), receipts = new Map();
  const terms = { offerToken, requestToken, privatePair, priceOffer: '1', priceRequest: '2', expiresAt: '0' };
  const prepared = { chainId: '7082400', from: owner, to: escrow, value: 0n, data: '0x12345678', offerBudget: '100', terms };
  const reference = { chainId: '7082400', escrow, id: '9007199254740993', revision: '1', credentialEpoch: '1' };
  const sharePath = buildLinkTradeV2Path(reference, `0x${'ab'.repeat(32)}`);
  m.prepare.mockImplementation(async input => {
    await input.onRecovery({ context: { chainId: '7082400', escrow, maker: owner, makerNonce: hash(77), credentialEpoch: '1' },
      secret: hash(88), terms, offerBudget: '100', offerCodeHash: keccak256('0x6000') });
    return prepared;
  }); m.parse.mockReturnValue({ reference, sharePath, transactionHash: hash(2) });
  m.prepareRecovery.mockImplementation(async input => { await input.onRecovery(input.material); return prepared; });
  m.review.mockResolvedValue({ reference, terms });
  m.privateBalance.mockImplementation(async () => balance); m.privateAllowance.mockImplementation(async () => allowance);
  m.encrypt.mockImplementation(async (_signer, amount) => ({ ciphertext: { ciphertextHigh: 0n, ciphertextLow: amount }, signature: '0x1234' }));
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })),
    getCode: vi.fn(async () => '0x6000'),
    getFeeData: vi.fn(async () => ({ gasPrice: 2n })), getBalance: vi.fn(async () => 1000000n),
    getTransactionCount: vi.fn(async () => nonce), estimateGas: vi.fn(async () => 100n),
    getTransaction: vi.fn(async (id: string) => transactions.get(id)),
    getTransactionReceipt: vi.fn(async (id: string) => receipts.get(id) ?? null),
    getBlock: vi.fn(async (n: number | string) => ({ number: n === 'latest' ? 1000 : Number(n), gasLimit: 10000n, timestamp: 1,
      hash: hash(999), transactions: n === 'latest' ? [] : [...transactions.values()].filter(t => t.blockNumber === n).map(t => t.hash) })),
    call: vi.fn(async ({ data }: { data: string }) => {
      if (data === privateToken.getFunction('publicAmountsEnabled')!.selector) return privateToken.encodeFunctionResult('publicAmountsEnabled', [false]);
      const call = token.parseTransaction({ data })!;
      return token.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? balance : allowance]);
    })
  };
  const signer = { sendTransaction: vi.fn(async (request: Record<string, unknown>) => {
    order.push('send'); const id = hash(++nonce), blockNumber = nonce + 10;
    const response = { ...request, hash: id, from: owner, chainId: 7082400n, blockNumber };
    transactions.set(id, response);
    let logs: unknown[] = [];
    if (request.to === offerToken) {
      const call = (privatePair ? privateToken : token).parseTransaction({ data: request.data as string })!;
      if (!privatePair) allowance = call.args[1];
      else {
        const amount = call.args[1].ciphertext.ciphertextLow;
        allowance = call.name === 'increaseAllowance' ? allowance + amount : call.name === 'decreaseAllowance' ? allowance - amount : amount;
      }
    } else {
      balance -= 100n; allowance -= 100n;
      const event = token.encodeEventLog(token.getEvent('Transfer')!, [owner, escrow, 100n]);
      logs = [{ address: offerToken, ...event }];
    }
    receipts.set(id, { status: 1, hash: id, from: owner, to: request.to, blockNumber, blockHash: hash(999),
      gasUsed: 80n, gasPrice: 2n, logs });
    return response;
  }) };
  m.wait.mockImplementation(async (_binding, id: string) => { order.push('wait'); return receipts.get(id); });
  m.binding.mockReturnValue({ signer, readProvider: provider, ownerAddress: owner, chainId: 7082400n });
  const onPending = vi.fn(async (record: LinkTradeV2CreationRecord) => {
    records.push(record); order.push(record.state);
  });
  const input = { ownerAddress: owner, readCapability: {} as never, deployment: { chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: hash(55) } as never,
    capability: {} as never, action: { terms, offerBudget: '100' }, onPending,
    onRecovery: vi.fn(async (_material: unknown) => undefined), releaseUnsent: vi.fn(async () => undefined),
    assertNoPending: vi.fn(async () => undefined) };
  return { input, provider, signer, records, receipts, transactions, order, prepared };
};
beforeEach(() => vi.resetAllMocks());
describe('exact zero allowance cleanup', () => {
  it.each([false, true])('clears private=%s allowance with one token-only zero-value call', async privatePair => {
    const f = fixture(privatePair, 100n), binding = m.binding();
    await ensureLinkTradeV2Allowance(binding, { offerToken, privatePair }, escrow, 0n,
      (step, to, data, complete) => sendLinkTradeV2Transaction({ binding, step, to, data,
        onPending: f.input.onPending, admit: async () => {}, complete }));
    expect(f.signer.sendTransaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: offerToken, value: 0n }));
    expect(f.records.filter(record => record.state === 'confirmed')).toHaveLength(1);
  });
});
describe('shared sender native Book value', () => {
  it('binds native value before signing and receipt polling', async () => {
    const f = fixture(false, 100n);
    await sendLinkTradeV2Transaction({ binding: m.binding(), step: 'create', to: escrow,
      data: '0x12345678', value: 3n, onPending: f.input.onPending,
      admit: async () => {}, complete: async () => {} });
    expect(f.provider.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ value: 3n }));
    expect(f.signer.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 3n }));
    expect(f.records[0]).toMatchObject({ state: 'sending', value: '3' });
  });

  it('reserves native value as well as the maximum gas fee', async () => {
    const f = fixture(false, 100n);
    f.provider.getBalance.mockResolvedValue(252n); // 250 gas fee + 3 value does not fit.
    await expect(sendLinkTradeV2Transaction({ binding: m.binding(), step: 'create', to: escrow,
      data: '0x12345678', value: 3n, onPending: f.input.onPending,
      admit: async () => {}, complete: async () => {} })).rejects.toThrow(/balance|fee|fund/i);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    expect(f.records).toEqual([]);
  });
});
describe('Link creation sender; RPC, wallet and preparation mocked', () => {
  it.each([false, true])('approves exactly, retains hashes before polling and verifies the debit, private=%s', async privatePair => {
    const f = fixture(privatePair); const result = await executeLinkTradeV2Creation(f.input);
    expect(result.reference.id).toBe('9007199254740993'); expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
    expect(f.records.filter(r => r.state === 'submitted' && !r.feeWei)).toHaveLength(2);
    expect(f.order.slice(0, 6)).toEqual(['sending', 'send', 'submitted', 'wait', 'submitted', 'confirmed']);
    expect(f.records[f.records.length - 1]).toMatchObject({ step: 'create', state: 'confirmed', feeWei: '160' });
    expect(JSON.stringify(f.records)).not.toContain('12345678');
    expect(m.recheck).toHaveBeenCalled(); expect(m.review).toHaveBeenCalled();
  });
  it('resets a different public allowance to zero before the exact approval', async () => {
    const f = fixture(false, 500n); await executeLinkTradeV2Creation(f.input);
    expect(f.signer.sendTransaction.mock.calls.slice(0, 2).map(([r]) => token.parseTransaction({ data: r.data as string })!.args[1]))
      .toEqual([0n, 100n]);
  });
  it('reuses an exact allowance without another approval', async () => {
    const f = fixture(false, 100n); await executeLinkTradeV2Creation(f.input);
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it.each([25n, 500n])('uses the existing private exact-allowance plan for current allowance %s', async amount => {
    const f = fixture(true, amount); await executeLinkTradeV2Creation(f.input);
    const request = f.signer.sendTransaction.mock.calls[0][0];
    const call = privateToken.parseTransaction({ data: request.data as string })!;
    expect(call.name).toBe(amount < 100n ? 'increaseAllowance' : 'decreaseAllowance');
    expect(call.args[1].ciphertext.ciphertextLow).toBe(amount < 100n ? 100n - amount : amount - 100n);
  });
  it('does not send after a pending-operation, wrong-chain, fit, fee or balance failure', async () => {
    for (const failure of ['pending', 'owner', 'chain', 'fit', 'fee', 'balance', 'persist', 'recovery-store']) {
      const f = fixture();
      if (failure === 'pending') f.input.assertNoPending.mockRejectedValue(new Error('Pending transaction.'));
      if (failure === 'owner') f.input.ownerAddress = requestToken;
      if (failure === 'chain') f.provider.getNetwork.mockResolvedValue({ chainId: 1n });
      if (failure === 'fit') f.provider.estimateGas.mockResolvedValue(10000n);
      if (failure === 'fee') f.provider.getFeeData.mockResolvedValue({ gasPrice: 0n });
      if (failure === 'balance') f.provider.getBalance.mockResolvedValue(0n);
      if (failure === 'persist') f.input.onPending.mockRejectedValue(new Error('Cannot save.'));
      if (failure === 'recovery-store') f.input.onRecovery.mockRejectedValue(new Error('Cannot seal recovery.'));
      await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow();
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('saves unsigned recovery with its balance before any allowance or creation send', async () => {
    const f = fixture();
    f.input.onRecovery.mockImplementation(async material => {
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
      expect(material).toMatchObject({ beforeBalance: '1000', offerBudget: '100', terms: f.input.action.terms });
      expect(material).not.toHaveProperty('data'); expect(material).not.toHaveProperty('signature');
    });
    await executeLinkTradeV2Creation(f.input); expect(f.input.onRecovery).toHaveBeenCalledOnce();
  });
  it('keeps an uncertain send on hold and never resends', async () => {
    const f = fixture(); f.signer.sendTransaction.mockRejectedValue(new Error('Network response lost.'));
    await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow(/uncertain/i);
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(f.records[f.records.length - 1].state).toBe('sending');
    expect(m.wait).not.toHaveBeenCalled();
  });
  it('stops changed token code or public private-token amounts before any approval send', async () => {
    for (const fault of ['code', 'privacy']) {
      const f = fixture(true);
      if (fault === 'code') f.provider.getCode.mockResolvedValue('0x6001');
      else f.provider.call.mockImplementation(async () => privateToken.encodeFunctionResult('publicAmountsEnabled', [true]));
      await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow(/code changed|not private/);
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('retains a returned hash even when the later persistence call fails', async () => {
    const f = fixture(); f.input.onPending.mockImplementation(async record => {
      if (record.state === 'submitted') throw new Error('Storage failed.');
    });
    await expect(executeLinkTradeV2Creation(f.input)).rejects.toMatchObject({ transactionHash: hash(1) });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(m.wait).not.toHaveBeenCalled();
  });
  it('records definite wallet rejection without an automatic retry', async () => {
    const f = fixture(); f.signer.sendTransaction.mockRejectedValue(Object.assign(new Error('Rejected.'), { code: 'ACTION_REJECTED' }));
    await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow(/Rejected/);
    expect(f.records[f.records.length - 1].state).toBe('rejected');
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(m.wait).not.toHaveBeenCalled();
  });
  it('does not accept a reorg during the final private/accounting reads', async () => {
    const f = fixture(false, 100n); let blockReads = 0;
    f.provider.getBlock.mockImplementation(async n => ({ number: n === 'latest' ? 1000 : Number(n), gasLimit: 10000n,
      timestamp: 1, hash: n === 'latest' || ++blockReads === 1 ? hash(999) : hash(998), transactions: [hash(1)] }));
    await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow(/canonical|reorg/i);
    expect(f.records.some(r => r.step === 'create' && r.state === 'confirmed')).toBe(false);
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('rejects canonical inclusion and exact-debit failures without another creation', async () => {
    for (const failure of ['block', 'debit']) {
      const f = fixture(false, 100n);
      if (failure === 'block') f.provider.getBlock.mockImplementation(async () => ({ number: 1000, gasLimit: 10000n, timestamp: 1, hash: hash(999), transactions: [] }));
      if (failure === 'debit') f.provider.call.mockImplementation(async ({ data }) => {
        const call = token.parseTransaction({ data })!;
        return token.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? 1000n : 100n]);
      });
      await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow();
      expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
      expect(f.records.some(r => r.step === 'create' && r.state === 'confirmed')).toBe(false);
    }
  });
});

describe('known-hash Link creation recovery; RPC, capability and token reads mocked', () => {
  const pending = async (privatePair = false) => {
    const f = fixture(privatePair, 100n); await executeLinkTradeV2Creation(f.input);
    const record: LinkTradeV2CreationRecord = { ...f.records[f.records.length - 1], state: 'submitted' };
    const recovery = f.input.onRecovery.mock.calls[0][0];
    const saved = { recovery, scope: { runtimeHash: hash(55) }, records: [record] };
    const journal = { read: vi.fn(async () => saved), onPending: f.input.onPending };
    f.signer.sendTransaction.mockClear(); m.encrypt.mockClear(); m.wait.mockClear();
    const input = { readCapability: f.input.readCapability, deployment: f.input.deployment,
      capability: f.input.capability, journal: journal as never };
    return { ...f, saved, record, journal, recoveryInput: input };
  };
  it.each([false, true])('restores a submitted creation and checks its exact fee/debit without sending, private=%s', async privatePair => {
    const f = await pending(privatePair); f.input.onPending.mockClear();
    const restored = await reconcileLinkTradeV2Creation(f.recoveryInput);
    expect(restored?.reference.id).toBe('9007199254740993');
    expect(f.input.onPending.mock.calls.map(([r]) => r.state)).toEqual(['submitted', 'confirmed']);
    expect(f.input.onPending.mock.calls[1][0].feeWei).toBe('160');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled(); expect(m.wait).not.toHaveBeenCalled();
  });
  it('returns pending after one receipt read and never submits or polls again', async () => {
    const f = await pending(); f.provider.getTransactionReceipt.mockResolvedValue(null); f.input.onPending.mockClear();
    expect(await reconcileLinkTradeV2Creation(f.recoveryInput)).toBeNull();
    expect(f.provider.getTransactionReceipt).toHaveBeenCalledOnce(); expect(f.input.onPending).not.toHaveBeenCalled();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.wait).not.toHaveBeenCalled();
  });
  it('reuses a confirmed accounting result only while its recorded receipt block is canonical', async () => {
    const f = await pending(true);
    f.saved.records = [{ ...f.record, state: 'confirmed' }];
    m.privateBalance.mockResolvedValue(0n); m.privateBalance.mockClear(); m.review.mockClear(); f.input.onPending.mockClear();
    expect((await reconcileLinkTradeV2Creation(f.recoveryInput))?.reference.id).toBe('9007199254740993');
    expect(m.privateBalance).not.toHaveBeenCalled(); expect(m.review).not.toHaveBeenCalled(); expect(f.input.onPending).not.toHaveBeenCalled();
    f.saved.records = [{ ...f.record, state: 'confirmed', blockHash: hash(998) }];
    await expect(reconcileLinkTradeV2Creation(f.recoveryInput)).rejects.toThrow(/block/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('retains the fee and closes a reverted creation only after its maker nonce is proved unused', async () => {
    const f = await pending();
    f.receipts.set(f.record.transactionHash!, { ...f.receipts.get(f.record.transactionHash!), status: 0 });
    f.input.onPending.mockClear(); m.review.mockClear();
    m.read.mockResolvedValue(new Interface(LINK_TRADE_V2_ABI).encodeFunctionResult('usedMakerNonce', [false]));
    expect(await reconcileLinkTradeV2Creation(f.recoveryInput)).toBeUndefined();
    expect(f.input.onPending.mock.calls.map(([r]) => [r.state, r.feeWei])).toEqual([['submitted', '160'], ['failed', '160']]);
    expect(m.review).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('keeps a reverted creation held if the maker nonce is used, with exact fee retained', async () => {
    const f = await pending();
    f.receipts.set(f.record.transactionHash!, { ...f.receipts.get(f.record.transactionHash!), status: 0 });
    m.read.mockResolvedValue(new Interface(LINK_TRADE_V2_ABI).encodeFunctionResult('usedMakerNonce', [true]));
    f.input.onPending.mockClear(); m.review.mockClear();
    await expect(reconcileLinkTradeV2Creation(f.recoveryInput)).rejects.toThrow(/nonce was used/);
    expect(f.input.onPending.mock.calls.map(([r]) => [r.state, r.feeWei])).toEqual([['submitted', '160']]);
    expect(m.review).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('holds unknown sends, approval-only recovery, changed scope and altered fees without a resend', async () => {
    for (const failure of ['unknown', 'approval', 'scope', 'fee', 'reorg']) {
      const f = await pending();
      if (failure === 'unknown') {
        f.saved.records = [{ ...f.record, state: 'sending', transactionHash: undefined, admission: undefined,
          gasUsed: undefined, feeWei: undefined, blockHash: undefined, blockNumber: undefined } as never];
        f.provider.getTransactionCount.mockResolvedValue(1);
      }
      if (failure === 'approval') f.saved.records = [{ ...f.record, step: 'approval' }];
      if (failure === 'scope') f.saved.scope.runtimeHash = hash(56);
      if (failure === 'fee') f.saved.records = [{ ...f.record, feeWei: '159' }];
      if (failure === 'reorg') f.provider.getBlock.mockImplementation(async () => ({ number: 100, gasLimit: 10000n, timestamp: 1, hash: hash(998), transactions: [hash(1)] }));
      f.input.onPending.mockClear();
      await expect(reconcileLinkTradeV2Creation(f.recoveryInput)).rejects.toThrow();
      expect(f.input.onPending.mock.calls.some(([r]) => r.state === 'confirmed')).toBe(false);
      expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled();
    }
  });
});

describe('same-operation Link continuation after an approval; local wallet/RPC mocks', () => {
  const interrupted = async (privatePair = false) => {
    const f = fixture(privatePair);
    m.recheck.mockRejectedValueOnce(new Error('Interrupted after approval.'));
    await expect(executeLinkTradeV2Creation(f.input)).rejects.toThrow(/Interrupted/);
    const saved = { id: 'saved-creation', active: true, recovery: f.input.onRecovery.mock.calls[0][0],
      scope: { runtimeHash: hash(55) }, records: [f.records[f.records.length - 1]] };
    const journal = { ...f.input, read: vi.fn(async () => saved) };
    f.input.assertNoPending.mockClear(); f.signer.sendTransaction.mockClear();
    const input = { readCapability: f.input.readCapability, deployment: f.input.deployment, capability: f.input.capability,
      journal: journal as never, creationId: saved.id };
    return { ...f, saved, journal, continuation: input };
  };
  it.each([false, true])('continues after a confirmed exact approval without creating another journal, private=%s', async privatePair => {
    const f = await interrupted(privatePair);
    const result = await continueLinkTradeV2Creation(f.continuation);
    expect(result.reference.id).toBe('9007199254740993');
    expect(m.prepareRecovery).toHaveBeenCalledWith(expect.objectContaining({ material: f.saved.recovery }));
    expect(f.input.assertNoPending).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    expect(f.signer.sendTransaction.mock.calls[0][0].to).toBe(escrow);
    expect(f.records.filter(r => r.step === 'create' && r.state === 'confirmed')).toHaveLength(1);
  });
  it('holds changed drafts, unconfirmed sends and changed owner balances before preparation or send', async () => {
    for (const failure of ['id', 'closed', 'pending', 'balance', 'deployment']) {
      const f = await interrupted();
      if (failure === 'id') f.continuation.creationId = 'other-creation';
      if (failure === 'closed') f.saved.active = false;
      if (failure === 'pending') f.saved.records = [{ ...f.saved.records[0], state: 'submitted' }];
      if (failure === 'deployment') f.saved.scope.runtimeHash = hash(56);
      if (failure === 'balance') f.provider.call.mockImplementation(async ({ data }) => {
        const call = token.parseTransaction({ data })!;
        return token.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? 1001n : 100n]);
      });
      m.prepareRecovery.mockClear();
      await expect(continueLinkTradeV2Creation(f.continuation)).rejects.toThrow();
      expect(m.prepareRecovery).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('reconciles an approval receipt before offering continuation', async () => {
    const f = await interrupted();
    f.saved.records = [{ ...f.saved.records[0], state: 'submitted' }]; f.input.onPending.mockClear();
    await reconcileLinkTradeV2Creation({ ...f.continuation, journal: f.journal as never });
    expect(f.input.onPending.mock.calls.map(([r]) => r.state)).toEqual(['submitted', 'confirmed']);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
});
