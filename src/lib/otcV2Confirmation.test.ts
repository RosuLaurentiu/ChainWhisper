import { describe, expect, it } from 'vitest';
import {
  buildOtcV2ConditionalApproval,
  buildOtcV2ConfirmationDetails,
  resolveRecurringOtcV2ConfirmationCosts
} from './otcV2Confirmation';

describe('otcV2Confirmation', () => {
  it('describes a public lifecycle action without obsolete chat work', () => {
    const details = buildOtcV2ConfirmationDetails({
      cotiPrivateInputCount: 0,
      summaryRows: [{ label: 'Order', value: '#7' }]
    });

    expect(details.confirmationStats).toEqual([
      { label: 'COTI private inputs', value: '0 confirmations' },
      { label: 'On-chain action', value: '1 transaction' },
      { label: 'Private token setup', value: 'None' },
      { label: 'Token approval', value: 'None' },
      { label: 'Chat notification', value: '0 transactions' }
    ]);
    expect(details.tradeSummary).toEqual([{ label: 'Order', value: '#7' }]);
  });

  it('counts packed private inputs, multiple actions, and conditional approvals', () => {
    const details = buildOtcV2ConfirmationDetails({
      actionTransactionCount: 2,
      approvals: [
        { kind: 'private-erc20', symbol: 'pWISP' },
        { kind: 'erc20', symbol: 'USDC' }
      ],
      cotiPrivateInputCount: 1
    });

    expect(details.confirmationStats).toEqual([
      { label: 'COTI private inputs', value: '1 confirmation' },
      { label: 'On-chain action', value: '2 transactions' },
      {
        label: 'Private token setup',
        value: 'pWISP: if needed (1 one-time transaction)'
      },
      {
        label: 'Token approval',
        value: 'pWISP: if needed (1 COTI confirmation + 1 transaction); USDC: if needed (1 transaction)'
      },
      { label: 'Chat notification', value: '0 transactions' }
    ]);
  });

  it('omits native and zero-value approvals', () => {
    expect(buildOtcV2ConditionalApproval({ amountWei: 1n, kind: 'none', symbol: 'COTI' })).toBeNull();
    expect(buildOtcV2ConditionalApproval({ amountWei: 0n, kind: 'erc20', symbol: 'WISP' })).toBeNull();
    expect(buildOtcV2ConditionalApproval({ amountWei: 1n, kind: 'erc20', symbol: 'WISP' })).toEqual({
      kind: 'erc20',
      symbol: 'WISP'
    });
  });

  it('rejects impossible prompt counts', () => {
    expect(() => buildOtcV2ConfirmationDetails({ cotiPrivateInputCount: -1 })).toThrow(
      'private-input count'
    );
    expect(() => buildOtcV2ConfirmationDetails({ actionTransactionCount: 0, cotiPrivateInputCount: 0 })).toThrow(
      'transaction count'
    );
  });

  it('counts private recurring edits without hiding the second transaction', () => {
    expect(resolveRecurringOtcV2ConfirmationCosts({
      creating: false,
      liquidityChanged: true,
      pricesChanged: true,
      protocol: 'private-recurring-v2'
    })).toEqual({ actionTransactionCount: 2, cotiPrivateInputCount: 1 });
    expect(resolveRecurringOtcV2ConfirmationCosts({
      creating: false,
      liquidityChanged: false,
      pricesChanged: true,
      protocol: 'private-recurring-v2'
    })).toEqual({ actionTransactionCount: 1, cotiPrivateInputCount: 0 });
    expect(() => resolveRecurringOtcV2ConfirmationCosts({
      creating: false,
      liquidityChanged: false,
      pricesChanged: false,
      protocol: 'private-recurring-v2'
    })).toThrow('must change prices or liquidity');
  });
});
