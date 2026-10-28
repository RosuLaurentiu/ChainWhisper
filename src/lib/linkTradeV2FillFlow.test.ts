import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import artifact from '../../tests/fixtures/full-candidate-ChainWhisperLinkOTCEscrowV2.json';
import { executeLinkTradeV2Fill, reconcileLinkTradeV2Fill, continueLinkTradeV2Fill } from './linkTradeV2FillFlow';
import { readLinkTradeV2Review } from './linkTradeV2';
import { createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';
import { cleanupLinkTradeV2Creation } from './linkTradeV2OwnerActions';
import { sealLinkTradeV2Terms, linkTradeV2CredentialDomain } from './linkTradeV2Terms';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import type { LinkTradeV2CreationStore, LinkTradeV2CreationStoredRow } from './linkTradeV2CreationStore';
const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), read: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), balance: vi.fn(), allowance: vi.fn(), wait: vi.fn() }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding, assertOwnerTradeV2CapabilityCurrent: m.current,
  assertOwnerTradeV2CapabilitySnapshotCurrent: m.current, waitForOwnerTradeV2Receipt: m.wait }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: vi.fn(), readAttestedTradeHistoryV2View: m.read }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.encrypt, decryptPrivateUint256Output: m.decrypt }));
vi.mock('./appChain', async () => ({ resolvePrivateTokenAllowanceWritePlan: (await vi.importActual<typeof import('./appChain')>('./appChain')).resolvePrivateTokenAllowanceWritePlan,
  readPrivateTokenBalanceWei: m.balance, readPrivateTokenAllowanceWei: m.allowance }));
const address = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const owner = address('11'), maker = address('22'), escrow = address('33'), offerToken = address('44'), requestToken = address('55');
const code = '0x6000', codeHash = keccak256(code), full = new Interface(artifact.abi);
const publicToken = new Interface(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const privateToken = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const privateTransfer = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const fixture = async (privatePair = false, remaining = 4n, initialAllowance = 0n) => {
  let offerBalance = 100n, requestBalance = 1000n, allowance = initialAllowance, nonce = 0, revision = 1n;
  const rows = new Map<string, LinkTradeV2CreationStoredRow>(), transactions = new Map(), receipts = new Map();
  const store: LinkTradeV2CreationStore = {
    claim: async row => { if ([...rows.values()].some(v => v.activeOwner === row.activeOwner)) throw new Error('Pending Link action.'); rows.set(row.id, structuredClone(row)); },
    read: async id => structuredClone(rows.get(id) ?? null), active: async key => structuredClone([...rows.values()].find(r => r.activeOwner === key) ?? null),
    latest: async key => structuredClone([...rows.values()].filter(r => r.ownerKey === key).slice(-1)[0] ?? null),
    replace: async (row, rev) => { if (rows.get(row.id)?.revision !== rev) throw new Error('Stale journal.'); rows.set(row.id, structuredClone(row)); }
  };
  const terms = { offerToken, requestToken, privatePair, priceOffer: '2', priceRequest: '3', expiresAt: '0' };
  const context = { chainId: '7082400', escrow, maker, makerNonce: hash(88), credentialEpoch: '1' }, secret = hash(77);
  const reference = { chainId: '7082400', escrow, id: '9007199254740993', revision: '1', credentialEpoch: '1' };
  const sealed = await sealLinkTradeV2Terms(context, terms, secret);
  m.read.mockImplementation(async () => full.encodeFunctionResult('getOrderView', [[
    [maker, offerToken, requestToken, codeHash, codeHash, context.makerNonce, 0n, revision, 1n, 1n, privatePair, true], 1n,
    privatePair ? [0n, 0n] : [2n, 3n], privatePair ? 0n : remaining, privatePair ? 0n : remaining, sealed, linkTradeV2CredentialDomain(context) ]]));
  m.balance.mockImplementation(async (token, account) => { expect(account).toBe(owner); return token === offerToken ? offerBalance : requestBalance; });
  m.allowance.mockImplementation(async () => allowance);
  m.encrypt.mockImplementation(async (_signer, value) => ({ ciphertext: { ciphertextHigh: 0n, ciphertextLow: value }, signature: '0x1234' }));
  m.decrypt.mockImplementation((_signer, ct) => { const value = BigInt(ct.ciphertextLow); if (value >= 1000n) throw new Error('Other recipient ciphertext.'); return value; });
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })), getCode: vi.fn(async () => code), getFeeData: vi.fn(async () => ({ gasPrice: 2n })),
    getBalance: vi.fn(async () => 1000000n), getTransactionCount: vi.fn(async () => nonce), estimateGas: vi.fn(async (_call: { data: string }) => 100n),
    getTransaction: vi.fn(async (h: string) => transactions.get(h)), getTransactionReceipt: vi.fn(async (h: string) => receipts.get(h) ?? null),
    getBlock: vi.fn(async (n: string | number) => ({ number: n === 'latest' ? 10 : Number(n), hash: hash(999), timestamp: 1, gasLimit: 10000n, transactions: [...transactions.keys()] })),
    call: vi.fn(async ({ to, data }: { to: string; data: string }) => {
      if (data === privateToken.getFunction('publicAmountsEnabled')!.selector) return privateToken.encodeFunctionResult('publicAmountsEnabled', [false]);
      const call = publicToken.parseTransaction({ data })!;
      return publicToken.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? to === offerToken ? offerBalance : requestBalance : allowance]);
    })
  };
  const signer = { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }), sendTransaction: vi.fn(async (call: Record<string, unknown>) => {
    const h = hash(++nonce), blockNumber = nonce + 10, tx = { ...call, from: owner, hash: h, chainId: 7082400n };
    transactions.set(h, tx); const logs: object[] = [];
    if (call.to === requestToken) {
      const parsed = (privatePair ? privateToken : publicToken).parseTransaction({ data: call.data as string })!;
      const value = privatePair ? BigInt(parsed.args[1].ciphertext.ciphertextLow) : BigInt(parsed.args[1]);
      allowance = parsed.name === 'increaseAllowance' ? allowance + value : parsed.name === 'decreaseAllowance' ? allowance - value : value;
    } else {
      const parsed = full.parseTransaction({ data: call.data as string })!;
      expect(parsed.args.ref.id.toString()).toBe(reference.id); expect(parsed.args.ref.revision).toBe(revision);
      const maximum = privatePair ? BigInt(parsed.args.maximumPayment.ciphertext.ciphertextLow) : BigInt(parsed.args.maximumPayment);
      const requested = maximum * 2n / 3n, offer = requested > remaining ? remaining : requested, payment = (offer * 3n + 1n) / 2n, refund = maximum - payment;
      offerBalance += offer; requestBalance -= payment; allowance -= maximum; remaining -= offer; revision++;
      const transfer = (token: string, from: string, to: string, value: bigint) => ({ address: token,
        ...(privatePair ? privateTransfer : publicToken).encodeEventLog((privatePair ? privateTransfer : publicToken).getEvent('Transfer')!, privatePair
          ? [from, to, [0n, from === owner ? value : 1000n + value], [0n, to === owner ? value : 1000n + value]] : [from, to, value]) });
      logs.push(transfer(requestToken, owner, escrow, maximum), transfer(offerToken, escrow, owner, offer), transfer(requestToken, escrow, maker, payment), transfer(requestToken, escrow, owner, refund));
      if (privatePair) {
        const ut = (v: bigint, own: boolean) => [[0n, 1n], [0n, own ? v : v + 1000n]];
        for (const recipient of [owner, maker]) logs.push({ address: escrow, ...full.encodeEventLog(full.getEvent('PrivateLinkReceipt')!,
          [reference.id, recipient, revision, ut(offer, recipient === owner), ut(payment, recipient === owner), ut(recipient === owner ? refund : 0n, recipient === owner)]) });
      }
      logs.push({ address: escrow, ...full.encodeEventLog(full.getEvent('LinkFilled')!, [reference.id, owner, revision, privatePair ? 0n : offer, privatePair ? 0n : payment, privatePair ? 0n : refund]) });
    }
    receipts.set(h, { hash: h, from: owner, to: call.to, status: 1, blockNumber, blockHash: hash(999), gasUsed: 80n, gasPrice: 2n,
      logs: logs.map((log, index) => ({ ...log, transactionHash: h, blockHash: hash(999), blockNumber, index, removed: false })) });
    return tx;
  }) };
  m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer, readProvider: provider });
  m.wait.mockImplementation(async (_binding, h) => receipts.get(h));
  const capability = {} as never, deployment = { protocol: 'link-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: codeHash } as never;
  const readCapability = {} as never, journal = createLinkTradeV2CreationJournal({ capability, deployment, store });
  const review = await readLinkTradeV2Review({ capability: readCapability, deployment, reference, secret });
  return { input: { capability, deployment, readCapability, journal, review, maximumPayment: '10' }, provider, signer, journal, rows, transactions, receipts,
    setRequest: (v: bigint) => { requestBalance = v; }, changeRevision: () => { revision++; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Link fill; real client crypto, full ABI, sender and journal, mocked native wallet/RPC/token state', () => {
  it.each([false, true])('approves only the request token, settles a partial fill and verifies the refund, private=%s', async privatePair => {
    const f = await fixture(privatePair); const result = await executeLinkTradeV2Fill(f.input);
    expect(result).toMatchObject({ offerReceived: '4', payment: '6', refund: '4', reference: { revision: '2' } });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([requestToken, escrow]);
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '320', records: [{ step: 'approval', state: 'confirmed' }, { step: 'fill', state: 'confirmed' }] });
    const stored = JSON.stringify([...f.rows.values()]); expect(stored).not.toContain('maximumPayment'); expect(stored).not.toContain(hash(77));
    if (privatePair) expect(m.decrypt).toHaveBeenCalledTimes(6);
  });
  it.each([false, true])('returns a full refund for zero output without a private success branch, private=%s', async privatePair => {
    const f = await fixture(privatePair, 0n, 10n);
    expect(await executeLinkTradeV2Fill(f.input)).toMatchObject({ offerReceived: '0', payment: '0', refund: '10' });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('resets a different public allowance and accounts upward payment rounding', async () => {
    const f = await fixture(false, 3n, 2n);
    expect(await executeLinkTradeV2Fill(f.input)).toMatchObject({ offerReceived: '3', payment: '5', refund: '5' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([requestToken, requestToken, escrow]);
  });
  it('rejects a cloned review, changed revision, missing balance, changed code and public private-token mode without a send', async () => {
    for (const fault of ['clone', 'revision', 'balance', 'code', 'mode']) {
      const f = await fixture(true);
      if (fault === 'clone') f.input.review = { ...f.input.review };
      if (fault === 'revision') f.changeRevision();
      if (fault === 'balance') m.balance.mockResolvedValue(null);
      if (fault === 'code') f.provider.getCode.mockResolvedValue('0x6001');
      if (fault === 'mode') f.provider.call.mockImplementation(async () => privateToken.encodeFunctionResult('publicAmountsEnabled', [true]));
      await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('continues the same prepared fill after approval with fresh inputs and no new claim', async () => {
    const f = await fixture(true);
    f.provider.estimateGas.mockImplementation(async ({ data }) => { if (full.parseTransaction({ data })?.name === 'fillPrivateLink') throw new Error('Fit unavailable.'); return 100n; });
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(/estimation failed/);
    const saved = (await f.journal.read())!; expect(saved).toMatchObject({ active: true, records: [{ step: 'approval', state: 'confirmed' }] });
    const oldSignatures = m.encrypt.mock.calls.length; f.provider.estimateGas.mockResolvedValue(100n);
    expect(await continueLinkTradeV2Fill({ ...f.input, fillId: saved.id })).toMatchObject({ offerReceived: '4' });
    expect(f.rows.size).toBe(1); expect(m.encrypt.mock.calls.length).toBe(oldSignatures + 4);
  });
  it('clears a stale fill preparation approval without funding, and retains its original fee', async () => {
    const f = await fixture(true);
    f.provider.estimateGas.mockImplementation(async ({ data }) => { if (full.parseTransaction({ data })?.name === 'fillPrivateLink') throw new Error('Fit unavailable.'); return 100n; });
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(); const saved = (await f.journal.read())!;
    await cleanupLinkTradeV2Creation({ ...f.input, creationId: saved.id });
    expect(await f.journal.read()).toMatchObject({ abandoned: true, active: false, feeWei: '320', records: [{ step: 'approval' }, { step: 'cleanup' }] });
    expect(f.signer.sendTransaction.mock.calls.every(([r]) => r.to === requestToken)).toBe(true);
  });
  it('restores a lost fill response and a later confirmed receipt without another token send or current balance read', async () => {
    const f = await fixture(true, 4n, 10n), send = f.signer.sendTransaction.getMockImplementation()!;
    f.signer.sendTransaction.mockImplementation(async call => { await send(call); throw new Error('Wallet response lost.'); });
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(/uncertain/);
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(/Pending|stale/);
    expect(await reconcileLinkTradeV2Fill({ ...f.input, transactionHash: hash(1) })).toMatchObject({ offerReceived: '4', refund: '4' });
    m.balance.mockClear(); m.balance.mockResolvedValue(null);
    expect(await reconcileLinkTradeV2Fill(f.input)).toMatchObject({ payment: '6' });
    expect(m.balance).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('retains the exact fee and no-resend lock for unproved delivery, then recovers from the same receipt', async () => {
    const f = await fixture(true, 4n, 10n); m.balance.mockImplementation(async token => token === offerToken ? 100n : 1000n);
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow(/not exactly accounted/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '160', records: [{ state: 'submitted' }] });
    m.balance.mockImplementation(async token => token === offerToken ? 104n : 994n);
    expect(await reconcileLinkTradeV2Fill(f.input)).toMatchObject({ payment: '6' });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it.each(['public-price', 'private-price', 'recipient', 'origin', 'duplicate'])('holds a bad %s receipt with its fee retained', async fault => {
    const privatePair = fault !== 'public-price', f = await fixture(privatePair, 4n, 10n);
    m.wait.mockImplementation(async (_binding, h) => {
      const receipt = f.receipts.get(h);
      if (fault === 'origin') receipt.logs[0].blockHash = hash(998);
      else if (fault === 'duplicate') receipt.logs.push(receipt.logs[0]);
      else {
        const name = privatePair ? 'PrivateLinkReceipt' : 'LinkFilled';
        const log = receipt.logs.find((v: { topics: string[] }) => v.topics[0] === full.getEvent(name)!.topicHash);
        const args = [...full.decodeEventLog(name, log.data, log.topics)];
        if (!privatePair) args[3] = 5n;
        else if (fault === 'recipient') args[1] = maker;
        else args[4] = [[0n, 1n], [0n, 7n]];
        Object.assign(log, full.encodeEventLog(full.getEvent(name)!, args));
      }
      return receipt;
    });
    await expect(executeLinkTradeV2Fill(f.input)).rejects.toThrow();
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '160', records: [{ step: 'fill', state: 'submitted' }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
  });
});
