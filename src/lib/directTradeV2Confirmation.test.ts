import { describe, expect, it } from 'vitest';
import { buildDirectTradeV2ActionConfirmation } from './directTradeV2Confirmation';

describe('Direct Trade V2 confirmation model', () => {
  it('separates a private create from its conditional one-time approval', () => {
    const model = buildDirectTradeV2ActionConfirmation({
      action: 'create',
      approvalKind: 'private-erc20',
      approvalSymbol: 'pTEST',
      privateTerms: true,
      summaryRows: [{ label: 'You sell', value: '10 pTEST' }]
    });

    expect(model.primaryLabel).toBe('Create offer');
    expect(model.summaryRows).toEqual([{ label: 'You sell', value: '10 pTEST' }]);
    expect(model.stats).toEqual([
      { label: 'COTI private inputs', value: '2 confirmations' },
      { label: 'On-chain action', value: '1 transaction to create this offer' },
      {
        label: 'Token approval',
        value: 'pTEST: one-time if needed (1 COTI confirmation + 1 transaction)'
      },
      { label: 'Chat notification', value: '0 transactions' }
    ]);
  });

  it('reports one private input for accepting private terms', () => {
    const model = buildDirectTradeV2ActionConfirmation({
      action: 'accept',
      approvalKind: 'private-erc20',
      approvalSymbol: 'pQUOTE',
      privateTerms: true
    });

    expect(model.stats[0]).toEqual({ label: 'COTI private inputs', value: '1 confirmation' });
    expect(model.primaryLabel).toBe('Buy');
  });

  it('reports no approval or private input for cancellation', () => {
    const model = buildDirectTradeV2ActionConfirmation({
      action: 'cancel',
      approvalKind: 'none',
      privateTerms: false
    });

    expect(model.stats).toContainEqual({ label: 'COTI private inputs', value: '0 confirmations' });
    expect(model.stats).toContainEqual({ label: 'Token approval', value: 'None' });
    expect(model.stats).toContainEqual({ label: 'Chat notification', value: '0 transactions' });
  });
});
