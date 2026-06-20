import { describe, expect, it } from 'vitest';
import {
  clearPendingOtcSwapIntent,
  findOtcSwapFillNote,
  readPendingOtcSwapIntentForTrade,
  rememberOtcSwapFillNote,
  rememberPendingOtcSwapIntent
} from './otcSwapIntent';

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

describe('OTC swap intent storage', () => {
  it('remembers a short-lived terminal prefill intent for the matching trade', () => {
    const storage = createMemoryStorage();
    rememberPendingOtcSwapIntent(
      {
        version: 1,
        tradeKey: '0xabc:7',
        tradeId: 7,
        inputMode: 'sell',
        sellTokenKey: 'native:coti',
        sellTokenSymbol: 'COTI',
        sellTokenDecimals: 18,
        buyTokenKey: 'erc20:0x1',
        buyTokenSymbol: 'WISP',
        buyTokenDecimals: 6,
        requestedSellAmountWei: '100',
        requestedBuyAmountWei: '0',
        terminalInputAmountWei: '100',
        terminalInput: { kind: 'standard', inputSide: 'pay' },
        privateLiquidity: false,
        timestamp: 1_000
      },
      storage
    );

    expect(readPendingOtcSwapIntentForTrade('0xABC:7', storage, 1_500)).toMatchObject({
      tradeId: 7,
      terminalInput: { kind: 'standard', inputSide: 'pay' }
    });
    expect(readPendingOtcSwapIntentForTrade('0xabc:8', storage, 1_500)).toBeNull();
  });

  it('expires and clears stale terminal prefill intents', () => {
    const storage = createMemoryStorage();
    rememberPendingOtcSwapIntent(
      {
        version: 1,
        tradeKey: '0xabc:7',
        tradeId: 7,
        inputMode: 'buy',
        sellTokenKey: 'native:coti',
        sellTokenSymbol: 'COTI',
        sellTokenDecimals: 18,
        buyTokenKey: 'erc20:0x1',
        buyTokenSymbol: 'WISP',
        buyTokenDecimals: 6,
        requestedSellAmountWei: '0',
        requestedBuyAmountWei: '100',
        terminalInputAmountWei: '100',
        terminalInput: { kind: 'recurring', displayAction: 'buy', fillSide: 'sell' },
        privateLiquidity: true,
        timestamp: 1_000
      },
      storage
    );

    expect(readPendingOtcSwapIntentForTrade('0xabc:7', storage, 1_000 + 10 * 60 * 1000 + 1)).toBeNull();
    expect(readPendingOtcSwapIntentForTrade('0xabc:7', storage, 1_500)).toBeNull();
  });

  it('stores fill notes keyed by transaction and trade', () => {
    const storage = createMemoryStorage();
    const notes = rememberOtcSwapFillNote(
      {
        tradeKey: '0xabc:7',
        txHash: '0xFILL',
        requestedAmountWei: '100',
        requestedAssetKey: 'native:coti',
        requestedSymbol: 'COTI',
        requestedDecimals: 18,
        requestedRole: 'sold',
        privateLiquidity: false,
        timestamp: 1_000
      },
      storage,
      1_000
    );

    expect(findOtcSwapFillNote(notes, '0xABC:7', '0xfill')).toMatchObject({
      requestedAmountWei: '100',
      txHash: '0xfill'
    });
  });

  it('clears pending intents explicitly', () => {
    const storage = createMemoryStorage();
    rememberPendingOtcSwapIntent(
      {
        version: 1,
        tradeKey: '0xabc:7',
        tradeId: 7,
        inputMode: 'sell',
        sellTokenKey: 'native:coti',
        sellTokenSymbol: 'COTI',
        sellTokenDecimals: 18,
        buyTokenKey: 'erc20:0x1',
        buyTokenSymbol: 'WISP',
        buyTokenDecimals: 6,
        requestedSellAmountWei: '100',
        requestedBuyAmountWei: '0',
        terminalInputAmountWei: '100',
        terminalInput: { kind: 'standard', inputSide: 'pay' },
        privateLiquidity: false,
        timestamp: 1_000
      },
      storage
    );

    clearPendingOtcSwapIntent(storage);

    expect(readPendingOtcSwapIntentForTrade('0xabc:7', storage, 1_500)).toBeNull();
  });
});
