import { normalizeSafeTradeAgentResponse } from './trade-agent-response.ts';

const assertEquals = (actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

const context = {
  openedOrder: {
    tradeId: 7,
    escrowContract: '0x1111111111111111111111111111111111111111',
    offer: { symbol: 'WISP' },
    request: { symbol: 'COTI' }
  },
  selectedPair: {
    sellToken: { symbol: 'WISP' },
    buyToken: { symbol: 'COTI' }
  }
};

Deno.test('normalizes valid discriminated recurring and trusted order actions', () => {
  const result = normalizeSafeTradeAgentResponse({
    answer: 'Draft ready.',
    warnings: ['Review it.'],
    actions: [
      {
        type: 'prefill_recurring',
        baseToken: 'WISP',
        quoteToken: 'COTI',
        buyPrice: '2',
        sellPrice: '3',
        buyLiquidity: '10',
        sellLiquidity: '4',
        amountVisibility: 'visible'
      },
      {
        type: 'open_order',
        escrowContract: '0x1111111111111111111111111111111111111111',
        tradeId: 7
      }
    ]
  }, context);
  assertEquals(result, {
    answer: 'Draft ready.',
    warnings: ['Review it.'],
    actions: [
      {
        type: 'prefill_recurring',
        baseToken: 'WISP',
        quoteToken: 'COTI',
        buyPrice: '2',
        sellPrice: '3',
        buyLiquidity: '10',
        sellLiquidity: '4',
        amountVisibility: 'visible'
      },
      {
        type: 'open_order',
        escrowContract: '0x1111111111111111111111111111111111111111',
        tradeId: 7
      }
    ]
  });
});

Deno.test('pins recurring pair, visibility, and calculated Carbon spread to trusted context', () => {
  const result = normalizeSafeTradeAgentResponse({
    answer: 'Recurring draft ready.',
    warnings: [],
    actions: [{
      type: 'prefill_recurring',
      baseToken: 'p.gCOTI',
      quoteToken: 'p.COTI',
      buyPrice: '99',
      sellPrice: '100',
      buyLiquidity: '40',
      sellLiquidity: '40',
      amountVisibility: 'visible'
    }]
  }, {
    selectedPair: {
      baseToken: { symbol: 'p.gCOTI' },
      quoteToken: { symbol: 'p.COTI' }
    },
    recurringDraft: {
      amountVisibility: 'private-hidden',
      calculatedPrices: { buyPrice: '0.125', sellPrice: '0.375' }
    }
  });
  assertEquals(result, {
    answer: 'Recurring draft ready.',
    warnings: [],
    actions: [{
      type: 'prefill_recurring',
      baseToken: 'p.gCOTI',
      quoteToken: 'p.COTI',
      buyPrice: '0.125',
      sellPrice: '0.375',
      buyLiquidity: '40',
      sellLiquidity: '40',
      amountVisibility: 'private-hidden'
    }]
  });
});

Deno.test('discards unknown tokens, non-positive values, and untrusted order identities', () => {
  const result = normalizeSafeTradeAgentResponse({
    answer: 'No safe action.',
    warnings: [],
    actions: [
      {
        type: 'prefill_limit',
        sellToken: 'UNKNOWN',
        buyToken: 'COTI',
        sellAmount: '1',
        buyAmount: '2',
        price: '2',
        accessType: 'public',
        amountVisibility: 'visible'
      },
      {
        type: 'prefill_swap',
        inputMode: 'sell',
        sellToken: 'WISP',
        buyToken: 'COTI',
        sellAmount: '0',
        buyAmount: null
      },
      {
        type: 'open_order',
        tradeId: 8,
        escrowContract: '0x1111111111111111111111111111111111111111'
      }
    ]
  }, context);
  assertEquals(result, { answer: 'No safe action.', warnings: [], actions: [] });
});

Deno.test('never carries model-authored labels or access secrets into cached actions', () => {
  const result = normalizeSafeTradeAgentResponse({
    answer: 'Safe draft.',
    warnings: [],
    actions: [
      {
        type: 'prefill_limit',
        label: 'Execute now',
        sellToken: 'WISP',
        buyToken: 'COTI',
        sellAmount: '1',
        buyAmount: '2',
        price: '2',
        accessType: 'direct',
        amountVisibility: 'visible'
      },
      {
        type: 'prefill_message',
        message: 'Unsafe',
        accessSecret: `0x${'12'.repeat(32)}`
      }
    ]
  }, context);
  assertEquals(result, {
    answer: 'Safe draft.',
    warnings: [],
    actions: [{
      type: 'prefill_limit',
      sellToken: 'WISP',
      buyToken: 'COTI',
      sellAmount: '1',
      buyAmount: '2',
      price: '2',
      accessType: 'direct',
      amountVisibility: 'visible'
    }]
  });
});
