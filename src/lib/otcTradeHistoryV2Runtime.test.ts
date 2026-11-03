import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTradeHistoryV2LedgerState,
  replaceTradeHistoryV2Range,
  type TradeHistoryV2Protocol
} from './tradeHistoryV2Ledger';
import { createTradeHistoryV2MaterializationState } from './tradeHistoryV2Materialize';
import * as materialization from './tradeHistoryV2Materialize';
import {
  assertOtcTradeHistoryV2Runtime,
  createOtcTradeHistoryV2Runtime,
  projectOtcTradeHistoryV2Portfolio
} from './otcTradeHistoryV2Runtime';
import type { TradeHistoryV2PipelineState } from './tradeHistoryV2Pipeline';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';

const mocks = vi.hoisted(() => ({ bind: vi.fn(), attest: vi.fn(), sync: vi.fn(), decrypt: vi.fn(), direct: vi.fn(), index: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', async original => ({ ...await original<typeof import('./tradeHistoryV2Chain')>(),
  bindTradeHistoryV2ReadCapability: mocks.bind,
  readTradeHistoryV2WalletIndex: mocks.index,
  attestTradeHistoryV2Deployments: async ({ manifests, ...args }: { manifests: readonly unknown[] }) =>
    Promise.all(manifests.map(manifest => mocks.attest({ ...args, manifest }))) }));
vi.mock('./tradeHistoryV2Pipeline', async original => ({ ...await original<typeof import('./tradeHistoryV2Pipeline')>(), syncTradeHistoryV2PipelineRange: mocks.sync }));
vi.mock('./privateTradeV2ReceiptResolver', () => ({ decryptPrivateTradeV2ReceiptAmounts: mocks.decrypt }));
vi.mock('./directTradeV2Actions', async original => ({ ...await original<typeof import('./directTradeV2Actions')>(), readDirectTradeV2TradeTerms: mocks.direct }));

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const VIEWER = address('11');
const PARTICIPANT = address('22');
const protocols: readonly TradeHistoryV2Protocol[] = [
  'standard-v2', 'private-v2', 'direct-v2'
];

const stateFor = (protocol: TradeHistoryV2Protocol, index: number, orderId = String(index + 1), privateAmounts?: boolean): TradeHistoryV2PipelineState => {
  const contractAddress = address((30 + index).toString(16));
  const base = createTradeHistoryV2LedgerState();
  const ledger = replaceTradeHistoryV2Range({
    previous: base,
    expectedRevision: 0,
    page: {
      schema: 1,
      chainId: '7',
      contractAddress,
      fromBlock: String(index + 1),
      toBlock: String(index + 1),
      fromBlockHash: hash((40 + index).toString(16)),
      toBlockHash: hash((40 + index).toString(16)),
      observations: [{
        schema: 1,
        protocol,
        order: { chainId: '7', contractAddress, orderId },
        sequence: '1',
        maker: VIEWER,
        participant: PARTICIPANT,
        side: 'fill',
        source: privateAmounts === undefined ? 'public-event' : privateAmounts ? 'participant-receipt' : 'private-marker',
        ...(privateAmounts ? { recipient: VIEWER } : {}),
        amounts: privateAmounts === false ? {} : { offerAmount: '2', requestAmount: '4' },
        log: {
          blockNumber: String(index + 1),
          blockHash: hash((40 + index).toString(16)),
          transactionHash: hash((50 + index).toString(16)),
          transactionIndex: 0,
          logIndex: 0
        }
      }]
    }
  });
  return {
    sync: createTradeHistoryV2SyncState(ledger),
    materialization: createTradeHistoryV2MaterializationState()
  };
};

describe('otcTradeHistoryV2Runtime', () => {
  it('keeps equal local IDs distinct across current protocol instances', () => {
    const states = Object.fromEntries(protocols.map((protocol, index) => [protocol, stateFor(protocol, index)]));
    states['standard-v2'] = stateFor('standard-v2', 0, '2');
    const portfolio = projectOtcTradeHistoryV2Portfolio({ states, viewerAddress: VIEWER });
    expect(portfolio.rows).toHaveLength(3);
    const sameId = portfolio.orders.filter(order => order.order.orderId === '2');
    expect(sameId).toHaveLength(2);
    expect(new Set(sameId.map(order => order.order.contractAddress)).size).toBe(2);
  });
  it('projects all protocols into one ordered portfolio with exact per-order amounts', () => {
    const states = Object.fromEntries(protocols.map((protocol, index) => [
      protocol,
      stateFor(protocol, index)
    ])) as Record<TradeHistoryV2Protocol, TradeHistoryV2PipelineState>;
    const portfolio = projectOtcTradeHistoryV2Portfolio({ states, viewerAddress: VIEWER });
    expect(portfolio.rows.map(({ protocol }) => protocol)).toEqual(protocols);
    expect(portfolio.orders).toHaveLength(3);
    expect(portfolio.orders[0]).toMatchObject({
      executionCount: '1', exactExecutionCount: '1', offerAmount: '2', requestAmount: '4'
    });
    expect(portfolio.orders[2]).toMatchObject({
      executionCount: '1', exactExecutionCount: '1', offerAmount: '2', requestAmount: '4'
    });
  });

  it('rejects a structural runtime lookalike', () => {
    expect(() => assertOtcTradeHistoryV2Runtime({} as never)).toThrow(/verified factory/i);
  });
});

describe('OTC current history discovery', () => {
  const catalogFor = (status: 'prepared' | 'book-admitted' | 'admitted') => {
    const current = Object.fromEntries(protocols.map((protocol, index) => [protocol, { protocol, manifest: {
      protocol, chainId: '7', contractAddress: address((30 + index).toString(16)), deploymentBlock: '1', runtimeBytecodeHash: hash('22')
    } }]));
    return { status: 'active' as const, chainId: '7', deployments: current, finalityLagBlocks: 1n,
      preparedP2p: { status } };
  };
  const create = (status: 'prepared' | 'book-admitted' | 'admitted' = 'admitted') => createOtcTradeHistoryV2Runtime({
    catalog: catalogFor(status) as never, ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {}, getOwnerCapability: async () => ({} as never)
  });
  beforeEach(() => {
    vi.clearAllMocks(); mocks.bind.mockResolvedValue({}); mocks.attest.mockImplementation(async ({ manifest }) => manifest);
    mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: ['1'], complete: true, block: { number: '110', hash: hash('aa') } });
    mocks.decrypt.mockResolvedValue({ offerAmount: '2', requestAmount: '4' }); mocks.direct.mockResolvedValue({ offerAmount: '2', requestAmount: '4' });
    mocks.sync.mockImplementation(async ({ deployment }) => {
      const index = protocols.indexOf(deployment.protocol), old = deployment.contractAddress === address((60 + index).toString(16));
      return { status: 'applied', state: stateFor(deployment.protocol, old ? 30 + index : index, '1'),
        hasMore: old && index === 1, reorged: old && index === 1, safeHead: old ? '100' : '110' };
    });
  });
  it('uses one bounded recent window by default and forwards explicit older requests', async () => {
    const runtime = await create();
    const normal = { status: 'applied', state: stateFor('standard-v2', 0, '1'), hasMore: true, reorged: false, safeHead: '110' };
    mocks.sync.mockResolvedValueOnce({ ...normal, narrowedForLogLimit: true });
    try {
      await runtime.sync([address('1e')]);
      expect(mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0]).toMatchObject({ maxBlockSpan: 2048n, mode: 'latest' });
      mocks.sync.mockResolvedValue(normal);
      await runtime.sync([address('1e')], 'older');
      expect(mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0]).toMatchObject({ maxBlockSpan: 2048n, mode: 'older' });
      await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0]).toMatchObject({ maxBlockSpan: 2048n, mode: 'latest' });
    } finally { runtime.close(); }
  });
  it('skips canonical scanning for an empty index and backfills when the wallet later participates in an older order', async () => {
    mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: [], block: { number: '110', hash: hash('aa') } });
    const runtime = await create();
    try {
      expect((await runtime.sync([address('1e')])).hasMore).toBe(false);
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(runtime.rows()).toEqual([]);
      mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: ['1'], block: { number: '120', hash: hash('ab') } });
      await runtime.sync([address('1e')]);
      const first = mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0];
      expect(first.previous.sync.checkpointsByScope).toEqual({});
      expect(first.walletIndex.orderIds).toEqual(['1']);
      expect(first.scope.deploymentBlock).toBe('1');
      expect(runtime.rows()).toHaveLength(1);
      mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: ['1', '2'], block: { number: '130', hash: hash('ac') } });
      await runtime.sync([address('1e')]);
      const added = mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0];
      expect(added.expectedLedgerRevision).toBe(0);
      expect(added.previous.sync.checkpointsByScope).toEqual({});
    } finally { runtime.close(); }
  });
  it('does not commit a changed index or erase retained rows when another index read fails', async () => {
    const runtime = await create();
    try {
      await runtime.sync();
      expect(runtime.rows()).toHaveLength(3);
      mocks.index.mockImplementation(async ({ deployment }) => {
        if (deployment.protocol === 'private-v2') throw new Error('index unavailable');
        return { ownerAddress: VIEWER, orderIds: [], block: { number: '120', hash: hash('ab') } };
      });
      await expect(runtime.sync()).rejects.toThrow('index unavailable');
      expect(runtime.rows()).toHaveLength(3);
    } finally { runtime.close(); }
  });
  it('retains verified event pages when an incomplete index receives new IDs', async () => {
    mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: ['120'], complete: false, block: { number: '110', hash: hash('aa') } });
    const runtime = await create();
    try {
      await runtime.sync([address('1e')]);
      const previous = mocks.sync.mock.results[0].value;
      mocks.index.mockResolvedValue({ ownerAddress: VIEWER, orderIds: ['121'], complete: false, block: { number: '120', hash: hash('ab') } });
      await runtime.sync([address('1e')], 'older');
      expect(mocks.sync.mock.calls[1][0].previous).toBe((await previous).state);
      expect(mocks.sync.mock.calls[1][0].mode).toBe('older');
    } finally { runtime.close(); }
  });
  it.each(['close', 'privacy'] as const)('traces held private capability, terms and decryption and clears %s output', async invalidation => {
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', { documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => { attributes.delete(name); }
    } });
    vi.stubEnv('DEV', true);
    const releases: (() => void)[] = [];
    const capability = vi.fn(() => new Promise<never>(resolve => { releases.push(() => resolve({} as never)); }));
    let releaseDecrypt!: () => void, releaseTerms!: () => void;
    mocks.decrypt.mockImplementation(() => new Promise(resolve => { releaseDecrypt = () => resolve({ offerAmount: 'secret-amount', requestAmount: '2' }); }));
    mocks.direct.mockImplementation(() => new Promise(resolve => { releaseTerms = () => resolve({ offerAmount: 'secret-amount', requestAmount: '2' }); }));
    const base = mocks.sync.getMockImplementation()!;
    mocks.sync.mockImplementation(async args => {
      if (args.deployment.protocol === 'private-v2') await args.resolvePrivateReceiptAmounts({ protocol: 'private-v2', chainId: '7', contractAddress: address('1f') });
      if (args.deployment.protocol === 'direct-v2') await args.resolveDirectPrivateAmounts({ opened: {
        protocol: 'direct-v2', chainId: '7', contractAddress: address('20'), orderId: 'private-order-id' } });
      return base(args);
    });
    let generation = 1;
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {}, getOwnerCapability: capability,
      getPrivateReadScope: () => ({ key: `private-scope-key:${generation}`, enabled: true }) });
    try {
      const pending = runtime.sync();
      await vi.waitFor(() => expect(capability).toHaveBeenCalledTimes(2));
      for (const protocol of ['private', 'direct']) expect(JSON.parse(attributes.get(`data-p2p-${protocol}-history-read`) ?? 'null'))
        .toMatchObject({ stage: 'private-capability', state: 'pending' });
      releases.splice(0).forEach(release => release());
      await vi.waitFor(() => {
        expect(JSON.parse(attributes.get('data-p2p-private-history-read') ?? 'null')).toMatchObject({ stage: 'private-decryption', state: 'pending' });
        expect(JSON.parse(attributes.get('data-p2p-direct-history-read') ?? 'null')).toMatchObject({ stage: 'private-terms', state: 'pending' });
      });
      expect([...attributes.values()].join('')).not.toMatch(/secret-amount|private-order-id|wallet|ciphertext|transactionHash|params/);
      const outcome = expect(pending).rejects.toThrow(invalidation === 'close' ? /closed/ : /scope changed/);
      if (invalidation === 'close') { runtime.close(); expect(attributes.size).toBe(0); }
      else generation++;
      releaseDecrypt(); releaseTerms(); await outcome;
      expect(attributes.size).toBe(0);
      expect(mocks.decrypt).toHaveBeenCalledOnce(); expect(mocks.direct).toHaveBeenCalledOnce();
    } finally {
      runtime.close(); releases.forEach(release => release()); releaseDecrypt?.(); releaseTerms?.();
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  it('does not let an older runtime close erase a newer runtime pending trace', async () => {
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', { documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => { attributes.delete(name); }
    } });
    vi.stubEnv('DEV', true);
    const older = await create(), newer = await create();
    let release!: () => void;
    let pending: Promise<unknown> | undefined;
    const receipt = { protocol: 'private-v2', chainId: '7', contractAddress: address('1f') };
    try {
      await older.sync([address('1f')]);
      const oldInput = mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0];
      await oldInput.resolvePrivateReceiptAmounts(receipt);
      await newer.sync([address('1f')]);
      const newInput = mocks.sync.mock.calls[mocks.sync.mock.calls.length - 1][0];
      mocks.decrypt.mockImplementationOnce(() => new Promise(resolve => {
        release = () => resolve({ offerAmount: '2', requestAmount: '4' });
      }));
      pending = newInput.resolvePrivateReceiptAmounts(receipt);
      await vi.waitFor(() => expect(JSON.parse(attributes.get('data-p2p-private-history-read') ?? 'null'))
        .toMatchObject({ stage: 'private-decryption', state: 'pending' }));
      const current = attributes.get('data-p2p-private-history-read');
      older.close();
      expect(attributes.get('data-p2p-private-history-read')).toBe(current);
      release(); await pending;
      newer.close();
      expect(attributes.has('data-p2p-private-history-read')).toBe(false);
    } finally {
      release?.(); await pending; older.close(); newer.close();
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  it('commits amount-free markers with no private resolvers while the optional private scope is disabled', async () => {
    const receipt = vi.fn(async () => { throw new Error('Private receipt resolver must stay disabled'); });
    const direct = vi.fn(async () => { throw new Error('Private Direct resolver must stay disabled'); });
    mocks.sync.mockImplementation(async args => {
      if (args.resolvePrivateReceiptAmounts) await args.resolvePrivateReceiptAmounts({});
      if (args.resolveDirectPrivateAmounts) await args.resolveDirectPrivateAmounts({});
      return { status: 'applied', state: stateFor('private-v2', 1, '1', false), hasMore: false, reorged: false, safeHead: '110' };
    });
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {},
      resolvePrivateReceiptAmounts: receipt, resolveDirectPrivateAmounts: direct,
      getPrivateReadScope: () => ({ key: 'owner:locked:0', enabled: false }) });
    try {
      await runtime.sync([address('1f')]);
      expect(receipt).not.toHaveBeenCalled(); expect(direct).not.toHaveBeenCalled();
      expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
        resolvePrivateReceiptAmounts: undefined, resolveDirectPrivateAmounts: undefined
      }));
      expect(runtime.rows()).toMatchObject([{ amountState: 'unavailable', amounts: {}, source: 'private-marker' }]);
    } finally { runtime.close(); }
  });

  it('reuses verified scan state on enable while rebuilding only the selected private projection', async () => {
    let privateScope = { key: 'owner:locked:0', enabled: false };
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {},
      getOwnerCapability: async () => ({} as never), getPrivateReadScope: () => privateScope });
    const lifecycle = vi.spyOn(materialization, 'listTradeHistoryV2LifecycleEvents');
    const baseState = stateFor('private-v2', 1, '1', false);
    const lockedState = { ...baseState, sync: { ...baseState.sync,
      checkpointsByScope: { 'test-checkpoint': { blockNumber: '110', blockHash: hash('aa') } } } };
    const lockedMaterialization = materialization.clearTradeHistoryV2MaterializationScope({
      previous: lockedState.materialization, chainId: '7', contractAddress: address('1f'), expectedRevision: 0 });
    mocks.sync.mockResolvedValueOnce({ status: 'applied', state: { ...lockedState, materialization: lockedMaterialization },
      hasMore: false, reorged: false, safeHead: '110' });
    const deployments = runtime.deployments;
    try {
      await runtime.sync([address('1f')]);
      expect(runtime.rows()[0].amountState).toBe('unavailable');
      await runtime.sync([address('1e')]);
      expect(runtime.rows()).toHaveLength(2);
      runtime.lifecycleEvents(); expect(lifecycle).toHaveBeenCalled(); lifecycle.mockClear();
      privateScope = { key: 'owner:unlocked:1', enabled: true };
      expect(runtime.rows()).toEqual([]); expect(runtime.orders()).toEqual([]); expect(runtime.lifecycleEvents()).toEqual([]);
      expect(lifecycle).not.toHaveBeenCalled();
      const hydrated = stateFor('private-v2', 1, '1', true);
      mocks.sync.mockResolvedValueOnce({ status: 'applied', state: hydrated, hasMore: false, reorged: false, safeHead: '110' });
      await runtime.sync([address('1f')]);
      const enabledInput = mocks.sync.mock.calls[2][0];
      expect(enabledInput.previous.sync.checkpointsByScope).toBe(lockedState.sync.checkpointsByScope);
      expect(enabledInput.previous.sync.ledger.observationsByPhysicalKey).toEqual({});
      expect(enabledInput.rebuildProjection).toBe(true);
      expect(enabledInput.expectedLedgerRevision).toBe(0); expect(enabledInput.expectedMaterializationRevision).toBe(0);
      expect(enabledInput.resolvePrivateReceiptAmounts).toBeTypeOf('function'); expect(enabledInput.resolveDirectPrivateAmounts).toBeTypeOf('function');
      expect(runtime.rows()).toMatchObject([{ amountState: 'available', amounts: { offerAmount: '2', requestAmount: '4' } }]);
      await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls[3][0].previous).toBe(hydrated);
      expect(mocks.sync.mock.calls[3][0].rebuildProjection).toBe(false);
      await runtime.sync([address('1e')]);
      expect(mocks.sync.mock.calls[4][0].previous.sync.ledger.observationsByPhysicalKey).toEqual({});
      expect(mocks.sync.mock.calls[4][0].previous.materialization.directChatEntriesByPhysicalKey).toEqual({});
      expect(mocks.sync.mock.calls[4][0].rebuildProjection).toBe(true);
      expect(runtime.rows()).toHaveLength(2);
      expect(runtime.deployments).toBe(deployments);
      expect(mocks.bind).toHaveBeenCalledOnce(); expect(mocks.attest).toHaveBeenCalledTimes(3);
    } finally { lifecycle.mockRestore(); runtime.close(); }
  });

  it('clears all previous private projections even when the new generation refreshes only one deployment', async () => {
    let privateScope = { key: 'unlocked:1', enabled: true };
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {}, getPrivateReadScope: () => privateScope });
    mocks.sync.mockImplementation(async ({ deployment }) => ({ status: 'applied',
      state: stateFor(deployment.protocol, protocols.indexOf(deployment.protocol), '1', true),
      hasMore: false, reorged: false, safeHead: '110' }));
    try {
      await runtime.sync([address('1f'), address('20')]);
      expect(runtime.rows()).toHaveLength(2);
      privateScope = { key: 'unlocked:2', enabled: true };
      await runtime.sync([address('1f')]);
      expect(runtime.rows()).toHaveLength(1);
      await runtime.sync([address('20')]);
      const input = mocks.sync.mock.calls[3][0];
      expect(input.previous.sync.ledger.observationsByPhysicalKey).toEqual({});
      expect(input.previous.materialization.directChatEntriesByPhysicalKey).toEqual({});
      expect(input.rebuildProjection).toBe(true);
    } finally { runtime.close(); }
    expect(runtime.rows()).toEqual([]);
  });

  it('rejects active and queued old-generation work across unlock-lock-unlock and hides old rows immediately', async () => {
    let privateScope = { key: 'owner:unlocked:0', enabled: true }, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {},
      getOwnerCapability: async () => ({} as never), getPrivateReadScope: () => privateScope });
    await runtime.sync([address('1f')]);
    mocks.sync.mockImplementationOnce(async args => { await held; return { status: 'applied', state: args.previous,
      hasMore: false, reorged: false, safeHead: '110' }; });
    const active = runtime.sync([address('1f')]), queued = runtime.sync([address('1f')]);
    const settled = Promise.allSettled([active, queued]);
    try {
      await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
      const activeInput = mocks.sync.mock.calls[1][0];
      privateScope.key = 'owner:locked:1'; privateScope.enabled = false;
      expect(activeInput.shouldContinue()).toBe(false);
      expect(runtime.rows()).toEqual([]); expect(runtime.orders()).toEqual([]); expect(runtime.lifecycleEvents()).toEqual([]);
      privateScope = { key: 'owner:unlocked:2', enabled: true };
      expect(activeInput.shouldContinue()).toBe(false); expect(runtime.rows()).toEqual([]);
      release();
      for (const result of await settled) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason.message).toMatch(/private.*scope.*changed/i);
      }
      expect(mocks.sync).toHaveBeenCalledTimes(2); expect(runtime.rows()).toEqual([]);
      await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls[2][0].expectedLedgerRevision).toBe(0);
      expect(mocks.sync.mock.calls[2][0].rebuildProjection).toBe(true);
      expect(runtime.rows()).toHaveLength(1); expect(mocks.attest).toHaveBeenCalledTimes(3);
    } finally { release(); await settled; runtime.close(); }
  });

  it('rejects a private generation change made only by the outer final guard before publishing staged states', async () => {
    let privateScope = { key: 'owner:unlocked:0', enabled: true }, checks = 0;
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() },
      getPrivateReadScope: () => privateScope,
      assertCurrent: () => { if (++checks === 3) privateScope = { key: 'owner:locked:1', enabled: false }; } });
    try {
      await expect(runtime.sync([address('1f')])).rejects.toThrow(/private.*scope.*changed/i);
      expect(runtime.rows()).toEqual([]); expect(runtime.orders()).toEqual([]);
      await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls.map(([args]) => args.expectedLedgerRevision)).toEqual([0, 0]);
      expect(mocks.attest).toHaveBeenCalledTimes(3);
    } finally { runtime.close(); }
  });

  it('preserves custom private resolvers and committed pipeline state when no private scope option is supplied', async () => {
    const receipt = vi.fn(async () => ({ offerAmount: '2', requestAmount: '4' }));
    const direct = vi.fn(async () => ({ offerAmount: '2', requestAmount: '4' }));
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never,
      ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {},
      resolvePrivateReceiptAmounts: receipt, resolveDirectPrivateAmounts: direct });
    try {
      await runtime.sync([address('1f')]); await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls[0][0].resolvePrivateReceiptAmounts).toBe(receipt);
      expect(mocks.sync.mock.calls[0][0].resolveDirectPrivateAmounts).toBe(direct);
      expect(mocks.sync.mock.calls[1][0].expectedLedgerRevision).toBe(1);
      expect(runtime.rows()).toHaveLength(1);
    } finally { runtime.close(); }
  });
  it('scans only the three current contracts and routes exact current private receipts', async () => {
    const runtime = await create();
    const result = await runtime.sync();
    expect(mocks.attest).toHaveBeenCalledTimes(3); expect(mocks.sync).toHaveBeenCalledTimes(3);
    expect(runtime.rows()).toHaveLength(3); expect(runtime.orders()).toHaveLength(3);
    expect(result.byProtocol['private-v2']).toMatchObject({ hasMore: false, reorged: false, safeHead: '110' });
    const privateInput = mocks.sync.mock.calls.find(([args]) => args.deployment.protocol === 'private-v2')![0];
    await privateInput.resolvePrivateReceiptAmounts({ protocol: 'private-v2', chainId: '7', contractAddress: address('1f') });
    expect(mocks.decrypt).toHaveBeenLastCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ contractAddress: address('1f') }) }));
    await privateInput.resolveDirectPrivateAmounts({ opened: { protocol: 'direct-v2', chainId: '7', contractAddress: address('20'), orderId: '1' } });
    expect(mocks.direct).toHaveBeenLastCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ contractAddress: address('20') }), tradeId: '1' }));
    await expect(privateInput.resolvePrivateReceiptAmounts({ protocol: 'private-v2', chainId: '7', contractAddress: address('3d') })).rejects.toThrow(/deployment/);
    runtime.close(); await expect(runtime.sync()).rejects.toThrow(/closed/);
  });
  it('completes current Book history and rejects old scopes without admission or scanning', async () => {
    const runtime = await create();
    await runtime.sync([address('1f')]);
    const calls = mocks.sync.mock.calls.length;
    await expect(runtime.sync([address('3d')])).rejects.toThrow(/history scope/i);
    expect(mocks.sync).toHaveBeenCalledTimes(calls); expect(mocks.attest).toHaveBeenCalledTimes(3);
    expect(runtime.rows()).toHaveLength(1);
    runtime.close();
  });
  it('rejects an unbound history scope before any deferred admission or scan', async () => {
    const runtime = await create('admitted');
    mocks.attest.mockClear();
    await expect(runtime.sync([address('3d'), address('ff')])).rejects.toThrow(/history scope/i);
    expect(mocks.attest).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    runtime.close();
  });

  it('commits no scope if one current read fails, then retries the same previous revisions', async () => {
    const implementation = mocks.sync.getMockImplementation()!, runtime = await create();
    let fail = true;
    mocks.sync.mockImplementation(async args => {
      if (args.deployment.contractAddress === address('1f') && fail) { fail = false; throw new Error('Current read unavailable'); }
      return implementation(args);
    });
    await expect(runtime.sync()).rejects.toThrow(/unavailable/); expect(runtime.rows()).toEqual([]);
    await runtime.sync(); expect(runtime.rows()).toHaveLength(3);
    expect(mocks.sync.mock.calls.every(([args]) => args.expectedLedgerRevision === 0)).toBe(true);
  });
  it('does not commit results if the runtime closes during its final session check', async () => {
    let checks = 0;
    const runtime: Awaited<ReturnType<typeof createOtcTradeHistoryV2Runtime>> = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() }, assertCurrent: (): void => { if (++checks === 2) runtime.close(); } });
    await expect(runtime.sync()).rejects.toThrow(/closed before commit/);
    expect(runtime.rows()).toEqual([]);
  });
  it('keeps current scan rows and revisions unchanged when only the outer final assertion fails', async () => {
    let checks = 0;
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() },
      assertCurrent: () => { if (++checks === 3) throw new Error('Final scan scope changed'); } });
    try {
      await expect(runtime.sync([address('1f')])).rejects.toThrow('Final scan scope changed');
      expect(runtime.rows()).toEqual([]); expect(runtime.orders()).toEqual([]);
      await runtime.sync([address('1f')]);
      expect(mocks.sync.mock.calls.map(([args]) => args.expectedLedgerRevision)).toEqual([0, 0]);
      expect(mocks.sync.mock.calls.map(([args]) => args.expectedMaterializationRevision)).toEqual([0, 0]);
      expect(runtime.rows()).toHaveLength(1);
    } finally { runtime.close(); }
  });
  it('rejects conflicting manifests for the same escrow instead of choosing one', async () => {
    const catalog = catalogFor('admitted');
    catalog.deployments['private-v2'].manifest = { ...catalog.deployments['private-v2'].manifest, contractAddress: catalog.deployments['standard-v2'].manifest.contractAddress };
    await expect(createOtcTradeHistoryV2Runtime({ catalog: catalog as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() }, assertCurrent: () => {} })).rejects.toThrow(/ambiguous/);
    expect(mocks.attest).not.toHaveBeenCalled();
  });
});
