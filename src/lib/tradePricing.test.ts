import { describe, expect, it } from 'vitest';
import {
  deriveRecurringLiquidityInputFromReceive,
  deriveRecurringReceiveAmountInput,
  deriveTradePricingUpdate,
  formatDecimalInput,
  invertPriceInput,
  nextTradePricingEditedFields,
  type TradePricingField
} from './tradePricing';

describe('tradePricing helpers', () => {
  it('derives price from base and quote amounts', () => {
    expect(
      deriveTradePricingUpdate({
        baseAmountInput: '10',
        quoteAmountInput: '25',
        priceInput: '',
        baseDecimals: 6,
        quoteDecimals: 18,
        editedFields: []
      })
    ).toEqual({ field: 'price', value: '2.5', sourceFields: ['baseAmount', 'quoteAmount'] });
  });

  it('derives quote amount from base amount and price', () => {
    expect(
      deriveTradePricingUpdate({
        baseAmountInput: '10',
        quoteAmountInput: '',
        priceInput: '2.5',
        baseDecimals: 6,
        quoteDecimals: 18,
        editedFields: ['baseAmount', 'price']
      })
    ).toEqual({ field: 'quoteAmount', value: '25', sourceFields: ['baseAmount', 'price'] });
  });

  it('derives base amount from quote amount and price', () => {
    expect(
      deriveTradePricingUpdate({
        baseAmountInput: '',
        quoteAmountInput: '25',
        priceInput: '2.5',
        baseDecimals: 6,
        quoteDecimals: 18,
        editedFields: ['quoteAmount', 'price']
      })
    ).toEqual({ field: 'baseAmount', value: '10', sourceFields: ['quoteAmount', 'price'] });
  });

  it('uses the last two edited fields to decide which value to refresh', () => {
    let fields: TradePricingField[] = [];
    fields = nextTradePricingEditedFields(fields, 'baseAmount');
    fields = nextTradePricingEditedFields(fields, 'quoteAmount');
    expect(fields).toEqual(['baseAmount', 'quoteAmount']);
    fields = nextTradePricingEditedFields(fields, 'price');
    expect(fields).toEqual(['quoteAmount', 'price']);
  });

  it('falls back to the two filled fields when a recent priority field is cleared', () => {
    expect(
      deriveTradePricingUpdate({
        baseAmountInput: '10',
        quoteAmountInput: '30',
        priceInput: '',
        baseDecimals: 6,
        quoteDecimals: 18,
        editedFields: ['price', 'quoteAmount']
      })
    ).toEqual({ field: 'price', value: '3', sourceFields: ['baseAmount', 'quoteAmount'] });
  });

  it('formats decimal values without grouping separators', () => {
    expect(formatDecimalInput(123450000n, 6)).toBe('123.45');
    expect(formatDecimalInput(1000000n, 6)).toBe('1');
  });

  it('inverts price inputs for swapped token pairs', () => {
    expect(invertPriceInput('0.0001')).toBe('10000');
    expect(invertPriceInput('2.5')).toBe('0.4');
    expect(invertPriceInput('')).toBe('');
    expect(invertPriceInput('0')).toBe('');
  });

  it('derives recurring buy receive amount from quote liquidity and price', () => {
    expect(
      deriveRecurringReceiveAmountInput({
        side: 'buy',
        liquidityInput: '0.22',
        priceInput: '0.0001',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('2200');
  });

  it('derives recurring sell receive amount from base liquidity and price', () => {
    expect(
      deriveRecurringReceiveAmountInput({
        side: 'sell',
        liquidityInput: '12.5',
        priceInput: '0.00012',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('0.0015');
  });

  it('derives recurring liquidity from edited receive helpers', () => {
    expect(
      deriveRecurringLiquidityInputFromReceive({
        side: 'buy',
        receiveInput: '2200',
        priceInput: '0.0001',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('0.22');
    expect(
      deriveRecurringLiquidityInputFromReceive({
        side: 'sell',
        receiveInput: '0.0015',
        priceInput: '0.00012',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('12.5');
  });

  it('keeps recurring calculator empty for invalid price or tiny rounded output', () => {
    expect(
      deriveRecurringReceiveAmountInput({
        side: 'buy',
        liquidityInput: '1',
        priceInput: '',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('');
    expect(
      deriveRecurringLiquidityInputFromReceive({
        side: 'sell',
        receiveInput: '0.000000000000000001',
        priceInput: '1000000',
        baseDecimals: 6,
        quoteDecimals: 18
      })
    ).toBe('');
  });
});
