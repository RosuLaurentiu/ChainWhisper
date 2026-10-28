import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, busy: true, walletActive: false }));
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { state.cleanup = effect(); } }));
vi.mock('../../../lib/appShared', () => ({
  DIRECT_TRADE_ESCROW_CONTRACT_ABI: [], DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS: '',
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI: [], PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS: '',
  RECURRING_OTC_CONTRACT_ABI: [], RECURRING_OTC_CONTRACT_ADDRESS: '',
  TRADE_ESCROW_CONTRACT_ABI: [], TRADE_ESCROW_CONTRACT_ADDRESS: '',
  REALTIME_SYNC_BURST_THROTTLE_MS: 2_000, REALTIME_SYNC_DEBOUNCE_MS: 500,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS: 30_000, WS_HEALTHCHECK_TTL_MS: 60_000, WS_RETRY_COOLDOWN_MS: 60_000,
  getCotiWsLastHealthyAt: () => Date.now(), markCotiWsHealthyNow: vi.fn(), resetCotiWsProvider: vi.fn(),
  loadCotiEthersModule: async () => ({ Contract: class { filters = {}; } }), loadCotiWsProvider: vi.fn(async () => ({}))
}));
vi.mock('../../../lib/walletTransactionFlow', () => ({
  isWalletTransactionFlowActive: () => state.walletActive, recordWalletTransactionFlowStage: vi.fn()
}));
vi.mock('../components/P2PTradingPage.helpers', () => ({ P2P_VISIBLE_SYNC_INTERVAL_MS: 20_000 }));

import useP2PRealtimeSync from './useP2PRealtimeSync';
import { loadCotiWsProvider } from '../../../lib/appShared';

afterEach(() => { state.cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('P2P automatic refresh admission', () => {
  it('does not restart an in-flight read through the delayed refresh branch', async () => {
    vi.useFakeTimers(); state.busy = true; state.walletActive = false;
    vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const schedule = vi.fn();
    useP2PRealtimeSync({ chainId: 7082400, walletAddress: 'owner', routeTradeId: 1,
      routeView: 'trade', getTradeWalletFlowInput: () => ({}), hasActiveListRefresh: () => state.busy,
      scheduleP2PSync: schedule });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(schedule).not.toHaveBeenCalled();
    expect(loadCotiWsProvider).not.toHaveBeenCalled();
    state.busy = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(schedule).toHaveBeenCalledTimes(1);
    state.walletActive = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
