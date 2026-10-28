import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keccak256 } from '@coti-io/coti-ethers';
import { createLinkTradeV2CreationJournal, createPrivateBookV2Journal, type PrivateBookV2RecoveryMeta } from './linkTradeV2CreationJournal';
import type { PrivateBookV2Action } from './privateBookV2Actions';
import type { LinkTradeV2CreationStore, LinkTradeV2CreationStoredRow } from './linkTradeV2CreationStore';
import type { LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), assertDeployment: vi.fn() }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding,
  assertOwnerTradeV2CapabilityCurrent: m.current, assertOwnerTradeV2CapabilitySnapshotCurrent: m.current }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: m.assertDeployment }));
const addr = (b: string) => `0x${b.repeat(20)}`, bytes = (b: string) => `0x${b.repeat(32)}`;
const owner = addr('11'), escrow = addr('22'), tokenA = addr('33'), tokenB = addr('44');
const deployment = { protocol: 'link-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: bytes('55') } as never;
const recovery = { context: { chainId: '7082400', escrow, maker: owner, makerNonce: bytes('66'), credentialEpoch: '1' },
  terms: { offerToken: tokenA, requestToken: tokenB, privatePair: true, priceOffer: '1', priceRequest: '2', expiresAt: '0' },
  secret: bytes('77'), offerBudget: '100', beforeBalance: '1000', offerCodeHash: bytes('55') };
const memoryStore = () => {
  const rows = new Map<string, LinkTradeV2CreationStoredRow>();
  const store: LinkTradeV2CreationStore = {
    claim: async row => {
      if ([...rows.values()].some(r => r.activeOwner === row.activeOwner)) throw new Error('A creation is already pending.');
      rows.set(row.id, structuredClone(row));
    },
    read: async id => structuredClone(rows.get(id) ?? null),
    active: async key => structuredClone([...rows.values()].find(r => r.activeOwner === key) ?? null),
    latest: async key => structuredClone([...rows.values()].filter(r => r.ownerKey === key).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null),
    replace: async (row, expected) => {
      if (rows.get(row.id)?.revision !== expected) throw new Error('Creation changed in another tab.');
      rows.set(row.id, structuredClone(row));
    }
  };
  return { rows, store };
};
const phase = (step: LinkTradeV2CreationRecord['step'], nonce: number): LinkTradeV2CreationRecord => ({
  step, nonce, chainId: '7082400', owner, to: step === 'create' ? escrow : tokenA,
  state: 'sending', dataHash: bytes('88'), gasLimit: '125', gasPrice: '2' });
const submitted = (r: LinkTradeV2CreationRecord): LinkTradeV2CreationRecord => ({ ...r, state: 'submitted', transactionHash: `0x${r.nonce.toString(16).padStart(64, '0')}` });
const accounting = { gasUsed: '80', feeWei: '160', blockNumber: '10', blockHash: bytes('bb') };
const confirmed = (r: LinkTradeV2CreationRecord): LinkTradeV2CreationRecord => ({ ...submitted(r), state: 'confirmed', ...accounting });
beforeEach(() => {
  vi.resetAllMocks();
  m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner,
    signer: { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }) } });
});

const bookJournal = (store: LinkTradeV2CreationStore) => createPrivateBookV2Journal({ capability: {} as never,
  deployment: { chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: bytes('55'), protocol: 'private-v2' } as never, store });
const bookMeta: PrivateBookV2RecoveryMeta = { kind: 'create', expectedEvent: 'PrivateOrderOpened', approvalToken: tokenA, approvalPrivate: true };
const bookFunding: PrivateBookV2Action = { kind: 'create', offerAsset: { assetType: 'private-erc20', token: tokenA, amount: '123456789' },
  requestAsset: { assetType: 'private-erc20', token: tokenB }, priceTerms: { offerAmount: '1', requestAmount: '2' }, expiresAt: '0' };
const cancelMeta: PrivateBookV2RecoveryMeta = { kind: 'cancel', expectedEvent: 'PrivateOrderStatusChanged', expectedOrderId: '9', expectedStatus: '3' };

describe('Book journal shares the wallet lock and keeps recovery metadata public', () => {
  it('archives identical rejected starts by ordinal while retaining the lock and forbidding funding', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    const id = (await first.read())!.id, cleanup = phase('cleanup', 8);
    for (let attempt = 0; attempt < 2; attempt++) {
      await first.beginCleanup(id); await first.onPending(cleanup); await first.onPending({ ...cleanup, state: 'rejected' });
    }
    await first.beginCleanup(id);
    expect(await bookJournal(store).read()).toMatchObject({ active: true, cleanupOnly: true, feeWei: '160',
      priorCleanup: [{ state: 'rejected', nonce: 8 }, { state: 'rejected', nonce: 8 }], records: [{ step: 'approval' }] });
    await expect(first.onPending(phase('create', 8))).rejects.toThrow();
    await first.onPending(cleanup); await first.onPending(submitted(cleanup)); await first.onPending(confirmed(cleanup));
    expect(await bookJournal(store).read()).toMatchObject({ active: false, feeWei: '320' });
  });
  it('retains archived failure fees when a cleanup-only preparation explicitly finishes', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    const id = (await first.read())!.id, cleanup = phase('cleanup', 8); await first.beginCleanup(id);
    await first.onPending(cleanup); await first.onPending(submitted(cleanup));
    await first.onPending({ ...confirmed(cleanup), state: 'failed', mined: { transactionHash: submitted(cleanup).transactionHash!,
      to: tokenA, dataHash: cleanup.dataHash, value: '0', gasLimit: '125', gasPrice: '2', outcome: 'reverted' } });
    await first.beginCleanup(id); await first.finishPreparation(id);
    expect(await bookJournal(store).read()).toMatchObject({ active: false, abandoned: true, cleanupOnly: true, feeWei: '320',
      records: [{ step: 'approval' }], priorCleanup: [{ state: 'failed', feeWei: '160' }] });
  });
  it('keeps mined failure fees and rejects duplicate hashes, reused mined nonces and foreign archives', async () => {
    const { store, rows } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    const id = (await first.read())!.id, cleanup = phase('cleanup', 8); await first.beginCleanup(id);
    await first.onPending(cleanup); await first.onPending(submitted(cleanup));
    await first.onPending({ ...confirmed(cleanup), state: 'failed', mined: { transactionHash: submitted(cleanup).transactionHash!,
      to: tokenA, dataHash: cleanup.dataHash, value: '0', gasLimit: '125', gasPrice: '2', outcome: 'reverted' } });
    await first.beginCleanup(id);
    expect(await first.read()).toMatchObject({ active: true, cleanupOnly: true, feeWei: '320', priorCleanup: [{ state: 'failed' }] });
    await expect(first.onPending(cleanup)).rejects.toThrow();
    const original = structuredClone(rows.get(id)!), envelope = JSON.parse(original.sealed);
    for (const priorCleanup of [[envelope.priorCleanup[0], envelope.priorCleanup[0]],
      [{ ...envelope.priorCleanup[0], owner: tokenB }], [{ ...envelope.priorCleanup[0], value: '1' }],
      [{ ...envelope.priorCleanup[0], transactionHash: 'invalid' }]]) {
      rows.set(id, { ...original, sealed: JSON.stringify({ ...envelope, priorCleanup }) });
      await expect(bookJournal(store).read()).rejects.toThrow();
    }
    rows.set(id, original);
    const retry = phase('cleanup', 9); await first.onPending(retry); await first.onPending(submitted(retry)); await first.onPending(confirmed(retry));
    expect(await bookJournal(store).read()).toMatchObject({ active: false, feeWei: '480' });
  });
  it('retains approval fees and closes only the exact confirmed token cleanup', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    const cleanup = phase('cleanup', 8);
    await first.beginCleanup((await first.read())!.id);
    await expect(first.onPending({ ...cleanup, to: tokenB })).rejects.toThrow();
    await expect(first.onPending({ ...cleanup, value: '1' })).rejects.toThrow();
    await first.onPending(cleanup); await first.onPending(submitted(cleanup));
    expect(await bookJournal(store).read()).toMatchObject({ active: true, feeWei: '160' });
    await first.onPending(confirmed(cleanup));
    expect(await bookJournal(store).read()).toMatchObject({ active: false, feeWei: '320', records: [{ step: 'approval' }, { step: 'cleanup' }] });
  });
  it('finishes only a confirmed approval-only preparation and preserves its fee history', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const id = (await first.read())!.id;
    await expect(first.finishPreparation(id)).rejects.toThrow();
    const approval = phase('approval', 7); await first.onPending(approval);
    await expect(first.finishPreparation(id)).rejects.toThrow();
    await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    await expect(first.finishPreparation('another-id')).rejects.toThrow();
    await first.finishPreparation(id);
    expect(await bookJournal(store).read()).toMatchObject({ active: false, abandoned: true, feeWei: '160', records: [{ step: 'approval', state: 'confirmed' }] });
  });
  it('cannot finish an approval preparation once funding was reserved', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    await first.onPending(phase('create', 8));
    await expect(first.finishPreparation((await first.read())!.id)).rejects.toThrow();
    expect(await first.read()).toMatchObject({ active: true, records: [{ step: 'approval' }, { step: 'create', state: 'sending' }] });
  });
  it.each(['rejected', 'failed'] as const)('keeps %s cleanup and its prior approval locked without automatic retry', async state => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7); await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    const cleanup = phase('cleanup', 8); await first.beginCleanup((await first.read())!.id); await first.onPending(cleanup);
    if (state === 'rejected') await first.onPending({ ...cleanup, state });
    else {
      await first.onPending(submitted(cleanup));
      await first.onPending({ ...confirmed(cleanup), state, mined: { transactionHash: submitted(cleanup).transactionHash!,
        to: tokenA, dataHash: cleanup.dataHash, value: '0', gasLimit: '125', gasPrice: '2', outcome: 'reverted' } });
    }
    expect(await bookJournal(store).read()).toMatchObject({ active: true, feeWei: state === 'failed' ? '320' : '160' });
    await expect(first.finishPreparation((await first.read())!.id)).rejects.toThrow();
    await expect(bookJournal(store).beginBook(cancelMeta)).rejects.toThrow(/pending/);
  });
  it.each([true, false])('recovers budget visibility %s with no AES or stored budget', async visible => {
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner, signer: { getUserOnboardInfo: () => { throw new Error('No privacy key'); } } });
    const { store, rows } = memoryStore(), first = bookJournal(store);
    const meta: PrivateBookV2RecoveryMeta = { kind: 'budget-visibility', expectedEvent: 'TradeBudgetVisibility', expectedOrderId: '9', expectedVisible: visible };
    await first.beginBook(meta); expect(await first.readFunding()).toBeUndefined();
    const call = { ...phase('budget-visibility', 7), to: escrow };
    await expect(first.onPending({ ...call, value: '1' })).rejects.toThrow();
    await expect(first.onPending({ ...call, step: 'cancel' })).rejects.toThrow();
    await expect(first.onPending({ ...call, to: tokenA })).rejects.toThrow();
    await first.onPending(call); await first.releaseUnsent();
    expect(await bookJournal(store).read()).toMatchObject({ active: true, book: meta });
    await expect(bookJournal(store).beginBook(meta)).rejects.toThrow(/pending/);
    await first.onPending(submitted(call)); await first.onPending(confirmed(call));
    expect(await bookJournal(store).read()).toMatchObject({ active: false, book: meta, feeWei: '160' });
    const stored = JSON.stringify([...rows.values()]);
    expect(stored).not.toContain('funding'); expect(stored).not.toContain('offerBudget');
    expect(stored).not.toContain('totalOfferAmount'); expect(stored).not.toContain('ciphertextHigh');
  });
  it('rejects extra visibility material, wrong event/bool/status and visibility on other actions', async () => {
    const { store, rows } = memoryStore(), first = bookJournal(store);
    const meta: PrivateBookV2RecoveryMeta = { kind: 'budget-visibility', expectedEvent: 'TradeBudgetVisibility', expectedOrderId: '9', expectedVisible: true };
    for (const expectedVisible of [undefined, null, 1, 'true']) {
      await expect(first.beginBook({ ...meta, expectedVisible } as PrivateBookV2RecoveryMeta)).rejects.toThrow();
    }
    for (const patch of [{ expectedEvent: 'PrivateOrderOpened' }, { expectedStatus: '3' }, { expectedOrderId: undefined },
      { approvalToken: tokenA, approvalPrivate: true }, { originalBudget: '123456789' }]) {
      await expect(first.beginBook({ ...meta, ...patch } as PrivateBookV2RecoveryMeta)).rejects.toThrow();
    }
    await expect(first.beginBook({ ...cancelMeta, expectedVisible: false })).rejects.toThrow();
    await expect(first.beginBook(meta, { kind: 'budget-visibility', orderId: '9', expectedRevision: '1', visible: true })).rejects.toThrow();
    await first.beginBook(meta);
    const original = [...rows.values()][0], envelope = JSON.parse(original.sealed);
    rows.set(original.id, { ...original, sealed: JSON.stringify({ ...envelope, book: { ...envelope.book, originalBudget: '123456789' } }) });
    await expect(bookJournal(store).read()).rejects.toThrow();
  });
  it('keeps an uncertain send locked after reopen, with a durable hash before receipt work', async () => {
    const { store } = memoryStore(), first = bookJournal(store);
    await first.beginBook(bookMeta, bookFunding);
    const call = phase('create', 7); await first.onPending(call); await first.releaseUnsent();
    expect(await bookJournal(store).read()).toMatchObject({ active: true, book: bookMeta, records: [{ state: 'sending' }] });
    await expect(bookJournal(store).beginBook(bookMeta, bookFunding)).rejects.toThrow(/pending/);
    await expect(journal(store).assertNoPending()).rejects.toThrow(/pending/);
    await expect(bookJournal(store).onPending(call)).rejects.toThrow();
    await first.onPending(submitted(call));
    expect(await bookJournal(store).read()).toMatchObject({ active: true, records: [{ state: 'submitted', transactionHash: submitted(call).transactionHash }] });
    await first.onPending(confirmed(call));
    expect(await first.read()).toMatchObject({ active: false, feeWei: '160' });
  });
  it('seals private funding but reads pending metadata without a privacy key', async () => {
    const { store, rows } = memoryStore(), first = bookJournal(store);
    await first.beginBook(bookMeta, bookFunding);
    expect(await first.readFunding()).toEqual(bookFunding);
    const text = JSON.stringify([...rows.values()]);
    expect(text).not.toContain('123456789'); expect(text).not.toContain('ciphertextHigh');
    expect(text).not.toContain('01'.repeat(16)); expect(text).not.toContain('offerAsset');
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner, signer: { getUserOnboardInfo: () => null } });
    const restored = bookJournal(store);
    expect(await restored.read()).toMatchObject({ active: true, book: bookMeta });
    await expect(restored.readFunding()).rejects.toThrow(/privacy/);
    await expect(restored.beginBook(cancelMeta)).rejects.toThrow(/pending/);
    await restored.releaseUnsent();
    await bookJournal(store).beginBook(cancelMeta);
  });
  it.each([
    cancelMeta,
    { kind: 'reclaim-expired', expectedEvent: 'PrivateOrderStatusChanged', expectedOrderId: '9', expectedStatus: '4' },
    { kind: 'withdraw-native-credit', expectedEvent: 'NativeCreditWithdrawn' }
  ] satisfies PrivateBookV2RecoveryMeta[])('stores and confirms $kind without privacy onboarding', async meta => {
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner, signer: { getUserOnboardInfo: () => { throw new Error('No privacy key'); } } });
    const { store } = memoryStore(), first = bookJournal(store);
    await first.beginBook(meta); expect(await first.readFunding()).toBeUndefined();
    const call = { ...phase(meta.kind, 7), to: escrow };
    await first.onPending(call); await first.onPending(submitted(call)); await first.onPending(confirmed(call));
    expect(await bookJournal(store).read()).toMatchObject({ active: false, book: meta, feeWei: '160' });
  });
  it('retains native funding identity and accepts a same-value speedup', async () => {
    const { store } = memoryStore(), first = bookJournal(store);
    const funding: PrivateBookV2Action = { ...bookFunding as Extract<PrivateBookV2Action, { kind: 'create' }>, offerAsset: { assetType: 'native', amount: '99' } };
    await first.beginBook({ kind: 'create', expectedEvent: 'PrivateOrderOpened' }, funding);
    const call = { ...phase('create', 7), value: '99' }; await first.onPending(call); await first.onPending(submitted(call));
    await expect(first.onPending({ ...submitted(call), value: '100' })).rejects.toThrow();
    const mined = { transactionHash: bytes('aa'), to: escrow, dataHash: call.dataHash, value: '99', gasLimit: '150', gasPrice: '3' };
    await first.onPending({ ...submitted(call), mined, ...accounting, feeWei: '240' });
    await first.onPending({ ...submitted(call), mined, ...accounting, feeWei: '240', state: 'confirmed' });
    expect(await bookJournal(store).read()).toMatchObject({ active: false, records: [{ value: '99', mined }] });
  });
  it('rejects raw private fields, changed funding identity and copied ciphertext', async () => {
    const { store, rows } = memoryStore(), first = bookJournal(store);
    await expect(first.beginBook({ ...bookMeta, amount: '123' } as PrivateBookV2RecoveryMeta, bookFunding)).rejects.toThrow();
    await expect(first.beginBook(bookMeta, { ...bookFunding, signature: '0x1234' } as PrivateBookV2Action)).rejects.toThrow();
    await first.beginBook(bookMeta, bookFunding);
    const original = structuredClone([...rows.values()][0]);
    const envelope = JSON.parse(original.sealed);
    rows.set(original.id, { ...original, sealed: JSON.stringify({ ...envelope, book: { ...envelope.book, rawInput: '123' } }) });
    await expect(bookJournal(store).read()).rejects.toThrow();
    rows.set(original.id, { ...original, createdAt: original.createdAt + 1 });
    await expect(bookJournal(store).readFunding()).rejects.toThrow();
  });
  it('preserves the lock after an approval and rejects wrong action targets and phases', async () => {
    const { store } = memoryStore(), first = bookJournal(store);
    await first.beginBook(bookMeta, bookFunding);
    const approval = phase('approval', 7);
    await expect(first.onPending({ ...approval, to: escrow })).rejects.toThrow();
    await expect(first.onPending({ ...approval, value: '1' })).rejects.toThrow();
    await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    await first.releaseUnsent(); expect((await bookJournal(store).read())?.active).toBe(true);
    await expect(bookJournal(store).beginBook(cancelMeta)).rejects.toThrow(/pending/);
    await expect(first.onPending({ ...phase('cancel', 8), to: escrow })).rejects.toThrow();
    await expect(first.onPending({ ...phase('create', 7), to: escrow })).rejects.toThrow();
  });
  it('separates owners, chains, escrows and runtime identities without losing the pending row', async () => {
    const { store, rows } = memoryStore(); await bookJournal(store).beginBook(cancelMeta);
    const original = structuredClone([...rows.values()][0]);
    const otherEscrow = createPrivateBookV2Journal({ capability: {} as never, store, deployment: {
      protocol: 'private-v2', chainId: '7082400', contractAddress: tokenA, runtimeBytecodeHash: bytes('55') } as never });
    expect(await otherEscrow.read()).toBeNull();
    await expect(otherEscrow.beginBook(cancelMeta)).rejects.toThrow(/pending/);
    const otherRuntime = createPrivateBookV2Journal({ capability: {} as never, store, deployment: {
      protocol: 'private-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: bytes('66') } as never });
    await expect(otherRuntime.read()).rejects.toThrow();
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: tokenB, signer: {} });
    expect(await bookJournal(store).read()).toBeNull();
    m.binding.mockReturnValue({ chainId: 1n, ownerAddress: owner, signer: {} });
    expect(() => bookJournal(store)).toThrow();
    const otherChain = createPrivateBookV2Journal({ capability: {} as never, store, deployment: {
      protocol: 'private-v2', chainId: '1', contractAddress: escrow, runtimeBytecodeHash: bytes('55') } as never });
    expect(await otherChain.read()).toBeNull();
    expect([...rows.values()]).toEqual([original]);
  });
  it('rejects private funding placed in a public envelope and mismatched event metadata', async () => {
    const { rows, store } = memoryStore(), first = bookJournal(store);
    await expect(first.beginBook({ ...cancelMeta, expectedStatus: '4' })).rejects.toThrow();
    await expect(first.beginBook({ ...cancelMeta, expectedOrderId: '0' })).rejects.toThrow();
    await first.beginBook(bookMeta, bookFunding);
    const row = [...rows.values()][0], envelope = JSON.parse(row.sealed);
    rows.set(row.id, { ...row, sealed: JSON.stringify({ ...envelope, funding: { encoding: 'public', action: bookFunding } }) });
    await expect(bookJournal(store).read()).rejects.toThrow();
  });
  it('retains a bounded search and permits only the same pending identity afterward', async () => {
    const { store } = memoryStore(), first = bookJournal(store); await first.beginBook(cancelMeta);
    const call = { ...phase('cancel', 7), to: escrow, admission: { number: '10', hash: bytes('aa') } };
    await first.onPending(call);
    await first.advanceSearch(7, { throughBlock: '25', blockHash: bytes('bb'), headBlock: '40' });
    const restored = bookJournal(store), saved = (await restored.read())!.records[0];
    expect(saved.search?.throughBlock).toBe('25');
    await expect(restored.onPending(saved)).rejects.toThrow();
    await expect(restored.advanceSearch(7, { throughBlock: '24', blockHash: bytes('cc'), headBlock: '40' })).rejects.toThrow();
    await expect(restored.onPending({ ...submitted(saved), admission: { number: '11', hash: bytes('cc') } })).rejects.toThrow();
    await restored.onPending(submitted(saved)); await restored.onPending(confirmed(saved));
    expect(await restored.read()).toMatchObject({ active: false, records: [{ search: { throughBlock: '25' } }] });
  });
  it('does not admit a second tab and rejects stale updates without overwriting the first call', async () => {
    const { store } = memoryStore();
    const claims = await Promise.allSettled([bookJournal(store).beginBook(cancelMeta), bookJournal(store).beginBook(cancelMeta)]);
    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const a = bookJournal(store), b = bookJournal(store); await a.read(); await b.read();
    const writes = await Promise.allSettled([a.onPending({ ...phase('cancel', 7), to: escrow }), b.onPending({ ...phase('cancel', 8), to: escrow })]);
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await bookJournal(store).read())?.records).toHaveLength(1);
  });
});
const journal = (store: LinkTradeV2CreationStore) => createLinkTradeV2CreationJournal({ capability: {} as never, deployment, store });

describe('owner-encrypted Link creation journal; owner capability and store mocked', () => {
  it.each(['private-v2', 'direct-v2'] as const)('admits %s only as a disclosure journal and never as Link funding', async protocol => {
    const { store } = memoryStore(), target = { chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: bytes('55'), protocol } as never;
    expect(() => createLinkTradeV2CreationJournal({ capability: {} as never, deployment: target, store })).toThrow();
    const disclosure = createLinkTradeV2CreationJournal({ capability: {} as never, deployment: target, store, purpose: 'disclosure' });
    expect(() => disclosure.assertNoPending()).toThrow();
    await expect(disclosure.onRecovery(recovery)).rejects.toThrow();
    await disclosure.beginDisclosure({ kind: 'grant', orderId: '7', maker: owner, owner, recipient: tokenB, generation: '0', allowed: true });
    expect(await disclosure.read()).toMatchObject({ active: true, disclosure: { orderId: '7' }, scope: { escrow } });
  });
  it('restores private recovery and exact fees in a fresh journal without raw secrets or signed inputs in storage', async () => {
    const { rows, store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const r = phase('create', 7); await first.onPending(r); await first.onPending(submitted(r));
    await first.onPending({ ...submitted(r), ...accounting });
    await first.onPending({ ...submitted(r), ...accounting });
    const restored = await journal(store).read();
    expect(restored?.recovery).toEqual(recovery); expect(restored?.records).toHaveLength(1);
    expect(restored?.feeWei).toBe('160');
    const encoded = JSON.stringify([...rows.values()]);
    expect(encoded).not.toContain(recovery.secret); expect(encoded).not.toContain('offerBudget');
    expect(encoded).not.toContain('01'.repeat(16)); expect(encoded).not.toContain('ciphertextHigh');
  });
  it('keeps the whole operation locked after approval confirmation and retains closed history', async () => {
    const { store, rows } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const approval = phase('approval', 7), creation = phase('create', 8);
    await first.onPending(approval); await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    await expect(journal(store).assertNoPending()).rejects.toThrow(/pending/);
    await first.onPending(creation); await first.onPending(submitted(creation)); await first.onPending(confirmed(creation));
    const closed = await journal(store).read(); expect(closed?.active).toBe(false); expect(closed?.feeWei).toBe('320');
    await journal(store).assertNoPending(); expect(rows.size).toBe(2);
  });
  it('allows only one claim when two tabs start together', async () => {
    const { store } = memoryStore();
    const result = await Promise.allSettled([journal(store).assertNoPending(), journal(store).assertNoPending()]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('rejects wrong keys, changed headers and damaged ciphertext without discarding the operation', async () => {
    const { store, rows } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const original = structuredClone([...rows.values()][0]);
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner,
      signer: { getUserOnboardInfo: () => ({ aesKey: '02'.repeat(16) }) } });
    await expect(journal(store).read()).rejects.toThrow();
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: owner,
      signer: { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }) } });
    rows.set(original.id, { ...original, revision: original.revision + 1 });
    await expect(journal(store).read()).rejects.toThrow();
    rows.set(original.id, { ...original, sealed: original.sealed.slice(0, -2) + (parseInt(original.sealed.slice(-2), 16) ^ 1).toString(16).padStart(2, '0') });
    await expect(journal(store).read()).rejects.toThrow(); expect(rows.size).toBe(1);
  });
  it('rejects draft changes, extra signed data, phase regressions and changed transaction identities', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    await expect(first.onRecovery({ ...recovery, secret: bytes('aa') })).rejects.toThrow();
    await expect(first.onRecovery({ ...recovery, data: '0x1234' } as typeof recovery)).rejects.toThrow();
    const r = phase('create', 7); await first.onPending(r); await first.onPending(submitted(r));
    await expect(first.onPending(r)).rejects.toThrow();
    await expect(first.onPending({ ...submitted(r), dataHash: bytes('aa') })).rejects.toThrow();
    await expect(first.onPending({ ...submitted(r), transactionHash: bytes('aa') })).rejects.toThrow();
    await expect(first.onPending({ ...confirmed(r), feeWei: '1' })).rejects.toThrow();
    await first.onPending({ ...submitted(r), ...accounting });
    await expect(first.onPending({ ...submitted(r), ...accounting, blockHash: bytes('cc') })).rejects.toThrow();
    expect((await first.read())?.records[0].state).toBe('submitted');
  });
  it('does not grant a second send reservation for an identical pending call', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const r = phase('create', 7); await first.onPending(r);
    await expect(journal(store).onPending({ ...r })).rejects.toThrow();
    expect((await first.read())?.records).toHaveLength(1);
  });
  it('rejects stale concurrent updates and does not let one owner open another owner operation', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const restored = journal(store); await restored.read();
    const updates = await Promise.allSettled([first.onPending(phase('create', 7)), restored.onPending(phase('create', 8))]);
    expect(updates.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    m.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: tokenB,
      signer: { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }) } });
    expect(await journal(store).read()).toBeNull();
  });
  it('releases only an unsent operation, retains its record and holds an uncertain send', async () => {
    const { store, rows } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery); await first.releaseUnsent();
    expect(await journal(store).read()).toMatchObject({ active: false, abandoned: true, records: [] });
    const next = journal(store); await next.assertNoPending(); await next.onRecovery(recovery);
    await next.onPending(phase('create', 7)); await next.releaseUnsent();
    expect(await next.read()).toMatchObject({ active: true, records: [{ state: 'sending' }] });
    await expect(journal(store).assertNoPending()).rejects.toThrow(/pending/); expect(rows.size).toBe(2);
  });
  it('rejects duplicate transaction hashes and fees on unsent or rejected calls', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const approval = phase('approval', 7), creation = phase('create', 8);
    await expect(first.onPending({ ...approval, gasUsed: '80', feeWei: '160' })).rejects.toThrow();
    await first.onPending(approval);
    await expect(first.onPending({ ...approval, state: 'rejected', gasUsed: '80', feeWei: '160' })).rejects.toThrow();
    await first.onPending(submitted(approval)); await first.onPending(confirmed(approval));
    await first.onPending(creation);
    await expect(first.onPending({ ...submitted(creation), transactionHash: submitted(approval).transactionHash })).rejects.toThrow();
    expect((await first.read())?.feeWei).toBe('160');
  });
  it('captures a pending record before asynchronous storage work', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const mutable = { ...phase('create', 7) }, saving = first.onPending(mutable);
    mutable.nonce = 8; mutable.dataHash = bytes('aa'); await saving;
    expect((await first.read())?.records).toMatchObject([{ nonce: 7, dataHash: bytes('88') }]);
  });
  it('retains a wallet speedup and its actual fee without changing the original request', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const r = phase('create', 7), pending = submitted(r);
    await first.onPending(r); await first.onPending(pending);
    const mined = { transactionHash: bytes('aa'), to: escrow, dataHash: r.dataHash, value: '0', gasLimit: '150', gasPrice: '3' };
    const accounted: LinkTradeV2CreationRecord = { ...pending, mined, ...accounting, feeWei: '240' };
    await first.onPending(accounted);
    await expect(first.onPending({ ...accounted, gasPrice: '3' })).rejects.toThrow();
    await expect(first.onPending({ ...accounted, mined: { ...mined, transactionHash: bytes('cc') } })).rejects.toThrow();
    await first.onPending({ ...accounted, state: 'confirmed' });
    expect(await journal(store).read()).toMatchObject({ active: false, feeWei: '240', records: [{
      transactionHash: pending.transactionHash, gasLimit: '125', gasPrice: '2', mined }] });
  });
  it.each(['cancelled', 'replaced', 'reverted'] as const)('closes a proved %s request, retains its fee and never calls it confirmed', async outcome => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const r = phase('create', 7); await first.onPending(r);
    const mined = { transactionHash: bytes('aa'), to: outcome === 'cancelled' ? owner : escrow,
      dataHash: outcome === 'reverted' ? r.dataHash : keccak256('0x'), value: '0', gasLimit: '125', gasPrice: '2', outcome };
    const accounted: LinkTradeV2CreationRecord = { ...submitted(r), mined, ...accounting };
    await first.onPending(accounted);
    await expect(first.onPending({ ...accounted, state: 'confirmed' })).rejects.toThrow();
    await first.onPending({ ...accounted, state: 'failed' });
    const saved = await journal(store).read();
    expect(saved).toMatchObject({ active: false, feeWei: '160', records: [{ state: 'failed', mined }] });
    await expect(first.onPending({ ...r, nonce: 8 })).rejects.toThrow();
    await journal(store).assertNoPending();
  });
  it('advances only the search cursor and keeps the sending reservation locked across tabs', async () => {
    const { store } = memoryStore(), first = journal(store);
    await first.assertNoPending(); await first.onRecovery(recovery);
    const r = { ...phase('create', 7), admission: { number: '10', hash: bytes('aa') } }; await first.onPending(r);
    await first.advanceSearch(7, { throughBlock: '25', blockHash: bytes('bb'), headBlock: '40' });
    const restored = journal(store), saved = (await restored.read())!;
    await expect(restored.onPending(saved.records[0])).rejects.toThrow();
    await expect(restored.advanceSearch(7, { throughBlock: '24', blockHash: bytes('cc'), headBlock: '40' })).rejects.toThrow();
    await expect(restored.advanceSearch(8, { throughBlock: '26', blockHash: bytes('cc'), headBlock: '40' })).rejects.toThrow();
    await expect(restored.onPending({ ...submitted(saved.records[0]), admission: { number: '11', hash: bytes('cc') } })).rejects.toThrow();
    await expect(journal(store).assertNoPending()).rejects.toThrow(/pending/);
    await restored.onPending({ ...submitted(saved.records[0]), ...accounting });
    expect((await restored.read())?.records[0].search?.throughBlock).toBe('25');
  });
});
