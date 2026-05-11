import { describe, expect, it } from 'vitest';
import {
  PENDING_TRADING_WRITE_STORAGE_KEY,
  clearPendingTradingWrite,
  markPendingTradingWriteResuming,
  pendingTradingWriteCanResumeAgain,
  pendingTradingWriteMatchesWallet,
  readPendingTradingWrite,
  sanitizePendingTradingWriteForDiagnostics,
  writePendingTradingWrite
} from './pendingTradingWrite';

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const walletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

describe('pending trading write helpers', () => {
  it('serializes and restores all supported write action kinds', () => {
    const storage = createMemoryStorage();
    const cases = [
      {
        chainId: 2632500,
        counterAcceptMode: 'accept-only' as const,
        escrowContract: '0x0000000000000000000000000000000000000001',
        kind: 'accept-trade' as const,
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      {
        amountInput: '12.5',
        chainId: 2632500,
        kind: 'partial-fill' as const,
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      {
        chainId: 2632500,
        kind: 'cancel-trade' as const,
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      {
        chainId: 2632500,
        kind: 'decline-trade' as const,
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      {
        chainId: 2632500,
        context: {},
        form: {
          directTradeRecipient: '',
          tradeHasNoExpiry: false,
          tradeHidePrivateLiquidity: false,
          tradeOfferAmountInput: '1',
          tradeOfferCustomTokenAddress: '',
          tradeOfferTokenSelection: 'wisp',
          tradePriceInput: '',
          tradePricingEditedFields: ['baseAmount'],
          tradeRequestAmountInput: '2',
          tradeRequestCustomTokenAddress: '',
          tradeRequestTokenSelection: 'coti',
          tradeVisibility: 'public'
        },
        kind: 'create-trade' as const,
        routePath: '/trades/create',
        walletAddress
      },
      {
        chainId: 2632500,
        context: { editingTradeId: 9 },
        form: {
          recurringAddBuyBudgetInput: '5',
          recurringAddSellInventoryInput: '6',
          recurringBuyPriceInput: '1.1',
          recurringBuyReceiveEditable: false,
          recurringBuyReceiveInput: '',
          recurringHidePrivateAmounts: true,
          recurringRemoveBuyBudgetInput: '',
          recurringRemoveSellInventoryInput: '',
          recurringSellPriceInput: '1.3',
          recurringSellReceiveEditable: false,
          recurringSellReceiveInput: '',
          tradeOfferCustomTokenAddress: '',
          tradeOfferTokenSelection: 'pwisp',
          tradeRequestCustomTokenAddress: '',
          tradeRequestTokenSelection: 'coti'
        },
        kind: 'create-recurring' as const,
        routePath: '/trades/create',
        walletAddress
      },
      {
        amountInput: '3',
        chainId: 2632500,
        kind: 'fill-recurring-side' as const,
        routePath: '/trades/l/7',
        side: 'buy' as const,
        tradeId: 7,
        walletAddress
      },
      {
        action: 'pause' as const,
        chainId: 2632500,
        kind: 'update-recurring-status' as const,
        routePath: '/trades/l/7',
        tradeId: 7,
        walletAddress
      }
    ];

    for (const draft of cases) {
      const written = writePendingTradingWrite(draft, storage, 1_000);

      expect(written?.kind).toBe(draft.kind);
      expect(readPendingTradingWrite(storage, 1_500)?.kind).toBe(draft.kind);
      clearPendingTradingWrite(storage);
    }
  });

  it('rejects wrong wallet, wrong chain, stale records, route mismatch shape, and repeated resumes', () => {
    const storage = createMemoryStorage();
    const write = writePendingTradingWrite(
      {
        chainId: 2632500,
        kind: 'accept-trade',
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      storage,
      1_000
    );

    expect(write).not.toBeNull();
    expect(pendingTradingWriteMatchesWallet(write!, walletAddress, 2632500)).toBe(true);
    expect(pendingTradingWriteMatchesWallet(write!, '0x0000000000000000000000000000000000000001', 2632500)).toBe(false);
    expect(pendingTradingWriteMatchesWallet(write!, walletAddress, 1)).toBe(false);

    const resuming = markPendingTradingWriteResuming(storage, 1_500);
    expect(resuming?.resumeCount).toBe(1);
    expect(pendingTradingWriteCanResumeAgain(resuming!)).toBe(false);
    expect(markPendingTradingWriteResuming(storage, 2_000)).toBeNull();

    storage.setItem(
      PENDING_TRADING_WRITE_STORAGE_KEY,
      JSON.stringify({
        chainId: 2632500,
        id: 'bad',
        kind: 'accept-trade',
        routePath: 'https://evil.example/trades/l/42',
        timestamp: 3_000,
        tradeId: 42,
        walletAddress
      })
    );
    expect(readPendingTradingWrite(storage, 3_500)).toBeNull();

    writePendingTradingWrite(
      {
        chainId: 2632500,
        kind: 'accept-trade',
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      storage,
      10_000
    );
    expect(readPendingTradingWrite(storage, 10_000 + 5 * 60 * 1000 + 1)).toBeNull();
  });

  it('keeps diagnostics and stored create/fill records free of secrets and wallet addresses', () => {
    const storage = createMemoryStorage();
    const write = writePendingTradingWrite(
      {
        amountInput: '12.5',
        chainId: 2632500,
        kind: 'fill-recurring-side',
        routePath: '/trades/l/7?secret=should-not-be-used',
        side: 'sell',
        tradeId: 7,
        walletAddress
      },
      storage,
      1_000
    );

    expect(write).not.toBeNull();
    const diagnostics = JSON.stringify(sanitizePendingTradingWriteForDiagnostics(write!));
    expect(diagnostics).not.toContain(walletAddress);
    expect(diagnostics).not.toContain('12.5');
    expect(diagnostics).not.toContain('secret=should-not-be-used');

    const raw = storage.getItem(PENDING_TRADING_WRITE_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('accessSecret');
    expect(raw).not.toContain('aes');
  });

  it('clears pending writes explicitly', () => {
    const storage = createMemoryStorage();
    writePendingTradingWrite(
      {
        chainId: null,
        kind: 'accept-trade',
        routePath: '/trades/l/42',
        tradeId: 42,
        walletAddress
      },
      storage,
      1_000
    );

    clearPendingTradingWrite(storage);

    expect(readPendingTradingWrite(storage, 1_500)).toBeNull();
  });
});
