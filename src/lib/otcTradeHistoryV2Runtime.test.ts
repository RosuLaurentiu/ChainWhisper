import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTradeHistoryV2LedgerState,
  replaceTradeHistoryV2Range,
  type TradeHistoryV2Protocol
} from './tradeHistoryV2Ledger';
import { createTradeHistoryV2MaterializationState } from './tradeHistoryV2Materialize';
import {
  assertOtcTradeHistoryV2Runtime,
  createOtcTradeHistoryV2Runtime,
  projectOtcTradeHistoryV2Portfolio
} from './otcTradeHistoryV2Runtime';
import type { TradeHistoryV2PipelineState } from './tradeHistoryV2Pipeline';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';

const mocks = vi.hoisted(() => ({ bind: vi.fn(), attest: vi.fn(), sync: vi.fn(), decrypt: vi.fn(), direct: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', async original => ({ ...await original<typeof import('./tradeHistoryV2Chain')>(),
  bindTradeHistoryV2ReadCapability: mocks.bind,
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
  'standard-v2', 'private-v2', 'direct-v2', 'recurring-v2', 'private-recurring-v2'
];

const stateFor = (protocol: TradeHistoryV2Protocol, index: number, orderId = String(index + 1)): TradeHistoryV2PipelineState => {
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
        side: protocol.includes('recurring') ? 'buy' : 'fill',
        source: 'public-event',
        amounts: protocol.includes('recurring')
          ? { baseAmount: '3', quoteAmount: '6' }
          : { offerAmount: '2', requestAmount: '4' },
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
  it('keeps current and retained instances with the same local ID in the portfolio', () => {
    const states = Object.fromEntries(protocols.map((protocol, index) => [protocol, stateFor(protocol, index)]));
    states.retained = stateFor('private-v2', 8, '2');
    const portfolio = projectOtcTradeHistoryV2Portfolio({ states, viewerAddress: VIEWER });
    expect(portfolio.rows).toHaveLength(6);
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
    expect(portfolio.orders).toHaveLength(5);
    expect(portfolio.orders[0]).toMatchObject({
      executionCount: '1', exactExecutionCount: '1', offerAmount: '2', requestAmount: '4'
    });
    expect(portfolio.orders[4]).toMatchObject({
      executionCount: '1', exactExecutionCount: '1', baseAmount: '3', quoteAmount: '6'
    });
  });

  it('rejects a structural runtime lookalike', () => {
    expect(() => assertOtcTradeHistoryV2Runtime({} as never)).toThrow(/verified factory/i);
  });
});

describe('OTC current and retained history discovery', () => {
  const catalogFor = (status: 'prepared' | 'book-admitted' | 'admitted') => {
    const current = Object.fromEntries(protocols.map((protocol, index) => [protocol, { protocol, manifest: {
      protocol, chainId: '7', contractAddress: address((30 + index).toString(16)), deploymentBlock: '1', runtimeBytecodeHash: hash('22')
    } }]));
    const retained = Object.fromEntries(protocols.map((protocol, index) => [protocol, index < 3 ? { protocol, manifest: {
      ...current[protocol].manifest, contractAddress: address((60 + index).toString(16)) } } : current[protocol]]));
    return { status: 'active' as const, chainId: '7', deployments: current, finalityLagBlocks: 1n,
      preparedP2p: { status, retainedDeployments: retained } };
  };
  const create = (status: 'prepared' | 'book-admitted' | 'admitted' = 'admitted') => createOtcTradeHistoryV2Runtime({
    catalog: catalogFor(status) as never, ownerAddress: VIEWER, provider: { request: vi.fn() }, assertCurrent: () => {}, getOwnerCapability: async () => ({} as never)
  });
  beforeEach(() => {
    vi.clearAllMocks(); mocks.bind.mockResolvedValue({}); mocks.attest.mockImplementation(async ({ manifest }) => manifest);
    mocks.decrypt.mockResolvedValue({ offerAmount: '2', requestAmount: '4' }); mocks.direct.mockResolvedValue({ offerAmount: '2', requestAmount: '4' });
    mocks.sync.mockImplementation(async ({ deployment }) => {
      const index = protocols.indexOf(deployment.protocol), old = deployment.contractAddress === address((60 + index).toString(16));
      return { status: 'applied', state: stateFor(deployment.protocol, old ? 30 + index : index, '1'),
        hasMore: old && index === 1, reorged: old && index === 1, safeHead: old ? '100' : '110' };
    });
  });
  it('leaves retained Link activity to its own reader without adding a base-history startup scan', async () => {
    const catalog = catalogFor('book-admitted');
    Object.assign(catalog.preparedP2p.retainedDeployments, { oldLink: { protocol: 'link-v2',
      manifest: { protocol: 'link-v2', chainId: '7', contractAddress: address('ee'), deploymentBlock: '1', runtimeBytecodeHash: hash('ef') } } });
    const runtime = await createOtcTradeHistoryV2Runtime({ catalog: catalog as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() }, assertCurrent: () => {}, getOwnerCapability: async () => ({} as never) });
    expect(mocks.attest).toHaveBeenCalledTimes(8);
    expect(mocks.attest.mock.calls.some(([input]) => input.manifest.protocol === 'link-v2')).toBe(false);
    runtime.close();
  });
  it('automatically scans eight unique instances and keeps retained same-ID rows and exact receipt routing', async () => {
    const runtime = await create();
    const result = await runtime.sync();
    expect(mocks.attest).toHaveBeenCalledTimes(8); expect(mocks.sync).toHaveBeenCalledTimes(8);
    expect(runtime.retainedDeployments).toHaveLength(3);
    expect(runtime.retainedDeployments?.map(item => item.contractAddress)).toEqual([address('3c'), address('3d'), address('3e')]);
    expect(runtime.rows()).toHaveLength(8); expect(runtime.orders()).toHaveLength(8);
    expect(new Set(runtime.rows().map(row => row.order.contractAddress)).size).toBe(8);
    expect(result.byProtocol['private-v2']).toMatchObject({ hasMore: true, reorged: true, safeHead: '100' });
    expect(runtime.deployments['private-v2'].contractAddress).toBe(address('1f'));
    const privateInput = mocks.sync.mock.calls.find(([args]) => args.deployment.protocol === 'private-v2')![0];
    await privateInput.resolvePrivateReceiptAmounts({ protocol: 'private-v2', chainId: '7', contractAddress: address('3d') });
    expect(mocks.decrypt).toHaveBeenLastCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ contractAddress: address('3d') }) }));
    await privateInput.resolveDirectPrivateAmounts({ opened: { protocol: 'direct-v2', chainId: '7', contractAddress: address('3e'), orderId: '1' } });
    expect(mocks.direct).toHaveBeenLastCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ contractAddress: address('3e') }), tradeId: '1' }));
    await expect(privateInput.resolvePrivateReceiptAmounts({ protocol: 'private-v2', chainId: '1', contractAddress: address('3d') })).rejects.toThrow(/deployment/);
    runtime.close(); await expect(runtime.sync()).rejects.toThrow(/closed/);
  });
  it('keeps prepared mode on five selected instances with no retained scan', async () => {
    const runtime = await create('prepared'); await runtime.sync();
    expect(runtime.retainedDeployments).toEqual([]);
    expect(mocks.attest).toHaveBeenCalledTimes(5); expect(mocks.sync).toHaveBeenCalledTimes(5); expect(runtime.rows()).toHaveLength(5);
  });
  it('completes current Book history without scanning unrelated or retained deployments', async () => {
    const runtime = await create();
    const result = await runtime.sync([address('1f')]);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ maxBlockSpan: 2_048n, overlapBlocks: 16n }));
    expect(mocks.sync.mock.calls.map(([args]) => args.deployment.contractAddress)).toEqual([address('1f')]);
    expect(result.hasMore).toBe(false);
    expect(Object.keys(result.byProtocol)).toEqual(['private-v2']);
    expect(runtime.rows()).toHaveLength(1);
    // A later explicit recovery read must not erase the current Book checkpoint.
    await runtime.sync([address('3d')]);
    expect(runtime.rows()).toHaveLength(2);
    expect(runtime.retainedDeployments).toHaveLength(3);
  });
  it('rejects an unbound history scope before scanning', async () => {
    const runtime = await create();
    await expect(runtime.sync([address('ff')])).rejects.toThrow(/history scope/i);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('includes retained owner history when only the repaired Book is admitted', async () => {
    const runtime = await create('book-admitted'); await runtime.sync();
    expect(runtime.retainedDeployments?.map(item => item.contractAddress)).toContain(address('3d'));
    expect(runtime.orders()).toHaveLength(8);
    runtime.close();
  });
  it('commits no scope if one retained read fails, then retries the same previous revisions', async () => {
    const implementation = mocks.sync.getMockImplementation()!, runtime = await create();
    let fail = true;
    mocks.sync.mockImplementation(async args => {
      if (args.deployment.contractAddress === address('3d') && fail) { fail = false; throw new Error('Retained read unavailable'); }
      return implementation(args);
    });
    await expect(runtime.sync()).rejects.toThrow(/unavailable/); expect(runtime.rows()).toEqual([]);
    await runtime.sync(); expect(runtime.rows()).toHaveLength(8);
    expect(mocks.sync.mock.calls.every(([args]) => args.expectedLedgerRevision === 0)).toBe(true);
  });
  it('does not commit results if the runtime closes during its final session check', async () => {
    let checks = 0;
    const runtime: Awaited<ReturnType<typeof createOtcTradeHistoryV2Runtime>> = await createOtcTradeHistoryV2Runtime({ catalog: catalogFor('admitted') as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() }, assertCurrent: (): void => { if (++checks === 2) runtime.close(); } });
    await expect(runtime.sync()).rejects.toThrow(/closed before commit/);
    expect(runtime.rows()).toEqual([]);
  });
  it('rejects conflicting manifests for the same escrow instead of choosing one', async () => {
    const catalog = catalogFor('admitted');
    catalog.preparedP2p.retainedDeployments['private-v2'].manifest = { ...catalog.deployments['private-v2'].manifest, runtimeBytecodeHash: hash('99') };
    await expect(createOtcTradeHistoryV2Runtime({ catalog: catalog as never, ownerAddress: VIEWER,
      provider: { request: vi.fn() }, assertCurrent: () => {} })).rejects.toThrow(/ambiguous/);
    expect(mocks.attest).not.toHaveBeenCalled();
  });
});
