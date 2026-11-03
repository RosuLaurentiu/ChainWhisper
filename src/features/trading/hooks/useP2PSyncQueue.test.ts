import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useP2PSyncQueue from './useP2PSyncQueue';

const state = vi.hoisted(() => ({ busy: false, walletActive: false }));
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => effect()
}));
vi.mock('../../../lib/appShared', () => ({ REALTIME_SYNC_DEBOUNCE_MS: 500 }));
vi.mock('../../../lib/walletTransactionFlow', () => ({
  isWalletTransactionFlowActive: () => state.walletActive,
  recordWalletTransactionFlowStage: vi.fn()
}));

const mount = () => {
  const flush = { current: () => {} };
  const balances = vi.fn(async () => {}), mine = vi.fn(async () => {}), publicTrades = vi.fn(async () => {});
  const input = {
    flushQueuedTradeDataRefreshRef: flush,
    getTradeWalletFlowInput: () => ({}),
    hasActiveListRefresh: () => state.busy,
    refreshAllTradingBalances: balances,
    refreshMyTrades: mine,
    refreshPublicTrades: publicTrades,
    refreshTradeDetail: vi.fn(async () => null),
    routeView: 'mine', routeTradeId: null, walletAddress: 'owner'
  };
  // Exercise the existing queue closure with controlled effects and timers.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const queue = useP2PSyncQueue(input);
  return { ...queue, flush, balances, mine, publicTrades, detail: input.refreshTradeDetail };
};

beforeEach(() => {
  vi.useFakeTimers(); state.busy = false; state.walletActive = false;
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => { vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('P2P refresh queue at the reader boundary', () => {
  it('retains one exact counter detail refresh through a wallet hold without a second hint or discovery', async () => {
    const q = mount(), escrow = '0xd46cd0ab08d94cb831a82424475a8d7250673528';
    state.walletActive = true;
    for (let hint = 0; hint < 3; hint++) q.scheduleP2PSync({ domains: ['trade-detail'], reason: 'chain-event', tradeId: 10, escrowContract: escrow });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(q.detail).not.toHaveBeenCalled();
    state.walletActive = false; q.flush.current(); await Promise.resolve();
    expect(q.detail).toHaveBeenCalledExactlyOnceWith(10, escrow, { silent: true });
    expect(q.balances).not.toHaveBeenCalled(); expect(q.mine).not.toHaveBeenCalled(); expect(q.publicTrades).not.toHaveBeenCalled();
  });
  it.each(['focus', 'interval', 'chain-event'] as const)('preserves the %s reason at the balance reader', async reason => {
    const q = mount();
    q.scheduleP2PSync({ domains: ['balances'], reason });
    await vi.advanceTimersByTimeAsync(500);
    expect(q.balances).toHaveBeenCalledExactlyOnceWith({ reason, signer: undefined, silent: true });
  });

  it('keeps a queued wallet action stronger than a later automatic request', async () => {
    const q = mount(); state.walletActive = true;
    q.scheduleP2PSync({ domains: ['balances'], reason: 'wallet-action' });
    q.scheduleP2PSync({ domains: ['public-trades'], reason: 'focus' });
    state.walletActive = false; q.flush.current();
    expect(q.balances).toHaveBeenCalledExactlyOnceWith({ reason: 'wallet-action', signer: undefined, silent: true });
    expect(q.publicTrades).toHaveBeenCalledOnce();
  });

  it('coalesces repeated five-second hints during an active History read and runs once after it finishes', async () => {
    const q = mount(); state.busy = true;
    for (let hint = 0; hint < 6; hint++) {
      q.scheduleP2PSync({ domains: ['balances', 'wallet-trades'], reason: hint ? 'interval' : 'chain-event' });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(q.balances).not.toHaveBeenCalled(); expect(q.mine).not.toHaveBeenCalled();
    state.busy = false; q.flush.current();
    await Promise.resolve();
    expect(q.balances).toHaveBeenCalledOnce(); expect(q.mine).toHaveBeenCalledOnce();
    q.flush.current();
    expect(q.mine).toHaveBeenCalledOnce();
  });

  it('rechecks busy state when a debounce expires and retains every requested domain', async () => {
    const q = mount();
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'chain-event' });
    state.busy = true;
    await vi.advanceTimersByTimeAsync(500);
    q.scheduleP2PSync({ domains: ['public-trades'], reason: 'focus' });
    await vi.advanceTimersByTimeAsync(500);
    expect(q.mine).not.toHaveBeenCalled(); expect(q.publicTrades).not.toHaveBeenCalled();
    state.busy = false; q.flush.current();
    expect(q.mine).toHaveBeenCalledOnce(); expect(q.publicTrades).toHaveBeenCalledOnce();
  });

  it('does not turn busy fallback ticks into a continuous catch-up loop', async () => {
    const q = mount(); state.busy = true;
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'interval' });
    await vi.advanceTimersByTimeAsync(5_000);
    state.busy = false; q.flush.current();
    expect(q.mine).not.toHaveBeenCalled();
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'interval' });
    state.busy = true;
    await vi.advanceTimersByTimeAsync(500);
    state.busy = false; q.flush.current();
    expect(q.mine).not.toHaveBeenCalled();
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'interval' });
    await vi.advanceTimersByTimeAsync(500);
    expect(q.mine).toHaveBeenCalledOnce();
  });

  it('preserves wallet-flow holds and lets an explicit manual refresh proceed', async () => {
    const q = mount(); state.walletActive = true;
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'chain-event' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(q.mine).not.toHaveBeenCalled();
    state.walletActive = false; state.busy = true;
    q.scheduleP2PSync({ domains: ['wallet-trades'], reason: 'manual' });
    expect(q.mine).toHaveBeenCalledOnce();
  });
});
