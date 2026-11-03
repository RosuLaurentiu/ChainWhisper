import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CotiEventHintSubscription } from '../../../lib/appShared/cotiEventHints';

const state = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, walletActive: false,
  configuredChain: 7082400, subscribe: vi.fn(), stop: vi.fn(), request: undefined as CotiEventHintSubscription | undefined }));
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { state.cleanup = effect(); } }));
vi.mock('../../../lib/appShared/cotiEventHints', () => ({ subscribeCotiEventHints: state.subscribe }));
vi.mock('../../../lib/appShared', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/appShared')>();
  return {
    REALTIME_SYNC_BURST_THROTTLE_MS: actual.REALTIME_SYNC_BURST_THROTTLE_MS,
    REALTIME_SYNC_DEBOUNCE_MS: actual.REALTIME_SYNC_DEBOUNCE_MS,
    REALTIME_SYNC_FALLBACK_INTERVAL_MS: actual.REALTIME_SYNC_FALLBACK_INTERVAL_MS,
    COTI_NETWORK: { get chainIdDecimal() { return state.configuredChain; } },
    TRADE_ESCROW_CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS: '0x2222222222222222222222222222222222222222',
    DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS: '0x3333333333333333333333333333333333333333',
    RECURRING_OTC_CONTRACT_ADDRESS: '0x4444444444444444444444444444444444444444'
  };
});
vi.mock('../../../lib/walletTransactionFlow', () => ({
  isWalletTransactionFlowActive: () => state.walletActive, recordWalletTransactionFlowStage: vi.fn()
}));
vi.mock('../components/P2PTradingPage.helpers', () => ({ P2P_VISIBLE_SYNC_INTERVAL_MS: 20_000 }));

import useP2PRealtimeSync from './useP2PRealtimeSync';
import { CURRENT_P2P_BINDING } from '../../../lib/currentP2PBinding';

const mount = (routeView = 'trade', chainId = Number(CURRENT_P2P_BINDING.chainId)) => {
  const schedule = vi.fn();
  // The local harness invokes the hook and controls its effect lifetime.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useP2PRealtimeSync({ chainId, walletAddress: 'owner', routeTradeId: 1,
    routeView, getTradeWalletFlowInput: () => ({}),
    scheduleP2PSync: schedule });
  return schedule;
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.walletActive = false; state.request = undefined;
  state.configuredChain = 7082400;
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.subscribe.mockImplementation(async (request: CotiEventHintSubscription) => {
    state.request = request; request.onStatus?.('connected'); return state.stop;
  });
});
afterEach(() => { state.cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('P2P automatic refresh admission', () => {
  it('does not repeat owner discovery every five seconds while the socket is unavailable', async () => {
    state.subscribe.mockImplementation(async (request: CotiEventHintSubscription) => {
      state.request = request; request.onStatus?.('reconnecting'); return state.stop;
    });
    const schedule = mount('mine'); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(schedule).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      reason: 'interval', domains: ['balances', 'wallet-trades']
    }));
  });

  it.each([
    ['mine', ['balances', 'wallet-trades']],
    ['public', ['balances', 'public-trades']],
    ['trade', ['balances', 'trade-detail']]
  ])('limits %s socket refresh to the visible domains', async (routeView, domains) => {
    const schedule = mount(routeView as string); await Promise.resolve();
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(2_000);
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0][0].domains).toEqual(domains);
  });

  it('retains configured Mainnet legacy event hints with the same guarded fallback', async () => {
    state.configuredChain = 2632500;
    const schedule = mount('mine', 2632500); await Promise.resolve();
    expect(state.request?.address).toEqual([
      '0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333', '0x4444444444444444444444444444444444444444'
    ]);
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(2_000);
    expect(schedule).toHaveBeenCalledOnce();
    state.request?.onStatus?.('reconnecting'); await vi.advanceTimersByTimeAsync(30_000);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it.each(['mine', 'public'])('subscribes only to current V2 addresses and suppresses healthy-socket %s discovery', async routeView => {
    const schedule = mount(routeView); await Promise.resolve();
    expect(state.subscribe).toHaveBeenCalledOnce();
    expect(state.request?.address).toEqual(Object.values(CURRENT_P2P_BINDING.deployments).map(item => item.contractAddress));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(schedule).not.toHaveBeenCalled();
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(2_000);
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0][0].reason).toBe('chain-event');
  });

  it('reconciles the selected trade after a pre-finality hint without requiring another event', async () => {
    const schedule = mount('trade'); await Promise.resolve();
    let canonicalStatus = 'Active';
    const displayed: string[] = [];
    schedule.mockImplementation(() => displayed.push(canonicalStatus));
    state.request?.onHint({ blockNumber: 100 });
    expect(displayed).toEqual(['Active']);
    canonicalStatus = 'Superseded';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(displayed).toEqual(['Active', 'Superseded']);
    expect(schedule.mock.calls[1][0]).toMatchObject({ reason: 'interval', domains: ['balances', 'trade-detail'], tradeId: 1 });
  });

  it('queues a wallet-held event hint while leaving interval ticks held', async () => {
    const schedule = mount('trade'); await Promise.resolve();
    state.walletActive = true;
    state.request?.onHint({ blockNumber: 100 });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: 'chain-event', tradeId: 1 }));
  });

  it('uses one fallback timer while reconnecting and stops it when the socket is healthy', async () => {
    const schedule = mount('mine'); await Promise.resolve();
    state.request?.onStatus?.('reconnecting');
    state.request?.onStatus?.('reconnecting');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(schedule).toHaveBeenCalledTimes(2);
    state.request?.onStatus?.('connected');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(schedule).toHaveBeenCalledTimes(3); // One canonical catch-up after the socket gap.
    state.cleanup?.();
    expect(state.stop).toHaveBeenCalledOnce();
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(61_000);
    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('holds hidden-document reads but passes wallet-held event hints to the queue', async () => {
    const schedule = mount(); await Promise.resolve();
    state.request?.onStatus?.('reconnecting');
    (document as unknown as { hidden: boolean }).hidden = true;
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(31_000);
    expect(schedule).not.toHaveBeenCalled();
    (document as unknown as { hidden: boolean }).hidden = false; state.walletActive = true;
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(31_000);
    expect(schedule).toHaveBeenCalledOnce();
    state.walletActive = false;
    state.request?.onHint({}); await vi.advanceTimersByTimeAsync(2_000);
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});
