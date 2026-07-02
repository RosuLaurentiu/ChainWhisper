import { describe, expect, it } from 'vitest';
import {
  TRADE_AGENT_QUICK_ACTIONS,
  consumeTradeAgentDraft,
  getTradeAgentPromptTokenMentions,
  normalizeTradeAgentResponse,
  rememberTradeAgentDraft
} from './tradeAgent';

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

describe('tradeAgent', () => {
  it('keeps quick actions distinct and template-driven', () => {
    expect(TRADE_AGENT_QUICK_ACTIONS.map((action) => action.label)).toEqual([
      'Find best price',
      'Draft trade'
    ]);
    expect(TRADE_AGENT_QUICK_ACTIONS[0].prompt).toBe('I want to buy [amount] [token] with [token].');
    expect(TRADE_AGENT_QUICK_ACTIONS[1].prompt).toContain('[buy/sell]');
  });

  it('keeps known actions and drops unknown action types', () => {
    expect(
      normalizeTradeAgentResponse({
        answer: 'Use the visible order and review before signing.',
        warnings: ['Private liquidity is not guaranteed.'],
        actions: [
          {
            type: 'prefill_limit',
            sellToken: 'p.COTI',
            buyToken: 'p.gCOTI',
            sellAmount: '10',
            buyAmount: '33.3',
            price: '3.33'
          },
          {
            type: 'execute_trade',
            tradeId: 7
          }
        ]
      })
    ).toEqual({
      answer: 'Use the visible order and review before signing.',
      warnings: ['Private liquidity is not guaranteed.'],
      actions: [
        {
          type: 'prefill_limit',
          buyAmount: '33.3',
          buyToken: 'p.gCOTI',
          price: '3.33',
          sellAmount: '10',
          sellToken: 'p.COTI'
        }
      ]
    });
  });

  it('rejects empty responses', () => {
    expect(() => normalizeTradeAgentResponse({ answer: '', warnings: [], actions: [] })).toThrow(
      'Trade Agent response was empty.'
    );
  });

  it('extracts the pair written by the user with private-token shorthand', () => {
    expect(
      getTradeAgentPromptTokenMentions('Find the best order to buy p.gCOTI with p.usdc.', [
        'p.COTI',
        'p.gCOTI',
        'p.USDC.e'
      ])
    ).toEqual(['p.gCOTI', 'p.USDC.e']);
  });

  it('consumes one-time agent drafts from storage', () => {
    const storage = createMemoryStorage();
    rememberTradeAgentDraft(
      {
        action: 'explain_order',
        context: { tradeId: 7 },
        prompt: 'Explain order #7.'
      },
      storage
    );

    expect(consumeTradeAgentDraft(storage)).toMatchObject({
      action: 'explain_order',
      context: { tradeId: 7 },
      prompt: 'Explain order #7.'
    });
    expect(consumeTradeAgentDraft(storage)).toBeNull();
  });
});
