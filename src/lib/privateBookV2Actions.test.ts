import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import artifact from '../../tests/fixtures/production-ChainWhisperPrivateOTCEscrowV2.json';
import { PRIVATE_BOOK_V2_ACTION_ABI, PRIVATE_BOOK_V2_RUNTIME_HASH, executePrivateBookV2Action, reconcilePrivateBookV2Action, readPrivateBookV2PreparedAction, cleanupPrivateBookV2Preparation, preparePrivateBookV2Intent, readPrivateBookV2OrderView, type PrivateBookV2Action, type PrivateBookV2OrderView } from './privateBookV2Actions';
import type { AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';

const mocks = vi.hoisted(() => ({ runtimeCodeHash: '', allowance: vi.fn(), readAllowance: vi.fn(), journal: vi.fn(), wait: vi.fn(), encrypt: vi.fn(), current: vi.fn(), snapshot: vi.fn(), binding: vi.fn(), contract: vi.fn(), attest: vi.fn() }));
vi.mock('@coti-io/coti-ethers', async original => {
  const actual = await original<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (value: Parameters<typeof actual.keccak256>[0]) => value === '0x6001'
    ? mocks.runtimeCodeHash : actual.keccak256(value) };
});
vi.mock('./linkTradeV2CreationFlow', async original => ({ ...await original<typeof import('./linkTradeV2CreationFlow')>(), ensureLinkTradeV2Allowance: mocks.allowance, readLinkTradeV2Allowance: mocks.readAllowance }));
vi.mock('./linkTradeV2CreationJournal', async original => ({ ...await original<typeof import('./linkTradeV2CreationJournal')>(), createPrivateBookV2Journal: mocks.journal }));
vi.mock('./appShared/core', async original => ({ ...await original<typeof import('./appShared/core')>(), loadCotiEthersModule: async () => ({ Contract: class { constructor() { return mocks.contract(); } } }) }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: mocks.encrypt, decryptPrivateUint256Output: vi.fn(), EMPTY_PRIVATE_UINT256_INPUT: { ciphertext: { ciphertextHigh: 0n, ciphertextLow: 0n }, signature: '0x' } }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: mocks.attest }));
vi.mock('./ownerTradeV2Capability', () => ({ assertOwnerTradeV2CapabilityCurrent: mocks.current, assertOwnerTradeV2CapabilitySnapshotCurrent: mocks.snapshot, getOwnerTradeV2CapabilityBinding: mocks.binding, getOwnerTradeV2ReadRunner: () => ({}), waitForOwnerTradeV2Receipt: mocks.wait }));

const owner = `0x${'11'.repeat(20)}`; const target = `0x${'22'.repeat(20)}`;
const tokenA = `0x${'33'.repeat(20)}`; const tokenB = `0x${'44'.repeat(20)}`;
const hash = `0x${'55'.repeat(32)}`; const blockHash = `0x${'66'.repeat(32)}`;
const abi = new Interface(PRIVATE_BOOK_V2_ACTION_ABI);
const encrypted = async (value: bigint) => ({ ciphertext: { ciphertextHigh: value >> 128n, ciphertextLow: value & ((1n << 128n) - 1n) }, signature: '0x' });
const deployment = { chainId: '7082400', contractAddress: target, runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH } as AttestedTradeHistoryV2Deployment;
const create: PrivateBookV2Action = { kind: 'create', offerAsset: { assetType: 'private-erc20', token: tokenA, amount: 10n }, requestAsset: { assetType: 'erc20', token: tokenB }, priceTerms: { offerAmount: 1n, requestAmount: 2n }, expiresAt: 0n };
const view: PrivateBookV2OrderView = { orderId: '1', maker: owner, status: 'open', mode: 'private-offer-public-request', offerAsset: { assetType: 'private-erc20', token: tokenA, publicAmount: '0' }, requestAsset: { assetType: 'erc20', token: tokenB, publicAmount: '0' }, priceTerms: { offerAmount: '1', requestAmount: '2' }, fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' }, createdAt: '100', expiresAt: '0', revision: '1', fillCount: '0', rootOrderId: '1', offerLocked: true, offerTokenCodeHash: hash, requestTokenCodeHash: hash, pairKey: hash, replacementOrderId: '0', replacesOrderId: '0' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtimeCodeHash = PRIVATE_BOOK_V2_RUNTIME_HASH;
  let sent: unknown, result: unknown;
  const provider = { getBlock: vi.fn(async () => ({ number: 10, hash: blockHash, timestamp: 1000, gasLimit: 1_000_000n, transactions: [hash] })),
    getCode: vi.fn(async () => '0x6001'),
    estimateGas: vi.fn(async () => 100n), getFeeData: vi.fn(async () => ({ gasPrice: 2n })), getBalance: vi.fn(async () => 100_000n),
    getTransactionCount: vi.fn(async () => 0), getTransaction: vi.fn(async () => sent), getTransactionReceipt: vi.fn(async () => result) };
  const signer = { sendTransaction: vi.fn(async (request: { data: string; to: string; value: bigint; nonce: number; gasLimit: bigint; gasPrice: bigint }) => {
    const decoded = abi.parseTransaction({ data: request.data })!;
    const raw = await mocks.contract()[decoded.name](...decoded.args);
    sent = { ...request, ...raw, gasLimit: request.gasLimit, gasPrice: request.gasPrice, nonce: request.nonce };
    result = { from: owner, to: request.to, gasUsed: 100n, gasPrice: 2n, ...await raw.wait() };
    return sent;
  }) };
  mocks.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer, readProvider: provider });
  mocks.wait.mockImplementation(async () => result);
  mocks.journal.mockImplementation(() => ({ read: vi.fn(async () => null), beginBook: vi.fn(), onPending: vi.fn(), releaseUnsent: vi.fn(), close: vi.fn() }));
  mocks.encrypt.mockImplementation((_signer, value) => encrypted(value));
});

describe('promoted private book adapter (wallet dependencies mocked)', () => {
  it.each(['0x53d5a94a884533df7e79bef37a4818f5c5746787', '0x846340d4d85b91542d386688249169146ec73215'])(
    'blocks new exposure to replaced Book %s before wallet or token access', async contractAddress => {
      const old = { ...deployment, contractAddress };
      await expect(executePrivateBookV2Action({ capability: {} as never, deployment: old, action: create })).rejects.toThrow(/recovery.only/i);
      await expect(executePrivateBookV2Action({ capability: {} as never, deployment: old,
        action: { kind: 'fill', orderId: '1', expectedRevision: '1', terms: {} as never } })).rejects.toThrow(/recovery.only/i);
      expect(mocks.binding).not.toHaveBeenCalled(); expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
    }
  );
  it('rejects new mixed creation before a capability, input or allowance is requested', async () => {
    const current = { ...deployment, ...CURRENT_P2P_BINDING.deployments['private-v2'] } as AttestedTradeHistoryV2Deployment;
    await expect(executePrivateBookV2Action({ capability: {} as never, deployment: current, action: create })).rejects.toThrow(/both sides/);
    expect(mocks.binding).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.allowance).not.toHaveBeenCalled();
    expect(mocks.contract).not.toHaveBeenCalled();
  });
  it.each(CURRENT_P2P_BINDING.retainedBooks)('keeps cancellation on the retained Book $contractAddress', async old => {
    mocks.runtimeCodeHash = old.runtimeBytecodeHash;
    const action = { kind: 'cancel', orderId: '1' } as const;
    const event = abi.encodeEventLog(abi.getEvent('PrivateOrderStatusChanged')!, [1n, owner, 1, 3, owner, 0n, 2n]);
    const result = { status: 1, hash, blockNumber: 10, blockHash,
      logs: [{ ...event, address: old.contractAddress, blockHash, transactionHash: hash, blockNumber: 10, index: 0 }] };
    mocks.contract.mockReturnValue({ cancelOrder: async (...args: unknown[]) => ({ hash, chainId: 7082400n, from: owner,
      to: old.contractAddress, data: abi.encodeFunctionData('cancelOrder', args), value: 0n, wait: async () => result }) });
    expect(await executePrivateBookV2Action({ capability: {} as never, deployment: old as AttestedTradeHistoryV2Deployment, action }))
      .toMatchObject({ action: 'cancel', orderId: '1', transactionHash: hash });
    expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('matches current artifact function inputs AND outputs and event signatures', () => {
    const current = new Interface(artifact.abi);
    for (const fragment of abi.fragments) {
      const expected = fragment.type === 'event' ? current.getEvent(fragment.format('sighash')) : current.getFunction(fragment.format('sighash'));
      expect(expected?.format('full')).toBe(fragment.format('full'));
    }
  });
  it('rejects an older runtime before capability, encryption, allowance or send', async () => {
    await expect(executePrivateBookV2Action({ capability: {} as never, deployment: { ...deployment, runtimeBytecodeHash: hash } as never, action: create })).rejects.toThrow(/runtime/);
    expect(mocks.binding).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled(); expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.contract).not.toHaveBeenCalled();
  });
  it('rejects invalid expiry, token pair and legacy terms before encryption', async () => {
    const encrypt = vi.fn(encrypted);
    for (const action of [{ ...create, expiresAt: 1n }, { ...create, requestAsset: { assetType: 'erc20', token: tokenA } }, { ...create, fillPolicy: { partialFillsAllowed: true } }]) {
      await expect(preparePrivateBookV2Intent(action as PrivateBookV2Action, encrypt)).rejects.toThrow();
    }
    expect(encrypt).not.toHaveBeenCalled();
  });
  it('rejects stale revision and changed price before encryption', async () => {
    const encrypt = vi.fn(encrypted);
    const fill = { kind: 'fill', orderId: 1n, expectedRevision: 2n, terms: { mode: 'private-offer-public-request', fillBehavior: 'remaining-at-reviewed-price', publicRequestAmount: 20n, priceTerms: { offerAmount: 1n, requestAmount: 2n } } } as const;
    await expect(preparePrivateBookV2Intent(fill, encrypt, view)).rejects.toThrow(/stale/);
    await expect(preparePrivateBookV2Intent({ ...fill, expectedRevision: 1n, terms: { ...fill.terms, priceTerms: { offerAmount: 1n, requestAmount: 3n } } }, encrypt, view)).rejects.toThrow(/price differs/);
    expect(encrypt).not.toHaveBeenCalled();
  });
  it('binds explicit budget publication to the reviewed order and revision without amount inputs', async () => {
    const encrypt = vi.fn(encrypted);
    const action = { kind: 'budget-visibility', orderId: '1', expectedRevision: '1', visible: true } as const;
    const intent = await preparePrivateBookV2Intent(action, encrypt, view);
    expect(intent).toMatchObject({ functionName: 'setPublicBudgetVisibility', args: [1n, true], value: 0n,
      expectedOrderId: 1n, expectedEvent: 'TradeBudgetVisibility', expectedVisible: true });
    expect(encrypt).not.toHaveBeenCalled();
    await expect(preparePrivateBookV2Intent({ ...action, expectedRevision: '2' }, encrypt, view)).rejects.toThrow(/stale/);
  });
  const visibilityFixture = (visible: boolean, eventVisible = visible, eventAmount = visible ? 10n : 0n) => {
    const events = new Interface([...PRIVATE_BOOK_V2_ACTION_ABI, 'event TradeBudgetVisibility(uint256 indexed tradeId,bool visible,uint256 amount)']);
    const event = events.encodeEventLog(events.getEvent('TradeBudgetVisibility')!, [1n, eventVisible, eventAmount]);
    const result = { status: 1, hash, blockNumber: 10, blockHash,
      logs: [{ ...event, address: target, blockHash, transactionHash: hash, blockNumber: 10, index: 0 }] };
    const tuple = [owner, 1n, 1n, [2n, tokenA, 0n], [1n, tokenB, 0n], [1n, 2n], [false, 0n, 0n], 100n, 0n, 1n, 0n, 1n, true, hash, hash];
    const write = vi.fn(async (...args: unknown[]) => ({ hash, chainId: 7082400n, from: owner, to: target,
      data: abi.encodeFunctionData('setPublicBudgetVisibility', args), value: 0n, wait: async () => result }));
    const getOrderView = vi.fn(async () => [[...tuple], 1n, hash, 0n, 0n]);
    mocks.contract.mockReturnValue({ getOrderView, setPublicBudgetVisibility: write });
    const action = { kind: 'budget-visibility', orderId: '1', expectedRevision: '1', visible } as const;
    return { action, write, tuple, run: () => executePrivateBookV2Action({ capability: {} as never, deployment, action }) };
  };
  it.each([true, false])('executes explicit budget visibility=%s through the shared sender without token inputs', async visible => {
    const f = visibilityFixture(visible);
    expect(await f.run()).toMatchObject({ action: 'budget-visibility', orderId: '1', transactionHash: hash });
    expect(f.write).toHaveBeenCalledExactlyOnceWith(1n, visible);
    expect(mocks.binding().readProvider.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ value: 0n }));
    expect(mocks.binding().signer.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 0n,
      data: abi.encodeFunctionData('setPublicBudgetVisibility', [1n, visible]) }));
    expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
    const journal = mocks.journal.mock.results[0].value;
    expect(journal.beginBook).toHaveBeenCalledExactlyOnceWith({ kind: 'budget-visibility',
      expectedEvent: 'TradeBudgetVisibility', expectedOrderId: '1', expectedVisible: visible }, undefined);
    expect(journal.beginBook.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(journal.beginBook.mock.calls[0][0]).not.toHaveProperty('budget');
    expect(journal.beginBook.mock.calls[0][0]).not.toHaveProperty('approvalToken');
  });
  it.each(['wrong-visible', 'hidden-nonzero'])('rejects a budget visibility receipt with %s', async fault => {
    const f = fault === 'wrong-visible' ? visibilityFixture(true, false, 0n) : visibilityFixture(false, false, 10n);
    await expect(f.run()).rejects.toThrow(/missing the exact action event/);
    expect(mocks.binding().signer.sendTransaction).toHaveBeenCalledOnce();
    expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
    const journal = mocks.journal.mock.results[0].value;
    expect(journal.onPending.mock.calls.some(([record]: [{ state: string }]) => record.state === 'confirmed')).toBe(false);
  });
  it.each(['maker', 'revision', 'bool'])('rejects invalid budget visibility %s before transaction signing', async fault => {
    const f = visibilityFixture(true);
    if (fault === 'maker') f.tuple[0] = target;
    if (fault === 'revision') f.tuple[9] = 2n;
    const action = fault === 'bool' ? { ...f.action, visible: 'true' as never } : f.action;
    await expect(executePrivateBookV2Action({ capability: {} as never, deployment, action })).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled(); expect(mocks.binding().signer.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.allowance).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('skips encryption for a public-offer create and encrypts zero for a public-request fill', async () => {
    const encrypt = vi.fn(encrypted);
    const publicCreate = { ...create, offerAsset: { assetType: 'erc20', token: tokenA, amount: 10n }, requestAsset: { assetType: 'private-erc20', token: tokenB } } as const;
    const intent = await preparePrivateBookV2Intent(publicCreate, encrypt);
    expect(encrypt).not.toHaveBeenCalled(); expect(abi.decodeFunctionData('createOrder', abi.encodeFunctionData(intent.functionName, intent.args)).offerAsset.publicAmount).toBe(10n);
    await preparePrivateBookV2Intent({ kind: 'fill', orderId: 1n, expectedRevision: 1n, terms: { mode: 'private-offer-public-request', fillBehavior: 'remaining-at-reviewed-price', publicRequestAmount: 20n, priceTerms: { offerAmount: 1n, requestAmount: 2n } } }, encrypt, view);
    expect(encrypt).toHaveBeenCalledWith(0n, abi.getFunction('fillOrder')!.selector);
  });
  it('decodes the complete current view without old tuple indices or 8-bit fill count', async () => {
    const tuple = [owner, 1n, 1n, [2n, tokenA, 0n], [1n, tokenB, 0n], [1n, 2n], [false, 0n, 0n], 100n, 0n, 300n, 299n, 1n, true, hash, hash];
    mocks.contract.mockReturnValue({ getOrderView: async () => [[...tuple], 1n, hash, 9n, 8n], getPublicBudget: async () => [false, 0n] });
    expect(await readPrivateBookV2OrderView({ capability: {} as never, deployment, orderId: 1n })).toMatchObject({ priceTerms: view.priceTerms, createdAt: '100', revision: '300', fillCount: '299', rootOrderId: '1', replacementOrderId: '9', replacesOrderId: '8', offerLocked: true });
  });
  const receipt = (overrides = {}) => {
    const event = abi.encodeEventLog(abi.getEvent('PrivateOrderOpened')!, [1n, owner, hash, 1, 2, tokenA, 0n, 1, tokenB, 0n, [1n, 2n], [false, 0, 0], 100n, 0n, 1n, 1n]);
    const log = { ...event, address: target, blockHash, transactionHash: hash, blockNumber: 10, index: 0 };
    return { status: 1, hash, blockNumber: 10, blockHash, logs: [log], ...overrides };
  };
  const execute = async (result: unknown, txOverrides = {}) => {
    mocks.contract.mockReturnValue({ createOrder: async (...args: unknown[]) => ({ hash, chainId: 7082400n, from: owner, to: target, data: abi.encodeFunctionData('createOrder', args), value: 0n, wait: async () => result, ...txOverrides }) });
    return executePrivateBookV2Action({ capability: {} as never, deployment, action: create });
  };
  it('confirms the exact current event after bounded approval and submit', async () => {
    expect(await execute(receipt())).toMatchObject({ orderId: '1', transactionHash: hash, blockNumber: '10' });
    expect(mocks.allowance).toHaveBeenCalledWith(mocks.binding(), { offerToken: tokenA, privatePair: true }, target, 10n, expect.any(Function));
  });
  it('rejects mismatched transaction authority and failed, foreign or duplicate receipts', async () => {
    await expect(execute(receipt(), { to: tokenA })).rejects.toThrow(/reviewed call/);
    await expect(execute(receipt({ status: 0 }))).rejects.toThrow(/reverted/);
    const original = receipt();
    await expect(execute(receipt({ logs: [{ ...original.logs[0], address: tokenA }] }))).rejects.toThrow(/missing/);
    await expect(execute(receipt({ logs: [original.logs[0], { ...original.logs[0], index: 1 }] }))).rejects.toThrow(/duplicate/);
  });
  it('saves the intent before signing and the hash before receipt access', async () => {
    await execute(receipt());
    const journal = mocks.journal.mock.results[0].value;
    const calls = journal.onPending.mock.calls.map(([record]: [{ state: string }]) => record.state);
    expect(calls).toEqual(['sending', 'submitted', 'submitted', 'confirmed']);
    expect(journal.beginBook.mock.invocationCallOrder[0]).toBeLessThan(journal.onPending.mock.invocationCallOrder[0]);
    expect(journal.beginBook.mock.invocationCallOrder[0]).toBeLessThan(mocks.encrypt.mock.invocationCallOrder[0]);
    expect(journal.onPending.mock.invocationCallOrder[0]).toBeLessThan(mocks.binding().signer.sendTransaction.mock.invocationCallOrder[0]);
    expect(journal.onPending.mock.invocationCallOrder[1]).toBeLessThan(mocks.wait.mock.invocationCallOrder[0]);
    const saved = journal.onPending.mock.calls[0][0];
    expect(saved).not.toHaveProperty('data');
    expect(JSON.stringify(saved)).not.toMatch(/ciphertext|signature|offerBudget/);
  });
  it('holds an unresolved action before preparing new private inputs or allowances', async () => {
    const journal = { read: vi.fn(async () => ({ active: true, book: { kind: 'create' }, records: [{ state: 'sending', step: 'create' }] })),
      releaseUnsent: vi.fn(), close: vi.fn() };
    mocks.journal.mockReturnValue(journal);
    await expect(execute(receipt())).rejects.toThrow(/pending/);
    expect(mocks.encrypt).not.toHaveBeenCalled(); expect(mocks.allowance).not.toHaveBeenCalled();
    expect(mocks.binding().signer.sendTransaction).not.toHaveBeenCalled(); expect(journal.releaseUnsent).not.toHaveBeenCalled();
  });
  it('stops a changed deployed runtime before transaction signing', async () => {
    mocks.binding().readProvider.getCode.mockResolvedValueOnce('0x6002');
    await expect(execute(receipt())).rejects.toThrow(/runtime changed/);
    expect(mocks.binding().signer.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.journal.mock.results[0].value.onPending).not.toHaveBeenCalled();
  });
  it('reconciles a saved hash and exact fee after a receipt timeout without decrypting or resending', async () => {
    type Journal = NonNullable<Parameters<typeof executePrivateBookV2Action>[0]['journal']>;
    type Snapshot = NonNullable<Awaited<ReturnType<Journal['read']>>>;
    let saved: Snapshot | null = null;
    const journal = {
      read: vi.fn(async () => saved), readFunding: vi.fn(() => { throw new Error('Privacy is locked.'); }),
      beginBook: vi.fn(async book => { saved = { id: 'saved', active: true, version: 1, scope: {} as never, book, records: [], feeWei: '0' }; }),
      onPending: vi.fn(async record => { saved = { ...saved!, active: record.state !== 'confirmed', records: [record], feeWei: record.feeWei ?? '0' }; }),
      releaseUnsent: vi.fn(), beginCleanup: vi.fn(), finishPreparation: vi.fn(), advanceSearch: vi.fn(), close: vi.fn()
    } satisfies Journal;
    mocks.journal.mockReturnValue(journal); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(execute(receipt())).rejects.toThrow(/timed out/);
    expect((await journal.read())?.records[0]).toMatchObject({ state: 'submitted', transactionHash: hash });
    expect(await reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal })).toMatchObject({ action: 'create', orderId: '1', transactionHash: hash });
    expect((await journal.read())?.records[0]).toMatchObject({ state: 'confirmed', transactionHash: hash, feeWei: '200', gasUsed: '100' });
    expect(mocks.binding().signer.sendTransaction).toHaveBeenCalledOnce(); expect(mocks.wait).toHaveBeenCalledOnce();
    expect(journal.readFunding).not.toHaveBeenCalled();
  });
  it.each(['valid', 'missing-receipt', 'wrong-nonce', 'changed-fee'])('checks a saved confirmed approval before reading funding: %s', async fault => {
    const tokenAbi = new Interface(['function approve(address,uint256)']);
    const data = tokenAbi.encodeFunctionData('approve', [target, 10n]);
    const record = { step: 'approval', state: 'confirmed', chainId: '7082400', owner, to: tokenA, nonce: 0,
      dataHash: keccak256(data), gasLimit: '125', gasPrice: '2', transactionHash: hash, gasUsed: '100', feeWei: '200', blockNumber: '10', blockHash } as const;
    const saved = { id: 'prepared', active: true, book: { kind: 'create', approvalToken: tokenA },
      scope: { chainId: '7082400', owner, escrow: target, runtimeHash: deployment.runtimeBytecodeHash }, records: [record] };
    const journal = { read: vi.fn(async () => saved), readFunding: vi.fn(async () => create), advanceSearch: vi.fn() };
    const binding = mocks.binding();
    binding.readProvider.getTransaction.mockResolvedValue({ hash, chainId: 7082400n, from: owner, to: tokenA, nonce: fault === 'wrong-nonce' ? 1 : 0,
      data, value: 0n, gasLimit: 125n, gasPrice: 2n });
    binding.readProvider.getTransactionReceipt.mockResolvedValue(fault === 'missing-receipt' ? null : {
      status: 1, hash, from: owner, to: tokenA, blockNumber: 10, blockHash, gasUsed: fault === 'changed-fee' ? 101n : 100n, gasPrice: 2n });
    const check = readPrivateBookV2PreparedAction({ capability: {} as never, deployment, journal: journal as never });
    if (fault === 'valid') { expect(await check).toBe(create); expect(journal.readFunding).toHaveBeenCalledOnce(); }
    else { await expect(check).rejects.toThrow(); expect(journal.readFunding).not.toHaveBeenCalled(); }
    expect(binding.signer.sendTransaction).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
  });
});

describe('Book approval-only cleanup with canonical receipt mocks', () => {
  const fixture = (privateApproval = false, initialAllowance = 10n) => {
    type Journal = NonNullable<Parameters<typeof executePrivateBookV2Action>[0]['journal']>;
    type Snapshot = NonNullable<Awaited<ReturnType<Journal['read']>>>;
    const token = new Interface(['function approve(address,uint256)']);
    const approvalData = token.encodeFunctionData('approve', [target, 10n]);
    const cleanupHash = `0x${'77'.repeat(32)}`;
    let allowance = initialAllowance;
    let saved: Snapshot = { id: 'prepared', active: true, version: 1,
      scope: { chainId: '7082400', owner, escrow: target, runtimeHash: deployment.runtimeBytecodeHash },
      book: { kind: 'create', expectedEvent: 'PrivateOrderOpened', approvalToken: tokenA, approvalPrivate: privateApproval }, feeWei: '200',
      records: [{ step: 'approval', state: 'confirmed', chainId: '7082400', owner, to: tokenA, nonce: 0,
        dataHash: keccak256(approvalData), gasLimit: '125', gasPrice: '2', transactionHash: hash,
        gasUsed: '100', feeWei: '200', blockNumber: '10', blockHash }] };
    const approvalTx = { hash, chainId: 7082400n, from: owner, to: tokenA, nonce: 0, data: approvalData, value: 0n, gasLimit: 125n, gasPrice: 2n };
    const receipts = new Map([[hash, { status: 1, hash, from: owner, to: tokenA, blockNumber: 10, blockHash, gasUsed: 100n, gasPrice: 2n }]]);
    const transactions = new Map<string, unknown>([[hash, approvalTx]]);
    const binding = mocks.binding();
    binding.readProvider.getTransaction.mockImplementation(async (id: string) => transactions.get(id));
    binding.readProvider.getTransactionReceipt.mockImplementation(async (id: string) => receipts.get(id) ?? null);
    binding.readProvider.getTransactionCount.mockResolvedValue(1);
    binding.readProvider.getBlock.mockImplementation(async () => ({ number: 10, hash: blockHash, timestamp: 1000, gasLimit: 1_000_000n, transactions: [...transactions.keys()] }));
    binding.signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) => {
      allowance = 0n;
      const nextHash = request.nonce === 1 ? cleanupHash : `0x${'88'.repeat(32)}`;
      const tx = { ...request, from: owner, chainId: 7082400n, hash: nextHash };
      transactions.set(nextHash, tx); receipts.set(nextHash, { status: 1, hash: nextHash, from: owner, to: tokenA,
        blockNumber: 10, blockHash, gasUsed: 100n, gasPrice: 2n }); return tx;
    });
    mocks.wait.mockImplementation(async (_binding, id: string) => receipts.get(id));
    mocks.readAllowance.mockImplementation(async () => allowance);
    mocks.allowance.mockImplementation(async (_binding, _terms, _escrow, budget, send) => {
      expect(budget).toBe(0n);
      await send('approval-reset', tokenA, token.encodeFunctionData('approve', [target, 0n]), async () => {
        if (allowance !== 0n) throw new Error('Allowance not zero.');
      });
    });
    const journal = {
      read: vi.fn(async () => saved), readFunding: vi.fn(async () => { throw new Error('Funding must stay sealed.'); }),
      beginBook: vi.fn(), onPending: vi.fn(async record => {
        const records = [...saved.records.filter(old => old.nonce !== record.nonce), record];
        saved = { ...saved, records, active: !(record.step === 'cleanup' && record.state === 'confirmed'),
          feeWei: [...records, ...saved.priorCleanup ?? []].reduce((sum, item) => sum + BigInt(item.feeWei ?? '0'), 0n).toString() };
      }), beginCleanup: vi.fn(async () => {
        const last = saved.records[saved.records.length - 1], retry = last.step === 'cleanup';
        saved = { ...saved, cleanupOnly: true, ...(retry ? { records: saved.records.slice(0, -1), priorCleanup: [...saved.priorCleanup ?? [], last] } : {}) };
      }), finishPreparation: vi.fn(async () => { saved = { ...saved, abandoned: true, active: false }; }),
      releaseUnsent: vi.fn(), advanceSearch: vi.fn(), close: vi.fn()
    } satisfies Journal;
    const run = () => cleanupPrivateBookV2Preparation({ capability: {} as never, deployment, journal, preparationId: 'prepared' });
    return { journal, binding, run, receipts, get: () => saved, set: (next: Snapshot) => { saved = next; }, setAllowance: (value: bigint) => { allowance = value; } };
  };
  it.each([false, true])('cleans private=%s via the existing exact allowance helper without reading funding', async privateApproval => {
    const f = fixture(privateApproval); await f.run();
    expect(mocks.allowance).toHaveBeenCalledWith(f.binding, { offerToken: tokenA, privatePair: privateApproval }, target, 0n, expect.any(Function));
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: tokenA, value: 0n }));
    expect(f.journal.readFunding).not.toHaveBeenCalled(); expect(f.get()).toMatchObject({ active: false, feeWei: '400',
      records: [{ step: 'approval', feeWei: '200' }, { step: 'cleanup', state: 'confirmed', feeWei: '200' }] });
  });
  it('closes an already-zero allowance without a send and retains the approval fee', async () => {
    const f = fixture(false, 0n); await f.run();
    expect(f.binding.signer.sendTransaction).not.toHaveBeenCalled(); expect(mocks.allowance).not.toHaveBeenCalled();
    expect(f.journal.finishPreparation).toHaveBeenCalledExactlyOnceWith('prepared');
    expect(f.journal.readFunding).not.toHaveBeenCalled(); expect(f.get()).toMatchObject({ active: false, abandoned: true, feeWei: '200' });
  });
  it('holds a reserved funding call before cleanup or current allowance reads', async () => {
    const f = fixture(), prior = f.get();
    f.set({ ...prior, records: [...prior.records, { ...prior.records[0], step: 'create', state: 'sending', to: target, nonce: 1,
      transactionHash: undefined, gasUsed: undefined, feeWei: undefined, blockHash: undefined, blockNumber: undefined }] });
    await expect(f.run()).rejects.toThrow(/pending/);
    expect(mocks.readAllowance).not.toHaveBeenCalled(); expect(f.binding.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('keeps an uncertain cleanup locked and reconciles its hash without another send', async () => {
    const f = fixture(); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(f.run()).rejects.toThrow(/timed out/);
    expect(f.get()).toMatchObject({ active: true, feeWei: '200', records: [{ step: 'approval' }, { step: 'cleanup', state: 'submitted' }] });
    await expect(f.run()).rejects.toThrow(/pending/);
    expect(await reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal: f.journal })).toBeNull();
    expect(f.get()).toMatchObject({ active: false, feeWei: '400', records: [{ step: 'approval' }, { step: 'cleanup', state: 'confirmed' }] });
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledOnce(); expect(f.journal.readFunding).not.toHaveBeenCalled();
  });
  it('retains the cleanup lock and accounted fee when its allowance is not zero', async () => {
    const f = fixture(); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(f.run()).rejects.toThrow(/timed out/);
    mocks.readAllowance.mockResolvedValueOnce(10n);
    await expect(reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal: f.journal })).rejects.toThrow(/not zero/);
    expect(f.get()).toMatchObject({ active: true, feeWei: '400', records: [{ step: 'approval' }, { step: 'cleanup', state: 'submitted', feeWei: '200' }] });
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('retains identical rejected starts across explicit retries without permitting funding', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      f.binding.signer.sendTransaction.mockRejectedValueOnce(Object.assign(new Error('Rejected.'), { code: 4001 }));
      await expect(f.run()).rejects.toThrow(/Rejected/);
      expect(f.get()).toMatchObject({ active: true, cleanupOnly: true, feeWei: '200' });
      await expect(readPrivateBookV2PreparedAction({ capability: {} as never, deployment, journal: f.journal })).rejects.toThrow(/pending/);
    }
    expect(f.get().priorCleanup).toHaveLength(1);
    await f.run();
    expect(f.get().priorCleanup).toHaveLength(2);
    expect(f.get().priorCleanup![0]).toEqual(f.get().priorCleanup![1]);
    expect(f.get()).toMatchObject({ active: false, feeWei: '400' });
    expect(f.journal.readFunding).not.toHaveBeenCalled();
    expect(f.journal.beginCleanup.mock.invocationCallOrder[0]).toBeLessThan(mocks.allowance.mock.invocationCallOrder[0]);
  });
  it('canonically checks a mined failure and keeps its fee across a fresh explicit cleanup retry', async () => {
    const f = fixture(); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(f.run()).rejects.toThrow();
    const failedHash = f.get().records[1].transactionHash!; f.receipts.get(failedHash)!.status = 0; f.setAllowance(10n);
    await reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal: f.journal });
    expect(f.get()).toMatchObject({ active: true, feeWei: '400', records: [{ step: 'approval' }, { state: 'failed' }] });
    f.binding.readProvider.getTransactionCount.mockResolvedValue(2);
    await f.run();
    expect(f.get()).toMatchObject({ active: false, feeWei: '600', priorCleanup: [{ state: 'failed', feeWei: '200', transactionHash: failedHash }] });
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledTimes(2); expect(f.journal.readFunding).not.toHaveBeenCalled();
  });
  it('does not retry a failure whose canonical hash is unavailable', async () => {
    const f = fixture(); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(f.run()).rejects.toThrow();
    const failedHash = f.get().records[1].transactionHash!; f.receipts.get(failedHash)!.status = 0;
    await reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal: f.journal });
    f.receipts.delete(failedHash);
    await expect(f.run()).rejects.toThrow(/not canonical/);
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledOnce(); expect(f.journal.beginCleanup).toHaveBeenCalledOnce();
  });
  it('finishes a proved failed preparation without resending when its allowance is already zero', async () => {
    const f = fixture(); mocks.wait.mockRejectedValueOnce(new Error('Receipt timed out.'));
    await expect(f.run()).rejects.toThrow();
    const failedHash = f.get().records[1].transactionHash!; f.receipts.get(failedHash)!.status = 0;
    await reconcilePrivateBookV2Action({ capability: {} as never, deployment, journal: f.journal });
    await f.run();
    expect(f.get()).toMatchObject({ active: false, cleanupOnly: true, abandoned: true, feeWei: '400',
      priorCleanup: [{ state: 'failed', feeWei: '200' }], records: [{ step: 'approval' }] });
    expect(f.binding.signer.sendTransaction).toHaveBeenCalledOnce(); expect(f.journal.finishPreparation).toHaveBeenCalledOnce();
  });
  it('keeps the lock when its saved history changes during a zero-allowance read', async () => {
    const f = fixture(false, 0n);
    mocks.readAllowance.mockImplementationOnce(async () => {
      f.set({ ...f.get(), book: { ...f.get().book, approvalToken: tokenB } }); return 0n;
    });
    await expect(f.run()).rejects.toThrow(/changed before cleanup/);
    expect(f.journal.finishPreparation).not.toHaveBeenCalled(); expect(f.binding.signer.sendTransaction).not.toHaveBeenCalled();
  });
});
