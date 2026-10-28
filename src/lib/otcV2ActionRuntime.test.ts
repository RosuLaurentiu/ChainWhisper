import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';

const mocks = vi.hoisted(() => ({
  readBalance: vi.fn(), executeBalance: vi.fn(), pendingBalance: vi.fn(), reconcileBalance: vi.fn(), recipientsBalance: vi.fn(),
  assertHistory: vi.fn(),
  assertCapabilitySnapshot: vi.fn(),
  attest: vi.fn(), attestBatch: vi.fn(), createJournal: vi.fn(), createBookJournal: vi.fn(),
  ownerBinding: vi.fn(), executeCounter: vi.fn(), readCounter: vi.fn(), cancelCounter: vi.fn(), continueCounter: vi.fn(), cleanupCounter: vi.fn(), reconcileCounter: vi.fn(), recipientCounter: vi.fn(),
  createCounterActivity: vi.fn(), syncCounterActivity: vi.fn(), closeCounterActivity: vi.fn(),
  assertLink: vi.fn(), executeLink: vi.fn(), reconcileLink: vi.fn(), continueLink: vi.fn(),
  executeFill: vi.fn(), reconcileFill: vi.fn(), continueFill: vi.fn(),
  createActivity: vi.fn(), syncActivity: vi.fn(), closeActivity: vi.fn(),
  readLinkOwner: vi.fn(), executeLinkOwner: vi.fn(), cleanupLink: vi.fn(), reconcileLinkOwner: vi.fn(), retryLinkOwner: vi.fn(),
  confirmDirect: vi.fn(),
  confirmPrivateRecurring: vi.fn(),
  confirmRecurring: vi.fn(),
  confirmStandard: vi.fn(),
  executePrivate: vi.fn(),
  executeBook: vi.fn(), cleanupBook: vi.fn(), reconcileBook: vi.fn(), readBookPrepared: vi.fn(), listBook: vi.fn(), readBook: vi.fn(), readBookAccount: vi.fn(),
  ensureDirect: vi.fn(),
  ensureStandard: vi.fn(),
  listDirect: vi.fn(),
  listPrivateTrade: vi.fn(),
  listStandard: vi.fn(),
  listPrivateRecurring: vi.fn(),
  listRecurring: vi.fn(),
  quoteRecurring: vi.fn(),
  quoteStandard: vi.fn(),
  readDirect: vi.fn(),
  readPrivateTrade: vi.fn(),
  readPrivateTradeAccount: vi.fn(),
  readPrivateRecurring: vi.fn(),
  readPrivateRecurringInventory: vi.fn(),
  readPrivateRecurringReceipt: vi.fn(),
  readRecurring: vi.fn(),
  readStandard: vi.fn(),
  submitDirect: vi.fn(),
  submitPrivateRecurring: vi.fn(),
  submitRecurring: vi.fn(),
  submitStandard: vi.fn()
}));
vi.mock('./ownerTradeV2Capability', () => ({
  getOwnerTradeV2CapabilityBinding: mocks.ownerBinding,
  assertOwnerTradeV2CapabilitySnapshotCurrent: mocks.assertCapabilitySnapshot
}));
vi.mock('./tradeBalanceDisclosureV2', () => ({ readTradeBalanceDisclosureV2: mocks.readBalance, executeTradeBalanceDisclosureV2: mocks.executeBalance,
  readTradeBalanceDisclosureV2Pending: mocks.pendingBalance, reconcileTradeBalanceDisclosureV2: mocks.reconcileBalance, readTradeBalanceDisclosureV2Recipients: mocks.recipientsBalance }));
vi.mock('./counterTradeV2', async importOriginal => ({ ...(await importOriginal<typeof import('./counterTradeV2')>()), readCounterTradeV2Proposal: mocks.readCounter }));
vi.mock('./counterTradeV2Flow', () => ({ executeCounterTradeV2Proposal: mocks.executeCounter, cancelCounterTradeV2Proposal: mocks.cancelCounter,
  continueCounterTradeV2Proposal: mocks.continueCounter, cleanupCounterTradeV2Allowance: mocks.cleanupCounter, reconcileCounterTradeV2Proposal: mocks.reconcileCounter, executeCounterTradeV2RecipientAction: mocks.recipientCounter }));
vi.mock('./counterTradeV2Activity', async original => ({ ...await original<typeof import('./counterTradeV2Activity')>(), createCounterTradeV2ActivityReader: mocks.createCounterActivity }));

vi.mock('./linkTradeV2CreationFlow', () => ({ executeLinkTradeV2Creation: mocks.executeLink,
  reconcileLinkTradeV2Creation: mocks.reconcileLink, continueLinkTradeV2Creation: mocks.continueLink }));
vi.mock('./linkTradeV2FillFlow', () => ({ executeLinkTradeV2Fill: mocks.executeFill, reconcileLinkTradeV2Fill: mocks.reconcileFill, continueLinkTradeV2Fill: mocks.continueFill }));
vi.mock('./linkTradeV2Activity', async original => ({ ...await original<typeof import('./linkTradeV2Activity')>(), createLinkTradeV2ActivityReader: mocks.createActivity }));
vi.mock('./linkTradeV2OwnerActions', () => ({ readLinkTradeV2OwnerOrder: mocks.readLinkOwner, executeLinkTradeV2OwnerOrderAction: mocks.executeLinkOwner,
  cleanupLinkTradeV2Creation: mocks.cleanupLink, reconcileLinkTradeV2OwnerAction: mocks.reconcileLinkOwner, retryLinkTradeV2OwnerAction: mocks.retryLinkOwner }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: mocks.assertLink, attestTradeHistoryV2Deployment: mocks.attest,
  attestTradeHistoryV2Deployments: async (args: { manifests: readonly unknown[] }) => {
    mocks.attestBatch(args);
    const { manifests, ...rest } = args;
    return Promise.all(manifests.map(manifest => mocks.attest({ ...rest, manifest })));
  },
  TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS: 100_000n }));
vi.mock('./linkTradeV2CreationJournal', () => ({ createLinkTradeV2CreationJournal: mocks.createJournal, createPrivateBookV2Journal: mocks.createBookJournal }));

vi.mock('./privateBookV2Actions', async (importOriginal) => ({ ...await importOriginal<typeof import('./privateBookV2Actions')>(), executePrivateBookV2Action: mocks.executeBook, cleanupPrivateBookV2Preparation: mocks.cleanupBook, reconcilePrivateBookV2Action: mocks.reconcileBook, readPrivateBookV2PreparedAction: mocks.readBookPrepared, readPrivateBookV2OrderIds: mocks.listBook, readPrivateBookV2OrderView: mocks.readBook, readPrivateBookV2AccountSnapshot: mocks.readBookAccount }));

vi.mock('./otcTradeHistoryV2Runtime', () => ({
  assertOtcTradeHistoryV2Runtime: mocks.assertHistory
}));
vi.mock('./directTradeV2Actions', () => ({
  confirmDirectTradeV2Action: mocks.confirmDirect,
  ensureDirectTradeV2ActionAllowance: mocks.ensureDirect,
  readDirectTradeV2TradeIds: mocks.listDirect,
  readDirectTradeV2TradeTerms: mocks.readDirect,
  submitDirectTradeV2Action: mocks.submitDirect
}));
vi.mock('./privateTradeV2Actions', () => ({
  executePrivateTradeV2Action: mocks.executePrivate,
  readPrivateTradeV2AccountSnapshot: mocks.readPrivateTradeAccount,
  readPrivateTradeV2OrderIds: mocks.listPrivateTrade,
  readPrivateTradeV2OrderView: mocks.readPrivateTrade
}));
vi.mock('./privateRecurringTradeV2Actions', () => ({
  confirmPrivateRecurringTradeV2Action: mocks.confirmPrivateRecurring,
  readPrivateRecurringTradeV2ExecutionReceipt: mocks.readPrivateRecurringReceipt,
  readPrivateRecurringTradeV2MakerInventory: mocks.readPrivateRecurringInventory,
  readPrivateRecurringTradeV2OrderIds: mocks.listPrivateRecurring,
  readPrivateRecurringTradeV2OrderView: mocks.readPrivateRecurring,
  submitPrivateRecurringTradeV2Action: mocks.submitPrivateRecurring
}));
vi.mock('./recurringTradeV2Actions', () => ({
  confirmRecurringTradeV2Action: mocks.confirmRecurring,
  quoteRecurringTradeV2Execution: mocks.quoteRecurring,
  readRecurringTradeV2OrderIds: mocks.listRecurring,
  readRecurringTradeV2OrderView: mocks.readRecurring,
  submitRecurringTradeV2Action: mocks.submitRecurring
}));
vi.mock('./standardTradeV2Actions', async importOriginal => ({
  ...(await importOriginal<typeof import('./standardTradeV2Actions')>()),
  confirmStandardTradeV2Action: mocks.confirmStandard,
  ensureStandardTradeV2Allowance: mocks.ensureStandard,
  quoteStandardTradeV2Fill: mocks.quoteStandard,
  readStandardTradeV2Ids: mocks.listStandard,
  readStandardTradeV2View: mocks.readStandard,
  submitStandardTradeV2Action: mocks.submitStandard
}));

import { createOtcV2ActionRuntime, createOtcV2ActionRuntimeFromCatalog, assertOtcV2ActionRuntime } from './otcV2ActionRuntime';

const deployment = (protocol: string) => Object.freeze({ protocol });
const history = Object.freeze({
  deployments: Object.freeze({
    'standard-v2': deployment('standard-v2'),
    'private-v2': deployment('private-v2'),
    'direct-v2': deployment('direct-v2'),
    'recurring-v2': deployment('recurring-v2'),
    'private-recurring-v2': deployment('private-recurring-v2')
  }),
  readDirectTerms: mocks.readDirect,
  isCurrent: () => true
});
const oneMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
};
const createActivityRuntime = (options: {
  runOwnerTransactionFlow?: <T>(operation: () => Promise<T>) => Promise<T>;
  readRetainedLinkActivity?: () => Promise<readonly unknown[]>;
} = {}) => {
  const ownerAddress = `0x${'44'.repeat(20)}`;
  const capability = Object.freeze({});
  const getOwnerCapability = vi.fn(async () => capability as never);
  const current = { ...history, ownerAddress, readCapability: {}, deployments: CURRENT_P2P_BINDING.deployments };
  mocks.ownerBinding.mockReturnValue({ ownerAddress, chainId: 7082400n });
  mocks.createActivity.mockReturnValue({ sync: mocks.syncActivity, close: mocks.closeActivity });
  mocks.createCounterActivity.mockReturnValue({ sync: mocks.syncCounterActivity, close: mocks.closeCounterActivity });
  const runtime = createOtcV2ActionRuntime({
    history: current as never,
    getOwnerCapability,
    runOwnerTransactionFlow: options.runOwnerTransactionFlow ?? (operation => operation()),
    linkCreation: { capability: capability as never, deployment: CURRENT_P2P_BINDING.deployments['link-v2'] as never,
      journal: { read: async () => null, close: vi.fn() } as never },
    counterCreation: { deployment: CURRENT_P2P_BINDING.deployments['counter-v2'] as never,
      journal: { read: async () => null, close: vi.fn() } as never },
    ...(options.readRetainedLinkActivity ? { readRetainedLinkActivity: options.readRetainedLinkActivity as never } : {})
  });
  return { runtime, getOwnerCapability };
};

describe('OTC V2 action runtime', () => {
  it('passes scoped public permissions through the owner queue without privacy prompts or unrelated writes', async () => {
    const direct = CURRENT_P2P_BINDING.deployments['direct-v2'];
    const current = { ...history, deployments: { ...history.deployments, 'direct-v2': direct } };
    const getOwnerCapability = vi.fn(async (_privacy: boolean) => ({} as never));
    const admission = { ...direct, mode: 'public-forward' as const, publicForward: true, publicCounter: false };
    const action = { kind: 'create-public' as const, offerAsset: { assetType: 'erc20' as const, token: `0x${'11'.repeat(20)}` },
      requestAsset: { assetType: 'erc20' as const, token: `0x${'22'.repeat(20)}` }, offerAmount: 10n, requestAmount: 25n,
      taker: `0x${'33'.repeat(20)}`, expiresAt: 1_800_000_000n };
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability,
      runOwnerTransactionFlow: async operation => operation(), directAdmission: admission });
    await runtime.direct(action);
    expect(getOwnerCapability.mock.calls.map(call => call[0])).toEqual([false]);
    expect(mocks.ensureDirect).toHaveBeenCalledWith(expect.objectContaining({ action, actionAdmission: admission }));
    expect(mocks.submitDirect).toHaveBeenCalledWith(expect.objectContaining({ action, actionAdmission: admission }));
    await expect(runtime.direct({ ...action, kind: 'counter-public', parentTradeId: 7n })).rejects.toThrow(/not ready/);
    expect(getOwnerCapability).toHaveBeenCalledOnce(); runtime.close();
    const counterAdmission = { ...admission, publicCounter: true };
    const counterRuntime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability,
      runOwnerTransactionFlow: async operation => operation(), directAdmission: counterAdmission });
    const counter = { ...action, kind: 'counter-public' as const, parentTradeId: 7n };
    await counterRuntime.direct(counter);
    expect(mocks.submitDirect).toHaveBeenLastCalledWith(expect.objectContaining({ action: counter, actionAdmission: counterAdmission }));
    expect(getOwnerCapability.mock.calls.map(call => call[0])).toEqual([false, false]); counterRuntime.close();
  });

  it('enforces Direct admission before owner prompts and passes the qualified policy to the shared client', async () => {
    const direct = CURRENT_P2P_BINDING.deployments['direct-v2'];
    const current = { ...history, deployments: { ...history.deployments, 'direct-v2': direct } };
    const getOwnerCapability = vi.fn(async () => ({} as never));
    const ownerFlowStarted = vi.fn();
    const runOwnerTransactionFlow = async <T,>(operation: () => Promise<T>): Promise<T> => { ownerFlowStarted(); return operation(); };
    const held = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow,
      directAdmission: { ...direct, mode: 'held' } });
    const action = { kind: 'create-private' as const, offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}`,
      offerAmount: 10n, requestAmount: 25n, taker: `0x${'33'.repeat(20)}`, expiresAt: 1_800_000_000n };
    await expect(held.direct(action)).rejects.toThrow(/activation/);
    expect(getOwnerCapability).not.toHaveBeenCalled(); expect(ownerFlowStarted).not.toHaveBeenCalled();
    expect(mocks.ensureDirect).not.toHaveBeenCalled(); expect(mocks.submitDirect).not.toHaveBeenCalled(); held.close();
    const directAdmission = { ...direct, mode: 'private-forward' as const };
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow, directAdmission });
    await runtime.direct(action);
    expect(mocks.ensureDirect).toHaveBeenCalledWith(expect.objectContaining({ actionAdmission: directAdmission }));
    expect(mocks.submitDirect).toHaveBeenCalledWith(expect.objectContaining({ actionAdmission: directAdmission }));
    await expect(runtime.direct({ ...action, kind: 'counter-private', parentTradeId: 1n })).rejects.toThrow(/not ready/);
    expect(getOwnerCapability).toHaveBeenCalledOnce(); runtime.close();
    const counterAdmission = { ...directAdmission, privateCounter: true };
    const counterRuntime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow, directAdmission: counterAdmission });
    const counter = { ...action, kind: 'counter-private' as const, parentTradeId: 7n };
    await counterRuntime.direct(counter);
    expect(mocks.ensureDirect).toHaveBeenLastCalledWith(expect.objectContaining({ action: counter, actionAdmission: counterAdmission }));
    expect(mocks.submitDirect).toHaveBeenLastCalledWith(expect.objectContaining({ action: counter, actionAdmission: counterAdmission }));
    await expect(counterRuntime.direct({ ...counter, kind: 'counter-public' } as never)).rejects.toThrow(/not ready/);
    expect(getOwnerCapability).toHaveBeenCalledTimes(2); counterRuntime.close();
  });

  it('does not request the owner after a queued Direct action runtime closes', async () => {
    const getOwnerCapability = vi.fn(async () => ({} as never));
    let release!: () => void, entered!: () => void;
    const queued = new Promise<void>(resolve => { entered = resolve; });
    const runOwnerTransactionFlow = <T,>(operation: () => Promise<T>) => new Promise<T>((resolve, reject) => {
      release = () => { void operation().then(resolve, reject); }; entered();
    });
    const runtime = createOtcV2ActionRuntime({ history: history as never, getOwnerCapability, runOwnerTransactionFlow });
    const pending = runtime.direct({ kind: 'cancel', tradeId: 1n });
    await queued; runtime.close();
    const result = expect(pending).rejects.toThrow(/closed/); release(); await result;
    expect(getOwnerCapability).not.toHaveBeenCalled();
  });
  it('does not submit Direct custody if the runtime closes during its allowance step', async () => {
    const getOwnerCapability = vi.fn(async () => ({} as never));
    const runtime = createOtcV2ActionRuntime({ history: history as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation() });
    mocks.ensureDirect.mockImplementationOnce(async () => { runtime.close(); });
    await expect(runtime.direct({ kind: 'cancel', tradeId: 1n })).rejects.toThrow(/closed/);
    expect(mocks.submitDirect).not.toHaveBeenCalled();
  });
  it('uses the admitted Book Counter path without a Link creation session and captures the reviewed reference', async () => {
    const owner = `0x${'44'.repeat(20)}`, book = CURRENT_P2P_BINDING.deployments['private-v2'];
    const current = { ...history, ownerAddress: owner, readCapability: {}, deployments: { ...history.deployments,
      'standard-v2': CURRENT_P2P_BINDING.deployments['standard-v2'], 'private-v2': book } };
    mocks.assertHistory.mockReturnValue(current); mocks.ownerBinding.mockReturnValue({ ownerAddress: owner });
    const capability = {} as never;
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability: async () => capability,
      runOwnerTransactionFlow: operation => operation(), counterCreation: { deployment: CURRENT_P2P_BINDING.deployments['counter-v2'] as never,
        journal: { read: vi.fn(async () => null), close: vi.fn() } as never } });
    const bookReference = { chainId: book.chainId, escrow: book.contractAddress, id: '1', revision: '2', credentialEpoch: '0' };
    const submitted = runtime.counter!.propose({ bookReference, maker: owner, offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}` }, { offer: '4', request: '5', expiresAt: '0' });
    bookReference.revision = '99'; await submitted;
    expect(mocks.executeCounter).toHaveBeenCalledWith(expect.objectContaining({ parentDeployment: book,
      parent: { bookReference: expect.objectContaining({ revision: '2' }), maker: owner,
        offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}` } }));
    runtime.close();
  });
  const rootFixture = (status: 'prepared' | 'book-admitted' | 'admitted' = 'admitted', linkAdmitted = false) => {
    const descriptors = Object.fromEntries(Object.entries(CURRENT_P2P_BINDING.deployments).map(([p, manifest]) => [p, { protocol: p, manifest }]));
    const current = { ...history, isCurrent: (): boolean => true, ownerAddress: `0x${'44'.repeat(20)}`, readCapability: {}, deployments: { ...history.deployments,
      'standard-v2': CURRENT_P2P_BINDING.deployments['standard-v2'], 'private-v2': CURRENT_P2P_BINDING.deployments['private-v2'], 'direct-v2': CURRENT_P2P_BINDING.deployments['direct-v2'] } };
    const retainedDeployments = Object.fromEntries((['standard-v2', 'private-v2', 'direct-v2'] as const).map((protocol, index) => [protocol,
      { protocol, manifest: { ...CURRENT_P2P_BINDING.deployments[protocol], contractAddress: `0x${String(70 + index).repeat(20)}`,
        ...(protocol === 'private-v2' ? { runtimeBytecodeHash: '0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680' } : {}) } }]));
    const catalog = { status: 'active', chainId: '7082400', finalityLagBlocks: 5n,
      preparedP2p: { status, linkAdmitted, deployments: descriptors, retainedDeployments } };
    const getOwnerCapability = vi.fn(async () => ({} as never));
    mocks.ownerBinding.mockReturnValue({ ownerAddress: current.ownerAddress, chainId: 7082400n });
    mocks.attest.mockImplementation(async ({ manifest }) => manifest);
    mocks.createJournal.mockImplementation(() => ({ close: vi.fn() }));
    return { current, catalog, getOwnerCapability, input: { history: current as never, catalog: catalog as never, getOwnerCapability,
      runOwnerTransactionFlow: async <T,>(operation: () => Promise<T>) => operation() } };
  };

  it('keeps history syncs serial without blocking owner reads or a safe Direct action', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { privateCounterAdmitted: true, privateCounterRecoveryAdmitted: true });
    let startLink!: () => void, releaseLink!: () => void;
    const linkStarted = new Promise<void>(resolve => { startLink = resolve; });
    const heldLinkSync = new Promise<Readonly<{ orders: readonly unknown[]; history: readonly unknown[]; complete: boolean }>>(resolve => {
      releaseLink = () => resolve({ orders: [], history: [], complete: true });
    });
    mocks.createActivity.mockReturnValue({ sync: mocks.syncActivity, close: mocks.closeActivity });
    mocks.createCounterActivity.mockReturnValue({ sync: mocks.syncCounterActivity, close: mocks.closeCounterActivity });
    mocks.syncActivity.mockImplementationOnce(async () => { startLink(); return heldLinkSync; });
    mocks.syncCounterActivity.mockResolvedValue({ orders: [], history: [], complete: true });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const linkSync = runtime.link!.syncActivity();
    let counterSync: Promise<unknown> | undefined;
    let standardRead: Promise<unknown> | undefined;
    let recurringRead: Promise<unknown> | undefined;
    let directAction: Promise<unknown> | undefined;
    try {
      await linkStarted;
      counterSync = runtime.counter!.syncActivity();
      standardRead = runtime.listStandard('open', 0n, 20n);
      recurringRead = runtime.listRecurring('active', 0n, 20n);
      directAction = runtime.direct({ kind: 'cancel', tradeId: 3n });
      const ownerOperations = Promise.all([standardRead, recurringRead, directAction]);
      const ownerOperationsSettled = await Promise.race([
        ownerOperations.then(() => true),
        oneMacrotask().then(() => false)
      ]);

      expect(ownerOperationsSettled).toBe(true);
      expect(mocks.listStandard).toHaveBeenCalled();
      expect(mocks.listRecurring).toHaveBeenCalled();
      expect(mocks.confirmDirect).toHaveBeenCalled();
      expect(mocks.syncCounterActivity).not.toHaveBeenCalled();
    } finally {
      releaseLink();
      await Promise.allSettled([linkSync, ...(counterSync ? [counterSync] : []),
        ...(standardRead ? [standardRead] : []), ...(recurringRead ? [recurringRead] : []),
        ...(directAction ? [directAction] : [])]);
      runtime.close();
    }
    expect(mocks.syncCounterActivity).toHaveBeenCalledOnce();
  });

  it('keeps ordinary owner reads and writes serialized', async () => {
    let startRead!: () => void, releaseRead!: () => void;
    const readStarted = new Promise<void>(resolve => { startRead = resolve; });
    const heldRead = new Promise<Readonly<{ tradeIds: readonly string[]; nextOffset: string }>>(resolve => {
      releaseRead = () => resolve({ tradeIds: [], nextOffset: '0' });
    });
    mocks.listStandard.mockImplementationOnce(async () => { startRead(); return heldRead; });
    const runtime = createOtcV2ActionRuntime({ history: history as never,
      getOwnerCapability: async () => Object.freeze({}) as never,
      runOwnerTransactionFlow: operation => operation() });
    const read = runtime.listStandard('open', 0n, 20n);
    let action: Promise<unknown> | undefined;
    try {
      await readStarted;
      action = runtime.direct({ kind: 'cancel', tradeId: 3n });
      await oneMacrotask();
      expect(mocks.confirmDirect).not.toHaveBeenCalled();
    } finally {
      releaseRead();
      await Promise.allSettled([read, ...(action ? [action] : [])]);
      runtime.close();
    }
    expect(mocks.confirmDirect).toHaveBeenCalledOnce();
  });

  it('keeps history capability acquisition behind a held owner action', async () => {
    const actionEntered = deferred<void>(), releaseAction = deferred<void>();
    const { runtime, getOwnerCapability } = createActivityRuntime({
      runOwnerTransactionFlow: async operation => {
        actionEntered.resolve();
        await releaseAction.promise;
        return operation();
      }
    });
    const ownerAction = runtime.direct({ kind: 'cancel', tradeId: 5n });
    let ownerRead: Promise<unknown> | undefined, linkSync: Promise<unknown> | undefined;
    try {
      await actionEntered.promise;
      const capabilitiesBeforeQueue = getOwnerCapability.mock.calls.length;
      ownerRead = runtime.listStandard('open', 0n, 20n);
      linkSync = runtime.link!.syncActivity();
      await oneMacrotask();

      expect(getOwnerCapability).toHaveBeenCalledTimes(capabilitiesBeforeQueue);
      expect(mocks.listStandard).not.toHaveBeenCalled();
      expect(mocks.syncActivity).not.toHaveBeenCalled();
    } finally {
      releaseAction.resolve();
      await Promise.allSettled([ownerAction, ...(ownerRead ? [ownerRead] : []), ...(linkSync ? [linkSync] : [])]);
      runtime.close();
    }
    expect(mocks.listStandard).toHaveBeenCalledOnce();
    expect(mocks.syncActivity).toHaveBeenCalledOnce();
  });

  it('does not acquire an owner for queued history after the runtime closes', async () => {
    const actionEntered = deferred<void>(), releaseAction = deferred<void>();
    const { runtime, getOwnerCapability } = createActivityRuntime({
      runOwnerTransactionFlow: async operation => {
        actionEntered.resolve();
        await releaseAction.promise;
        return operation();
      }
    });
    const ownerAction = runtime.direct({ kind: 'cancel', tradeId: 6n });
    let linkSync: Promise<unknown> | undefined, counterSync: Promise<unknown> | undefined;
    try {
      await actionEntered.promise;
      const capabilitiesBeforeQueue = getOwnerCapability.mock.calls.length;
      linkSync = runtime.link!.syncActivity();
      counterSync = runtime.counter!.syncActivity();
      runtime.close();
      releaseAction.resolve();

      await Promise.all([
        expect(linkSync).rejects.toThrow(/closed/),
        expect(counterSync).rejects.toThrow(/closed/),
        expect(ownerAction).rejects.toThrow(/closed/)
      ]);
      expect(getOwnerCapability).toHaveBeenCalledTimes(capabilitiesBeforeQueue);
      expect(mocks.syncActivity).not.toHaveBeenCalled();
      expect(mocks.syncCounterActivity).not.toHaveBeenCalled();
    } finally {
      releaseAction.resolve();
      await Promise.allSettled([ownerAction, ...(linkSync ? [linkSync] : []), ...(counterSync ? [counterSync] : [])]);
      runtime.close();
    }
  });

  it('rejects a stale capability before starting a history scan', async () => {
    const { runtime } = createActivityRuntime();
    mocks.assertCapabilitySnapshot.mockRejectedValueOnce(new Error('stale owner capability'));
    try {
      await expect(runtime.link!.syncActivity()).rejects.toThrow('stale owner capability');
      expect(mocks.syncActivity).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it('releases the history queue after a stale current scan so Counter can finish', async () => {
    const currentScanStarted = deferred<void>(), releaseCurrentScan = deferred<void>();
    const { runtime } = createActivityRuntime();
    mocks.syncActivity.mockImplementationOnce(async () => {
      currentScanStarted.resolve();
      await releaseCurrentScan.promise;
      return { orders: [], history: [], complete: true };
    });
    mocks.assertCapabilitySnapshot
      .mockImplementationOnce(() => {})
      .mockRejectedValueOnce(new Error('stale owner capability'));
    mocks.syncCounterActivity.mockResolvedValue({ orders: [], history: [], complete: true });
    const linkSync = runtime.link!.syncActivity();
    let counterSync: Promise<unknown> | undefined;
    try {
      await currentScanStarted.promise;
      counterSync = runtime.counter!.syncActivity();
      expect(mocks.syncCounterActivity).not.toHaveBeenCalled();
      releaseCurrentScan.resolve();

      await expect(linkSync).rejects.toThrow('stale owner capability');
      await expect(counterSync).resolves.toMatchObject({ complete: true });
      expect(mocks.syncCounterActivity).toHaveBeenCalledOnce();
    } finally {
      releaseCurrentScan.resolve();
      await Promise.allSettled([linkSync, ...(counterSync ? [counterSync] : [])]);
      runtime.close();
    }
  });

  it('rejects a close during retained Link history and releases the queued Counter scan', async () => {
    const retainedStarted = deferred<void>(), releaseRetained = deferred<readonly unknown[]>();
    const { runtime } = createActivityRuntime({
      readRetainedLinkActivity: async () => {
        retainedStarted.resolve();
        return releaseRetained.promise;
      }
    });
    mocks.syncActivity.mockResolvedValueOnce({ orders: [], history: [], complete: true });
    const linkSync = runtime.link!.syncActivity();
    let counterSync: Promise<unknown> | undefined;
    try {
      await retainedStarted.promise;
      counterSync = runtime.counter!.syncActivity();
      runtime.close();
      releaseRetained.resolve([]);

      await expect(linkSync).rejects.toThrow(/closed during a scan/);
      await expect(counterSync).rejects.toThrow(/closed/);
      expect(mocks.syncCounterActivity).not.toHaveBeenCalled();
    } finally {
      releaseRetained.resolve([]);
      await Promise.allSettled([linkSync, ...(counterSync ? [counterSync] : [])]);
      runtime.close();
    }
  });

  it('retains the complete old financial graph and Counter parents without inheriting new disclosure admission', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { privateCounterAdmitted: true, privateCounterRecoveryAdmitted: true, publicBookLinkAdmitted: true, publicBookLinkRecoveryAdmitted: true });
    const old = Object.values(CURRENT_P2P_BINDING.deployments).map((manifest, index) => ({ ...manifest, contractAddress: `0x${String(80 + index).repeat(20)}` }));
    const financialGraph = { previousBindingSha256: 'ab'.repeat(32), proofSha256: 'cd'.repeat(32), deployments: old };
    Object.assign(f.catalog.preparedP2p.retainedDeployments, Object.fromEntries(old.map(manifest => [manifest.contractAddress,
      { protocol: manifest.protocol, manifest, retainedFinancialGraph: financialGraph }])));
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const children = await Promise.all(old.map(manifest => runtime.forReference!({ ...manifest, orderId: '1' })));
    expect(new Set(children).size).toBe(1);
    expect(mocks.attestBatch).toHaveBeenCalledTimes(2);
    expect(mocks.attestBatch).toHaveBeenLastCalledWith({ capability: f.current.readCapability, manifests: old, finalityLagBlocks: 5n });
    const child = children[0], book = old.find(item => item.protocol === 'private-v2')!;
    expect(child.deployments['standard-v2']).toEqual(old.find(item => item.protocol === 'standard-v2'));
    expect(child.deployments['private-v2']).toEqual(book);
    expect(child.deployments['direct-v2']).toEqual(old.find(item => item.protocol === 'direct-v2'));
    expect(child.link?.readContext.deployment).toEqual(old.find(item => item.protocol === 'link-v2'));
    expect(child.privateBook?.budgetVisibilityAvailable).toBe(false);
    for (const balance of Object.values(child.tradeBalances)) expect(balance.available).toBe(false);
    await child.counter!.propose({ bookReference: { chainId: book.chainId, escrow: book.contractAddress, id: '1', revision: '1', credentialEpoch: '0' },
      maker: f.current.ownerAddress, offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}` }, { offer: '1', request: '2', expiresAt: '0' });
    expect(mocks.executeCounter).toHaveBeenCalledWith(expect.objectContaining({ deployment: old.find(item => item.protocol === 'counter-v2'),
      parentDeployments: expect.arrayContaining(old.filter(item => ['standard-v2', 'private-v2', 'link-v2'].includes(item.protocol))) }));
    runtime.close(); expect(child.isCurrent()).toBe(false);
  });
  it('checks public-only Direct identity at root setup before acquiring an owner capability', async () => {
    const f = rootFixture('book-admitted'), direct = CURRENT_P2P_BINDING.deployments['direct-v2'];
    Object.assign(f.catalog.preparedP2p, { directAdmission: { ...direct, mode: 'public-forward', publicForward: true } });
    const wrong = { ...f.current, deployments: { ...f.current.deployments,
      'direct-v2': { ...direct, runtimeBytecodeHash: `0x${'12'.repeat(32)}` } } };
    await expect(createOtcV2ActionRuntimeFromCatalog({ ...f.input, history: wrong as never })).rejects.toThrow(/graph/);
    expect(f.getOwnerCapability).not.toHaveBeenCalled();
  });

  it('connects the separately verified Link client without opening Counter or changing owner signing', async () => {
    const f = rootFixture('book-admitted', true), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.link?.readContext.deployment).toEqual(CURRENT_P2P_BINDING.deployments['link-v2']);
    expect(runtime.counter).toBeUndefined(); expect(runtime.privateBook).toBeDefined();
    expect(mocks.attest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ manifest: CURRENT_P2P_BINDING.deployments['link-v2'] }));
    expect(f.getOwnerCapability).toHaveBeenCalledExactlyOnceWith(false);
    await runtime.link!.ownerOrderAction({ kind: 'cancel', orderId: '7' });
    expect(f.getOwnerCapability).toHaveBeenLastCalledWith(true);
    expect(mocks.executeLinkOwner).toHaveBeenCalledWith(expect.objectContaining({ orderId: '7', deployment: CURRENT_P2P_BINDING.deployments['link-v2'] }));
    runtime.close();
  });
  it('connects qualified private Counter without full-graph admission and blocks public wallet requests', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { privateCounterAdmitted: true, privateCounterRecoveryAdmitted: true });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.counter?.privateOnly).toBe(true);
    const before = f.getOwnerCapability.mock.calls.length;
    expect(() => runtime.counter!.propose({ terms: { privatePair: false } } as never, { offer: '1', request: '1', expiresAt: '0' })).toThrow(/Public counter/);
    expect(() => runtime.counter!.propose({ bookReference: { chainId: '7082400', escrow: CURRENT_P2P_BINDING.deployments['standard-v2'].contractAddress,
      id: '1', revision: '1', credentialEpoch: '0' }, maker: f.current.ownerAddress, offerToken: `0x${'11'.repeat(20)}`,
      requestToken: `0x${'22'.repeat(20)}` }, { offer: '1', request: '1', expiresAt: '0' })).toThrow(/Public counter/);
    expect(() => runtime.counter!.recipientAction({ privatePair: false } as never, 'accept')).toThrow(/Public counter/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(before); expect(mocks.executeCounter).not.toHaveBeenCalled();
    await runtime.counter!.propose({ bookReference: { chainId: '7082400', escrow: CURRENT_P2P_BINDING.deployments['private-v2'].contractAddress,
      id: '1', revision: '1', credentialEpoch: '0' }, maker: f.current.ownerAddress, offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}` }, { offer: '1', request: '1', expiresAt: '0' });
    expect(mocks.executeCounter).toHaveBeenCalledWith(expect.objectContaining({ privateOnly: true }));
    runtime.close();
  });

  it('connects public Counter independently and keeps private funding held before wallet access', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { publicBookLinkAdmitted: true, publicBookLinkRecoveryAdmitted: true });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.counter).toMatchObject({ privateOnly: false, publicOnly: true, recoveryOnly: false });
    const before = f.getOwnerCapability.mock.calls.length;
    expect(() => runtime.counter!.propose({ terms: { privatePair: true } } as never, { offer: '1', request: '1', expiresAt: '0' })).toThrow(/Private counteroffers/);
    expect(() => runtime.counter!.recipientAction({ privatePair: true } as never, 'accept')).toThrow(/Private counteroffers/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(before);
    await runtime.counter!.propose({ terms: { privatePair: false } } as never, { offer: '1', request: '1', expiresAt: '0' });
    expect(mocks.executeCounter).toHaveBeenCalledWith(expect.objectContaining({ privateOnly: false, publicOnly: true }));
    runtime.close();
  });

  it('holds public Book funding and Link funding before wallet access while retaining exits', async () => {
    const f = rootFixture('book-admitted', true), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const before = f.getOwnerCapability.mock.calls.length;
    expect(() => runtime.standard({ kind: 'create' } as never)).toThrow(/Public Book.*activation/);
    await expect(runtime.link!.create({ terms: { privatePair: false } } as never)).rejects.toThrow(/Public Link.*activation/);
    await expect(runtime.link!.fill({ terms: { privatePair: false } } as never, '1')).rejects.toThrow(/Public Link.*activation/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(before);
    await runtime.standard({ kind: 'cancel', tradeId: '1' });
    await runtime.link!.ownerOrderAction({ kind: 'cancel', orderId: '1' });
    expect(mocks.submitStandard).toHaveBeenCalled(); expect(mocks.executeLinkOwner).toHaveBeenCalled();
    runtime.close();
  });

  it('admits public Book creation and fill while keeping replacement held', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { publicBookLinkAdmitted: true, publicBookLinkRecoveryAdmitted: true });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    await runtime.standard({ kind: 'create' } as never);
    await runtime.standard({ kind: 'fill' } as never);
    await runtime.link!.create({ terms: { privatePair: false } } as never);
    await runtime.link!.fill({ terms: { privatePair: false } } as never, '1');
    const before = f.getOwnerCapability.mock.calls.length;
    expect(() => runtime.standard({ kind: 'replace' } as never)).toThrow(/replacement.*not ready/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(before);
    expect(mocks.submitStandard.mock.calls.slice(-2).map(([input]) => input.action.kind)).toEqual(['create', 'fill']);
    runtime.close();
  });

  it.each([false, true])('checks saved Link continuation mode before wallet access, private=%s', async privatePair => {
    const f = rootFixture('book-admitted', true);
    mocks.createJournal.mockReturnValue({ close: vi.fn(), read: vi.fn(async () => ({ recovery: { terms: { privatePair } }, fill: { terms: { privatePair } } })) });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input), before = f.getOwnerCapability.mock.calls.length;
    if (privatePair) {
      await runtime.link!.continueCreation('saved'); await runtime.link!.continueFill('saved');
      expect(mocks.continueLink).toHaveBeenCalled(); expect(mocks.continueFill).toHaveBeenCalled();
    } else {
      await expect(runtime.link!.continueCreation('saved')).rejects.toThrow(/Public Link.*activation/);
      await expect(runtime.link!.continueFill('saved')).rejects.toThrow(/Public Link.*activation/);
      expect(f.getOwnerCapability).toHaveBeenCalledTimes(before);
      expect(mocks.continueLink).not.toHaveBeenCalled(); expect(mocks.continueFill).not.toHaveBeenCalled();
    }
    runtime.close();
  });

  it('keeps Counter reads and exits available while recovery-only admission blocks new wallet requests', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { privateCounterAdmitted: false, privateCounterRecoveryAdmitted: true });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.counter).toMatchObject({ privateOnly: true, recoveryOnly: true });
    expect(runtime.counter!.balance).toMatchObject({ available: false });
    const before = f.getOwnerCapability.mock.calls.length;
    expect(() => runtime.counter!.propose({ terms: { privatePair: true } } as never, { offer: '1', request: '1', expiresAt: '0' })).toThrow(/Counter trading is not enabled/);
    expect(() => runtime.counter!.recipientAction({ privatePair: true } as never, 'accept')).toThrow(/Counter trading is not enabled/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(before);
    expect(mocks.executeCounter).not.toHaveBeenCalled();
    await runtime.counter!.read('1');
    await runtime.counter!.cancel('1');
    await runtime.counter!.recipientAction({ privatePair: false } as never, 'decline');
    await runtime.counter!.cleanup();
    await runtime.counter!.reconcile();
    expect(mocks.readCounter).toHaveBeenCalledWith(expect.objectContaining({ proposalId: '1', recoveryOnly: true }));
    expect(mocks.cancelCounter).toHaveBeenCalledWith(expect.objectContaining({ proposalId: '1', recoveryOnly: true }));
    expect(mocks.recipientCounter).toHaveBeenCalledWith(expect.objectContaining({ kind: 'decline', recoveryOnly: true }));
    expect(mocks.cleanupCounter).toHaveBeenCalledWith(expect.objectContaining({ recoveryOnly: true }));
    expect(mocks.reconcileCounter).toHaveBeenCalledWith(expect.objectContaining({ recoveryOnly: true }));
    runtime.close();
  });

  const oldLink = { protocol: 'link-v2' as const, chainId: '7082400', contractAddress: '0xcdf70597ebd1e4eb440e292a23003d129d9c5859',
    deploymentBlock: '10225108', runtimeBytecodeHash: '0x074062a395d26e4f421f5b75a4b6f96f206996285fdd56566d96576ce41ff384' };
  it('discovers retained Counter activity and resolves equal IDs to their exact financial child', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p, { privateCounterAdmitted: true, privateCounterRecoveryAdmitted: true });
    const old = Object.values(CURRENT_P2P_BINDING.deployments).map((manifest, index) => ({ ...manifest, contractAddress: `0x${String(80 + index).repeat(20)}` }));
    const financialGraph = { previousBindingSha256: 'ab'.repeat(32), proofSha256: 'cd'.repeat(32), deployments: old };
    Object.assign(f.catalog.preparedP2p.retainedDeployments, Object.fromEntries(old.map(manifest => [manifest.contractAddress,
      { protocol: manifest.protocol, manifest, retainedFinancialGraph: financialGraph }])));
    const oldCounter = old.find(item => item.protocol === 'counter-v2')!;
    mocks.createCounterActivity.mockImplementation(({ deployment }) => ({ close: vi.fn(), sync: async () => ({
      orders: [{ chainId: deployment.chainId, escrow: deployment.contractAddress, id: '1', maker: f.current.ownerAddress,
        taker: `0x${'55'.repeat(20)}`, offerToken: `0x${'11'.repeat(20)}`, requestToken: `0x${'22'.repeat(20)}`,
        privatePair: true, expiresAt: '0', status: 1 }], history: [], complete: true, throughBlock: '50', safeHead: '50'
    }) }));
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const result = await runtime.counter!.syncActivity();
    expect(result.orders.map(row => row.escrow)).toEqual([CURRENT_P2P_BINDING.deployments['counter-v2'].contractAddress, oldCounter.contractAddress]);
    expect(result.orders.map(row => row.id)).toEqual(['1', '1']);
    const selected = await runtime.counter!.forReference!({ chainId: oldCounter.chainId, escrow: oldCounter.contractAddress, id: '1' });
    const child = await runtime.forReference!({ chainId: oldCounter.chainId, contractAddress: oldCounter.contractAddress, orderId: '1' });
    expect(selected).toBe(child.counter);
    await selected.cancel('1');
    expect(mocks.cancelCounter).toHaveBeenCalledWith(expect.objectContaining({ deployment: oldCounter,
      parentDeployments: expect.arrayContaining(old.filter(item => ['link-v2', 'private-v2', 'standard-v2'].includes(item.protocol))) }));
    expect(selected.balance?.available).toBe(false);
    expect(() => selected.balance!.read('1')).toThrow();
    await expect(runtime.counter!.forReference!({ chainId: '1', escrow: oldCounter.contractAddress, id: '1' })).rejects.toThrow();
    runtime.close();
  });

  it('opens retained Link review lazily under its exact old identity without a signing journal', async () => {
    const f = rootFixture('book-admitted');
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { oldLink: { protocol: 'link-v2', manifest: oldLink } });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const reference = { chainId: oldLink.chainId, escrow: oldLink.contractAddress, id: '1', revision: '1', credentialEpoch: '1' };
    const [a, b] = await Promise.all([runtime.resolveLinkReadContext!(reference), runtime.resolveLinkReadContext!(reference)]);
    expect(a).toBe(b); expect(a.deployment).toEqual(oldLink);
    expect(mocks.attest).toHaveBeenCalledTimes(1); expect(mocks.createJournal).not.toHaveBeenCalled();
    expect(f.getOwnerCapability).not.toHaveBeenCalled(); runtime.close();
  });

  it('routes retained Link cancellation to its own journal and blocks new creation or Fill there', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { oldLink: { protocol: 'link-v2', manifest: oldLink } });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const child = await runtime.forReference!({ chainId: oldLink.chainId, contractAddress: oldLink.contractAddress, orderId: '1' });
    expect(child.link?.readContext.deployment).toEqual(oldLink);
    await child.link!.ownerOrderAction({ orderId: '1', kind: 'cancel' });
    expect(mocks.executeLinkOwner).toHaveBeenCalledWith(expect.objectContaining({ orderId: '1', deployment: oldLink }));
    await expect(child.link!.create({} as never)).rejects.toThrow(/retained|recovery/i);
    await expect(child.link!.fill({} as never, '1')).rejects.toThrow(/retained|recovery/i);
    await expect(child.link!.continueFill('old')).rejects.toThrow(/retained|recovery/i);
    await expect(child.link!.continueCreation('old')).rejects.toThrow(/retained|recovery/i);
    expect(mocks.executeLink).not.toHaveBeenCalled(); expect(mocks.executeFill).not.toHaveBeenCalled();
    runtime.close(); expect(child.isCurrent()).toBe(false);
  });

  it('includes retained Link activity through its scoped reader without merging equal order IDs', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { oldLink: { protocol: 'link-v2', manifest: oldLink } });
    const closed = vi.fn();
    mocks.createActivity.mockImplementation(({ deployment }) => ({ close: closed, sync: async () => ({
      orders: [{ reference: { chainId: deployment.chainId, escrow: deployment.contractAddress, id: '1', revision: '1', credentialEpoch: '1' } }],
      history: [{ chainId: deployment.chainId, escrow: deployment.contractAddress, orderId: '1', key: deployment.contractAddress + ':0x1', blockNumber: '50' }],
      complete: deployment.contractAddress !== oldLink.contractAddress, throughBlock: '50', safeHead: '50', phase: 'scan'
    }) }));
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input), result = await runtime.link!.syncActivity();
    expect(result.orders.map(row => row.reference.escrow)).toEqual([CURRENT_P2P_BINDING.deployments['link-v2'].contractAddress, oldLink.contractAddress]);
    expect(result.history).toHaveLength(2); expect(result.complete).toBe(false);
    expect(mocks.createActivity).toHaveBeenCalledTimes(2); expect(mocks.executeLink).not.toHaveBeenCalled();
    runtime.close(); expect(closed).toHaveBeenCalledTimes(2);
  });

  it('rejects a retained Link lookup closed during attestation before another owner capability is requested', async () => {
    const f = rootFixture('book-admitted', true);
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { oldLink: { protocol: 'link-v2', manifest: oldLink } });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    let release!: (value: typeof oldLink) => void;
    mocks.attest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = runtime.forReference!({ chainId: oldLink.chainId, contractAddress: oldLink.contractAddress, orderId: '1' });
    runtime.close(); release(oldLink);
    await expect(pending).rejects.toThrow(/closed/);
    expect(f.getOwnerCapability).toHaveBeenCalledTimes(1);
    expect(mocks.createJournal).toHaveBeenCalledTimes(1);
  });

  it('keeps prepared root setup free of new RPC admission, journal access and wallet prompts', async () => {
    const f = rootFixture('prepared');
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.link).toBeUndefined(); expect(runtime.counter).toBeUndefined();
    expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.createJournal).not.toHaveBeenCalled();
    expect(f.getOwnerCapability).not.toHaveBeenCalled(); runtime.close();
  });

  it('connects the repaired Book and retained exits without activating Link or Counter clients', async () => {
    const f = rootFixture('book-admitted');
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.deployments['private-v2']).toEqual(CURRENT_P2P_BINDING.deployments['private-v2']);
    expect(runtime.privateBook).toBeDefined();
    expect(runtime.link).toBeUndefined(); expect(runtime.counter).toBeUndefined();
    expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.createJournal).not.toHaveBeenCalled();
    expect(f.getOwnerCapability).not.toHaveBeenCalled();
    const old = f.catalog.preparedP2p.retainedDeployments['private-v2'].manifest;
    const child = await runtime.forReference!({ ...old, orderId: '1' });
    await child.privateTrade({ kind: 'cancel', orderId: '1' });
    expect(mocks.executePrivate.mock.lastCall?.[0].deployment).toEqual(old);
    runtime.close(); expect(child.isCurrent()).toBe(false);
  });

  it('opens exact shared-Link review lazily while all Link and Counter writes remain held', async () => {
    const f = rootFixture('book-admitted');
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(mocks.attest).not.toHaveBeenCalled();
    const manifest = CURRENT_P2P_BINDING.deployments['link-v2'];
    const reference = { chainId: manifest.chainId, escrow: manifest.contractAddress,
      id: ((1n << 256n) - 1n).toString(), revision: '1', credentialEpoch: '1' };
    const [one, two] = await Promise.all([runtime.resolveLinkReadContext!(reference), runtime.resolveLinkReadContext!(reference)]);
    expect(one).toBe(two); expect(one.deployment).toEqual(manifest); expect(one.capability).toBe(f.current.readCapability);
    expect(mocks.attest).toHaveBeenCalledExactlyOnceWith({ capability: f.current.readCapability, manifest, finalityLagBlocks: 5n });
    expect(runtime.link).toBeUndefined(); expect(runtime.counter).toBeUndefined();
    expect(mocks.createJournal).not.toHaveBeenCalled(); expect(f.getOwnerCapability).not.toHaveBeenCalled();
    runtime.close(); await expect(runtime.resolveLinkReadContext!(reference)).rejects.toThrow(/closed/);
  });

  it('rejects wrong shared-Link identity and invalid full-width references before admission', async () => {
    const f = rootFixture('book-admitted'), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const manifest = CURRENT_P2P_BINDING.deployments['link-v2'];
    const reference = { chainId: manifest.chainId, escrow: manifest.contractAddress, id: '1', revision: '1', credentialEpoch: '1' };
    for (const changed of [{ chainId: '1' }, { escrow: `0x${'55'.repeat(20)}` }, { id: '0' }, { id: (1n << 256n).toString() }, { credentialEpoch: '0' }])
      await expect(runtime.resolveLinkReadContext!({ ...reference, ...changed })).rejects.toThrow();
    expect(mocks.attest).not.toHaveBeenCalled(); expect(f.getOwnerCapability).not.toHaveBeenCalled(); runtime.close();
  });

  it('permits an explicit Link review retry after admission failure and rejects a late result on close', async () => {
    const f = rootFixture('book-admitted'), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const manifest = CURRENT_P2P_BINDING.deployments['link-v2'];
    const reference = { chainId: manifest.chainId, escrow: manifest.contractAddress, id: '1', revision: '1', credentialEpoch: '1' };
    mocks.attest.mockRejectedValueOnce(new Error('Link admission unavailable'));
    await expect(runtime.resolveLinkReadContext!(reference)).rejects.toThrow(/admission unavailable/);
    expect(mocks.attest).toHaveBeenCalledOnce();
    await expect(runtime.resolveLinkReadContext!(reference)).resolves.toEqual({ capability: f.current.readCapability, deployment: manifest });
    expect(mocks.attest).toHaveBeenCalledTimes(2); runtime.close();
    const next = rootFixture('book-admitted'), other = await createOtcV2ActionRuntimeFromCatalog(next.input);
    let release!: () => void;
    mocks.attest.mockImplementationOnce(async ({ manifest }) => { await new Promise<void>(resolve => { release = resolve; }); return manifest; });
    const pending = other.resolveLinkReadContext!(reference); other.close(); release();
    await expect(pending).rejects.toThrow(/closed/);
  });

  it('reuses the admitted Link read context without another attestation or wallet acquisition', async () => {
    const f = rootFixture(), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const manifest = CURRENT_P2P_BINDING.deployments['link-v2'];
    const context = await runtime.resolveLinkReadContext!({ chainId: manifest.chainId, escrow: manifest.contractAddress,
      id: '1', revision: '1', credentialEpoch: '1' });
    expect(context).toBe(runtime.link!.readContext); expect(mocks.attest).toHaveBeenCalledTimes(2);
    expect(f.getOwnerCapability).toHaveBeenCalledOnce(); runtime.close();
  });

  it('wires exact admitted Link/Counter contexts and journals into the existing owner runtime', async () => {
    const f = rootFixture();
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(assertOtcV2ActionRuntime(runtime)).toBe(runtime);
    expect(runtime.link?.readContext.deployment).toEqual(CURRENT_P2P_BINDING.deployments['link-v2']);
    expect(runtime.link?.readContext.capability).toBe(f.current.readCapability);
    expect(runtime.counter?.ownerAddress).toBe(f.current.ownerAddress);
    expect(f.getOwnerCapability).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.attest.mock.calls.map(([v]) => v.manifest.protocol)).toEqual(['link-v2', 'counter-v2']);
    expect(mocks.attestBatch).toHaveBeenCalledExactlyOnceWith({ capability: f.current.readCapability,
      manifests: [f.catalog.preparedP2p.deployments['link-v2'].manifest, f.catalog.preparedP2p.deployments['counter-v2'].manifest], finalityLagBlocks: 5n });
    expect(mocks.createJournal.mock.calls.map(([v]) => v.deployment.protocol)).toEqual(['link-v2', 'counter-v2']);
    const journals = mocks.createJournal.mock.results.map(v => v.value);
    runtime.close(); runtime.close();
    journals.forEach(j => expect(j.close).toHaveBeenCalledOnce());
  });

  it('selects each retained reader once by full reference, keeps writes on that instance and closes child runtimes', async () => {
    const f = rootFixture();
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    for (const protocol of ['standard-v2', 'private-v2', 'direct-v2'] as const) {
      const manifest = f.catalog.preparedP2p.retainedDeployments[protocol].manifest;
      const reference = { chainId: manifest.chainId, contractAddress: manifest.contractAddress, orderId: '7' };
      const child = await runtime.forReference!(reference);
      expect(await runtime.forReference!(reference)).toBe(child);
      expect(child.deployments[protocol]).toEqual(manifest);
      if (protocol === 'standard-v2') { await child.standard({ kind: 'cancel', tradeId: '7' }); expect(mocks.submitStandard.mock.lastCall?.[0].deployment).toEqual(manifest); }
      if (protocol === 'private-v2') { expect(child.privateBook).toBeUndefined(); await child.privateTrade({ kind: 'cancel', orderId: '7' }); expect(mocks.executePrivate.mock.lastCall?.[0].deployment).toEqual(manifest); }
      if (protocol === 'direct-v2') { await child.readDirect('7', false); expect(mocks.readDirect.mock.lastCall?.[0].deployment).toEqual(manifest); }
    }
    expect(mocks.attest).toHaveBeenCalledTimes(5);
    expect(mocks.createJournal).toHaveBeenCalledTimes(2);
    await expect(runtime.forReference!({ chainId: '1', contractAddress: CURRENT_P2P_BINDING.deployments['private-v2'].contractAddress, orderId: '7' })).rejects.toThrow(/reference/);
    await expect(runtime.forReference!({ chainId: '7082400', contractAddress: `0x${'99'.repeat(20)}`, orderId: '7' })).rejects.toThrow(/reference/);
    const retained = f.catalog.preparedP2p.retainedDeployments['standard-v2'].manifest;
    const child = await runtime.forReference!({ ...retained, orderId: '7' });
    runtime.close(); expect(child.isCurrent()).toBe(false);
    await expect(child.standard({ kind: 'cancel', tradeId: '7' })).rejects.toThrow(/closed/);
  });

  it('reuses retained history attestations for owner discovery and rejects a changed descriptor', async () => {
    const f = rootFixture(), old = f.catalog.preparedP2p.retainedDeployments['standard-v2'].manifest;
    const retainedDeployments = [old];
    const runtime = await createOtcV2ActionRuntimeFromCatalog({ ...f.input, history: { ...f.current, retainedDeployments } as never });
    expect(runtime.retainedDeployments).toBe(retainedDeployments);
    expect((await runtime.forReference!({ ...old, orderId: '7' })).deployments['standard-v2']).toBe(old);
    expect(mocks.attest).toHaveBeenCalledTimes(2);
    runtime.close();
    const mismatch = await createOtcV2ActionRuntimeFromCatalog({ ...f.input,
      history: { ...f.current, retainedDeployments: [{ ...old, runtimeBytecodeHash: `0x${'99'.repeat(32)}` }] } as never });
    await expect(mismatch.forReference!({ ...old, orderId: '7' })).rejects.toThrow(/identities differ/);
  });

  it('rejects a wrong graph before owner access and a different owner before opening journals', async () => {
    const f = rootFixture();
    const wrong = { ...f.current, deployments: { ...f.current.deployments, 'private-v2': { ...f.current.deployments['private-v2'], contractAddress: `0x${'99'.repeat(20)}` } } };
    await expect(createOtcV2ActionRuntimeFromCatalog({ ...f.input, history: wrong as never })).rejects.toThrow(/graph/);
    expect(f.getOwnerCapability).not.toHaveBeenCalled(); expect(mocks.attest).not.toHaveBeenCalled();
    mocks.ownerBinding.mockReturnValue({ ownerAddress: `0x${'55'.repeat(20)}`, chainId: 7082400n });
    await expect(createOtcV2ActionRuntimeFromCatalog(f.input)).rejects.toThrow(/owner/);
    expect(mocks.createJournal).not.toHaveBeenCalled();
  });

  it('closes a partially created journal if setup fails, and rejects a closed history before setup', async () => {
    const f = rootFixture(), close = vi.fn();
    mocks.createJournal.mockReset().mockReturnValueOnce({ close }).mockImplementationOnce(() => { throw new Error('journal unavailable'); });
    await expect(createOtcV2ActionRuntimeFromCatalog(f.input)).rejects.toThrow(/journal unavailable/);
    expect(close).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await expect(createOtcV2ActionRuntimeFromCatalog({ ...f.input, history: { ...f.current, isCurrent: () => false } as never })).rejects.toThrow(/closed/);
    expect(mocks.attest).not.toHaveBeenCalled(); expect(f.getOwnerCapability).not.toHaveBeenCalled();
  });

  it('does not create journals if history closes while the linked graph is being checked', async () => {
    const f = rootFixture();
    mocks.attest.mockImplementationOnce(async ({ manifest }) => { f.current.isCurrent = () => false; return manifest; });
    await expect(createOtcV2ActionRuntimeFromCatalog(f.input)).rejects.toThrow(/closed/);
    expect(mocks.createJournal).not.toHaveBeenCalled();
  });

  it('rejects pending retained selection on close and does not retry a failed reference admission', async () => {
    const f = rootFixture();
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    const old = f.catalog.preparedP2p.retainedDeployments['standard-v2'].manifest;
    const reference = { ...old, orderId: '7' };
    mocks.attest.mockRejectedValueOnce(new Error('reference admission unavailable'));
    await expect(runtime.forReference!(reference)).rejects.toThrow(/admission unavailable/);
    await expect(runtime.forReference!(reference)).rejects.toThrow(/admission unavailable/);
    expect(mocks.attest).toHaveBeenCalledTimes(3);
    const next = f.catalog.preparedP2p.retainedDeployments['direct-v2'].manifest;
    let release!: () => void;
    mocks.attest.mockImplementationOnce(async ({ manifest }) => { await new Promise<void>(resolve => { release = resolve; }); return manifest; });
    const pending = runtime.forReference!({ ...next, orderId: '7' });
    runtime.close(); release();
    await expect(pending).rejects.toThrow(/closed/);
  });
  it.each(['0x9a55542e2174239860c063e33862b6f6875811f7a7674ce71a8d79ed51144b89', CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash])('admits the public-price API and blocks legacy packing for %s', async (runtimeBytecodeHash) => {
    const currentHistory = { ...history, deployments: { ...history.deployments, 'private-v2': { protocol: 'private-v2', runtimeBytecodeHash } } };
    const getOwnerCapability = vi.fn(async (_requirePrivacy: boolean) => ({} as never));
    mocks.assertHistory.mockImplementation(value => value);
    const runtime = createOtcV2ActionRuntime({ history: currentHistory as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation() });
    expect(() => runtime.privateTrade({ kind: 'cancel', orderId: 1n })).toThrow(/promoted private book/);
    expect(() => runtime.readPrivateTrade(1n)).toThrow(/promoted private book/);
    expect(() => runtime.readPrivateTradeAccount(1n)).toThrow(/promoted private book/);
    expect(getOwnerCapability).not.toHaveBeenCalled(); expect(mocks.executePrivate).not.toHaveBeenCalled();
    await runtime.privateBook!.list('open'); await runtime.privateBook!.read(1n); await runtime.privateBook!.readAccount(1n);
    expect(getOwnerCapability.mock.calls.map(call => call[0])).toEqual([false, false, true]);
    const action = { kind: 'fill', orderId: 1n, expectedRevision: 1n, terms: { mode: 'private-pair', fillBehavior: 'remaining-at-reviewed-price', maxRequestAmount: 20n, priceTerms: { offerAmount: 1n, requestAmount: 2n } } } as const;
    await runtime.privateBook!.execute(action);
    expect(mocks.executeBook).toHaveBeenCalledWith(expect.objectContaining({ action, deployment: currentHistory.deployments['private-v2'] }));
    runtime.close(); await expect(runtime.privateBook!.read(1n)).rejects.toThrow(/closed/);
  });
  it('blocks Book funding after an uncertain send across runtime recreation', async () => {
    const f = rootFixture('book-admitted');
    const action = { kind: 'create',
      offerAsset: { assetType: 'private-erc20', token: `0x${'11'.repeat(20)}`, amount: 10n },
      requestAsset: { assetType: 'private-erc20', token: `0x${'22'.repeat(20)}` },
      priceTerms: { offerAmount: 1n, requestAmount: 2n }, expiresAt: 0n } as const;
    // This sender seam models a send followed by a receipt timeout. It does not
    // prove hash persistence; the runtime must retain a restart gate separately.
    const receiptTimeout = new Error('Book transaction sent; receipt request timed out.');
    let pending: unknown = null;
    mocks.createBookJournal.mockImplementation(() => ({ read: async () => pending, close: vi.fn() }));
    mocks.executeBook.mockImplementationOnce(async ({ journal }) => {
      expect(journal).toBeDefined();
      pending = { active: true, book: { kind: 'create' }, records: [{ state: 'sending', step: 'create' }] };
      throw receiptTimeout;
    }).mockResolvedValueOnce({ action: 'create', orderId: '2' });
    const first = await createOtcV2ActionRuntimeFromCatalog(f.input);
    await expect(first.privateBook!.execute(action)).rejects.toBe(receiptTimeout);
    expect(mocks.executeBook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action }));
    first.close();

    const reloaded = await createOtcV2ActionRuntimeFromCatalog(f.input);
    try {
      const repeated = await reloaded.privateBook!.execute(action).then(
        value => ({ status: 'fulfilled' as const, value }),
        error => ({ status: 'rejected' as const, error })
      );
      expect(mocks.executeBook, 'An unresolved Book send must block a second funding submission after reload.').toHaveBeenCalledTimes(1);
      expect(repeated.status).toBe('rejected');
    } finally { reloaded.close(); }
  });
  it('rebinds Book recovery to the returned privacy capability instead of a prior public signer', async () => {
    const f = rootFixture('book-admitted'), publicCapability = { signer: 'locked' }, privateCapability = { signer: 'unlocked' };
    const saved = { id: 'saved', active: true, book: { kind: 'create', approvalPrivate: true }, records: [{ state: 'confirmed', step: 'approval' }] };
    const journals: Array<{ capability: unknown; read: () => Promise<typeof saved>; close: ReturnType<typeof vi.fn> }> = [];
    mocks.createBookJournal.mockImplementation(({ capability }) => {
      const journal = { capability, read: async () => saved, close: vi.fn() }; journals.push(journal); return journal;
    });
    const getOwnerCapability = vi.fn(async (privacy: boolean) => (privacy ? privateCapability : publicCapability) as never);
    const funding = { kind: 'create', offerAsset: { assetType: 'private-erc20' } };
    mocks.readBookPrepared.mockResolvedValueOnce(funding);
    const runtime = await createOtcV2ActionRuntimeFromCatalog({ ...f.input, getOwnerCapability });
    await runtime.privateBook!.readRecovery();
    expect(await runtime.privateBook!.readPreparedAction()).toBe(funding);
    expect(journals).toHaveLength(2); expect(journals[0].close).toHaveBeenCalledOnce();
    expect(mocks.readBookPrepared).toHaveBeenCalledWith(expect.objectContaining({ capability: privateCapability, journal: journals[1] }));
    expect(mocks.executeBook).not.toHaveBeenCalled(); runtime.close();
  });
  it.each([false, true])('requests privacy only for private=%s approval cleanup', async approvalPrivate => {
    const f = rootFixture('book-admitted'), publicCapability = { signer: 'public' }, privateCapability = { signer: 'private' };
    const saved = { id: 'saved', active: true, book: { kind: 'fill', approvalToken: `0x${'11'.repeat(20)}`, approvalPrivate },
      records: [{ state: 'confirmed', step: 'approval' }] };
    mocks.createBookJournal.mockImplementation(({ capability }) => ({ capability, read: async () => saved, close: vi.fn() }));
    const getOwnerCapability = vi.fn(async (privacy: boolean) => (privacy ? privateCapability : publicCapability) as never);
    const runtime = await createOtcV2ActionRuntimeFromCatalog({ ...f.input, getOwnerCapability });
    await runtime.privateBook!.cleanupPreparation('saved');
    expect(getOwnerCapability.mock.calls.map(([privacy]) => privacy)).toEqual(approvalPrivate ? [false, true] : [false]);
    expect(mocks.cleanupBook).toHaveBeenCalledWith(expect.objectContaining({ preparationId: 'saved', capability: approvalPrivate ? privateCapability : publicCapability }));
    expect(mocks.readBookPrepared).not.toHaveBeenCalled(); runtime.close();
  });
  it.each(['create', 'cleanup'])('keeps %s reconciliation privacy-free except for private cleanup allowance reads', async step => {
    const f = rootFixture('book-admitted');
    const saved = { id: 'saved', active: true, book: { kind: 'create', approvalPrivate: true }, records: [{ state: 'submitted', step }] };
    mocks.createBookJournal.mockImplementation(() => ({ read: async () => saved, close: vi.fn() }));
    const getOwnerCapability = vi.fn(async (_privacy: boolean) => ({} as never));
    const runtime = await createOtcV2ActionRuntimeFromCatalog({ ...f.input, getOwnerCapability });
    await runtime.privateBook!.reconcile();
    expect(getOwnerCapability.mock.calls.map(([privacy]) => privacy)).toEqual(step === 'cleanup' ? [false, true] : [false]);
    expect(mocks.reconcileBook).toHaveBeenCalledOnce(); runtime.close();
  });
  it('Book budget native admission is held before wallet access unless the generic factory explicitly opts in', async () => {
    const f = rootFixture('book-admitted'), action = { kind: 'budget-visibility', orderId: '7', expectedRevision: '1', visible: true } as const;
    const flow = vi.fn();
    const held = createOtcV2ActionRuntime({ ...f.input, runOwnerTransactionFlow: <T,>(operation: () => Promise<T>): Promise<T> => {
      flow(); return operation();
    } });
    expect(held.privateBook?.budgetVisibilityAvailable).toBe(false);
    expect(() => held.privateBook!.execute(action)).toThrow(/unavailable/);
    expect(f.getOwnerCapability).not.toHaveBeenCalled(); expect(flow).not.toHaveBeenCalled();
    await held.privateBook!.execute({ kind: 'cancel', orderId: '7' });
    expect(f.getOwnerCapability).toHaveBeenCalledWith(false); held.close();
    const active = createOtcV2ActionRuntime({ ...f.input, bookBudgetAdmission: { ...f.current.deployments['private-v2'], mode: 'active' } });
    mocks.executeBook.mockResolvedValueOnce({ action: 'budget-visibility' });
    await active.privateBook!.execute(action);
    expect(active.privateBook?.budgetVisibilityAvailable).toBe(true); expect(f.getOwnerCapability).toHaveBeenLastCalledWith(true); active.close();
  });
  it('Book budget native admission rejects mismatched active scopes before any capability', () => {
    const f = rootFixture('book-admitted'), book = f.current.deployments['private-v2'];
    for (const patch of [{ chainId: '1' }, { contractAddress: `0x${'12'.repeat(20)}` }, { runtimeBytecodeHash: `0x${'12'.repeat(32)}` }]) {
      const runtime = createOtcV2ActionRuntime({ ...f.input, bookBudgetAdmission: { ...book, mode: 'active', ...patch } });
      expect(runtime.privateBook?.budgetVisibilityAvailable).toBe(false);
      expect(() => runtime.privateBook!.execute({ kind: 'budget-visibility', orderId: '7', expectedRevision: '1', visible: false })).toThrow(/unavailable/);
      runtime.close();
    }
    expect(f.getOwnerCapability).not.toHaveBeenCalled();
  });
  it('Book budget native admission remains held on retained children after current candidate opt-in', async () => {
    const f = rootFixture('book-admitted'), book = f.current.deployments['private-v2'];
    Object.assign(f.catalog.preparedP2p, { bookBudgetAdmission: { ...book, mode: 'active' } });
    const old = { ...book, contractAddress: `0x${'99'.repeat(20)}` };
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { [old.contractAddress]: { protocol: 'private-v2', manifest: old } });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.privateBook?.budgetVisibilityAvailable).toBe(true);
    const child = await runtime.forReference!({ chainId: old.chainId, contractAddress: old.contractAddress, orderId: '7' });
    expect(child.privateBook?.budgetVisibilityAvailable).toBe(false);
    expect(() => child.privateBook!.execute({ kind: 'budget-visibility', orderId: '7', expectedRevision: '1', visible: true })).toThrow(/unavailable/);
    expect(f.getOwnerCapability).not.toHaveBeenCalled();
    await child.privateBook!.execute({ kind: 'reclaim-expired', orderId: '7' });
    expect(mocks.executeBook).toHaveBeenCalledWith(expect.objectContaining({ deployment: old, action: { kind: 'reclaim-expired', orderId: '7' } }));
    expect(f.getOwnerCapability).toHaveBeenCalledExactlyOnceWith(false); runtime.close();
  });
  it('leaves the older runtime without a promoted API', () => {
    mocks.assertHistory.mockImplementation(value => value);
    const runtime = createOtcV2ActionRuntime({ history: history as never, getOwnerCapability: async () => ({} as never), runOwnerTransactionFlow: operation => operation() });
    expect(runtime.privateBook).toBeUndefined();
    expect(runtime.link).toBeUndefined();
    expect(runtime.counter).toBeUndefined();
  });
  it('queues Counter with other owner actions, captures amounts and redacts recovery secrets', async () => {
    const owner = `0x${'44'.repeat(20)}`, escrow = `0x${'11'.repeat(20)}`, runtimeHash = `0x${'55'.repeat(32)}`;
    const current = { ...history, ownerAddress: owner, deployments: { ...history.deployments, 'standard-v2': { chainId: '7082400' } } };
    const capability = {} as never, readCapability = {} as never;
    const deployment = { protocol: 'counter-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: runtimeHash } as never;
    const parentDeployment = { protocol: 'link-v2', chainId: '7082400' } as never;
    const material = { offer: '4', request: '5' }, journal = { read: vi.fn(async () => ({ id: 'counter', active: true, feeWei: '0',
      scope: { owner, escrow, chainId: '7082400', runtimeHash }, counter: { kind: 'create', material, link: { secret: 'fixture-secret' }, beforeBalance: '1000' }, records: [] })), close: vi.fn() };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const getOwnerCapability = vi.fn(async (_privacy: boolean) => capability).mockImplementationOnce(async () => { await gate; return capability; });
    mocks.ownerBinding.mockReturnValue({ ownerAddress: owner });
    const config = { deployment, journal: journal as never };
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation(),
      linkCreation: { capability: readCapability, deployment: parentDeployment, journal: {} as never }, counterCreation: config });
    config.deployment = { chainId: '1' } as never;
    const first = runtime.standard({ kind: 'cancel', tradeId: 1n }), review = {} as never, amounts = { offer: '4', request: '5', expiresAt: '0' };
    const second = runtime.counter!.propose(review, amounts); amounts.offer = '999'; release(); await Promise.all([first, second]);
    expect(mocks.executeCounter).toHaveBeenCalledWith(expect.objectContaining({ capability, deployment, parentDeployment, parent: review, amounts: { offer: '4', request: '5', expiresAt: '0' } }));
    expect(mocks.executeCounter.mock.calls[0][0].parentDeployments).toContainEqual(current.deployments['standard-v2']);
    expect(mocks.executeCounter.mock.calls[0][0].parent).toBe(review);
    const saved = await runtime.counter!.readRecovery(); expect(saved).toMatchObject({ material, canContinue: true });
    expect(JSON.stringify(saved)).not.toContain('secret'); expect(saved).not.toHaveProperty('beforeBalance');
    expect(getOwnerCapability.mock.calls.map(c => c[0])).toEqual([false, true, true]);
    const mutable = { id: '1', request: '5', root: { id: '9007199254740993' } };
    const recipient = runtime.counter!.recipientAction(mutable as never, 'accept'); mutable.request = '999'; mutable.root.id = '2'; await recipient;
    expect(mocks.recipientCounter).toHaveBeenCalledWith(expect.objectContaining({ kind: 'accept', proposal: { id: '1', request: '5', root: { id: '9007199254740993' } } }));
    mocks.createCounterActivity.mockReturnValue({ sync: mocks.syncCounterActivity, close: mocks.closeCounterActivity });
    mocks.syncCounterActivity.mockResolvedValue({ orders: [], history: [], complete: true });
    await runtime.counter!.syncActivity(); await runtime.counter!.syncActivity();
    expect(mocks.createCounterActivity).toHaveBeenCalledOnce(); expect(mocks.syncCounterActivity).toHaveBeenCalledTimes(2);
    expect(mocks.createCounterActivity).toHaveBeenCalledWith(expect.objectContaining({ pageRangeBlocks: 100_000n }));
    mocks.ownerBinding.mockReturnValue({ ownerAddress: `0x${'66'.repeat(20)}` });
    await expect(runtime.counter!.read('1')).rejects.toThrow(/owner/);
    runtime.close(); await expect(runtime.counter!.cancel('1')).rejects.toThrow(/closed/);
    expect(mocks.closeCounterActivity).toHaveBeenCalledOnce();
    expect(journal.close).toHaveBeenCalledOnce();
  });
  it('queues admitted Link creation with other owner actions and freezes its terms', async () => {
    const current = { ...history, ownerAddress: `0x${'44'.repeat(20)}`, deployments: { ...history.deployments, 'standard-v2': { protocol: 'standard-v2', chainId: '7082400' } } };
    const capability = {} as never, readCapability = {} as never;
    const linkDeployment = { protocol: 'link-v2', chainId: '7082400', contractAddress: `0x${'11'.repeat(20)}` } as never;
    const journal = { assertNoPending: vi.fn(async () => undefined), onPending: vi.fn(async () => undefined),
      onRecovery: vi.fn(async () => undefined), releaseUnsent: vi.fn(async () => undefined), read: vi.fn(async () => null),
      beginOwnerAction: vi.fn(async () => undefined), finishCleanup: vi.fn(async () => undefined), advanceSearch: vi.fn(async () => undefined), beginFill: vi.fn(async () => undefined) };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const getOwnerCapability = vi.fn(async (_privacy: boolean) => capability);
    getOwnerCapability.mockImplementationOnce(async () => { await gate; return capability; });
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation(),
      linkCreation: { capability: readCapability, deployment: linkDeployment, journal } });
    const first = runtime.standard({ kind: 'cancel', tradeId: 1n });
    const action = { offerBudget: '100', terms: { offerToken: `0x${'22'.repeat(20)}`, requestToken: `0x${'33'.repeat(20)}`,
      privatePair: true, priceOffer: '1', priceRequest: '2', expiresAt: '0' } };
    const second = runtime.link!.create(action); action.offerBudget = '200'; release();
    await Promise.all([first, second]);
    expect(getOwnerCapability.mock.calls.map(c => c[0])).toEqual([false, true]);
    expect(mocks.executeLink).toHaveBeenCalledWith(expect.objectContaining({ capability, readCapability,
      deployment: linkDeployment, action: expect.objectContaining({ offerBudget: '100' }), ...journal }));
    expect(runtime.link!.readContext).toEqual({ capability: readCapability, deployment: linkDeployment });
    runtime.close(); await expect(runtime.link!.create(action)).rejects.toThrow(/closed/);
  });
  it('rejects a foreign Link chain before owner capability acquisition', () => {
    const getOwnerCapability = vi.fn(async () => ({} as never));
    expect(() => createOtcV2ActionRuntime({ history: history as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation(),
      linkCreation: { capability: {} as never, deployment: { chainId: '1' } as never,
        journal: { assertNoPending: async () => undefined, onPending: async () => undefined,
          onRecovery: async () => undefined, releaseUnsent: async () => undefined, read: async () => null,
          beginOwnerAction: async () => undefined, finishCleanup: async () => undefined, advanceSearch: async () => undefined, beginFill: async () => undefined } } })).toThrow(/chain/i);
    expect(getOwnerCapability).not.toHaveBeenCalled();
  });
  it('isolates consent recovery, captures queued inputs and rejects a changed owner', async () => {
    const owner = `0x${'44'.repeat(20)}`, recipient = `0x${'22'.repeat(20)}`, capability = {} as never, readCapability = {} as never;
    const current = { ...history, ownerAddress: owner, deployments: { ...history.deployments, 'standard-v2': { chainId: '7082400' } } };
    const disclosure = {} as never; mocks.createJournal.mockReturnValue(disclosure);
    const journal = { forDisclosure: vi.fn(() => disclosure) } as never;
    const selectedDeployment = { protocol: 'link-v2' as const, chainId: '7082400', contractAddress: `0x${'11'.repeat(20)}`, runtimeBytecodeHash: `0x${'55'.repeat(32)}` };
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const getOwnerCapability = vi.fn(async (_privacy: boolean) => capability);
    getOwnerCapability.mockImplementationOnce(async () => { await gate; return capability; });
    mocks.ownerBinding.mockReturnValue({ ownerAddress: owner });
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation(),
      tradeBalanceAdmissions: { 'link-v2': { ...selectedDeployment, mode: 'active', variants: ['private-pair'] } },
      linkCreation: { capability: readCapability, deployment: selectedDeployment as never, journal } });
    const first = runtime.standard({ kind: 'cancel', tradeId: 1n });
    const action = { kind: 'grant' as const, orderId: '9007199254740993', recipient, allowed: true };
    const second = runtime.link!.balance!.execute(action); action.recipient = owner; release(); await Promise.all([first, second]);
    expect(mocks.executeBalance).toHaveBeenCalledWith(expect.objectContaining({ journal: disclosure, capability, readCapability,
      deployment: selectedDeployment, recipient, allowed: true, orderId: '9007199254740993' }));
    await runtime.link!.balance!.read('1', recipient); await runtime.link!.balance!.pending('1');
    await runtime.link!.balance!.recipients('1'); await runtime.link!.balance!.reconcile();
    expect(getOwnerCapability.mock.calls.map(c => c[0])).toEqual([false, true, true, true, true, true]);
    expect(mocks.pendingBalance).toHaveBeenCalledWith(expect.objectContaining({ journal: disclosure, orderId: '1' }));
    mocks.ownerBinding.mockReturnValue({ ownerAddress: recipient });
    await expect(runtime.link!.balance!.read('1')).rejects.toThrow(/owner changed/);
    expect(mocks.readBalance).toHaveBeenCalledOnce(); runtime.close();
    await expect(runtime.link!.balance!.reconcile()).rejects.toThrow(/closed/);
  });
  it('contextual trade balance runtime holds every unqualified target before privacy while keeping pending recovery', async () => {
    const f = rootFixture('admitted', true), runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    f.getOwnerCapability.mockClear();
    for (const protocol of ['private-v2', 'direct-v2', 'link-v2', 'counter-v2'] as const) {
      const balance = runtime.tradeBalances[protocol]!;
      expect(balance.available).toBe(false);
      expect(() => balance.execute({ kind: 'snapshot', orderId: '7' })).toThrow(/unavailable/);
      expect(() => balance.read('7')).toThrow(/unavailable/);
    }
    expect(f.getOwnerCapability).not.toHaveBeenCalled();
    await runtime.tradeBalances['private-v2']!.pending('7');
    expect(mocks.pendingBalance).toHaveBeenCalledWith(expect.objectContaining({ orderId: '7' }));
    expect(f.getOwnerCapability).toHaveBeenCalledExactlyOnceWith(true); runtime.close();
  });
  it('contextual trade balance runtime never forwards current admission to a retained Book', async () => {
    const f = rootFixture('book-admitted'), book = f.current.deployments['private-v2'];
    Object.assign(f.catalog.preparedP2p, { tradeBalanceAdmissions: { 'private-v2': { ...book, mode: 'active', variants: ['private-pair'] } } });
    const old = { ...book, contractAddress: `0x${'99'.repeat(20)}` };
    Object.assign(f.catalog.preparedP2p.retainedDeployments, { [old.contractAddress]: { protocol: 'private-v2', manifest: old } });
    const runtime = await createOtcV2ActionRuntimeFromCatalog(f.input);
    expect(runtime.tradeBalances['private-v2']?.available).toBe(true);
    const retained = await runtime.forReference!({ chainId: old.chainId, contractAddress: old.contractAddress, orderId: '7' });
    expect(retained.tradeBalances['private-v2']?.available).toBe(false);
    expect(() => retained.tradeBalances['private-v2']!.execute({ kind: 'grant', orderId: '7', recipient: f.current.ownerAddress, allowed: true })).toThrow(/unavailable/);
    expect(f.getOwnerCapability).not.toHaveBeenCalled(); runtime.close();
  });
  it('restores a redacted owner status and queues recovery actions through the selected owner', async () => {
    const owner = `0x${'44'.repeat(20)}`, escrow = `0x${'11'.repeat(20)}`, runtimeHash = `0x${'55'.repeat(32)}`;
    const current = { ...history, ownerAddress: owner, deployments: { ...history.deployments, 'standard-v2': { chainId: '7082400' } } };
    const saved = { id: 'saved-creation', active: true, feeWei: '0', abandoned: false,
      scope: { owner, escrow, chainId: '7082400', runtimeHash }, records: [] as unknown[],
      recovery: { secret: 'fixture-secret', beforeBalance: '1000', offerBudget: '100', terms: { privatePair: true } } };
    const journal = { assertNoPending: vi.fn(async () => undefined), onPending: vi.fn(async () => undefined),
      onRecovery: vi.fn(async () => undefined), releaseUnsent: vi.fn(async () => undefined), read: vi.fn(async () => saved as never),
      beginOwnerAction: vi.fn(async () => undefined), finishCleanup: vi.fn(async () => undefined), advanceSearch: vi.fn(async () => undefined), beginFill: vi.fn(async () => undefined) };
    const capability = {} as never, getOwnerCapability = vi.fn(async (_privacy: boolean) => capability);
    const runtime = createOtcV2ActionRuntime({ history: current as never, getOwnerCapability, runOwnerTransactionFlow: operation => operation(),
      linkCreation: { capability: {} as never, deployment: { chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: runtimeHash } as never, journal } });
    const status = await runtime.link!.readCreation();
    expect(status).toMatchObject({ id: saved.id, active: true, offerBudget: '100', canContinue: true });
    expect(JSON.stringify(status)).not.toContain('fixture-secret'); expect(status).not.toHaveProperty('beforeBalance');
    const recoveryHash = `0x${'99'.repeat(32)}`;
    await runtime.link!.reconcileCreation(recoveryHash); await runtime.link!.continueCreation(saved.id);
    expect(mocks.reconcileLink).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, transactionHash: recoveryHash }));
    expect(mocks.continueLink).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, creationId: saved.id }));
    expect(getOwnerCapability.mock.calls.every(call => call[0] === true)).toBe(true);
    await runtime.link!.readOwnerOrder('9007199254740993');
    await runtime.link!.ownerOrderAction({ orderId: '9007199254740993', kind: 'cancel' });
    await runtime.link!.cleanupCreation(saved.id); await runtime.link!.reconcileOwnerAction(recoveryHash); await runtime.link!.retryOwnerAction(saved.id);
    expect(mocks.executeLinkOwner).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, orderId: '9007199254740993', kind: 'cancel' }));
    expect(mocks.reconcileLinkOwner).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, transactionHash: recoveryHash }));
    const authenticatedReview = Object.freeze({ reference: { id: '9007199254740993' }, terms: {} }) as never;
    await runtime.link!.fill(authenticatedReview, '100'); await runtime.link!.reconcileFill(recoveryHash); await runtime.link!.continueFill(saved.id);
    expect(mocks.executeFill.mock.calls[0][0].review).toBe(authenticatedReview);
    expect(mocks.executeFill).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, maximumPayment: '100' }));
    expect(mocks.reconcileFill).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, transactionHash: recoveryHash }));
    expect(mocks.continueFill).toHaveBeenCalledWith(expect.objectContaining({ capability, journal, fillId: saved.id }));
    await runtime.link!.syncActivity(); await runtime.link!.syncActivity();
    expect(mocks.createActivity).toHaveBeenCalledOnce(); expect(mocks.syncActivity).toHaveBeenCalledTimes(2);
    expect(mocks.createActivity).toHaveBeenCalledWith(expect.objectContaining({ pageRangeBlocks: 100_000n }));
    expect(mocks.syncActivity).toHaveBeenCalledWith(capability);
    await runtime.link!.discardDraft(saved.id); expect(journal.releaseUnsent).toHaveBeenCalledOnce();
    saved.records.push({ state: 'sending' });
    await expect(runtime.link!.discardDraft(saved.id)).rejects.toThrow(/cannot be discarded/);
    Object.assign(saved, { ownerAction: { kind: 'cleanup', offerToken: escrow, privatePair: true, beforeBalance: '987654321', tokenCodeHash: runtimeHash } });
    const pendingOwner = await runtime.link!.readCreation();
    expect(pendingOwner).toMatchObject({ ownerAction: { kind: 'cleanup', offerToken: escrow, privatePair: true }, canContinue: false });
    expect(JSON.stringify(pendingOwner)).not.toContain('987654321'); expect(pendingOwner?.ownerAction).not.toHaveProperty('tokenCodeHash');
    saved.records[0] = { state: 'failed', step: 'cleanup' };
    expect(await runtime.link!.readCreation()).toMatchObject({ canRetry: true, canContinue: false });
    Object.assign(saved, { ownerAction: undefined, recovery: undefined, fill: { reference: { id: '9007199254740993' }, maximumPayment: '10',
      terms: { privatePair: true }, secret: 'fill-secret', beforeOfferBalance: '1234567890', beforeRequestBalance: '2345678901' } });
    saved.records[0] = { state: 'confirmed', step: 'approval' };
    const fillStatus = await runtime.link!.readCreation();
    expect(fillStatus).toMatchObject({ fill: { reference: { id: '9007199254740993' }, maximumPayment: '10' }, canContinue: true, canCleanup: true });
    expect(JSON.stringify(fillStatus)).not.toMatch(/fill-secret|1234567890|2345678901/);
    saved.scope.owner = `0x${'66'.repeat(20)}`;
    await expect(runtime.link!.readCreation()).rejects.toThrow(/different wallet/);
    runtime.close(); expect(mocks.closeActivity).toHaveBeenCalledOnce();
    await expect(runtime.link!.syncActivity()).rejects.toThrow(/closed/);
    await expect(runtime.link!.reconcileCreation()).rejects.toThrow(/closed/);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapabilitySnapshot.mockImplementation(() => {});
    mocks.createBookJournal.mockImplementation(() => ({ read: async () => null, close: vi.fn() }));
    mocks.createActivity.mockReturnValue({ sync: mocks.syncActivity, close: mocks.closeActivity });
    mocks.assertHistory.mockImplementation((value) => value);
    mocks.submitStandard.mockResolvedValue('standard-submission');
    mocks.confirmStandard.mockResolvedValue({ action: 'create' });
    mocks.executePrivate.mockResolvedValue({ action: 'cancel' });
    mocks.ensureDirect.mockResolvedValue(undefined);
    mocks.ensureStandard.mockResolvedValue(undefined);
    mocks.submitDirect.mockResolvedValue('direct-submission');
    mocks.confirmDirect.mockResolvedValue({ action: 'cancel' });
    mocks.submitRecurring.mockResolvedValue('recurring-submission');
    mocks.confirmRecurring.mockResolvedValue({ action: 'pause' });
    mocks.submitPrivateRecurring.mockResolvedValue('private-recurring-submission');
    mocks.confirmPrivateRecurring.mockResolvedValue({ action: 'pause' });
    mocks.listRecurring.mockResolvedValue({ orderIds: ['1'], nextOffset: '0' });
    mocks.listStandard.mockResolvedValue({ tradeIds: ['1'], nextOffset: '0' });
    mocks.readStandard.mockResolvedValue({ tradeId: '1' });
    mocks.quoteStandard.mockResolvedValue({ revision: '1' });
    mocks.listPrivateTrade.mockResolvedValue({ orderIds: ['2'], nextOffset: '0' });
    mocks.readPrivateTrade.mockResolvedValue({ orderId: '2' });
    mocks.readPrivateTradeAccount.mockResolvedValue({ orderId: '2' });
    mocks.listDirect.mockResolvedValue({ tradeIds: ['3'], nextOffset: '0' });
    mocks.readDirect.mockResolvedValue({ tradeId: '3' });
    mocks.readRecurring.mockResolvedValue({ orderId: '1' });
    mocks.quoteRecurring.mockResolvedValue({ revision: '1' });
    mocks.listPrivateRecurring.mockResolvedValue({ orderIds: ['2'], nextOffset: '0' });
    mocks.readPrivateRecurring.mockResolvedValue({ orderId: '2' });
    mocks.readPrivateRecurringInventory.mockResolvedValue({ orderId: '2' });
    mocks.readPrivateRecurringReceipt.mockResolvedValue({ orderId: '2' });
  });

  it('uses prompt-free public reads and privacy-capable private reads', async () => {
    const privacyRequests: boolean[] = [];
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async (requirePrivacy) => {
        privacyRequests.push(requirePrivacy);
        return Object.freeze({}) as never;
      },
      runOwnerTransactionFlow: (operation) => operation()
    });

    await runtime.listRecurring('active', 0n, 20n);
    await runtime.readRecurring(1n);
    await runtime.quoteRecurring(1n, 'buy', 10n);
    await runtime.listPrivateRecurring('maker', 0n, 20n);
    await runtime.readPrivateRecurring(2n);
    await runtime.readPrivateRecurringInventory(2n);
    await runtime.readPrivateRecurringReceipt(2n);

    expect(privacyRequests).toEqual([false, false, false, false, false, true, true]);
    expect(mocks.listRecurring).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['recurring-v2'],
      scope: 'active'
    }));
    expect(mocks.listPrivateRecurring).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['private-recurring-v2'],
      scope: 'maker'
    }));
  });

  it('routes one-off and direct discovery through the exact protocol with privacy only for decrypted data', async () => {
    const privacyRequests: boolean[] = [];
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async (requirePrivacy) => {
        privacyRequests.push(requirePrivacy);
        return Object.freeze({}) as never;
      },
      runOwnerTransactionFlow: (operation) => operation()
    });

    await runtime.listStandard('open', 0n, 20n);
    await runtime.readStandard(1n);
    await runtime.quoteStandard(1n, 10n);
    await runtime.listPrivateTrade('maker', 0n, 20n);
    await runtime.readPrivateTrade(2n);
    await runtime.readPrivateTradeAccount(2n);
    await runtime.listDirect('taker', 0n, 20n);
    await runtime.readDirect(3n, false);
    await runtime.readDirect(3n, true);

    expect(privacyRequests).toEqual([false, false, false, false, false, true, false, false, true]);
    expect(mocks.listStandard).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['standard-v2'], scope: 'open'
    }));
    expect(mocks.listPrivateTrade).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['private-v2'], scope: 'maker'
    }));
    expect(mocks.listDirect).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['direct-v2'], scope: 'taker'
    }));
  });

  it('routes every protocol to its exact deployment and privacy requirement', async () => {
    const privacyRequests: boolean[] = [];
    const capability = Object.freeze({});
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async (requirePrivacy) => {
        privacyRequests.push(requirePrivacy);
        return capability as never;
      },
      runOwnerTransactionFlow: (operation) => operation()
    });

    await runtime.standard({ kind: 'cancel', tradeId: 1n });
    await runtime.privateTrade({ kind: 'cancel', orderId: 2n });
    await runtime.direct({ kind: 'cancel', tradeId: 3n });
    await runtime.direct({
      kind: 'create-private',
      offerToken: '0x0000000000000000000000000000000000000001',
      requestToken: '0x0000000000000000000000000000000000000002',
      offerAmount: 1n,
      requestAmount: 1n,
      taker: '0x0000000000000000000000000000000000000003',
      expiresAt: 1n
    });
    await runtime.recurring({ kind: 'pause', orderId: 4n, expectedRevision: 1n });
    await runtime.privateRecurring({ kind: 'pause', orderId: 5n, expectedRevision: 1n });

    expect(privacyRequests).toEqual([false, true, false, true, false, true]);
    expect(mocks.submitStandard).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['standard-v2']
    }));
    expect(mocks.ensureStandard).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['standard-v2'],
      action: expect.objectContaining({ kind: 'cancel', tradeId: 1n })
    }));
    expect(mocks.executePrivate).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['private-v2']
    }));
    expect(mocks.submitDirect).toHaveBeenLastCalledWith(expect.objectContaining({
      deployment: history.deployments['direct-v2']
    }));
    expect(mocks.ensureDirect).toHaveBeenCalledTimes(2);
    expect(mocks.ensureDirect).toHaveBeenLastCalledWith(expect.objectContaining({
      deployment: history.deployments['direct-v2'],
      action: expect.objectContaining({ kind: 'create-private', offerAmount: 1n })
    }));
    expect(mocks.submitRecurring).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['recurring-v2']
    }));
    expect(mocks.submitPrivateRecurring).toHaveBeenCalledWith(expect.objectContaining({
      deployment: history.deployments['private-recurring-v2']
    }));
  });

  it('confirms the one-time allowance before submitting Standard or Direct custody', async () => {
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async () => Object.freeze({}) as never,
      runOwnerTransactionFlow: (operation) => operation()
    });

    await runtime.standard({
      kind: 'create',
      offerAsset: { assetType: 'erc20', token: '0x0000000000000000000000000000000000000001', amount: 4n },
      requestAsset: { assetType: 'erc20', token: '0x0000000000000000000000000000000000000002', amount: 8n },
      fillPolicy: {
        partialFillsAllowed: true,
        minPartialFillBps: 1n,
        minRequestAmount: 1n,
        maxRequestAmountPerWallet: 8n,
        oneFillPerWallet: false
      },
      expiresAt: 10n
    });
    await runtime.direct({
      kind: 'create-private',
      offerToken: '0x0000000000000000000000000000000000000001',
      requestToken: '0x0000000000000000000000000000000000000002',
      offerAmount: 4n,
      requestAmount: 8n,
      taker: '0x0000000000000000000000000000000000000003',
      expiresAt: 10n
    });

    expect(mocks.ensureStandard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submitStandard.mock.invocationCallOrder[0]!
    );
    expect(mocks.ensureDirect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submitDirect.mock.invocationCallOrder[0]!
    );
  });

  it('does not submit custody when the allowance step fails', async () => {
    mocks.ensureDirect.mockRejectedValueOnce(new Error('approval rejected'));
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async () => Object.freeze({}) as never,
      runOwnerTransactionFlow: (operation) => operation()
    });

    await expect(runtime.direct({
      kind: 'create-private',
      offerToken: '0x0000000000000000000000000000000000000001',
      requestToken: '0x0000000000000000000000000000000000000002',
      offerAmount: 4n,
      requestAmount: 8n,
      taker: '0x0000000000000000000000000000000000000003',
      expiresAt: 10n
    })).rejects.toThrow('approval rejected');

    expect(mocks.submitDirect).not.toHaveBeenCalled();
  });

  it('fails closed after the action facade is closed', async () => {
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async () => Object.freeze({}) as never,
      runOwnerTransactionFlow: (operation) => operation()
    });
    runtime.close();
    await expect(runtime.standard({ kind: 'cancel', tradeId: 1n })).rejects.toThrow('closed');
    expect(mocks.submitStandard).not.toHaveBeenCalled();
  });

  it('binds privacy and calldata to the action snapshot captured before queued async work', async () => {
    let releaseFirst!: () => void;
    const firstCapability = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const privacyRequests: boolean[] = [];
    let requestCount = 0;
    const runtime = createOtcV2ActionRuntime({
      history: history as never,
      getOwnerCapability: async (requirePrivacy) => {
        privacyRequests.push(requirePrivacy);
        requestCount += 1;
        if (requestCount === 1) await firstCapability;
        return Object.freeze({}) as never;
      },
      runOwnerTransactionFlow: (operation) => operation()
    });

    const first = runtime.standard({ kind: 'cancel', tradeId: 1n });
    const mutable = {
      kind: 'create-private' as const,
      offerToken: '0x0000000000000000000000000000000000000001',
      requestToken: '0x0000000000000000000000000000000000000002',
      offerAmount: 4n,
      requestAmount: 8n,
      taker: '0x0000000000000000000000000000000000000003',
      expiresAt: 10n
    };
    const second = runtime.direct(mutable);
    mutable.offerAmount = 999n;
    mutable.taker = '0x0000000000000000000000000000000000000004';
    releaseFirst();
    await Promise.all([first, second]);

    expect(privacyRequests).toEqual([false, true]);
    const submitted = mocks.submitDirect.mock.calls[0]?.[0]?.action;
    expect(submitted).toMatchObject({
      kind: 'create-private',
      offerAmount: 4n,
      taker: '0x0000000000000000000000000000000000000003'
    });
    expect(Object.isFrozen(submitted)).toBe(true);
  });
});
