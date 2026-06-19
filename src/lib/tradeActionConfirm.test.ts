import { describe, expect, it } from 'vitest';
import {
  TradeActionConfirmationCancelledError,
  buildTradeActionConfirmModel,
  isTradeActionConfirmationCancelledError,
  shouldRequestTradeActionConfirmation
} from './tradeActionConfirm';

describe('tradeActionConfirm', () => {
  it('shows confirmation for maker actions even without funding moves', () => {
    expect(
      shouldRequestTradeActionConfirmation({
        confirmationPolicy: 'always',
        fundingMoveCount: 0
      })
    ).toBe(true);
  });

  it('skips confirmation for funding-only actions when no funding is needed', () => {
    expect(
      shouldRequestTradeActionConfirmation({
        confirmationPolicy: 'funding-only',
        fundingMoveCount: 0
      })
    ).toBe(false);
  });

  it('shows confirmation when funding moves are required', () => {
    expect(
      shouldRequestTradeActionConfirmation({
        confirmationPolicy: 'funding-only',
        fundingMoveCount: 1
      })
    ).toBe(true);
  });

  it('builds a combined funding and trade action confirmation', () => {
    const model = buildTradeActionConfirmModel({
      actionLabel: 'create trade',
      confirmButtonLabel: 'Create trade',
      confirmTitle: 'Confirm new trade',
      confirmationPolicy: 'always',
      estimatedFundingPrompts: 1,
      fundingMoves: [
        {
          amountLabel: '92.55052 COTI',
          assetSymbol: 'COTI',
          fromLabel: 'Owner wallet',
          reason: 'trade offer',
          toLabel: 'ChainWhisper'
        }
      ],
      tradeSummary: [
        {
          label: 'You sell',
          value: '100 COTI'
        }
      ],
      transferTransactionCount: 1
    });

    expect(model.title).toBe('Confirm new trade');
    expect(model.primaryLabel).toBe('Move funds and create trade');
    expect(model.fundingMoves).toHaveLength(1);
    expect(model.stats).toEqual([
      { label: 'Owner prompts', value: '1' },
      { label: 'Transfers', value: '1' },
      { label: 'Then', value: 'create trade' }
    ]);
    expect(model.summaryRows).toEqual([{ label: 'You sell', value: '100 COTI' }]);
  });

  it('marks confirmation cancellation errors', () => {
    expect(isTradeActionConfirmationCancelledError(new TradeActionConfirmationCancelledError())).toBe(true);
    expect(isTradeActionConfirmationCancelledError(new Error('nope'))).toBe(false);
  });
});
