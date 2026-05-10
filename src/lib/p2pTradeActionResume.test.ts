import { describe, expect, it } from 'vitest';
import {
  P2P_TRADE_ACTION_MAX_AUTO_RESUME_ATTEMPTS,
  P2P_TRADE_ACTION_RESUME_STORAGE_KEY,
  bumpP2PTradeActionAutoResumeAttempt,
  clearP2PTradeActionResume,
  readP2PTradeActionResume,
  readP2PTradeActionResumeForSession,
  rememberP2PTradeActionResume,
  updateP2PTradeActionResumeStage
} from './p2pTradeActionResume';

const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    }
  };
};

const WALLET = '0x0000000000000000000000000000000000000001';
const OTHER_WALLET = '0x0000000000000000000000000000000000000002';

describe('p2pTradeActionResume', () => {
  it('stores a pending action without touching navigation state', () => {
    const storage = createMemoryStorage();
    const pending = rememberP2PTradeActionResume(
      {
        actionKind: 'recurring-fill',
        amountInput: '10000',
        baselineRecurringExecutionCount: 2,
        escrowContract: '0x0000000000000000000000000000000000000010',
        recurringSide: 'buy',
        terminalPath: '/trades/recurring?order=7',
        tradeId: 7,
        walletAddress: WALLET
      },
      storage,
      1_000
    );

    expect(pending).toMatchObject({
      actionKind: 'recurring-fill',
      amountInput: '10000',
      baselineRecurringExecutionCount: 2,
      stage: 'started',
      terminalPath: '/trades/recurring?order=7',
      tradeId: 7
    });
    expect(storage.getItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY)).toContain('/trades/recurring?order=7');
  });

  it('updates stages and preserves auto-resume attempts for the same action', () => {
    const storage = createMemoryStorage();
    rememberP2PTradeActionResume(
      {
        actionKind: 'partial-fill',
        amountInput: '5',
        escrowContract: '0x0000000000000000000000000000000000000010',
        terminalPath: '/trades/l/code?escrow=direct',
        tradeId: 3,
        walletAddress: WALLET
      },
      storage,
      1_000
    );
    updateP2PTradeActionResumeStage('allowance-ready', storage, 2_000);
    const attempted = bumpP2PTradeActionAutoResumeAttempt(readP2PTradeActionResume(storage, 2_100)!, storage, 2_200);
    expect(attempted?.autoResumeAttempts).toBe(1);

    rememberP2PTradeActionResume(
      {
        actionKind: 'partial-fill',
        amountInput: '5',
        escrowContract: '0x0000000000000000000000000000000000000010',
        terminalPath: '/trades/l/code?escrow=direct',
        tradeId: 3,
        walletAddress: WALLET
      },
      storage,
      2_300
    );

    const pending = readP2PTradeActionResume(storage, 2_400);
    expect(pending?.stage).toBe('allowance-ready');
    expect(pending?.autoResumeAttempts).toBe(1);
  });

  it('pauses after repeated auto-resume attempts', () => {
    const storage = createMemoryStorage();
    const initial = rememberP2PTradeActionResume(
      {
        actionKind: 'accept',
        escrowContract: '0x0000000000000000000000000000000000000010',
        terminalPath: '/trades/l/code?escrow=direct',
        tradeId: 9,
        walletAddress: WALLET
      },
      storage,
      1_000
    )!;

    let current = initial;
    for (let index = 0; index < P2P_TRADE_ACTION_MAX_AUTO_RESUME_ATTEMPTS; index += 1) {
      current = bumpP2PTradeActionAutoResumeAttempt(current, storage, 2_000 + index)!;
    }

    expect(bumpP2PTradeActionAutoResumeAttempt(current, storage, 3_000)).toBeNull();
    expect(readP2PTradeActionResume(storage, 3_100)?.status).toBe('paused');
  });

  it('filters pending actions by wallet session and clears expired entries', () => {
    const storage = createMemoryStorage();
    rememberP2PTradeActionResume(
      {
        actionKind: 'cancel',
        escrowContract: '0x0000000000000000000000000000000000000010',
        terminalPath: '/trades/l/code?escrow=direct',
        tradeId: 4,
        walletAddress: WALLET
      },
      storage,
      1_000
    );

    expect(
      readP2PTradeActionResumeForSession({
        storage,
        walletAddress: OTHER_WALLET
      })
    ).toBeNull();

    clearP2PTradeActionResume(storage);
    expect(readP2PTradeActionResume(storage, 2_000)).toBeNull();
  });
});
