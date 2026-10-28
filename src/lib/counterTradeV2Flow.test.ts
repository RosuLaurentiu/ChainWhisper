import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, keccak256 } from '@coti-io/coti-ethers';
import artifact from '../../tests/fixtures/full-candidate-ChainWhisperCounterOTCEscrowV2.json';
import linkArtifact from '../../tests/fixtures/full-candidate-ChainWhisperLinkOTCEscrowV2.json';
import bookArtifact from '../../tests/fixtures/production-ChainWhisperPrivateOTCEscrowV2.json';
import standardArtifact from '../../tests/fixtures/production-ChainWhisperStandardOTCEscrowV2.json';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { counterTradeV2RootKey, readCounterTradeV2Proposal, reviewCounterTradeV2Proposal, prepareCounterTradeV2Proposal } from './counterTradeV2';
import { executeCounterTradeV2Proposal, cancelCounterTradeV2Proposal, continueCounterTradeV2Proposal, reconcileCounterTradeV2Proposal, cleanupCounterTradeV2Allowance, executeCounterTradeV2RecipientAction } from './counterTradeV2Flow';
import { createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';
import type { LinkTradeV2CreationStoredRow, LinkTradeV2CreationStore } from './linkTradeV2CreationStore';
import { readLinkTradeV2Review } from './linkTradeV2';
import { sealLinkTradeV2Terms, linkTradeV2CredentialDomain } from './linkTradeV2Terms';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';

const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), assert: vi.fn(), read: vi.fn(), wait: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), balance: vi.fn(), allowance: vi.fn(), plan: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: m.assert, readAttestedTradeHistoryV2View: m.read }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding, assertOwnerTradeV2CapabilityCurrent: m.current,
  assertOwnerTradeV2CapabilitySnapshotCurrent: m.current, waitForOwnerTradeV2Receipt: m.wait }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: m.encrypt, decryptPrivateUint256Output: m.decrypt }));
vi.mock('./appChain', () => ({ readPrivateTokenBalanceWei: m.balance, readPrivateTokenAllowanceWei: m.allowance, resolvePrivateTokenAllowanceWritePlan: m.plan }));
const addr = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const owner = addr('11'), maker = addr('22'), escrow = addr('33'), link = addr('44'), tokenA = addr('55'), tokenB = addr('66');
const code = '0x6001', codeHash = keccak256(code), root = { chainId: '7082400', escrow: link, id: '9007199254740993', revision: '2', credentialEpoch: '1' };
const linkRoot = root, bookRoot = { ...root, credentialEpoch: '0' };
const abi = new Interface(artifact.abi), linkAbi = new Interface(linkArtifact.abi), pub = new Interface(['function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const priv = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI), privTransfer = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const bookAbi = new Interface(bookArtifact.abi);
const standardAbi = new Interface(standardArtifact.abi);
const fixture = async (privatePair = false, bookParent: boolean | 'standard' = false) => {
  const root = bookParent ? bookRoot : linkRoot;
  let balance = 100n, allowance = 0n, nonce = 0, open = true, loseWait = false, badRoot = false;
  const proposals = new Map<string, unknown[]>(), rows = new Map<string, LinkTradeV2CreationStoredRow>(), transactions = new Map<string, object>(), receipts = new Map<string, object>();
  const store: LinkTradeV2CreationStore = {
    claim: async row => { if ([...rows.values()].some(r => r.activeOwner === row.activeOwner)) throw new Error('Pending trade.'); rows.set(row.id, structuredClone(row)); },
    read: async id => structuredClone(rows.get(id) ?? null), active: async key => structuredClone([...rows.values()].find(r => r.activeOwner === key) ?? null),
    latest: async key => structuredClone([...rows.values()].filter(r => r.ownerKey === key).slice(-1)[0] ?? null),
    replace: async (row, revision) => { if (rows.get(row.id)?.revision !== revision) throw new Error('Stale journal.'); rows.set(row.id, structuredClone(row)); }
  };
  const terms = { offerToken: tokenA, requestToken: tokenB, privatePair, priceOffer: '10', priceRequest: '15', expiresAt: '0' };
  const context = { chainId: root.chainId, escrow: link, maker, makerNonce: hash(88), credentialEpoch: '1' }, secret = hash(77);
  const sealed = await sealLinkTradeV2Terms(context, terms, secret);
  const rootContext = () => [maker, tokenA, tokenB, codeHash, codeHash, privatePair, open, 2n, BigInt(root.credentialEpoch), 0n];
  const ut = (v: bigint, recipient: string) => [[0n, 99n], [0n, recipient === owner ? v : 1000n + v]];
  m.read.mockImplementation(async ({ deployment, data, from }) => {
    const i = deployment.contractAddress === link ? bookParent === 'standard' && data.startsWith(standardAbi.getFunction('getTradeView')!.selector) ? standardAbi : linkAbi : abi, call = i.parseTransaction({ data })!;
    let values: unknown[];
    if (i === standardAbi) {
      values = [[[maker, 1n, [1n, tokenA, 10n], [1n, tokenB, 15n], [true, 0n, 0n, 0n, false], 0n, 0n, BigInt(root.id), true, codeHash, codeHash],
        [7n, 10n, 3n, 5n, 2n], 1n, 0n, 0n, hash(1)]];
    } else if (i === linkAbi) {
      if (!open) throw new Error('Parent unavailable.');
      if (call.name === 'getOrderView') values = [[[maker, tokenA, tokenB, codeHash, codeHash, context.makerNonce, 0n, 2n, 1n, 1n, privatePair, true],
        1n, privatePair ? [0n, 0n] : [10n, 15n], privatePair ? 0n : 100n, privatePair ? 0n : 100n, sealed, linkTradeV2CredentialDomain(context)]];
      else if (call.name === 'counterEscrow') values = [escrow];
      else if (call.name === 'counterEscrowCodeHash') values = [codeHash];
      else { if (call.name === 'admitCounter') expect(from).toBe(escrow); values = [rootContext()]; }
    } else if (call.name === 'approvedParentCodeHash') values = [codeHash];
    else if (call.name === 'winner') values = [0n];
    else if (call.name === 'getCounterRoot') values = [[root, rootContext(), codeHash]];
    else if (call.name === 'getCounter') {
      const p = proposals.get(call.args[0].toString()); if (!p) throw new Error('Missing proposal.');
      values = [p, privatePair ? [0n, 0n] : [4n, 5n], p[10] === 1n ? open ? 1n : 6n : p[10]];
    } else { expect(from).toBe(m.binding().ownerAddress); values = [[true, ut(4n, owner), ut(5n, owner)]]; }
    return i.encodeFunctionResult(call.name, values);
  });
  m.balance.mockImplementation(async () => balance); m.allowance.mockImplementation(async () => allowance);
  m.plan.mockImplementation((_current, requested) => ({ selectorSignature: 'approve(address,((uint256,uint256),bytes))', method: 'approve', amountWei: requested }));
  m.encrypt.mockImplementation(async (_signer, value) => ({ ciphertext: { ciphertextHigh: 0n, ciphertextLow: value }, signature: '0x1234' }));
  m.decrypt.mockImplementation((_signer, ct) => { if (BigInt(ct.ciphertextLow) >= 1000n) throw new Error('Other recipient ciphertext.'); return BigInt(ct.ciphertextLow); });
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })), getCode: vi.fn(async () => code), getFeeData: vi.fn(async () => ({ gasPrice: 2n })),
    getBalance: vi.fn(async () => 1000000n), getTransactionCount: vi.fn(async () => nonce), estimateGas: vi.fn(async () => 100n),
    getTransaction: vi.fn(async (h: string) => transactions.get(h)), getTransactionReceipt: vi.fn(async (h: string) => receipts.get(h) ?? null),
    getBlock: vi.fn(async (n: string | number) => ({ number: n === 'latest' ? 10 : Number(n), hash: hash(999), timestamp: 1, gasLimit: 10000n, transactions: [...transactions.keys()] })),
    call: vi.fn(async ({ data }: { data: string }) => {
      if (data === priv.getFunction('publicAmountsEnabled')!.selector) return priv.encodeFunctionResult('publicAmountsEnabled', [false]);
      const call = pub.parseTransaction({ data })!; return pub.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? balance : allowance]);
    })
  };
  const signer = { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }), sendTransaction: vi.fn(async (call: Record<string, unknown>) => {
    const h = hash(++nonce), blockNumber = nonce + 10, tx = { ...call, from: owner, hash: h, chainId: 7082400n }; transactions.set(h, tx);
    const logs: object[] = [], event = (i: Interface, name: string, args: unknown[], address = escrow) => logs.push({ address, ...i.encodeEventLog(i.getEvent(name)!, args) });
    const transfer = (refund = false) => { event(privatePair ? privTransfer : pub, 'Transfer', privatePair ? [refund ? escrow : owner, refund ? owner : escrow,
      [0n, refund ? 1004n : 4n], [0n, refund ? 4n : 1004n]] : [refund ? escrow : owner, refund ? owner : escrow, 4n], tokenB); };
    if (call.to === tokenB) {
      const parsed = (privatePair ? priv : pub).parseTransaction({ data: call.data as string })!;
      const v = privatePair ? BigInt(parsed.args[1].ciphertext.ciphertextLow) : BigInt(parsed.args[1]);
      allowance = parsed.name === 'increaseAllowance' ? allowance + v : parsed.name === 'decreaseAllowance' ? allowance - v : v;
    } else if (call.to === link) event(linkAbi, 'CounterAuthorized', [root.id, owner, 2n, 1n], link);
    else {
      const parsed = abi.parseTransaction({ data: call.data as string })!;
      if (parsed.name === 'cancelCounter') { balance += 4n; const p = proposals.get('1')!; p[10] = 3n; p[12] = false; event(abi, 'CounterClosed', [1n, 3n, owner]); transfer(true); }
      else {
        const child = parsed.name.endsWith('Child'), parentId = child ? 2n : 0n, depth = child ? 3n : 1n;
        if (child) expect(parsed.args.parentId).toBe(parentId); else expect(parsed.args.ref.id.toString()).toBe(root.id);
        balance -= 4n; allowance -= 4n;
        proposals.set('1', [owner, maker, tokenB, tokenA, codeHash, codeHash, counterTradeV2RootKey(root), parentId, 0n, depth, 1n, privatePair, true]);
        if (!child) event(abi, 'CounterRootBound', [counterTradeV2RootKey(root), root.chainId, link, badRoot ? '1' : root.id, 2n, BigInt(root.credentialEpoch)]);
        transfer();
        if (privatePair) for (const recipient of [owner, maker]) event(abi, 'CounterPrivateTerms', [1n, recipient, ut(4n, recipient), ut(5n, recipient)]);
        event(abi, 'CounterOpened', [1n, owner, maker, counterTradeV2RootKey(root), parentId, depth, tokenB, tokenA, privatePair, privatePair ? 0n : 4n, privatePair ? 0n : 5n, 0n]);
      }
    }
    receipts.set(h, { hash: h, from: owner, to: call.to, status: 1, blockNumber, blockHash: hash(999), gasUsed: 80n, gasPrice: 2n,
      logs: logs.map((log, index) => ({ ...log, transactionHash: h, blockHash: hash(999), blockNumber, index, removed: false })) });
    return tx;
  }) };
  m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer, readProvider: provider });
  m.wait.mockImplementation(async (_binding, h) => { if (loseWait && h === hash(3)) throw new Error('RPC unavailable.'); return receipts.get(h); });
  const capability = {} as never, deployment = { protocol: 'counter-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: codeHash } as never;
  const parentDeployment = { protocol: bookParent === 'standard' ? 'standard-v2' : bookParent ? 'private-v2' : 'link-v2', chainId: '7082400', contractAddress: link, runtimeBytecodeHash: codeHash } as never;
  const readCapability = {} as never, journal = createLinkTradeV2CreationJournal({ capability, deployment, store });
  const review = bookParent ? { bookReference: root, maker, offerToken: tokenA, requestToken: tokenB } : await readLinkTradeV2Review({ capability: readCapability, deployment: parentDeployment, reference: root, secret });
  const input = { capability, deployment, parentDeployment, readCapability, journal };
  return { input, journal, rows, signer, provider, proposals, review, store, transactions, receipts, amounts: { offer: '4', request: '5', expiresAt: '0' },
    closeParent: () => { open = false; }, setAllowance: (value: bigint) => { allowance = value; }, loseWait: () => { loseWait = true; }, restoreWait: () => { loseWait = false; }, badRoot: () => { badRoot = true; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Link counters; real client, sender and encrypted journal, modelled wallet/token/RPC', () => {
  it('funds and restores a public Standard Book counter without a Link credential', async () => {
    const f = await fixture(false, 'standard');
    expect(await executeCounterTradeV2Proposal({ ...f.input, publicOnly: true, parent: f.review, amounts: f.amounts })).toMatchObject({ kind: 'create', proposalId: '1', offer: '4', request: '5' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([tokenB, escrow]);
    expect(m.encrypt).not.toHaveBeenCalled();
    expect(await f.journal.read()).toMatchObject({ active: false, counter: { material: { root: bookRoot, privatePair: false } } });
    f.closeParent();
    expect(await cancelCounterTradeV2Proposal({ ...f.input, privateOnly: true, recoveryOnly: true, proposalId: '1' })).toMatchObject({ kind: 'cancel', refund: '4' });
  });
  it('holds public new funding before signatures, approval or journal writes in private-only scope', async () => {
    const f = await fixture();
    await expect(executeCounterTradeV2Proposal({ ...f.input, privateOnly: true, parent: f.review, amounts: f.amounts })).rejects.toThrow(/Public counter/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled(); expect(await f.journal.read()).toBeNull();
  });
  it('preserves public funded cancellation after admission changes to private-only scope', async () => {
    const f = await fixture(); await executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts });
    f.closeParent();
    expect(await cancelCounterTradeV2Proposal({ ...f.input, privateOnly: true, recoveryOnly: true, proposalId: '1' })).toMatchObject({ kind: 'cancel', refund: '4' });
  });
  it('holds private new funding before signatures or approval during recovery-only admission', async () => {
    const f = await fixture(true);
    const signaturesBefore = m.encrypt.mock.calls.length;
    await expect(executeCounterTradeV2Proposal({ ...f.input, privateOnly: true, recoveryOnly: true, parent: f.review, amounts: f.amounts })).rejects.toThrow(/Counter trading is not enabled/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).toHaveBeenCalledTimes(signaturesBefore); expect(await f.journal.read()).toBeNull();
  });
  it('funds a private Book counter without Link credentials and restores its exact cancellation', async () => {
    const f = await fixture(true, true);
    const result = await executeCounterTradeV2Proposal({ ...f.input, privateOnly: true, parent: f.review, amounts: f.amounts });
    expect(result).toMatchObject({ kind: 'create', proposalId: '1', offer: '4', request: '5' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([tokenB, escrow]);
    expect(await f.journal.read()).toMatchObject({ active: false, records: [{ step: 'approval', state: 'confirmed' }, { step: 'create', state: 'confirmed' }] });
    expect(await readCounterTradeV2Proposal({ ...f.input, proposalId: '1' })).toMatchObject({ root: bookRoot, maker: owner, taker: maker });
    f.closeParent(); m.read.mockClear();
    expect(await cancelCounterTradeV2Proposal({ ...f.input, proposalId: '1' })).toMatchObject({ kind: 'cancel', refund: '4' });
    expect(m.read.mock.calls.every(([r]) => r.deployment.contractAddress === escrow)).toBe(true);
  });
  it('rejects a stale private Book reference before signatures, allowance or funding', async () => {
    const f = await fixture(true, true);
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: { bookReference: { ...bookRoot, revision: '1' }, maker, offerToken: tokenA, requestToken: tokenB }, amounts: f.amounts })).rejects.toThrow(/parent changed|reference/i);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled();
  });
  it('binds private Book counter review to the displayed maker and both token addresses', async () => {
    const f = await fixture(true, true);
    for (const changed of [{ maker: owner }, { offerToken: tokenB }, { requestToken: tokenA }]) {
      await expect(reviewCounterTradeV2Proposal({ ...f.input, parent: { ...f.review, ...changed }, amounts: f.amounts })).rejects.toThrow(/parent changed/i);
    }
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled();
  });
  it('matches the selected full-artifact ABI', () => {
    for (const fragment of new Interface(COUNTER_TRADE_V2_ABI).fragments) expect((fragment.type === 'event' ? abi.getEvent(fragment.format('sighash')) : abi.getFunction(fragment.format('sighash')))!.format('full')).toBe(fragment.format('full'));
  });
  it.each([false, true])('funds exact reversed terms and refunds without a live parent, private=%s', async privatePair => {
    const f = await fixture(privatePair);
    const result = await executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts });
    expect(result).toMatchObject({ kind: 'create', proposalId: '1', offer: '4', request: '5' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([link, tokenB, escrow]);
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '480', records: [{ step: 'authorize', state: 'confirmed' }, { step: 'approval', state: 'confirmed' }, { step: 'create', state: 'confirmed' }] });
    expect(JSON.stringify([...f.rows.values()])).not.toContain(hash(77));
    f.closeParent(); m.read.mockClear();
    expect(await cancelCounterTradeV2Proposal({ ...f.input, proposalId: '1' })).toMatchObject({ kind: 'cancel', refund: '4', proposalId: '1' });
    expect(m.read.mock.calls.every(([r]) => r.deployment.contractAddress === escrow)).toBe(true);
  });
  it('retains an uncertain send, blocks another funding call, and reconciles without resending', async () => {
    const f = await fixture(); f.loseWait();
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow(/RPC/);
    const saved = (await f.journal.read())!; expect(saved).toMatchObject({ active: true, records: [{ state: 'confirmed' }, { state: 'confirmed' }, { state: 'submitted', transactionHash: hash(3) }] });
    await expect(continueCounterTradeV2Proposal({ ...f.input, recoveryId: saved.id })).rejects.toThrow(/Check/);
    f.restoreWait(); expect(await reconcileCounterTradeV2Proposal(f.input)).toMatchObject({ proposalId: '1', kind: 'create' });
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(3);
  });
  it('keeps the transaction and exact fees on hold when its root receipt differs', async () => {
    const f = await fixture(); f.badRoot();
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow(/root/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '480' });
  });
  it('rejects an outsider before a private-terms read', async () => {
    const f = await fixture(true); await executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts });
    m.read.mockClear(); m.binding.mockReturnValue({ ownerAddress: addr('77'), chainId: 7082400n });
    await expect(readCounterTradeV2Proposal({ ...f.input, proposalId: '1' })).rejects.toThrow(/participants/);
    expect(m.read).toHaveBeenCalledOnce();
  });
  it('rejects stale Link parents and invalid amounts before a wallet send', async () => {
    const f = await fixture();
    for (const offer of ['0', '01', (1n << 128n).toString()]) await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: { ...f.amounts, offer } })).rejects.toThrow();
    f.closeParent(); await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('binds child parties, assets and depth to the parent without new Link credentials', async () => {
    const f = await fixture(); await executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts });
    m.binding.mockReturnValue({ ownerAddress: maker, chainId: 7082400n, signer: {} });
    const reviewed = await reviewCounterTradeV2Proposal({ ...f.input, publicOnly: true, parent: { proposalId: '1' }, amounts: f.amounts });
    expect(reviewed).toMatchObject({ material: { maker, taker: owner, offerToken: tokenA, requestToken: tokenB, depth: 2, parentProposal: '1' } });
    expect(reviewed).not.toHaveProperty('link');
    f.proposals.get('1')![9] = 16n;
    await expect(reviewCounterTradeV2Proposal({ ...f.input, parent: { proposalId: '1' }, amounts: f.amounts })).rejects.toThrow();
  });
  it('keeps one wallet lock for Link and Counter while their encrypted history keys differ', async () => {
    const f = await fixture(); f.loseWait();
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow();
    const linkJournal = createLinkTradeV2CreationJournal({ capability: f.input.capability, deployment: f.input.parentDeployment, store: f.store });
    await expect(linkJournal.assertNoPending()).rejects.toThrow(/Pending/);
    expect(await linkJournal.read()).toBeNull();
  });
  it('binds fresh private child inputs to its selected Counter selector and fixed parent', async () => {
    const f = await fixture(true);
    f.proposals.set('2', [maker, owner, tokenA, tokenB, codeHash, codeHash, counterTradeV2RootKey(root), 1n, 0n, 2n, 1n, true, true]);
    const reviewed = await reviewCounterTradeV2Proposal({ ...f.input, parent: { proposalId: '2' }, amounts: f.amounts });
    m.encrypt.mockClear();
    const prepared = await prepareCounterTradeV2Proposal(f.input, reviewed.material), call = abi.parseTransaction({ data: prepared.data })!;
    expect(call.name).toBe('createPrivateChild'); expect(call.args.parentId).toBe(2n);
    expect(m.encrypt.mock.calls.map(c => c.slice(1))).toEqual([ [4n, escrow, abi.getFunction('createPrivateChild')!.selector], [5n, escrow, abi.getFunction('createPrivateChild')!.selector] ]);
    expect(reviewed).not.toHaveProperty('link');
  });
  it.each([false, true])('funds and refunds a child proposal without a Link authorization call, private=%s', async privatePair => {
    const f = await fixture(privatePair);
    f.proposals.set('2', [maker, owner, tokenA, tokenB, codeHash, codeHash, counterTradeV2RootKey(root), 1n, 0n, 2n, 1n, privatePair, true]);
    expect(await executeCounterTradeV2Proposal({ ...f.input, parent: { proposalId: '2' }, amounts: f.amounts })).toMatchObject({ kind: 'create', proposalId: '1' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([tokenB, escrow]);
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '320', records: [{ step: 'approval' }, { step: 'create' }] });
    f.closeParent(); expect(await cancelCounterTradeV2Proposal({ ...f.input, proposalId: '1' })).toMatchObject({ kind: 'cancel', refund: '4' });
  });
  it('clears an unused approval using the existing recovery after an interrupted preparation', async () => {
    const f = await fixture(); m.encrypt.mockRejectedValueOnce(new Error('User rejected.'));
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    expect(await cleanupCounterTradeV2Allowance(f.input)).toMatchObject({ kind: 'cleanup', refund: '0' });
  });
  it('can finish zero-approval cleanup after an input signature fails before any cleanup send', async () => {
    const f = await fixture(true); f.setAllowance(4n); m.encrypt.mockRejectedValueOnce(new Error('Signature rejected.'));
    await expect(executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts })).rejects.toThrow();
    m.encrypt.mockRejectedValueOnce(new Error('Signature rejected.'));
    await expect(cleanupCounterTradeV2Allowance(f.input)).rejects.toThrow();
    expect(await f.journal.read()).toMatchObject({ active: true, counter: { kind: 'cleanup' }, records: [] });
    expect(await cleanupCounterTradeV2Allowance(f.input)).toMatchObject({ kind: 'cleanup', refund: '0' });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '160', records: [{ step: 'cleanup', state: 'confirmed' }] });
  });
});

const recipientFixture = async (privatePair: boolean, child: boolean | 'even' = false, bookParent: boolean | 'standard' = false) => {
  const root = bookParent ? bookRoot : linkRoot;
  const f = await fixture(privatePair, bookParent); await executeCounterTradeV2Proposal({ ...f.input, parent: f.review, amounts: f.amounts });
  const even = child === 'even', selectedOwner = even ? owner : maker;
  const offerToken = even ? tokenA : tokenB, requestToken = even ? tokenB : tokenA, id = even ? '2' : child ? '3' : '1';
  if (child) {
    f.proposals.set('2', [maker, owner, tokenA, tokenB, codeHash, codeHash, counterTradeV2RootKey(root), 1n, 0n, 2n, 1n, privatePair, true]);
    f.proposals.set('3', [owner, maker, tokenB, tokenA, codeHash, codeHash, counterTradeV2RootKey(root), 2n, 0n, 3n, 1n, privatePair, true]);
  }
  let offerBalance = 20n, requestBalance = even ? 1n : 0n, allowance = 0n, nonce = 10, winner = 0n, waitFailure = false, corruptPayment = false, corruptBookRevision = false, corruptRootRefund = false;
  const baseRead = m.read.getMockImplementation()!;
  m.read.mockImplementation(async input => {
    if (input.deployment.contractAddress === escrow && abi.parseTransaction({ data: input.data })!.name === 'winner') return abi.encodeFunctionResult('winner', [winner]);
    return baseRead(input);
  });
  m.balance.mockImplementation(async (address: string) => address === offerToken ? offerBalance : requestBalance); m.allowance.mockImplementation(async () => allowance);
  f.provider.call.mockImplementation(async ({ data, to }: { data: string; to?: string }) => {
    if (data === priv.getFunction('publicAmountsEnabled')!.selector) return priv.encodeFunctionResult('publicAmountsEnabled', [false]);
    const call = pub.parseTransaction({ data })!;
    return pub.encodeFunctionResult(call.name, [call.name === 'balanceOf' ? to === offerToken ? offerBalance : requestBalance : allowance]);
  });
  f.provider.getTransactionCount.mockImplementation(async () => nonce);
  const signer = { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }), sendTransaction: vi.fn(async (call: Record<string, unknown>) => {
    const h = hash(++nonce + 100), blockNumber = nonce + 10, tx = { ...call, from: selectedOwner, hash: h, chainId: 7082400n }, logs: object[] = [];
    const event = (i: Interface, name: string, args: unknown[], address = escrow) => logs.push({ address, ...i.encodeEventLog(i.getEvent(name)!, args) });
    const transfer = (address: string, from: string, to: string, amount: bigint) => event(privatePair ? privTransfer : pub, 'Transfer', privatePair ? [from, to,
      [0n, from === selectedOwner ? amount : 1000n + amount], [0n, to === selectedOwner ? amount : 1000n + amount]] : [from, to, amount], address);
    if (call.to === requestToken) {
      const parsed = (privatePair ? priv : pub).parseTransaction({ data: call.data as string })!;
      allowance = privatePair ? BigInt(parsed.args[1].ciphertext.ciphertextLow) : BigInt(parsed.args[1]);
    } else {
      const parsed = abi.parseTransaction({ data: call.data as string })!, declining = parsed.name === 'declineCounter';
      expect(parsed.args.id.toString()).toBe(id);
      const p = f.proposals.get(id)!; p[10] = declining ? 4n : 2n; p[12] = false;
      event(abi, 'CounterClosed', [id, declining ? 4n : 2n, selectedOwner]);
      if (declining) transfer(tokenB, escrow, owner, 4n);
      else {
        winner = BigInt(id); f.closeParent();
        if (bookParent === 'standard') event(standardAbi, 'StandardTradeStatusChanged', [root.id, maker, 1n, 3n, escrow, root.id, corruptBookRevision ? 3n : 2n], link);
        else if (bookParent) event(bookAbi, 'PrivateOrderStatusChanged', [root.id, maker, 1n, 3n, escrow, root.id, corruptBookRevision ? 3n : 2n], link);
        else event(linkAbi, 'LinkClosed', [root.id, 2n, 3n], link);
        const rootRefund = corruptRootRefund ? 8n : 7n;
        transfer(tokenA, link, maker, rootRefund);
        event(bookParent ? bookAbi : linkAbi, 'CounterParentSettled', [root.id, id], link);
        if (child) {
          for (const parent of even ? ['1'] : ['2', '1']) { const a = f.proposals.get(parent)!; a[10] = 6n; a[12] = false;
            event(abi, 'CounterClosed', [parent, 6n, selectedOwner]); transfer(a[2] as string, escrow, a[0] as string, 4n); }
        }
        transfer(requestToken, selectedOwner, even ? maker : owner, corruptPayment ? 6n : 5n); transfer(offerToken, escrow, selectedOwner, 4n);
        offerBalance += 4n; requestBalance += (even ? 0n : rootRefund) + (child ? 4n : 0n) - 5n; allowance -= 5n;
      }
    }
    f.transactions.set(h, tx); f.receipts.set(h, { hash: h, from: selectedOwner, to: call.to, status: 1, blockNumber, blockHash: hash(999), gasUsed: 80n, gasPrice: 2n,
      logs: logs.map((log, index) => ({ ...log, transactionHash: h, blockHash: hash(999), blockNumber, index, removed: false })) });
    return tx;
  }) };
  m.binding.mockReturnValue({ ownerAddress: selectedOwner, chainId: 7082400n, signer, readProvider: f.provider });
  m.wait.mockImplementation(async (_binding, h) => { if (waitFailure && abi.parseTransaction({ data: (f.transactions.get(h) as { data: string }).data })?.name.startsWith('accept')) throw new Error('RPC unavailable.'); return f.receipts.get(h); });
  const journal = createLinkTradeV2CreationJournal({ capability: f.input.capability, deployment: f.input.deployment, store: f.store });
  const input = { ...f.input, journal }, proposal = await readCounterTradeV2Proposal({ ...input, proposalId: id });
  return { ...f, input, proposal, signer, journal, loseWait: () => { waitFailure = true; }, restoreWait: () => { waitFailure = false; }, corrupt: () => { corruptPayment = true; },
    corruptBookRevision: () => { corruptBookRevision = true; }, corruptRootRefund: () => { corruptRootRefund = true; } };
};
describe('Counter recipient settlement; selected full ABI, real sender/journal and modelled chain', () => {
  it.each([false, true, 'even'] as const)('settles a Standard parent with its exact saved remaining refund, child=%s', async child => {
    const f = await recipientFixture(false, child, 'standard');
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, publicOnly: true, proposal: f.proposal, kind: 'accept' })).toMatchObject({ kind: 'accept', payment: '5', received: '4', refund: child === 'even' ? '4' : child ? '11' : '7' });
    expect(await f.journal.read()).toMatchObject({ active: false, counter: { rootRefund: '7', material: { root: bookRoot, privatePair: false } } });
  });
  it('holds a Standard parent refund mismatch even when the observed wallet delta agrees with the wrong refund', async () => {
    const f = await recipientFixture(false, false, 'standard'); f.corruptRootRefund();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/amount differs/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '320', counter: { rootRefund: '7' }, records: [{ step: 'approval', state: 'confirmed' }, { step: 'accept', state: 'submitted' }] });
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it('stops before Accept when the Standard remaining state changes after the exact allowance', async () => {
    const f = await recipientFixture(false, false, 'standard'), read = m.read.getMockImplementation()!;
    m.read.mockImplementation(async input => {
      const raw = await read(input);
      if (input.deployment.contractAddress !== link || !input.data.startsWith(standardAbi.getFunction('getTradeView')!.selector) || f.signer.sendTransaction.mock.calls.length === 0) return raw;
      const [view] = standardAbi.decodeFunctionResult('getTradeView', raw);
      return standardAbi.encodeFunctionResult('getTradeView', [[view.trade, [6n, 9n, 4n, 6n, 3n], ...view.slice(2)]]);
    });
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/parent refund changed/);
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
    expect(await f.journal.read()).toMatchObject({ active: true, counter: { rootRefund: '7' }, records: [{ step: 'approval', state: 'confirmed' }] });
  });
  it('reconciles the same Standard acceptance hash with its saved refund after a lost acknowledgement', async () => {
    const f = await recipientFixture(false, false, 'standard'); f.loseWait();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow();
    const sent = f.signer.sendTransaction.mock.calls.length; f.restoreWait();
    expect(await reconcileCounterTradeV2Proposal(f.input)).toMatchObject({ kind: 'accept', refund: '7', payment: '5', received: '4' });
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(sent);
  });
  it('holds public Accept before approval, private signatures or journal writes in private-only scope', async () => {
    const f = await recipientFixture(false);
    const signaturesBefore = m.encrypt.mock.calls.length;
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, privateOnly: true, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/Public counter/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).toHaveBeenCalledTimes(signaturesBefore); expect(await f.journal.read()).toBeNull();
  });
  it('holds private Accept before signatures or approval during recovery-only admission', async () => {
    const f = await recipientFixture(true);
    const signaturesBefore = m.encrypt.mock.calls.length;
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, privateOnly: true, recoveryOnly: true, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/Counter trading is not enabled/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).toHaveBeenCalledTimes(signaturesBefore); expect(await f.journal.read()).toBeNull();
  });
  it.each([false, true, 'even'] as const)('settles a private Book parent using exact cancellation and own refunds, child=%s', async child => {
    const f = await recipientFixture(true, child, true);
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, privateOnly: true, proposal: f.proposal, kind: 'accept' })).toMatchObject({ kind: 'accept', payment: '5', received: '4', refund: child === 'even' ? '4' : child ? '11' : '7' });
    expect(await f.journal.read()).toMatchObject({ active: false, counter: { material: { root: bookRoot } } });
  });
  it('retains the Book Counter hash and fee if its root closure has a different revision', async () => {
    const f = await recipientFixture(true, false, true); f.corruptBookRevision();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/exact parent/);
    expect(await f.journal.read()).toMatchObject({ active: true });
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('uses the root refund to fund acceptance and accounts exact gross payment/delivery/refund, private=%s', async privatePair => {
    const f = await recipientFixture(privatePair);
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).toMatchObject({ kind: 'accept', payment: '5', received: '4', refund: '7' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([tokenA, escrow]);
    expect(await f.journal.read()).toMatchObject({ active: false, feeWei: '320', counter: { beforeRequestBalance: '0', ancestors: [] }, records: [{ step: 'approval' }, { step: 'accept', state: 'confirmed' }] });
  });
  it.each([false, true])('binds the selected ancestors and counts only the owner refunds, private=%s', async privatePair => {
    const f = await recipientFixture(privatePair, true);
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).toMatchObject({ payment: '5', received: '4', refund: '11' });
    expect((await f.journal.read())?.counter?.ancestors?.map(a => a.id)).toEqual(['2', '1']);
  });
  it.each([false, true])('keeps the other party root refund private while accounting the even-depth recipient, private=%s', async privatePair => {
    const f = await recipientFixture(privatePair, 'even');
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).toMatchObject({ payment: '5', received: '4', refund: '4' });
    expect(m.decrypt.mock.results.every(r => r.type === 'return')).toBe(true);
  });
  it.each([false, true])('declines without a payment and leaves private maker refund decryption to the maker, private=%s', async privatePair => {
    const f = await recipientFixture(privatePair);
    expect(await executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'decline' })).toMatchObject({ kind: 'decline', refund: '0' });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect((await f.journal.read())?.records[0].step).toBe('decline');
  });
  it('keeps an unknown Accept on hold and reconciles it without another send', async () => {
    const f = await recipientFixture(true); f.loseWait();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/RPC/);
    const saved = (await f.journal.read())!; await expect(continueCounterTradeV2Proposal({ ...f.input, recoveryId: saved.id })).rejects.toThrow(/Check/);
    f.restoreWait(); expect(await reconcileCounterTradeV2Proposal(f.input)).toMatchObject({ payment: '5', received: '4', refund: '7' });
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it('holds exact fees and the saved hash if payment receipts differ', async () => {
    const f = await recipientFixture(true); f.corrupt();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/amount/);
    expect(await f.journal.read()).toMatchObject({ active: true, feeWei: '320' });
  });
  it('rejects changed reviewed amounts before approval, signatures or funding', async () => {
    const f = await recipientFixture(true); m.encrypt.mockClear();
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: { ...f.proposal, request: '6' }, kind: 'accept' })).rejects.toThrow(/reviewed/);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(m.encrypt).not.toHaveBeenCalled();
  });
  it('clears the acceptance request-token allowance after unsigned input preparation stops', async () => {
    const f = await recipientFixture(true), encrypt = m.encrypt.getMockImplementation()!;
    m.encrypt.mockImplementation(async (...args) => { if (args[3] === abi.getFunction('acceptPrivateCounter')!.selector) throw new Error('Signature rejected.'); return encrypt(...args); });
    await expect(executeCounterTradeV2RecipientAction({ ...f.input, proposal: f.proposal, kind: 'accept' })).rejects.toThrow(/Signature/);
    m.encrypt.mockImplementation(encrypt);
    expect(await cleanupCounterTradeV2Allowance(f.input)).toMatchObject({ kind: 'cleanup' });
    expect(f.signer.sendTransaction.mock.calls.map(([r]) => r.to)).toEqual([tokenA, tokenA]);
    expect(await f.journal.read()).toMatchObject({ active: false, records: [{ step: 'approval' }, { step: 'cleanup', state: 'confirmed' }] });
  });
});
