import { describe, expect, it } from 'vitest';
import { quoteDexV2LimitPosition, quoteDexV2RecurringPosition } from './dexV2HiddenTerms';

const pair = Object.freeze({
  baseDecimals: 6,
  quoteDecimals: 6,
  baseLotSize: '100',
  quoteLotSize: '100',
  maximumAggregateLots: '2000000',
  baseToken: '0x1111111111111111111111111111111111111111',
  quoteToken: '0x2222222222222222222222222222222222222222'
});

describe('dexV2HiddenTerms', () => {
  it('quotes exact one-sided Limit inventory and canonical fill quanta', () => {
    expect(quoteDexV2LimitPosition({
      pair,
      makerSide: 'sell-base',
      tickRank: 8,
      minimumFillQuanta: 2n,
      inventoryAmount: '0.997'
    })).toMatchObject({
      inventoryLots: 9_970n,
      inventorySymbol: 'pUSDC',
      executableQuanta: 10n
    });
  });

  it('quotes exact two-sided Recurring inventory', () => {
    expect(quoteDexV2RecurringPosition({
      pair,
      buyTickRank: 9,
      sellTickRank: 6,
      baseAmount: '0.02',
      quoteAmount: '0.019'
    })).toEqual({ baseInventoryLots: 200n, quoteInventoryLots: 190n });
  });

  it('accepts the one-quantum defaults used for low-cost testnet smoke tests', () => {
    expect(quoteDexV2LimitPosition({
      pair,
      makerSide: 'sell-base',
      tickRank: 8,
      minimumFillQuanta: 1n,
      inventoryAmount: '0.0997'
    })).toMatchObject({ inventoryLots: 997n, executableQuanta: 1n });
    expect(quoteDexV2RecurringPosition({
      pair,
      buyTickRank: 9,
      sellTickRank: 6,
      baseAmount: '0.002',
      quoteAmount: '0.0019'
    })).toEqual({ baseInventoryLots: 20n, quoteInventoryLots: 19n });
  });

  it('rejects non-lot amounts and invalid rank/inventory combinations', () => {
    expect(() => quoteDexV2LimitPosition({
      pair,
      makerSide: 'sell-base',
      tickRank: 8,
      minimumFillQuanta: 63n,
      inventoryAmount: '0.997'
    })).toThrow(/minimum fill/);
    expect(() => quoteDexV2RecurringPosition({
      pair,
      buyTickRank: 6,
      sellTickRank: 9,
      baseAmount: '0.02',
      quoteAmount: '0.019'
    })).toThrow(/buy rank/);
  });
});
