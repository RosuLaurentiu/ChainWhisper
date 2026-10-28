import { describe, expect, it } from 'vitest';
import {
  derivePrivateLiquidityHiddenIntentLimitOrderFields,
  preparePrivateLiquidityHiddenIntentFlow
} from './privateLiquidityHiddenIntentFlow';
import type { PrivateLiquidityPositionToken } from './privateLiquidityPositionFlow';

const token = (address: string, symbol: string): PrivateLiquidityPositionToken => Object.freeze({
  address,
  decimals: 6,
  selection: symbol,
  symbol
});
const BASE = token(`0x${'11'.repeat(20)}`, 'cwTPB');
const QUOTE = token(`0x${'22'.repeat(20)}`, 'cwTPQ');

describe('privateLiquidityHiddenIntentFlow', () => {
  it('derives the packed contract fields from a normal sell limit order', () => {
    expect(derivePrivateLiquidityHiddenIntentLimitOrderFields({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'sell-base',
      amountInput: '10',
      limitPriceInput: '12'
    })).toEqual({
      amountInput: '10',
      estimatedOutputInput: '120',
      limitBaseAmountInput: '1',
      limitQuoteAmountInput: '12',
      maximumBudgetInput: '10'
    });
  });

  it('derives the quote budget from a normal buy limit order', () => {
    expect(derivePrivateLiquidityHiddenIntentLimitOrderFields({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'buy-base',
      amountInput: '10',
      limitPriceInput: '12'
    })).toEqual({
      amountInput: '10',
      estimatedOutputInput: '10',
      limitBaseAmountInput: '1',
      limitQuoteAmountInput: '12',
      maximumBudgetInput: '120'
    });
  });

  it('prepares the agreed recurring private limit with two packed inputs', () => {
    const result = preparePrivateLiquidityHiddenIntentFlow({
      firstToken: QUOTE,
      secondToken: BASE,
      side: 'buy-base',
      limitBaseAmountInput: '1',
      limitQuoteAmountInput: '12',
      maximumBudgetInput: '120',
      minimumFillBps: 2500,
      cooldownBlocks: 20,
      expiryDays: 7,
      currentTimestamp: 1_000
    });

    expect(result.inputToken.symbol).toBe('cwTPQ');
    expect(result.maximumBudget).toBe('120000000');
    expect(result.minimumFill).toBe('30000000');
    expect(result.prepared.cooldownBlocks).toBe('20');
    expect(result.prepared.expiresAt).toBe(String(1_000 + 7 * 86_400));
    expect(result.confirmation.stats).toContainEqual({
      label: 'COTI private inputs',
      value: '2 packed confirmations'
    });
    expect(result.confirmation.stats).toContainEqual({ label: 'On-chain action', value: '1 transaction' });
    expect(result.confirmation.stats).toContainEqual({ label: 'Chat notification', value: '0 transactions' });
  });

  it('rejects impossible amounts, fill percentages, and expiries before wallet access', () => {
    const common = {
      firstToken: BASE,
      secondToken: QUOTE,
      side: 'sell-base' as const,
      limitBaseAmountInput: '1',
      limitQuoteAmountInput: '12',
      maximumBudgetInput: '120',
      minimumFillBps: 0,
      cooldownBlocks: 0,
      expiryDays: 7,
      currentTimestamp: 1_000
    };
    expect(() => preparePrivateLiquidityHiddenIntentFlow({ ...common, maximumBudgetInput: '' }))
      .toThrow(/Maximum budget/);
    expect(() => preparePrivateLiquidityHiddenIntentFlow({ ...common, minimumFillBps: 10001 }))
      .toThrow(/Minimum fill/);
    expect(() => preparePrivateLiquidityHiddenIntentFlow({ ...common, expiryDays: 31 }))
      .toThrow(/between 1 and 30 days/);
  });
});
