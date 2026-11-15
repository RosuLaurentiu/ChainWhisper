import { afterEach, describe, expect, it, vi } from 'vitest';
import useP2PTradeComposerModel from './useP2PTradeComposerModel';
import { invertPriceInput, type TradePricingField } from '../../../lib/tradePricing';

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useMemo: (read: () => unknown) => read(),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next;
    }];
  }
}));
vi.mock('../../../lib/tradeComposer', async original => ({
  ...await original<typeof import('../../../lib/tradeComposer')>(),
  deriveTradeComposerModel: () => ({ tradeTokenOptions: [] }), resolveSelectedTradeToken: () => null
}));
afterEach(() => { hooks.index = 0; hooks.slots = []; });

const fixture = () => {
  let canonical = '', edited: TradePricingField[] = [];
  const Render = () => {
    hooks.index = 0;
    return useP2PTradeComposerModel({ tradePriceInput: canonical,
      tradeOfferTokenSelection: '', tradeRequestTokenSelection: '', swapBuyTokenSelection: '', swapSellTokenSelection: '',
      setTradePriceInput: (value: string) => { canonical = value; },
      setTradePricingEditedFields: (update: (previous: TradePricingField[]) => TradePricingField[]) => { edited = update(edited); }
    } as unknown as Parameters<typeof useP2PTradeComposerModel>[0]);
  };
  const display = () => (Render() as ReturnType<typeof Render> & { tradeReversePriceInput?: string })
    .tradeReversePriceInput ?? invertPriceInput(canonical);
  return { render: Render, display, canonical: () => canonical, setCanonical: (value: string) => { canonical = value; } };
};

describe('P2P reverse price input text', () => {
  it('keeps the authored inverse price instead of round-tripping its rounded reciprocal', () => {
    const input = fixture();
    input.render().updateTradeReversePriceInput('3');
    expect(input.canonical()).toBe(invertPriceInput('3'));
    expect(input.display()).toBe('3');
  });

  it('preserves decimals and trailing zeroes through each keystroke and clear', () => {
    const input = fixture();
    for (const value of ['0', '0.', '0.1', '0.10', '0.105', '3.', '3.50', '']) {
      input.render().updateTradeReversePriceInput(value);
      expect(input.display()).toBe(value);
      expect(input.canonical()).toBe(invertPriceInput(value));
    }
  });

  it('discards an authored inverse display after an external or forward price change', () => {
    const input = fixture();
    input.render().updateTradeReversePriceInput('3');
    input.setCanonical('2');
    expect(input.display()).toBe('0.5');
    input.render().updateTradeReversePriceInput('3');
    input.render().updateTradePriceInput('4');
    expect(input.canonical()).toBe('4');
    expect(input.display()).toBe('0.25');
  });
});
