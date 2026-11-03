import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useP2PTradeData from './useP2PTradeData';
import type { TradeSnapshot } from '../../../lib/appShared/core';
import { fetchRecentTradeSnapshots, fetchTradeSnapshotById, fetchWalletTradeSnapshots } from '../../../lib/appChain';

// Exercise the hook's effects and cleanup using the existing hook-test pattern.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const i = hooks.index++, previous = hooks.slots[i];
    if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) hooks.slots[i] = { value: factory(), deps };
    return hooks.slots[i].value;
  };
  return { ...actual,
    useRef: (initial: unknown) => (hooks.slots[hooks.index++] ??= { value: { current: initial } }).value,
    useState: (initial: unknown) => {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks.slots[i].value, (value: unknown) => {
        hooks.slots[i].value = typeof value === 'function' ? value(hooks.slots[i].value) : value;
      }];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, previous = hooks.slots[i];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) {
        hooks.slots[i] = { deps, cleanup: previous?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});
vi.mock('../../../lib/appChain', () => ({
  fetchRecentTradeSnapshots: vi.fn(async () => []),
  fetchWalletTradeSnapshots: vi.fn(async () => []),
  fetchTradeSnapshotById: vi.fn(), fetchTradeAccessMetadataById: vi.fn()
}));
vi.mock('../../../lib/walletTransactionFlow', () => ({ getWalletTransactionFlowState: () => 'inactive' }));

const owner = `0x${'11'.repeat(20)}`;
const snapshot = { tradeId: 3, escrowContract: `0x${'22'.repeat(20)}`, maker: owner,
  taker: `0x${'00'.repeat(20)}`, status: 'expired', hiddenLiquidity: false,
  offer: { kind: 'erc20', tokenAddress: owner, symbol: 'OLD', decimals: 6, amount: '10' },
  request: { kind: 'erc20', tokenAddress: owner, symbol: 'OLD2', decimals: 6, amount: '20' },
  createdAt: 1, expiresAt: 2 } as TradeSnapshot;
let session = 0;
function fixture(listDiscoveryEnabled: boolean, syncSessionKey = `legacy-discovery-${++session}`) {
  const args = { listDiscoveryEnabled, syncSessionKey, walletAddress: owner, walletKey: owner,
    walletReadAccounts: [{ address: owner, key: owner, canReadPrivate: true, isActionAccount: true, label: 'Owner', role: 'owner' as const }],
    rewardTokenSymbol: 'WISP', rewardTokenDecimals: 18, privateRewardTokenSymbol: 'pWISP', privateRewardTokenDecimals: 18,
    resolvedRouteAccessSecret: '', routeError: '', routeTradeId: null, routeView: 'mine' as const,
    enrichMakerPrivateProgress: async (row: TradeSnapshot) => row };
  const Render = () => {
    hooks.index = 0;
    const result = useP2PTradeData(args);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  return { args, render: Render };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('window', globalThis);
  vi.mocked(fetchRecentTradeSnapshots).mockResolvedValue([]);
  vi.mocked(fetchWalletTradeSnapshots).mockResolvedValue([]);
});
afterEach(() => {
  hooks.slots.forEach(slot => slot.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('does not start automatic or manual legacy list work when disabled', async () => {
  const f = fixture(false);
  f.render(); await settle();
  let state = f.render();
  expect(state.hasActiveListRefresh()).toBe(false);
  expect(state.loadingMyTrades || state.loadingPublicTrades).toBe(false);
  await state.refreshPublicTrades(); await state.refreshMyTrades();
  await vi.advanceTimersByTimeAsync(3_000);
  state = f.render();
  expect(fetchRecentTradeSnapshots).not.toHaveBeenCalled();
  expect(fetchWalletTradeSnapshots).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(state.publicTrades).toEqual([]); expect(state.myTrades).toEqual([]);
});

it('keeps supported discovery enabled', async () => {
  vi.mocked(fetchRecentTradeSnapshots).mockResolvedValue([snapshot]);
  vi.mocked(fetchWalletTradeSnapshots).mockResolvedValue([snapshot]);
  const f = fixture(true); f.render(); await settle();
  const state = f.render();
  expect(fetchRecentTradeSnapshots).toHaveBeenCalledTimes(1);
  expect(fetchWalletTradeSnapshots).toHaveBeenCalledTimes(1);
  expect(state.publicTrades[0]?.tradeId).toBe(3);
  expect(state.myTrades[0]?.tradeId).toBe(3);
});

it('keeps explicit detail reads and V2 snapshot merges when legacy lists are disabled', async () => {
  vi.mocked(fetchTradeSnapshotById).mockResolvedValue(snapshot);
  const f = fixture(false); const state = f.render();
  expect(await state.readTradeDetail(3, snapshot.escrowContract)).toEqual(snapshot);
  state.mergeTradeSnapshot(snapshot); await settle();
  expect(f.render().myTrades[0]?.tradeId).toBe(3);
  expect(fetchRecentTradeSnapshots).not.toHaveBeenCalled();
  expect(fetchWalletTradeSnapshots).not.toHaveBeenCalled();
});

it('does not restore unsupported list cache when mounted with discovery disabled', async () => {
  vi.mocked(fetchRecentTradeSnapshots).mockResolvedValue([snapshot]);
  vi.mocked(fetchWalletTradeSnapshots).mockResolvedValue([snapshot]);
  const f = fixture(true); f.render(); await settle(); f.render(); f.render();
  hooks.slots.forEach(slot => slot.cleanup?.()); hooks.slots = []; hooks.effects = [];
  const disabled = fixture(false, f.args.syncSessionKey); disabled.render();
  const state = disabled.render();
  expect(state.publicTrades).toEqual([]); expect(state.myTrades).toEqual([]);
});

it('does not publish or retry an old pending list after discovery is disabled', async () => {
  let resolve!: (rows: TradeSnapshot[]) => void;
  vi.mocked(fetchRecentTradeSnapshots).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const f = fixture(true); f.render(); await settle();
  f.args.listDiscoveryEnabled = false; f.render();
  resolve([snapshot]); await settle();
  const disabled = f.render();
  expect(disabled.publicTrades).toEqual([]);
  expect(disabled.hasActiveListRefresh()).toBe(false);
  expect(disabled.loadingPublicTrades).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  f.args.listDiscoveryEnabled = true; f.render();
  await vi.advanceTimersByTimeAsync(3_000); await settle();
  expect(fetchRecentTradeSnapshots).toHaveBeenCalledTimes(4);
  expect(f.render().hasActiveListRefresh()).toBe(false);
});
