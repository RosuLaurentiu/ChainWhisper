import { describe, expect, it } from 'vitest';
import { redactTradeAgentSecrets } from '../../supabase/functions/_shared/trade-agent-redaction';
import { TRADE_ESCROW_CONTRACT_ADDRESS, type TradeSnapshot } from './appShared';
import {
  TRADE_AGENT_QUICK_ACTIONS,
  buildTradeAgentChatContext,
  buildTradeAgentOrderReviewContext,
  buildTradeAgentSafeOrderSummary,
  canUseTradeAgentAction,
  containsTradeAgentSecretText,
  consumeTradeAgentDraft,
  getTradeAgentActionButtonLabel,
  getTradeAgentActionCta,
  getTradeAgentActionDescription,
  getTradeAgentPreflightError,
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
  it('keeps quick actions distinct and conversational when details are missing', () => {
    expect(TRADE_AGENT_QUICK_ACTIONS.map((action) => action.label)).toEqual([
      'Compare price references',
      'Draft limit order',
      'Draft recurring order',
      'Explain this order',
      'Draft a counter',
      'Review my orders'
    ]);
    expect(TRADE_AGENT_QUICK_ACTIONS[0].prompt).toBe('Compare token prices.');
    expect(TRADE_AGENT_QUICK_ACTIONS[1].prompt).toBe('Draft a limit order.');
    expect(TRADE_AGENT_QUICK_ACTIONS[2].prompt).toBe('Draft a recurring order.');
    expect(TRADE_AGENT_QUICK_ACTIONS[3].prompt).toBe('Explain this order.');
    expect(TRADE_AGENT_QUICK_ACTIONS[4].prompt).toBe('Draft a counter for this order.');
    expect(TRADE_AGENT_QUICK_ACTIONS[5].prompt).toBe('Review my orders.');
    expect(TRADE_AGENT_QUICK_ACTIONS[1].prompt).not.toContain('[');
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
            price: '3.33',
            accessType: 'public',
            amountVisibility: 'visible'
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
          sellToken: 'p.COTI',
          accessType: 'public',
          amountVisibility: 'visible'
        }
      ]
    });
  });

  it('normalizes strict recurring and direct drafts without model-authored labels, secrets, or recipients', () => {
    const response = normalizeTradeAgentResponse(
      {
        answer: 'Drafts ready.',
        actions: [
          {
            type: 'prefill_recurring',
            baseToken: 'p.COTI',
            quoteToken: 'p.gCOTI',
            buyPrice: '2.5',
            sellPrice: '2.8',
            buyLiquidity: '100',
            sellLiquidity: '40',
            amountVisibility: 'private-hidden',
            label: 'Execute recurring'
          },
          {
            type: 'prefill_limit',
            sellToken: 'p.COTI',
            buyToken: 'p.gCOTI',
            sellAmount: '10',
            buyAmount: '25',
            price: '2.5',
            accessType: 'direct',
            amountVisibility: 'visible',
            directRecipient: '0x2222222222222222222222222222222222222222',
            accessSecret: `0x${'a'.repeat(64)}`,
            label: 'Send now'
          }
        ]
      },
      {
        knownTokens: [
          { reference: 'p.COTI', decimals: 18 },
          { reference: 'p.gCOTI', decimals: 18 }
        ]
      }
    );

    expect(response.actions).toEqual([
      {
        type: 'prefill_recurring',
        baseToken: 'p.COTI',
        quoteToken: 'p.gCOTI',
        buyPrice: '2.5',
        sellPrice: '2.8',
        buyLiquidity: '100',
        sellLiquidity: '40',
        amountVisibility: 'private-hidden'
      },
      {
        type: 'prefill_limit',
        sellToken: 'p.COTI',
        buyToken: 'p.gCOTI',
        sellAmount: '10',
        buyAmount: '25',
        price: '2.5',
        accessType: 'direct',
        amountVisibility: 'visible'
      }
    ]);
    expect(JSON.stringify(response.actions)).not.toMatch(/label|recipient|accessSecret/i);
  });

  it('keeps only open-order actions that match a trusted contract-local identity', () => {
    const trustedEscrow = '0x1111111111111111111111111111111111111111';
    const response = normalizeTradeAgentResponse(
      {
        answer: 'Review these orders.',
        actions: [
          { type: 'open_order', tradeId: 7, escrowContract: trustedEscrow },
          {
            type: 'open_order',
            tradeId: 7,
            escrowContract: '0x2222222222222222222222222222222222222222'
          },
          { type: 'open_order', tradeId: 8, escrowContract: trustedEscrow }
        ]
      },
      { trustedOrders: [{ tradeId: 7, escrowContract: trustedEscrow }] }
    );

    expect(response.actions).toEqual([
      { type: 'open_order', tradeId: 7, escrowContract: trustedEscrow }
    ]);
  });

  it('allows missing draft details while blocking placeholders, ambiguity, invalid values, and secrets', () => {
    const knownTokens = [
      { reference: 'COTI', decimals: 18 },
      { reference: 'p.COTI', decimals: 18 },
      { reference: 'p.gCOTI', decimals: 18 }
    ];

    expect(
      getTradeAgentPreflightError({
        action: 'find_price',
        context: {},
        knownTokens,
        prompt: 'I want to buy [amount] p.COTI with p.gCOTI.'
      })
    ).toContain('placeholder');
    expect(
      getTradeAgentPreflightError({
        action: 'find_price',
        context: {},
        knownTokens,
        prompt: 'Compare buying and selling 10 p.COTI for p.gCOTI.'
      })
    ).toBe('Choose one direction—buy or sell—for this request.');
    expect(
      getTradeAgentPreflightError({
        action: 'draft_limit',
        context: {},
        knownTokens,
        prompt: 'Help me draft a limit order for p.COTI and p.gCOTI.'
      })
    ).toBe('');
    expect(
      getTradeAgentPreflightError({
        action: 'draft_recurring',
        context: {},
        knownTokens,
        prompt: 'Help me draft a recurring order for p.COTI and p.gCOTI.'
      })
    ).toBe('');
    expect(
      getTradeAgentPreflightError({
        action: 'find_price',
        context: {},
        knownTokens,
        prompt: 'Compare p.COTI and p.gCOTI.'
      })
    ).toBe('');
    expect(
      getTradeAgentPreflightError({
        action: 'find_price',
        context: {},
        knownTokens,
        prompt: 'Buy 0 p.COTI with p.gCOTI.'
      })
    ).toContain('positive');
    expect(
      getTradeAgentPreflightError({
        action: 'draft_limit',
        context: {},
        knownTokens,
        prompt: `Sell 10 p.COTI for p.gCOTI at 2.5 public visible amounts using private key 0x${'a'.repeat(64)}`
      })
    ).toContain('private keys');
    expect(
      getTradeAgentPreflightError({
        action: 'explain_order',
        context: {},
        knownTokens,
        prompt: 'Explain this order.'
      })
    ).toBe('Open a specific order before using this action.');
    expect(containsTradeAgentSecretText('Never share private keys or recovery phrases.')).toBe(false);
    expect(
      getTradeAgentPreflightError({
        action: 'explain_order',
        context: {
          openedOrder: {
            tradeId: 1,
            escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS
          },
          privateKey: 'do not send this'
        },
        knownTokens,
        prompt: 'Explain this order.'
      })
    ).toContain('private keys');
  });

  it('caps safe order-review summaries at 20 and omits wallet/private inventory data', () => {
    const trades = Array.from({ length: 25 }, (_, index) => ({
      tradeId: index + 1,
      escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'private-erc20', symbol: 'p.COTI', decimals: 18, amount: '1000000000000000000' },
      request: { kind: 'private-erc20', symbol: 'p.gCOTI', decimals: 18, amount: '2000000000000000000' },
      createdAt: 1,
      expiresAt: 0,
      status: 'open',
      isPublic: true,
      hiddenLiquidity: true,
      makerPrivateProgress: {
        remainingOfferAmount: '999999999999999999',
        filledOfferAmount: '1'
      }
    })) as TradeSnapshot[];

    const context = buildTradeAgentOrderReviewContext(trades);
    const serialized = JSON.stringify(context);
    expect(context.orders).toHaveLength(20);
    expect(context.orders[0]).toMatchObject({
      tradeId: 1,
      amountVisibility: 'private-hidden'
    });
    expect(context.orders[0].offer).not.toHaveProperty('amount');
    expect(serialized).not.toMatch(/maker|taker|privateProgress|999999999999999999/);
  });

  it('omits hidden recurring amounts and side progress from Agent context', () => {
    const privateRecurring = {
      tradeId: 31,
      escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
      offer: { kind: 'private-erc20', symbol: 'p.COTI', decimals: 18, amount: '100' },
      request: { kind: 'private-erc20', symbol: 'p.gCOTI', decimals: 18, amount: '250' },
      createdAt: 1,
      expiresAt: 0,
      status: 'open',
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x0000000000000000000000000000000000000000',
      isPublic: true,
      recurringOrder: {
        orderId: 31,
        selectedSide: 'buy',
        mode: 'hybrid-private',
        recurringStatus: 'active',
        baseAsset: { kind: 'private-erc20', symbol: 'p.COTI', decimals: 18, amount: '100' },
        quoteAsset: { kind: 'private-erc20', symbol: 'p.gCOTI', decimals: 18, amount: '250' },
        buyTerms: { baseAmount: '100', quoteAmount: '250' },
        sellTerms: { baseAmount: '100', quoteAmount: '280' },
        publicBaseInventory: '0',
        publicQuoteInventory: '0',
        buySideOpen: true,
        sellSideOpen: false,
        hasPrivateBaseInventory: true,
        hasPrivateQuoteInventory: true,
        executionCount: 4
      }
    } as TradeSnapshot;

    const summary = buildTradeAgentSafeOrderSummary(privateRecurring);
    expect(summary).toMatchObject({
      accessType: 'public',
      amountVisibility: 'private-hidden',
      orderType: 'recurring'
    });
    expect(summary).not.toHaveProperty('buyTerms');
    expect(summary).not.toHaveProperty('sellTerms');
    expect(summary).not.toHaveProperty('buySideOpen');
    expect(summary).not.toHaveProperty('sellSideOpen');
    expect(JSON.stringify(summary)).not.toMatch(/baseAmount|quoteAmount|executionCount|Inventory/);
  });

  it('builds a selected-chat DTO from allowlisted fields only', () => {
    const context = buildTradeAgentChatContext({
      selectedMessage: {
        direction: 'incoming',
        text: '  Sell 5 p.COTI for 10 p.gCOTI.  '
      },
      linkedTrade: {
        tradeId: 9,
        escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        previewOffer: {
          version: 2,
          tradeId: 9,
          escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
          maker: '0x1111111111111111111111111111111111111111',
          taker: '0x2222222222222222222222222222222222222222',
          offer: { kind: 'erc20', symbol: 'WISP', decimals: 6, amount: '5000000' },
          request: { kind: 'private-erc20', symbol: 'p.COTI', decimals: 18, amount: '10000000000000000000' },
          createdAt: 1,
          expiresAt: 0,
          accessSecret: `0x${'b'.repeat(64)}`
        }
      }
    });

    expect(context).toEqual({
      clientSurface: 'chat',
      selectedMessage: {
        direction: 'incoming',
        text: 'Sell 5 p.COTI for 10 p.gCOTI.'
      },
      linkedTrade: {
        tradeId: 9,
        escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        hiddenLiquidity: false,
        offer: { kind: 'erc20', symbol: 'WISP', decimals: 6, amount: '5000000' },
        request: {
          kind: 'private-erc20',
          symbol: 'p.COTI',
          decimals: 18,
          amount: '10000000000000000000'
        }
      }
    });
    expect(JSON.stringify(context)).not.toMatch(/maker|taker|accessSecret|createdAt|expiresAt/);
    expect(() =>
      buildTradeAgentChatContext({
        selectedMessage: {
          direction: 'incoming',
          text: `/otc/order/link/VAEP${'c'.repeat(43)}`
        }
      })
    ).toThrow('Remove private keys');
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

  it('formats response actions for display', () => {
    const swapAction = {
      type: 'prefill_swap' as const,
      inputMode: 'sell' as const,
      sellAmount: '10',
      sellToken: 'p.COTI',
      buyToken: 'p.gCOTI'
    };
    const openAction = {
      type: 'open_order' as const,
      tradeId: 77,
      escrowContract: '0x1111111111111111111111111111111111111111'
    };

    expect(getTradeAgentActionButtonLabel(swapAction)).toBe('Prefill swap');
    expect(getTradeAgentActionDescription(swapAction)).toBe('10 p.COTI for p.gCOTI');
    expect(canUseTradeAgentAction(swapAction)).toBe(true);
    expect(getTradeAgentActionCta(openAction)).toBe('Open');
    expect(getTradeAgentActionDescription({ type: 'prefill_message', message: 'Draft this reply.' })).toBe('Draft this reply.');
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

  it('redacts private trade secrets before agent context leaves the app', () => {
    const secret = `0x${'a'.repeat(64)}`;
    expect(
      redactTradeAgentSecrets({
        linkedTrade: {
          accessSecret: secret,
          terminalPath: `/otc/order/link/VAEP${'b'.repeat(43)}?escrow=direct`,
          tradeId: 7
        },
        selectedMessage: {
          text: `Open https://example.com/trades/l/VAEP${'c'.repeat(43)}?escrow=private or /otc/order/recurring/9#${secret}`
        }
      })
    ).toEqual({
      linkedTrade: {
        accessSecret: '[redacted-access-secret]',
        terminalPath: '/otc/order/link/[redacted-trade-link]?escrow=direct',
        tradeId: 7
      },
      selectedMessage: {
        text: 'Open https://example.com/trades/l/[redacted-trade-link]?escrow=private or /otc/order/recurring/9#[redacted-access-secret]'
      }
    });
  });
});
